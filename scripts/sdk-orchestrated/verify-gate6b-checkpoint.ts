import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import {
  DEFAULT_SDK_CHECKPOINT_STATE_PATH,
  readSdkCheckpointState
} from "../../src/orchestrator/sdk-checkpoint-state.ts";
import type { SdkCheckpointVerifyStatus } from "../../src/orchestrator/sdk-checkpoint-types.ts";

const repoRoot = process.cwd();
const statePath = process.env.CODEX_LOOP_GATE6B_CHECKPOINT_STATE_PATH
  ? resolve(process.env.CODEX_LOOP_GATE6B_CHECKPOINT_STATE_PATH)
  : resolve(repoRoot, DEFAULT_SDK_CHECKPOINT_STATE_PATH);
const verifyPath = resolve(repoRoot, "evals/sdk-orchestrated/reports/gate6b-checkpoint-verify.json");

function main(): void {
  const state = readSdkCheckpointState(statePath);
  if (!state) {
    return finish({
      status: "CHECKPOINT_STATE_INVALID",
      current_stage: "FAILED",
      ready_for_gate6b_2: false,
      errors: ["Checkpoint state is missing or invalid."]
    });
  }

  const missingArtifacts = requiredArtifactPaths(state).filter((path) => !checkpointArtifactExists(state.target_repo, path));
  if (missingArtifacts.length > 0) {
    return finish({
      status: "CHECKPOINT_ARTIFACT_MISSING",
      current_stage: state.current_stage,
      ready_for_gate6b_2: false,
      missing_artifacts: missingArtifacts,
      errors: [`Missing checkpoint artifacts: ${missingArtifacts.join(", ")}`]
    });
  }

  const status = verifyStatus(state);
  return finish({
    status,
    current_stage: state.current_stage,
    planner_thread_id: state.planner.thread_id,
    dev_worker_thread_id: state.dev_worker.thread_id,
    evaluator_thread_id: state.evaluator.thread_id,
    planner_artifact_thread_evidence_verified: state.planner.artifact_thread_evidence_verified,
    dev_worker_file_change_verified: state.dev_worker.file_change_verified,
    dev_worker_tests_passed: state.dev_worker.tests_passed,
    evaluator_eval_verdict: state.evaluator.eval_verdict,
    evaluator_retry_from_dev_worker_done: canRetryEvaluator(state),
    ready_for_gate6b_2: status === "PASS",
    errors: status === "PASS" || status.startsWith("PARTIAL_PASS") ? [] : state.errors
  });
}

function verifyStatus(state: NonNullable<ReturnType<typeof readSdkCheckpointState>>): SdkCheckpointVerifyStatus {
  if (state.current_stage === "EVALUATOR_DONE") {
    return state.planner.thread_id &&
      state.dev_worker.thread_id &&
      state.evaluator.thread_id &&
      state.planner.artifact_thread_evidence_verified &&
      state.dev_worker.file_change_verified &&
      state.dev_worker.tests_passed &&
      state.evaluator.eval_verdict === "PASS"
      ? "PASS"
      : "EVALUATOR_STAGE_FAILED";
  }
  if (state.current_stage === "DEV_WORKER_DONE") {
    return state.dev_worker.thread_id && state.dev_worker.file_change_verified && state.dev_worker.tests_passed
      ? "PARTIAL_PASS_DEV_WORKER_ONLY"
      : "NEEDS_REVISION";
  }
  if (state.current_stage === "FAILED" && canRetryEvaluator(state)) {
    return "EVALUATOR_STAGE_FAILED";
  }
  if (state.current_stage === "PLANNER_DONE") {
    return state.planner.thread_id && state.planner.artifact_thread_evidence_verified
      ? "PARTIAL_PASS_PLANNER_ONLY"
      : "NEEDS_REVISION";
  }
  return state.current_stage === "FAILED" ? "EVALUATOR_STAGE_FAILED" : "NEEDS_REVISION";
}

function canRetryEvaluator(state: NonNullable<ReturnType<typeof readSdkCheckpointState>>): boolean {
  return (
    state.current_stage === "FAILED" &&
    state.planner.status === "PASS" &&
    state.dev_worker.status === "PASS" &&
    state.dev_worker.tests_passed === true &&
    state.dev_worker.file_change_verified === true &&
    (state.evaluator.status === "" || state.evaluator.status === "FAILED")
  );
}

function requiredArtifactPaths(state: NonNullable<ReturnType<typeof readSdkCheckpointState>>): string[] {
  const paths: string[] = [];
  if (state.current_stage === "PLANNER_DONE" || state.current_stage === "DEV_WORKER_DONE" || state.current_stage === "EVALUATOR_DONE") {
    paths.push(state.planner.prd_path, state.planner.task_graph_path, state.planner.planner_result_path);
  }
  if (state.current_stage === "DEV_WORKER_DONE" || state.current_stage === "EVALUATOR_DONE") {
    paths.push(state.dev_worker.dev_result_path);
  }
  if (state.current_stage === "EVALUATOR_DONE") {
    paths.push(state.evaluator.eval_report_path);
  }
  return paths.filter(Boolean);
}

function checkpointArtifactExists(targetRepo: string, path: string): boolean {
  if (existsSync(resolve(path))) {
    return true;
  }
  if (existsSync(resolve(repoRoot, path))) {
    return true;
  }
  return existsSync(resolve(repoRoot, targetRepo, path));
}

function finish(value: Record<string, unknown>): void {
  mkdirSync(dirname(verifyPath), { recursive: true });
  writeFileSync(verifyPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  process.exitCode = value.status === "PASS" || value.status === "PARTIAL_PASS_PLANNER_ONLY" || value.status === "PARTIAL_PASS_DEV_WORKER_ONLY" ? 0 : 2;
}

main();
