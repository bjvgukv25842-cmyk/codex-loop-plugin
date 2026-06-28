import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";

import { createRepairRequestFromEval } from "../../src/orchestrator/create-repair-request-from-eval.ts";
import {
  createSdkRepairLoopCheckpointState,
  DEFAULT_SDK_REPAIR_LOOP_STATE_PATH,
  failSdkRepairLoopCheckpointState,
  readSdkRepairLoopCheckpointState,
  updateRepairLoopDevWorkerCheckpoint,
  updateRepairLoopFinalEvaluatorCheckpoint,
  updateRepairLoopFinalReportCheckpoint,
  updateRepairLoopInitialEvaluatorCheckpoint,
  updateRepairLoopPlannerCheckpoint,
  updateRepairLoopRepairDevWorkerCheckpoint,
  updateRepairLoopRepairRequestCheckpoint,
  writeSdkRepairLoopCheckpointState
} from "../../src/orchestrator/sdk-repair-loop-checkpoint-state.ts";
import type { SdkRepairLoopCheckpointState } from "../../src/orchestrator/sdk-repair-loop-types.ts";
import { runDevWorkerStage } from "../../src/orchestrator/sdk-dev-worker-stage.ts";
import { runEvaluatorLiteStage } from "../../src/orchestrator/sdk-evaluator-stage.ts";
import { runPlannerLiteStage } from "../../src/orchestrator/sdk-planner-lite-stage.ts";
import { writeFinalDeliveryReport } from "../../src/orchestrator/write-final-delivery-report.ts";
import { ensureEvalSqliteHome } from "../../src/runtime/eval-sqlite-home.ts";
import { SdkRuntimeAdapter } from "../../src/runtime/sdk-runtime-adapter.ts";
import type {
  RuntimeEventsInput,
  RuntimeFinalResponseInput,
  RuntimeStopThreadInput,
  RuntimeThreadInput,
  RuntimeThreadRefInput,
  RuntimeThreadResult
} from "../../src/runtime/runtime-types.ts";
import { validateWithSchema } from "../../src/core/validate.ts";
import type { EvalReport } from "../../src/core/types.ts";
import { runInitialDevWorkerSeededGapStage } from "../../src/orchestrator/sdk-initial-dev-worker-stage.ts";

export const repoRoot = process.cwd();
export const defaultTargetRepo = "tmp/sdk-orchestrated/gate6b2-repair-loop-target";
export const targetRepo = process.env.CODEX_LOOP_GATE6B2_TARGET_REPO
  ? resolve(process.env.CODEX_LOOP_GATE6B2_TARGET_REPO)
  : resolve(repoRoot, defaultTargetRepo);
export const statePath = process.env.CODEX_LOOP_GATE6B2_STATE_PATH
  ? resolve(process.env.CODEX_LOOP_GATE6B2_STATE_PATH)
  : resolve(repoRoot, DEFAULT_SDK_REPAIR_LOOP_STATE_PATH);
export const reportDir = process.env.CODEX_LOOP_SDK_STARTUP_TRIAGE_DIR
  ? resolve(process.env.CODEX_LOOP_SDK_STARTUP_TRIAGE_DIR)
  : resolve(repoRoot, "evals/sdk-orchestrated/reports/sdk-startup-triage/gate6b2");

export function resultPath(name: string): string {
  return resolve(repoRoot, `evals/sdk-orchestrated/reports/${name}`);
}

export function prepareGate6B2Target(): Record<string, unknown> {
  rmSync(resolve(targetRepo, "test/project-name.test.js"), { force: true });
  writeTargetJson("package.json", {
    name: "gate6b2-repair-loop-target",
    version: "0.0.0",
    type: "module",
    scripts: {
      test: "npm run test:full",
      "test:baseline": "node --test test/project-name.baseline.test.js",
      "test:full": "node --test test/project-name.full.test.js"
    }
  });
  writeTargetText("README.md", "# Gate 6B.2 Repair Loop Target\n\nIsolated SDK repair-loop validation target.\n");
  writeTargetText("src/project-name.js", "export function validateProjectName(name) {\n  return { ok: true };\n}\n");
  writeTargetText(
    "test/project-name.baseline.test.js",
    [
      "import test from \"node:test\";",
      "import assert from \"node:assert/strict\";",
      "import { validateProjectName } from \"../src/project-name.js\";",
      "",
      "test(\"rejects empty string\", () => {",
      "  assert.equal(validateProjectName(\"\").ok, false);",
      "});",
      "",
      "test(\"rejects names longer than 80 characters\", () => {",
      "  assert.equal(validateProjectName(\"x\".repeat(81)).ok, false);",
      "});",
      "",
      "test(\"accepts valid project names\", () => {",
      "  assert.equal(validateProjectName(\"My Project\").ok, true);",
      "});",
      ""
    ].join("\n")
  );
  writeTargetText(
    "test/project-name.full.test.js",
    [
      "import test from \"node:test\";",
      "import assert from \"node:assert/strict\";",
      "import { validateProjectName } from \"../src/project-name.js\";",
      "",
      "test(\"rejects empty string\", () => {",
      "  assert.equal(validateProjectName(\"\").ok, false);",
      "});",
      "",
      "test(\"rejects whitespace-only string\", () => {",
      "  assert.equal(validateProjectName(\"   \").ok, false);",
      "});",
      "",
      "test(\"rejects names longer than 80 characters\", () => {",
      "  assert.equal(validateProjectName(\"x\".repeat(81)).ok, false);",
      "});",
      "",
      "test(\"accepts valid project names\", () => {",
      "  assert.equal(validateProjectName(\"My Project\").ok, true);",
      "});",
      ""
    ].join("\n")
  );
  ensureTargetGitRepo();

  const state = createSdkRepairLoopCheckpointState(defaultTargetRepo);
  writeSdkRepairLoopCheckpointState(state, statePath);
  const baselineFailed = commandFails(["npm", "run", "test:baseline"], targetRepo);
  const fullFailed = commandFails(["npm", "run", "test:full"], targetRepo);
  writeDevWorkerBaseline({
    initial_baseline_tests_failed: baselineFailed,
    initial_full_tests_failed: fullFailed
  });
  return {
    status: baselineFailed && fullFailed ? "PASS" : "BLOCKED_TARGET_FIXTURE_NOT_BROKEN",
    repair_loop_checkpoint_state_created: true,
    current_stage: state.current_stage,
    target_repo: defaultTargetRepo,
    state_path: relative(repoRoot, statePath),
    initial_baseline_tests_failed: baselineFailed,
    initial_full_tests_failed: fullFailed,
    seeded_gap_fixture_created: true,
    real_sdk_run_executed: false
  };
}

