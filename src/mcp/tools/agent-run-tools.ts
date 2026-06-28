import type { EvalReport, RepairRequest } from "../../core/types.ts";
import {
  AgentRunStore,
  type AgentArtifactEvidenceInput,
  type AgentRunFinishInput,
  type AgentRunHeartbeatInput,
  type AgentRunStartInput,
  type LoopTransitionRecordInput
} from "../../state/agent-runs.ts";
import type { McpToolResult } from "../tool-results.ts";
import { writeResult } from "../tool-results.ts";

export type AgentRunToolName =
  | "agent_run_start"
  | "agent_run_finish"
  | "agent_run_heartbeat"
  | "artifact_write_by_agent"
  | "eval_report_write_by_agent"
  | "repair_request_write_by_agent"
  | "loop_transition_record";

export function createAgentRunToolHandlers(agentRunStore: AgentRunStore): Record<AgentRunToolName, (input: unknown) => Promise<McpToolResult>> {
  return {
    agent_run_start: async (input) => {
      const payload = readPayload<AgentRunStartInput>(input);
      const result = await agentRunStore.startAgentRun(payload);
      return writeResult("created", result.agentRun.agent_run_id, result.event.event_id);
    },
    agent_run_finish: async (input) => {
      const payload = readPayload<AgentRunFinishInput>(input);
      const result = await agentRunStore.finishAgentRun(payload);
      return writeResult("updated", result.agentRun.agent_run_id, result.event.event_id);
    },
    agent_run_heartbeat: async (input) => {
      const payload = readPayload<AgentRunHeartbeatInput>(input);
      const result = await agentRunStore.heartbeat(payload);
      return writeResult("appended", result.agentRun.agent_run_id, result.event.event_id);
    },
    artifact_write_by_agent: async (input) => {
      const payload = readPayload<AgentArtifactEvidenceInput>(input);
      const result = await agentRunStore.writeArtifactEvidence(payload);
      return writeResult("created", result.evidence.evidence_id, result.event.event_id);
    },
    eval_report_write_by_agent: async (input) => {
      const payload = readPayload<{ agent_run_id: string; agent_name: string; thread_id: string; parent_thread_id?: string; eval_report: EvalReport }>(input);
      const result = await agentRunStore.writeEvalReportByAgent(payload);
      return writeResult("created", result.evidence.evidence_id, result.event.event_id);
    },
    repair_request_write_by_agent: async (input) => {
      const payload = readPayload<{ agent_run_id: string; agent_name: string; thread_id: string; parent_thread_id?: string; repair_request: RepairRequest }>(input);
      const result = await agentRunStore.writeRepairRequestByAgent(payload);
      return writeResult("created", result.evidence.evidence_id, result.event.event_id);
    },
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
