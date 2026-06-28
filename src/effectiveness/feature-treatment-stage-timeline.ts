import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { GenericFeatureCheckpointState } from "../orchestrator/sdk-generic-feature-checkpoint-state.ts";
import type { M12RunResult, M12StageTimelineEntry } from "../../scripts/effectiveness/types.ts";

export type FeatureTreatmentFailureCategory =
  | "FEATURE_TREATMENT_PLANNER_STARTUP_NO_EVENT_TIMEOUT"
  | "FEATURE_TREATMENT_PLANNER_TURN_NO_EVENT_TIMEOUT"
  | "FEATURE_TREATMENT_PLANNER_POSTPROCESS_FAILED"
  | "FEATURE_TREATMENT_DEV_WORKER_STARTUP_NO_EVENT_TIMEOUT"
  | "FEATURE_TREATMENT_DEV_WORKER_TURN_NO_EVENT_TIMEOUT"
  | "FEATURE_TREATMENT_DEV_WORKER_FAILED"
  | "FEATURE_TREATMENT_DEV_WORKER_NOT_STARTED_AFTER_PLANNER"
  | "FEATURE_TREATMENT_EVALUATOR_STARTUP_NO_EVENT_TIMEOUT"
  | "FEATURE_TREATMENT_EVALUATOR_TURN_NO_EVENT_TIMEOUT"
  | "FEATURE_TREATMENT_EVALUATOR_FAILED"
  | "FEATURE_TREATMENT_EVALUATOR_POSTPROCESS_FAILED"
  | "FEATURE_TREATMENT_EVALUATOR_PROMPT_TOO_LARGE"
  | "FEATURE_TREATMENT_EVALUATOR_NOT_STARTED_AFTER_DEV_WORKER"
  | "FEATURE_TREATMENT_FINAL_REPORT_MISSING"
  | "FEATURE_TREATMENT_STAGE_CLASSIFICATION_STALE"
  | "FEATURE_TREATMENT_CHECKPOINT_STATE_INVALID"
  | "";

export interface FeatureTreatmentTimelineAnalysis {
  stage_timeline: M12StageTimelineEntry[];
  current_stage: string;
  last_completed_stage: string;
  first_failed_stage: string;
  current_failure_category: string;
  corrected_failure_category: FeatureTreatmentFailureCategory;
  failure_category_was_stale_or_inconsistent: boolean;
  checkpoint_state_path: string;
  checkpoint_state_valid: boolean;
}

export function analyzeFeatureTreatmentTimeline(result: Partial<M12RunResult>, repoRoot = process.cwd()): FeatureTreatmentTimelineAnalysis {
  const checkpointPath = result.checkpoint_state_path ?? "";
  const checkpoint = readGenericFeatureCheckpoint(checkpointPath);
  const timeline = buildFeatureTreatmentStageTimeline(result, checkpoint);
  const lastCompleted = lastCompletedStage(timeline);
  const firstFailed = firstFailedStage(timeline, result, checkpoint);
  const corrected = correctedFeatureTreatmentFailureCategory(result, timeline, checkpoint);
  const current = result.failure_category ?? "";
  return {
    stage_timeline: timeline,
    current_stage: checkpoint?.current_stage ?? "",
    last_completed_stage: lastCompleted,
    first_failed_stage: firstFailed,
    current_failure_category: current,
    corrected_failure_category: corrected,
    failure_category_was_stale_or_inconsistent: Boolean(current && corrected && current !== corrected),
    checkpoint_state_path: checkpointPath ? resolve(repoRoot, checkpointPath) : "",
    checkpoint_state_valid: isGenericFeatureCheckpointState(checkpoint)
  };
}

