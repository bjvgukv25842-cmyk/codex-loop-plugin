import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import {
  DEFAULT_SDK_CHECKPOINT_STATE_PATH,
  failSdkCheckpointState,
  readSdkCheckpointState,
  updatePlannerCheckpoint,
  writeSdkCheckpointState
} from "../../src/orchestrator/sdk-checkpoint-state.ts";
import { runPlannerLiteStage } from "../../src/orchestrator/sdk-planner-lite-stage.ts";
import { ensureEvalSqliteHome } from "../../src/runtime/eval-sqlite-home.ts";
import { SdkRuntimeAdapter } from "../../src/runtime/sdk-runtime-adapter.ts";
import type { RuntimeEventsInput, RuntimeFinalResponseInput, RuntimeStopThreadInput, RuntimeThreadInput, RuntimeThreadRefInput, RuntimeThreadResult } from "../../src/runtime/runtime-types.ts";

const repoRoot = process.cwd();
const statePath = process.env.CODEX_LOOP_GATE6B_CHECKPOINT_STATE_PATH
  ? resolve(process.env.CODEX_LOOP_GATE6B_CHECKPOINT_STATE_PATH)
  : resolve(repoRoot, DEFAULT_SDK_CHECKPOINT_STATE_PATH);
const resultPath = resolve(repoRoot, "evals/sdk-orchestrated/reports/gate6b-checkpoint-planner-result.json");
const reportDir = resolve(repoRoot, "evals/sdk-orchestrated/reports/sdk-startup-triage");

async function main(): Promise<void> {
  const state = readSdkCheckpointState(statePath);
  if (!state) {
    return finish({
      status: "CHECKPOINT_STATE_INVALID",
      current_stage: "FAILED",
      real_sdk_run_executed: false,
      planner_thread_started: false,
      planner_thread_id: "",
      failure_category: "CHECKPOINT_STATE_INVALID",
      errors: ["Run npm run gate6b:checkpoint:prepare first."]
    });
  }

  const mockMode = process.env.CODEX_LOOP_GATE6B_CHECKPOINT_MOCK;
  if (process.env.CODEX_LOOP_ENABLE_REAL_SDK_PLANNER !== "1" && !mockMode) {
    return finish({
      status: "BLOCKED_SDK_NOT_ENABLED",
      current_stage: state.current_stage,
      real_sdk_run_executed: false,
      planner_thread_started: false,
      planner_thread_id: "",
      failure_category: "BLOCKED_SDK_NOT_ENABLED",
      errors: ["Set CODEX_LOOP_ENABLE_REAL_SDK_PLANNER=1 only for one controlled checkpoint planner run."]
    });
  }

  const targetRepo = resolve(repoRoot, state.target_repo);
  const sqliteHome = ensureEvalSqliteHome(repoRoot);
  const adapter = mockMode ? mockAdapter("planner") : new SdkRuntimeAdapter({ enableRealRun: true, repoRoot });
  const stage = await runPlannerLiteStage({
    loop_run_id: "loop_gate6b_checkpoint",
    task_id: "task_validate_project_name",
    target_repo: targetRepo,
    model: process.env.CODEX_LOOP_CODEX_MODEL,
    model_catalog_json: process.env.CODEX_LOOP_MODEL_CATALOG_JSON,
    sqlite_home: sqliteHome.path,
    sandbox: "read-only",
    timeout_ms: 180_000,
    runtime_adapter: adapter,
    repo_root: repoRoot,
    report_dir: reportDir,
    invocation_trace_path: resolve(reportDir, "gate6b-checkpoint-planner-invocation-trace-redacted.json"),
    invocation_trace_label: "gate6b-checkpoint-planner",
    events_path: resolve(reportDir, "gate6b-checkpoint-planner-events.jsonl"),
    stdout_path: resolve(reportDir, "gate6b-checkpoint-planner-stdout.log"),
    stderr_path: resolve(reportDir, "gate6b-checkpoint-planner-stderr.log"),
    result_path: resultPath
  });

  if (stage.status !== "PASS") {
    writeSdkCheckpointState(failSdkCheckpointState(state, stage.errors), statePath);
    return finish({
      status: "PLANNER_LITE_STAGE_FAILED",
      current_stage: "FAILED",
      real_sdk_run_executed: !mockMode,
      planner_thread_started: stage.planner_thread_started,
      planner_thread_id: stage.planner_thread_id,
      failure_category: stage.failure_category,
      errors: stage.errors
    });
  }

  const next = updatePlannerCheckpoint(state, {
    status: "PASS",
    thread_id: stage.planner_thread_id,
    prd_path: stage.prd_path,
    task_graph_path: stage.task_graph_path,
    planner_result_path: stage.planner_result_path,
    artifact_thread_evidence_verified: stage.artifact_thread_evidence_verified
  });
  writeSdkCheckpointState(next, statePath);
  return finish({
    status: "PASS",
    current_stage: next.current_stage,
    real_sdk_run_executed: !mockMode,
    planner_thread_started: true,
    planner_thread_id: stage.planner_thread_id,
    failure_category: "",
    errors: []
  });
}

function mockAdapter(role: "planner"): {
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
      writeFileSync(eventsPath, "{\"type\":\"thread.started\",\"thread_id\":\"thread_checkpoint_planner_mock\"}\n", "utf8");
    }
    return {
      thread_id: "thread_checkpoint_planner_mock",
      role,
      status: "PASS",
      final_response: JSON.stringify({
        status: "PASS",
        prd_markdown: "# PRD\n\nValidate project names.",
        task_graph_json: readFileSync(resolve(repoRoot, "tests/fixtures/planner-lite/raw-task-graph-with-id.json"), "utf8"),
        acceptance_criteria: ["Reject invalid names", "Accept valid names"],
        risks: []
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
    resumeThread: async (input) => result({ role, loop_run_id: input.loop_run_id, task_id: input.task_id, prompt: input.prompt ?? "", sandbox: "read-only", working_directory: input.working_directory ?? "", timeout_ms: 180_000, output_schema_path: "", env: {} }),
    getThreadEvents: async (input) => ({ thread_id: input.thread_id, events_path: input.events_path ?? "", events: [], errors: [] }),
    stopThread: async (input) => ({ ...result({ role, loop_run_id: "", task_id: "", prompt: "", sandbox: "read-only", working_directory: "", timeout_ms: 180_000, output_schema_path: "", env: {} }), thread_id: input.thread_id }),
    getFinalResponse: async (input) => ({ ...result({ role, loop_run_id: "", task_id: "", prompt: "", sandbox: "read-only", working_directory: "", timeout_ms: 180_000, output_schema_path: "", env: {} }), thread_id: input.thread_id })
  };
}

function finish(value: Record<string, unknown>): void {
  mkdirSync(dirname(resultPath), { recursive: true });
  writeFileSync(resultPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  process.exitCode = value.status === "PASS" || value.status === "BLOCKED_SDK_NOT_ENABLED" ? 0 : 2;
}

main().catch((error: unknown) => {
  finish({
    status: "FAILED",
    current_stage: "FAILED",
    real_sdk_run_executed: false,
    planner_thread_started: false,
    planner_thread_id: "",
    failure_category: "UNHANDLED_ERROR",
    errors: [error instanceof Error ? error.message : String(error)]
  });
});
