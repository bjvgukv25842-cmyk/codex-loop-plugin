import { describe, expect, it } from "vitest";

import { parseGate6EventLines } from "../../scripts/multi-agent/parse-subagent-events.ts";

describe("Gate 6 event parser", () => {
  it("treats collab spawn_agent events as native subagent evidence, not MCP state evidence", () => {
    const summary = parseGate6EventLines([
      JSON.stringify({
        type: "thread.started",
        thread_id: "thread_parent"
      }),
      JSON.stringify({
        type: "item.completed",
        item: {
          type: "collab_tool_call",
          tool: "spawn_agent",
          sender_thread_id: "thread_parent",
          receiver_thread_ids: ["thread_planner"],
          prompt: "You are loop_planner"
        }
      }),
      JSON.stringify({
        type: "item.completed",
        item: {
          type: "collab_tool_call",
          tool: "wait",
          sender_thread_id: "thread_parent",
          receiver_thread_ids: ["thread_planner"]
        }
      })
    ]);

    expect(summary.parent_thread_id).toBe("thread_parent");
    expect(summary.spawn_agent_call_count).toBe(1);
    expect(summary.wait_call_count).toBe(1);
    expect(summary.native_subagent_thread_ids).toEqual(["thread_planner"]);
    expect(summary.subagent_lifecycle_event_count).toBe(2);
    expect(summary.mcp_tool_call_count).toBe(0);
  });

  it("counts completed MCP tool calls and preserves the tool names", () => {
    const summary = parseGate6EventLines([
      JSON.stringify({
        type: "item.started",
        item: {
          type: "mcp_tool_call",
          server: "codex_loop_store",
          tool: "agent_run_start",
          status: "in_progress"
        }
      }),
      JSON.stringify({
        type: "item.completed",
        item: {
          type: "mcp_tool_call",
          server: "codex_loop_store",
          tool: "agent_run_start",
          status: "completed"
        }
      }),
      JSON.stringify({
        type: "item.completed",
        item: {
          type: "mcp_tool_call",
          server: "codex_loop_store",
          tool: "artifact_write_by_agent",
          status: "completed"
        }
      })
    ]);

    expect(summary.mcp_tool_call_count).toBe(2);
    expect(summary.mcp_tool_names).toEqual(["agent_run_start", "artifact_write_by_agent"]);
    expect(summary.agent_run_tool_call_count).toBe(2);
  });
});
