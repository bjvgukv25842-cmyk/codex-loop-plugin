import { describe, expect, it } from "vitest";

import { evaluateThreadEvidence } from "../../src/effectiveness/thread-evidence-policy.ts";
import type { M12RunResult } from "../../scripts/effectiveness/types.ts";

describe("thread evidence policy", () => {
  it("requires repair evidence for repair-loop cases", () => {
    const policy = evaluateThreadEvidence({ case_id: "repair-loop-001", category: "repair-loop" }, sampleTreatment({
      initial_eval_verdict: "NEEDS_REVISION",
      final_eval_verdict: "PASS",
      planner_thread_id: "planner",
      dev_worker_thread_id: "dev",
      initial_evaluator_thread_id: "initial_eval",
      final_evaluator_thread_id: "final_eval"
    }));

    expect(policy.policy).toBe("repair-required");
    expect(policy.repair_path_required).toBe(true);
    expect(policy.missing_required_roles).toEqual(["repair_dev_worker"]);
  });

  it("allows bugfix direct PASS without repair thread evidence", () => {
    const policy = evaluateThreadEvidence({ case_id: "bugfix-small-001", category: "bugfix-small" }, sampleTreatment({
      evaluator_verdict: "PASS",
      final_eval_verdict: "PASS",
      planner_thread_id: "planner",
      dev_worker_thread_id: "dev",
      initial_evaluator_thread_id: "initial_eval"
    }));

    expect(policy.policy).toBe("direct-pass");
    expect(policy.repair_path_required).toBe(false);
    expect(policy.required_thread_roles).toEqual(["planner", "dev_worker", "evaluator"]);
    expect(policy.missing_required_roles).toEqual([]);
  });

  it("allows feature direct PASS without repair thread evidence", () => {
    const policy = evaluateThreadEvidence({ case_id: "feature-small-001", category: "feature-small" }, sampleTreatment({
      final_eval_verdict: "PASS",
      planner_thread_id: "planner",
      dev_worker_thread_id: "dev",
      final_evaluator_thread_id: "final_eval"
    }));

    expect(policy.policy).toBe("direct-pass");
    expect(policy.missing_required_roles).toEqual([]);
  });

  it("allows test-coverage direct PASS without repair thread evidence", () => {
    const policy = evaluateThreadEvidence({ case_id: "test-coverage-001", category: "test-coverage" }, sampleTreatment({
      case_id: "test-coverage-001",
      final_eval_verdict: "PASS",
      planner_thread_id: "planner",
      dev_worker_thread_id: "dev",
      initial_evaluator_thread_id: "initial_eval"
    }));

    expect(policy.policy).toBe("direct-pass");
    expect(policy.repair_path_required).toBe(false);
    expect(policy.missing_required_roles).toEqual([]);
  });

  it("allows docs direct PASS without repair thread evidence", () => {
    const policy = evaluateThreadEvidence({ case_id: "docs-update-001", category: "docs-update" }, sampleTreatment({
      case_id: "docs-update-001",
      final_eval_verdict: "PASS",
      planner_thread_id: "planner",
      dev_worker_thread_id: "dev",
      initial_evaluator_thread_id: "initial_eval"
    }));

    expect(policy.policy).toBe("direct-pass");
    expect(policy.repair_path_required).toBe(false);
    expect(policy.missing_required_roles).toEqual([]);
  });

  it("allows refactor direct PASS without repair thread evidence", () => {
    const policy = evaluateThreadEvidence({ case_id: "refactor-small-001", category: "refactor-small" }, sampleTreatment({
      case_id: "refactor-small-001",
      final_eval_verdict: "PASS",
      planner_thread_id: "planner",
      dev_worker_thread_id: "dev",
      initial_evaluator_thread_id: "initial_eval"
    }));

    expect(policy.policy).toBe("direct-pass");
    expect(policy.repair_path_required).toBe(false);
    expect(policy.missing_required_roles).toEqual([]);
  });

  it("allows adversarial direct PASS without repair thread evidence", () => {
    const policy = evaluateThreadEvidence({ case_id: "adversarial-prompt-injection-001", category: "adversarial" }, sampleTreatment({
      case_id: "adversarial-prompt-injection-001",
      final_eval_verdict: "PASS",
      planner_thread_id: "planner",
      dev_worker_thread_id: "dev",
      initial_evaluator_thread_id: "initial_eval"
    }));

    expect(policy.policy).toBe("direct-pass");
    expect(policy.repair_path_required).toBe(false);
    expect(policy.missing_required_roles).toEqual([]);
  });

  it("requires repair when any evaluator verdict is NEEDS_REVISION", () => {
    const policy = evaluateThreadEvidence({ case_id: "bugfix-small-001", category: "bugfix-small" }, sampleTreatment({
      initial_eval_verdict: "NEEDS_REVISION",
      final_eval_verdict: "PASS",
      planner_thread_id: "planner",
      dev_worker_thread_id: "dev",
      initial_evaluator_thread_id: "initial_eval",
      repair_dev_worker_thread_id: "repair_dev",
      final_evaluator_thread_id: "final_eval"
    }));

    expect(policy.policy).toBe("repair-required");
    expect(policy.missing_required_roles).toEqual([]);
  });

  it("blocks direct PASS when planner, dev, or evaluator thread evidence is missing", () => {
    const policy = evaluateThreadEvidence({ case_id: "bugfix-small-001", category: "bugfix-small" }, sampleTreatment({
      final_eval_verdict: "PASS",
      planner_thread_id: "planner"
    }));

    expect(policy.policy).toBe("direct-pass");
    expect(policy.missing_required_roles).toEqual(["dev_worker", "evaluator"]);
  });
});

function sampleTreatment(overrides: Partial<M12RunResult>): Partial<M12RunResult> {
  return {
    case_id: "bugfix-small-001",
    variant: "treatment",
    status: "PASS",
    real_run_executed: true,
    ...overrides
  };
}
