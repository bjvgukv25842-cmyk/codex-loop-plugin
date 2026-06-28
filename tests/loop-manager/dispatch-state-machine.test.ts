import { describe, expect, it } from "vitest";

import { assertNoPlannerOnlyStop, nextNativeDispatchPhase } from "../../src/loop-manager/dispatch-state-machine.ts";
import type { NativeDispatchEvidence } from "../../src/loop-manager/native-dispatch-contract.ts";

describe("native dispatch state machine", () => {
  it("requires planner before entering PLANNER_DONE", () => {
    const result = nextNativeDispatchPhase("SPAWN_PLANNER", "planner_done", baseEvidence());

    expect(result.ok).toBe(false);
    expect(result.blockers).toEqual(
      expect.arrayContaining(["Missing loop_planner agent_run."])
    );
  });

  it("allows RepairRequest to dispatch the repair dev worker", () => {
    const result = nextNativeDispatchPhase("REPAIR_REQUEST_CREATED", "spawn_dev_worker_repair", {
      ...baseEvidence(),
      has_repair_request: true,
      repair_references_eval: true
    });

    expect(result).toMatchObject({
      ok: true,
      to: "SPAWN_DEV_WORKER_REPAIR"
    });
  });

  it("does not allow repair completion without loop_dev_worker repair evidence", () => {
    const result = nextNativeDispatchPhase("SPAWN_DEV_WORKER_REPAIR", "repair_done", {
      ...baseEvidence(),
      has_repair_dev_result: true,
      has_code_diff: true
    });

    expect(result.ok).toBe(false);
    expect(result.blockers).toEqual(
      expect.arrayContaining(["Missing loop_dev_worker agent_run for phase repair."])
    );
  });

  it("does not allow FinalReport without final PASS and passing tests", () => {
    const result = nextNativeDispatchPhase("VALIDATION_PASS", "final_report", {
      ...baseEvidence(),
      tests_passed: true
    });

    expect(result.ok).toBe(false);
    expect(result.blockers).toEqual(
      expect.arrayContaining(["Cannot write FinalReport without final EvalReport PASS."])
    );
  });

  it("allows FinalReport only after final PASS and validation pass", () => {
    const result = nextNativeDispatchPhase("VALIDATION_PASS", "final_report", {
      ...baseEvidence(),
      has_final_eval_pass: true,
      tests_passed: true
    });

    expect(result).toMatchObject({
      ok: true,
      to: "FINAL_REPORT"
    });
  });

  it("does not allow the parent loop manager to stop after planner-only evidence", () => {
    const result = assertNoPlannerOnlyStop({
      ...baseEvidence(),
      has_prd: true,
      has_task_graph: true,
      agent_runs: [
        {
          agent_name: "loop_planner",
          agent_run_id: "agent_run_planner",
          thread_id: "thread_planner",
          phase: "planning",
          artifacts: ["artifact-prd-001", "artifact-taskgraph-001"]
        }
      ]
    });

    expect(result).toMatchObject({
      allowed: false,
      blockers: ["Planner completed PRD and TaskGraph, but loop_dev_worker has not been dispatched."]
    });
  });
});

function baseEvidence(): NativeDispatchEvidence {
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
    parent_wrote_eval_report: false
  };
}
