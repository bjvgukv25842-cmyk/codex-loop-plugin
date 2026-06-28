import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { buildFeatureSmall001PlannerPrompt, featureSmall001PlannerStageConfig } from "../../src/effectiveness/feature-planner-stage.ts";
import { runPlannerLiteStage } from "../../src/orchestrator/sdk-planner-lite-stage.ts";
import { plannerLiteV2OutputSchema } from "../../src/orchestrator/planner-lite-v2-output.ts";
import { ensureEvalSqliteHome } from "../../src/runtime/eval-sqlite-home.ts";
import { detectCodexSdkDependency, type CodexSdkDependencyStatus } from "../../src/runtime/sdk-capability-detect.ts";
import { SdkRuntimeAdapter } from "../../src/runtime/sdk-runtime-adapter.ts";
import type { RuntimeAdapter } from "../../src/runtime/runtime-adapter.ts";
import type {
  RuntimeEventsInput,
  RuntimeFinalResponseInput,
  RuntimeStopThreadInput,
  RuntimeThreadEventsResult,
  RuntimeThreadInput,
  RuntimeThreadRefInput,
  RuntimeThreadResult
} from "../../src/runtime/runtime-types.ts";
import { loadM12Dataset } from "./dataset.ts";
import { writeJson } from "./io.ts";

export type FeaturePlannerSmokeMode = "parity" | "lite-minimal" | "exact";
export type FeaturePlannerSmokeStatus =
  | "PASS"
  | "FAIL"
  | "BLOCKED_FEATURE_PLANNER_SMOKE_NOT_ENABLED"
  | "BLOCKED_SDK_NOT_INSTALLED"
  | "BLOCKED_SDK_IMPORT_FAILED"
  | "BLOCKED_NODE_VERSION_UNSUPPORTED"
  | "BLOCKED_SDK_EXPORT_MISSING_CODEX"
  | "BLOCKED_EVAL_SQLITE_HOME_NOT_WRITABLE";

export interface FeaturePlannerSmokeResult {
  case_id: "feature-small-001";
  status: FeaturePlannerSmokeStatus;
  mode: FeaturePlannerSmokeMode;
  real_sdk_run_executed: boolean;
  planner_thread_started: boolean;
  planner_thread_id: string;
  structured_output_valid: boolean;
  tasks_count: number;
  no_task_graph_json: boolean;
  artifact_thread_evidence_verified: boolean;
  failure_category: string;
  ready_for_feature_treatment_fresh_rerun: boolean;
  danger_full_access_used: false;
  secret_leak_detected: false;
  sdk_diagnosis: FeaturePlannerSmokeSdkDiagnosis;
  errors: string[];
}

export interface FeaturePlannerSmokeSdkDiagnosis {
  package_json_has_codex_sdk: boolean;
  package_lock_has_codex_sdk: boolean;
  npm_ls_codex_sdk_ok: boolean;
  dynamic_import_codex_sdk_ok: boolean;
  codex_named_export_available: boolean;
  codex_sdk_version: string;
  codex_sdk_export_keys: string[];
  failure_category: string;
  error_message: string;
}

const repoRoot = process.cwd();

