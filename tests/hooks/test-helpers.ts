import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AgentProfile, EvalFinding, EvalReport, LoopRun, TaskNode } from "../../src/core/types.ts";
import { JsonLoopStore } from "../../src/state/json-store.ts";

const createdDirectories: string[] = [];

export function now(): string {
  return "2026-06-18T09:00:00.000Z";
}

export async function createHookTestWorkspace(): Promise<{ repoRoot: string; stateDir: string; store: JsonLoopStore }> {
  const repoRoot = await mkdtemp(join(tmpdir(), "codex-loop-hooks-repo-"));
  const stateDir = join(repoRoot, "state");
  createdDirectories.push(repoRoot);
  const store = new JsonLoopStore({ stateDir });
  await writeFile(join(repoRoot, "docs-placeholder"), "", "utf8");
  return {
    repoRoot,
    stateDir,
    store
  };
}

export async function cleanupHookTestWorkspaces(): Promise<void> {
  while (createdDirectories.length > 0) {
    const directory = createdDirectories.pop();
    if (directory) {
      await rm(directory, { recursive: true, force: true });
    }
  }
}

export async function seedLoop(store: JsonLoopStore, overrides: Partial<LoopRun> = {}): Promise<LoopRun> {
  const loopRun = createLoopRun(overrides);
  await store.createLoopRun(loopRun);
  return loopRun;
}

export async function seedAgent(store: JsonLoopStore, overrides: Partial<AgentProfile> = {}): Promise<AgentProfile> {
  const agent = createAgent(overrides);
  await store.registerAgent(agent);
  return agent;
}

export async function seedTask(store: JsonLoopStore, overrides: Partial<TaskNode> = {}): Promise<TaskNode> {
  const task = createTask(overrides);
  await store.createTask(task);
  return task;
}

export function createLoopRun(overrides: Partial<LoopRun> = {}): LoopRun {
  return {
    loop_run_id: "loop_hooks_001",
    project_id: "project_codex_loop_plugin",
    user_goal: "Implement Codex hooks.",
    normalized_goal: "Implement M8 lifecycle hooks.",
    status: "DEV_RUNNING",
    current_module_id: "M8",
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
    stop_conditions: ["M8 validation passes"],
    budget: {
      max_repair_iterations_per_task: 2,
      max_context_restarts_per_agent: 2
    },
    metadata: {},
    ...overrides
  };
}

export function createAgent(overrides: Partial<AgentProfile> = {}): AgentProfile {
  return {
    agent_id: "agent_context_distiller",
    agent_type: "context_distiller",
    codex_agent_name: "context_distiller",
    display_name: "Context Distiller",
    role_contract: {
      responsibilities: ["Create context capsules"],
      non_goals: ["Do not modify source code"],
      required_inputs: ["LoopRun", "TaskNode"],
      required_outputs: ["ContextCapsule"]
    },
    current_thread_id: "thread_context_initial",
    previous_thread_ids: [],
    skills: ["context-distiller"],
    mcp_servers: ["codex_loop_store"],
    sandbox_mode: "read-only",
    status: "READY",
    assigned_task_ids: [],
    created_at: now(),
    updated_at: now(),
    metadata: {},
    ...overrides
  };
}

export function createTask(overrides: Partial<TaskNode> = {}): TaskNode {
  return {
    task_id: "task_hooks_001",
    loop_run_id: "loop_hooks_001",
    module_id: "M8",
    title: "Implement hooks",
    description: "Implement lifecycle hooks.",
    owner_agent_type: "dev_worker",
    owner_agent_id: "agent_dev_worker",
    reviewer_agent_type: "evaluator",
    reviewer_agent_id: "agent_evaluator",
    dependencies: [],
    scope: ["hooks", "src/hooks", "tests/hooks"],
    non_goals: ["Do not implement M9"],
    likely_files: [
      {
        path: "src/hooks/hook-utils.ts",
        purpose: "Hook utilities"
      }
    ],
    acceptance_criteria: ["Hooks are tested"],
    validation_commands: [
      {
        command: "npm run validate"
      }
    ],
    risk_level: "medium",
    status: "DEV_RUNNING",
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

export function createFinding(): EvalFinding {
  return {
    finding_id: "finding_hooks_001",
    severity: "medium",
    category: "correctness",
    description: "Hook test finding.",
    evidence: [
      {
        type: "text",
        ref: "test",
        summary: "Fixture"
      }
    ],
    required_fix: "Fix hook behavior."
  };
}

export function createEvalReport(overrides: Partial<EvalReport> = {}): EvalReport {
  return {
    eval_id: "eval_hooks_001",
    loop_run_id: "loop_hooks_001",
    task_id: "task_hooks_001",
    module_id: "M8",
    evaluator_agent_id: "agent_evaluator",
    verdict: "PASS",
    confidence: 0.9,
    findings: [],
    required_fixes: [],
    validation_commands_checked: [
      {
        command: "npm test -- tests/hooks"
      }
    ],
    created_at: now(),
    updated_at: now(),
    metadata: {},
    ...overrides
  };
}
