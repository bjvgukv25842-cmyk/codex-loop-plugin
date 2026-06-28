import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { callMcpTool } from "../../src/mcp/index.ts";
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

describe("artifact producer MCP evidence", () => {
  it("records artifact producer ownership with parent and child thread ids", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "codex-loop-producer-"));
    dirs.push(stateDir);
    process.env.CODEX_LOOP_STATE_DIR = stateDir;
    const store = new JsonLoopStore({ stateDir });
    const start = await callMcpTool(store, "agent_run_start", {
      payload: {
        loop_run_id: "loop_gate6",
        agent_name: "loop_dev_worker",
        agent_type: "dev_worker",
        parent_thread_id: "thread_parent",
        thread_id: "thread_dev",
        task_id: "task_repair",
        module_id: "Gate6.1",
        phase: "repair"
      }
    });
    const agentRunId = (start as McpWriteResult).id;

    const result = await callMcpTool(store, "artifact_write_by_agent", {
      payload: {
        agent_run_id: agentRunId,
        agent_name: "loop_dev_worker",
        thread_id: "thread_dev",
        parent_thread_id: "thread_parent",
        artifact_type: "dev_result",
        artifact_path: "artifacts/dev-result.json",
        artifact_id: "artifact_dev_result"
      }
    });

    expect(result).toMatchObject({
      ok: true,
      status: "created"
    });
    const producers = JSON.parse(await readFile(join(stateDir, "artifact-producers.json"), "utf8")) as unknown[];
    expect(producers).toEqual([
      expect.objectContaining({
        artifact_id: "artifact_dev_result",
        artifact_type: "dev_result",
        artifact_path: "artifacts/dev-result.json",
        created_by_agent_run_id: agentRunId,
        created_by_agent_name: "loop_dev_worker",
        created_by_thread_id: "thread_dev",
        parent_thread_id: "thread_parent"
      })
    ]);
  });
});
