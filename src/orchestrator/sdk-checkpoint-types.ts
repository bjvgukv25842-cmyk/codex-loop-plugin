export type SdkCheckpointStage = "PREPARED" | "PLANNER_DONE" | "DEV_WORKER_DONE" | "EVALUATOR_DONE" | "FAILED";

export interface PlannerCheckpoint {
  status: string;
  thread_id: string;
  prd_path: string;
  task_graph_path: string;
  planner_result_path: string;
  artifact_thread_evidence_verified: boolean;
}

export interface DevWorkerCheckpoint {
  status: string;
  thread_id: string;
  dev_result_path: string;
  file_change_verified: boolean;
  tests_passed: boolean;
}

export interface EvaluatorCheckpoint {
  status: string;
  thread_id: string;
  eval_report_path: string;
  eval_verdict: "" | "PASS" | "NEEDS_REVISION";
}

export interface SdkCheckpointState {
  gate: "Gate 6B.1L Checkpointed SDK Smoke";
  target_repo: string;
  current_stage: SdkCheckpointStage;
  planner: PlannerCheckpoint;
  dev_worker: DevWorkerCheckpoint;
  evaluator: EvaluatorCheckpoint;
  errors: string[];
}

export type SdkCheckpointVerifyStatus =
  | "PASS"
  | "PARTIAL_PASS_PLANNER_ONLY"
  | "PARTIAL_PASS_DEV_WORKER_ONLY"
  | "EVALUATOR_STAGE_FAILED"
  | "CHECKPOINT_STATE_INVALID"
  | "CHECKPOINT_ARTIFACT_MISSING"
  | "NEEDS_REVISION";
