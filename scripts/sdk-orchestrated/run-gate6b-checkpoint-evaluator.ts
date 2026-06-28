import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import {
  DEFAULT_SDK_CHECKPOINT_STATE_PATH,
  failSdkCheckpointState,
  readSdkCheckpointState,
  updateEvaluatorCheckpoint,
  writeSdkCheckpointState
} from "../../src/orchestrator/sdk-checkpoint-state.ts";
import { runEvaluatorLiteStage } from "../../src/orchestrator/sdk-evaluator-stage.ts";
import { ensureEvalSqliteHome } from "../../src/runtime/eval-sqlite-home.ts";
import { SdkRuntimeAdapter } from "../../src/runtime/sdk-runtime-adapter.ts";
import type { RuntimeEventsInput, RuntimeFinalResponseInput, RuntimeStopThreadInput, RuntimeThreadInput, RuntimeThreadRefInput, RuntimeThreadResult } from "../../src/runtime/runtime-types.ts";

const repoRoot = process.cwd();
const statePath = process.env.CODEX_LOOP_GATE6B_CHECKPOINT_STATE_PATH
  ? resolve(process.env.CODEX_LOOP_GATE6B_CHECKPOINT_STATE_PATH)
  : resolve(repoRoot, DEFAULT_SDK_CHECKPOINT_STATE_PATH);
const resultPath = resolve(repoRoot, "evals/sdk-orchestrated/reports/gate6b-checkpoint-evaluator-result.json");
const reportDir = resolve(repoRoot, "evals/sdk-orchestrated/reports/sdk-startup-triage");

async function main(): Promise<void> {
  const state = readSdkCheckpointState(statePath);
  if (!state) {
    return finish(blocked("CHECKPOINT_STATE_INVALID", "Run npm run gate6b:checkpoint:prepare first."));
  }
  if (!canRunEvaluator(state)) {
    return finish(blocked("BLOCKED_DEV_WORKER_CHECKPOINT_MISSING", "Dev Worker checkpoint must be DEV_WORKER_DONE before evaluator.", state.current_stage));
  }

  const mockMode = process.env.CODEX_LOOP_GATE6B_CHECKPOINT_MOCK;
  if (process.env.CODEX_LOOP_ENABLE_REAL_SDK_EVALUATOR !== "1" && !mockMode) {
    return finish(blocked("BLOCKED_SDK_EVALUATOR_NOT_ENABLED", "Set CODEX_LOOP_ENABLE_REAL_SDK_EVALUATOR=1 only for one controlled checkpoint evaluator run.", state.current_stage));
  }

  const targetRepo = resolve(repoRoot, state.target_repo);
  const sqliteHome = ensureEvalSqliteHome(repoRoot);
  const adapter = mockMode ? mockAdapter() : new SdkRuntimeAdapter({ enableRealRun: true, repoRoot });
  const stage = await runEvaluatorLiteStage({
    loop_run_id: "loop_gate6b_checkpoint",
    task_id: "task_validate_project_name",
    target_repo: targetRepo,
    prd_path: state.planner.prd_path || "docs/PRD.md",
    task_graph_path: state.planner.task_graph_path || "docs/TASK_GRAPH.json",
    dev_result_path: state.dev_worker.dev_result_path || "artifacts/dev-result.json",
    model: process.env.CODEX_LOOP_CODEX_MODEL,
    model_catalog_json: process.env.CODEX_LOOP_MODEL_CATALOG_JSON,
    sqlite_home: sqliteHome.path,
    sandbox: "read-only",
    timeout_ms: 180_000,
    runtime_adapter: adapter,
    repo_root: repoRoot,
    report_dir: reportDir,
    invocation_trace_path: resolve(reportDir, "gate6b-checkpoint-evaluator-invocation-trace-redacted.json"),
    invocation_trace_label: "gate6b-checkpoint-evaluator",
    events_path: resolve(reportDir, "gate6b-checkpoint-evaluator-events.jsonl"),
    stdout_path: resolve(reportDir, "gate6b-checkpoint-evaluator-stdout.log"),
    stderr_path: resolve(reportDir, "gate6b-checkpoint-evaluator-stderr.log"),
    result_path: resultPath
  });

  if (stage.status !== "PASS") {
    writeSdkCheckpointState(failSdkCheckpointState({
      ...state,
      evaluator: {
        status: "FAILED",
        thread_id: stage.evaluator_thread_id,
        eval_report_path: stage.eval_report_path,
        eval_verdict: stage.eval_verdict
      }
    }, stage.errors), statePath);
    return finish({
      status: "EVALUATOR_STAGE_FAILED",
      current_stage: "FAILED",
      real_sdk_run_executed: !mockMode,
      evaluator_thread_started: stage.evaluator_thread_started,
      evaluator_thread_id: stage.evaluator_thread_id,
      eval_verdict: stage.eval_verdict,
      failure_category: stage.failure_category,
      retry_classification: canRetryFromFailedState(state) ? "EVALUATOR_RETRY_FROM_DEV_WORKER_DONE" : "",
      errors: stage.errors
    });
  }

  const next = updateEvaluatorCheckpoint(state, {
    status: "PASS",
    thread_id: stage.evaluator_thread_id,
    eval_report_path: stage.eval_report_path,
    eval_verdict: stage.eval_verdict
  });
  writeSdkCheckpointState(next, statePath);
  return finish({
    status: "PASS",
    current_stage: next.current_stage,
    real_sdk_run_executed: !mockMode,
    evaluator_thread_started: true,
    evaluator_thread_id: stage.evaluator_thread_id,
    eval_verdict: stage.eval_verdict,
    failure_category: "",
    retry_classification: canRetryFromFailedState(state) ? "EVALUATOR_RETRY_FROM_DEV_WORKER_DONE" : "",
    errors: []
  });
}