export async function runFeaturePlannerSmoke(options: {
  mode?: FeaturePlannerSmokeMode;
  env?: NodeJS.ProcessEnv;
  runtime_adapter?: RuntimeAdapter;
  repoRoot?: string;
} = {}): Promise<FeaturePlannerSmokeResult> {
  const env = options.env ?? process.env;
  const mode = options.mode ?? parseMode(env.CODEX_LOOP_FEATURE_PLANNER_SMOKE_MODE);
  const root = options.repoRoot ?? repoRoot;
  const stageLogDir = resolve(root, "evals/effectiveness/reports/feature-small-001/sdk-stage-logs");
  const targetRepo = resolve(root, "evals/effectiveness/runs/feature-small-001/treatment/target-repo");
  const base = baseResult(mode);
  if (getNodeMajorVersion() < 18) {
    return finish(root, { ...base, status: "BLOCKED_NODE_VERSION_UNSUPPORTED", failure_category: "BLOCKED_NODE_VERSION_UNSUPPORTED", errors: [`Node.js >= 18 required; current ${process.version}.`] });
  }
  const sqliteHome = ensureEvalSqliteHome(root, env);
  if (!sqliteHome.ok) {
    return finish(root, { ...base, status: "BLOCKED_EVAL_SQLITE_HOME_NOT_WRITABLE", failure_category: sqliteHome.reason ?? "BLOCKED_EVAL_SQLITE_HOME_NOT_WRITABLE", errors: [sqliteHome.reason ?? "Eval SQLite home is not writable."] });
  }
  const mock = env.CODEX_LOOP_FEATURE_PLANNER_SMOKE_MOCK;
  if (!mock) {
    const sdk = await detectCodexSdkDependency(root);
    base.sdk_diagnosis = toSmokeSdkDiagnosis(sdk);
    if (!sdk.detected) {
      return finish(root, {
        ...base,
        status: sdk.failure_category || "BLOCKED_SDK_IMPORT_FAILED",
        failure_category: sdk.failure_category || "BLOCKED_SDK_IMPORT_FAILED",
        errors: [sdk.error_message || "Unable to import @openai/codex-sdk."]
      });
    }
  }
  if (!mock && env.CODEX_LOOP_ENABLE_M12_FEATURE_PLANNER_SMOKE !== "1") {
    return finish(root, {
      ...base,
      status: "BLOCKED_FEATURE_PLANNER_SMOKE_NOT_ENABLED",
      failure_category: "BLOCKED_FEATURE_PLANNER_SMOKE_NOT_ENABLED",
      errors: ["Set CODEX_LOOP_ENABLE_M12_FEATURE_PLANNER_SMOKE=1 only for one controlled planner-only smoke."]
    });
  }
  const adapter = options.runtime_adapter ?? (mock
    ? new FeaturePlannerMockAdapter(mode, mock)
    : new SdkRuntimeAdapter({ enableRealRun: true, repoRoot: root }));
  if (mode === "parity") {
    const parityInput = parityRuntimeInput(sqliteHome.path, root, targetRepo, stageLogDir);
    const thread = "runThreadStreamed" in adapter && typeof adapter.runThreadStreamed === "function"
      ? await adapter.runThreadStreamed(parityInput)
      : await adapter.runThread(parityInput);
    return finish(root, evaluateParity(thread, mode, mock ? false : true));
  }
  const exactConfig = featureSmall001PlannerStageConfig();
  const stage = await runPlannerLiteStage({
    loop_run_id: `loop_m12_feature_planner_${mode.replace(/-/g, "_")}`,
    task_id: `task_m12_feature_planner_${mode.replace(/-/g, "_")}`,
    target_repo: targetRepo,
    model: env.CODEX_LOOP_CODEX_MODEL,
    model_catalog_json: env.CODEX_LOOP_MODEL_CATALOG_JSON ?? resolve(root, "evals/sdk-orchestrated/model-catalog-bundled.json"),
    sqlite_home: sqliteHome.path,
    sandbox: "read-only",
    timeout_ms: 180_000,
    runtime_adapter: adapter,
    repo_root: targetRepo,
    report_dir: stageLogDir,
    output_contract_version: exactConfig.output_contract_version,
    prompt_override: mode === "exact" ? exactConfig.prompt : buildLiteMinimalPrompt(),
    root_goal: mode === "exact" ? exactConfig.root_goal : "Add JSON output support to status CLI.",
    default_validation_commands: ["npm test"],
    default_likely_files: mode === "exact" ? exactConfig.default_likely_files : ["src/status.js", "test/status.test.js"],
    invocation_trace_label: `m12-feature-planner-smoke-${mode}`,
    invocation_trace_path: resolve(stageLogDir, `feature-planner-smoke-${mode}-invocation-trace-redacted.json`),
    events_path: resolve(stageLogDir, `feature-planner-smoke-${mode}-events.jsonl`),
    stdout_path: resolve(stageLogDir, `feature-planner-smoke-${mode}-stdout.log`),
    stderr_path: resolve(stageLogDir, `feature-planner-smoke-${mode}-stderr.log`),
    no_event_timeout_ms: 60_000
  });
  const tasksCount = readTaskCount(stage.raw_output_path);
  return finish(root, {
    ...base,
    status: stage.status === "PASS" && tasksCount >= 1 ? "PASS" : "FAIL",
    real_sdk_run_executed: mock ? false : true,
    planner_thread_started: stage.planner_thread_started,
    planner_thread_id: stage.planner_thread_id,
    structured_output_valid: stage.structured_output_valid,
    tasks_count: tasksCount,
    no_task_graph_json: !readRawOutput(stage.raw_output_path).includes("task_graph_json"),
    artifact_thread_evidence_verified: stage.artifact_thread_evidence_verified,
    failure_category: stage.status === "PASS" && tasksCount >= 1 ? "" : stage.failure_category || "FEATURE_PLANNER_SMOKE_FAILED",
    errors: stage.errors
  });
}

function baseResult(mode: FeaturePlannerSmokeMode): FeaturePlannerSmokeResult {
  return {
    case_id: "feature-small-001",
    status: "FAIL",
    mode,
    real_sdk_run_executed: false,
    planner_thread_started: false,
    planner_thread_id: "",
    structured_output_valid: false,
    tasks_count: 0,
    no_task_graph_json: true,
    artifact_thread_evidence_verified: false,
    failure_category: "",
    ready_for_feature_treatment_fresh_rerun: false,
    danger_full_access_used: false,
    secret_leak_detected: false,
    sdk_diagnosis: emptySmokeSdkDiagnosis(),
    errors: []
  };
}

