import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import type {
  RepairLoopDevWorkerCheckpoint,
  RepairLoopEvaluatorCheckpoint,
  RepairLoopFinalReportCheckpoint,
  RepairLoopPlannerCheckpoint,
  RepairLoopRepairDevWorkerCheckpoint,
  RepairLoopRepairRequestCheckpoint,
  SdkRepairLoopCheckpointState
} from "./sdk-repair-loop-types.ts";

export const SDK_REPAIR_LOOP_GATE = "Gate 6B.2 SDK-Orchestrated Repair Loop E2E" as const;
export const DEFAULT_SDK_REPAIR_LOOP_STATE_PATH = "evals/sdk-orchestrated/reports/gate6b2-repair-loop-state.json";

export function createSdkRepairLoopCheckpointState(targetRepo: string): SdkRepairLoopCheckpointState {
  return {
    gate: SDK_REPAIR_LOOP_GATE,
    target_repo: targetRepo,
    current_stage: "PREPARED",
    planner: emptyPlannerCheckpoint(),
    dev_worker: emptyDevWorkerCheckpoint(),
    initial_evaluator: emptyEvaluatorCheckpoint(),
    repair_request: emptyRepairRequestCheckpoint(),
    repair_dev_worker: emptyRepairDevWorkerCheckpoint(),
    final_evaluator: emptyEvaluatorCheckpoint(),
    final_report: emptyFinalReportCheckpoint(),
    errors: []
  };
}

export function readSdkRepairLoopCheckpointState(path = DEFAULT_SDK_REPAIR_LOOP_STATE_PATH): SdkRepairLoopCheckpointState | null {
  const absolute = resolve(path);
  if (!existsSync(absolute)) {
    return null;
  }
  const value = JSON.parse(readFileSync(absolute, "utf8")) as unknown;
  return isSdkRepairLoopCheckpointState(value) ? value : null;
}

