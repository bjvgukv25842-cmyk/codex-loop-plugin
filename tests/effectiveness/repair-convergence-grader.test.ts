import { describe, expect, it } from "vitest";

import { gradeRepairConvergence } from "../../evals/effectiveness/graders/repair-convergence-grader.ts";
import type { M12RunResult } from "../../scripts/effectiveness/types.ts";

describe("repair convergence grader", () => {
  it("does not require repair-loop evidence from baseline runs", () => {
    const grade = gradeRepairConvergence(sampleRun({
      case_id: "repair-loop-001",
      variant: "baseline",
      initial_eval_verdict: "NEEDS_REVISION",
      final_eval_verdict: "",
      repair_request_created: false,
      repair_dev_worker_thread_id: ""
    }));

    expect(grade.status).toBe("PASS");
  });

  it("passes a bugfix direct PASS path without RepairRequest evidence", () => {
    const grade = gradeRepairConvergence(sampleRun({
      case_id: "bugfix-small-001",
      evaluator_verdict: "PASS",
      final_eval_verdict: "PASS",
      repair_request_created: false,
      repair_dev_worker_thread_id: ""
    }));

    expect(grade.status).toBe("PASS");
  });

  it("fails a NEEDS_REVISION path without RepairRequest evidence", () => {
    const grade = gradeRepairConvergence(sampleRun({
      case_id: "bugfix-small-001",
      initial_eval_verdict: "NEEDS_REVISION",
      final_eval_verdict: "PASS",
      repair_request_created: false,
      repair_dev_worker_thread_id: ""
    }));

    expect(grade.status).toBe("FAIL");
    expect(grade.severe).toBe(true);
  });
});

function sampleRun(overrides: Partial<M12RunResult>): M12RunResult {
  return {
    case_id: "bugfix-small-001",
    variant: "treatment",
    status: "PASS",
    real_run_executed: true,
    prompt: "",
    fixture_repo: "",
    acceptance_criteria: [],
    validation_commands: [],
    expected_artifacts: [],
    forbidden_files: [],
    changed_files: [],
    artifacts: [],
    validation_logs: [],
    planner_thread_id: "planner",
    dev_worker_thread_id: "dev",
    initial_evaluator_thread_id: "initial_eval",
    validation_passed: true,
    final_report_path: "artifacts/FinalDeliveryReport.md",
    duration_ms: 0,
    thread_count: 0,
    command_count: 0,
    errors: [],
    ...overrides
  };
}