function parityRuntimeInput(sqliteHome: string, root: string, targetRepo: string, stageLogDir: string): RuntimeThreadInput {
  return {
    role: "planner",
    loop_run_id: "loop_m12_feature_planner_parity",
    task_id: "task_m12_feature_planner_parity",
    prompt: "Respond with exactly: FEATURE_PLANNER_PARITY_OK",
    sandbox: "read-only",
    working_directory: targetRepo,
    timeout_ms: 180_000,
    output_schema_path: "",
    codex_model: process.env.CODEX_LOOP_CODEX_MODEL,
    model_catalog_json: process.env.CODEX_LOOP_MODEL_CATALOG_JSON ?? resolve(root, "evals/sdk-orchestrated/model-catalog-bundled.json"),
    invocation_trace_label: "m12-feature-planner-smoke-parity",
    invocation_trace_path: resolve(stageLogDir, "feature-planner-smoke-parity-invocation-trace-redacted.json"),
    error_capture_paths: {
      events_path: resolve(stageLogDir, "feature-planner-smoke-parity-events.jsonl"),
      stdout_path: resolve(stageLogDir, "feature-planner-smoke-parity-stdout.log"),
      stderr_path: resolve(stageLogDir, "feature-planner-smoke-parity-stderr.log")
    },
    no_event_timeout_ms: 60_000,
    env: {
      CODEX_SQLITE_HOME: sqliteHome
    }
  };
}

function evaluateParity(thread: RuntimeThreadResult, mode: FeaturePlannerSmokeMode, realSdkRunExecuted: boolean): FeaturePlannerSmokeResult {
  const pass = thread.thread_id.length > 0 && thread.final_response.trim() === "FEATURE_PLANNER_PARITY_OK";
  return {
    ...baseResult(mode),
    status: pass ? "PASS" : "FAIL",
    real_sdk_run_executed: realSdkRunExecuted,
    planner_thread_started: thread.thread_id.length > 0,
    planner_thread_id: thread.thread_id,
    structured_output_valid: pass,
    tasks_count: pass ? 1 : 0,
    no_task_graph_json: true,
    artifact_thread_evidence_verified: pass,
    failure_category: pass ? "" : thread.failure_category || "FEATURE_PLANNER_PARITY_FAILED",
    errors: thread.errors
  };
}

function finish(root: string, result: FeaturePlannerSmokeResult): FeaturePlannerSmokeResult {
  const withReadiness = {
    ...result,
    ready_for_feature_treatment_fresh_rerun: result.mode === "exact" && result.status === "PASS"
  };
  writeJson(resolve(root, "evals/effectiveness/reports/feature-small-001/feature-planner-smoke-result.json"), withReadiness);
  return withReadiness;
}

export function parseMode(value: string | undefined): FeaturePlannerSmokeMode {
  if (value === "parity" || value === "lite-minimal" || value === "exact") return value;
  return "parity";
}

function buildLiteMinimalPrompt(): string {
  return [
    "Return planner-lite-v2 JSON for one task.",
    "Task: Add --json output support to src/status.js.",
    "validation_commands: [\"npm test\"]",
    "likely_files: [\"src/status.js\", \"test/status.test.js\"]",
    "Do not include nested JSON strings."
  ].join("\n");
}

function readTaskCount(path: string): number {
  try {
    const parsed = JSON.parse(readRawOutput(path)) as { tasks?: unknown[] };
    return Array.isArray(parsed.tasks) ? parsed.tasks.length : 0;
  } catch {
    return 0;
  }
}

function readRawOutput(path: string): string {
  try {
    return path ? readFileSync(path, "utf8") : "";
  } catch {
    return "";
  }
}

function getNodeMajorVersion(): number {
  return Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
}

function toSmokeSdkDiagnosis(status: CodexSdkDependencyStatus): FeaturePlannerSmokeSdkDiagnosis {
  return {
    package_json_has_codex_sdk: status.package_json_has_codex_sdk,
    package_lock_has_codex_sdk: status.package_lock_has_codex_sdk,
    npm_ls_codex_sdk_ok: status.npm_ls_codex_sdk_ok,
    dynamic_import_codex_sdk_ok: status.dynamic_import_codex_sdk_ok,
    codex_named_export_available: status.codex_named_export_available,
    codex_sdk_version: status.codex_sdk_version,
    codex_sdk_export_keys: status.codex_sdk_export_keys,
    failure_category: status.failure_category,
    error_message: status.error_message
  };
}