export function buildFeatureTreatmentStageTimeline(
  result: Partial<M12RunResult>,
  checkpoint: GenericFeatureCheckpointState | null = readGenericFeatureCheckpoint(result.checkpoint_state_path)
): M12StageTimelineEntry[] {
  const planner: M12StageTimelineEntry = {
    stage: "planner",
    started: Boolean(result.planner_thread_id || checkpoint?.planner.thread_id || result.planner_stage_attempted),
    thread_id: result.planner_thread_id || checkpoint?.planner.thread_id || "",
    completed: result.planner_stage_completed === true || checkpoint?.planner.stage_completed === true || checkpoint?.planner.status === "PASS",
    status: checkpoint?.planner.status || (result.planner_stage_completed ? "PASS" : ""),
    events_path: result.planner_events_path || checkpoint?.planner.events_path || "",
    last_event_type: result.planner_last_event_type || checkpoint?.planner.last_event_type || "",
    elapsed_ms: result.planner_elapsed_ms ?? checkpoint?.planner.elapsed_ms ?? 0
  };
  const devWorker: M12StageTimelineEntry = {
    stage: "dev_worker",
    started: Boolean(result.dev_worker_thread_id || checkpoint?.dev_worker.thread_id),
    thread_id: result.dev_worker_thread_id || checkpoint?.dev_worker.thread_id || "",
    completed: checkpoint?.dev_worker.status === "PASS" || result.initial_dev_worker?.file_change_verified === true,
    status: checkpoint?.dev_worker.status || (result.dev_worker_thread_id ? "STARTED" : ""),
    events_path: result.initial_dev_worker?.events_path || "",
    last_event_type: "",
    elapsed_ms: 0
  };
  const evaluator: M12StageTimelineEntry = {
    stage: "evaluator",
    started: Boolean(result.initial_evaluator_thread_id || checkpoint?.evaluator.thread_id),
    thread_id: result.initial_evaluator_thread_id || checkpoint?.evaluator.thread_id || "",
    completed: checkpoint?.evaluator.status === "PASS" || checkpoint?.evaluator.status === "NEEDS_REVISION" || result.initial_eval_verdict === "PASS" || result.initial_eval_verdict === "NEEDS_REVISION",
    status: checkpoint?.evaluator.status || (result.initial_evaluator_thread_id ? "STARTED" : ""),
    events_path: result.initial_evaluator_events_path || evaluatorEventsPath(result),
    last_event_type: result.initial_evaluator_last_event_type || "",
    elapsed_ms: result.initial_evaluator_elapsed_ms ?? 0,
    stdout_path: result.initial_evaluator_stdout_path || "",
    stderr_path: result.initial_evaluator_stderr_path || "",
    raw_output_path: result.initial_evaluator_raw_output_path || "",
    redacted_output_path: result.initial_evaluator_redacted_output_path || "",
    prompt_length: result.initial_evaluator_prompt_length,
    prompt_hash: result.initial_evaluator_prompt_hash
  };
  const finalReport: M12StageTimelineEntry = {
    stage: "final_report",
    started: Boolean(result.final_report_path || checkpoint?.final_report && Object.keys(checkpoint.final_report).length > 0),
    completed: Boolean(result.final_report_path || checkpoint?.final_report?.status === "PASS"),
    status: result.final_report_path || checkpoint?.final_report?.status === "PASS" ? "PASS" : ""
  };
  return [planner, devWorker, evaluator, finalReport];
}

export function correctedFeatureTreatmentFailureCategory(
  result: Partial<M12RunResult>,
  timeline = buildFeatureTreatmentStageTimeline(result),
  checkpoint: GenericFeatureCheckpointState | null = readGenericFeatureCheckpoint(result.checkpoint_state_path)
): FeatureTreatmentFailureCategory {
  if (!isGenericFeatureCheckpointState(checkpoint)) return "FEATURE_TREATMENT_CHECKPOINT_STATE_INVALID";
  const planner = stageEntry(timeline, "planner");
  const devWorker = stageEntry(timeline, "dev_worker");
  const evaluator = stageEntry(timeline, "evaluator");
  const finalReport = stageEntry(timeline, "final_report");
  if (!planner.started) return noEventCategory("planner", result.failure_category, false);
  if (!planner.completed) {
    return noEventCategory("planner", checkpoint.planner.failure_category || result.failure_category, Boolean(planner.thread_id || planner.last_event_type));
  }
  if (!devWorker.started) return "FEATURE_TREATMENT_DEV_WORKER_NOT_STARTED_AFTER_PLANNER";
  if (!devWorker.completed) {
    return noEventCategory("dev_worker", result.failure_category, Boolean(devWorker.thread_id));
  }
  if (!evaluator.started) return "FEATURE_TREATMENT_EVALUATOR_NOT_STARTED_AFTER_DEV_WORKER";
  if ((evaluator.prompt_length ?? 0) > 700) return "FEATURE_TREATMENT_EVALUATOR_PROMPT_TOO_LARGE";
  if (!evaluator.completed) {
    return noEventCategory("evaluator", result.failure_category, Boolean(evaluator.thread_id));
  }
  if (!finalReport.completed) return "FEATURE_TREATMENT_FINAL_REPORT_MISSING";
  return "";
}

