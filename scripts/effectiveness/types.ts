export type M12RiskLevel = "low" | "medium" | "high" | "p0";
export type M12Variant = "baseline" | "treatment";
export type M12RunStatus = "DRY_RUN" | "PASS" | "FAIL" | "BLOCKED" | "TIMEOUT";

export interface M12Case {
  case_id: string;
  category: string;
  fixture_repo: string;
  user_goal: string;
  baseline_prompt: string;
  treatment_goal: string;
  acceptance_criteria: string[];
  validation_commands: string[];
  expected_artifacts: string[];
  baseline_expected_artifacts?: string[];
  treatment_expected_artifacts?: string[];
  forbidden_files: string[];
  risk_level: M12RiskLevel;
  graders: string[];
}

export interface M12RunResult {
  case_id: string;
  variant: M12Variant;
  mode?: M12Variant;
  runtime?: "codex-exec" | "sdk-orchestrated";
  status: M12RunStatus;
  real_run_executed: boolean;
  prompt: string;
  fixture_repo: string;
  acceptance_criteria: string[];
  validation_commands: string[];
  expected_artifacts: string[];
  baseline_expected_artifacts?: string[];
  treatment_expected_artifacts?: string[];
  forbidden_files: string[];
  changed_files: string[];
  artifacts: string[];
  validation_logs: string[];
  evaluator_verdict?: "PASS" | "NEEDS_REVISION" | "";
  repair_attempted?: boolean;
  repaired?: boolean;
  p0_safety_issue?: boolean;
  secret_leak_detected?: boolean;
  seeded_fake_secret_leaked?: boolean;
  real_secret_leak_detected?: boolean;
  dangerous_command_detected?: boolean;
  prompt_injection_followed?: boolean;
  forbidden_files_modified?: string[];
  tests_deleted_or_weakened?: boolean;
  security_contract_passed?: boolean;
  security_scan_report_path?: string;
  duration_ms: number;
  thread_count: number;
  command_count: number;
  thread_id?: string;
  planner_thread_id?: string;
  planner_stage_attempted?: boolean;
  planner_stage_completed?: boolean;
  planner_output_contract_version?: "v1" | "v2" | "";
  planner_raw_output_path?: string;
  planner_redacted_output_path?: string;
  planner_events_path?: string;
  planner_stdout_path?: string;
  planner_stderr_path?: string;
  planner_last_event_type?: string;
  planner_elapsed_ms?: number;
  planner_event_count?: number;
  planner_prompt_length?: number;
  planner_prompt_hash?: string;
  checkpoint_state_path?: string;
  dev_worker_thread_id?: string;
  dev_worker_events_path?: string;
  dev_worker_stdout_path?: string;
  dev_worker_stderr_path?: string;
  dev_worker_raw_output_path?: string;
  dev_worker_redacted_output_path?: string;
  dev_worker_last_event_type?: string;
  dev_worker_elapsed_ms?: number;
  dev_worker_event_count?: number;
  dev_worker_prompt_length?: number;
  dev_worker_prompt_hash?: string;
  dev_worker_no_event_timeout?: boolean;
  initial_evaluator_thread_id?: string;
  initial_evaluator_events_path?: string;
  initial_evaluator_stdout_path?: string;
  initial_evaluator_stderr_path?: string;
  initial_evaluator_raw_output_path?: string;
  initial_evaluator_redacted_output_path?: string;
  initial_evaluator_last_event_type?: string;
  initial_evaluator_elapsed_ms?: number;
  initial_evaluator_event_count?: number;
  initial_evaluator_prompt_length?: number;
  initial_evaluator_prompt_hash?: string;
  repair_dev_worker_thread_id?: string;
  final_evaluator_thread_id?: string;
  initial_eval_verdict?: "PASS" | "NEEDS_REVISION" | "";
  final_eval_verdict?: "PASS" | "NEEDS_REVISION" | "";
  repair_request_created?: boolean;
  validation_passed?: boolean;
  validation_command_results?: M12ValidationCommandResult[];
  validation_log_paths?: string[];
  coverage_contract_passed?: boolean;
  events_path?: string;
  stdout_path?: string;
  stderr_path?: string;
  diff_path?: string;
  invocation_trace_path?: string;
  timeout_ms?: number;
  no_event_timeout_ms?: number;
  final_report_path?: string;
  evaluator_artifact_path?: string;
  artifact_thread_evidence_verified?: boolean;
  danger_full_access_used?: boolean;
  dev_worker_start_attempted?: boolean;
  dev_worker_block_reason?: string;
  dev_worker_completed?: boolean;
  dev_worker_phase?: string;
  dev_result_path?: string;
  prompt_injection_ignored?: boolean;
  security_summary?: string;
  finalizer_read_only?: boolean;
  finalizer_modified_files?: string[];
  broken_fixture_proof_path?: string;
  safety_pre_scan_path?: string;
  initial_dev_worker?: M12InitialDevWorkerEvidence;
  current_stage?: string;
  last_completed_stage?: string;
  first_failed_stage?: string;
  stage_timeline?: M12StageTimelineEntry[];
  failure_category_was_stale_or_inconsistent?: boolean;
  corrected_failure_category?: string;
  failure_category?: string;
  errors: string[];
}

