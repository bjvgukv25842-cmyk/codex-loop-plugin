import { describe, expect, it } from "vitest";

import { expectedArtifactsForMode, gradeArtifactCompleteness } from "../../evals/effectiveness/graders/artifact-completeness-grader.ts";
import type { M12RunResult } from "../../scripts/effectiveness/types.ts";

describe("artifact completeness grader", () => {
  it("does not require treatment artifacts for baseline", () => {
    const result = sampleRun({
      variant: "baseline",
      expected_artifacts: ["artifacts/FinalDeliveryReport.md"],
      baseline_expected_artifacts: [],
      artifacts: []
    });

    expect(expectedArtifactsForMode(result)).toEqual([]);
    expect(gradeArtifactCompleteness(result).status).toBe("PASS");
  });

  it("requires treatment FinalDeliveryReport when configured", () => {
    const result = sampleRun({
      variant: "treatment",
      expected_artifacts: [],
      treatment_expected_artifacts: ["artifacts/FinalDeliveryReport.md"],
      artifacts: []
    });

    const grade = gradeArtifactCompleteness(result);
    expect(expectedArtifactsForMode(result)).toContain("artifacts/FinalDeliveryReport.md");
    expect(grade.status).toBe("FAIL");
  });

  it("does not require repair artifacts for bugfix direct PASS path", () => {
    const result = sampleRun({
      case_id: "bugfix-small-001",
      variant: "treatment",
      evaluator_verdict: "PASS",
      final_eval_verdict: "PASS",
      planner_thread_id: "planner",
      dev_worker_thread_id: "dev",
      initial_evaluator_thread_id: "eval",
      treatment_expected_artifacts: [
        "docs/PRD.md",
        "docs/TASK_GRAPH.json",
        "artifacts/dev-result.json",
        "artifacts/eval-report.json",
        "artifacts/repair-request.json",
        "artifacts/repair-result.json",
        "artifacts/FinalDeliveryReport.md"
      ],
      artifacts: [
        "docs/PRD.md",
        "docs/TASK_GRAPH.json",
        "artifacts/dev-result.json",
        "artifacts/final-eval-report.json",
        "artifacts/FinalDeliveryReport.md"
      ]
    });

    expect(expectedArtifactsForMode(result)).not.toContain("artifacts/repair-request.json");
    expect(gradeArtifactCompleteness(result).status).toBe("PASS");
  });

  it("does not require repair artifacts for docs direct PASS path", () => {
    const result = sampleRun({
      case_id: "docs-update-001",
      variant: "treatment",
      evaluator_verdict: "PASS",
      final_eval_verdict: "PASS",
      planner_thread_id: "planner",
      dev_worker_thread_id: "dev",
      initial_evaluator_thread_id: "eval",
      treatment_expected_artifacts: [
        "docs/PRD.md",
        "docs/TASK_GRAPH.json",
        "artifacts/dev-result.json",
        "artifacts/eval-report.json",
        "artifacts/repair-request.json",
        "artifacts/repair-result.json",
        "artifacts/FinalDeliveryReport.md"
      ],
      artifacts: [
        "docs/PRD.md",
        "docs/TASK_GRAPH.json",
        "artifacts/dev-result.json",
        "artifacts/eval-report.json",
        "artifacts/FinalDeliveryReport.md"
      ]
    });

    expect(expectedArtifactsForMode(result)).not.toContain("artifacts/repair-request.json");
    expect(gradeArtifactCompleteness(result).status).toBe("PASS");
  });

  it("does not require repair artifacts for feature-small-002 direct PASS path", () => {
    const result = sampleRun({
      case_id: "feature-small-002",
      variant: "treatment",
      evaluator_verdict: "PASS",
      final_eval_verdict: "PASS",
      planner_thread_id: "planner",
      dev_worker_thread_id: "dev",
      initial_evaluator_thread_id: "eval",
      treatment_expected_artifacts: [
        "docs/PRD.md",
        "docs/TASK_GRAPH.json",
        "artifacts/dev-result.json",
        "artifacts/eval-report.json",
        "artifacts/FinalDeliveryReport.md",
        "artifacts/repair-request.json",
        "artifacts/repair-result.json",
        "artifacts/final-eval-report.json"
      ],
      artifacts: [
        "docs/PRD.md",
        "docs/TASK_GRAPH.json",
        "artifacts/dev-result.json",
        "artifacts/eval-report.json",
        "artifacts/FinalDeliveryReport.md"
      ]
    });

    expect(expectedArtifactsForMode(result)).not.toContain("artifacts/repair-request.json");
    expect(gradeArtifactCompleteness(result).status).toBe("PASS");
  });

  it("does not require repair artifacts for adversarial direct PASS path", () => {
    const result = sampleRun({
      case_id: "adversarial-prompt-injection-001",
      variant: "treatment",
      evaluator_verdict: "PASS",
      final_eval_verdict: "PASS",
      planner_thread_id: "planner",
      dev_worker_thread_id: "dev",
      initial_evaluator_thread_id: "eval",
      treatment_expected_artifacts: [
        "docs/PRD.md",
        "docs/TASK_GRAPH.json",
        "artifacts/dev-result.json",
        "artifacts/eval-report.json",
        "artifacts/security-scan-report.json",
        "artifacts/FinalDeliveryReport.md",
        "artifacts/repair-request.json",
        "artifacts/repair-result.json",
        "artifacts/final-eval-report.json"
      ],
      artifacts: [
        "docs/PRD.md",
        "docs/TASK_GRAPH.json",
        "artifacts/dev-result.json",
        "artifacts/eval-report.json",
        "artifacts/security-scan-report.json",
        "artifacts/FinalDeliveryReport.md"
      ]
    });

    expect(expectedArtifactsForMode(result)).not.toContain("artifacts/repair-request.json");
    expect(gradeArtifactCompleteness(result).status).toBe("PASS");
  });
});

function sampleRun(overrides: Partial<M12RunResult>): M12RunResult {
  return {
    case_id: "case",
    variant: "baseline",
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
    duration_ms: 0,
    thread_count: 0,
    command_count: 0,
    errors: [],
    ...overrides
  };
}
