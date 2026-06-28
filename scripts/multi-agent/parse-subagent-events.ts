import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

interface Gate6EventSummary {
  parent_thread_id: string;
  event_count: number;
  thread_started_count: number;
  turn_started_count: number;
  turn_completed_count: number;
  turn_failed_count: number;
  command_execution_count: number;
  npm_test_command_seen: boolean;
  file_change_event_count: number;
  mcp_tool_call_count: number;
  mcp_tool_names: string[];
  collab_tool_call_count: number;
  spawn_agent_call_count: number;
  wait_call_count: number;
  native_subagent_thread_ids: string[];
  native_subagent_tools: string[];
  subagent_lifecycle_event_count: number;
  subagent_lifecycle_events: string[];
  agent_run_tool_call_count: number;
  error_count: number;
  errors: Array<Record<string, unknown>>;
}

const repoRoot = process.cwd();
const reportsDir = resolve(repoRoot, "evals/multi-agent/reports");
const eventsPath = resolve(reportsDir, "gate6-target-events.jsonl");
const summaryPath = resolve(reportsDir, "gate6-event-summary.json");

export function parseGate6EventLines(lines: string[]): Gate6EventSummary {
  const summary: Gate6EventSummary = {
    parent_thread_id: "",
    event_count: 0,
    thread_started_count: 0,
    turn_started_count: 0,
    turn_completed_count: 0,
    turn_failed_count: 0,
    command_execution_count: 0,
    npm_test_command_seen: false,
    file_change_event_count: 0,
    mcp_tool_call_count: 0,
    mcp_tool_names: [],
    collab_tool_call_count: 0,
    spawn_agent_call_count: 0,
    wait_call_count: 0,
    native_subagent_thread_ids: [],
    native_subagent_tools: [],
    subagent_lifecycle_event_count: 0,
    subagent_lifecycle_events: [],
    agent_run_tool_call_count: 0,
    error_count: 0,
    errors: []
  };

  const toolNames = new Set<string>();
  const subagentEvents = new Set<string>();
  const nativeSubagentThreadIds = new Set<string>();
  const nativeSubagentTools = new Set<string>();

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
      summary.thread_started_count += 1;
      summary.parent_thread_id = readString(parsed, "thread_id");
    }
    if (eventType === "turn.started") {
      summary.turn_started_count += 1;
    }
    if (eventType === "turn.completed") {
      summary.turn_completed_count += 1;
    }
    if (eventType === "turn.failed") {
      summary.turn_failed_count += 1;
      summary.error_count += 1;
      summary.errors.push({ kind: "turn_failed", event: parsed });
    }
    const item = readRecord(parsed, "item");
    if (!item) {
      continue;
    }
    const itemType = readString(item, "type");
    if (itemType === "command_execution") {
      summary.command_execution_count += eventType === "item.completed" ? 1 : 0;
      const command = readString(item, "command");
      if (/\bnpm\s+test\b/.test(command)) {
        summary.npm_test_command_seen = true;
      }
      if (eventType === "item.completed" && (readString(item, "status") === "failed" || readNumber(item, "exit_code") !== 0)) {
        summary.error_count += 1;
        summary.errors.push({
          kind: "command_execution_failed",
          command,
          exit_code: readNumber(item, "exit_code")
        });
      }
    }
    if (itemType === "file_change" && eventType === "item.completed") {
      summary.file_change_event_count += 1;
    }
    if (itemType === "collab_tool_call") {
      summary.collab_tool_call_count += eventType === "item.completed" || eventType === "item.started" ? 1 : 0;
      const tool = readString(item, "tool");
      if (tool) {
        nativeSubagentTools.add(tool);
      }
      if (tool === "spawn_agent" && eventType === "item.completed") {
        summary.spawn_agent_call_count += 1;
        for (const threadId of readStringArray(item, "receiver_thread_ids")) {
          nativeSubagentThreadIds.add(threadId);
        }
        summary.subagent_lifecycle_event_count += 1;
        subagentEvents.add(`${eventType}:collab_tool_call.spawn_agent`);
      }
      if (tool === "wait" && eventType === "item.completed") {
        summary.wait_call_count += 1;
        for (const threadId of readStringArray(item, "receiver_thread_ids")) {
          nativeSubagentThreadIds.add(threadId);
        }
        summary.subagent_lifecycle_event_count += 1;
        subagentEvents.add(`${eventType}:collab_tool_call.wait`);
      }
    } else if (itemType.includes("mcp") || itemType.includes("tool")) {
      if (eventType === "item.completed") {
        summary.mcp_tool_call_count += 1;
      }
      const name = readString(item, "tool") || readString(item, "name") || readString(item, "tool_name") || itemType;
      toolNames.add(name);
      if (eventType === "item.completed" && /agent_run_|artifact_write_by_agent|eval_report_write_by_agent|repair_request_write_by_agent|loop_transition_record/.test(name)) {
        summary.agent_run_tool_call_count += 1;
      }
    }
    if (/subagent/i.test(itemType) || /subagent/i.test(eventType)) {
      summary.subagent_lifecycle_event_count += 1;
      subagentEvents.add(`${eventType}:${itemType}`);
    }
    const text = readString(item, "text");
    if (/Subagent(Start|Stop)|subagent_(start|stop)|agent_run_(start|finish)/i.test(text)) {
      summary.subagent_lifecycle_event_count += 1;
      subagentEvents.add(`${eventType}:text_evidence`);
    }
  }

  summary.mcp_tool_names = [...toolNames].sort();
  summary.native_subagent_thread_ids = [...nativeSubagentThreadIds].sort();
  summary.native_subagent_tools = [...nativeSubagentTools].sort();
  summary.subagent_lifecycle_events = [...subagentEvents].sort();
  return summary;
}

function main(): void {
  if (!existsSync(eventsPath)) {
    writeJson(summaryPath, parseGate6EventLines([]));
    return;
  }

  const lines = readFileSync(eventsPath, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);
  const summary = parseGate6EventLines(lines);
  writeJson(summaryPath, summary);
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

function readNumber(input: Record<string, unknown>, key: string): number | null {
  const value = input[key];
  return typeof value === "number" ? value : null;
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
