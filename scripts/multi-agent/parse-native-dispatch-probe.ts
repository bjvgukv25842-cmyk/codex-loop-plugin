import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

interface NativeDispatchProbeEventSummary {
  parent_thread_id: string;
  event_count: number;
  command_execution_count: number;
  collab_tool_call_count: number;
  spawn_agent_call_count: number;
  wait_call_count: number;
  spawned_agent_names: string[];
  native_subagent_thread_ids: string[];
  mcp_tool_call_count: number;
  mcp_tool_names: string[];
  agent_run_tool_call_count: number;
  error_count: number;
  errors: Array<Record<string, unknown>>;
}

const repoRoot = process.cwd();
const reportsDir = resolve(repoRoot, "evals/multi-agent/reports");
const eventsPath = resolve(reportsDir, "native-dispatch-probe-events.jsonl");
const summaryPath = resolve(reportsDir, "native-dispatch-probe-event-summary.json");

export function parseNativeDispatchProbeLines(lines: string[]): NativeDispatchProbeEventSummary {
  const summary: NativeDispatchProbeEventSummary = {
    parent_thread_id: "",
    event_count: 0,
    command_execution_count: 0,
    collab_tool_call_count: 0,
    spawn_agent_call_count: 0,
    wait_call_count: 0,
    spawned_agent_names: [],
    native_subagent_thread_ids: [],
    mcp_tool_call_count: 0,
    mcp_tool_names: [],
    agent_run_tool_call_count: 0,
    error_count: 0,
    errors: []
  };
  const agentNames = new Set<string>();
  const threadIds = new Set<string>();
  const mcpToolNames = new Set<string>();

  for (const line of lines) {
    summary.event_count += 1;
    const parsed = parseJsonLine(line);
    if (!parsed) {
      summary.error_count += 1;
      summary.errors.push({ kind: "invalid_jsonl", line: line.slice(0, 300) });
      continue;
    }
    const eventType = readString(parsed, "type");
    if (eventType === "thread.started") {
      summary.parent_thread_id = readString(parsed, "thread_id");
    }
    const item = readRecord(parsed, "item");
    if (!item) {
      continue;
    }
    const itemType = readString(item, "type");
    if (itemType === "command_execution" && eventType === "item.completed") {
      summary.command_execution_count += 1;
    }
    if (itemType === "collab_tool_call") {
      summary.collab_tool_call_count += eventType === "item.completed" || eventType === "item.started" ? 1 : 0;
      const tool = readString(item, "tool");
      if (tool === "spawn_agent" && eventType === "item.completed") {
        summary.spawn_agent_call_count += 1;
        const prompt = readString(item, "prompt");
        const agentName = inferAgentName(prompt);
        if (agentName) {
          agentNames.add(agentName);
        }
        for (const threadId of readStringArray(item, "receiver_thread_ids")) {
          threadIds.add(threadId);
        }
      }
      if (tool === "wait" && eventType === "item.completed") {
        summary.wait_call_count += 1;
        for (const threadId of readStringArray(item, "receiver_thread_ids")) {
          threadIds.add(threadId);
        }
      }
    } else if (itemType.includes("mcp") || itemType.includes("tool")) {
      if (eventType === "item.completed") {
        summary.mcp_tool_call_count += 1;
      }
      const toolName = readString(item, "tool") || readString(item, "name") || readString(item, "tool_name") || itemType;
      if (toolName) {
        mcpToolNames.add(toolName);
      }
      if (eventType === "item.completed" && /agent_run_(start|finish)|artifact_write_by_agent/.test(toolName)) {
        summary.agent_run_tool_call_count += 1;
      }
    }
  }

  summary.spawned_agent_names = [...agentNames].sort();
  summary.native_subagent_thread_ids = [...threadIds].sort();
  summary.mcp_tool_names = [...mcpToolNames].sort();
  return summary;
}

function main(): void {
  const lines = existsSync(eventsPath)
    ? readFileSync(eventsPath, "utf8").split(/\r?\n/).filter((line) => line.trim().length > 0)
    : [];
  writeJson(summaryPath, parseNativeDispatchProbeLines(lines));
}

function inferAgentName(prompt: string): string {
  for (const agentName of ["loop_planner", "loop_evaluator", "loop_dev_worker", "loop_context_distiller"]) {
    if (prompt.includes(agentName)) {
      return agentName;
    }
  }
  return "";
}

function parseJsonLine(line: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(line);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function readRecord(input: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const value = input[key];
  return isRecord(value) ? value : null;
}

function readString(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  return typeof value === "string" ? value : "";
}

function readStringArray(input: Record<string, unknown>, key: string): string[] {
  const value = input[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
