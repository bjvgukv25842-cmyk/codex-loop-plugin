import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { AgentProfile, AgentType, LoopRun, LoopStatus, TaskNode, TaskStatus } from "../core/types.ts";
import type { LoopStore } from "../state/types.ts";
import { ContextManager, type ContextCapsuleDraftResult } from "./context-manager.ts";
import { EvaluationGate, type EvaluationGateResult } from "./evaluation-gate.ts";
import { ReportBuilder, type FinalReportResult } from "./report-builder.ts";
import { advanceLoopStatus } from "./state-machine.ts";
import { StubRuntimeAdapter, type RuntimeAdapter, type RuntimeTodoResult } from "./runtime-adapter.ts";

export interface InitLoopInput {
  goal: string;
  project_id?: string;
  module_id?: string;
}

export interface InitLoopResult {
  loop_run_id: string;
  registered_agents: string[];
}

export interface LoopStatusSummary {
  loop_run_id: string;
  status: LoopStatus;
  current_module_id: string;
  task_count: number;
  task_status_counts: Record<string, number>;
  recent_events: {
    event_id: string;
    type: string;
    message: string;
    created_at: string;
  }[];
}

export interface PlanResult {
  loop_run_id: string;
  status: LoopStatus;
  next_step: string;
  missing: string[];
}

export interface RunStepResult {
  loop_run_id: string;
  previous_status: LoopStatus;
  next_status: LoopStatus;
  runtime: RuntimeTodoResult | null;
}

export interface RepairCommandResult {
  repair_id: string;
  task_id: string;
  prompt_path: string;
}

export class LoopController {
  constructor(
    private readonly store: LoopStore,
    private readonly runtimeAdapter: RuntimeAdapter = new StubRuntimeAdapter()
  ) {}

  async initLoop(input: InitLoopInput): Promise<InitLoopResult> {
    const timestamp = new Date().toISOString();
    const loopRunId = `loop_${Date.now()}`;
    const loopRun: LoopRun = {
      loop_run_id: loopRunId,
      project_id: input.project_id ?? "codex_loop_plugin",
      user_goal: input.goal,
      normalized_goal: input.goal,
      status: "GOAL_RECEIVED",
      current_module_id: input.module_id ?? "M7",
      current_iteration: 0,
      max_iterations: 10,
      source_of_truth_files: [
        "AGENTS.md",
        ".agent/PLANS.md",
        "docs/IMPLEMENTATION_PLAN.md",
        "docs/LOOP_PROGRESS.md",
        "docs/DECISIONS.md"
      ],
      started_at: timestamp,
      updated_at: timestamp,
      completed_at: null,
      stop_conditions: ["current module validated", "user approval required", "blocked"],
      budget: {
        max_repair_iterations_per_task: 2,
        max_context_restarts_per_agent: 2
      },
      metadata: {}
    };

    await this.store.createLoopRun(loopRun);
    const agents = defaultAgents(timestamp);
    for (const agent of agents) {
      await this.store.registerAgent(agent);
    }

    return {
      loop_run_id: loopRun.loop_run_id,
      registered_agents: agents.map((agent) => agent.agent_id)
    };
  }

  async getStatus(loopRunId?: string): Promise<LoopStatusSummary> {
    const loopRun = await this.resolveLoopRun(loopRunId);
    const tasks = await this.store.listTasksByLoopRun(loopRun.loop_run_id);
    const events = await this.store.listEvents(loopRun.loop_run_id);

    return {
      loop_run_id: loopRun.loop_run_id,
      status: loopRun.status,
      current_module_id: loopRun.current_module_id,
      task_count: tasks.length,
      task_status_counts: countTaskStatuses(tasks),
      recent_events: events.slice(-5).map((event) => ({
        event_id: event.event_id,
        type: event.type,
        message: event.message,
        created_at: event.created_at
      }))
    };
  }

  async plan(loopRunId?: string): Promise<PlanResult> {
    const loopRun = await this.resolveLoopRun(loopRunId);
    const missing = ["prd artifact", "task graph artifact"];
    await this.store.updateLoopRun(loopRun.loop_run_id, {
      status: advanceLoopStatus(loopRun.status),
      updated_at: new Date().toISOString()
    });

    return {
      loop_run_id: loopRun.loop_run_id,
      status: "PRD_DRAFTING",
      next_step: "Planner runtime is required to create PRD and TaskGraph artifacts.",
      missing
    };
  }

