import type { RuntimeRole } from "../runtime/runtime-types.ts";

export type SdkLoopState =
  | "INIT_LOOP"
  | "RUN_PLANNER_THREAD"
  | "VERIFY_PLANNER_ARTIFACTS"
  | "RUN_DEV_WORKER_THREAD"
  | "VERIFY_DEV_RESULT"
  | "RUN_INITIAL_EVALUATOR_THREAD"
  | "VERIFY_INITIAL_EVAL"
  | "CREATE_REPAIR_REQUEST"
  | "RUN_REPAIR_DEV_WORKER_THREAD"
  | "VERIFY_REPAIR_RESULT"
  | "RUN_FINAL_EVALUATOR_THREAD"
  | "VERIFY_FINAL_EVAL_PASS"
  | "RUN_FINAL_VALIDATION"
  | "WRITE_FINAL_REPORT"
  | "DONE"
  | "BLOCKED"
  | "FAILED";

export interface SdkLoopEvidence {
  planner_thread_id?: string;
  dev_thread_id?: string;
  evaluator_thread_id?: string;
  repair_dev_thread_id?: string;
  final_evaluator_thread_id?: string;
  prd_artifact?: string;
  task_graph_artifact?: string;
  dev_result_artifact?: string;
  initial_eval_verdict?: "PASS" | "NEEDS_REVISION";
  initial_eval_artifact?: string;
  repair_request_artifact?: string;
  repair_result_artifact?: string;
  final_eval_verdict?: "PASS" | "NEEDS_REVISION";
  final_eval_artifact?: string;
  tests_passed?: boolean;
  artifact_evidence?: ArtifactRuntimeEvidence[];
}

export interface ArtifactRuntimeEvidence {
  artifact_path: string;
  created_by_runtime: "sdk-orchestrated";
  created_by_role: RuntimeRole;
  created_by_thread_id: string;
  created_by_thread_run_id: string;
}

export class InvalidSdkLoopTransitionError extends Error {
  constructor(
    readonly from: SdkLoopState,
    readonly to: SdkLoopState,
    message: string
  ) {
    super(`Illegal SDK loop transition: ${from} -> ${to}: ${message}`);
    this.name = "InvalidSdkLoopTransitionError";
  }
}

const SIMPLE_TRANSITIONS: Partial<Record<SdkLoopState, SdkLoopState[]>> = {
  INIT_LOOP: ["RUN_PLANNER_THREAD"],
  RUN_PLANNER_THREAD: ["VERIFY_PLANNER_ARTIFACTS"],
  VERIFY_PLANNER_ARTIFACTS: ["RUN_DEV_WORKER_THREAD"],
  RUN_DEV_WORKER_THREAD: ["VERIFY_DEV_RESULT"],
  VERIFY_DEV_RESULT: ["RUN_INITIAL_EVALUATOR_THREAD"],
  RUN_INITIAL_EVALUATOR_THREAD: ["VERIFY_INITIAL_EVAL"],
  VERIFY_INITIAL_EVAL: ["CREATE_REPAIR_REQUEST"],
  CREATE_REPAIR_REQUEST: ["RUN_REPAIR_DEV_WORKER_THREAD"],
  RUN_REPAIR_DEV_WORKER_THREAD: ["VERIFY_REPAIR_RESULT"],
  VERIFY_REPAIR_RESULT: ["RUN_FINAL_EVALUATOR_THREAD"],
  RUN_FINAL_EVALUATOR_THREAD: ["VERIFY_FINAL_EVAL_PASS"],
  VERIFY_FINAL_EVAL_PASS: ["RUN_FINAL_VALIDATION"],
  RUN_FINAL_VALIDATION: ["WRITE_FINAL_REPORT"],
  WRITE_FINAL_REPORT: ["DONE"]
};

