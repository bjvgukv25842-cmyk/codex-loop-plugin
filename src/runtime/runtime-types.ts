import type { SandboxMode } from "../core/types.ts";

export type RuntimeRole =
  | "planner"
  | "dev_worker"
  | "dev_worker_completion"
  | "evaluator"
  | "repair_dev_worker"
  | "final_evaluator"
  | "context_distiller";

export type RuntimeStatus = "PASS" | "NEEDS_REVISION" | "BLOCKED" | "FAILED" | "TIMEOUT";

export interface RuntimeThreadInput {
  role: RuntimeRole;
  loop_run_id: string;
  task_id: string;
  prompt: string;
  sandbox: Extract<SandboxMode, "read-only" | "workspace-write">;
  working_directory: string;
  timeout_ms: number;
  output_schema_path: string;
  output_schema?: unknown;
  codex_profile?: string;
  codex_model?: string;
  model_catalog_json?: string;
  codex_config_overrides?: Record<string, unknown>;
  skip_git_repo_check?: boolean;
  direct_cli_parity_status?: "PASS" | "FAIL" | "UNKNOWN";
  invocation_trace_path?: string;
  invocation_trace_label?: string;
  error_capture_paths?: {
    events_path?: string;
    stdout_path?: string;
    stderr_path?: string;
    result_path?: string;
  };
  no_event_timeout_ms?: number;
  env: Record<string, string>;
}

export interface RuntimeThreadRefInput {
  thread_id: string;
  role: RuntimeRole;
  loop_run_id: string;
  task_id: string;
  prompt?: string;
  sandbox?: Extract<SandboxMode, "read-only" | "workspace-write">;
  working_directory?: string;
  timeout_ms?: number;
  output_schema_path?: string;
  output_schema?: unknown;
  codex_profile?: string;
  codex_model?: string;
  model_catalog_json?: string;
  codex_config_overrides?: Record<string, unknown>;
  skip_git_repo_check?: boolean;
  direct_cli_parity_status?: "PASS" | "FAIL" | "UNKNOWN";
  invocation_trace_path?: string;
  invocation_trace_label?: string;
  error_capture_paths?: {
    events_path?: string;
    stdout_path?: string;
    stderr_path?: string;
    result_path?: string;
  };
  no_event_timeout_ms?: number;
  env?: Record<string, string>;
}

export interface RuntimeStopThreadInput {
  thread_id: string;
  reason: string;
}

export interface RuntimeFinalResponseInput {
  thread_id: string;
}

export interface RuntimeEventsInput {
  thread_id: string;
  events_path?: string;
}

export interface RuntimeThreadResult {
  thread_id: string;
  role: RuntimeRole;
  status: RuntimeStatus;
  final_response: string;
  events: unknown[];
  events_path: string;
  stdout_path: string;
  stderr_path: string;
  artifacts: string[];
  sandbox_control?: "VERIFIED" | "UNVERIFIED" | "NOT_SUPPORTED";
  failure_category?: string;
  no_event_timeout?: boolean;
  last_event_type?: string;
  elapsed_ms?: number;
  event_count?: number;
  errors: string[];
}

export interface RuntimeThreadEventsResult {
  thread_id: string;
  events_path: string;
  events: unknown[];
  errors: string[];
}
