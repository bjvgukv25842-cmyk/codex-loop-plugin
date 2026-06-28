export {
  emptyGenericFeatureCheckpointState,
  type GenericFeatureCheckpointStage,
  type GenericFeatureCheckpointState
} from "../orchestrator/sdk-generic-feature-checkpoint-state.ts";

import type { GenericFeatureCheckpointState as GenericFeatureCheckpointStateType } from "../orchestrator/sdk-generic-feature-checkpoint-state.ts";

export interface FeatureEvaluatorRetryEligibility {
  eligible: boolean;
  reason: "" | "CHECKPOINT_NOT_READY" | "PLANNER_NOT_PASS" | "DEV_WORKER_NOT_PASS" | "DEV_RESULT_MISSING";
  planner_thread_id: string;
  dev_worker_thread_id: string;
  current_stage: string;
}

export function featureEvaluatorRetryEligibility(state: GenericFeatureCheckpointStateType): FeatureEvaluatorRetryEligibility {
  const plannerPass = state.planner.status === "PASS" && Boolean(state.planner.thread_id);
  const devWorkerPass = state.dev_worker.status === "PASS" && Boolean(state.dev_worker.thread_id);
  const devResultPresent = Boolean(state.dev_worker.dev_result_path);
  const stageReady = state.current_stage === "DEV_WORKER_DONE" ||
    state.current_stage === "FAILED" ||
    state.current_stage === "EVALUATOR_DONE";
  if (!stageReady) {
    return blocked(state, "CHECKPOINT_NOT_READY");
  }
  if (!plannerPass) {
    return blocked(state, "PLANNER_NOT_PASS");
  }
  if (!devWorkerPass) {
    return blocked(state, "DEV_WORKER_NOT_PASS");
  }
  if (!devResultPresent) {
    return blocked(state, "DEV_RESULT_MISSING");
  }
  return {
    eligible: true,
    reason: "",
    planner_thread_id: state.planner.thread_id,
    dev_worker_thread_id: state.dev_worker.thread_id,
    current_stage: state.current_stage
  };
}

export function evaluatorRetryWillNotRerunPlannerOrDevWorker(state: GenericFeatureCheckpointStateType): boolean {
  return featureEvaluatorRetryEligibility(state).eligible;
}

function blocked(state: GenericFeatureCheckpointStateType, reason: FeatureEvaluatorRetryEligibility["reason"]): FeatureEvaluatorRetryEligibility {
  return {
    eligible: false,
    reason,
    planner_thread_id: state.planner.thread_id,
    dev_worker_thread_id: state.dev_worker.thread_id,
    current_stage: state.current_stage
  };
}
