import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { JsonLoopStore } from "../state/json-store.ts";
import type { LoopStore } from "../state/types.ts";
import { MCP_TOOL_DEFINITIONS } from "./tool-schemas.ts";
import { callMcpTool } from "./tools.ts";
import type { McpToolResult } from "./tool-results.ts";

export const MCP_SERVER_NAME = "codex_loop_store";
export const MCP_SERVER_VERSION = "0.1.0";

export function createLoopStoreMcpServer(store: LoopStore = new JsonLoopStore()): Server {
  const server = new Server(
    {
      name: MCP_SERVER_NAME,
      version: MCP_SERVER_VERSION
    },
    {
      capabilities: {
        tools: {}
      },
      instructions:
        "Codex Loop Store exposes local state-only tools for LoopRun, AgentProfile, TaskNode, Artifact, EvalReport, RepairRequest, ContextCapsule, and EventLog records. Tools do not execute shell commands, access the network, or mutate repository source files."
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: MCP_TOOL_DEFINITIONS.map((definition) => ({
      name: definition.name,
      title: definition.title,
      description: definition.description,
      inputSchema: definition.inputSchema,
      outputSchema: definition.outputSchema,
      annotations: definition.annotations,
      execution: {
        taskSupport: "forbidden" as const
      }
    }))
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const result = await callMcpTool(store, request.params.name, request.params.arguments ?? {});
    return toCallToolResult(result);
  });

  return server;
}

export function toCallToolResult(result: McpToolResult): CallToolResult {
  return {
    structuredContent: result as unknown as Record<string, unknown>,
    content: [
      {
        type: "text",
        text: JSON.stringify(result)
      }
    ],
    isError: !result.ok
  };
}

export async function startLoopStoreMcpServer(store: LoopStore = new JsonLoopStore()): Promise<void> {
  const server = createLoopStoreMcpServer(store);
  await server.connect(new StdioServerTransport());
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startLoopStoreMcpServer().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unable to start Codex Loop MCP server";
    console.error(
      JSON.stringify(
        {
          ok: false,
          error: {
            code: "server_start_failed",
            message
          }
        },
        null,
        2
      )
    );
    process.exitCode = 1;
  });
}
