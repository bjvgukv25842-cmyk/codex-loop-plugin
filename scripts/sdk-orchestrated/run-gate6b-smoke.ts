import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

import {
  PLANNER_LITE_STAGE_IMPL,
  runPlannerLiteStage
} from "../../src/orchestrator/sdk-planner-lite-stage.ts";
import {
  DEV_WORKER_STAGE_IMPL,
  runDevWorkerStage
} from "../../src/orchestrator/sdk-dev-worker-stage.ts";
import { buildDevWorkerVsGate6bDiff } from "./diff-dev-worker-vs-gate6b.ts";
import { buildPlannerLiteVsGate6bDiff } from "./diff-planner-lite-vs-gate6b.ts";
import { ensureEvalSqliteHome } from "../../src/runtime/eval-sqlite-home.ts";
import { SdkRuntimeAdapter } from "../../src/runtime/sdk-runtime-adapter.ts";
import type { RuntimeRole, RuntimeThreadInput, RuntimeThreadResult } from "../../src/runtime/runtime-types.ts";

type SmokeStatus =
  | "PASS"
  | "FAIL"
  | "BLOCKED_SDK_NOT_ENABLED"
  | "BLOCKED_SDK_NOT_INSTALLED"
  | "BLOCKED_NODE_VERSION"
  | "BLOCKED_EVAL_SQLITE_HOME_NOT_WRITABLE"
  | "BLOCKED_SDK_SANDBOX_UNVERIFIED"
  | "BLOCKED_MODEL_CATALOG_JSON_MISSING"
  | "BLOCKED_SDK_PROFILE_UNSUPPORTED"
  | "BLOCKED_SDK_CONFIG_OVERRIDE_UNSUPPORTED"
  | "BLOCKED_SDK_PARITY_NOT_PASSED"
  | "BLOCKED_PLANNER_SMOKE_NOT_PASSED"
  | "BLOCKED_PLANNER_SCHEMA_SMOKE_NOT_PASSED"
  | "BLOCKED_PLANNER_LITE_SMOKE_NOT_PASSED"
  | "BLOCKED_PLANNER_STAGE_INVOCATION_DIFF"
  | "BLOCKED_PLANNER_LITE_STAGE_NOT_SHARED"
  | "PLANNER_LITE_STAGE_FAILED_IN_GATE6B"
  | "DEV_WORKER_STAGE_BLOCKED_AFTER_PLANNER_PASS"
  | "BLOCKED_DEV_WORKER_SMOKE_NOT_PASSED"
  | "BLOCKED_DEV_WORKER_STAGE_INVOCATION_DIFF"
  | "DEV_WORKER_STAGE_FAILED_IN_GATE6B"
  | "EVALUATOR_STAGE_BLOCKED_AFTER_DEV_PASS"
  | "BLOCKED_USE_CHECKPOINTED_SMOKE"
  | "CODEX_MODEL_CATALOG_REFRESH_FAILED"
  | "SDK_ADAPTER_INVOCATION_MISMATCH"
  | "THREAD_ID_MISSING";

interface SmokeResult {
  gate: "Gate 6B.1 SDK-Orchestrated Smoke Harness";
  status: SmokeStatus;
  real_sdk_run_executed: boolean;
  sdk_dependency_detected: boolean;
  node_version: string;
  node_version_ok: boolean;
  target_repo: string;
  max_sdk_threads: 3;
  thread_timeout_ms: 180000;
  max_retries: 0;
  env: {
    CODEX_SQLITE_HOME: string;
    CODEX_HOME_overridden: boolean;
  };
  planner_thread_started: boolean;
  dev_worker_thread_started: boolean;
  evaluator_thread_started: boolean;
  planner_thread_id: string;
  dev_worker_thread_id: string;
  evaluator_thread_id: string;
  planner_sandbox: "read-only";
  dev_worker_sandbox: "workspace-write";
  evaluator_sandbox: "read-only";
  prd_artifact_created: boolean;
  task_graph_artifact_created: boolean;
  task_graph_schema_valid: boolean;
  dev_worker_file_change_verified: boolean;
  tests_passed: boolean;
  eval_report_created: boolean;
  eval_verdict: "" | "PASS" | "NEEDS_REVISION";
  artifact_thread_evidence_verified: boolean;
  sdk_sandbox_control: "VERIFIED" | "UNVERIFIED" | "NOT_SUPPORTED";
  failure_category: string;
  planner_stage_shared: boolean;
  planner_stage_impl: string;
  dev_worker_stage_shared: boolean;
  dev_worker_stage_impl: string;
  schema_output_planner_required: boolean;
  sequential_execution_enforced: boolean;
  stage_execution_order: string[];
  danger_full_access_used: false;
  secret_leak_detected: false;
  errors: string[];
}

