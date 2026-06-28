import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { EvalFinding, EvalReport, LoopRun, RepairRequest, TaskNode } from "../../src/core/types.ts";
import { EvaluationGate } from "../../src/orchestrator/evaluation-gate.ts";
import { JsonLoopStore } from "../../src/state/json-store.ts";

const createdDirectories: string[] = [];

function now(): string {
  return "2026-06-18T09:00:00.000Z";
}

async function createStore(): Promise<JsonLoopStore> {
  const stateDir = await mkdtemp(join(tmpdir(), "codex-loop-eval-gate-"));
  createdDirectories.push(stateDir);
  return new JsonLoopStore({ stateDir });
}

afterEach(async () => {
  while (createdDirectories.length > 0) {
    const directory = createdDirectories.pop();
    if (directory) {
      await rm(directory, { recursive: true, force: true });
    }
  }
});

describe("EvaluationGate", () => {
  it("advances a PASS EvalReport to VALIDATION_RUNNING", async () => {
    const store = await createStore();
    await store.createLoopRun(createLoopRun({ status: "EVAL_RUNNING" }));
    await store.createTask(createTask({ status: "EVAL_RUNNING" }));
    await store.writeEvalReport(createEvalReport({ verdict: "PASS" }));

    const result = await new EvaluationGate(store).processEvalReport("eval_m7_pass");

    expect(result).toMatchObject({
      verdict: "PASS",
      next_status: "VALIDATION_RUNNING",
      repair_request_id: null
    });
    expect(await store.getLoopRun("loop_m7")).toMatchObject({
      status: "VALIDATION_RUNNING"
    });
  });

  it("creates a RepairRequest for NEEDS_REVISION EvalReport", async () => {
    const store = await createStore();
    await store.createLoopRun(createLoopRun({ status: "EVAL_RUNNING" }));
    await store.createTask(createTask({ status: "EVAL_RUNNING" }));
    await store.writeEvalReport(
      createEvalReport({
        eval_id: "eval_m7_revision",
        verdict: "NEEDS_REVISION",
        findings: [createFinding()],
        required_fixes: [
          {
            fix_id: "fix_m7",
            finding_ids: ["finding_m7"],
            instruction: "Repair the current module only.",
            expected_files: [
              {
                path: "src/orchestrator/evaluation-gate.ts"
              }
            ],
            validation_commands: [
              {
                command: "npm test -- tests/orchestrator/evaluation-gate.test.ts"
              }
            ]
          }
        ]
      })
    );

    const result = await new EvaluationGate(store).processEvalReport("eval_m7_revision");

    expect(result).toMatchObject({
      verdict: "NEEDS_REVISION",
      next_status: "REPAIR_REQUESTED"
    });
    expect(result.repair_request_id).toMatch(/^repair_eval_m7_revision_/);
    expect(await store.getLoopRun("loop_m7")).toMatchObject({
      status: "REPAIR_REQUESTED"
    });
    expect(await store.getRepairRequest(result.repair_request_id as string)).toMatchObject({
      source_eval_id: "eval_m7_revision",
      status: "REPAIR_REQUESTED"
    } satisfies Partial<RepairRequest>);
  });
});

function createLoopRun(overrides: Partial<LoopRun> = {}): LoopRun {
  return {
    loop_run_id: "loop_m7",
    project_id: "project_codex_loop_plugin",
    user_goal: "Implement orchestrator CLI.",
    normalized_goal: "Implement local state machine and CLI.",
    status: "GOAL_RECEIVED",
    current_module_id: "M7",
    current_iteration: 0,
    max_iterations: 10,
    source_of_truth_files: [
      "AGENTS.md",
      "docs/IMPLEMENTATION_PLAN.md",
      "docs/LOOP_PROGRESS.md",
      "docs/DECISIONS.md"
    ],
    started_at: now(),
    updated_at: now(),
    completed_at: null,
    stop_conditions: ["M7 validation passes"],
    budget: {
      max_repair_iterations_per_task: 2,
      max_context_restarts_per_agent: 2
    },
    metadata: {},
    ...overrides
  };
}

function createTask(overrides: Partial<TaskNode> = {}): TaskNode {
  return {
    task_id: "task_m7",
    loop_run_id: "loop_m7",
    module_id: "M7",
    title: "Implement orchestrator CLI",
    description: "Add state machine and CLI commands.",
    owner_agent_type: "dev_worker",
    owner_agent_id: "agent_dev_m7",
    reviewer_agent_type: "evaluator",
    reviewer_agent_id: "agent_eval_m7",
    dependencies: [],
    scope: ["src/orchestrator", "src/cli"],
    non_goals: ["Do not call real Codex SDK"],
    likely_files: [
      {
        path: "src/orchestrator/evaluation-gate.ts"
      }
    ],
    acceptance_criteria: ["Evaluation gate handles PASS and NEEDS_REVISION"],
    validation_commands: [
      {
        command: "npm test -- tests/orchestrator/evaluation-gate.test.ts"
      }
    ],
    risk_level: "medium",
    status: "EVAL_RUNNING",
    revision_count: 0,
    branch: null,
    worktree_path: null,
    artifact_ids: [],
    created_at: now(),
    updated_at: now(),
    metadata: {},
    ...overrides
  };
}

function createEvalReport(overrides: Partial<EvalReport> = {}): EvalReport {
  return {
    eval_id: "eval_m7_pass",
    loop_run_id: "loop_m7",
    task_id: "task_m7",
    module_id: "M7",
    evaluator_agent_id: "agent_eval_m7",
    verdict: "PASS",
    confidence: 0.95,
    findings: [],
    required_fixes: [],
    validation_commands_checked: [
      {
        command: "npm run validate"
      }
    ],
    created_at: now(),
    updated_at: now(),
    metadata: {},
    ...overrides
  };
}

function createFinding(): EvalFinding {
  return {
    finding_id: "finding_m7",
    severity: "medium",
    category: "correctness",
    description: "Repair request should be generated.",
    evidence: [
      {
        type: "text",
        ref: "tests/orchestrator/evaluation-gate.test.ts",
        summary: "NEEDS_REVISION branch"
      }
    ],
    required_fix: "Create a RepairRequest."
  };
}
