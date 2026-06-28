export const REQUIRED_NATIVE_AGENTS = [
  "loop_planner",
  "loop_dev_worker",
  "loop_evaluator"
] as const;

export type RequiredNativeAgentName = (typeof REQUIRED_NATIVE_AGENTS)[number];

export type NativeDispatchPhase =
  | "PRECHECK_OK"
  | "SPAWN_PLANNER"
  | "PLANNER_DONE"
  | "SPAWN_DEV_WORKER"
  | "DEV_DONE"
  | "SPAWN_EVALUATOR"
  | "EVAL_NEEDS_REVISION"
  | "CREATE_REPAIR_REQUEST"
  | "REPAIR_REQUEST_CREATED"
  | "SPAWN_DEV_WORKER_REPAIR"
  | "REPAIR_DONE"
  | "SPAWN_EVALUATOR_FINAL"
  | "FINAL_EVAL_PASS"
  | "RUN_VALIDATION"
  | "VALIDATION_PASS"
  | "FINAL_REPORT"
  | "BLOCKED";

export type NativeDispatchAction =
  | "spawn_planner"
  | "planner_done"
  | "spawn_dev_worker"
  | "dev_done"
  | "spawn_evaluator"
  | "eval_needs_revision"
  | "create_repair_request"
  | "repair_request_created"
  | "spawn_dev_worker_repair"
  | "repair_done"
  | "spawn_evaluator_final"
  | "final_eval_pass"
  | "run_validation"
  | "validation_pass"
  | "final_report";

export interface NativeAgentRunEvidence {
  agent_name: string;
  agent_run_id: string;
  thread_id: string;
  phase: string;
  artifacts: string[];
}

export interface NativeDispatchEvidence {
  agent_runs: NativeAgentRunEvidence[];
  has_prd: boolean;
  has_task_graph: boolean;
  has_dev_result: boolean;
  has_code_diff: boolean;
  has_eval_needs_revision: boolean;
  has_repair_request: boolean;
  repair_references_eval: boolean;
  has_repair_dev_result: boolean;
  has_final_eval_pass: boolean;
  tests_passed: boolean;
  parent_wrote_prd: boolean;
  parent_wrote_dev_result: boolean;
  parent_wrote_eval_report: boolean;
}

export interface DispatchGuardResult {
  allowed: boolean;
  blockers: string[];
  parent_roleplay_detected: boolean;
}
