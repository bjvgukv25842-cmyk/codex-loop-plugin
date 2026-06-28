import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import {
  DEFAULT_SDK_CHECKPOINT_STATE_PATH,
  failSdkCheckpointState,
  readSdkCheckpointState,
  updateDevWorkerCheckpoint,
  writeSdkCheckpointState
} from "../../src/orchestrator/sdk-checkpoint-state.ts";
import { runDevWorkerStage } from "../../src/orchestrator/sdk-dev-worker-stage.ts";
import { ensureEvalSqliteHome } from "../../src/runtime/eval-sqlite-home.ts";
import { SdkRuntimeAdapter } from "../../src/runtime/sdk-runtime-adapter.ts";
import type { RuntimeEventsInput, RuntimeFinalResponseInput, RuntimeStopThreadInput, RuntimeThreadInput, RuntimeThreadRefInput, RuntimeThreadResult } from "../../src/runtime/runtime-types.ts";

const repoRoot = process.cwd();
const statePath = process.env.CODEX_LOOP_GATE6B_CHECKPOINT_STATE_PATH
  ? resolve(process.env.CODEX_LOOP_GATE6B_CHECKPOINT_STATE_PATH)
  : resolve(repoRoot, DEFAULT_SDK_CHECKPOINT_STATE_PATH);
const resultPath = resolve(repoRoot, "evals/sdk-orchestrated/reports/gate6b-checkpoint-dev-worker-result.json");
const reportDir = resolve(repoRoot, "evals/sdk-orchestrated/reports/sdk-startup-triage");

async function main(): Promise<void> {
  const state = readSdkCheckpointState(statePath);
  if (!state) {
    return finish(blocked("CHECKPOINT_STATE_INVALID", "Run npm run gate6b:checkpoint:prepare first."));
  }
  if (state.current_stage !== "PLANNER_DONE") {
    return finish(blocked("BLOCKED_PLANNER_CHECKPOINT_MISSING", "Planner checkpoint must be PLANNER_DONE before dev_worker.", state.current_stage));
  }

  const mockMode = process.env.CODEX_LOOP_GATE6B_CHECKPOINT_MOCK;
  if (process.env.CODEX_LOOP_ENABLE_REAL_SDK_DEV_WORKER !== "1" && !mockMode) {
    return finish(blocked("BLOCKED_SDK_NOT_ENABLED", "Set CODEX_LOOP_ENABLE_REAL_SDK_DEV_WORKER=1 only for one controlled checkpoint dev_worker run.", state.current_stage));
  }

  const targetRepo = resolve(repoRoot, state.target_repo);
  const sqliteHome = ensureEvalSqliteHome(repoRoot);
  const adapter = mockMode ? mockAdapter() : new SdkRuntimeAdapter({ enableRealRun: true, repoRoot });
  const stage = await runDevWorkerStage({
    loop_run_id: "loop_gate6b_checkpoint",
    task_id: "task_validate_project_name",
    target_repo: targetRepo,
    prd_path: state.planner.prd_path || "docs/PRD.md",
    task_graph_path: state.planner.task_graph_path || "docs/TASK_GRAPH.json",
    model: process.env.CODEX_LOOP_CODEX_MODEL,
    model_catalog_json: process.env.CODEX_LOOP_MODEL_CATALOG_JSON,
    sqlite_home: sqliteHome.path,
    sandbox: "workspace-write",
    timeout_ms: 180_000,
    runtime_adapter: adapter,
    repo_root: repoRoot,
    report_dir: reportDir,
    invocation_trace_path: resolve(reportDir, "gate6b-checkpoint-dev-worker-invocation-trace-redacted.json"),
    invocation_trace_label: "gate6b-checkpoint-dev-worker",
    events_path: resolve(reportDir, "gate6b-checkpoint-dev-worker-events.jsonl"),
    stdout_path: resolve(reportDir, "gate6b-checkpoint-dev-worker-stdout.log"),
    stderr_path: resolve(reportDir, "gate6b-checkpoint-dev-worker-stderr.log"),
    result_path: resultPath
  });

  if (stage.status !== "PASS") {
    writeSdkCheckpointState(failSdkCheckpointState(state, stage.errors), statePath);
    return finish({
      status: "DEV_WORKER_STAGE_FAILED",
      current_stage: "FAILED",
      real_sdk_run_executed: !mockMode,
      dev_worker_thread_started: stage.dev_worker_thread_started,
      dev_worker_thread_id: stage.dev_worker_thread_id,
      failure_category: stage.failure_category,
      errors: stage.errors
    });
  }

  const next = updateDevWorkerCheckpoint(state, {
    status: "PASS",
    thread_id: stage.dev_worker_thread_id,
    dev_result_path: stage.dev_result_path,
    file_change_verified: stage.file_change_verified,
    tests_passed: stage.tests_passed
  });
  writeSdkCheckpointState(next, statePath);
  return finish({
    status: "PASS",
    current_stage: next.current_stage,
    real_sdk_run_executed: !mockMode,
    dev_worker_thread_started: true,
    dev_worker_thread_id: stage.dev_worker_thread_id,
    file_change_verified: stage.file_change_verified,
    tests_passed: stage.tests_passed,
    failure_category: "",
    errors: []
  });
}

