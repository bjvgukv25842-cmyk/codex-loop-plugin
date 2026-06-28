import type { AgentArtifactEvidenceInput, AgentRunStore } from "../../state/agent-runs.ts";
import type { McpToolResult } from "../tool-results.ts";
import { writeResult } from "../tool-results.ts";

export type ArtifactProducerToolName = "artifact_write_by_agent";

export function createArtifactProducerToolHandlers(agentRunStore: AgentRunStore): Record<ArtifactProducerToolName, (input: unknown) => Promise<McpToolResult>> {
  return {
    artifact_write_by_agent: async (input) => {
      const payload = readPayload<AgentArtifactEvidenceInput>(input);
      const result = await agentRunStore.writeArtifactEvidence(payload);
      return writeResult("created", result.evidence.evidence_id, result.event.event_id);
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
