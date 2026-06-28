import { describe, expect, it } from "vitest";

import { buildGate6RepairRequestTemplate, nextGate6WorkOrder } from "../../src/loop-manager/native-work-orders.ts";
import type { NativeDispatchEvidence } from "../../src/loop-manager/native-dispatch-contract.ts";

describe("Gate 6 native work orders", () => {
  it("requires loop_dev_worker immediately after planner-only evidence", () => {
    const order = nextGate6WorkOrder(
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
      }),
      workOrderInput()
    );

    expect(order).toMatchObject({
      agent_name: "loop_dev_worker",
      phase: "implementation",
      blockers: []
    });
    expect(order?.prompt).toContain("agent_run_start");
    expect(order?.prompt).toContain("artifacts/dev-result.json");
    expect(order?.prompt).toContain('artifact_type: "dev_result"');
    expect(order?.prompt).toContain("thread-loop-dev-worker-gate6-implementation");
    expect(order?.prompt).toContain("Do not load unrelated skills");
    expect(order?.prompt).toContain('next_required_phase: "spawn_loop_evaluator_baseline"');
  });

  it("routes initial DevResult to baseline evaluator", () => {
    const order = nextGate6WorkOrder(
      baseEvidence({
        has_dev_result: true,
        has_code_diff: true,
        agent_runs: [
          run("loop_planner", "planning"),
          run("loop_dev_worker", "implementation")
        ]
      }),
      workOrderInput()
    );

    expect(order).toMatchObject({
      agent_name: "loop_evaluator",
      phase: "baseline"
    });
    expect(order?.prompt).toContain("artifacts/eval-report-needs-revision.json");
    expect(order?.prompt).toContain('artifact_type: "eval_report"');
    expect(order?.prompt).toContain("NEEDS_REVISION");
    expect(order?.prompt).toContain('next_required_phase: "create_repair_request"');
  });

  it("routes RepairRequest to repair dev worker", () => {
    const order = nextGate6WorkOrder(
      baseEvidence({
        has_repair_request: true,
        repair_references_eval: true,
        agent_runs: [
          run("loop_planner", "planning"),
          run("loop_dev_worker", "implementation"),
          run("loop_evaluator", "baseline")
        ]
      }),
      workOrderInput()
    );

    expect(order).toMatchObject({
      agent_name: "loop_dev_worker",
      phase: "repair"
    });
    expect(order?.prompt).toContain("artifacts/repair-request.json");
    expect(order?.prompt).toContain("Run npm test");
  });

  it("builds a schema-shaped Gate 6 RepairRequest template", () => {
    const template = JSON.parse(buildGate6RepairRequestTemplate(workOrderInput())) as Record<string, unknown>;

    expect(Object.keys(template).sort()).toEqual(
      [
        "allowed_scope",
        "assigned_agent_id",
        "created_at",
        "disallowed_scope",
        "findings",
        "loop_run_id",
        "module_id",
        "repair_id",
        "repair_instructions",
        "source_eval_id",
        "status",
        "task_id",
        "updated_at",
        "validation_commands"
      ].sort()
    );
    expect(template).toMatchObject({
      assigned_agent_id: "loop_dev_worker",
      status: "REPAIR_REQUESTED",
      source_eval_id: "eval_validate_project_name_m1_baseline_needs_revision"
    });
    expect(template).not.toHaveProperty("source_eval_report_path");
    expect(template).not.toHaveProperty("finding_ids");
    expect(template).not.toHaveProperty("required_fixes");
    expect(template).not.toHaveProperty("metadata");
    expect(template).not.toHaveProperty("created_by");
  });
});

function workOrderInput() {
  return {
    loop_run_id: "loop-gate6",
    parent_thread_id: "thread-parent",
    task_id: "task-gate6",
    module_id: "M1"
  };
}

function run(agent_name: "loop_planner" | "loop_dev_worker" | "loop_evaluator", phase: string) {
  return {
    agent_name,
    agent_run_id: `agent_run_${agent_name}_${phase}`,
    thread_id: `thread_${agent_name}_${phase}`,
    phase,
    artifacts: []
  };
}

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