function canRunEvaluator(state: NonNullable<ReturnType<typeof readSdkCheckpointState>>): boolean {
  if (state.current_stage === "DEV_WORKER_DONE") return true;
  return canRetryFromFailedState(state);
}

function canRetryFromFailedState(state: NonNullable<ReturnType<typeof readSdkCheckpointState>>): boolean {
  return (
    state.current_stage === "FAILED" &&
    state.planner.status === "PASS" &&
    state.dev_worker.status === "PASS" &&
    state.dev_worker.tests_passed === true &&
    (state.evaluator.status === "" || state.evaluator.status === "FAILED")
  );
}

function blocked(status: string, message: string, currentStage = "FAILED"): Record<string, unknown> {
  return {
    status,
    current_stage: currentStage,
    real_sdk_run_executed: false,
    evaluator_thread_started: false,
    evaluator_thread_id: "",
    eval_verdict: "",
    failure_category: status,
    errors: [message]
  };
}

function mockAdapter(): {
  runThreadStreamed(input: RuntimeThreadInput): Promise<RuntimeThreadResult>;
  runThread(input: RuntimeThreadInput): Promise<RuntimeThreadResult>;
  startThread(input: RuntimeThreadInput): Promise<RuntimeThreadResult>;
  resumeThread(input: RuntimeThreadRefInput): Promise<RuntimeThreadResult>;
  getThreadEvents(input: RuntimeEventsInput): Promise<{ thread_id: string; events_path: string; events: unknown[]; errors: string[] }>;
  stopThread(input: RuntimeStopThreadInput): Promise<RuntimeThreadResult>;
  getFinalResponse(input: RuntimeFinalResponseInput): Promise<RuntimeThreadResult>;
} {
  const result = (input: RuntimeThreadInput): RuntimeThreadResult => {
    const eventsPath = input.error_capture_paths?.events_path ?? "";
    if (eventsPath) {
      mkdirSync(dirname(eventsPath), { recursive: true });
      writeFileSync(eventsPath, "{\"type\":\"thread.started\",\"thread_id\":\"thread_checkpoint_evaluator_mock\"}\n", "utf8");
    }
    return {
      thread_id: "thread_checkpoint_evaluator_mock",
      role: "evaluator",
      status: "PASS",
      final_response: JSON.stringify({
        status: "PASS",
        verdict: "PASS",
        findings_json: "[]",
        validation_commands_checked: ["npm test"],
        summary: "Acceptance criteria and test evidence pass."
      }),
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
    resumeThread: async (input) => result({ role: "evaluator", loop_run_id: input.loop_run_id, task_id: input.task_id, prompt: input.prompt ?? "", sandbox: "read-only", working_directory: input.working_directory ?? "", timeout_ms: 180_000, output_schema_path: "", env: {} }),
    getThreadEvents: async (input) => ({ thread_id: input.thread_id, events_path: input.events_path ?? "", events: [], errors: [] }),
    stopThread: async (input) => ({ ...result({ role: "evaluator", loop_run_id: "", task_id: "", prompt: "", sandbox: "read-only", working_directory: "", timeout_ms: 180_000, output_schema_path: "", env: {} }), thread_id: input.thread_id }),
    getFinalResponse: async (input) => ({ ...result({ role: "evaluator", loop_run_id: "", task_id: "", prompt: "", sandbox: "read-only", working_directory: "", timeout_ms: 180_000, output_schema_path: "", env: {} }), thread_id: input.thread_id })
  };
}

function finish(value: Record<string, unknown>): void {
  mkdirSync(dirname(resultPath), { recursive: true });
  writeFileSync(resultPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  process.exitCode = value.status === "PASS" || value.status === "BLOCKED_SDK_EVALUATOR_NOT_ENABLED" || value.status === "BLOCKED_DEV_WORKER_CHECKPOINT_MISSING" ? 0 : 2;
}

main().catch((error: unknown) => {
  finish({
    status: "FAILED",
    current_stage: "FAILED",
    real_sdk_run_executed: false,
    evaluator_thread_started: false,
    evaluator_thread_id: "",
    eval_verdict: "",
    failure_category: "UNHANDLED_ERROR",
    errors: [error instanceof Error ? error.message : String(error)]
  });
});