export function normalizeFeatureTreatmentFailureCategory(result: Partial<M12RunResult>): string {
  if (result.case_id === "feature-small-001" && result.variant === "treatment") {
    return correctedFeatureTreatmentFailureCategory(result);
  }
  return result.failure_category ?? "";
}

export function readGenericFeatureCheckpoint(path: string | undefined): GenericFeatureCheckpointState | null {
  if (!path || !existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as GenericFeatureCheckpointState;
  } catch {
    return null;
  }
}

export function isGenericFeatureCheckpointState(value: unknown): value is GenericFeatureCheckpointState {
  if (!isRecord(value)) return false;
  return value.case_id === "feature-small-001" &&
    typeof value.current_stage === "string" &&
    isRecord(value.planner) &&
    isRecord(value.dev_worker) &&
    isRecord(value.evaluator) &&
    isRecord(value.final_report);
}

function firstFailedStage(
  timeline: M12StageTimelineEntry[],
  result: Partial<M12RunResult>,
  checkpoint: GenericFeatureCheckpointState | null
): string {
  if (!isGenericFeatureCheckpointState(checkpoint)) return "checkpoint";
  for (const entry of timeline) {
    if (entry.stage === "final_report") {
      if (!entry.completed && (checkpoint.evaluator.status === "PASS" || checkpoint.evaluator.status === "NEEDS_REVISION")) return entry.stage;
      continue;
    }
    if (!entry.started) return entry.stage;
    if (!entry.completed) return entry.stage;
  }
  if (result.status !== "PASS") return "unknown";
  return "";
}

function lastCompletedStage(timeline: M12StageTimelineEntry[]): string {
  const completed = timeline.filter((entry) => entry.completed);
  return completed.at(-1)?.stage ?? "";
}

function noEventCategory(stage: "planner" | "dev_worker" | "evaluator", category: string | undefined, hasThreadOrEvent: boolean): FeatureTreatmentFailureCategory {
  const normalized = category ?? "";
  const noEvent = normalized === "SDK_NO_EVENT_TIMEOUT" || normalized.includes("NO_EVENT_TIMEOUT");
  const timeout = noEvent || normalized === "SDK_THREAD_TIMEOUT" || normalized === "TIMEOUT" || normalized.includes("TIMEOUT");
  if (!timeout) {
    if (stage === "planner") return "FEATURE_TREATMENT_PLANNER_POSTPROCESS_FAILED";
    if (stage === "dev_worker") return "FEATURE_TREATMENT_DEV_WORKER_FAILED";
    if (/PROMPT_TOO_LARGE|PROMPT/i.test(normalized)) return "FEATURE_TREATMENT_EVALUATOR_PROMPT_TOO_LARGE";
    if (/OUTPUT|SCHEMA|INVALID|POSTPROCESS|EVAL_REPORT/i.test(normalized)) return "FEATURE_TREATMENT_EVALUATOR_POSTPROCESS_FAILED";
    return "FEATURE_TREATMENT_EVALUATOR_FAILED";
  }
  if (stage === "planner") return hasThreadOrEvent ? "FEATURE_TREATMENT_PLANNER_TURN_NO_EVENT_TIMEOUT" : "FEATURE_TREATMENT_PLANNER_STARTUP_NO_EVENT_TIMEOUT";
  if (stage === "dev_worker") return hasThreadOrEvent ? "FEATURE_TREATMENT_DEV_WORKER_TURN_NO_EVENT_TIMEOUT" : "FEATURE_TREATMENT_DEV_WORKER_STARTUP_NO_EVENT_TIMEOUT";
  return hasThreadOrEvent ? "FEATURE_TREATMENT_EVALUATOR_TURN_NO_EVENT_TIMEOUT" : "FEATURE_TREATMENT_EVALUATOR_STARTUP_NO_EVENT_TIMEOUT";
}

function stageEntry(timeline: M12StageTimelineEntry[], stage: string): M12StageTimelineEntry {
  return timeline.find((entry) => entry.stage === stage) ?? {
    stage,
    started: false,
    completed: false,
    status: ""
  };
}

function evaluatorEventsPath(result: Partial<M12RunResult>): string {
  if (!result.checkpoint_state_path) return "";
  return result.checkpoint_state_path.replace(/treatment-generic-feature-state\.json$/, "sdk-stage-logs/generic-evaluator-events.jsonl");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
