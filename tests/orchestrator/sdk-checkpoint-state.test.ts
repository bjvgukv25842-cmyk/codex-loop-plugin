import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  createSdkCheckpointState,
  readSdkCheckpointState,
  updateDevWorkerCheckpoint,
  updateEvaluatorCheckpoint,
  updatePlannerCheckpoint,
  writeSdkCheckpointState
} from "../../src/orchestrator/sdk-checkpoint-state.ts";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("sdk checkpoint state", () => {
  it("creates and reads initial PREPARED state", () => {
    const path = tempPath();
    const state = createSdkCheckpointState("tmp/sdk-target");

    writeSdkCheckpointState(state, path);
    const read = readSdkCheckpointState(path);

    expect(read?.gate).toBe("Gate 6B.1L Checkpointed SDK Smoke");
    expect(read?.current_stage).toBe("PREPARED");
    expect(read?.planner.thread_id).toBe("");
  });

  it("records planner, dev worker, and evaluator checkpoints", () => {
    const state = createSdkCheckpointState("tmp/sdk-target");
    const planner = updatePlannerCheckpoint(state, {
      status: "PASS",
      thread_id: "thread_planner",
      prd_path: "docs/PRD.md",
      task_graph_path: "docs/TASK_GRAPH.json",
      planner_result_path: "artifacts/planner-result.json",
      artifact_thread_evidence_verified: true
    });
    const devWorker = updateDevWorkerCheckpoint(planner, {
      status: "PASS",
      thread_id: "thread_dev",
      dev_result_path: "artifacts/dev-result.json",
      file_change_verified: true,
      tests_passed: true
    });
    const evaluator = updateEvaluatorCheckpoint(devWorker, {
      status: "PASS",
      thread_id: "thread_eval",
      eval_report_path: "artifacts/eval-report.json",
      eval_verdict: "PASS"
    });

    expect(planner.current_stage).toBe("PLANNER_DONE");
    expect(devWorker.current_stage).toBe("DEV_WORKER_DONE");
    expect(evaluator.current_stage).toBe("EVALUATOR_DONE");
  });
});

function tempPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "checkpoint-state-test-"));
  tempDirs.push(dir);
  return resolve(dir, "state.json");
}
