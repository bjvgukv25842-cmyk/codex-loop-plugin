import type { AgentProfile, TaskNode } from "../core/types.ts";

export interface RuntimeTodoResult {
  status: "TODO";
  message: string;
  operation: string;
}

export interface RuntimeAdapter {
  startThread(input: RuntimeThreadInput): Promise<RuntimeTodoResult>;
  resumeThread(input: RuntimeThreadInput): Promise<RuntimeTodoResult>;
  runAgent(input: RuntimeRunAgentInput): Promise<RuntimeTodoResult>;
  forkThread(input: RuntimeForkThreadInput): Promise<RuntimeTodoResult>;
}

export interface RuntimeThreadInput {
  loop_run_id: string;
  agent_id: string;
  prompt: string;
}

export interface RuntimeRunAgentInput {
  loop_run_id: string;
  agent: AgentProfile;
  task: TaskNode;
  prompt: string;
}

export interface RuntimeForkThreadInput {
  loop_run_id: string;
  agent_id: string;
  old_thread_id: string;
  reason: string;
}

export class StubRuntimeAdapter implements RuntimeAdapter {
  async startThread(): Promise<RuntimeTodoResult> {
    return notImplemented("startThread");
  }

  async resumeThread(): Promise<RuntimeTodoResult> {
    return notImplemented("resumeThread");
  }

  async runAgent(): Promise<RuntimeTodoResult> {
    return notImplemented("runAgent");
  }

  async forkThread(): Promise<RuntimeTodoResult> {
    return notImplemented("forkThread");
  }
}

function notImplemented(operation: string): RuntimeTodoResult {
  return {
    status: "TODO",
    operation,
    message: "RuntimeAdapter is a stub in M7 and does not call the Codex SDK or any external runtime."
  };
}
