import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import type {
  DevWorkerCheckpoint,
  EvaluatorCheckpoint,
  PlannerCheckpoint,
  SdkCheckpointState
} from "./sdk-checkpoint-types.ts";

export const SDK_CHECKPOINT_GATE = "Gate 6B.1L Checkpointed SDK Smoke" as const;
export const DEFAULT_SDK_CHECKPOINT_STATE_PATH = "evals/sdk-orchestrated/reports/gate6b-checkpoint-state.json";

export function createSdkCheckpointState(targetRepo: string): SdkCheckpointState {
  return {
    gate: SDK_CHECKPOINT_GATE,
    target_repo: targetRepo,
    current_stage: "PREPARED",
    planner: emptyPlannerCheckpoint(),
    dev_worker: emptyDevWorkerCheckpoint(),
    evaluator: emptyEvaluatorCheckpoint(),
    errors: []
  };
}

export function readSdkCheckpointState(path = DEFAULT_SDK_CHECKPOINT_STATE_PATH): SdkCheckpointState | null {
  const absolute = resolve(path);
  if (!existsSync(absolute)) {
    return null;
  }
  const value = JSON.parse(readFileSync(absolute, "utf8")) as unknown;
  return isSdkCheckpointState(value) ? value : null;
}

export function writeSdkCheckpointState(state: SdkCheckpointState, path = DEFAULT_SDK_CHECKPOINT_STATE_PATH): void {
  const absolute = resolve(path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

export function updatePlannerCheckpoint(state: SdkCheckpointState, planner: PlannerCheckpoint): SdkCheckpointState {
  return {
    ...state,
    current_stage: "PLANNER_DONE",
    planner,
    errors: []
  };
}

export function updateDevWorkerCheckpoint(state: SdkCheckpointState, devWorker: DevWorkerCheckpoint): SdkCheckpointState {
  return {
    ...state,
    current_stage: "DEV_WORKER_DONE",
    dev_worker: devWorker,
    errors: []
  };
}

export function updateEvaluatorCheckpoint(state: SdkCheckpointState, evaluator: EvaluatorCheckpoint): SdkCheckpointState {
  return {
    ...state,
    current_stage: "EVALUATOR_DONE",
    evaluator,
    errors: []
  };
}

export function failSdkCheckpointState(state: SdkCheckpointState, errors: string[]): SdkCheckpointState {
  return {
    ...state,
    current_stage: "FAILED",
    errors
  };
}

export function emptyPlannerCheckpoint(): PlannerCheckpoint {
  return {
    status: "",
    thread_id: "",
    prd_path: "",
    task_graph_path: "",
    planner_result_path: "",
    artifact_thread_evidence_verified: false
  };
}

export function emptyDevWorkerCheckpoint(): DevWorkerCheckpoint {
  return {
    status: "",
    thread_id: "",
    dev_result_path: "",
    file_change_verified: false,
    tests_passed: false
  };
}

export function emptyEvaluatorCheckpoint(): EvaluatorCheckpoint {
  return {
    status: "",
    thread_id: "",
    eval_report_path: "",
    eval_verdict: ""
  };
}

export function isSdkCheckpointState(value: unknown): value is SdkCheckpointState {
  if (!isRecord(value)) return false;
  return (
    value.gate === SDK_CHECKPOINT_GATE &&
    typeof value.target_repo === "string" &&
    isCheckpointStage(value.current_stage) &&
    isPlannerCheckpoint(value.planner) &&
    isDevWorkerCheckpoint(value.dev_worker) &&
    isEvaluatorCheckpoint(value.evaluator) &&
    Array.isArray(value.errors) &&
    value.errors.every((entry) => typeof entry === "string")
  );
}

function isPlannerCheckpoint(value: unknown): value is PlannerCheckpoint {
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

function isDevWorkerCheckpoint(value: unknown): value is DevWorkerCheckpoint {
  return (
    isRecord(value) &&
    typeof value.status === "string" &&
    typeof value.thread_id === "string" &&
    typeof value.dev_result_path === "string" &&
    typeof value.file_change_verified === "boolean" &&
    typeof value.tests_passed === "boolean"
  );
}

function isEvaluatorCheckpoint(value: unknown): value is EvaluatorCheckpoint {
  return (
    isRecord(value) &&
    typeof value.status === "string" &&
    typeof value.thread_id === "string" &&
    typeof value.eval_report_path === "string" &&
    (value.eval_verdict === "" || value.eval_verdict === "PASS" || value.eval_verdict === "NEEDS_REVISION")
  );
}

function isCheckpointStage(value: unknown): value is SdkCheckpointState["current_stage"] {
  return value === "PREPARED" || value === "PLANNER_DONE" || value === "DEV_WORKER_DONE" || value === "EVALUATOR_DONE" || value === "FAILED";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