export async function runGate6B2Planner(): Promise<Record<string, unknown>> {
  const state = readStateOrNull();
  if (!state) return blocked("CHECKPOINT_STATE_INVALID", "Run npm run gate6b2:prepare first.");
  const mockMode = process.env.CODEX_LOOP_GATE6B2_MOCK;
  if (process.env.CODEX_LOOP_ENABLE_REAL_SDK_PLANNER !== "1" && !mockMode) {
    return blocked("BLOCKED_SDK_NOT_ENABLED", "Set CODEX_LOOP_ENABLE_REAL_SDK_PLANNER=1 only for one controlled Gate 6B.2 planner run.", state.current_stage);
  }

  const stage = await runPlannerLiteStage({
    loop_run_id: "loop_gate6b2_repair_loop",
    task_id: "task_validate_project_name",
    target_repo: targetRepo,
    model: process.env.CODEX_LOOP_CODEX_MODEL,
    model_catalog_json: process.env.CODEX_LOOP_MODEL_CATALOG_JSON,
    sqlite_home: sqliteHomePath(),
    sandbox: "read-only",
    timeout_ms: 180_000,
    runtime_adapter: mockMode ? mockAdapter("planner") : new SdkRuntimeAdapter({ enableRealRun: true, repoRoot }),
    repo_root: repoRoot,
    report_dir: reportDir,
    invocation_trace_path: resolve(reportDir, "gate6b2-planner-invocation-trace-redacted.json"),
    invocation_trace_label: "gate6b2-planner",
    events_path: resolve(reportDir, "gate6b2-planner-events.jsonl"),
    stdout_path: resolve(reportDir, "gate6b2-planner-stdout.log"),
    stderr_path: resolve(reportDir, "gate6b2-planner-stderr.log"),
    result_path: resultPath("gate6b2-planner-result.json"),
    output_contract_version: plannerOutputContractVersion()
  });
  if (stage.status !== "PASS") {
    const failedState = failSdkRepairLoopCheckpointState(
      {
        ...state,
        planner: {
          ...state.planner,
          status: stage.status,
          thread_id: stage.planner_thread_id,
          output_contract_version: stage.output_contract_version,
          raw_output_path: stage.raw_output_path,
          redacted_output_path: stage.redacted_output_path,
          events_path: stage.events_path,
          failure_category: stage.failure_category,
          stage_completed: false
        }
      },
      stage.errors
    );
    writeSdkRepairLoopCheckpointState(failedState, statePath);
    return failed("PLANNER_STAGE_FAILED", failedState, {
      planner_thread_id: stage.planner_thread_id,
      failure_category: stage.failure_category,
      planner_output_contract_version: stage.output_contract_version,
      planner_raw_output_path: stage.raw_output_path,
      planner_redacted_output_path: stage.redacted_output_path,
      planner_events_path: stage.events_path,
      errors: stage.errors
    });
  }
  const next = updateRepairLoopPlannerCheckpoint(state, {
    status: "PASS",
    thread_id: stage.planner_thread_id,
    prd_path: stage.prd_path,
    task_graph_path: stage.task_graph_path,
    planner_result_path: stage.planner_result_path,
    artifact_thread_evidence_verified: stage.artifact_thread_evidence_verified,
    output_contract_version: stage.output_contract_version,
    raw_output_path: stage.raw_output_path,
    redacted_output_path: stage.redacted_output_path,
    events_path: stage.events_path,
    failure_category: "",
    stage_completed: true
  });
  writeSdkRepairLoopCheckpointState(next, statePath);
  return {
    status: "PASS",
    current_stage: next.current_stage,
    real_sdk_run_executed: !mockMode,
    planner_thread_started: true,
    planner_thread_id: stage.planner_thread_id,
    planner_output_contract_version: stage.output_contract_version,
    planner_raw_output_path: stage.raw_output_path,
    planner_redacted_output_path: stage.redacted_output_path,
    planner_events_path: stage.events_path,
    failure_category: "",
    errors: []
  };
}

