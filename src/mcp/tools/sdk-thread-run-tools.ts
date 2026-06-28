import type { SdkThreadRun } from "../../core/types.ts";
import { SdkThreadRunStore } from "../../state/sdk-thread-runs.ts";
import type { McpToolResult } from "../tool-results.ts";
import { listResult, readResult, writeResult } from "../tool-results.ts";

export type SdkThreadRunToolName = "sdk_thread_run_write" | "sdk_thread_run_get" | "sdk_thread_run_list_by_loop";

export function createSdkThreadRunToolHandlers(store = new SdkThreadRunStore()): Record<SdkThreadRunToolName, (input: unknown) => Promise<McpToolResult>> {
  return {
    sdk_thread_run_write: async (input) => {
      const payload = readPayload<SdkThreadRun>(input);
      const result = await store.writeThreadRun(payload);
      return writeResult("created", result.threadRun.thread_run_id, result.event.event_id);
    },
    sdk_thread_run_get: async (input) => {
      const threadRunId = readString(input, "thread_run_id");
      const item = await store.getThreadRun(threadRunId);
      return item ? readResult(item) : { ok: false, error: { code: "not_found", message: `thread_run_id not found: ${threadRunId}`, id: threadRunId } };
    },
    sdk_thread_run_list_by_loop: async (input) => listResult(await store.listThreadRuns(readString(input, "loop_run_id")))
  };
}

function readPayload<T>(input: unknown): T {
  if (!isRecord(input) || !isRecord(input.payload)) {
    throw new Error("Missing required object field: payload");
  }
  return input.payload as T;
}

function readString(input: unknown, key: string): string {
  if (!isRecord(input) || typeof input[key] !== "string" || input[key].length === 0) {
    throw new Error(`Missing required string field: ${key}`);
  }
  return input[key];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
