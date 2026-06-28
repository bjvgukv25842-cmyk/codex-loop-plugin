import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { JsonLoopStore } from "../../src/state/json-store.ts";
import { resolveStatePath } from "../../src/state/paths.ts";
import type { AgentProfile, ContextCapsule, EvalReport, LoopRun, RepairRequest, TaskNode } from "../../src/core/types.ts";

const createdDirectories: string[] = [];

function now(): string {
  return "2026-06-18T09:00:00.000Z";
}

function createLoopRun(overrides: Partial<LoopRun> = {}): LoopRun {
  return {
    loop_run_id: "loop_test_001",
    project_id: "project_codex_loop_plugin",
    user_goal: "Implement local state store.",
    normalized_goal: "Implement JSON-backed loop state store.",
    status: "GOAL_RECEIVED",
    current_module_id: "M5",
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
    stop_conditions: ["M5 validation passes"],
    budget: {
      max_repair_iterations_per_task: 2,
      max_context_restarts_per_agent: 2
    },
    metadata: {},
    ...overrides
  };
}

function createAgent(overrides: Partial<AgentProfile> = {}): AgentProfile {
  return {
    agent_id: "agent_dev_test",
    agent_type: "dev_worker",
    codex_agent_name: "dev_worker",
    display_name: "Dev Worker",
    role_contract: {
      responsibilities: ["Implement scoped tasks"],
      non_goals: ["Do not plan unrelated work"],
      required_inputs: ["TaskNode"],
      required_outputs: ["DevResult"]
    },
    current_thread_id: "thread_initial",
    previous_thread_ids: [],
    skills: ["dev-worker"],
    mcp_servers: [],
    sandbox_mode: "workspace-write",
    status: "READY",
    assigned_task_ids: [],
    created_at: now(),
    updated_at: now(),
    metadata: {},
    ...overrides
  };
}