const repoRoot = process.cwd();
const resultPath = process.env.CODEX_LOOP_GATE6B_SMOKE_RESULT_PATH
  ? resolve(process.env.CODEX_LOOP_GATE6B_SMOKE_RESULT_PATH)
  : resolve(repoRoot, "evals/sdk-orchestrated/reports/gate6b-smoke-result.json");
const targetRepo = process.env.CODEX_LOOP_GATE6B_SMOKE_TARGET_REPO
  ? resolve(process.env.CODEX_LOOP_GATE6B_SMOKE_TARGET_REPO)
  : resolve(repoRoot, "tmp/sdk-orchestrated/gate6b-smoke-target");
const sdkParityResultPath = process.env.CODEX_LOOP_SDK_PARITY_RESULT_PATH
  ? resolve(process.env.CODEX_LOOP_SDK_PARITY_RESULT_PATH)
  : resolve(repoRoot, "evals/sdk-orchestrated/reports/sdk-startup-triage/sdk-parity-smoke-result.json");
const startupTriageDir = process.env.CODEX_LOOP_SDK_STARTUP_TRIAGE_DIR
  ? resolve(process.env.CODEX_LOOP_SDK_STARTUP_TRIAGE_DIR)
  : resolve(repoRoot, "evals/sdk-orchestrated/reports/sdk-startup-triage");

async function main(): Promise<void> {
  if (process.env.CODEX_LOOP_ENABLE_LEGACY_GATE6B_SMOKE !== "1") {
    return finish({
      ...createBaseResult({
        sqliteHomePath: ensureEvalSqliteHome(repoRoot).path,
        sdkDependencyDetected: canResolve("@openai/codex-sdk"),
        nodeVersionOk: getNodeMajorVersion() >= 18
      }),
      status: "BLOCKED_USE_CHECKPOINTED_SMOKE",
      failure_category: "BLOCKED_USE_CHECKPOINTED_SMOKE",
      errors: [
        "Legacy continuous Gate 6B.1 smoke is disabled. Use gate6b:checkpoint:prepare, planner, dev-worker, evaluator, verify, and report."
      ]
    });
  }
  const sqliteHome = ensureEvalSqliteHome(repoRoot);
  const sdkDependencyDetected = canResolve("@openai/codex-sdk");
  const nodeVersionOk = getNodeMajorVersion() >= 18;
  const baseResult = createBaseResult({
    sqliteHomePath: sqliteHome.path,
    sdkDependencyDetected,
    nodeVersionOk
  });

  if (!nodeVersionOk) {
    return finish({
      ...baseResult,
      status: "BLOCKED_NODE_VERSION",
      errors: [`Node.js >= 18 is required; current version is ${process.version}.`]
    });
  }

  if (!sqliteHome.ok) {
    return finish({
      ...baseResult,
      status: "BLOCKED_EVAL_SQLITE_HOME_NOT_WRITABLE",
      errors: [`Eval SQLite home is not usable: ${sqliteHome.reason ?? "unknown"}`]
    });
  }

  if (!sdkParityPassed()) {
    return finish({
      ...baseResult,
      status: "BLOCKED_SDK_PARITY_NOT_PASSED",
      failure_category: "BLOCKED_SDK_PARITY_NOT_PASSED",
      errors: ["SDK parity smoke has not passed. Run exactly one SDK parity smoke before starting planner/dev/evaluator SDK threads."]
    });
  }

  const plannerGate = plannerSmokeGate();
  if (!plannerGate.passed) {
    return finish({
      ...baseResult,
      status: "BLOCKED_PLANNER_LITE_SMOKE_NOT_PASSED",
      failure_category: "BLOCKED_PLANNER_LITE_SMOKE_NOT_PASSED",
      errors: [`Planner smoke prerequisite is incomplete. Missing or non-PASS modes: ${plannerGate.missing.join(", ") || "unknown"}.`]
    });
  }
  const invocationDiff = buildPlannerLiteVsGate6bDiff({ repoRoot, targetRepo, sqliteHome: sqliteHome.path });
  if (invocationDiff.critical_diff_count > 0) {
    return finish({
      ...baseResult,
      status: "BLOCKED_PLANNER_STAGE_INVOCATION_DIFF",
      failure_category: "BLOCKED_PLANNER_STAGE_INVOCATION_DIFF",
      errors: [`Planner lite smoke and Gate 6B planner invocation differ: ${invocationDiff.differences.map((entry) => entry.field).join(", ")}`]
    });
  }
  const devWorkerGate = devWorkerSmokeGate();
  if (!devWorkerGate.passed) {
    return finish({
      ...baseResult,
      status: "BLOCKED_DEV_WORKER_SMOKE_NOT_PASSED",
      failure_category: "BLOCKED_DEV_WORKER_SMOKE_NOT_PASSED",
      errors: [`Dev worker smoke prerequisite is incomplete. Missing or non-PASS modes: ${devWorkerGate.missing.join(", ") || "unknown"}.`]
    });
  }
  const devWorkerDiff = buildDevWorkerVsGate6bDiff({ repoRoot, targetRepo, sqliteHome: sqliteHome.path });
  if (devWorkerDiff.critical_diff_count > 0) {
    return finish({
      ...baseResult,
      status: "BLOCKED_DEV_WORKER_STAGE_INVOCATION_DIFF",
      failure_category: "BLOCKED_DEV_WORKER_STAGE_INVOCATION_DIFF",
      errors: [`Dev worker smoke and Gate 6B dev worker invocation differ: ${devWorkerDiff.differences.map((entry) => entry.field).join(", ")}`]
    });
  }

  if (process.env.CODEX_LOOP_ENABLE_REAL_SDK_RUN !== "1") {
    return finish({
      ...baseResult,
      status: "BLOCKED_SDK_NOT_ENABLED",
      errors: ["Set CODEX_LOOP_ENABLE_REAL_SDK_RUN=1 only for one controlled host-terminal Gate 6B.1 smoke run."]
    });
  }

  if (!sdkDependencyDetected) {
    return finish({
      ...baseResult,
      status: "BLOCKED_SDK_NOT_INSTALLED",
      errors: ["@openai/codex-sdk is not installed or cannot be resolved. Do not auto-install it without explicit user approval."]
    });
  }

  return finish(await runRealOrMockSmoke(baseResult, sqliteHome.path));
}