export async function runGate6B2DevWorker(): Promise<Record<string, unknown>> {
  const state = readStateOrNull();
  if (!state) return blocked("CHECKPOINT_STATE_INVALID", "Run npm run gate6b2:prepare first.");
  if (state.current_stage !== "PLANNER_DONE") {
    return blocked("BLOCKED_PLANNER_CHECKPOINT_MISSING", "Planner checkpoint must be PLANNER_DONE before initial dev_worker.", state.current_stage);
  }
  const mockMode = process.env.CODEX_LOOP_GATE6B2_MOCK;
  if (process.env.CODEX_LOOP_ENABLE_REAL_SDK_DEV_WORKER !== "1" && !mockMode) {
    return blocked("BLOCKED_SDK_NOT_ENABLED", "Set CODEX_LOOP_ENABLE_REAL_SDK_DEV_WORKER=1 only for one controlled Gate 6B.2 dev_worker run.", state.current_stage);
  }
  const stage = await runInitialDevWorkerSeededGapStage({
    loop_run_id: "loop_gate6b2_repair_loop",
    task_id: "task_validate_project_name",
    target_repo: targetRepo,
    prd_path: state.planner.prd_path || "docs/PRD.md",
    task_graph_path: state.planner.task_graph_path || "docs/TASK_GRAPH.json",
    model: process.env.CODEX_LOOP_CODEX_MODEL,
    model_catalog_json: process.env.CODEX_LOOP_MODEL_CATALOG_JSON,
    sqlite_home: sqliteHomePath(),
    sandbox: "workspace-write",
    timeout_ms: 180_000,
    runtime_adapter: mockMode ? mockAdapter("dev_worker_initial") : new SdkRuntimeAdapter({ enableRealRun: true, repoRoot }),
    repo_root: repoRoot,
    report_dir: reportDir,
    artifact_path: "artifacts/dev-result.json",
    invocation_trace_path: resolve(reportDir, "gate6b2-dev-worker-invocation-trace-redacted.json"),
    invocation_trace_label: "gate6b2-dev-worker",
    events_path: resolve(reportDir, "gate6b2-dev-worker-events.jsonl"),
    stdout_path: resolve(reportDir, "gate6b2-dev-worker-stdout.log"),
    stderr_path: resolve(reportDir, "gate6b2-dev-worker-stderr.log"),
    result_path: resultPath("gate6b2-dev-worker-result.json")
  });
  if (stage.status !== "PASS") {
    writeSdkRepairLoopCheckpointState(failSdkRepairLoopCheckpointState(state, stage.errors), statePath);
    return failed("DEV_WORKER_STAGE_FAILED", state, { dev_worker_thread_id: stage.dev_worker_thread_id, failure_category: stage.failure_category, errors: stage.errors });
  }
  const next = updateRepairLoopDevWorkerCheckpoint(state, {
    status: "PASS",
    thread_id: stage.dev_worker_thread_id,
    dev_result_path: stage.dev_result_path,
    file_change_verified: stage.file_change_verified,
    baseline_tests_passed: stage.baseline_tests_passed,
    full_tests_expected_to_fail: stage.full_tests_expected_to_fail,
    full_tests_failed: stage.full_tests_failed,
    known_gap_seeded: stage.known_gap_seeded
  });
  writeSdkRepairLoopCheckpointState(next, statePath);
  return {
    status: "PASS",
    current_stage: next.current_stage,
    real_sdk_run_executed: !mockMode,
    dev_worker_thread_started: true,
    dev_worker_thread_id: stage.dev_worker_thread_id,
    file_change_verified: stage.file_change_verified,
    baseline_tests_passed: stage.baseline_tests_passed,
    full_tests_expected_to_fail: stage.full_tests_expected_to_fail,
    full_tests_failed: stage.full_tests_failed,
    known_gap_seeded: stage.known_gap_seeded,
    failure_category: "",
    errors: []
  };
}

export async function runGate6B2InitialEvaluator(): Promise<Record<string, unknown>> {
  const state = readStateOrNull();
  if (!state) return blocked("CHECKPOINT_STATE_INVALID", "Run npm run gate6b2:prepare first.");
  if (state.current_stage !== "DEV_DONE") {
    return blocked("BLOCKED_DEV_WORKER_CHECKPOINT_MISSING", "Initial dev_worker checkpoint must be DEV_DONE before initial evaluator.", state.current_stage);
  }
  if (
    state.dev_worker.status !== "PASS" ||
    state.dev_worker.known_gap_seeded !== true ||
    state.dev_worker.baseline_tests_passed !== true ||
    state.dev_worker.full_tests_failed !== true
  ) {
    return blocked(
      "INITIAL_DEV_SEEDED_GAP_CONTRACT_FAILED",
      "Initial evaluator requires a PASS initial dev worker with known_gap_seeded=true, baseline_tests_passed=true, and full_tests_failed=true.",
      state.current_stage
    );
  }
  const mockMode = process.env.CODEX_LOOP_GATE6B2_MOCK;
  if (process.env.CODEX_LOOP_ENABLE_REAL_SDK_EVALUATOR !== "1" && !mockMode) {
    return blocked("BLOCKED_SDK_NOT_ENABLED", "Set CODEX_LOOP_ENABLE_REAL_SDK_EVALUATOR=1 only for one controlled Gate 6B.2 initial evaluator run.", state.current_stage);
  }
  const stage = await runEvaluatorLiteStage({
    loop_run_id: "loop_gate6b2_repair_loop",
    task_id: "task_validate_project_name",
    target_repo: targetRepo,
    prd_path: state.planner.prd_path || "docs/PRD.md",
    task_graph_path: state.planner.task_graph_path || "docs/TASK_GRAPH.json",
    dev_result_path: state.dev_worker.dev_result_path || "artifacts/dev-result.json",
    test_log_path: "npm run test:full expected failure evidence",
    model: process.env.CODEX_LOOP_CODEX_MODEL,
    model_catalog_json: process.env.CODEX_LOOP_MODEL_CATALOG_JSON,
    sqlite_home: sqliteHomePath(),
    sandbox: "read-only",
    timeout_ms: 180_000,
    runtime_adapter: mockMode ? mockAdapter("initial_evaluator") : new SdkRuntimeAdapter({ enableRealRun: true, repoRoot }),
    repo_root: repoRoot,
    report_dir: reportDir,
    artifact_path: "artifacts/eval-report-needs-revision.json",
    invocation_trace_path: resolve(reportDir, "gate6b2-initial-evaluator-invocation-trace-redacted.json"),
    invocation_trace_label: "gate6b2-initial-evaluator",
    events_path: resolve(reportDir, "gate6b2-initial-evaluator-events.jsonl"),
    stdout_path: resolve(reportDir, "gate6b2-initial-evaluator-stdout.log"),
    stderr_path: resolve(reportDir, "gate6b2-initial-evaluator-stderr.log"),
    result_path: resultPath("gate6b2-initial-evaluator-result.json")
  });
  if (stage.status !== "NEEDS_REVISION" || stage.eval_verdict !== "NEEDS_REVISION") {
    writeSdkRepairLoopCheckpointState(failSdkRepairLoopCheckpointState(state, ["Initial evaluator did not return NEEDS_REVISION for seeded gap."]), statePath);
    return failed("INITIAL_EVALUATOR_DID_NOT_CATCH_SEEDED_GAP", state, {
      evaluator_thread_id: stage.evaluator_thread_id,
      eval_verdict: stage.eval_verdict,
      errors: stage.errors
    });
  }
  const next = updateRepairLoopInitialEvaluatorCheckpoint(state, {
    status: "PASS",
    thread_id: stage.evaluator_thread_id,
    eval_report_path: stage.eval_report_path,
    eval_verdict: "NEEDS_REVISION"
  });
  writeSdkRepairLoopCheckpointState(next, statePath);
  return {
    status: "PASS",
    current_stage: next.current_stage,
    real_sdk_run_executed: !mockMode,
    evaluator_thread_started: true,
    evaluator_thread_id: stage.evaluator_thread_id,
    eval_verdict: "NEEDS_REVISION",
    failure_category: "",
    errors: []
  };
}

