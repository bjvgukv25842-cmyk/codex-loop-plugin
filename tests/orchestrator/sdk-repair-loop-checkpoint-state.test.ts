import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  createSdkRepairLoopCheckpointState,
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

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("sdk repair-loop checkpoint state", () => {
  it("creates and reads initial PREPARED state", () => {
    const path = tempPath();
    const state = createSdkRepairLoopCheckpointState("tmp/sdk-target");

    writeSdkRepairLoopCheckpointState(state, path);
    const read = readSdkRepairLoopCheckpointState(path);

    expect(read?.gate).toBe("Gate 6B.2 SDK-Orchestrated Repair Loop E2E");
    expect(read?.current_stage).toBe("PREPARED");
    expect(read?.dev_worker.known_gap_seeded).toBe(false);
  });

  it("records the full repair-loop stage order", () => {
    const state = createSdkRepairLoopCheckpointState("tmp/sdk-target");
    const planner = updateRepairLoopPlannerCheckpoint(state, {
      status: "PASS",
      thread_id: "thread_planner",
      prd_path: "docs/PRD.md",
      task_graph_path: "docs/TASK_GRAPH.json",
      planner_result_path: "artifacts/planner-result.json",
      artifact_thread_evidence_verified: true
    });
    const dev = updateRepairLoopDevWorkerCheckpoint(planner, {
      status: "PASS",
      thread_id: "thread_dev",
      dev_result_path: "artifacts/dev-result.json",
      file_change_verified: true,
      baseline_tests_passed: true,
      full_tests_expected_to_fail: true,
      full_tests_failed: true,
      known_gap_seeded: true
    });
    const initialEval = updateRepairLoopInitialEvaluatorCheckpoint(dev, {
      status: "PASS",
      thread_id: "thread_eval_initial",
      eval_report_path: "artifacts/eval-report-needs-revision.json",
      eval_verdict: "NEEDS_REVISION"
    });
    const repairRequest = updateRepairLoopRepairRequestCheckpoint(initialEval, {
      status: "PASS",
      repair_request_path: "artifacts/repair-request.json",
      source_eval_report_path: "artifacts/eval-report-needs-revision.json",
      required_fixes_count: 1
    });
    const repair = updateRepairLoopRepairDevWorkerCheckpoint(repairRequest, {
      status: "PASS",
      thread_id: "thread_repair",
      repair_result_path: "artifacts/dev-repair-result.json",
      file_change_verified: true,
      tests_passed: true
    });
    const finalEval = updateRepairLoopFinalEvaluatorCheckpoint(repair, {
      status: "PASS",
      thread_id: "thread_eval_final",
      eval_report_path: "artifacts/eval-report-pass.json",
      eval_verdict: "PASS"
    });
    const finalReport = updateRepairLoopFinalReportCheckpoint(finalEval, {
      status: "PASS",
      path: "artifacts/FinalDeliveryReport.md"
    });

    expect(planner.current_stage).toBe("PLANNER_DONE");
    expect(dev.current_stage).toBe("DEV_DONE");
    expect(initialEval.current_stage).toBe("INITIAL_EVAL_DONE");
    expect(repairRequest.current_stage).toBe("REPAIR_REQUEST_CREATED");
    expect(repair.current_stage).toBe("REPAIR_DONE");
    expect(finalEval.current_stage).toBe("FINAL_EVAL_DONE");
    expect(finalReport.current_stage).toBe("FINAL_REPORT_DONE");
  });
});

function tempPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "repair-loop-state-test-"));
  tempDirs.push(dir);
  return resolve(dir, "state.json");
}