function createBaseResult(input: { sqliteHomePath: string; sdkDependencyDetected: boolean; nodeVersionOk: boolean }): SmokeResult {
  return {
    gate: "Gate 6B.1 SDK-Orchestrated Smoke Harness",
    status: "FAIL",
    real_sdk_run_executed: false,
    sdk_dependency_detected: input.sdkDependencyDetected,
    node_version: process.version,
    node_version_ok: input.nodeVersionOk,
    target_repo: "tmp/sdk-orchestrated/gate6b-smoke-target",
    max_sdk_threads: 3,
    thread_timeout_ms: 180000,
    max_retries: 0,
    env: {
      CODEX_SQLITE_HOME: input.sqliteHomePath,
      CODEX_HOME_overridden: Boolean(process.env.CODEX_LOOP_EVAL_CODEX_HOME)
    },
    planner_thread_started: false,
    dev_worker_thread_started: false,
    evaluator_thread_started: false,
    planner_thread_id: "",
    dev_worker_thread_id: "",
    evaluator_thread_id: "",
    planner_sandbox: "read-only",
    dev_worker_sandbox: "workspace-write",
    evaluator_sandbox: "read-only",
    prd_artifact_created: false,
    task_graph_artifact_created: false,
    task_graph_schema_valid: false,
    dev_worker_file_change_verified: false,
    tests_passed: false,
    eval_report_created: false,
    eval_verdict: "",
    artifact_thread_evidence_verified: false,
    sdk_sandbox_control: "UNVERIFIED",
    failure_category: "",
    planner_stage_shared: true,
    planner_stage_impl: PLANNER_LITE_STAGE_IMPL,
    dev_worker_stage_shared: true,
    dev_worker_stage_impl: DEV_WORKER_STAGE_IMPL,
    schema_output_planner_required: false,
    sequential_execution_enforced: true,
    stage_execution_order: [],
    danger_full_access_used: false,
    secret_leak_detected: false,
    errors: []
  };
}

function finish(result: SmokeResult): void {
  if (!existsSync(targetRepo)) {
    result.errors.push("Smoke target repo is missing. Run npm run gate6b:smoke:prepare first.");
  }
  mkdirSync(dirname(resultPath), { recursive: true });
  writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.status === "FAIL" ? 2 : 0;
}

function canResolve(specifier: string): boolean {
  if (existsSync(resolve(repoRoot, "node_modules", ...specifier.split("/"), "package.json"))) {
    return true;
  }
  try {
    createRequire(resolve(repoRoot, "package.json")).resolve(specifier);
    return true;
  } catch {
    return false;
  }
}

function getNodeMajorVersion(): number {
  return Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
}

