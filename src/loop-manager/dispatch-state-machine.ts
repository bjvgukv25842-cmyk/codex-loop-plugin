import {
  guardNativeDispatch,
  requireAgentRun,
  requireArtifact,
  requirePlannerFollowupDispatch
} from "./dispatch-guards.ts";
import type {
  DispatchGuardResult,
  NativeDispatchAction,
  NativeDispatchEvidence,
  NativeDispatchPhase
} from "./native-dispatch-contract.ts";

export interface DispatchTransitionResult {
  ok: boolean;
  from: NativeDispatchPhase;
  to: NativeDispatchPhase;
  action: NativeDispatchAction;
  blockers: string[];
  parent_roleplay_detected: boolean;
}

const transitions: Record<NativeDispatchPhase, Partial<Record<NativeDispatchAction, NativeDispatchPhase>>> = {
  PRECHECK_OK: { spawn_planner: "SPAWN_PLANNER" },
  SPAWN_PLANNER: { planner_done: "PLANNER_DONE" },
  PLANNER_DONE: { spawn_dev_worker: "SPAWN_DEV_WORKER" },
  SPAWN_DEV_WORKER: { dev_done: "DEV_DONE" },
  DEV_DONE: { spawn_evaluator: "SPAWN_EVALUATOR" },
  SPAWN_EVALUATOR: { eval_needs_revision: "EVAL_NEEDS_REVISION" },
  EVAL_NEEDS_REVISION: { create_repair_request: "CREATE_REPAIR_REQUEST" },
  CREATE_REPAIR_REQUEST: { repair_request_created: "REPAIR_REQUEST_CREATED" },
  REPAIR_REQUEST_CREATED: { spawn_dev_worker_repair: "SPAWN_DEV_WORKER_REPAIR" },
  SPAWN_DEV_WORKER_REPAIR: { repair_done: "REPAIR_DONE" },
  REPAIR_DONE: { spawn_evaluator_final: "SPAWN_EVALUATOR_FINAL" },
  SPAWN_EVALUATOR_FINAL: { final_eval_pass: "FINAL_EVAL_PASS" },
  FINAL_EVAL_PASS: { run_validation: "RUN_VALIDATION" },
  RUN_VALIDATION: { validation_pass: "VALIDATION_PASS" },
  VALIDATION_PASS: { final_report: "FINAL_REPORT" },
  FINAL_REPORT: {},
  BLOCKED: {}
};

export function nextNativeDispatchPhase(
  current: NativeDispatchPhase,
  action: NativeDispatchAction,
  evidence: NativeDispatchEvidence
): DispatchTransitionResult {
  const target = transitions[current]?.[action];
  if (!target) {
    return blocked(current, current, action, [`Illegal native dispatch transition: ${current} + ${action}.`], evidence);
  }

  const guard = guardForTransition(target, evidence);
  if (!guard.allowed) {
    return blocked(current, target, action, guard.blockers, evidence, guard.parent_roleplay_detected);
  }

  return {
    ok: true,
    from: current,
    to: target,
    action,
    blockers: [],
    parent_roleplay_detected: guard.parent_roleplay_detected
  };
}

export function assertNoPlannerOnlyStop(evidence: NativeDispatchEvidence): DispatchGuardResult {
  return guardNativeDispatch(evidence, [
    () => requirePlannerFollowupDispatch(evidence)
  ]);
}

