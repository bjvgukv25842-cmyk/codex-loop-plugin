import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";

import { MCP_TOOL_RESULT_SCHEMA } from "./tool-results.ts";

export type McpToolName =
  | "loop_create_run"
  | "loop_get_state"
  | "loop_update_state"
  | "loop_append_event"
  | "agent_register"
  | "agent_get"
  | "agent_update_thread"
  | "agent_list"
  | "task_create"
  | "task_get"
  | "task_update_status"
  | "task_list_by_loop"
  | "artifact_write"
  | "artifact_get"
  | "artifact_list_by_task"
  | "eval_write_report"
  | "eval_get_report"
  | "eval_list_by_task"
  | "repair_create_request"
  | "repair_get_request"
  | "repair_list_by_task"
  | "context_capsule_write"
  | "context_capsule_get"
  | "context_capsule_list_by_agent"
  | "agent_run_start"
  | "agent_run_finish"
  | "agent_run_heartbeat"
  | "artifact_write_by_agent"
  | "eval_report_write_by_agent"
  | "repair_request_write_by_agent"
  | "loop_transition_record"
  | "sdk_thread_run_write"
  | "sdk_thread_run_get"
  | "sdk_thread_run_list_by_loop";

export type JsonObjectSchema = {
  type: "object";
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
  [key: string]: unknown;
};

export interface McpToolDefinition {
  name: McpToolName;
  title: string;
  description: string;
  inputSchema: JsonObjectSchema;
  outputSchema: typeof MCP_TOOL_RESULT_SCHEMA;
  annotations: ToolAnnotations;
}

const entityPayloadSchema = (title: string): JsonObjectSchema => ({
  type: "object",
  required: ["payload"],
  properties: {
    payload: {
      type: "object",
      title,
      additionalProperties: true
    }
  },
  additionalProperties: false
});

const idSchema = (key: string, description: string): JsonObjectSchema => ({
  type: "object",
  required: [key],
  properties: {
    [key]: {
      type: "string",
      description
    }
  },
  additionalProperties: false
});

const writeAnnotations: ToolAnnotations = {
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
  readOnlyHint: false
};

const readAnnotations: ToolAnnotations = {
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
  readOnlyHint: true
};