export function writeSdkRepairLoopCheckpointState(
  state: SdkRepairLoopCheckpointState,
  path = DEFAULT_SDK_REPAIR_LOOP_STATE_PATH
): void {
  const absolute = resolve(path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

export function updateRepairLoopPlannerCheckpoint(
  state: SdkRepairLoopCheckpointState,
  planner: RepairLoopPlannerCheckpoint
): SdkRepairLoopCheckpointState {
  return {
    ...state,
    current_stage: "PLANNER_DONE",
    planner,
    errors: []
  };
}

export function updateRepairLoopDevWorkerCheckpoint(
  state: SdkRepairLoopCheckpointState,
  devWorker: RepairLoopDevWorkerCheckpoint
): SdkRepairLoopCheckpointState {
  return {
    ...state,
    current_stage: "DEV_DONE",
    dev_worker: devWorker,
    errors: []
  };
}

export function updateRepairLoopInitialEvaluatorCheckpoint(
  state: SdkRepairLoopCheckpointState,
  initialEvaluator: RepairLoopEvaluatorCheckpoint
): SdkRepairLoopCheckpointState {
  return {
    ...state,
    current_stage: "INITIAL_EVAL_DONE",
    initial_evaluator: initialEvaluator,
    errors: []
  };
}

export function updateRepairLoopRepairRequestCheckpoint(
  state: SdkRepairLoopCheckpointState,
  repairRequest: RepairLoopRepairRequestCheckpoint
): SdkRepairLoopCheckpointState {
  return {
    ...state,
    current_stage: "REPAIR_REQUEST_CREATED",
    repair_request: repairRequest,
    errors: []
  };
}

export function updateRepairLoopRepairDevWorkerCheckpoint(
  state: SdkRepairLoopCheckpointState,
  repairDevWorker: RepairLoopRepairDevWorkerCheckpoint
): SdkRepairLoopCheckpointState {
  return {
    ...state,
    current_stage: "REPAIR_DONE",
    repair_dev_worker: repairDevWorker,
    errors: []
  };
}

export function updateRepairLoopFinalEvaluatorCheckpoint(
  state: SdkRepairLoopCheckpointState,
  finalEvaluator: RepairLoopEvaluatorCheckpoint
): SdkRepairLoopCheckpointState {
  return {
    ...state,
    current_stage: "FINAL_EVAL_DONE",
    final_evaluator: finalEvaluator,
    errors: []
  };
}

export function updateRepairLoopFinalReportCheckpoint(
  state: SdkRepairLoopCheckpointState,
  finalReport: RepairLoopFinalReportCheckpoint
): SdkRepairLoopCheckpointState {
  return {
    ...state,
    current_stage: "FINAL_REPORT_DONE",
    final_report: finalReport,
    errors: []
  };
}

export function failSdkRepairLoopCheckpointState(
  state: SdkRepairLoopCheckpointState,
  errors: string[]
): SdkRepairLoopCheckpointState {
  return {
    ...state,
    current_stage: "FAILED",
    errors
  };
}

export function emptyPlannerCheckpoint(): RepairLoopPlannerCheckpoint {
  return {
    status: "",
    thread_id: "",
    prd_path: "",
    task_graph_path: "",
    planner_result_path: "",
    artifact_thread_evidence_verified: false,
    output_contract_version: "",
    raw_output_path: "",
    redacted_output_path: "",
    events_path: "",
    failure_category: "",
    stage_completed: false
  };
}

export function emptyDevWorkerCheckpoint(): RepairLoopDevWorkerCheckpoint {
  return {
    status: "",
    thread_id: "",
    dev_result_path: "",
    file_change_verified: false,
    baseline_tests_passed: false,
    full_tests_expected_to_fail: false,
    full_tests_failed: false,
    known_gap_seeded: false
  };
}

export function emptyEvaluatorCheckpoint(): RepairLoopEvaluatorCheckpoint {
  return {
    status: "",
    thread_id: "",
    eval_report_path: "",
    eval_verdict: ""
  };
}

export function emptyRepairRequestCheckpoint(): RepairLoopRepairRequestCheckpoint {
  return {
    status: "",
    repair_request_path: "",
    source_eval_report_path: "",
    required_fixes_count: 0
  };
}

export function emptyRepairDevWorkerCheckpoint(): RepairLoopRepairDevWorkerCheckpoint {
  return {
    status: "",
    thread_id: "",
    repair_result_path: "",
    file_change_verified: false,
    tests_passed: false
  };
}

export function emptyFinalReportCheckpoint(): RepairLoopFinalReportCheckpoint {
  return {
    status: "",
    path: ""
  };
}

export function isSdkRepairLoopCheckpointState(value: unknown): value is SdkRepairLoopCheckpointState {
  if (!isRecord(value)) return false;
  return (
    value.gate === SDK_REPAIR_LOOP_GATE &&
    typeof value.target_repo === "string" &&
    isRepairLoopStage(value.current_stage) &&
    isPlannerCheckpoint(value.planner) &&
    isDevWorkerCheckpoint(value.dev_worker) &&
    isEvaluatorCheckpoint(value.initial_evaluator) &&
    isRepairRequestCheckpoint(value.repair_request) &&
    isRepairDevWorkerCheckpoint(value.repair_dev_worker) &&
    isEvaluatorCheckpoint(value.final_evaluator) &&
    isFinalReportCheckpoint(value.final_report) &&
    Array.isArray(value.errors) &&
    value.errors.every((entry) => typeof entry === "string")
  );
}

function isRepairLoopStage(value: unknown): value is SdkRepairLoopCheckpointState["current_stage"] {
  return (
    value === "PREPARED" ||
    value === "PLANNER_DONE" ||
    value === "DEV_DONE" ||
    value === "INITIAL_EVAL_DONE" ||
    value === "REPAIR_REQUEST_CREATED" ||
    value === "REPAIR_DONE" ||
    value === "FINAL_EVAL_DONE" ||
    value === "FINAL_REPORT_DONE" ||
    value === "FAILED"
  );
}

function isPlannerCheckpoint(value: unknown): value is RepairLoopPlannerCheckpoint {
  return (
    isRecord(value) &&
    typeof value.status === "string" &&
    typeof value.thread_id === "string" &&
    typeof value.prd_path === "string" &&
    typeof value.task_graph_path === "string" &&
    typeof value.planner_result_path === "string" &&
    typeof value.artifact_thread_evidence_verified === "boolean"
  );
}

function isDevWorkerCheckpoint(value: unknown): value is RepairLoopDevWorkerCheckpoint {
  return (
    isRecord(value) &&
    typeof value.status === "string" &&
    typeof value.thread_id === "string" &&
    typeof value.dev_result_path === "string" &&
    typeof value.file_change_verified === "boolean" &&
    typeof value.baseline_tests_passed === "boolean" &&
    typeof value.full_tests_expected_to_fail === "boolean" &&
    typeof value.full_tests_failed === "boolean" &&
    typeof value.known_gap_seeded === "boolean"
  );
}

function isEvaluatorCheckpoint(value: unknown): value is RepairLoopEvaluatorCheckpoint {
  return (
    isRecord(value) &&
    typeof value.status === "string" &&
    typeof value.thread_id === "string" &&
    typeof value.eval_report_path === "string" &&
    (value.eval_verdict === "" || value.eval_verdict === "PASS" || value.eval_verdict === "NEEDS_REVISION")
  );
}

function isRepairRequestCheckpoint(value: unknown): value is RepairLoopRepairRequestCheckpoint {
  return (
    isRecord(value) &&
    typeof value.status === "string" &&
    typeof value.repair_request_path === "string" &&
    typeof value.source_eval_report_path === "string" &&
    typeof value.required_fixes_count === "number"
  );
}

function isRepairDevWorkerCheckpoint(value: unknown): value is RepairLoopRepairDevWorkerCheckpoint {
  return (
    isRecord(value) &&
    typeof value.status === "string" &&
    typeof value.thread_id === "string" &&
    typeof value.repair_result_path === "string" &&
    typeof value.file_change_verified === "boolean" &&
    typeof value.tests_passed === "boolean"
  );
}

function isFinalReportCheckpoint(value: unknown): value is RepairLoopFinalReportCheckpoint {
  return isRecord(value) && typeof value.status === "string" && typeof value.path === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
