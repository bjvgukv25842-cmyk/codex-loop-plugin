import { SchemaValidationError } from "../core/errors.ts";
import type {
  AgentProfile,
  Artifact,
  ContextCapsule,
  EvalReport,
  LoopRun,
  RepairRequest,
  TaskNode,
  TaskStatus
} from "../core/types.ts";
import type {
  AppendEventInput,
  CreateRepairRequestInput,
  LoopEvent,
  LoopStore,
  UpdateLoopRunInput
} from "../state/types.ts";
import { AgentRunStore } from "../state/agent-runs.ts";
import { createAgentRunToolHandlers } from "./tools/agent-run-tools.ts";
import { createSdkThreadRunToolHandlers } from "./tools/sdk-thread-run-tools.ts";
import { MCP_TOOL_DEFINITIONS, type McpToolName } from "./tool-schemas.ts";
import { errorResult, listResult, readResult, writeResult, type McpErrorResult, type McpToolResult } from "./tool-results.ts";

export { MCP_TOOL_DEFINITIONS };

type McpToolHandler = (input: unknown) => Promise<McpToolResult>;

export function createMcpToolHandlers(store: LoopStore): Record<McpToolName, McpToolHandler> {
  const agentRunStore = new AgentRunStore();
  const agentRunHandlers = createAgentRunToolHandlers(agentRunStore);
  const sdkThreadRunHandlers = createSdkThreadRunToolHandlers();
  return {
    loop_create_run: async (input) => {
      const payload = readPayload<LoopRun>(input);
      const item = await store.createLoopRun(payload);
      return writeResult("created", item.loop_run_id, await latestEventId(store, item.loop_run_id, "loop_run.created"));
    },
    loop_get_state: async (input) => readMaybe(await store.getLoopRun(readString(input, "loop_run_id")), "loop_run_id", readString(input, "loop_run_id")),
    loop_update_state: async (input) => {
      const data = readObject(input);
      const loopRunId = readString(data, "loop_run_id");
      const patch = readObjectField<UpdateLoopRunInput>(data, "patch");
      const item = await store.updateLoopRun(loopRunId, patch);
      return writeResult("updated", item.loop_run_id, await latestEventId(store, item.loop_run_id, "loop_run.updated"));
    },
    loop_append_event: async (input) => {
      const payload = readPayload<AppendEventInput>(input);
      const item = await store.appendEvent(payload);
      return writeResult("appended", item.event_id, item.event_id);
    },
    agent_register: async (input) => {
      const payload = readPayload<AgentProfile>(input);
      const item = await store.registerAgent(payload);
      return writeResult("created", item.agent_id, await latestEventId(store, "loop_unassigned", "agent.registered"));
    },
    agent_get: async (input) => readMaybe(await store.getAgent(readString(input, "agent_id")), "agent_id", readString(input, "agent_id")),
    agent_update_thread: async (input) => {
      const data = readObject(input);
      const agentId = readString(data, "agent_id");
      const item = await store.updateAgentThread(agentId, {
        current_thread_id: readString(data, "current_thread_id")
      });
      return writeResult("updated", item.agent_id, await latestEventId(store, "loop_unassigned", "agent.thread_updated"));
    },
    agent_list: async () => listResult(await store.listAgents()),
    task_create: async (input) => {
      const payload = readPayload<TaskNode>(input);
      const item = await store.createTask(payload);
      return writeResult("created", item.task_id, await latestEventId(store, item.loop_run_id, "task.created"));
    },
    task_get: async (input) => readMaybe(await store.getTask(readString(input, "task_id")), "task_id", readString(input, "task_id")),
    task_update_status: async (input) => {
      const data = readObject(input);
      const taskId = readString(data, "task_id");
      const item = await store.updateTaskStatus(taskId, {
        status: readString(data, "status") as TaskStatus
      });
      return writeResult("updated", item.task_id, await latestEventId(store, item.loop_run_id, "task.status_updated"));
    },
    task_list_by_loop: async (input) => listResult(await store.listTasksByLoopRun(readString(input, "loop_run_id"))),
    artifact_write: async (input) => {
      const payload = readPayload<Artifact>(input);
      const item = await store.writeArtifact(payload);
      return writeResult("created", item.artifact_id, await latestEventId(store, item.loop_run_id, "artifact.written"));
    },
    artifact_get: async (input) =>
      readMaybe(await store.getArtifact(readString(input, "artifact_id")), "artifact_id", readString(input, "artifact_id")),
    artifact_list_by_task: async (input) => listResult(await store.listArtifactsByTask(readString(input, "task_id"))),
    eval_write_report: async (input) => {
      const payload = readPayload<EvalReport>(input);
      const item = await store.writeEvalReport(payload);
      return writeResult("created", item.eval_id, await latestEventId(store, item.loop_run_id, "eval_report.written"));
    },
    eval_get_report: async (input) => readMaybe(await store.getEvalReport(readString(input, "eval_id")), "eval_id", readString(input, "eval_id")),
    eval_list_by_task: async (input) => listResult(await store.listEvalReportsByTask(readString(input, "task_id"))),
    repair_create_request: async (input) => {
      const payload = readPayload<CreateRepairRequestInput>(input);
      const item = await store.createRepairRequest(payload);
      return writeResult("created", item.repair_id, await latestEventId(store, item.loop_run_id, "repair_request.created"));
    },
    repair_get_request: async (input) =>
      readMaybe(await store.getRepairRequest(readString(input, "repair_id")), "repair_id", readString(input, "repair_id")),
    repair_list_by_task: async (input) => listResult(await store.listRepairRequestsByTask(readString(input, "task_id"))),
    context_capsule_write: async (input) => {
      const payload = readPayload<ContextCapsule>(input);
      const item = await store.writeContextCapsule(payload);
      return writeResult("created", item.capsule_id, await latestEventId(store, item.loop_run_id, "context_capsule.written"));
    },
    context_capsule_get: async (input) =>
      readMaybe(await store.getContextCapsule(readString(input, "capsule_id")), "capsule_id", readString(input, "capsule_id")),
    context_capsule_list_by_agent: async (input) => listResult(await store.listContextCapsulesByAgent(readString(input, "agent_id"))),
    ...agentRunHandlers,
    ...sdkThreadRunHandlers
  };
}