export interface M12ValidationCommandResult {
  command: string;
  status: "PASS" | "FAIL" | "NOT_RUN";
  passed: boolean;
  log_path?: string;
  evidence?: string;
  evidence_source?: string;
  evidence_mtime?: string;
  result?: "PASS" | "FAIL" | "MISSING" | "NOT_RUN";
  reason?: string;
  failure_category?: string;
}

export interface M12StageTimelineEntry {
  stage: string;
  started: boolean;
  thread_id?: string;
  completed: boolean;
  status: string;
  artifact_paths?: string[];
  events_path?: string;
  last_event_type?: string;
  elapsed_ms?: number;
  stdout_path?: string;
  stderr_path?: string;
  raw_output_path?: string;
  redacted_output_path?: string;
  prompt_length?: number;
  prompt_hash?: string;
}

export interface M12InitialDevWorkerEvidence {
  thread_started: boolean;
  thread_id: string;
  file_change_verified: boolean;
  baseline_tests_run: boolean;
  baseline_tests_passed: boolean;
  full_tests_run: boolean;
  full_tests_expected_to_fail: boolean;
  full_tests_failed: boolean;
  known_gap_seeded: boolean;
  dev_result_path: string;
  events_path: string;
  stdout_path: string;
  stderr_path: string;
}

export interface GraderResult {
  grader: string;
  status: "PASS" | "FAIL" | "BLOCKED";
  score: number;
  p0: boolean;
  severe: boolean;
  summary: string;
  evidence: string[];
}

export interface M12CaseGrade {
  case_id: string;
  variant: M12Variant;
  status: "PASS" | "FAIL" | "BLOCKED";
  p0_blockers: string[];
  severe_issues: string[];
  grader_results: GraderResult[];
}

export interface M12EvidenceFreshnessSummary {
  evidence_source_paths: string[];
  evidence_source_mtimes: Record<string, string>;
  stale_files_ignored: string[];
  inconsistency_diagnosis?: string[];
}

export interface M12ComparisonReport {
  status: "PASS" | "NEEDS_REVISION" | "BLOCKED" | "INCONCLUSIVE_DRY_RUN_RESULT";
  baseline_cases: number;
  treatment_cases: number;
  p0_blockers: string[];
  severe_issues: string[];
  production_ready: false;
  ready_for_m12_mini_real_run: boolean;
  regrade_only?: boolean;
  baseline_outcome?: string;
  treatment_outcome?: string;
  baseline_score?: number;
  treatment_score?: number;
  winner?: "baseline" | "treatment" | "tie" | "inconclusive";
  evidence_source_paths?: string[];
  evidence_source_mtimes?: Record<string, string>;
  stale_files_ignored?: string[];
  stale_validation_logs_ignored?: string[];
  validation_command_results_used?: M12ValidationCommandResult[];
  accepted_baseline_safety_failures?: string[];
  inconsistency_diagnosis?: string[];
}
