import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { assertValid, validateWithSchema } from "../../src/core/index.ts";
import type { AgentProfile, Artifact, ContextCapsule, EvalReport, LoopRun, TaskGraph, TaskNode } from "../../src/core/types.ts";
import { ContextManager } from "../../src/orchestrator/context-manager.ts";
import { EvaluationGate } from "../../src/orchestrator/evaluation-gate.ts";
import { ReportBuilder } from "../../src/orchestrator/report-builder.ts";
import { advanceLoopStatus } from "../../src/orchestrator/state-machine.ts";
import { JsonLoopStore } from "../../src/state/json-store.ts";

const demoRoot = join(process.cwd(), "examples/demo-repo");
const createdDirectories: string[] = [];

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(join(demoRoot, path), "utf8")) as T;
}

function now(): string {
  return "2026-06-18T09:00:00.000Z";
}

async function createStore(): Promise<JsonLoopStore> {
  const stateDir = await mkdtemp(join(tmpdir(), "codex-loop-demo-e2e-"));
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

describe("demo loop fixture", () => {
  it("runs the PRD to repair to PASS loop through schemas and state gates", async () => {
    expect(existsSync(join(demoRoot, "docs/PRD.md"))).toBe(true);

    const taskGraph = readJson<TaskGraph>("docs/TASK_GRAPH.json");
    expect(validateWithSchema("task-graph", taskGraph)).toEqual({
      valid: true,
      errors: []
    });
    expect(taskGraph.tasks.map((task) => task.task_id)).toEqual(["TASK-001", "TASK-002"]);

    const needsRevisionReport = readJson<EvalReport>("artifacts/eval-report-needs-revision.json");
    expect(validateWithSchema("eval-report", needsRevisionReport)).toEqual({
      valid: true,
      errors: []
    });

    const contextCapsule = readJson<ContextCapsule>("artifacts/context-capsule.json");
    expect(validateWithSchema("context-capsule", contextCapsule)).toEqual({
      valid: true,
      errors: []
    });

    const store = await createStore();
    const loopRun = createLoopRun({ status: "EVAL_RUNNING" });
    await store.createLoopRun(loopRun);
    await store.registerAgent(createAgent("agent_demo_dev", "dev_worker"));
    await store.registerAgent(createAgent("agent_demo_eval", "evaluator"));
    for (const task of taskGraph.tasks) {
      await store.createTask({
        ...task,
        status: "EVAL_RUNNING"
      });
    }
    await store.writeArtifact(readJson<Artifact>("artifacts/dev-result.json"));
    await store.writeEvalReport(needsRevisionReport);

    const needsRevisionResult = await new EvaluationGate(store).processEvalReport("eval_demo_needs_revision");
    expect(needsRevisionResult).toMatchObject({
      verdict: "NEEDS_REVISION",
      next_status: "REPAIR_REQUESTED"
    });
    expect(needsRevisionResult.repair_request_id).toMatch(/^repair_eval_demo_needs_revision_/);
    expect(await store.getRepairRequest(needsRevisionResult.repair_request_id as string)).toMatchObject({
      source_eval_id: "eval_demo_needs_revision",
      allowed_scope: ["examples/demo-repo/tests/sample-feature.test.ts"]
    });

    await store.updateLoopRun("loop_demo_001", {
      status: "EVAL_RUNNING"
    });
    await store.updateTaskStatus("TASK-002", {
      status: "EVAL_RUNNING"
    });
    const passReport = readJson<EvalReport>("artifacts/eval-report-pass.json");
    await store.writeEvalReport(passReport);

    const passResult = await new EvaluationGate(store).processEvalReport("eval_demo_pass");
    expect(passResult).toMatchObject({
      verdict: "PASS",
      next_status: "VALIDATION_RUNNING",
      repair_request_id: null
    });

    const readyStatus = advanceLoopStatus("VALIDATION_RUNNING", {
      validationResult: "passed"
    });
    await store.updateLoopRun("loop_demo_001", {
      status: readyStatus
    });
    await store.updateTaskStatus("TASK-002", {
      status: "PASS"
    });
    expect(await store.getLoopRun("loop_demo_001")).toMatchObject({
      status: "READY_FOR_NEXT_MODULE"
    });

    const capsuleResult = await new ContextManager(store).createCapsuleDraft({
      loop_run_id: "loop_demo_001",
      agent_id: "agent_demo_dev",
      task_id: "TASK-002",
      restart_reason: "Demo e2e capsule.",
      next_instruction: "M9 demo loop passed.",
      artifact_dir: join(createdDirectories[0] as string, "artifacts/context-capsules")
    });
    assertValid("context-capsule", capsuleResult.capsule);

    const finalReportPath = join(createdDirectories[0] as string, "FinalDeliveryReport.md");
    const report = await new ReportBuilder(store).buildFinalReport("loop_demo_001", finalReportPath);
    expect(report.path).toBe(finalReportPath);
    expect(report.content).toContain("# Final Delivery Report");
    expect(existsSync(join(demoRoot, "artifacts/FinalDeliveryReport.md"))).toBe(true);
  });
});

function createLoopRun(overrides: Partial<LoopRun> = {}): LoopRun {
  return {
    loop_run_id: "loop_demo_001",
    project_id: "project_demo",
    user_goal: "Create project name validation.",
    normalized_goal: "Implement validateProjectName and prove the repair loop.",
    status: "GOAL_RECEIVED",
    current_module_id: "M9",
    current_iteration: 0,
    max_iterations: 10,
    source_of_truth_files: [
      "AGENTS.md",
      ".agent/PLANS.md",
      "docs/IMPLEMENTATION_PLAN.md",
      "docs/LOOP_PROGRESS.md",
      "docs/DECISIONS.md"
    ],
    started_at: now(),
    updated_at: now(),
    completed_at: null,
    stop_conditions: ["M9 demo passes"],
    budget: {
      max_repair_iterations_per_task: 2,
      max_context_restarts_per_agent: 2
    },
    metadata: {
      demo: true
    },
    ...overrides
  };
}

function createAgent(agentId: string, agentType: AgentProfile["agent_type"]): AgentProfile {
  return {
    agent_id: agentId,
    agent_type: agentType,
    codex_agent_name: agentType,
    display_name: agentType === "evaluator" ? "Demo Evaluator" : "Demo Dev Worker",
    role_contract: {
      responsibilities: ["Run demo loop role."],
      non_goals: ["Do not create a real Codex thread."],
      required_inputs: ["TaskNode"],
      required_outputs: ["Structured demo artifact"]
    },
    current_thread_id: `thread_${agentId}_initial`,
    previous_thread_ids: [],
    skills: [agentType.replaceAll("_", "-")],
    mcp_servers: ["codex_loop_store"],
    sandbox_mode: agentType === "evaluator" ? "read-only" : "workspace-write",
    status: "READY",
    assigned_task_ids: [],
    created_at: now(),
    updated_at: now(),
    metadata: {
      demo: true
    }
  };
}
