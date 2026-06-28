import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { EvalReport, RepairRequest } from "../../src/core/types.ts";
import { MCP_TOOL_DEFINITIONS, callMcpTool } from "../../src/mcp/index.ts";
import type { McpWriteResult } from "../../src/mcp/tool-results.ts";
import { JsonLoopStore } from "../../src/state/json-store.ts";

const dirs: string[] = [];

beforeEach(() => {
  delete process.env.CODEX_LOOP_STATE_DIR;
});

afterEach(async () => {
  delete process.env.CODEX_LOOP_STATE_DIR;
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

async function createStore(): Promise<JsonLoopStore> {
  const stateDir = await mkdtemp(join(tmpdir(), "codex-loop-agent-runs-"));
  dirs.push(stateDir);
  process.env.CODEX_LOOP_STATE_DIR = stateDir;
  return new JsonLoopStore({ stateDir });
}

function now(): string {
  return "2026-06-18T09:00:00.000Z";
}

describe("agent-run MCP tools", () => {
  it("defines native agent-run evidence tools", () => {
    expect(MCP_TOOL_DEFINITIONS.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        "agent_run_start",
        "agent_run_finish",
        "agent_run_heartbeat",
        "artifact_write_by_agent",
        "eval_report_write_by_agent",
        "repair_request_write_by_agent",
        "loop_transition_record"
      ])
    );
  });

  it("starts an AgentRun and records planner artifact ownership", async () => {
    const store = await createStore();
    const start = await callMcpTool(store, "agent_run_start", {
      payload: {
        loop_run_id: "loop_gate6",
        agent_name: "loop_planner",
        agent_type: "planner",
        parent_thread_id: "thread_parent",
        thread_id: "thread_planner",
        task_id: "task_plan",
        module_id: "Gate6",
        phase: "planning"
      }
    });

    expect(start).toMatchObject({
      ok: true,
      status: "created"
    });
    const agentRunId = (start as McpWriteResult).id;
    const evidence = await callMcpTool(store, "artifact_write_by_agent", {
      payload: {
        agent_run_id: agentRunId,
        agent_name: "loop_planner",
        thread_id: "thread_planner",
        artifact_type: "prd",
        artifact_path: "docs/PRD.md",
        artifact_id: "artifact_prd"
      }
    });

    expect(evidence).toMatchObject({
      ok: true,
      status: "created"
    });
    const state = JSON.parse(await readFile(join(process.env.CODEX_LOOP_STATE_DIR as string, "subagent-evidence.json"), "utf8")) as unknown[];
    expect(state).toHaveLength(1);
    expect(state[0]).toMatchObject({
      agent_run_id: agentRunId,
      agent_name: "loop_planner",
      artifact_type: "prd"
    });
    const producers = JSON.parse(await readFile(join(process.env.CODEX_LOOP_STATE_DIR as string, "artifact-producers.json"), "utf8")) as unknown[];
    expect(producers).toHaveLength(1);
    expect(producers[0]).toMatchObject({
      artifact_id: "artifact_prd",
      artifact_type: "prd",
      created_by_agent_run_id: agentRunId,
      created_by_agent_name: "loop_planner",
      created_by_thread_id: "thread_planner",
      parent_thread_id: "thread_parent"
    });
  });

  it("rejects DevResult evidence from the planner", async () => {
    const store = await createStore();
    const start = await callMcpTool(store, "agent_run_start", {
      payload: {
        loop_run_id: "loop_gate6",
        agent_name: "loop_planner",
        agent_type: "planner",
        parent_thread_id: "thread_parent",
        thread_id: "thread_planner",
        task_id: "task_plan",
        module_id: "Gate6",
        phase: "planning"
      }
    });

    const result = await callMcpTool(store, "artifact_write_by_agent", {
      payload: {
        agent_run_id: (start as McpWriteResult).id,
        agent_name: "loop_planner",
        thread_id: "thread_planner",
        artifact_type: "dev_result",
        artifact_path: "artifacts/dev-result.json"
      }
    });

    expect(result).toMatchObject({
      ok: false
    });
  });

  it("accepts generic probe evidence as log artifact type", async () => {
    const store = await createStore();
    const start = await callMcpTool(store, "agent_run_start", {
      payload: {
        loop_run_id: "loop_probe_native_dispatch",
        agent_name: "loop_planner",
        agent_type: "planner",
        parent_thread_id: "thread_parent",
        thread_id: "thread_planner",
        task_id: "task_probe_planner",
        module_id: "Gate6.1",
        phase: "probe_planner"
      }
    });

    const result = await callMcpTool(store, "artifact_write_by_agent", {
      payload: {
        agent_run_id: (start as McpWriteResult).id,
        agent_name: "loop_planner",
        thread_id: "thread_planner",
        artifact_type: "log",
        artifact_path: "artifacts/probe/planner.json",
        artifact_id: "artifact_probe_planner"
      }
    });

    expect(result).toMatchObject({
      ok: true,
      status: "created"
    });
  });

  it("records EvalReport and RepairRequest evidence with agent_run_id", async () => {
    const store = await createStore();
    const start = await callMcpTool(store, "agent_run_start", {
      payload: {
        loop_run_id: "loop_gate6",
        agent_name: "loop_evaluator",
        agent_type: "evaluator",
        parent_thread_id: "thread_parent",
        thread_id: "thread_eval",
        task_id: "task_eval",
        module_id: "Gate6",
        phase: "baseline"
      }
    });
    const agentRunId = (start as McpWriteResult).id;

    const evalResult = await callMcpTool(store, "eval_report_write_by_agent", {
      payload: {
        agent_run_id: agentRunId,
        agent_name: "loop_evaluator",
        thread_id: "thread_eval",
        eval_report: createEvalReport()
      }
    });
    const repairResult = await callMcpTool(store, "repair_request_write_by_agent", {
      payload: {
        agent_run_id: agentRunId,
        agent_name: "loop_evaluator",
        thread_id: "thread_eval",
        repair_request: createRepairRequest()
      }
    });

    expect(evalResult).toMatchObject({ ok: true });
    expect(repairResult).toMatchObject({ ok: true });
    const events = await store.listEvents("loop_gate6");
    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining(["agent_run.started", "subagent_evidence.written"])
    );
  });

  it("records loop transitions", async () => {
    const store = await createStore();

    const result = await callMcpTool(store, "loop_transition_record", {
      payload: {
        loop_run_id: "loop_gate6",
        from_status: "EVAL_RUNNING",
        to_status: "REPAIR_REQUESTED",
        reason: "Evaluator returned NEEDS_REVISION",
        agent_run_id: "agent_run_eval"
      }
    });

    expect(result).toMatchObject({
      ok: true,
      status: "appended"
    });
  });
});