async function runRealOrMockSmoke(baseResult: SmokeResult, sqliteHomePath: string): Promise<SmokeResult> {
  const mockMode = process.env.CODEX_LOOP_GATE6B_SMOKE_MOCK;
  const mockSdk = mockMode && mockMode.length > 0 ? createMockSdkModule(mockMode) : null;
  const adapter =
    mockSdk
      ? new SdkRuntimeAdapter({
          enableRealRun: true,
          sdkResolver: async () => mockSdk
        })
      : new SdkRuntimeAdapter({ enableRealRun: true });

  const env = {
    CODEX_SQLITE_HOME: sqliteHomePath
  };
  const plannerStage = await runPlannerLiteStage({
    loop_run_id: "loop_gate6b_smoke",
    task_id: "task_validate_project_name",
    target_repo: targetRepo,
    model: process.env.CODEX_LOOP_CODEX_MODEL,
    model_catalog_json: process.env.CODEX_LOOP_MODEL_CATALOG_JSON,
    sqlite_home: sqliteHomePath,
    sandbox: "read-only",
    timeout_ms: 180_000,
    runtime_adapter: adapter,
    repo_root: repoRoot,
    report_dir: startupTriageDir,
    invocation_trace_path: resolve(startupTriageDir, "gate6b-smoke-planner-invocation-trace-redacted.json"),
    invocation_trace_label: "gate6b-smoke-planner",
    events_path: resolve(startupTriageDir, "gate6b-smoke-planner-events.jsonl"),
    stdout_path: resolve(startupTriageDir, "gate6b-smoke-planner-stdout.log"),
    stderr_path: resolve(startupTriageDir, "gate6b-smoke-planner-stderr.log"),
    result_path: resultPath
  });
  const afterPlanner: SmokeResult = {
    ...baseResult,
    stage_execution_order: [...baseResult.stage_execution_order, "planner-lite"],
    planner_thread_started: plannerStage.planner_thread_started,
    planner_thread_id: plannerStage.planner_thread_id,
    prd_artifact_created: plannerStage.prd_artifact_created,
    task_graph_artifact_created: plannerStage.task_graph_artifact_created,
    task_graph_schema_valid: plannerStage.task_graph_schema_valid,
    artifact_thread_evidence_verified: plannerStage.artifact_thread_evidence_verified,
    errors: [...baseResult.errors, ...plannerStage.errors]
  };
  if (plannerStage.status !== "PASS") {
    if (plannerStage.failure_category === "THREAD_ID_MISSING") {
      return {
        ...afterPlanner,
        status: "THREAD_ID_MISSING",
        failure_category: "THREAD_ID_MISSING"
      };
    }
    return {
      ...afterPlanner,
      status: "PLANNER_LITE_STAGE_FAILED_IN_GATE6B",
      failure_category: plannerStage.failure_category || "PLANNER_LITE_STAGE_FAILED_IN_GATE6B"
    };
  }
  if (!plannerStage.artifact_thread_evidence_verified) {
    return {
      ...afterPlanner,
      status: "BLOCKED_PLANNER_LITE_STAGE_NOT_SHARED",
      failure_category: "BLOCKED_PLANNER_LITE_STAGE_NOT_SHARED",
      errors: [...afterPlanner.errors, "Planner lite stage did not produce verified artifacts."]
    };
  }

  const devWorkerStage = await runDevWorkerStage({
    loop_run_id: "loop_gate6b_smoke",
    task_id: "task_validate_project_name",
    target_repo: targetRepo,
    prd_path: "docs/PRD.md",
    task_graph_path: "docs/TASK_GRAPH.json",
    model: process.env.CODEX_LOOP_CODEX_MODEL,
    model_catalog_json: process.env.CODEX_LOOP_MODEL_CATALOG_JSON,
    sqlite_home: sqliteHomePath,
    sandbox: "workspace-write",
    timeout_ms: 180_000,
    runtime_adapter: adapter,
    repo_root: repoRoot,
    report_dir: startupTriageDir,
    invocation_trace_path: resolve(startupTriageDir, "gate6b-smoke-dev-worker-invocation-trace-redacted.json"),
    invocation_trace_label: "gate6b-smoke-dev-worker",
    events_path: resolve(startupTriageDir, "gate6b-smoke-dev-worker-events.jsonl"),
    stdout_path: resolve(startupTriageDir, "gate6b-smoke-dev-worker-stdout.log"),
    stderr_path: resolve(startupTriageDir, "gate6b-smoke-dev-worker-stderr.log"),
    result_path: resultPath
  });
  const afterDev: SmokeResult = {
    ...afterPlanner,
    stage_execution_order: [...afterPlanner.stage_execution_order, "dev_worker"],
    dev_worker_thread_started: devWorkerStage.dev_worker_thread_started,
    dev_worker_thread_id: devWorkerStage.dev_worker_thread_id,
    dev_worker_file_change_verified: devWorkerStage.file_change_verified,
    tests_passed: devWorkerStage.tests_passed,
    artifact_thread_evidence_verified: afterPlanner.artifact_thread_evidence_verified && devWorkerStage.artifact_thread_evidence_verified,
    errors: [...afterPlanner.errors, ...devWorkerStage.errors]
  };
  if (devWorkerStage.status !== "PASS") {
    const failure = devWorkerStage.failure_category === "THREAD_ID_MISSING" ? "DEV_WORKER_THREAD_STARTUP_FAILURE" : devWorkerStage.failure_category || "DEV_WORKER_STAGE_FAILED_IN_GATE6B";
    return {
      ...afterDev,
      status: "DEV_WORKER_STAGE_FAILED_IN_GATE6B",
      failure_category: failure
    };
  }

  if (!afterDev.dev_worker_file_change_verified || !afterDev.tests_passed) {
    return {
      ...afterDev,
      status: "DEV_WORKER_STAGE_BLOCKED_AFTER_PLANNER_PASS",
      failure_category: afterDev.dev_worker_file_change_verified ? "DEV_WORKER_TESTS_FAILED" : "DEV_WORKER_NO_FILE_CHANGE",
      errors: [
        ...afterDev.errors,
        afterDev.dev_worker_file_change_verified ? "Dev worker did not provide passing test evidence." : "Dev worker file change was not verified."
      ]
    };
  }

  const evaluator = await adapter.runThread(runtimeInput("evaluator", buildEvaluatorPrompt(), "read-only", env));
  const afterEval = applyThreadResult(
    {
      ...afterDev,
      stage_execution_order: [...afterDev.stage_execution_order, "evaluator"]
    },
    "evaluator",
    evaluator
  );
  if (!canContinue(afterEval, evaluator)) {
    return {
      ...afterEval,
      status: afterEval.status === "FAIL" ? "EVALUATOR_STAGE_BLOCKED_AFTER_DEV_PASS" : afterEval.status,
      failure_category: afterEval.failure_category || "EVALUATOR_STAGE_BLOCKED_AFTER_DEV_PASS"
    };
  }
  afterEval.eval_report_created = Boolean(evaluator.final_response);
  afterEval.eval_verdict = parseVerdict(evaluator.final_response);
  persistEvalArtifact(evaluator);

  afterEval.artifact_thread_evidence_verified =
    Boolean(afterEval.planner_thread_id) &&
    Boolean(afterEval.dev_worker_thread_id) &&
    Boolean(afterEval.evaluator_thread_id) &&
    afterEval.prd_artifact_created &&
    afterEval.task_graph_artifact_created &&
    afterEval.eval_report_created;

  if (afterEval.sdk_sandbox_control !== "VERIFIED") {
    return {
      ...afterEval,
      status: "BLOCKED_SDK_SANDBOX_UNVERIFIED",
      failure_category: "SDK_SANDBOX_CONTROL_UNVERIFIED",
      errors: [...afterEval.errors, "SDK sandbox control is not verified; Gate 6B.1 cannot PASS."]
    };
  }

  if (!afterEval.tests_passed) {
    return {
      ...afterEval,
      status: "FAIL",
      failure_category: "TESTS_FAILED",
      errors: [...afterEval.errors, "Dev worker did not provide passing test evidence."]
    };
  }

  if (afterEval.eval_verdict !== "PASS") {
    return {
      ...afterEval,
      status: "FAIL",
      failure_category: "EVAL_VERDICT_NOT_PASS",
      errors: [...afterEval.errors, "Evaluator verdict is not PASS."]
    };
  }

  if (!afterEval.dev_worker_file_change_verified) {
    return {
      ...afterEval,
      status: "FAIL",
      failure_category: "DEV_WORKER_FILE_CHANGE_MISSING",
      errors: [...afterEval.errors, "Dev worker file change was not verified."]
    };
  }

  return {
    ...afterEval,
    status: "PASS",
    real_sdk_run_executed: mockMode ? false : true,
    failure_category: "",
    errors: afterEval.errors
  };
}

