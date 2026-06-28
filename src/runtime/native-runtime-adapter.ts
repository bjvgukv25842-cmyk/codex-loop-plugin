import { emptyRuntimeResult, type RuntimeAdapter } from "./runtime-adapter.ts";
import type {
  RuntimeEventsInput,
  RuntimeFinalResponseInput,
  RuntimeStopThreadInput,
  RuntimeThreadEventsResult,
  RuntimeThreadInput,
  RuntimeThreadRefInput,
  RuntimeThreadResult
} from "./runtime-types.ts";

export class NativeRuntimeAdapter implements RuntimeAdapter {
  async startThread(input: RuntimeThreadInput): Promise<RuntimeThreadResult> {
    return experimental(input, "Native Subagent Mode is experimental and is not the Gate 6B production path.");
  }

  async runThread(input: RuntimeThreadInput): Promise<RuntimeThreadResult> {
    return experimental(input, "Native Subagent Mode is experimental and is not the Gate 6B production path.");
  }

  async resumeThread(input: RuntimeThreadRefInput): Promise<RuntimeThreadResult> {
    return {
      ...emptyRuntimeResult({ role: input.role }, "BLOCKED", ["NativeRuntimeAdapter is retained only for experimental native-subagent validation."]),
      thread_id: input.thread_id
    };
  }

  async getThreadEvents(input: RuntimeEventsInput): Promise<RuntimeThreadEventsResult> {
    return {
      thread_id: input.thread_id,
      events_path: input.events_path ?? "",
      events: [],
      errors: ["NativeRuntimeAdapter does not provide production event collection."]
    };
  }

  async stopThread(input: RuntimeStopThreadInput): Promise<RuntimeThreadResult> {
    return {
      ...emptyRuntimeResult({ role: "context_distiller" }, "BLOCKED", ["NativeRuntimeAdapter stopThread is not implemented for production use."]),
      thread_id: input.thread_id
    };
  }

  async getFinalResponse(input: RuntimeFinalResponseInput): Promise<RuntimeThreadResult> {
    return {
      ...emptyRuntimeResult({ role: "context_distiller" }, "BLOCKED", ["NativeRuntimeAdapter final response collection is not implemented for production use."]),
      thread_id: input.thread_id
    };
  }
}

function experimental(input: RuntimeThreadInput, message: string): RuntimeThreadResult {
  return emptyRuntimeResult(input, "BLOCKED", [message]);
}
