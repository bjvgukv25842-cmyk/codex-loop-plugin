import { describe, expect, it } from "vitest";

import {
  InvalidSdkLoopTransitionError,
  assertSdkLoopTransition,
  validateArtifactRuntimeEvidence,
  type SdkLoopEvidence
} from "../../src/orchestrator/sdk-loop-state-machine.ts";

describe("SDK loop state machine", () => {
  it("allows the full gated repair loop when evidence exists", () => {
    const evidence: SdkLoopEvidence = {
      planner_thread_id: "thread_planner",
      prd_artifact: "docs/PRD.md",
      task_graph_artifact: "docs/TASK_GRAPH.json",
      dev_thread_id: "thread_dev",
      dev_result_artifact: "artifacts/dev-result.json",
      initial_eval_verdict: "NEEDS_REVISION",
      initial_eval_artifact: "artifacts/eval-report-needs-revision.json",
      repair_request_artifact: "artifacts/repair-request.json",
      repair_dev_thread_id: "thread_repair",
      repair_result_artifact: "artifacts/dev-repair-result.json",
      final_eval_verdict: "PASS",
      final_eval_artifact: "artifacts/eval-report-pass.json",
      tests_passed: true
    };

    expect(() => assertSdkLoopTransition("VERIFY_PLANNER_ARTIFACTS", "RUN_DEV_WORKER_THREAD", evidence)).not.toThrow();
    expect(() => assertSdkLoopTransition("VERIFY_DEV_RESULT", "RUN_INITIAL_EVALUATOR_THREAD", evidence)).not.toThrow();
    expect(() => assertSdkLoopTransition("VERIFY_INITIAL_EVAL", "CREATE_REPAIR_REQUEST", evidence)).not.toThrow();
    expect(() => assertSdkLoopTransition("CREATE_REPAIR_REQUEST", "RUN_REPAIR_DEV_WORKER_THREAD", evidence)).not.toThrow();
    expect(() => assertSdkLoopTransition("VERIFY_REPAIR_RESULT", "RUN_FINAL_EVALUATOR_THREAD", evidence)).not.toThrow();
    expect(() => assertSdkLoopTransition("VERIFY_FINAL_EVAL_PASS", "RUN_FINAL_VALIDATION", evidence)).not.toThrow();
    expect(() => assertSdkLoopTransition("RUN_FINAL_VALIDATION", "WRITE_FINAL_REPORT", evidence)).not.toThrow();
  });

  it("blocks dev without planner thread id", () => {
    expect(() =>
      assertSdkLoopTransition("VERIFY_PLANNER_ARTIFACTS", "RUN_DEV_WORKER_THREAD", {
        prd_artifact: "docs/PRD.md",
        task_graph_artifact: "docs/TASK_GRAPH.json"
      })
    ).toThrow(InvalidSdkLoopTransitionError);
  });

  it("blocks FinalReport without final PASS and passing tests", () => {
    expect(() =>
      assertSdkLoopTransition("VERIFY_FINAL_EVAL_PASS", "RUN_FINAL_VALIDATION", {
        final_eval_verdict: "NEEDS_REVISION",
        final_eval_artifact: "artifacts/eval-report-needs-revision.json"
      })
    ).toThrow(/final_eval_verdict=PASS/);

    expect(() =>
      assertSdkLoopTransition("RUN_FINAL_VALIDATION", "WRITE_FINAL_REPORT", {
        final_eval_verdict: "PASS",
        final_eval_artifact: "artifacts/eval-report-pass.json",
        tests_passed: false
      })
    ).toThrow(/tests_passed=true/);
  });

  it("requires SDK artifact role and thread evidence", () => {
    expect(
      validateArtifactRuntimeEvidence({
        artifact_path: "artifacts/dev-result.json",
        created_by_runtime: "sdk-orchestrated",
        created_by_role: "dev_worker",
        created_by_thread_id: "thread_dev",
        created_by_thread_run_id: "sdk_thread_run_dev"
      })
    ).toEqual([]);
  });
});