  async runOneStep(loopRunId?: string): Promise<RunStepResult> {
    const loopRun = await this.resolveLoopRun(loopRunId);
    const nextStatus = advanceLoopStatus(loopRun.status);
    await this.store.updateLoopRun(loopRun.loop_run_id, {
      status: nextStatus,
      updated_at: new Date().toISOString()
    });

    const runtime =
      nextStatus === "DEV_RUNNING"
        ? await this.runtimeAdapter.startThread({
            loop_run_id: loopRun.loop_run_id,
            agent_id: "agent_dev_worker",
            prompt: "RuntimeAdapter stub: run dev_worker for the next ready task."
          })
        : null;

    return {
      loop_run_id: loopRun.loop_run_id,
      previous_status: loopRun.status,
      next_status: nextStatus,
      runtime
    };
  }

  async evaluate(evalId: string): Promise<EvaluationGateResult> {
    return new EvaluationGate(this.store).processEvalReport(evalId);
  }

  async repair(repairId: string, outputDir = "artifacts/task-results"): Promise<RepairCommandResult> {
    const repairRequest = await this.store.getRepairRequest(repairId);
    if (!repairRequest) {
      throw new Error(`RepairRequest not found: ${repairId}`);
    }

    await this.store.updateTaskStatus(repairRequest.task_id, {
      status: "REPAIR_REQUESTED"
    });

    await mkdir(outputDir, { recursive: true });
    const promptPath = join(outputDir, `${repairRequest.repair_id}.prompt.md`);
    const prompt = [
      `# Repair Request ${repairRequest.repair_id}`,
      "",
      `Task: ${repairRequest.task_id}`,
      `Module: ${repairRequest.module_id}`,
      "",
      "## Instructions",
      "",
      ...repairRequest.repair_instructions.map((instruction) => `- ${instruction}`),
      "",
      "## Allowed Scope",
      "",
      ...repairRequest.allowed_scope.map((scope) => `- ${scope}`),
      "",
      "## Disallowed Scope",
      "",
      ...repairRequest.disallowed_scope.map((scope) => `- ${scope}`),
      ""
    ].join("\n");
    await writeFile(promptPath, prompt, "utf8");

    return {
      repair_id: repairRequest.repair_id,
      task_id: repairRequest.task_id,
      prompt_path: promptPath
    };
  }

  async capsule(input: Parameters<ContextManager["createCapsuleDraft"]>[0]): Promise<ContextCapsuleDraftResult> {
    return new ContextManager(this.store).createCapsuleDraft(input);
  }

  async report(loopRunId?: string, path?: string): Promise<FinalReportResult> {
    const loopRun = await this.resolveLoopRun(loopRunId);
    return new ReportBuilder(this.store).buildFinalReport(loopRun.loop_run_id, path);
  }

  private async resolveLoopRun(loopRunId?: string): Promise<LoopRun> {
    if (loopRunId) {
      const loopRun = await this.store.getLoopRun(loopRunId);
      if (!loopRun) {
        throw new Error(`LoopRun not found: ${loopRunId}`);
      }
      return loopRun;
    }

    const loopRuns = await this.store.listLoopRuns();
    const loopRun = loopRuns.at(-1);
    if (!loopRun) {
      throw new Error("No LoopRun found. Run loop init first.");
    }
    return loopRun;
  }
}

function countTaskStatuses(tasks: TaskNode[]): Record<string, number> {
  return tasks.reduce<Record<string, number>>((counts, task) => {
    counts[task.status] = (counts[task.status] ?? 0) + 1;
    return counts;
  }, {});
}

function defaultAgents(timestamp: string): AgentProfile[] {
  return [
    createAgent("agent_planner", "planner", "Planner", "read-only", timestamp),
    createAgent("agent_dev_worker", "dev_worker", "Dev Worker", "workspace-write", timestamp),
    createAgent("agent_evaluator", "evaluator", "Evaluator", "read-only", timestamp),
    createAgent("agent_context_distiller", "context_distiller", "Context Distiller", "read-only", timestamp),
    createAgent("agent_integration_manager", "integration_manager", "Integration Manager", "workspace-write", timestamp)
  ];
}

function createAgent(
  agentId: string,
  agentType: AgentType,
  displayName: string,
  sandboxMode: AgentProfile["sandbox_mode"],
  timestamp: string
): AgentProfile {
  return {
    agent_id: agentId,
    agent_type: agentType,
    codex_agent_name: agentType,
    display_name: displayName,
    role_contract: {
      responsibilities: [`Act as ${displayName} for the current bounded loop step.`],
      non_goals: ["Do not expand beyond the assigned module."],
      required_inputs: ["LoopRun", "TaskNode when applicable"],
      required_outputs: ["Structured loop artifact or status result"]
    },
    current_thread_id: `thread_${agentId}_initial`,
    previous_thread_ids: [],
    skills: [agentType.replaceAll("_", "-")],
    mcp_servers: ["codex_loop_store"],
    sandbox_mode: sandboxMode,
    status: "READY",
    assigned_task_ids: [],
    created_at: timestamp,
    updated_at: timestamp,
    metadata: {}
  };
}
