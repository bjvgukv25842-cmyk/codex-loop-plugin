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

export class StubRuntimeAdapter implements RuntimeAdapter {
  async startThread(input: RuntimeThreadInput): Promise<RuntimeThreadResult> {
    return todo(input, "startThread");
  }

  async runThread(input: RuntimeThreadInput): Promise<RuntimeThreadResult> {
    return todo(input, "runThread");
  }

  async resumeThread(input: RuntimeThreadRefInput): Promise<RuntimeThreadResult> {
    return {
      ...emptyRuntimeResult({ role: input.role }, "BLOCKED", [`RuntimeAdapter stub does not implement resumeThread.`]),
      thread_id: input.thread_id
    };
  }

  async getThreadEvents(input: RuntimeEventsInput): Promise<RuntimeThreadEventsResult> {
    return {
      thread_id: input.thread_id,
      events_path: input.events_path ?? "",
      events: [],
      errors: ["RuntimeAdapter stub does not provide thread events."]
    };
  }

  async stopThread(input: RuntimeStopThreadInput): Promise<RuntimeThreadResult> {
    return {
      ...emptyRuntimeResult({ role: "context_distiller" }, "BLOCKED", [`RuntimeAdapter stub does not implement stopThread: ${input.reason}`]),
      thread_id: input.thread_id
    };
  }

  async getFinalResponse(input: RuntimeFinalResponseInput): Promise<RuntimeThreadResult> {
    return {
      ...emptyRuntimeResult({ role: "context_distiller" }, "BLOCKED", ["RuntimeAdapter stub does not provide final responses."]),
      thread_id: input.thread_id
    };
  }
}

function todo(input: RuntimeThreadInput, operation: string): RuntimeThreadResult {
  return emptyRuntimeResult(input, "BLOCKED", [
    `RuntimeAdapter stub cannot ${operation}; it never calls the Codex SDK or external runtime.`
  ]);
}
