import type { RuntimeRole, RuntimeStatus, RuntimeThreadResult } from "./runtime-types.ts";

export interface SdkLikeTurn {
  finalResponse?: unknown;
  final_response?: unknown;
  final_response_text?: unknown;
  items?: unknown;
  events?: unknown;
}

export interface SdkNormalizeInput {
  role: RuntimeRole;
  thread_id: string;
  turn: SdkLikeTurn;
  events?: unknown[];
  sandbox_control?: RuntimeThreadResult["sandbox_control"];
}

export function extractFinalResponse(turn: SdkLikeTurn): string {
  for (const value of [turn.finalResponse, turn.final_response, turn.final_response_text]) {
    if (typeof value === "string") {
      return value;
    }
  }
  return "";
}

export function normalizeSdkEvents(turn: SdkLikeTurn, streamedEvents: unknown[] = []): unknown[] {
  if (streamedEvents.length > 0) {
    return streamedEvents;
  }
  if (Array.isArray(turn.events)) {
    return turn.events;
  }
  if (Array.isArray(turn.items)) {
    return turn.items.map((item) => ({
      type: "item.completed",
      item
    }));
  }
  return [];
}

export function statusFromFinalResponse(finalResponse: string): RuntimeStatus {
  if (/"status"\s*:\s*"BLOCKED"/.test(finalResponse)) {
    return "BLOCKED";
  }
  if (/"status"\s*:\s*"NEEDS_REVISION"/.test(finalResponse) || /"verdict"\s*:\s*"NEEDS_REVISION"/.test(finalResponse)) {
    return "NEEDS_REVISION";
  }
  if (/"status"\s*:\s*"FAIL(?:ED)?"/.test(finalResponse)) {
    return "FAILED";
  }
  return "PASS";
}

export function normalizeSdkResult(input: SdkNormalizeInput): RuntimeThreadResult {
  const finalResponse = extractFinalResponse(input.turn);
  const events = normalizeSdkEvents(input.turn, input.events);
  return {
    thread_id: input.thread_id,
    role: input.role,
    status: statusFromFinalResponse(finalResponse),
    final_response: finalResponse,
    events,
    events_path: "",
    stdout_path: "",
    stderr_path: "",
    artifacts: [],
    sandbox_control: input.sandbox_control ?? "UNVERIFIED",
    event_count: events.length,
    errors: []
  };
}
