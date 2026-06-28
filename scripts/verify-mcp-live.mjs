import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const now = "2026-06-18T14:10:00.000Z";

const REQUIRED_TOOLS = [
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
  "loop_transition_record"
];

const loopRun = {
  loop_run_id: "loop_live_mcp_check",
  project_id: "project_codex_loop_plugin",
  user_goal: "Verify MCP live availability.",
  normalized_goal: "Run a live stdio MCP check against the local loop store server.",
  status: "TASK_GRAPH_READY",
  current_module_id: "Gate5",
  current_iteration: 1,
  max_iterations: 3,
  source_of_truth_files: ["AGENTS.md", "docs/LOOP_PROGRESS.md", "docs/DECISIONS.md"],
  started_at: now,
  updated_at: now,
  completed_at: null,
  stop_conditions: ["MCP live check complete"],
  budget: {
    max_repair_iterations_per_task: 1,
    max_context_restarts_per_agent: 1
  },
  metadata: {
    check: "live-mcp"
  }
};

const evalReport = {
  eval_id: "eval_live_mcp_pass",
  loop_run_id: "loop_live_mcp_check",
  task_id: "task_live_mcp",
  module_id: "Gate5",
  evaluator_agent_id: "agent_live_eval",
  verdict: "PASS",
  confidence: 0.9,
  findings: [],
  required_fixes: [],
  validation_commands_checked: [
    {
      command: "npm run validate",
      reason: "Project validation passed before live MCP check."
    }
  ],
  created_at: now,
  updated_at: now,
  metadata: {
    check: "live-mcp"
  }
};

const stateDir = await mkdtemp(join(tmpdir(), "codex-loop-mcp-live-"));
const client = new Client(
  {
    name: "codex-loop-mcp-live-check",
    version: "0.1.0"
  },
  {
    capabilities: {}
  }
);

const transport = new StdioClientTransport({
  command: "node",
  args: ["src/mcp/server.ts"],
  cwd: process.cwd(),
  env: {
    ...process.env,
    CODEX_LOOP_STATE_DIR: stateDir
  }
});

try {
  await client.connect(transport);

  const listed = await client.listTools();
  const toolNames = listed.tools.map((tool) => tool.name).sort();
  const missingTools = REQUIRED_TOOLS.filter((tool) => !toolNames.includes(tool));
  const shellLikeToolNames = toolNames.filter((tool) => /shell|exec|bash|command/i.test(tool));

  const loopCreate = await client.callTool({
    name: "loop_create_run",
    arguments: {
      payload: loopRun
    }
  });
  const invalidEval = await client.callTool({
    name: "eval_write_report",
    arguments: {
      payload: {
        eval_id: "invalid_missing_required_fields"
      }
    }
  });
  const validEval = await client.callTool({
    name: "eval_write_report",
    arguments: {
      payload: evalReport
    }
  });
  const notFound = await client.callTool({
    name: "loop_get_state",
    arguments: {
      loop_run_id: "missing_loop"
    }
  });

  const events = JSON.parse(await readFile(join(stateDir, "events.json"), "utf8"));
  const evalReports = JSON.parse(await readFile(join(stateDir, "eval-reports.json"), "utf8"));
  const eventTypes = events.map((event) => event.type);

  const checks = {
    hasAllRequiredTools: missingTools.length === 0,
    hasNoShellLikeTools: shellLikeToolNames.length === 0,
    loopCreateSucceeded: loopCreate.isError !== true,
    invalidPayloadRejected: invalidEval.isError === true,
    validEvalSucceeded: validEval.isError !== true,
    notFoundStructured: notFound.isError === true,
    writeAppendedLoopEvent: eventTypes.includes("loop_run.created"),
    writeAppendedEvalEvent: eventTypes.includes("eval_report.written"),
    wroteEvalReport: evalReports.some((report) => report.eval_id === evalReport.eval_id)
  };

  const ok = Object.values(checks).every(Boolean);
  const result = {
    mcp_live_status: ok ? "PASS" : "NEEDS_REVISION",
    state_dir: stateDir,
    tools_count: toolNames.length,
    missing_tools: missingTools,
    shell_like_tool_names: shellLikeToolNames,
    events_count: events.length,
    event_types: eventTypes,
    eval_report_ids: evalReports.map((report) => report.eval_id),
    checks
  };

  console.log(JSON.stringify(result, null, 2));
  process.exitCode = ok ? 0 : 1;
} catch (error) {
  console.log(
    JSON.stringify(
      {
        mcp_live_status: "BLOCKED",
        state_dir: stateDir,
        error: error instanceof Error ? error.message : String(error)
      },
      null,
      2
    )
  );
  process.exitCode = 1;
} finally {
  try {
    await client.close();
  } catch {
    // The process is already reporting the primary MCP failure.
  }
  await rm(stateDir, {
    recursive: true,
    force: true
  });
}
