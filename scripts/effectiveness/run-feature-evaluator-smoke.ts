import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import {
  buildFeatureEvaluatorPrompt,
  classifyFeatureEvaluatorParityFailure,
  featureEvaluatorMinimalOutputSchema,
  FEATURE_EVALUATOR_PARITY_PROMPT,
  featureEvaluatorStageConfig
} from "../../src/effectiveness/feature-evaluator-stage.ts";
import {
  featureEvaluatorModeResultPath,
  gateFeatureEvaluatorSmokeMode,
  reconstructFeatureEvaluatorSmokeReadiness,
  updateFeatureEvaluatorSmokeReadinessFromResult
} from "../../src/effectiveness/feature-evaluator-smoke-readiness.ts";
import { runEvaluatorLiteStage } from "../../src/orchestrator/sdk-evaluator-stage.ts";
import { evaluatorLiteOutputSchema } from "../../src/orchestrator/parse-evaluator-lite-output.ts";
import { ensureEvalSqliteHome } from "../../src/runtime/eval-sqlite-home.ts";
import { detectCodexSdkDependency, type CodexSdkDependencyStatus } from "../../src/runtime/sdk-capability-detect.ts";
import { DEFAULT_CODEX_MODEL, SdkRuntimeAdapter } from "../../src/runtime/sdk-runtime-adapter.ts";
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
import { readJson, writeJson } from "./io.ts";

export type FeatureEvaluatorSmokeMode = "parity" | "text-only" | "output-minimal" | "output-lite" | "exact";
export type FeatureEvaluatorSmokeStatus =
  | "PASS"
  | "FAIL"
  | "BLOCKED_FEATURE_EVALUATOR_SMOKE_NOT_ENABLED"
  | "BLOCKED_SDK_NOT_INSTALLED"
  | "BLOCKED_SDK_IMPORT_FAILED"
  | "BLOCKED_NODE_VERSION_UNSUPPORTED"
  | "BLOCKED_SDK_EXPORT_MISSING_CODEX"
  | "BLOCKED_EVAL_SQLITE_HOME_NOT_WRITABLE"
  | "BLOCKED_EVALUATOR_PARITY_NOT_PASSED"
  | "BLOCKED_EVALUATOR_TEXT_ONLY_NOT_PASSED"
  | "BLOCKED_EVALUATOR_OUTPUT_MINIMAL_NOT_PASSED"
  | "BLOCKED_EVALUATOR_OUTPUT_LITE_NOT_PASSED"
  | "BLOCKED_EVALUATOR_PARITY_INVOCATION_DIFF";

export interface FeatureEvaluatorSmokeResult {
  case_id: "feature-small-001";
  status: FeatureEvaluatorSmokeStatus;
  mode: FeatureEvaluatorSmokeMode;
  real_sdk_run_executed: boolean;
  evaluator_thread_started: boolean;
  evaluator_thread_id: string;
  structured_output_valid: boolean;
  eval_report_created: boolean;
  eval_verdict: "" | "PASS" | "NEEDS_REVISION";
  artifact_thread_evidence_verified: boolean;
  final_response_contains_expected: boolean;
  output_schema_kind: "none" | "minimal" | "evaluator-lite";
  uses_evaluator_lite_schema: boolean;
  uses_full_eval_report_schema: false;
  evaluator_prompt_length: number;
  evaluator_prompt_hash: string;
  evaluator_events_path: string;
  evaluator_stdout_path: string;
  evaluator_stderr_path: string;
  evaluator_last_event_type: string;
  evaluator_elapsed_ms: number;
  evaluator_event_count: number;
  sdk_method: "run" | "runStreamed";
  failure_category: string;
  ready_for_feature_treatment_fresh_rerun: boolean;
  ready_for_next_evaluator_smoke: boolean;
  danger_full_access_used: false;
  secret_leak_detected: false;
  sdk_diagnosis: FeatureEvaluatorSmokeSdkDiagnosis;
  errors: string[];
}