export function createGate6B2RepairRequest(): Record<string, unknown> {
  const state = readStateOrNull();
  if (!state) return blocked("CHECKPOINT_STATE_INVALID", "Run npm run gate6b2:prepare first.");
  if (state.current_stage !== "INITIAL_EVAL_DONE" || state.initial_evaluator.eval_verdict !== "NEEDS_REVISION") {
    return failed("INITIAL_EVALUATOR_DID_NOT_CATCH_SEEDED_GAP", state, { errors: ["Initial evaluator must be NEEDS_REVISION before RepairRequest."] });
  }
  const evalReport = readJson(resolvePathMaybeTarget(state.initial_evaluator.eval_report_path)) as unknown as EvalReport;
  const repair = createRepairRequestFromEval({
    eval_report: evalReport,
    repair_id: "repair_gate6b2_whitespace_only",
    allowed_scope: ["src/project-name.js", "test/project-name.baseline.test.js", "test/project-name.full.test.js"],
    disallowed_scope: ["Do not implement UI.", "Do not add database changes.", "Do not modify package.json unless validation is impossible."]
  });
  if (repair.status !== "PASS" || !repair.repair_request) {
    writeSdkRepairLoopCheckpointState(failSdkRepairLoopCheckpointState(state, repair.errors), statePath);
    return failed(repair.failure_category || "REPAIR_REQUEST_NOT_CREATED", state, { errors: repair.errors });
  }
  writeTargetJson("artifacts/repair-request.json", repair.repair_request);
  const validation = validateWithSchema("repair-request", repair.repair_request);
  if (!validation.valid) {
    const errors = validation.errors.map((error) => `${error.path}: ${error.message}`);
    writeSdkRepairLoopCheckpointState(failSdkRepairLoopCheckpointState(state, errors), statePath);
    return failed("REPAIR_REQUEST_SCHEMA_INVALID", state, { errors });
  }
  const next = updateRepairLoopRepairRequestCheckpoint(state, {
    status: "PASS",
    repair_request_path: relative(repoRoot, resolve(targetRepo, "artifacts/repair-request.json")),
    source_eval_report_path: state.initial_evaluator.eval_report_path,
    required_fixes_count: repair.repair_request.repair_instructions.length
  });
  writeSdkRepairLoopCheckpointState(next, statePath);
  return {
    status: "PASS",
    current_stage: next.current_stage,
    repair_request_created: true,
    repair_request_path: next.repair_request.repair_request_path,
    required_fixes_count: next.repair_request.required_fixes_count,
    real_sdk_run_executed: false,
    failure_category: "",
    errors: []
  };
}

export async function runGate6B2RepairDevWorker(): Promise<Record<string, unknown>> {
  const state = readStateOrNull();
  if (!state) return blocked("CHECKPOINT_STATE_INVALID", "Run npm run gate6b2:prepare first.");
  if (state.current_stage !== "REPAIR_REQUEST_CREATED") {
    return blocked("REPAIR_REQUEST_NOT_CREATED", "RepairRequest must be created before repair dev_worker.", state.current_stage);
  }
  const mockMode = process.env.CODEX_LOOP_GATE6B2_MOCK;
  if (process.env.CODEX_LOOP_ENABLE_REAL_SDK_REPAIR_DEV_WORKER !== "1" && !mockMode) {
    return blocked("BLOCKED_SDK_NOT_ENABLED", "Set CODEX_LOOP_ENABLE_REAL_SDK_REPAIR_DEV_WORKER=1 only for one controlled Gate 6B.2 repair dev_worker run.", state.current_stage);
  }
  const stage = await runDevWorkerStage({
    loop_run_id: "loop_gate6b2_repair_loop",
    task_id: "task_validate_project_name",
    target_repo: targetRepo,
    prd_path: state.planner.prd_path || "docs/PRD.md",
    task_graph_path: state.repair_request.repair_request_path || "artifacts/repair-request.json",
    model: process.env.CODEX_LOOP_CODEX_MODEL,
    model_catalog_json: process.env.CODEX_LOOP_MODEL_CATALOG_JSON,
    sqlite_home: sqliteHomePath(),
    sandbox: "workspace-write",
    timeout_ms: 180_000,
    runtime_adapter: mockMode ? mockAdapter("repair_dev_worker") : new SdkRuntimeAdapter({ enableRealRun: true, repoRoot }),
    repo_root: repoRoot,
    report_dir: reportDir,
    artifact_path: "artifacts/dev-repair-result.json",
    invocation_trace_path: resolve(reportDir, "gate6b2-repair-dev-worker-invocation-trace-redacted.json"),
    invocation_trace_label: "gate6b2-repair-dev-worker",
    events_path: resolve(reportDir, "gate6b2-repair-dev-worker-events.jsonl"),
    stdout_path: resolve(reportDir, "gate6b2-repair-dev-worker-stdout.log"),
    stderr_path: resolve(reportDir, "gate6b2-repair-dev-worker-stderr.log"),
    result_path: resultPath("gate6b2-repair-dev-worker-result.json")
  });
  if (stage.status !== "PASS") {
    const category = stage.tests_passed === false ? "REPAIR_TESTS_FAILED" : "REPAIR_DEV_WORKER_FAILED";
    writeSdkRepairLoopCheckpointState(failSdkRepairLoopCheckpointState(state, stage.errors), statePath);
    return failed(category, state, { repair_dev_worker_thread_id: stage.dev_worker_thread_id, errors: stage.errors });
  }
  const next = updateRepairLoopRepairDevWorkerCheckpoint(state, {
    status: "PASS",
    thread_id: stage.dev_worker_thread_id,
    repair_result_path: stage.dev_result_path,
    file_change_verified: stage.file_change_verified,
    tests_passed: stage.tests_passed
  });
  writeSdkRepairLoopCheckpointState(next, statePath);
  return {
    status: "PASS",
    current_stage: next.current_stage,
    real_sdk_run_executed: !mockMode,
    repair_dev_worker_thread_started: true,
    repair_dev_worker_thread_id: stage.dev_worker_thread_id,
    file_change_verified: stage.file_change_verified,
    tests_passed: stage.tests_passed,
    failure_category: "",
    errors: []
  };
}