export const MCP_TOOL_DEFINITIONS: McpToolDefinition[] = [
  {
    name: "loop_create_run",
    title: "Create LoopRun",
    description: "Create a LoopRun in the local Codex Loop state store.",
    inputSchema: entityPayloadSchema("LoopRun"),
    outputSchema: MCP_TOOL_RESULT_SCHEMA,
    annotations: writeAnnotations
  },
  {
    name: "loop_get_state",
    title: "Get LoopRun",
    description: "Read one LoopRun by loop_run_id from the local state store.",
    inputSchema: idSchema("loop_run_id", "LoopRun id to read."),
    outputSchema: MCP_TOOL_RESULT_SCHEMA,
    annotations: readAnnotations
  },
  {
    name: "loop_update_state",
    title: "Update LoopRun",
    description: "Patch an existing LoopRun by loop_run_id.",
    inputSchema: {
      type: "object",
      required: ["loop_run_id", "patch"],
      properties: {
        loop_run_id: {
          type: "string"
        },
        patch: {
          type: "object",
          additionalProperties: true
        }
      },
      additionalProperties: false
    },
    outputSchema: MCP_TOOL_RESULT_SCHEMA,
    annotations: writeAnnotations
  },
  {
    name: "loop_append_event",
    title: "Append Event",
    description: "Append a bounded event log entry for a loop_run_id.",
    inputSchema: entityPayloadSchema("LoopEvent"),
    outputSchema: MCP_TOOL_RESULT_SCHEMA,
    annotations: writeAnnotations
  },
  {
    name: "agent_register",
    title: "Register Agent",
    description: "Register an AgentProfile in the local state store.",
    inputSchema: entityPayloadSchema("AgentProfile"),
    outputSchema: MCP_TOOL_RESULT_SCHEMA,
    annotations: writeAnnotations
  },
  {
    name: "agent_get",
    title: "Get Agent",
    description: "Read one AgentProfile by agent_id.",
    inputSchema: idSchema("agent_id", "Agent id to read."),
    outputSchema: MCP_TOOL_RESULT_SCHEMA,
    annotations: readAnnotations
  },
  {
    name: "agent_update_thread",
    title: "Update Agent Thread",
    description: "Update one AgentProfile current_thread_id.",
    inputSchema: {
      type: "object",
      required: ["agent_id", "current_thread_id"],
      properties: {
        agent_id: {
          type: "string"
        },
        current_thread_id: {
          type: "string"
        }
      },
      additionalProperties: false
    },
    outputSchema: MCP_TOOL_RESULT_SCHEMA,
    annotations: writeAnnotations
  },
  {
    name: "agent_list",
    title: "List Agents",
    description: "List all registered AgentProfile records.",
    inputSchema: {
      type: "object",
      additionalProperties: false
    },
    outputSchema: MCP_TOOL_RESULT_SCHEMA,
    annotations: readAnnotations
  },
  {
    name: "task_create",
    title: "Create Task",
    description: "Create a TaskNode in the local state store.",
    inputSchema: entityPayloadSchema("TaskNode"),
    outputSchema: MCP_TOOL_RESULT_SCHEMA,
    annotations: writeAnnotations
  },
  {
    name: "task_get",
    title: "Get Task",
    description: "Read one TaskNode by task_id.",
    inputSchema: idSchema("task_id", "Task id to read."),
    outputSchema: MCP_TOOL_RESULT_SCHEMA,
    annotations: readAnnotations
  },
  {
    name: "task_update_status",
    title: "Update Task Status",
    description: "Update one TaskNode status.",
    inputSchema: {
      type: "object",
      required: ["task_id", "status"],
      properties: {
        task_id: {
          type: "string"
        },
        status: {
          type: "string",
          enum: [
            "TODO",
            "READY_FOR_DEV",
            "DEV_RUNNING",
            "DEV_DONE",
            "EVAL_RUNNING",
            "PASS",
            "NEEDS_REVISION",
            "REPAIR_REQUESTED",
            "BLOCKED",
            "CANCELLED"
          ]
        }
      },
      additionalProperties: false
    },
    outputSchema: MCP_TOOL_RESULT_SCHEMA,
    annotations: writeAnnotations
  },
  {
    name: "task_list_by_loop",
    title: "List Tasks By Loop",
    description: "List TaskNode records for a loop_run_id.",
    inputSchema: idSchema("loop_run_id", "LoopRun id to filter tasks."),
    outputSchema: MCP_TOOL_RESULT_SCHEMA,
    annotations: readAnnotations
  },
  {
    name: "artifact_write",
    title: "Write Artifact",
    description: "Write an Artifact record to local state.",
    inputSchema: entityPayloadSchema("Artifact"),
    outputSchema: MCP_TOOL_RESULT_SCHEMA,
    annotations: writeAnnotations
  },
  {
    name: "artifact_get",
    title: "Get Artifact",
    description: "Read one Artifact by artifact_id.",
    inputSchema: idSchema("artifact_id", "Artifact id to read."),
    outputSchema: MCP_TOOL_RESULT_SCHEMA,
    annotations: readAnnotations
  },
  {
    name: "artifact_list_by_task",
    title: "List Artifacts By Task",
    description: "List Artifact records for a task_id.",
    inputSchema: idSchema("task_id", "Task id to filter artifacts."),
    outputSchema: MCP_TOOL_RESULT_SCHEMA,
    annotations: readAnnotations
  },
  {
    name: "eval_write_report",
    title: "Write EvalReport",
    description: "Write an EvalReport record to local state.",
    inputSchema: entityPayloadSchema("EvalReport"),
    outputSchema: MCP_TOOL_RESULT_SCHEMA,
    annotations: writeAnnotations
  },
  {
    name: "eval_get_report",
    title: "Get EvalReport",
    description: "Read one EvalReport by eval_id.",
    inputSchema: idSchema("eval_id", "Eval report id to read."),
    outputSchema: MCP_TOOL_RESULT_SCHEMA,
    annotations: readAnnotations
  },
  {
    name: "eval_list_by_task",
    title: "List EvalReports By Task",
    description: "List EvalReport records for a task_id.",
    inputSchema: idSchema("task_id", "Task id to filter eval reports."),
    outputSchema: MCP_TOOL_RESULT_SCHEMA,
    annotations: readAnnotations
  },
  {
    name: "repair_create_request",
    title: "Create RepairRequest",
    description: "Create a RepairRequest record in local state.",
    inputSchema: entityPayloadSchema("RepairRequest"),
    outputSchema: MCP_TOOL_RESULT_SCHEMA,
    annotations: writeAnnotations
  },
  {
    name: "repair_get_request",
    title: "Get RepairRequest",
    description: "Read one RepairRequest by repair_id.",
    inputSchema: idSchema("repair_id", "Repair request id to read."),
    outputSchema: MCP_TOOL_RESULT_SCHEMA,
    annotations: readAnnotations
  },
  {
    name: "repair_list_by_task",
    title: "List RepairRequests By Task",
    description: "List RepairRequest records for a task_id.",
    inputSchema: idSchema("task_id", "Task id to filter repair requests."),
    outputSchema: MCP_TOOL_RESULT_SCHEMA,
    annotations: readAnnotations
  },
  {
    name: "context_capsule_write",
    title: "Write ContextCapsule",
    description: "Write a ContextCapsule record to local state.",
    inputSchema: entityPayloadSchema("ContextCapsule"),
    outputSchema: MCP_TOOL_RESULT_SCHEMA,
    annotations: writeAnnotations
  },
  {
    name: "context_capsule_get",
    title: "Get ContextCapsule",
    description: "Read one ContextCapsule by capsule_id.",
    inputSchema: idSchema("capsule_id", "Context capsule id to read."),
    outputSchema: MCP_TOOL_RESULT_SCHEMA,
    annotations: readAnnotations
  },
  {
    name: "context_capsule_list_by_agent",
    title: "List ContextCapsules By Agent",
    description: "List ContextCapsule records for an agent_id.",
    inputSchema: idSchema("agent_id", "Agent id to filter context capsules."),
    outputSchema: MCP_TOOL_RESULT_SCHEMA,
    annotations: readAnnotations
  },
  {
    name: "agent_run_start",
    title: "Start AgentRun",
    description: "Start a native subagent run and record parent/thread evidence.",
    inputSchema: entityPayloadSchema("AgentRunStartInput"),
    outputSchema: MCP_TOOL_RESULT_SCHEMA,
    annotations: writeAnnotations
  },
  {
    name: "agent_run_finish",
    title: "Finish AgentRun",
    description: "Finish a native subagent run with status and artifact ids.",
    inputSchema: entityPayloadSchema("AgentRunFinishInput"),
    outputSchema: MCP_TOOL_RESULT_SCHEMA,
    annotations: writeAnnotations
  },
  {
    name: "agent_run_heartbeat",
    title: "Heartbeat AgentRun",
    description: "Record a heartbeat event for a native subagent run.",
    inputSchema: entityPayloadSchema("AgentRunHeartbeatInput"),
    outputSchema: MCP_TOOL_RESULT_SCHEMA,
    annotations: writeAnnotations
  },
  {
    name: "artifact_write_by_agent",
    title: "Write Agent Artifact Evidence",
    description: "Record artifact ownership evidence for a native subagent run.",
    inputSchema: entityPayloadSchema("AgentArtifactEvidenceInput"),
    outputSchema: MCP_TOOL_RESULT_SCHEMA,
    annotations: writeAnnotations
  },
  {
    name: "eval_report_write_by_agent",
    title: "Write EvalReport Evidence By Agent",
    description: "Record EvalReport evidence that must come from loop_evaluator.",
    inputSchema: entityPayloadSchema("EvalReportByAgentInput"),
    outputSchema: MCP_TOOL_RESULT_SCHEMA,
    annotations: writeAnnotations
  },
  {
    name: "repair_request_write_by_agent",
    title: "Write RepairRequest Evidence By Agent",
    description: "Record RepairRequest evidence with source EvalReport linkage.",
    inputSchema: entityPayloadSchema("RepairRequestByAgentInput"),
    outputSchema: MCP_TOOL_RESULT_SCHEMA,
    annotations: writeAnnotations
  },
  {
    name: "loop_transition_record",
    title: "Record Loop Transition",
    description: "Record a loop state transition with optional agent_run_id evidence.",
    inputSchema: entityPayloadSchema("LoopTransitionRecordInput"),
    outputSchema: MCP_TOOL_RESULT_SCHEMA,
    annotations: writeAnnotations
  },
  {
    name: "sdk_thread_run_write",
    title: "Write SDK ThreadRun",
    description: "Record SDK-Orchestrated Mode thread run evidence.",
    inputSchema: entityPayloadSchema("SdkThreadRun"),
    outputSchema: MCP_TOOL_RESULT_SCHEMA,
    annotations: writeAnnotations
  },
  {
    name: "sdk_thread_run_get",
    title: "Get SDK ThreadRun",
    description: "Read one SDK ThreadRun by thread_run_id.",
    inputSchema: idSchema("thread_run_id", "SDK thread run id to read."),
    outputSchema: MCP_TOOL_RESULT_SCHEMA,
    annotations: readAnnotations
  },
  {
    name: "sdk_thread_run_list_by_loop",
    title: "List SDK ThreadRuns By Loop",
    description: "List SDK ThreadRun records for a loop_run_id.",
    inputSchema: idSchema("loop_run_id", "LoopRun id to filter SDK thread runs."),
    outputSchema: MCP_TOOL_RESULT_SCHEMA,
    annotations: readAnnotations
  }
];

export function getMcpToolDefinition(name: McpToolName): McpToolDefinition {
  const definition = MCP_TOOL_DEFINITIONS.find((tool) => tool.name === name);

  if (!definition) {
    throw new Error(`Unknown MCP tool: ${name}`);
  }

  return definition;
}