export function assertSdkLoopTransition(from: SdkLoopState, to: SdkLoopState, evidence: SdkLoopEvidence = {}): void {
  if (to === "BLOCKED" || to === "FAILED") {
    return;
  }
  if (!SIMPLE_TRANSITIONS[from]?.includes(to)) {
    throw new InvalidSdkLoopTransitionError(from, to, "transition is not in the SDK orchestrator graph");
  }
  const missing = missingGateEvidence(from, to, evidence);
  if (missing.length > 0) {
    throw new InvalidSdkLoopTransitionError(from, to, `missing evidence: ${missing.join(", ")}`);
  }
}

export function advanceSdkLoopState(from: SdkLoopState, evidence: SdkLoopEvidence = {}): SdkLoopState {
  const next = SIMPLE_TRANSITIONS[from]?.[0];
  if (!next) {
    throw new InvalidSdkLoopTransitionError(from, from, "no default transition");
  }
  assertSdkLoopTransition(from, next, evidence);
  return next;
}

export function missingGateEvidence(from: SdkLoopState, to: SdkLoopState, evidence: SdkLoopEvidence): string[] {
  const missing: string[] = [];
  if (from === "VERIFY_PLANNER_ARTIFACTS" && to === "RUN_DEV_WORKER_THREAD") {
    requireField(evidence.planner_thread_id, "planner_thread_id", missing);
    requireField(evidence.prd_artifact, "prd_artifact", missing);
    requireField(evidence.task_graph_artifact, "task_graph_artifact", missing);
  }
  if (from === "VERIFY_DEV_RESULT" && to === "RUN_INITIAL_EVALUATOR_THREAD") {
    requireField(evidence.dev_thread_id, "dev_thread_id", missing);
    requireField(evidence.dev_result_artifact, "dev_result_artifact", missing);
  }
  if (from === "VERIFY_INITIAL_EVAL" && to === "CREATE_REPAIR_REQUEST") {
    if (evidence.initial_eval_verdict !== "NEEDS_REVISION") {
      missing.push("initial_eval_verdict=NEEDS_REVISION");
    }
    requireField(evidence.initial_eval_artifact, "initial_eval_artifact", missing);
  }
  if (from === "CREATE_REPAIR_REQUEST" && to === "RUN_REPAIR_DEV_WORKER_THREAD") {
    requireField(evidence.repair_request_artifact, "repair_request_artifact", missing);
  }
  if (from === "VERIFY_REPAIR_RESULT" && to === "RUN_FINAL_EVALUATOR_THREAD") {
    requireField(evidence.repair_dev_thread_id, "repair_dev_thread_id", missing);
    requireField(evidence.repair_result_artifact, "repair_result_artifact", missing);
  }
  if (from === "VERIFY_FINAL_EVAL_PASS" && to === "RUN_FINAL_VALIDATION") {
    if (evidence.final_eval_verdict !== "PASS") {
      missing.push("final_eval_verdict=PASS");
    }
    requireField(evidence.final_eval_artifact, "final_eval_artifact", missing);
  }
  if (from === "RUN_FINAL_VALIDATION" && to === "WRITE_FINAL_REPORT" && evidence.tests_passed !== true) {
    missing.push("tests_passed=true");
  }
  if (to === "DONE" && evidence.tests_passed !== true) {
    missing.push("tests_passed=true");
  }
  return missing;
}

export function validateArtifactRuntimeEvidence(evidence: ArtifactRuntimeEvidence): string[] {
  const missing: string[] = [];
  requireField(evidence.artifact_path, "artifact_path", missing);
  if (evidence.created_by_runtime !== "sdk-orchestrated") {
    missing.push("created_by_runtime=sdk-orchestrated");
  }
  requireField(evidence.created_by_role, "created_by_role", missing);
  requireField(evidence.created_by_thread_id, "created_by_thread_id", missing);
  requireField(evidence.created_by_thread_run_id, "created_by_thread_run_id", missing);
  return missing;
}

function requireField(value: unknown, name: string, missing: string[]): void {
  if (typeof value !== "string" || value.length === 0) {
    missing.push(name);
  }
}