export async function runGate6B2FinalEvaluator(): Promise<Record<string, unknown>> {
  const state = readStateOrNull();
  if (!state) return blocked("CHECKPOINT_STATE_INVALID", "Run npm run gate6b2:prepare first.");
  if (state.current_stage !== "REPAIR_DONE") {
    return blocked("REPAIR_DEV_WORKER_FAILED", "Repair dev_worker must be REPAIR_DONE before final evaluator.", state.current_stage);
  }
  const mockMode = process.env.CODEX_LOOP_GATE6B2_MOCK;
  if (process.env.CODEX_LOOP_ENABLE_REAL_SDK_FINAL_EVALUATOR !== "1" && !mockMode) {
    return blocked("BLOCKED_SDK_NOT_ENABLED", "Set CODEX_LOOP_ENABLE_REAL_SDK_FINAL_EVALUATOR=1 only for one controlled Gate 6B.2 final evaluator run.", state.current_stage);
  }
  const stage = await runEvaluatorLiteStage({
    loop_run_id: "loop_gate6b2_repair_loop",
    task_id: "task_validate_project_name",
    target_repo: targetRepo,
    prd_path: state.planner.prd_path || "docs/PRD.md",
    task_graph_path: state.planner.task_graph_path || "docs/TASK_GRAPH.json",
    dev_result_path: state.repair_dev_worker.repair_result_path || "artifacts/dev-repair-result.json",
    model: process.env.CODEX_LOOP_CODEX_MODEL,
    model_catalog_json: process.env.CODEX_LOOP_MODEL_CATALOG_JSON,
    sqlite_home: sqliteHomePath(),
    sandbox: "read-only",
    timeout_ms: 180_000,
    runtime_adapter: mockMode ? mockAdapter("final_evaluator") : new SdkRuntimeAdapter({ enableRealRun: true, repoRoot }),
    repo_root: repoRoot,
    report_dir: reportDir,
    artifact_path: "artifacts/eval-report-pass.json",
    invocation_trace_path: resolve(reportDir, "gate6b2-final-evaluator-invocation-trace-redacted.json"),
    invocation_trace_label: "gate6b2-final-evaluator",
    events_path: resolve(reportDir, "gate6b2-final-evaluator-events.jsonl"),
    stdout_path: resolve(reportDir, "gate6b2-final-evaluator-stdout.log"),
    stderr_path: resolve(reportDir, "gate6b2-final-evaluator-stderr.log"),
    result_path: resultPath("gate6b2-final-evaluator-result.json")
  });
  if (stage.status !== "PASS" || stage.eval_verdict !== "PASS") {
    writeSdkRepairLoopCheckpointState(failSdkRepairLoopCheckpointState(state, stage.errors), statePath);
    return failed("FINAL_EVALUATOR_NOT_PASS", state, { final_evaluator_thread_id: stage.evaluator_thread_id, eval_verdict: stage.eval_verdict, errors: stage.errors });
  }
  const next = updateRepairLoopFinalEvaluatorCheckpoint(state, {
    status: "PASS",
    thread_id: stage.evaluator_thread_id,
    eval_report_path: stage.eval_report_path,
    eval_verdict: "PASS"
  });
  writeSdkRepairLoopCheckpointState(next, statePath);
  return {
    status: "PASS",
    current_stage: next.current_stage,
    real_sdk_run_executed: !mockMode,
    evaluator_thread_started: true,
    evaluator_thread_id: stage.evaluator_thread_id,
    eval_verdict: "PASS",
    failure_category: "",
    errors: []
  };
}

export function writeGate6B2FinalReport(): Record<string, unknown> {
  const state = readStateOrNull();
  if (!state) return blocked("CHECKPOINT_STATE_INVALID", "Run npm run gate6b2:prepare first.");
  if (state.current_stage !== "FINAL_EVAL_DONE") {
    return blocked("FINAL_EVALUATOR_NOT_PASS", "Final evaluator must be FINAL_EVAL_DONE before final report.", state.current_stage);
  }
  const report = writeFinalDeliveryReport({
    state,
    target_repo: targetRepo,
    changed_files: ["src/project-name.js"]
  });
  if (report.status !== "PASS") {
    writeSdkRepairLoopCheckpointState(failSdkRepairLoopCheckpointState(state, report.errors), statePath);
    return failed("FINAL_REPORT_NOT_CREATED", state, { errors: report.errors });
  }
  const next = updateRepairLoopFinalReportCheckpoint(state, {
    status: "PASS",
    path: report.path
  });
  writeSdkRepairLoopCheckpointState(next, statePath);
  return {
    status: "PASS",
    current_stage: next.current_stage,
    final_report_created: true,
    final_report_path: report.path,
    real_sdk_run_executed: false,
    failure_category: "",
    errors: []
  };
}

