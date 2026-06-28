import type { AgentType, EvalReport, LoopStatus, TaskStatus, ValidationResult } from "../core/types.ts";

export type HookEventName = "SessionStart" | "PostToolUse" | "PreCompact" | "SubagentStart" | "SubagentStop" | "Stop";

export interface HookExecutionContext {
  pluginRoot?: string;
  repoRoot?: string;
  stateDir?: string;
  now?: () => string;
}

export interface HookResult {
  ok: boolean;
  hook: HookEventName;
  status: "ok" | "skipped" | "warning" | "error";
  message: string;
  event_id?: string;
  loop_run_id?: string;
  artifact_path?: string;
  warnings: string[];
  data: Record<string, unknown>;
}

export interface SessionStartInput {
  event?: "SessionStart";
  cwd?: string;
  loop_run_id?: string;
}

export interface PostToolUseInput {
  event?: "PostToolUse";
  tool_name?: string;
  tool?: string;
  command?: string;
  exit_code?: number;
  status?: string;
  tool_input?: {
    command?: string;
    [key: string]: unknown;
  };
  tool_result?: {
    exit_code?: number;
    status?: string;
    stdout?: string;
    stderr?: string;
    output?: string;
    [key: string]: unknown;
  };
}

export interface PreCompactInput {
  event?: "PreCompact";
  agent_id?: string;
  agent_type?: AgentType;
  task_id?: string;
  restart_reason?: string;
  next_instruction?: string;
}

export interface SubagentStopInput {
  event?: "SubagentStop";
  agent_id?: string;
  agent_type?: AgentType;
  output?: string;
  result?: string | Record<string, unknown>;
  subagent_output?: string | Record<string, unknown>;
}

export interface SubagentStartInput {
  event?: "SubagentStart";
  agent_id?: string;
  agent_name?: string;
  agent_type?: AgentType;
  agent_run_id?: string;
  parent_thread_id?: string;
  thread_id?: string;
  task_id?: string;
  module_id?: string;
}

export interface StopInput {
  event?: "Stop";
  loop_run_id?: string;
  current_module_id?: string;
}

export interface ValidationCommandEvent {
  command: string;
  exit_code: number | null;
  result: ValidationResult;
  output_excerpt: string;
}

export interface EvalReportLikeInput extends Partial<EvalReport> {
  verdict?: "PASS" | "NEEDS_REVISION";
  status?: "PASS" | "NEEDS_REVISION";
  agent?: string;
  evaluator_agent_id?: string;
  loop_run_id?: string;
  task_id?: string;
  module_id?: string;
}

export interface LoopSnapshot {
  loop_run_id: string;
  status: LoopStatus;
  current_module_id: string;
  task_status_counts: Record<TaskStatus, number>;
  recent_events: {
    event_id: string;
    type: string;
    message: string;
    created_at: string;
  }[];
}