function runtimeInput(role: RuntimeRole, prompt: string, sandbox: RuntimeThreadInput["sandbox"], env: Record<string, string>): RuntimeThreadInput {
  return {
    role,
    loop_run_id: "loop_gate6b_smoke",
    task_id: "task_validate_project_name",
    prompt,
    sandbox,
    working_directory: targetRepo,
    timeout_ms: 180_000,
    output_schema_path: "",
    output_schema: smokeOutputSchema(role),
    codex_profile: process.env.CODEX_LOOP_CODEX_PROFILE,
    codex_model: process.env.CODEX_LOOP_CODEX_MODEL,
    model_catalog_json: process.env.CODEX_LOOP_MODEL_CATALOG_JSON,
    codex_config_overrides: {},
    invocation_trace_path: resolve(startupTriageDir, `gate6b-smoke-${role}-invocation-trace-redacted.json`),
    invocation_trace_label: `gate6b-smoke-${role}`,
    error_capture_paths: {
      result_path: resultPath
    },
    env
  };
}

function applyThreadResult(result: SmokeResult, role: RuntimeRole, threadResult: RuntimeThreadResult): SmokeResult {
  const next = {
    ...result,
    sdk_sandbox_control: mergeSandboxControl(result.sdk_sandbox_control, threadResult.sandbox_control ?? "UNVERIFIED"),
    errors: [...result.errors, ...threadResult.errors]
  };
  if (threadResult.errors.some((error) => error.includes("THREAD_ID_MISSING") || error.includes("thread_id"))) {
    next.status = "THREAD_ID_MISSING";
    next.failure_category = "THREAD_ID_MISSING";
  }
  if (!threadResult.thread_id && threadResult.status !== "BLOCKED") {
    next.status = "THREAD_ID_MISSING";
    next.failure_category = "THREAD_ID_MISSING";
  }
  if (role === "planner") {
    next.planner_thread_started = Boolean(threadResult.thread_id);
    next.planner_thread_id = threadResult.thread_id;
  }
  if (role === "dev_worker") {
    next.dev_worker_thread_started = Boolean(threadResult.thread_id);
    next.dev_worker_thread_id = threadResult.thread_id;
  }
  if (role === "evaluator") {
    next.evaluator_thread_started = Boolean(threadResult.thread_id);
    next.evaluator_thread_id = threadResult.thread_id;
  }
  if (threadResult.status === "BLOCKED" && next.status !== "THREAD_ID_MISSING") {
    if (threadResult.failure_category === "BLOCKED_MODEL_CATALOG_JSON_MISSING") {
      next.status = "BLOCKED_MODEL_CATALOG_JSON_MISSING";
      next.failure_category = "BLOCKED_MODEL_CATALOG_JSON_MISSING";
    } else if (threadResult.failure_category === "BLOCKED_SDK_PROFILE_UNSUPPORTED") {
      next.status = "BLOCKED_SDK_PROFILE_UNSUPPORTED";
      next.failure_category = "BLOCKED_SDK_PROFILE_UNSUPPORTED";
    } else if (threadResult.failure_category === "BLOCKED_SDK_CONFIG_OVERRIDE_UNSUPPORTED") {
      next.status = "BLOCKED_SDK_CONFIG_OVERRIDE_UNSUPPORTED";
      next.failure_category = "BLOCKED_SDK_CONFIG_OVERRIDE_UNSUPPORTED";
    } else if (threadResult.failure_category === "CODEX_MODEL_CATALOG_REFRESH_FAILED") {
      next.status = "CODEX_MODEL_CATALOG_REFRESH_FAILED";
      next.failure_category = "CODEX_MODEL_CATALOG_REFRESH_FAILED";
    } else if (threadResult.failure_category === "SDK_ADAPTER_INVOCATION_MISMATCH") {
      next.status = "SDK_ADAPTER_INVOCATION_MISMATCH";
      next.failure_category = "SDK_ADAPTER_INVOCATION_MISMATCH";
    } else {
      next.status = threadResult.errors.some((error) => error.includes("@openai/codex-sdk is not installed")) ? "BLOCKED_SDK_NOT_INSTALLED" : "FAIL";
      next.failure_category = next.status === "BLOCKED_SDK_NOT_INSTALLED" ? "BLOCKED_SDK_NOT_INSTALLED" : "SDK_THREAD_BLOCKED";
    }
  }
  if (threadResult.status === "FAILED" || threadResult.status === "TIMEOUT") {
    next.status = "FAIL";
    next.failure_category = threadResult.status === "TIMEOUT" ? "SDK_THREAD_TIMEOUT" : (threadResult.failure_category ?? "SDK_THREAD_FAILED");
  }
  return next;
}

