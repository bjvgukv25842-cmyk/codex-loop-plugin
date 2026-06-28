import type { RuntimeAdapter } from "../runtime/runtime-adapter.ts";
import type { RuntimeThreadInput, RuntimeThreadResult } from "../runtime/runtime-types.ts";

export type DevWorkerStageStatus = "PASS" | "NEEDS_REVISION" | "BLOCKED" | "FAILED" | "TIMEOUT";

export interface DevWorkerRuntimeAdapter extends RuntimeAdapter {
  runThreadStreamed?(input: RuntimeThreadInput): Promise<RuntimeThreadResult>;
}

export interface DevWorkerStageInput {
  loop_run_id: string;
  task_id: string;
  target_repo: string;
  prd_path: string;
  task_graph_path: string;
  model?: string;
  model_catalog_json?: string;
  sqlite_home: string;
  sandbox: "workspace-write";
  timeout_ms: number;
  runtime_adapter: DevWorkerRuntimeAdapter;
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
  intentional_gap_mode?: boolean;
  require_tests_passed?: boolean;
  prompt_override?: string;
  target_source_file?: string;
  target_test_files?: string[];
  baseline_preflight?: {
    fixture_status: "BROKEN_AS_EXPECTED";
    target_source_hash_before: string;
    initial_tests_failed: boolean;
  };
}

export interface DevWorkerStageResult {
  status: DevWorkerStageStatus;
  failure_category: string;
  dev_worker_thread_started: boolean;
  dev_worker_thread_id: string;
  file_change_verified: boolean;
  file_change_verified_by_hash: boolean;
  file_change_verified_by_git: boolean;
  file_change_verified_by_event: boolean;
  src_project_name_hash_before: string;
  src_project_name_hash_after: string;
  git_changed_files: string[];
  structured_output_valid: boolean;
  tests_run: string[];
  tests_passed: boolean;
  known_gap_seeded?: boolean;
  dev_result_path: string;
  artifact_thread_evidence_verified: boolean;
  final_response_contains_expected: boolean;
  event_count: number;
  no_event_timeout: boolean;
  last_event_type: string;
  elapsed_ms: number;
  runtime_input: RuntimeThreadInput;
  errors: string[];
}

export interface DevWorkerInvocationSnapshot {
  workingDirectory: string;
  model: string;
  model_catalog_json: string;
  sqlite_home: string;
  sandboxMode: "read-only" | "workspace-write";
  skipGitRepoCheck: boolean;
  outputSchemaHash: string;
  promptHash: string;
  promptLength: number;
  prdPath: string;
  taskGraphPath: string;
  sdkMethod: "runStreamed";
  runOptions: string[];
  envKeys: string[];
  configKeys: string[];
  targetRepoGitStatus: string;
}

export interface DevWorkerInvocationDiff {
  status: "PASS" | "NEEDS_REVISION";
  critical_diff_count: number;
  differences: Array<{
    field: keyof DevWorkerInvocationSnapshot;
    dev_worker_smoke: unknown;
    gate6b_smoke_dev_worker: unknown;
  }>;
}