function createTask(overrides: Partial<TaskNode> = {}): TaskNode {
  return {
    task_id: "task_m5_store",
    loop_run_id: "loop_test_001",
    module_id: "M5",
    title: "Implement JSON store",
    description: "Create local JSON-backed LoopStore.",
    owner_agent_type: "dev_worker",
    owner_agent_id: "agent_dev_test",
    reviewer_agent_type: "evaluator",
    reviewer_agent_id: null,
    dependencies: [],
    scope: ["src/state", "tests/state"],
    non_goals: ["Do not implement MCP"],
    likely_files: [
      {
        path: "src/state/json-store.ts",
        purpose: "JSON store implementation"
      }
    ],
    acceptance_criteria: ["CRUD operations are tested"],
    validation_commands: [
      {
        command: "npm run validate"
      }
    ],
    risk_level: "medium",
    status: "READY_FOR_DEV",
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
    eval_id: "eval_m5_pass",
    loop_run_id: "loop_test_001",
    task_id: "task_m5_store",
    module_id: "M5",
    evaluator_agent_id: "agent_eval_test",
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

function createContextCapsule(overrides: Partial<ContextCapsule> = {}): ContextCapsule {
  return {
    capsule_id: "capsule_m5",
    loop_run_id: "loop_test_001",
    agent_id: "agent_dev_test",
    agent_type: "dev_worker",
    old_thread_id: "thread_initial",
    new_thread_id: null,
    restart_reason: "Context restart test.",
    current_module: "M5",
    current_task: "task_m5_store",
    completed_modules: ["M0", "M1", "M2", "M3", "M4"],
    completed_work: ["Implemented custom agents"],
    open_issues: [],
    evaluator_findings: [],
    repair_requests: [],
    decisions: ["DEC-0014"],
    validation_status: {
      commands_run: [
        {
          command: "npm run validate"
        }
      ],
      passed: ["npm run validate"],
      failed: [],
      not_run_reason: ""
    },
    files_changed_recently: [],
    source_of_truth_files: [
      "AGENTS.md",
      "docs/IMPLEMENTATION_PLAN.md",
      "docs/LOOP_PROGRESS.md",
      "docs/DECISIONS.md"
    ],
    next_instruction: "Continue with M5 tests.",
    do_not_repeat: ["Do not enter M6"],
    risks: [],
    created_at: now(),
    updated_at: now(),
    ...overrides
  };
}

function createRepairRequest(overrides: Partial<RepairRequest> = {}): RepairRequest {
  return {
    repair_id: "repair_m6_request",
    loop_run_id: "loop_test_001",
    task_id: "task_m5_store",
    module_id: "M6",
    source_eval_id: "eval_m5_needs_revision",
    assigned_agent_id: "agent_dev_test",
    findings: [
      {
        finding_id: "finding_m6_gap",
        severity: "medium",
        category: "correctness",
        description: "MCP repair request test finding.",
        evidence: [
          {
            type: "text",
            ref: "test",
            summary: "Test finding"
          }
        ],
        required_fix: "Create repair request persistence."
      }
    ],
    repair_instructions: ["Repair only the listed finding."],
    allowed_scope: ["src/state"],
    disallowed_scope: ["src/mcp/server.ts"],
    validation_commands: [
      {
        command: "npm test"
      }
    ],
    status: "REPAIR_REQUESTED",
    created_at: now(),
    updated_at: now(),
    ...overrides
  };
}

async function createStore(): Promise<JsonLoopStore> {
  const stateDir = await mkdtemp(join(tmpdir(), "codex-loop-state-"));
  createdDirectories.push(stateDir);
  process.env.CODEX_LOOP_STATE_DIR = stateDir;
  return new JsonLoopStore({ stateDir });
}

beforeEach(() => {
  delete process.env.CODEX_LOOP_STATE_DIR;
});

afterEach(async () => {
  delete process.env.CODEX_LOOP_STATE_DIR;
  while (createdDirectories.length > 0) {
    const directory = createdDirectories.pop();
    if (directory) {
      await rm(directory, { recursive: true, force: true });
    }
  }
});

describe("JsonLoopStore", () => {
  it("creates and reads a loop run", async () => {
    const store = await createStore();
    const loopRun = await store.createLoopRun(createLoopRun());

    expect(await store.getLoopRun(loopRun.loop_run_id)).toEqual(loopRun);
    expect(await store.listLoopRuns()).toEqual([loopRun]);
  });

  it("registers an agent and updates its thread", async () => {
    const store = await createStore();
    await store.registerAgent(createAgent());

    const updated = await store.updateAgentThread("agent_dev_test", {
      current_thread_id: "thread_next"
    });

    expect(updated.current_thread_id).toBe("thread_next");
    expect(updated.previous_thread_ids).toEqual(["thread_initial"]);
    expect(await store.getAgent("agent_dev_test")).toEqual(updated);
  });

  it("creates a task and updates task status", async () => {
    const store = await createStore();
    await store.createTask(createTask());

    const updated = await store.updateTaskStatus("task_m5_store", {
      status: "DEV_RUNNING"
    });

    expect(updated.status).toBe("DEV_RUNNING");
    expect(updated.updated_at).not.toBe(createTask().updated_at);
    expect(await store.listTasksByLoopRun("loop_test_001")).toEqual([updated]);
  });

  it("writes an artifact and lists artifacts by task", async () => {
    const store = await createStore();

    const artifact = await store.writeArtifact({
      artifact_id: "artifact_m5_diff",
      loop_run_id: "loop_test_001",
      task_id: "task_m5_store",
      module_id: "M5",
      type: "diff",
      path: "artifacts/task-results/m5.diff",
      hash: null,
      summary: "M5 diff",
      created_by_agent_id: "agent_dev_test",
      created_at: now(),
      updated_at: now(),
      metadata: {}
    });

    expect(await store.getArtifact("artifact_m5_diff")).toEqual(artifact);
    expect(await store.listArtifactsByTask("task_m5_store")).toEqual([artifact]);
  });

  it("writes an eval report with schema validation", async () => {
    const store = await createStore();
    const report = await store.writeEvalReport(createEvalReport());

    expect(await store.getEvalReport("eval_m5_pass")).toEqual(report);
    expect(await store.listEvalReportsByTask("task_m5_store")).toEqual([report]);
  });

  it("writes a context capsule with schema validation", async () => {
    const store = await createStore();
    const capsule = await store.writeContextCapsule(createContextCapsule());

    expect(await store.getContextCapsule("capsule_m5")).toEqual(capsule);
    expect(await store.listContextCapsulesByAgent("agent_dev_test")).toEqual([capsule]);
  });

  it("creates a repair request and lists repair requests by task", async () => {
    const store = await createStore();
    const repairRequest = await store.createRepairRequest(createRepairRequest());

    expect(await store.getRepairRequest("repair_m6_request")).toEqual(repairRequest);
    expect(await store.listRepairRequestsByTask("task_m5_store")).toEqual([repairRequest]);
  });

  it("appends events and lists them by loop_run_id", async () => {
    const store = await createStore();

    const event = await store.appendEvent({
      event_id: "event_manual_001",
      loop_run_id: "loop_test_001",
      type: "manual_note",
      message: "Manual event test",
      created_at: now(),
      updated_at: now(),
      metadata: {
        source: "test"
      }
    });

    expect(await store.listEvents("loop_test_001")).toEqual([event]);
  });

  it("rejects duplicate ids", async () => {
    const store = await createStore();
    await store.createLoopRun(createLoopRun());

    await expect(store.createLoopRun(createLoopRun())).rejects.toThrow(/already exists/);
  });

  it("rejects an invalid eval report", async () => {
    const store = await createStore();
    const invalidReport = createEvalReport({
      verdict: "NEEDS_REVISION",
      findings: []
    });

    await expect(store.writeEvalReport(invalidReport)).rejects.toThrow(/eval-report/);
  });

  it("uses CODEX_LOOP_STATE_DIR for default state paths", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "codex-loop-env-state-"));
    createdDirectories.push(stateDir);
    process.env.CODEX_LOOP_STATE_DIR = stateDir;

    expect(resolveStatePath("loop-runs.json")).toBe(join(stateDir, "loop-runs.json"));
    const store = new JsonLoopStore();
    await store.createLoopRun(createLoopRun({ loop_run_id: "loop_env_001" }));

    expect(await store.getLoopRun("loop_env_001")).toMatchObject({
      loop_run_id: "loop_env_001"
    });
  });
});