function createEvalReport(overrides: Partial<EvalReport> = {}): EvalReport {
  return {
    eval_id: "eval_gate6_needs_revision",
    loop_run_id: "loop_gate6",
    task_id: "task_eval",
    module_id: "Gate6",
    evaluator_agent_id: "loop_evaluator",
    verdict: "NEEDS_REVISION",
    confidence: 0.9,
    findings: [
      {
        finding_id: "finding_gate6",
        severity: "high",
        category: "correctness",
        description: "Current validateProjectName implementation accepts invalid names.",
        evidence: [],
        required_fix: "Reject empty, whitespace-only, and over-length names."
      }
    ],
    required_fixes: [
      {
        fix_id: "fix_gate6",
        finding_ids: ["finding_gate6"],
        instruction: "Repair validateProjectName only.",
        expected_files: [{ path: "src/project-name.js" }],
        validation_commands: [{ command: "npm test" }]
      }
    ],
    validation_commands_checked: [{ command: "npm test" }],
    created_at: now(),
    updated_at: now(),
    metadata: {},
    ...overrides
  };
}

function createRepairRequest(overrides: Partial<RepairRequest> = {}): RepairRequest {
  return {
    repair_id: "repair_gate6",
    loop_run_id: "loop_gate6",
    task_id: "task_eval",
    module_id: "Gate6",
    source_eval_id: "eval_gate6_needs_revision",
    assigned_agent_id: "loop_dev_worker",
    findings: createEvalReport().findings,
    repair_instructions: ["Repair only the listed validation gap."],
    allowed_scope: ["src/project-name.js"],
    disallowed_scope: ["package.json", ".env", "test/project-name.test.js"],
    validation_commands: [{ command: "npm test" }],
    status: "REPAIR_REQUESTED",
    created_at: now(),
    updated_at: now(),
    ...overrides
  };
}