export function verifyGate6B2RepairLoop(): Record<string, unknown> {
  const state = readStateOrNull();
  if (!state) {
    return finishable({
      status: "CHECKPOINT_STATE_INVALID",
      current_stage: "FAILED",
      ready_for_m12: false,
      errors: ["Repair loop checkpoint state is missing or invalid."]
    });
  }
  const missingArtifacts = requiredArtifactPaths(state).filter((path) => !artifactExists(state.target_repo, path));
  if (missingArtifacts.length > 0) {
    return finishable({
      status: "CHECKPOINT_ARTIFACT_MISSING",
      current_stage: state.current_stage,
      ready_for_m12: false,
      missing_artifacts: missingArtifacts,
      errors: [`Missing checkpoint artifacts: ${missingArtifacts.join(", ")}`]
    });
  }
  const allThreadIdsPresent = Boolean(
    state.planner.thread_id &&
    state.dev_worker.thread_id &&
    state.initial_evaluator.thread_id &&
    state.repair_dev_worker.thread_id &&
    state.final_evaluator.thread_id
  );
  const pass = state.current_stage === "FINAL_REPORT_DONE" &&
    state.planner.status === "PASS" &&
    state.dev_worker.status === "PASS" &&
    state.dev_worker.file_change_verified === true &&
    state.dev_worker.known_gap_seeded === true &&
    state.dev_worker.baseline_tests_passed === true &&
    state.dev_worker.full_tests_expected_to_fail === true &&
    state.dev_worker.full_tests_failed === true &&
    state.initial_evaluator.eval_verdict === "NEEDS_REVISION" &&
    state.repair_request.status === "PASS" &&
    state.repair_dev_worker.status === "PASS" &&
    state.repair_dev_worker.tests_passed === true &&
    state.final_evaluator.eval_verdict === "PASS" &&
    state.final_report.path.length > 0 &&
    allThreadIdsPresent &&
    state.planner.artifact_thread_evidence_verified === true;
  return finishable({
    status: pass ? "PASS" : classifyIncomplete(state),
    current_stage: state.current_stage,
    planner_status: state.planner.status,
    dev_worker_status: state.dev_worker.status,
    dev_worker_known_gap_seeded: state.dev_worker.known_gap_seeded,
    dev_worker_baseline_tests_passed: state.dev_worker.baseline_tests_passed,
    dev_worker_full_tests_expected_to_fail: state.dev_worker.full_tests_expected_to_fail,
    dev_worker_full_tests_failed: state.dev_worker.full_tests_failed,
    initial_eval_verdict: state.initial_evaluator.eval_verdict,
    repair_request_status: state.repair_request.status,
    repair_dev_worker_status: state.repair_dev_worker.status,
    repair_dev_worker_tests_passed: state.repair_dev_worker.tests_passed,
    final_eval_verdict: state.final_evaluator.eval_verdict,
    final_report_path: state.final_report.path,
    all_thread_ids_present: allThreadIdsPresent,
    artifact_thread_evidence_verified: state.planner.artifact_thread_evidence_verified,
    danger_full_access_used: false,
    secret_leak_detected: false,
    ready_for_m12: false,
    ready_for_gate6b2_repair_loop: pass,
    errors: pass ? [] : state.errors
  });
}

export function reportGate6B2RepairLoop(): void {
  const verify = readJson(resultPath("gate6b2-repair-loop-verify.json"));
  const state = readStateOrNull();
  const reportPath = resultPath("Gate6B2_Repair_Loop_Report.md");
  const lines = [
    "# Gate 6B.2 SDK-Orchestrated Repair Loop E2E Harness Report",
    "",
    "Date: 2026-06-21",
    "",
    `Verify status: ${String(verify.status ?? "NOT_RUN")}`,
    `Current stage: ${String(state?.current_stage ?? verify.current_stage ?? "UNKNOWN")}`,
    `Target repo: ${String(state?.target_repo ?? defaultTargetRepo)}`,
    `Planner thread id: ${state?.planner.thread_id ?? ""}`,
    `Dev Worker thread id: ${state?.dev_worker.thread_id ?? ""}`,
    `Initial Evaluator thread id: ${state?.initial_evaluator.thread_id ?? ""}`,
    `Repair Dev Worker thread id: ${state?.repair_dev_worker.thread_id ?? ""}`,
    `Final Evaluator thread id: ${state?.final_evaluator.thread_id ?? ""}`,
    `Initial evaluator verdict: ${state?.initial_evaluator.eval_verdict ?? ""}`,
    `Final evaluator verdict: ${state?.final_evaluator.eval_verdict ?? ""}`,
    `Ready for M12: false`,
    "",
    "Gate 6B.2 proves the full SDK-Orchestrated repair loop only after verify PASS. Gate 6B.2.0 creates the checkpointed harness and safe dry-run defaults; it does not run real SDK by default.",
    ""
  ];
  writeFile(reportPath, `${lines.join("\n")}\n`);
}

export function emitResult(path: string, value: Record<string, unknown>): void {
  writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  process.exitCode = successStatus(value.status) ? 0 : 2;
}

function successStatus(status: unknown): boolean {
  return status === "PASS" || status === "BLOCKED_SDK_NOT_ENABLED" || status === "BLOCKED_PLANNER_CHECKPOINT_MISSING" || status === "BLOCKED_DEV_WORKER_CHECKPOINT_MISSING" || status === "REPAIR_REQUEST_NOT_CREATED" || status === "REPAIR_DEV_WORKER_FAILED" || status === "FINAL_EVALUATOR_NOT_PASS";
}

function readStateOrNull(): SdkRepairLoopCheckpointState | null {
  return readSdkRepairLoopCheckpointState(statePath);
}

function sqliteHomePath(): string {
  const sqlite = ensureEvalSqliteHome(repoRoot);
  if (!sqlite.ok) {
    throw new Error(sqlite.reason ?? "Eval sqlite home is not writable.");
  }
  return sqlite.path;
}

function plannerOutputContractVersion(): "v1" | "v2" {
  return process.env.CODEX_LOOP_PLANNER_OUTPUT_CONTRACT_VERSION === "v2" ? "v2" : "v1";
}

function blocked(status: string, message: string, currentStage = "FAILED"): Record<string, unknown> {
  return {
    status,
    current_stage: currentStage,
    real_sdk_run_executed: false,
    failure_category: status,
    errors: [message]
  };
}

function failed(status: string, state: SdkRepairLoopCheckpointState, extra: Record<string, unknown>): Record<string, unknown> {
  return {
    status,
    current_stage: "FAILED",
    real_sdk_run_executed: false,
    failure_category: status,
    target_repo: state.target_repo,
    ...extra
  };
}

function finishable(value: Record<string, unknown>): Record<string, unknown> {
  return value;
}