function sdkParityPassed(): boolean {
  if (!existsSync(sdkParityResultPath)) {
    return false;
  }
  try {
    const result = JSON.parse(readFileSync(sdkParityResultPath, "utf8")) as Record<string, unknown>;
    return (
      result.status === "PASS" &&
      result.sdk_thread_started === true &&
      typeof result.sdk_thread_id === "string" &&
      result.sdk_thread_id.length > 0 &&
      result.final_response_contains_expected === true
    );
  } catch {
    return false;
  }
}

function plannerSmokeGate(): { passed: boolean; missing: string[] } {
  const missing: string[] = [];
  for (const mode of ["parity-as-planner", "minimal", "schema-text-only", "schema-output-minimal", "schema-output-lite"]) {
    if (!plannerSmokePassed(resolve(startupTriageDir, `planner-smoke-${mode}-result.json`))) {
      missing.push(mode);
    }
  }
  return {
    passed: missing.length === 0,
    missing
  };
}

function plannerSmokePassed(path: string): boolean {
  if (!existsSync(path)) {
    return false;
  }
  try {
    const result = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    return (
      result.status === "PASS" &&
      result.planner_thread_started === true &&
      typeof result.planner_thread_id === "string" &&
      result.planner_thread_id.length > 0
    );
  } catch {
    return false;
  }
}

function devWorkerSmokeGate(): { passed: boolean; missing: string[] } {
  const missing: string[] = [];
  for (const mode of ["parity", "minimal-fix", "output-lite"]) {
    if (!devWorkerSmokePassed(resolve(startupTriageDir, `dev-worker-smoke-${mode}-result.json`), mode)) {
      missing.push(mode);
    }
  }
  return {
    passed: missing.length === 0,
    missing
  };
}

