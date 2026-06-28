import type { AgentRunStore, LoopTransitionRecordInput } from "../../state/agent-runs.ts";
import type { McpToolResult } from "../tool-results.ts";
import { writeResult } from "../tool-results.ts";

export type LoopTransitionToolName = "loop_transition_record";

export function createLoopTransitionToolHandlers(agentRunStore: AgentRunStore): Record<LoopTransitionToolName, (input: unknown) => Promise<McpToolResult>> {
  return {
    loop_transition_record: async (input) => {
      const payload = readPayload<LoopTransitionRecordInput>(input);
      const event = await agentRunStore.recordTransition(payload);
      return writeResult("appended", event.event_id, event.event_id);
    }
  };
}

function readPayload<T>(input: unknown): T {
  if (!isRecord(input) || !isRecord(input.payload)) {
    throw new Error("Missing required object field: payload");
  }
  return input.payload as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