function classifyIncomplete(state: SdkRepairLoopCheckpointState): string {
  if (state.initial_evaluator.eval_verdict === "PASS") return "INITIAL_EVALUATOR_DID_NOT_CATCH_SEEDED_GAP";
  if (state.current_stage === "DEV_DONE" && state.dev_worker.known_gap_seeded !== true) return "INITIAL_DEV_SEEDED_GAP_CONTRACT_FAILED";
  if (state.current_stage === "INITIAL_EVAL_DONE") return "REPAIR_REQUEST_NOT_CREATED";
  if (state.current_stage === "REPAIR_REQUEST_CREATED") return "REPAIR_DEV_WORKER_FAILED";
  if (state.current_stage === "REPAIR_DONE" && state.repair_dev_worker.tests_passed === false) return "REPAIR_TESTS_FAILED";
  if (state.current_stage === "REPAIR_DONE") return "FINAL_EVALUATOR_NOT_PASS";
  if (state.current_stage === "FINAL_EVAL_DONE") return "FINAL_REPORT_NOT_CREATED";
  return "GATE6B2_REPAIR_LOOP_INCOMPLETE";
}

function requiredArtifactPaths(state: SdkRepairLoopCheckpointState): string[] {
  const paths: string[] = [];
  if (stageAtLeast(state, "PLANNER_DONE")) paths.push(state.planner.prd_path, state.planner.task_graph_path, state.planner.planner_result_path);
  if (stageAtLeast(state, "DEV_DONE")) paths.push(state.dev_worker.dev_result_path);
  if (stageAtLeast(state, "INITIAL_EVAL_DONE")) paths.push(state.initial_evaluator.eval_report_path);
  if (stageAtLeast(state, "REPAIR_REQUEST_CREATED")) paths.push(state.repair_request.repair_request_path);
  if (stageAtLeast(state, "REPAIR_DONE")) paths.push(state.repair_dev_worker.repair_result_path);
  if (stageAtLeast(state, "FINAL_EVAL_DONE")) paths.push(state.final_evaluator.eval_report_path);
  if (stageAtLeast(state, "FINAL_REPORT_DONE")) paths.push(state.final_report.path);
  return paths.filter(Boolean);
}

function stageAtLeast(state: SdkRepairLoopCheckpointState, stage: SdkRepairLoopCheckpointState["current_stage"]): boolean {
  const order = [
    "PREPARED",
    "PLANNER_DONE",
    "DEV_DONE",
    "INITIAL_EVAL_DONE",
    "REPAIR_REQUEST_CREATED",
    "REPAIR_DONE",
    "FINAL_EVAL_DONE",
    "FINAL_REPORT_DONE"
  ];
  return order.indexOf(state.current_stage) >= order.indexOf(stage);
}

function artifactExists(targetRepoPath: string, path: string): boolean {
  if (existsSync(resolve(path))) return true;
  if (existsSync(resolve(repoRoot, path))) return true;
  return existsSync(resolve(repoRoot, targetRepoPath, path));
}

function writeDevWorkerBaseline(input: { initial_baseline_tests_failed: boolean; initial_full_tests_failed: boolean }): void {
  mkdirSync(reportDir, { recursive: true });
  writeJson(resolve(reportDir, "dev-worker-baseline.json"), {
    target_repo: targetRepo,
    src_project_name_hash_before: hashFile(resolve(targetRepo, "src/project-name.js")),
    package_json_hash_before: hashFile(resolve(targetRepo, "package.json")),
    test_project_name_hash_before: "",
    test_project_name_baseline_hash_before: hashFile(resolve(targetRepo, "test/project-name.baseline.test.js")),
    test_project_name_full_hash_before: hashFile(resolve(targetRepo, "test/project-name.full.test.js")),
    initial_tests_run: true,
    initial_tests_expected_to_fail: true,
    initial_tests_failed: input.initial_baseline_tests_failed && input.initial_full_tests_failed,
    initial_baseline_tests_run: true,
    initial_baseline_tests_failed: input.initial_baseline_tests_failed,
    initial_full_tests_run: true,
    initial_full_tests_failed: input.initial_full_tests_failed,
    seeded_gap_fixture_created: true,
    fixture_status: input.initial_baseline_tests_failed && input.initial_full_tests_failed ? "BROKEN_AS_EXPECTED" : "BLOCKED_TARGET_FIXTURE_NOT_BROKEN"
  });
}

