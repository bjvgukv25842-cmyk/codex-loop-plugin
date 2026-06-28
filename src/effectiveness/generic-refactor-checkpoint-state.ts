export type GenericRefactorCheckpointStage =
  | "PREPARED"
  | "PLANNER_DONE"
  | "DEV_WORKER_DONE"
  | "EVALUATOR_DONE"
  | "REPAIR_REQUEST_CREATED"
  | "REPAIR_DONE"
  | "FINAL_EVAL_DONE"
  | "FINAL_REPORT_DONE"
  | "FAILED";

export interface GenericRefactorCheckpointState {
  case_id: "refactor-small-001";
  current_stage: GenericRefactorCheckpointStage;
  planner: {
    status: string;
    thread_id: string;
    prd_path: string;
    task_graph_path: string;
    planner_result_path?: string;
    stage_attempted?: boolean;
    stage_completed?: boolean;
    output_contract_version?: "v1" | "v2" | "";
    raw_output_path?: string;
    redacted_output_path?: string;
    events_path?: string;
    stdout_path?: string;
    stderr_path?: string;
    last_event_type?: string;
    elapsed_ms?: number;
    event_count?: number;
    failure_category?: string;
  };
  dev_worker: {
    status: string;
    thread_id: string;
    file_change_verified: boolean;
    tests_passed: boolean;
    dev_result_path: string;
  };
  evaluator: {
    status: string;
    thread_id: string;
    eval_verdict: string;
    eval_report_path: string;
  };
  repair_request: Record<string, unknown>;
  repair_dev_worker: Record<string, unknown>;
  final_evaluator: Record<string, unknown>;
  final_report: Record<string, unknown>;
  errors: string[];
}

export function emptyGenericRefactorCheckpointState(): GenericRefactorCheckpointState {
  return {
    case_id: "refactor-small-001",
    current_stage: "PREPARED",
    planner: {
      status: "",
      thread_id: "",
      prd_path: "",
      task_graph_path: "",
      stage_attempted: false,
      stage_completed: false,
      output_contract_version: ""
    },
    dev_worker: {
      status: "",
      thread_id: "",
      file_change_verified: false,
      tests_passed: false,
      dev_result_path: ""
    },
    evaluator: {
      status: "",
      thread_id: "",
      eval_verdict: "",
      eval_report_path: ""
    },
    repair_request: {},
    repair_dev_worker: {},
    final_evaluator: {},
    final_report: {},
    errors: []
  };
}