function devWorkerSmokePassed(path: string, mode: string): boolean {
  if (!existsSync(path)) {
    return false;
  }
  try {
    const result = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    const basePass =
      result.status === "PASS" &&
      result.dev_worker_thread_started === true &&
      typeof result.dev_worker_thread_id === "string" &&
      result.dev_worker_thread_id.length > 0;
    if (!basePass) {
      return false;
    }
    if (mode === "parity") {
      return result.final_response_contains_expected === true;
    }
    if (mode === "minimal-fix") {
      return result.initial_tests_failed === true && result.file_change_verified === true && result.tests_passed === true;
    }
    return (
      result.initial_tests_failed === true &&
      result.structured_output_valid === true &&
      result.file_change_verified === true &&
      result.tests_passed === true &&
      result.dev_worker_stage_shared === true &&
      result.dev_worker_stage_impl === DEV_WORKER_STAGE_IMPL
    );
  } catch {
    return false;
  }
}

function canContinue(result: SmokeResult, threadResult: RuntimeThreadResult): boolean {
  return result.status === "FAIL" && result.failure_category === "" && Boolean(threadResult.thread_id);
}

function persistPlannerArtifacts(planner: RuntimeThreadResult): void {
  const parsed = parseJsonObject(planner.final_response);
  writeTargetText("artifacts/planner-result.json", JSON.stringify(withMetadata(parsed, "planner", planner.thread_id), null, 2));
  writeTargetText("docs/PRD.md", `# Gate 6B Smoke PRD\n\n${JSON.stringify(parsed.prd ?? parsed, null, 2)}\n`);
  writeTargetText("docs/TASK_GRAPH.json", JSON.stringify(withMetadata(toRecord(parsed.task_graph), "planner", planner.thread_id), null, 2));
}

function persistDevArtifact(devWorker: RuntimeThreadResult): void {
  writeTargetText("artifacts/dev-result.json", JSON.stringify(withMetadata(parseJsonObject(devWorker.final_response), "dev_worker", devWorker.thread_id), null, 2));
}

function persistEvalArtifact(evaluator: RuntimeThreadResult): void {
  writeTargetText("artifacts/eval-report.json", JSON.stringify(withMetadata(parseJsonObject(evaluator.final_response), "evaluator", evaluator.thread_id), null, 2));
}

function withMetadata(value: Record<string, unknown>, role: RuntimeRole, threadId: string): Record<string, unknown> {
  return {
    ...value,
    created_by_runtime: "sdk-orchestrated",
    created_by_role: role,
    created_by_thread_id: threadId
  };
}

function writeTargetText(path: string, value: string): void {
  const absolute = resolve(targetRepo, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, `${value.trim()}\n`, "utf8");
}

function readTargetSource(): string {
  try {
    return readFileSync(resolve(targetRepo, "src/project-name.js"), "utf8");
  } catch {
    return "";
  }
}

