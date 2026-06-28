import { describe, expect, it } from "vitest";

import {
  guardNativeDispatch,
  hasAgentRun,
  requireAgentRun,
  requirePlannerFollowupDispatch
} from "../../src/loop-manager/dispatch-guards.ts";
import type { NativeDispatchEvidence } from "../../src/loop-manager/native-dispatch-contract.ts";

describe("native dispatch guards", () => {
  it("finds agent runs by name and phase", () => {
    const evidence = baseEvidence({
      agent_runs: [
        {
          agent_name: "loop_dev_worker",
          agent_run_id: "agent_run_dev",
          thread_id: "thread_dev",
          phase: "repair",
          artifacts: ["artifacts/dev-result.json"]
        }
      ]
    });

    expect(hasAgentRun(evidence, "loop_dev_worker")).toBe(true);
    expect(hasAgentRun(evidence, "loop_dev_worker", "repair")).toBe(true);
    expect(hasAgentRun(evidence, "loop_dev_worker", "implementation")).toBe(false);
  });

  it("returns a concrete blocker for missing required agent runs", () => {
    expect(requireAgentRun(baseEvidence(), "loop_evaluator", "final")).toBe(
      "Missing loop_evaluator agent_run for phase final."
    );
  });

  it("detects parent roleplay when parent writes restricted artifacts", () => {
    const result = guardNativeDispatch(baseEvidence({ parent_wrote_eval_report: true }), []);

    expect(result).toEqual({
      allowed: false,
      blockers: ["Parent thread directly wrote PRD, DevResult, or EvalReport artifact."],
      parent_roleplay_detected: true
    });
  });

  it("blocks planner-only early stop when dev worker has not been dispatched", () => {
    const result = requirePlannerFollowupDispatch(
      baseEvidence({
        has_prd: true,
        has_task_graph: true,
        agent_runs: [
          {
            agent_name: "loop_planner",
            agent_run_id: "agent_run_planner",
            thread_id: "thread_planner",
            phase: "planning",
            artifacts: ["docs/PRD.md", "docs/TASK_GRAPH.json"]
          }
        ]
      })
    );

    expect(result).toBe("Planner completed PRD and TaskGraph, but loop_dev_worker has not been dispatched.");
  });
});

function baseEvidence(overrides: Partial<NativeDispatchEvidence> = {}): NativeDispatchEvidence {
  return {
    agent_runs: [],
    has_prd: false,
    has_task_graph: false,
    has_dev_result: false,
    has_code_diff: false,
    has_eval_needs_revision: false,
    has_repair_request: false,
    repair_references_eval: false,
    has_repair_dev_result: false,
    has_final_eval_pass: false,
    tests_passed: false,
    parent_wrote_prd: false,
    parent_wrote_dev_result: false,
    parent_wrote_eval_report: false,
    ...overrides
  };
}
