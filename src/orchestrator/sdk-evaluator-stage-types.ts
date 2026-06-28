import type { RuntimeAdapter } from "../runtime/runtime-adapter.ts";
import type { RuntimeThreadInput, RuntimeThreadResult } from "../runtime/runtime-types.ts";

export type EvaluatorStageStatus = "PASS" | "NEEDS_REVISION" | "BLOCKED" | "FAILED" | "TIMEOUT";

export interface EvaluatorRuntimeAdapter extends RuntimeAdapter {
  runThreadStreamed?(input: RuntimeThreadInput): Promise<RuntimeThreadResult>;
}

export interface EvaluatorStageInput {
  loop_run_id: string;
  task_id: string;
  target_repo: string;
  prd_path: string;
  task_graph_path: string;
  dev_result_path: string;
  test_log_path?: string;
  model?: string;
  model_catalog_json?: string;
  sqlite_home: string;
  sandbox: "read-only";
  timeout_ms: number;
  runtime_adapter: EvaluatorRuntimeAdapter;
  repo_root?: string;
  report_dir?: string;
  invocation_trace_label?: string;
  invocation_trace_path?: string;
  events_path?: string;
  stdout_path?: string;
  stderr_path?: string;
  result_path?: string;
  no_event_timeout_ms?: number;
  artifact_path?: string;
  prompt_override?: string;
  diff_path?: string;
  sdk_method?: "run" | "runStreamed";
}

export interface EvaluatorStageResult {
  status: EvaluatorStageStatus;
  failure_category: string;
  evaluator_thread_started: boolean;
  evaluator_thread_id: string;
  structured_output_valid: boolean;
  eval_report_path: string;
  eval_report_created: boolean;
  eval_verdict: "" | "PASS" | "NEEDS_REVISION";
  artifact_thread_evidence_verified: boolean;
  final_response_contains_expected: boolean;
  event_count: number;
  no_event_timeout: boolean;
  last_event_type: string;
  elapsed_ms: number;
  runtime_input: RuntimeThreadInput;
  errors: string[];
}