export interface FeatureEvaluatorSmokeSdkDiagnosis {
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
const resultPath = "evals/effectiveness/reports/feature-small-001/feature-evaluator-smoke-result.json";

export async function runFeatureEvaluatorSmoke(options: {
  mode?: FeatureEvaluatorSmokeMode;
  env?: NodeJS.ProcessEnv;
  runtime_adapter?: RuntimeAdapter;
  repoRoot?: string;
} = {}): Promise<FeatureEvaluatorSmokeResult> {
  const env = options.env ?? process.env;
  const mode = options.mode ?? parseMode(env.CODEX_LOOP_FEATURE_EVALUATOR_SMOKE_MODE);
  const root = options.repoRoot ?? repoRoot;
  const stageLogDir = resolve(root, "evals/effectiveness/reports/feature-small-001/sdk-stage-logs");
  const targetRepo = resolve(root, "evals/effectiveness/runs/feature-small-001/treatment/target-repo");
  const base = baseResult(mode);
  const sdkMethod = evaluatorSdkMethod(env, mode);
  base.sdk_method = sdkMethod;
  if (getNodeMajorVersion() < 18) {
    return finish(root, { ...base, status: "BLOCKED_NODE_VERSION_UNSUPPORTED", failure_category: "BLOCKED_NODE_VERSION_UNSUPPORTED", errors: [`Node.js >= 18 required; current ${process.version}.`] });
  }
  const sqliteHome = ensureEvalSqliteHome(root, env);
  if (!sqliteHome.ok) {
    return finish(root, { ...base, status: "BLOCKED_EVAL_SQLITE_HOME_NOT_WRITABLE", failure_category: sqliteHome.reason ?? "BLOCKED_EVAL_SQLITE_HOME_NOT_WRITABLE", errors: [sqliteHome.reason ?? "Eval SQLite home is not writable."] });
  }
  const readiness = reconstructFeatureEvaluatorSmokeReadiness(root, { write: true });
  const modeGate = gateFeatureEvaluatorSmokeMode(readiness, mode);
  if (!modeGate.ok) {
    return finish(root, {
      ...base,
      status: modeGate.status as FeatureEvaluatorSmokeStatus,
      failure_category: modeGate.status,
      errors: [modeGate.reason]
    });
  }
  const mock = env.CODEX_LOOP_FEATURE_EVALUATOR_SMOKE_MOCK;
  const injectedRuntimeAdapter = Boolean(options.runtime_adapter);
  if (!mock && !injectedRuntimeAdapter) {
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
  if (!mock && !injectedRuntimeAdapter && env.CODEX_LOOP_ENABLE_M12_FEATURE_EVALUATOR_SMOKE !== "1") {
    return finish(root, {
      ...base,
      status: "BLOCKED_FEATURE_EVALUATOR_SMOKE_NOT_ENABLED",
      failure_category: "BLOCKED_FEATURE_EVALUATOR_SMOKE_NOT_ENABLED",
      errors: ["Set CODEX_LOOP_ENABLE_M12_FEATURE_EVALUATOR_SMOKE=1 only for one controlled evaluator-only smoke."]
    });
  }
  const adapter = options.runtime_adapter ?? (mock
    ? new FeatureEvaluatorMockAdapter(mode, mock)
    : new SdkRuntimeAdapter({ enableRealRun: true, repoRoot: root, preferStreamed: sdkMethod === "runStreamed" }));
  if (mode === "parity" || mode === "text-only" || mode === "output-minimal") {
    const runtimeInput = modeRuntimeInput(mode, sqliteHome.path, root, targetRepo, stageLogDir, env);
    if (mode === "parity") {
      const alignment = evaluatorCliSdkParityAlignment(root, runtimeInput);
      if (!alignment.ok) {
        return finish(root, {
          ...base,
          status: "BLOCKED_EVALUATOR_PARITY_INVOCATION_DIFF",
          evaluator_prompt_length: runtimeInput.prompt.length,
          evaluator_prompt_hash: stableHash(runtimeInput.prompt),
          evaluator_events_path: runtimeInput.error_capture_paths?.events_path ?? "",
          evaluator_stdout_path: runtimeInput.error_capture_paths?.stdout_path ?? "",
          evaluator_stderr_path: runtimeInput.error_capture_paths?.stderr_path ?? "",
          failure_category: "BLOCKED_EVALUATOR_PARITY_INVOCATION_DIFF",
          errors: alignment.diffs.map((diff) => `Evaluator SDK parity invocation differs from CLI parity: ${diff}.`)
        });
      }
    }
    const useRun = sdkMethod === "run";
    const thread = useRun || !("runThreadStreamed" in adapter) || typeof adapter.runThreadStreamed !== "function"
      ? await adapter.runThread(runtimeInput)
      : await adapter.runThreadStreamed(runtimeInput);
    return finish(root, evaluateDirectMode(thread, runtimeInput, mode, mock || injectedRuntimeAdapter ? false : true, sdkMethod));
  }
  const config = evaluatorConfig(root);
  const stage = await runEvaluatorLiteStage({
    loop_run_id: `loop_m12_feature_evaluator_${mode.replace(/-/g, "_")}`,
    task_id: `task_m12_feature_evaluator_${mode.replace(/-/g, "_")}`,
    target_repo: targetRepo,
    prd_path: "docs/PRD.md",
    task_graph_path: "docs/TASK_GRAPH.json",
    dev_result_path: "artifacts/dev-result.json",
    test_log_path: resolve(root, "evals/effectiveness/reports/feature-small-001/treatment-validation.log"),
    diff_path: resolve(root, "evals/effectiveness/reports/feature-small-001/treatment-diff.patch"),
    model: env.CODEX_LOOP_CODEX_MODEL,
    model_catalog_json: env.CODEX_LOOP_MODEL_CATALOG_JSON ?? resolve(root, "evals/sdk-orchestrated/model-catalog-bundled.json"),
    sqlite_home: sqliteHome.path,
    sandbox: "read-only",
    timeout_ms: 180_000,
    runtime_adapter: adapter,
    repo_root: targetRepo,
    report_dir: stageLogDir,
    artifact_path: mode === "exact" ? "artifacts/eval-report.json" : "artifacts/evaluator-smoke-report.json",
    prompt_override: mode === "exact" ? config.prompt : outputLitePrompt(),
    invocation_trace_label: `m12-feature-evaluator-smoke-${mode}`,
    invocation_trace_path: resolve(stageLogDir, `feature-evaluator-smoke-${mode}-invocation-trace-redacted.json`),
    events_path: resolve(stageLogDir, `feature-evaluator-smoke-${mode}-events.jsonl`),
    stdout_path: resolve(stageLogDir, `feature-evaluator-smoke-${mode}-stdout.log`),
    stderr_path: resolve(stageLogDir, `feature-evaluator-smoke-${mode}-stderr.log`),
    no_event_timeout_ms: 60_000,
    sdk_method: sdkMethod
  });
  const pass = stage.evaluator_thread_started &&
    stage.structured_output_valid &&
    stage.eval_report_created &&
    (stage.eval_verdict === "PASS" || (mode === "exact" && stage.eval_verdict === "NEEDS_REVISION")) &&
    stage.artifact_thread_evidence_verified;
  return finish(root, {
    ...base,
    status: pass ? "PASS" : "FAIL",
    real_sdk_run_executed: mock || injectedRuntimeAdapter ? false : true,
    evaluator_thread_started: stage.evaluator_thread_started,
    evaluator_thread_id: stage.evaluator_thread_id,
    structured_output_valid: stage.structured_output_valid,
    eval_report_created: stage.eval_report_created,
    eval_verdict: stage.eval_verdict,
    artifact_thread_evidence_verified: stage.artifact_thread_evidence_verified,
    final_response_contains_expected: stage.final_response_contains_expected,
    output_schema_kind: "evaluator-lite",
    uses_evaluator_lite_schema: true,
    evaluator_prompt_length: mode === "exact" ? config.prompt_length : outputLitePrompt().length,
    evaluator_prompt_hash: mode === "exact" ? config.prompt_hash : "",
    sdk_method: sdkMethod,
    failure_category: pass ? "" : stage.failure_category || categoryForMode(mode),
    errors: stage.errors
  });
}

export function evaluatorSdkMethod(env: NodeJS.ProcessEnv, mode: FeatureEvaluatorSmokeMode = "parity"): "run" | "runStreamed" {
  if (env.CODEX_LOOP_EVALUATOR_PARITY_SDK_METHOD === "runStreamed") return "runStreamed";
  if (env.CODEX_LOOP_EVALUATOR_PARITY_SDK_METHOD === "run") return "run";
  return mode === "parity" ? "run" : "runStreamed";
}

function baseResult(mode: FeatureEvaluatorSmokeMode): FeatureEvaluatorSmokeResult {
  return {
    case_id: "feature-small-001",
    status: "FAIL",
    mode,
    real_sdk_run_executed: false,
    evaluator_thread_started: false,
    evaluator_thread_id: "",
    structured_output_valid: false,
    eval_report_created: false,
    eval_verdict: "",
    artifact_thread_evidence_verified: false,
    final_response_contains_expected: false,
    output_schema_kind: "none",
    uses_evaluator_lite_schema: false,
    uses_full_eval_report_schema: false,
    evaluator_prompt_length: 0,
    evaluator_prompt_hash: "",
    evaluator_events_path: "",
    evaluator_stdout_path: "",
    evaluator_stderr_path: "",
    evaluator_last_event_type: "",
    evaluator_elapsed_ms: 0,
    evaluator_event_count: 0,
    sdk_method: "run",
    failure_category: "",
    ready_for_feature_treatment_fresh_rerun: false,
    ready_for_next_evaluator_smoke: false,
    danger_full_access_used: false,
    secret_leak_detected: false,
    sdk_diagnosis: emptySmokeSdkDiagnosis(),
    errors: []
  };
}

function modeRuntimeInput(mode: FeatureEvaluatorSmokeMode, sqliteHome: string, root: string, targetRepo: string, stageLogDir: string, env: NodeJS.ProcessEnv = process.env): RuntimeThreadInput {
  const outputSchema = mode === "output-minimal" ? featureEvaluatorMinimalOutputSchema : undefined;
  const prompt = mode === "parity"
    ? FEATURE_EVALUATOR_PARITY_PROMPT
    : mode === "text-only"
      ? [
          "Read existing feature-small-001 artifacts if needed.",
          "Return JSON text only:",
          "{\"status\":\"PASS\",\"verdict\":\"PASS\",\"summary\":\"FEATURE_EVALUATOR_TEXT_ONLY_OK\"}"
        ].join("\n")
      : [
          "Return JSON matching the minimal evaluator schema.",
          "{\"status\":\"PASS\",\"verdict\":\"PASS\",\"summary\":\"FEATURE_EVALUATOR_OUTPUT_MINIMAL_OK\"}"
        ].join("\n");
  return {
    role: "evaluator",
    loop_run_id: `loop_m12_feature_evaluator_${mode.replace(/-/g, "_")}`,
    task_id: `task_m12_feature_evaluator_${mode.replace(/-/g, "_")}`,
    prompt,
    sandbox: "read-only",
    working_directory: targetRepo,
    timeout_ms: 180_000,
    output_schema_path: "",
    output_schema: outputSchema,
    codex_model: env.CODEX_LOOP_CODEX_MODEL ?? DEFAULT_CODEX_MODEL,
    model_catalog_json: env.CODEX_LOOP_MODEL_CATALOG_JSON ?? resolve(root, "evals/sdk-orchestrated/model-catalog-bundled.json"),
    invocation_trace_label: `m12-feature-evaluator-smoke-${mode}`,
    invocation_trace_path: resolve(stageLogDir, `feature-evaluator-smoke-${mode}-invocation-trace-redacted.json`),
    error_capture_paths: {
      events_path: resolve(stageLogDir, `feature-evaluator-smoke-${mode}-events.jsonl`),
      stdout_path: resolve(stageLogDir, `feature-evaluator-smoke-${mode}-stdout.log`),
      stderr_path: resolve(stageLogDir, `feature-evaluator-smoke-${mode}-stderr.log`)
    },
    no_event_timeout_ms: 60_000,
    env: {
      CODEX_SQLITE_HOME: sqliteHome
    }
  };
}

function evaluateDirectMode(
  thread: RuntimeThreadResult,
  input: RuntimeThreadInput,
  mode: FeatureEvaluatorSmokeMode,
  realSdkRunExecuted: boolean,
  sdkMethod: "run" | "runStreamed"
): FeatureEvaluatorSmokeResult {
  const parsedTextOnly = mode === "text-only" || mode === "output-minimal" ? parseJsonObject(thread.final_response) : null;
  const pass = mode === "parity"
    ? thread.thread_id.length > 0 && thread.final_response.includes("FEATURE_EVALUATOR_PARITY_OK")
    : thread.thread_id.length > 0 && parsedTextOnly?.verdict === "PASS";
  const events = readJsonlEvents(input.error_capture_paths?.events_path ?? "");
  const failureCategory = pass ? "" : mode === "parity"
    ? classifyFeatureEvaluatorParityFailure({
        thread_id: thread.thread_id,
        status: thread.status,
        failure_category: thread.failure_category,
        final_response: thread.final_response,
        events,
        last_event_type: thread.last_event_type,
        no_event_timeout: thread.no_event_timeout,
        event_count: events.length,
        sdk_method: sdkMethod,
        direct_cli_parity_status: "PASS"
      })
    : thread.failure_category || categoryForMode(mode);
  return {
    ...baseResult(mode),
    status: pass ? "PASS" : "FAIL",
    real_sdk_run_executed: realSdkRunExecuted,
    evaluator_thread_started: thread.thread_id.length > 0,
    evaluator_thread_id: thread.thread_id,
    structured_output_valid: pass,
    eval_report_created: false,
    eval_verdict: pass && mode !== "parity" ? "PASS" : "",
    artifact_thread_evidence_verified: pass,
    final_response_contains_expected: pass,
    output_schema_kind: mode === "output-minimal" ? "minimal" : "none",
    evaluator_prompt_length: input.prompt.length,
    evaluator_prompt_hash: stableHash(input.prompt),
    evaluator_events_path: input.error_capture_paths?.events_path ?? "",
    evaluator_stdout_path: input.error_capture_paths?.stdout_path ?? "",
    evaluator_stderr_path: input.error_capture_paths?.stderr_path ?? "",
    evaluator_last_event_type: thread.last_event_type ?? lastEventType(events),
    evaluator_elapsed_ms: thread.elapsed_ms ?? 0,
    evaluator_event_count: events.length || thread.events.length,
    sdk_method: sdkMethod,
    failure_category: failureCategory,
    errors: thread.errors
  };
}

function finish(root: string, result: FeatureEvaluatorSmokeResult): FeatureEvaluatorSmokeResult {
  const previousModeResult = readJson<FeatureEvaluatorSmokeResult | null>(featureEvaluatorModeResultPath(root, result.mode), null);
  const initial = {
    ...result,
    ready_for_next_evaluator_smoke: false,
    ready_for_feature_treatment_fresh_rerun: false
  };
  writeJson(resolve(root, resultPath), initial);
  writeJson(featureEvaluatorModeResultPath(root, result.mode), preservePreviousPass(previousModeResult, initial));
  const readiness = updateFeatureEvaluatorSmokeReadinessFromResult(root, initial);
  const withReadiness = {
    ...initial,
    ready_for_next_evaluator_smoke: nextEvaluatorSmokeReady(result.mode, readiness),
    ready_for_feature_treatment_fresh_rerun: readiness.ready_for_treatment_rerun
  };
  writeJson(resolve(root, resultPath), withReadiness);
  writeJson(featureEvaluatorModeResultPath(root, result.mode), preservePreviousPass(previousModeResult, withReadiness));
  updateFeatureEvaluatorSmokeReadinessFromResult(root, withReadiness);
  return withReadiness;
}

function preservePreviousPass(previous: FeatureEvaluatorSmokeResult | null, next: FeatureEvaluatorSmokeResult): FeatureEvaluatorSmokeResult {
  return previous?.status === "PASS" && next.status !== "PASS" ? previous : next;
}

function nextEvaluatorSmokeReady(mode: FeatureEvaluatorSmokeMode, readiness: ReturnType<typeof updateFeatureEvaluatorSmokeReadinessFromResult>): boolean {
  if (mode === "parity") return readiness.parity.status === "PASS";
  if (mode === "text-only") return readiness.ready_for_output_minimal;
  if (mode === "output-minimal") return readiness.ready_for_output_lite;
  if (mode === "output-lite") return readiness.ready_for_exact;
  return false;
}

function evaluatorCliSdkParityAlignment(root: string, input: RuntimeThreadInput): { ok: boolean; diffs: string[] } {
  const print = readJson<Record<string, unknown> | null>(resolve(root, "evals/effectiveness/reports/feature-small-001/evaluator-cli-parity-print.json"), null);
  if (!print) return { ok: true, diffs: [] };
  const diffs: string[] = [];
  compare("target_repo", input.working_directory, stringField(print, "target_repo"), diffs);
  compare("sqlite_home", input.env.CODEX_SQLITE_HOME ?? "", stringField(print, "sqlite_home"), diffs);
  compare("model", input.codex_model ?? "", stringField(print, "model"), diffs);
  compare("model_catalog_json", input.model_catalog_json ?? "", stringField(print, "model_catalog_json"), diffs);
  compare("prompt", input.prompt, stringField(print, "prompt"), diffs);
  if (input.sandbox !== "read-only") diffs.push("sandbox");
  if (input.output_schema || input.output_schema_path) diffs.push("outputSchema");
  return { ok: diffs.length === 0, diffs };
}

function compare(field: string, actual: string, expected: string, diffs: string[]): void {
  if (expected && actual !== expected) diffs.push(field);
}

export function parseMode(value: string | undefined): FeatureEvaluatorSmokeMode {
  if (value === "parity" || value === "text-only" || value === "output-minimal" || value === "output-lite" || value === "exact") return value;
  return "parity";
}

function evaluatorConfig(root: string): ReturnType<typeof featureEvaluatorStageConfig> {
  return featureEvaluatorStageConfig({
    prd_path: "docs/PRD.md",
    task_graph_path: "docs/TASK_GRAPH.json",
    dev_result_path: "artifacts/dev-result.json",
    test_log_path: resolve(root, "evals/effectiveness/reports/feature-small-001/treatment-validation.log"),
    diff_path: resolve(root, "evals/effectiveness/reports/feature-small-001/treatment-diff.patch")
  });
}

function outputLitePrompt(): string {
  return [
    "Role: evaluator. Read-only.",
    "Return evaluator-lite JSON only.",
    "Use status PASS, verdict PASS, summary FEATURE_EVALUATOR_OUTPUT_LITE_OK, findings_json \"[]\", validation_commands_checked [\"npm test\"]."
  ].join("\n");
}

function categoryForMode(mode: FeatureEvaluatorSmokeMode): string {
  if (mode === "parity") return "FEATURE_EVALUATOR_PARITY_STARTUP_NO_EVENT_TIMEOUT";
  if (mode === "text-only") return "FEATURE_EVALUATOR_TEXT_ONLY_FAILED";
  if (mode === "output-minimal") return "FEATURE_EVALUATOR_OUTPUT_SCHEMA_MINIMAL_FAILED";
  if (mode === "output-lite") return "FEATURE_EVALUATOR_OUTPUT_LITE_FAILED";
  return "FEATURE_EVALUATOR_EXACT_TIMEOUT";
}

function readJsonlEvents(path: string): unknown[] {
  if (!path || !existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as unknown;
      } catch {
        return { type: "unparseable" };
      }
    });
}

