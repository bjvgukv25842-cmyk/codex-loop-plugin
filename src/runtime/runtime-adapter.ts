import type {
  RuntimeEventsInput,
  RuntimeFinalResponseInput,
  RuntimeStopThreadInput,
  RuntimeThreadEventsResult,
  RuntimeThreadInput,
  RuntimeThreadRefInput,
  RuntimeThreadResult
} from "./runtime-types.ts";

export interface RuntimeAdapter {
  startThread(input: RuntimeThreadInput): Promise<RuntimeThreadResult>;
  runThread(input: RuntimeThreadInput): Promise<RuntimeThreadResult>;
  resumeThread(input: RuntimeThreadRefInput): Promise<RuntimeThreadResult>;
  getThreadEvents(input: RuntimeEventsInput): Promise<RuntimeThreadEventsResult>;
  stopThread(input: RuntimeStopThreadInput): Promise<RuntimeThreadResult>;
  getFinalResponse(input: RuntimeFinalResponseInput): Promise<RuntimeThreadResult>;
}

export function emptyRuntimeResult(input: Pick<RuntimeThreadInput, "role"> & Partial<RuntimeThreadInput>, status: RuntimeThreadResult["status"], errors: string[] = []): RuntimeThreadResult {
  return {
    thread_id: "",
    role: input.role,
    status,
    final_response: "",
    events: [],
    events_path: "",
    stdout_path: "",
    stderr_path: "",
    artifacts: [],
    errors
  };
}