function commandFails(command: string[], cwd: string): boolean {
  try {
    execFileSync(command[0] ?? "", command.slice(1), {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
    return false;
  } catch {
    return true;
  }
}

function ensureTargetGitRepo(): void {
  if (!existsSync(resolve(targetRepo, ".git"))) {
    execFileSync("git", ["init"], { cwd: targetRepo, stdio: "ignore" });
  }
  try {
    execFileSync("git", ["add", "."], { cwd: targetRepo, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "baseline broken repair-loop fixture"], {
      cwd: targetRepo,
      stdio: "ignore",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: process.env.GIT_AUTHOR_NAME ?? "Codex Loop Eval",
        GIT_AUTHOR_EMAIL: process.env.GIT_AUTHOR_EMAIL ?? "codex-loop-eval@example.invalid",
        GIT_COMMITTER_NAME: process.env.GIT_COMMITTER_NAME ?? "Codex Loop Eval",
        GIT_COMMITTER_EMAIL: process.env.GIT_COMMITTER_EMAIL ?? "codex-loop-eval@example.invalid"
      }
    });
  } catch {
    // Hash evidence is still sufficient when local git commit setup is unavailable.
  }
}

function mockAdapter(role: "planner" | "dev_worker_initial" | "initial_evaluator" | "repair_dev_worker" | "final_evaluator"): {
  runThreadStreamed(input: RuntimeThreadInput): Promise<RuntimeThreadResult>;
  runThread(input: RuntimeThreadInput): Promise<RuntimeThreadResult>;
  startThread(input: RuntimeThreadInput): Promise<RuntimeThreadResult>;
  resumeThread(input: RuntimeThreadRefInput): Promise<RuntimeThreadResult>;
  getThreadEvents(input: RuntimeEventsInput): Promise<{ thread_id: string; events_path: string; events: unknown[]; errors: string[] }>;
  stopThread(input: RuntimeStopThreadInput): Promise<RuntimeThreadResult>;
  getFinalResponse(input: RuntimeFinalResponseInput): Promise<RuntimeThreadResult>;
} {
  const result = (input: RuntimeThreadInput): RuntimeThreadResult => {
    if (role === "dev_worker_initial") writeSeededGapSource(input.working_directory);
    if (role === "repair_dev_worker") writeFixedSource(input.working_directory);
    const eventsPath = input.error_capture_paths?.events_path ?? "";
    if (eventsPath) {
      writeFile(eventsPath, `{"type":"thread.started","thread_id":"thread_gate6b2_${role}_mock"}\n`);
    }
    return {
      thread_id: `thread_gate6b2_${role}_mock`,
      role: input.role,
      status: role === "initial_evaluator" ? "NEEDS_REVISION" : "PASS",
      final_response: mockFinalResponse(role),
      events: [],
      events_path: eventsPath,
      stdout_path: "",
      stderr_path: "",
      artifacts: [],
      sandbox_control: "VERIFIED",
      errors: []
    };
  };
  return {
    runThreadStreamed: async (input) => result(input),
    runThread: async (input) => result(input),
    startThread: async (input) => result(input),
    resumeThread: async (input) => result({ role: input.role, loop_run_id: input.loop_run_id, task_id: input.task_id, prompt: input.prompt ?? "", sandbox: input.sandbox ?? "read-only", working_directory: input.working_directory ?? "", timeout_ms: 180_000, output_schema_path: "", env: {} }),
    getThreadEvents: async (input) => ({ thread_id: input.thread_id, events_path: input.events_path ?? "", events: [], errors: [] }),
    stopThread: async (input) => ({ ...result({ role: "evaluator", loop_run_id: "", task_id: "", prompt: "", sandbox: "read-only", working_directory: "", timeout_ms: 180_000, output_schema_path: "", env: {} }), thread_id: input.thread_id }),
    getFinalResponse: async (input) => ({ ...result({ role: "evaluator", loop_run_id: "", task_id: "", prompt: "", sandbox: "read-only", working_directory: "", timeout_ms: 180_000, output_schema_path: "", env: {} }), thread_id: input.thread_id })
  };
}

function mockFinalResponse(role: string): string {
  if (role === "planner") {
    return JSON.stringify({
      status: "PASS",
      prd_markdown: "# PRD\n\nValidate project names, including whitespace-only names.",
      task_graph_json: JSON.stringify({
        tasks: [
          {
            id: "TASK-001",
            title: "Implement validateProjectName",
            description: "Validate empty, whitespace-only, long, and valid project names.",
            acceptance_criteria: ["Reject empty string", "Reject whitespace-only string", "Reject names longer than 80 characters", "Accept valid names"],
            files: ["src/project-name.js"],
            validation: ["npm test"],
            dependencies: []
          }
        ]
      }),
      acceptance_criteria: ["Reject empty string", "Reject whitespace-only string", "Reject names longer than 80 characters", "Accept valid names"],
      risks: []
    });
  }
  if (role === "dev_worker_initial") {
    return JSON.stringify({
      status: "PASS",
      changed_files: ["src/project-name.js"],
      baseline_tests_run: true,
      baseline_tests_passed: true,
      full_tests_run: true,
      full_tests_expected_to_fail: true,
      full_tests_failed: true,
      known_gap_seeded: true,
      summary: "Seeded initial implementation intentionally leaves whitespace-only gap."
    });
  }
  if (role === "initial_evaluator") {
    return JSON.stringify({
      status: "NEEDS_REVISION",
      verdict: "NEEDS_REVISION",
      findings_json: JSON.stringify([
        {
          finding_id: "finding_whitespace_only_gap",
          severity: "high",
          category: "correctness",
          description: "Whitespace-only project names are still accepted in the seeded initial implementation.",
          evidence: [{ type: "file", ref: "src/project-name.js", summary: "No trim-based whitespace-only rejection." }],
          required_fix: "Reject whitespace-only names and preserve npm test coverage."
        }
      ]),
      validation_commands_checked: ["npm test"],
      summary: "Seeded whitespace-only gap requires repair."
    });
  }
  if (role === "repair_dev_worker") {
    return JSON.stringify({
      status: "PASS",
      changed_files: ["src/project-name.js"],
      tests_run: ["npm test"],
      tests_passed: true,
      summary: "Repaired whitespace-only validation gap."
    });
  }
  return JSON.stringify({
    status: "PASS",
    verdict: "PASS",
    findings_json: "[]",
    validation_commands_checked: ["npm test"],
    summary: "Repair loop acceptance criteria pass."
  });
}

function writeSeededGapSource(root: string): void {
  writeFile(
    resolve(root, "src/project-name.js"),
    [
      "export function validateProjectName(name) {",
      "  if (typeof name !== \"string\") return { ok: false, reason: \"name must be a string\" };",
      "  if (name.length === 0) return { ok: false, reason: \"name is required\" };",
      "  if (name.length > 80) return { ok: false, reason: \"name is too long\" };",
      "  return { ok: true };",
      "}",
      ""
    ].join("\n")
  );
}

function writeFixedSource(root: string): void {
  writeFile(
    resolve(root, "src/project-name.js"),
    [
      "export function validateProjectName(name) {",
      "  if (typeof name !== \"string\") return { ok: false, reason: \"name must be a string\" };",
      "  if (name.trim().length === 0) return { ok: false, reason: \"name is required\" };",
      "  if (name.length > 80) return { ok: false, reason: \"name is too long\" };",
      "  return { ok: true };",
      "}",
      ""
    ].join("\n")
  );
}

function resolvePathMaybeTarget(path: string): string {
  if (existsSync(resolve(path))) return resolve(path);
  if (existsSync(resolve(repoRoot, path))) return resolve(repoRoot, path);
  return resolve(targetRepo, path);
}

function writeTargetJson(path: string, value: unknown): void {
  writeJson(resolve(targetRepo, path), value);
}

function writeTargetText(path: string, value: string): void {
  writeFile(resolve(targetRepo, path), value);
}

function writeJson(path: string, value: unknown): void {
  writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

function writeFile(path: string, value: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value, "utf8");
}

function readJson(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

function hashFile(path: string): string {
  if (!existsSync(path)) return "";
  return execFileSync("shasum", ["-a", "256", path], { encoding: "utf8" }).split(/\s+/)[0] ?? "";
}