export async function callMcpTool(store: LoopStore, name: string, input: unknown = {}): Promise<McpToolResult> {
  if (!isMcpToolName(name)) {
    return errorResult({
      code: "unknown_tool",
      message: `Unknown MCP tool: ${name}`
    });
  }

  const handlers = createMcpToolHandlers(store);

  try {
    return await handlers[name](input);
  } catch (error) {
    return toMcpError(error);
  }
}

function isMcpToolName(name: string): name is McpToolName {
  return MCP_TOOL_DEFINITIONS.some((tool) => tool.name === name);
}

function readMaybe<T>(item: T | null, idKey: string, id: string): McpToolResult<T> {
  if (!item) {
    return errorResult({
      code: "not_found",
      message: `${idKey} not found: ${id}`,
      id
    });
  }

  return readResult(item);
}

async function latestEventId(store: LoopStore, loopRunId: string, eventType: string): Promise<string> {
  const events = await store.listEvents(loopRunId);
  const matchingEvents = events.filter((event) => event.type === eventType);
  return matchingEvents.at(-1)?.event_id ?? "event_not_recorded";
}

function readPayload<T>(input: unknown): T {
  return readObjectField<T>(readObject(input), "payload");
}

function readString(input: unknown, key: string): string {
  const data = readObject(input);
  const value = data[key];

  if (typeof value !== "string" || value.length === 0) {
    throw new ToolInputError(`Missing required string field: ${key}`, {
      path: `/${key}`
    });
  }

  return value;
}

function readObject(input: unknown): Record<string, unknown> {
  if (!isRecord(input)) {
    throw new ToolInputError("Tool input must be an object", {
      path: "/"
    });
  }

  return input;
}

function readObjectField<T>(input: Record<string, unknown>, key: string): T {
  const value = input[key];

  if (!isRecord(value)) {
    throw new ToolInputError(`Missing required object field: ${key}`, {
      path: `/${key}`
    });
  }

  return value as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toMcpError(error: unknown): McpErrorResult {
  if (error instanceof ToolInputError) {
    return errorResult({
      code: "invalid_input",
      message: error.message,
      details: error.details
    });
  }

  if (error instanceof SchemaValidationError) {
    return errorResult({
      code: "invalid_input",
      message: error.message,
      details: error.details
    });
  }

  if (error instanceof Error && error.message.includes("id not found")) {
    return errorResult({
      code: "not_found",
      message: error.message
    });
  }

  return errorResult({
    code: "store_error",
    message: error instanceof Error ? error.message : "Unknown store error",
    details: normalizeErrorDetails(error)
  });
}

function normalizeErrorDetails(error: unknown): unknown {
  if (error instanceof Error) {
    return {
      name: error.name
    };
  }

  return error;
}

class ToolInputError extends Error {
  readonly details: unknown;

  constructor(message: string, details: unknown) {
    super(message);
    this.name = "ToolInputError";
    this.details = details;
  }
}
