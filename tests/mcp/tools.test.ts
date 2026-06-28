import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type {
  AgentProfile,
  ContextCapsule,
  EvalReport,
  LoopRun,
  RepairRequest,
  TaskNode
} from "../../src/core/types.ts";
import { MCP_TOOL_DEFINITIONS, callMcpTool } from "../../src/mcp/index.ts";
import type { McpErrorResult, McpWriteResult } from "../../src/mcp/tool-results.ts";
import { JsonLoopStore } from "../../src/state/json-store.ts";

const createdDirectories: string[] = [];

function now(): string {
  return "2026-06-18T09:00:00.000Z";
}

async function createStore(): Promise<JsonLoopStore> {
  const stateDir = await mkdtemp(join(tmpdir(), "codex-loop-mcp-state-"));
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

describe("MCP loop store tools", () => {
  it("defines every required MCP tool", () => {
    expect(MCP_TOOL_DEFINITIONS.map((tool) => tool.name)).toEqual([
      "loop_create_run",
      "loop_get_state",
      "loop_update_state",
      "loop_append_event",
      "agent_register",
      "agent_get",
      "agent_update_thread",
      "agent_list",
      "task_create",
      "task_get",
      "task_update_status",
      "task_list_by_loop",
      "artifact_write",
      "artifact_get",
      "artifact_list_by_task",
      "eval_write_report",
      "eval_get_report",
      "eval_list_by_task",
      "repair_create_request",
      "repair_get_request",
      "repair_list_by_task",
      "context_capsule_write",
      "context_capsule_get",
      "context_capsule_list_by_agent",
      "agent_run_start",
      "agent_run_finish",
      "agent_run_heartbeat",
      "artifact_write_by_agent",
      "eval_report_write_by_agent",
      "repair_request_write_by_agent",
      "loop_transition_record",
      "sdk_thread_run_write",
      "sdk_thread_run_get",
      "sdk_thread_run_list_by_loop"
    ]);
  });

  it("loop_create_run creates a LoopRun", async () => {
    const store = await createStore();

    const result = await callMcpTool(store, "loop_create_run", {
      payload: createLoopRun()
    });

    expect(result).toMatchObject({
      ok: true,
      status: "created",
      id: "loop_m6_001"
    });
    expect((result as McpWriteResult).event_id).toMatch(/^loop_run\.created_/);
    expect(await store.getLoopRun("loop_m6_001")).toMatchObject({
      loop_run_id: "loop_m6_001"
    });
  });

  it("agent_register creates an AgentProfile", async () => {
    const store = await createStore();

    const result = await callMcpTool(store, "agent_register", {
      payload: createAgent()
    });

    expect(result).toMatchObject({
      ok: true,
      status: "created",
      id: "agent_m6_dev"
    });
    expect(await store.getAgent("agent_m6_dev")).toMatchObject({
      agent_id: "agent_m6_dev",
      agent_type: "dev_worker"
    });
  });

  it("task_create creates a TaskNode", async () => {
    const store = await createStore();

    const result = await callMcpTool(store, "task_create", {
      payload: createTask()
    });

    expect(result).toMatchObject({
      ok: true,
      status: "created",
      id: "task_m6_tools"
    });
    expect(await store.getTask("task_m6_tools")).toMatchObject({
      task_id: "task_m6_tools",
      status: "READY_FOR_DEV"
    });
  });

  it("eval_write_report writes a PASS EvalReport", async () => {
    const store = await createStore();

    const result = await callMcpTool(store, "eval_write_report", {
      payload: createEvalReport()
    });

    expect(result).toMatchObject({
      ok: true,
      status: "created",
      id: "eval_m6_pass"
    });
    expect(await store.getEvalReport("eval_m6_pass")).toMatchObject({
      eval_id: "eval_m6_pass",
      verdict: "PASS"
    });
  });

  it("eval_write_report writes a NEEDS_REVISION EvalReport", async () => {
    const store = await createStore();

    const result = await callMcpTool(store, "eval_write_report", {
      payload: createEvalReport({
        eval_id: "eval_m6_needs_revision",
        verdict: "NEEDS_REVISION",
        findings: [createFinding()],
        required_fixes: [
          {
            fix_id: "fix_m6",
            finding_ids: ["finding_m6"],
            instruction: "Repair only the missing MCP tool behavior.",
            expected_files: [
              {
                path: "src/mcp/tools.ts"
              }
            ],
            validation_commands: [
              {
                command: "npm test -- tests/mcp/tools.test.ts"
              }
            ]
          }
        ]
      })
    });

    expect(result).toMatchObject({
      ok: true,
      status: "created",
      id: "eval_m6_needs_revision"
    });
    expect(await store.getEvalReport("eval_m6_needs_revision")).toMatchObject({
      verdict: "NEEDS_REVISION"
    });
  });

  it("context_capsule_write writes a ContextCapsule", async () => {
    const store = await createStore();

    const result = await callMcpTool(store, "context_capsule_write", {
      payload: createContextCapsule()
    });

    expect(result).toMatchObject({
      ok: true,
      status: "created",
      id: "capsule_m6"
    });
    expect(await store.getContextCapsule("capsule_m6")).toMatchObject({
      capsule_id: "capsule_m6",
      next_instruction: "Continue with M6 MCP store tests."
    });
  });

  it("repair_create_request writes a RepairRequest", async () => {
    const store = await createStore();

    const result = await callMcpTool(store, "repair_create_request", {
      payload: createRepairRequest()
    });

    expect(result).toMatchObject({
      ok: true,
      status: "created",
      id: "repair_m6"
    });
    expect(await store.getRepairRequest("repair_m6")).toMatchObject({
      repair_id: "repair_m6",
      source_eval_id: "eval_m6_needs_revision"
    });
  });

  it("invalid payload returns a structured error", async () => {
    const store = await createStore();

    const result = await callMcpTool(store, "eval_write_report", {
      payload: {
        eval_id: "eval_missing_required_fields"
      }
    });

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "invalid_input"
      }
    });
  });

  it("not_found returns a structured error", async () => {
    const store = await createStore();

    const result = await callMcpTool(store, "loop_get_state", {
      loop_run_id: "loop_missing"
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "not_found",
        message: "loop_run_id not found: loop_missing",
        id: "loop_missing"
      }
    } satisfies McpErrorResult);
  });
});

