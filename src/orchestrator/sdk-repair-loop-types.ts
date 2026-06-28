export type SdkRepairLoopStage =
  | "PREPARED"
  | "PLANNER_DONE"
  | "DEV_DONE"
  | "INITIAL_EVAL_DONE"
  | "REPAIR_REQUEST_CREATED"
  | "REPAIR_DONE"
  | "FINAL_EVAL_DONE"
  | "FINAL_REPORT_DONE"
  | "FAILED";

export interface RepairLoopPlannerCheckpoint {
  status: string;
  thread_id: string;
  prd_path: string;
  task_graph_path: string;
  planner_result_path: string;
  artifact_thread_evidence_verified: boolean;
  output_contract_version?: "v1" | "v2" | "";
  raw_output_path?: string;
  redacted_output_path?: string;
  events_path?: string;
  failure_category?: string;
  stage_completed?: boolean;
}

export interface RepairLoopDevWorkerCheckpoint {
  status: string;
  thread_id: string;
  dev_result_path: string;
  file_change_verified: boolean;
  baseline_tests_passed: boolean;
  full_tests_expected_to_fail: boolean;
  full_tests_failed: boolean;
  known_gap_seeded: boolean;
}

export interface RepairLoopEvaluatorCheckpoint {
  status: string;
  thread_id: string;
  eval_report_path: string;
  eval_verdict: "" | "PASS" | "NEEDS_REVISION";
}

export interface RepairLoopRepairRequestCheckpoint {
  status: string;
  repair_request_path: string;
  source_eval_report_path: string;
  required_fixes_count: number;
}

export interface RepairLoopRepairDevWorkerCheckpoint {
  status: string;
  thread_id: string;
  repair_result_path: string;
  file_change_verified: boolean;
  tests_passed: boolean;
}

export interface RepairLoopFinalReportCheckpoint {
  status: string;
  path: string;
}

export interface SdkRepairLoopCheckpointState {
  gate: "Gate 6B.2 SDK-Orchestrated Repair Loop E2E";
  target_repo: string;
  current_stage: SdkRepairLoopStage;
  planner: RepairLoopPlannerCheckpoint;
  dev_worker: RepairLoopDevWorkerCheckpoint;
  initial_evaluator: RepairLoopEvaluatorCheckpoint;
  repair_request: RepairLoopRepairRequestCheckpoint;
  repair_dev_worker: RepairLoopRepairDevWorkerCheckpoint;
  final_evaluator: RepairLoopEvaluatorCheckpoint;
  final_report: RepairLoopFinalReportCheckpoint;
  errors: string[];
}

export type SdkRepairLoopVerifyStatus =
  | "PASS"
  | "NEEDS_REVISION"
  | "CHECKPOINT_STATE_INVALID"
  | "CHECKPOINT_ARTIFACT_MISSING"
  | "INITIAL_EVALUATOR_DID_NOT_CATCH_SEEDED_GAP"
  | "REPAIR_REQUEST_NOT_CREATED"
  | "REPAIR_DEV_WORKER_FAILED"
  | "REPAIR_TESTS_FAILED"
  | "FINAL_EVALUATOR_NOT_PASS"
  | "FINAL_REPORT_NOT_CREATED"
  | "GATE6B2_REPAIR_LOOP_INCOMPLETE";