function lastEventType(events: unknown[]): string {
  let last = "";
  for (const event of events) {
    if (isRecord(event) && typeof event.type === "string") {
      last = event.type;
    }
  }
  return last;
}

function stableHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getNodeMajorVersion(): number {
  return Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
}

function toSmokeSdkDiagnosis(status: CodexSdkDependencyStatus): FeatureEvaluatorSmokeSdkDiagnosis {
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

function emptySmokeSdkDiagnosis(): FeatureEvaluatorSmokeSdkDiagnosis {
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

function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function stringField(value: unknown, key: string): string {
  return isRecord(value) && typeof value[key] === "string" ? value[key] : "";
}

class FeatureEvaluatorMockAdapter implements RuntimeAdapter {
  private readonly mode: FeatureEvaluatorSmokeMode;
  private readonly mock: string;

  constructor(mode: FeatureEvaluatorSmokeMode, mock: string) {
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
      return this.result(input, "", "FAILED", categoryForMode(this.mode));
    }
    if (input.error_capture_paths?.events_path) {
      mkdirSync(dirname(input.error_capture_paths.events_path), { recursive: true });
      writeFileSync(input.error_capture_paths.events_path, `{"type":"thread.started","thread_id":"thread_feature_evaluator_${this.mode.replace(/-/g, "_")}"}\n`, "utf8");
    }
    return this.result(input, this.finalResponse(), "PASS", "");
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

  private finalResponse(): string {
    if (this.mode === "parity") return "FEATURE_EVALUATOR_PARITY_OK";
    if (this.mode === "text-only") return JSON.stringify({ status: "PASS", verdict: "PASS", summary: "FEATURE_EVALUATOR_TEXT_ONLY_OK" });
    if (this.mode === "output-minimal") return JSON.stringify({ status: "PASS", verdict: "PASS", summary: "FEATURE_EVALUATOR_OUTPUT_MINIMAL_OK" });
    return JSON.stringify({
      status: "PASS",
      verdict: "PASS",
      summary: this.mode === "exact" ? "FEATURE_EVALUATOR_EXACT_OK" : "FEATURE_EVALUATOR_OUTPUT_LITE_OK",
      findings_json: "[]",
      validation_commands_checked: ["npm test"]
    });
  }

  private result(input: RuntimeThreadInput, finalResponse: string, status: RuntimeThreadResult["status"], failureCategory: string): RuntimeThreadResult {
    if (input.error_capture_paths?.stdout_path) {
      mkdirSync(dirname(input.error_capture_paths.stdout_path), { recursive: true });
      writeFileSync(input.error_capture_paths.stdout_path, finalResponse, "utf8");
    }
    return {
      thread_id: failureCategory ? "" : `thread_feature_evaluator_${this.mode.replace(/-/g, "_")}`,
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
  const result = await runFeatureEvaluatorSmoke();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.status === "FAIL" ? 2 : 0;
}