function createLoopRun(overrides: Partial<LoopRun> = {}): LoopRun {
  return {
    loop_run_id: "loop_m6_001",
    project_id: "project_codex_loop_plugin",
    user_goal: "Expose local loop state over MCP.",
    normalized_goal: "Create state-only MCP tools over the M5 LoopStore.",
    status: "GOAL_RECEIVED",
    current_module_id: "M6",
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
    stop_conditions: ["M6 validation passes"],
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
    agent_id: "agent_m6_dev",
    agent_type: "dev_worker",
    codex_agent_name: "dev_worker",
    display_name: "Dev Worker",
    role_contract: {
      responsibilities: ["Implement scoped tasks"],
      non_goals: ["Do not expand scope"],
      required_inputs: ["TaskNode"],
      required_outputs: ["DevResult"]
    },
    current_thread_id: "thread_m6_initial",
    previous_thread_ids: [],
    skills: ["dev-worker"],
    mcp_servers: ["codex_loop_store"],
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
    task_id: "task_m6_tools",
    loop_run_id: "loop_m6_001",
    module_id: "M6",
    title: "Expose LoopStore as MCP tools",
    description: "Create state-only MCP tool handlers over the local LoopStore.",
    owner_agent_type: "dev_worker",
    owner_agent_id: "agent_m6_dev",
    reviewer_agent_type: "evaluator",
    reviewer_agent_id: null,
    dependencies: [],
    scope: ["src/mcp", "tests/mcp"],
    non_goals: ["Do not implement orchestrator CLI"],
    likely_files: [
      {
        path: "src/mcp/tools.ts",
        purpose: "MCP tool handler implementation"
      }
    ],
    acceptance_criteria: ["MCP tools call the M5 LoopStore"],
    validation_commands: [
      {
        command: "npm test -- tests/mcp/tools.test.ts"
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
    eval_id: "eval_m6_pass",
    loop_run_id: "loop_m6_001",
    task_id: "task_m6_tools",
    module_id: "M6",
    evaluator_agent_id: "agent_eval_m6",
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
    capsule_id: "capsule_m6",
    loop_run_id: "loop_m6_001",
    agent_id: "agent_m6_dev",
    agent_type: "dev_worker",
    old_thread_id: "thread_m6_initial",
    new_thread_id: null,
    restart_reason: "Context restart test.",
    current_module: "M6",
    current_task: "task_m6_tools",
    completed_modules: ["M0", "M1", "M2", "M3", "M4", "M5"],
    completed_work: ["Implemented local JSON LoopStore"],
    open_issues: [],
    evaluator_findings: [],
    repair_requests: [],
    decisions: ["DEC-0017", "DEC-0018"],
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
    files_changed_recently: [
      {
        path: "src/mcp/tools.ts"
      }
    ],
    source_of_truth_files: [
      "AGENTS.md",
      "docs/IMPLEMENTATION_PLAN.md",
      "docs/LOOP_PROGRESS.md",
      "docs/DECISIONS.md"
    ],
    next_instruction: "Continue with M6 MCP store tests.",
    do_not_repeat: ["Do not enter M7"],
    risks: [],
    created_at: now(),
    updated_at: now(),
    ...overrides
  };
}

function createRepairRequest(overrides: Partial<RepairRequest> = {}): RepairRequest {
  return {
    repair_id: "repair_m6",
    loop_run_id: "loop_m6_001",
    task_id: "task_m6_tools",
    module_id: "M6",
    source_eval_id: "eval_m6_needs_revision",
    assigned_agent_id: "agent_m6_dev",
    findings: [createFinding()],
    repair_instructions: ["Repair only the listed finding."],
    allowed_scope: ["src/mcp"],
    disallowed_scope: ["src/cli"],
    validation_commands: [
      {
        command: "npm test -- tests/mcp/tools.test.ts"
      }
    ],
    status: "REPAIR_REQUESTED",
    created_at: now(),
    updated_at: now(),
    ...overrides
  };
}

function createFinding() {
  return {
    finding_id: "finding_m6",
    severity: "medium" as const,
    category: "correctness" as const,
    description: "MCP tool behavior is missing.",
    evidence: [
      {
        type: "text" as const,
        ref: "tests/mcp/tools.test.ts",
        summary: "Tool behavior test"
      }
    ],
    required_fix: "Implement the missing MCP tool behavior."
  };
}