function parseJsonObject(text: string): Record<string, unknown> {
  try {
    const value = JSON.parse(text) as unknown;
    return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function parseBooleanField(text: string, field: string): boolean {
  const parsed = parseJsonObject(text);
  return parsed[field] === true;
}

function parseVerdict(text: string): "" | "PASS" | "NEEDS_REVISION" {
  const parsed = parseJsonObject(text);
  return parsed.verdict === "PASS" || parsed.eval_verdict === "PASS"
    ? "PASS"
    : parsed.verdict === "NEEDS_REVISION" || parsed.eval_verdict === "NEEDS_REVISION"
      ? "NEEDS_REVISION"
      : "";
}

function mergeSandboxControl(current: SmokeResult["sdk_sandbox_control"], next: SmokeResult["sdk_sandbox_control"]): SmokeResult["sdk_sandbox_control"] {
  if (current === "NOT_SUPPORTED" || next === "NOT_SUPPORTED") return "NOT_SUPPORTED";
  if (current === "UNVERIFIED" && next === "VERIFIED") return "VERIFIED";
  if (current === "UNVERIFIED" || next === "UNVERIFIED") return "UNVERIFIED";
  return "VERIFIED";
}

function smokeOutputSchema(role: RuntimeRole): unknown {
  return {
    type: "object",
    properties: {
      status: { type: "string" },
      role: { const: role },
      tests_passed: { type: "boolean" },
      verdict: { type: "string" }
    },
    required: ["status", "role"],
    additionalProperties: true
  };
}

function buildPlannerPrompt(): string {
  return [
    "$codex-loop SDK-Orchestrated Smoke",
    "Role: planner",
    "Return JSON with status PASS, role planner, prd, task_graph, acceptance_criteria, risks.",
    "Do not write files directly."
  ].join("\n");
}

function buildDevWorkerPrompt(): string {
  return [
    "$codex-loop SDK-Orchestrated Smoke",
    "Role: dev_worker",
    "Modify src/project-name.js so validateProjectName rejects empty, whitespace-only, and >80 char names, accepts valid names, then run npm test.",
    "Return JSON with status PASS, role dev_worker, changed_files, validation_commands, tests_passed."
  ].join("\n");
}

function buildEvaluatorPrompt(): string {
  return [
    "$codex-loop SDK-Orchestrated Smoke",
    "Role: evaluator",
    "Read PRD, TaskGraph, source, and test evidence. Do not modify files.",
    "Return JSON with status PASS, role evaluator, verdict PASS or NEEDS_REVISION, findings."
  ].join("\n");
}

interface MockThreadLike {
  readonly id: string | null;
  run(input: string, options?: unknown): Promise<unknown>;
  runStreamed(input: string, options?: unknown): Promise<{ events: AsyncGenerator<unknown> }>;
}

interface MockCodexLike {
  startThread(options?: unknown): MockThreadLike;
  resumeThread(id?: string, options?: unknown): MockThreadLike;
}

function createMockSdkModule(mode: string): { Codex: new (options?: unknown) => MockCodexLike } {
  const threadIds = ["thread_planner_mock", "thread_dev_mock", "thread_eval_mock"];
  let index = 0;
  class MockThread {
    readonly id: string | null;
    private readonly threadIndex: number;

    constructor(threadIndex: number) {
      this.threadIndex = threadIndex;
      this.id = mode === "missing-thread" ? null : threadIds[threadIndex] ?? `thread_mock_${threadIndex}`;
    }
    async run(input: string): Promise<unknown> {
      return mockTurn(input, mode, this.threadIndex);
    }
    async runStreamed(input: string): Promise<{ events: AsyncGenerator<unknown> }> {
      const id = this.id;
      const turn = mockTurn(input, mode, this.threadIndex) as { finalResponse: string };
      async function* events(): AsyncGenerator<unknown> {
        if (id) {
          yield { type: "thread.started", thread_id: id };
        }
        yield { type: "turn.started" };
        yield { type: "item.completed", item: { id: `item_${id ?? "missing"}`, type: "agent_message", text: turn.finalResponse } };
        yield { type: "turn.completed", usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1, reasoning_output_tokens: 0 } };
      }
      return { events: events() };
    }
  }
  class MockCodex {
    startThread(): MockThread {
      return new MockThread(index++);
    }
    resumeThread(): MockThread {
      return new MockThread(index++);
    }
  }
  return { Codex: MockCodex };
}

function mockTurn(input: string, mode: string, index: number): unknown {
  if (mode === "sdk-missing") {
    throw new Error("Cannot find package '@openai/codex-sdk'");
  }
  if (/Role: planner|planner-lite|prd_markdown|task_graph_json/i.test(input) || (index === 0 && !/Role: dev_worker|Role: evaluator/i.test(input))) {
    return {
      finalResponse: JSON.stringify({
        status: "PASS",
        prd_markdown: "# Gate 6B Smoke PRD\n\nValidate project names.",
        task_graph_json: readFileSync(resolve(repoRoot, "tests/fixtures/valid/task-graph.json"), "utf8"),
        acceptance_criteria: ["empty rejected", "whitespace rejected", "long names rejected", "valid names accepted"],
        risks: []
      })
    };
  }
  if (/Role: dev_worker|DevResult lite|changed_files must include src\/project-name\.js/i.test(input) || index === 1) {
    writeFixedSource();
    return {
      finalResponse: JSON.stringify({
        status: "PASS",
        changed_files: ["src/project-name.js"],
        tests_run: ["npm test"],
        tests_passed: mode !== "tests-failed",
        summary: "Fixed validateProjectName and tests pass."
      })
    };
  }
  return {
    finalResponse: JSON.stringify({
      status: mode === "needs-revision" ? "NEEDS_REVISION" : "PASS",
      role: "evaluator",
      verdict: mode === "needs-revision" ? "NEEDS_REVISION" : "PASS",
      findings: mode === "needs-revision" ? [{ severity: "high", description: "Mock gap" }] : []
    })
  };
}

function toRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function writeFixedSource(): void {
  writeTargetText(
    "src/project-name.js",
    [
      "export function validateProjectName(name) {",
      "  if (typeof name !== \"string\") return { ok: false, reason: \"name must be a string\" };",
      "  if (name.trim().length === 0) return { ok: false, reason: \"name is required\" };",
      "  if (name.length > 80) return { ok: false, reason: \"name is too long\" };",
      "  return { ok: true };",
      "}"
    ].join("\n")
  );
}

main().catch((error: unknown) => {
  const result = createBaseResult({
    sqliteHomePath: resolve(repoRoot, ".codex-eval/sqlite"),
    sdkDependencyDetected: canResolve("@openai/codex-sdk"),
    nodeVersionOk: getNodeMajorVersion() >= 18
  });
  finish({
    ...result,
    status: "FAIL",
    failure_category: "UNHANDLED_ERROR",
    errors: [error instanceof Error ? error.message : String(error)]
  });
});