function emptySmokeSdkDiagnosis(): FeaturePlannerSmokeSdkDiagnosis {
  return {
    package_json_has_codex_sdk: false,
    package_lock_has_codex_sdk: false,
    npm_ls_codex_sdk_ok: false,
    dynamic_import_codex_sdk_ok: false,
    codex_named_export_available: false,
    codex_sdk_version: "",
    codex_sdk_export_keys: [],
    failure_category: "",
    error_message: ""
  };
}

function validPlannerV2Output(mode: FeaturePlannerSmokeMode): string {
  const feature = mode === "exact";
  return JSON.stringify({
    status: "PASS",
    prd_markdown: feature ? "# Project Name Validation\n\nValidate create-project names." : "# Status JSON Output\n\nAdd JSON output support.",
    tasks: [
      {
        id: feature ? "task_validate_project_name" : "task_status_json",
        title: feature ? "Validate project names" : "Add status JSON output",
        description: feature ? "Implement project name validation." : "Add --json output support to status CLI.",
        acceptance_criteria: feature
          ? loadM12Dataset().find((entry) => entry.case_id === "feature-small-001")?.acceptance_criteria ?? []
          : ["node src/status.js --json outputs valid JSON."],
        likely_files: feature ? ["src/project-name.js", "test/project-name.test.js"] : ["src/status.js", "test/status.test.js"],
        validation_commands: ["npm test"]
      }
    ],
    acceptance_criteria: feature
      ? loadM12Dataset().find((entry) => entry.case_id === "feature-small-001")?.acceptance_criteria ?? []
      : ["node src/status.js --json outputs valid JSON."],
    risks: []
  });
}

class FeaturePlannerMockAdapter implements RuntimeAdapter {
  private readonly mode: FeaturePlannerSmokeMode;
  private readonly mock: string;

  constructor(mode: FeaturePlannerSmokeMode, mock: string) {
    this.mode = mode;
    this.mock = mock;
  }

  async startThread(input: RuntimeThreadInput): Promise<RuntimeThreadResult> {
    return this.runThreadStreamed(input);
  }

  async runThread(input: RuntimeThreadInput): Promise<RuntimeThreadResult> {
    return this.runThreadStreamed(input);
  }

  async runThreadStreamed(input: RuntimeThreadInput): Promise<RuntimeThreadResult> {
    if (this.mock === "fail") {
      return this.result(input, "", "FAILED", "FEATURE_PLANNER_SMOKE_MOCK_FAILURE");
    }
    if (input.error_capture_paths?.events_path) {
      mkdirSync(dirname(input.error_capture_paths.events_path), { recursive: true });
      writeFileSync(input.error_capture_paths.events_path, `{"type":"thread.started","thread_id":"thread_feature_planner_${this.mode.replace(/-/g, "_")}"}\n`, "utf8");
    }
    if (this.mode === "parity") {
      return this.result(input, "FEATURE_PLANNER_PARITY_OK", "PASS", "");
    }
    return this.result(input, validPlannerV2Output(this.mode), "PASS", "");
  }

  async resumeThread(input: RuntimeThreadRefInput): Promise<RuntimeThreadResult> {
    return this.result({ role: input.role } as RuntimeThreadInput, "", "BLOCKED", "MOCK_RESUME_UNSUPPORTED");
  }

  async getThreadEvents(input: RuntimeEventsInput): Promise<RuntimeThreadEventsResult> {
    return { thread_id: input.thread_id, events_path: input.events_path ?? "", events: [], errors: [] };
  }

  async stopThread(input: RuntimeStopThreadInput): Promise<RuntimeThreadResult> {
    return this.result({ role: "context_distiller", thread_id: input.thread_id } as unknown as RuntimeThreadInput, "", "PASS", "");
  }

  async getFinalResponse(input: RuntimeFinalResponseInput): Promise<RuntimeThreadResult> {
    return this.result({ role: "context_distiller", thread_id: input.thread_id } as unknown as RuntimeThreadInput, "", "PASS", "");
  }

  private result(input: RuntimeThreadInput, finalResponse: string, status: RuntimeThreadResult["status"], failureCategory: string): RuntimeThreadResult {
    if (input.error_capture_paths?.stdout_path) {
      mkdirSync(dirname(input.error_capture_paths.stdout_path), { recursive: true });
      writeFileSync(input.error_capture_paths.stdout_path, finalResponse, "utf8");
    }
    return {
      thread_id: failureCategory ? "" : `thread_feature_planner_${this.mode.replace(/-/g, "_")}`,
      role: input.role,
      status,
      final_response: finalResponse,
      events: [],
      events_path: input.error_capture_paths?.events_path ?? "",
      stdout_path: input.error_capture_paths?.stdout_path ?? "",
      stderr_path: input.error_capture_paths?.stderr_path ?? "",
      artifacts: [],
      failure_category: failureCategory,
      errors: failureCategory ? [failureCategory] : []
    };
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await runFeaturePlannerSmoke();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.status === "FAIL" ? 2 : 0;
}