function guardForTransition(target: NativeDispatchPhase, evidence: NativeDispatchEvidence): DispatchGuardResult {
  switch (target) {
    case "SPAWN_PLANNER":
      return guardNativeDispatch(evidence, []);
    case "PLANNER_DONE":
      return guardNativeDispatch(evidence, [
        () => requireAgentRun(evidence, "loop_planner"),
        () => requireArtifact(evidence.has_prd, "Planner did not produce PRD."),
        () => requireArtifact(evidence.has_task_graph, "Planner did not produce TaskGraph.")
      ]);
    case "SPAWN_DEV_WORKER":
      return guardNativeDispatch(evidence, [
        () => requireAgentRun(evidence, "loop_planner"),
        () => requireArtifact(evidence.has_task_graph, "Cannot spawn dev worker before TaskGraph exists.")
      ]);
    case "DEV_DONE":
      return guardNativeDispatch(evidence, [
        () => requireAgentRun(evidence, "loop_dev_worker", "implementation"),
        () => requireArtifact(evidence.has_dev_result, "Dev worker did not write DevResult."),
        () => requireArtifact(evidence.has_code_diff, "Dev worker did not produce a real code diff.")
      ]);
    case "SPAWN_EVALUATOR":
      return guardNativeDispatch(evidence, [
        () => requireAgentRun(evidence, "loop_dev_worker", "implementation"),
        () => requireArtifact(evidence.has_dev_result, "Cannot evaluate without DevResult.")
      ]);
    case "EVAL_NEEDS_REVISION":
      return guardNativeDispatch(evidence, [
        () => requireAgentRun(evidence, "loop_evaluator", "baseline"),
        () => requireArtifact(evidence.has_eval_needs_revision, "Baseline evaluator did not produce NEEDS_REVISION EvalReport.")
      ]);
    case "CREATE_REPAIR_REQUEST":
      return guardNativeDispatch(evidence, [
        () => requireArtifact(evidence.has_eval_needs_revision, "Cannot create RepairRequest without NEEDS_REVISION EvalReport.")
      ]);
    case "REPAIR_REQUEST_CREATED":
      return guardNativeDispatch(evidence, [
        () => requireArtifact(evidence.has_repair_request, "RepairRequest was not created."),
        () => requireArtifact(evidence.repair_references_eval, "RepairRequest does not reference EvalReport.")
      ]);
    case "SPAWN_DEV_WORKER_REPAIR":
      return guardNativeDispatch(evidence, [
        () => requireArtifact(evidence.has_repair_request, "Cannot spawn repair worker without RepairRequest.")
      ]);
    case "REPAIR_DONE":
      return guardNativeDispatch(evidence, [
        () => requireAgentRun(evidence, "loop_dev_worker", "repair"),
        () => requireArtifact(evidence.has_repair_dev_result, "Repair dev worker did not write DevResult."),
        () => requireArtifact(evidence.has_code_diff, "Repair worker did not produce a real code diff.")
      ]);
    case "SPAWN_EVALUATOR_FINAL":
      return guardNativeDispatch(evidence, [
        () => requireAgentRun(evidence, "loop_dev_worker", "repair"),
        () => requireArtifact(evidence.has_repair_dev_result, "Cannot run final evaluator without repair DevResult.")
      ]);
    case "FINAL_EVAL_PASS":
      return guardNativeDispatch(evidence, [
        () => requireAgentRun(evidence, "loop_evaluator", "final"),
        () => requireArtifact(evidence.has_final_eval_pass, "Final evaluator did not produce PASS EvalReport.")
      ]);
    case "RUN_VALIDATION":
      return guardNativeDispatch(evidence, [
        () => requireArtifact(evidence.has_final_eval_pass, "Cannot run final validation before evaluator PASS.")
      ]);
    case "VALIDATION_PASS":
      return guardNativeDispatch(evidence, [
        () => requireArtifact(evidence.tests_passed, "Validation command did not pass.")
      ]);
    case "FINAL_REPORT":
      return guardNativeDispatch(evidence, [
        () => requireArtifact(evidence.has_final_eval_pass, "Cannot write FinalReport without final EvalReport PASS."),
        () => requireArtifact(evidence.tests_passed, "Cannot write FinalReport before tests pass.")
      ]);
    case "PRECHECK_OK":
    case "BLOCKED":
      return guardNativeDispatch(evidence, []);
  }
}

function blocked(
  from: NativeDispatchPhase,
  to: NativeDispatchPhase,
  action: NativeDispatchAction,
  blockers: string[],
  evidence: NativeDispatchEvidence,
  roleplay = false
): DispatchTransitionResult {
  return {
    ok: false,
    from,
    to,
    action,
    blockers,
    parent_roleplay_detected: roleplay || evidence.parent_wrote_prd || evidence.parent_wrote_dev_result || evidence.parent_wrote_eval_report
  };
}
