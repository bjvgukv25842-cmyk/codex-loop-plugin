import type { RuntimeAdapter } from "../runtime/runtime-adapter.ts";
import type { RuntimeThreadInput, RuntimeThreadResult } from "../runtime/runtime-types.ts";

export type InitialDevWorkerSeededGapStageStatus = "PASS" | "BLOCKED" | "FAILED" | "TIMEOUT";

export type InitialDevWorkerSeededGapFailureCategory =
  | "INITIAL_DEV_OUTPUT_SCHEMA_FAILURE"
  | "INITIAL_DEV_RESULT_SCHEMA_INVALID"
  | "INITIAL_DEV_BASELINE_TESTS_FAILED"
  | "INITIAL_DEV_NO_FILE_CHANGE"
  | "INITIAL_DEV_NO_BASELINE_TEST"
  | "INITIAL_DEV_RESULT_MISSING"
  | "INITIAL_DEV_SEEDED_GAP_CONTRACT_FAILED"
  | "SEEDED_GAP_NOT_PRESERVED"
  | "DEV_WORKER_TEST_DELETED"
  | "DEV_WORKER_THREAD_STARTUP_FAILURE"
  | "THREAD_ID_MISSING"
  | "SDK_THREAD_TIMEOUT"
  | "BLOCKED_DEV_WORKER_BASELINE_MISSING"
  | "BLOCKED_TARGET_FIXTURE_NOT_BROKEN"
  | "DEV_WORKER_OUTPUT_SCHEMA_CAUSES_THREAD_START_FAILURE"
  | "";

export interface InitialDevWorkerRuntimeAdapter extends RuntimeAdapter {
  runThreadStreamed?(input: RuntimeThreadInput): Promise<RuntimeThreadResult>;
}

export interface InitialDevWorkerSeededGapStageInput {
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
  runtime_adapter: InitialDevWorkerRuntimeAdapter;
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
}

export interface InitialDevWorkerSeededGapOutput {
  status: "PASS" | "BLOCKED" | "FAILED" | "TIMEOUT";
  changed_files: string[];
  baseline_tests_run: boolean;
  baseline_tests_passed: boolean;
  full_tests_run: boolean;
  full_tests_expected_to_fail: boolean;
  full_tests_failed: boolean;
  known_gap_seeded: boolean;
  summary: string;
}

export interface InitialDevWorkerSeededGapStageResult {
  status: InitialDevWorkerSeededGapStageStatus;
  failure_category: InitialDevWorkerSeededGapFailureCategory;
  thread_id: string;
  dev_worker_thread_started: boolean;
  dev_worker_thread_id: string;
  known_gap_seeded: boolean;
  file_change_verified: boolean;
  baseline_tests_run: boolean;
  baseline_tests_passed: boolean;
  full_tests_run: boolean;
  full_tests_expected_to_fail: boolean;
  full_tests_failed: boolean;
  dev_result_path: string;
  artifact_thread_evidence_verified: boolean;
  structured_output_valid: boolean;
  final_response_contains_expected: boolean;
  event_count: number;
  no_event_timeout: boolean;
  last_event_type: string;
  elapsed_ms: number;
  runtime_input: RuntimeThreadInput;
  errors: string[];
}