function blocked(status: string, message: string, currentStage = "FAILED"): Record<string, unknown> {
  return {
    status,
    current_stage: currentStage,
    real_sdk_run_executed: false,
    dev_worker_thread_started: false,
    dev_worker_thread_id: "",
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
    writeFixedSource(resolve(input.working_directory));
    const eventsPath = input.error_capture_paths?.events_path ?? "";
    if (eventsPath) {
      mkdirSync(dirname(eventsPath), { recursive: true });
      writeFileSync(eventsPath, "{\"type\":\"thread.started\",\"thread_id\":\"thread_checkpoint_dev_worker_mock\"}\n", "utf8");
    }
    return {
      thread_id: "thread_checkpoint_dev_worker_mock",
      role: "dev_worker",
      status: "PASS",
      final_response: JSON.stringify({
        status: "PASS",
        changed_files: ["src/project-name.js"],
        tests_run: ["npm test"],
        tests_passed: true,
        summary: "Fixed validateProjectName."
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
    resumeThread: async (input) => result({ role: "dev_worker", loop_run_id: input.loop_run_id, task_id: input.task_id, prompt: input.prompt ?? "", sandbox: "workspace-write", working_directory: input.working_directory ?? "", timeout_ms: 180_000, output_schema_path: "", env: {} }),
    getThreadEvents: async (input) => ({ thread_id: input.thread_id, events_path: input.events_path ?? "", events: [], errors: [] }),
    stopThread: async (input) => ({ ...result({ role: "dev_worker", loop_run_id: "", task_id: "", prompt: "", sandbox: "workspace-write", working_directory: "", timeout_ms: 180_000, output_schema_path: "", env: {} }), thread_id: input.thread_id }),
    getFinalResponse: async (input) => ({ ...result({ role: "dev_worker", loop_run_id: "", task_id: "", prompt: "", sandbox: "workspace-write", working_directory: "", timeout_ms: 180_000, output_schema_path: "", env: {} }), thread_id: input.thread_id })
  };
}

function writeFixedSource(targetRepo: string): void {
  const path = resolve(targetRepo, "src/project-name.js");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    [
      "export function validateProjectName(name) {",
      "  if (typeof name !== \"string\") return { ok: false, reason: \"name must be a string\" };",
      "  if (name.trim().length === 0) return { ok: false, reason: \"name is required\" };",
      "  if (name.length > 80) return { ok: false, reason: \"name is too long\" };",
      "  return { ok: true };",
      "}",
      ""
    ].join("\n"),
    "utf8"
  );
}

function finish(value: Record<string, unknown>): void {
  mkdirSync(dirname(resultPath), { recursive: true });
  writeFileSync(resultPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  process.exitCode = value.status === "PASS" || value.status === "BLOCKED_SDK_NOT_ENABLED" || value.status === "BLOCKED_PLANNER_CHECKPOINT_MISSING" ? 0 : 2;
}

main().catch((error: unknown) => {
  finish({
    status: "FAILED",
    current_stage: "FAILED",
    real_sdk_run_executed: false,
    dev_worker_thread_started: false,
    dev_worker_thread_id: "",
    failure_category: "UNHANDLED_ERROR",
    errors: [error instanceof Error ? error.message : String(error)]
  });
});
