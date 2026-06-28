import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

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

describe("SDK thread-run MCP tools", () => {
  it("defines SDK thread-run tools", () => {
    expect(MCP_TOOL_DEFINITIONS.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(["sdk_thread_run_write", "sdk_thread_run_get", "sdk_thread_run_list_by_loop"])
    );
  });

  it("writes and lists SDK thread run evidence", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "codex-loop-sdk-thread-"));
    dirs.push(stateDir);
    process.env.CODEX_LOOP_STATE_DIR = stateDir;
    const store = new JsonLoopStore({ stateDir });

    const result = await callMcpTool(store, "sdk_thread_run_write", {
      payload: {
        thread_run_id: "sdk_run_planner_1",
        loop_run_id: "loop_sdk",
        role: "planner",
        thread_id: "thread_planner",
        sandbox: "read-only",
        started_at: "2026-06-20T00:00:00.000Z",
        completed_at: null,
        status: "BLOCKED",
        artifacts_written: [],
        validation_commands: [],
        errors: ["skeleton"]
      }
    });

    expect(result).toMatchObject({ ok: true, status: "created" });
    expect((result as McpWriteResult).id).toBe("sdk_run_planner_1");
    const runs = JSON.parse(await readFile(join(stateDir, "sdk-thread-runs.json"), "utf8")) as unknown[];
    expect(runs).toHaveLength(1);

    const listed = await callMcpTool(store, "sdk_thread_run_list_by_loop", { loop_run_id: "loop_sdk" });
    expect(listed).toMatchObject({ ok: true });
  });
});
