import type {
  DispatchGuardResult,
  NativeAgentRunEvidence,
  NativeDispatchEvidence,
  RequiredNativeAgentName
} from "./native-dispatch-contract.ts";

export function hasAgentRun(evidence: NativeDispatchEvidence, agentName: RequiredNativeAgentName, phase?: string): boolean {
  return evidence.agent_runs.some((run) => run.agent_name === agentName && (!phase || run.phase === phase));
}

export function getAgentRuns(evidence: NativeDispatchEvidence, agentName: RequiredNativeAgentName): NativeAgentRunEvidence[] {
  return evidence.agent_runs.filter((run) => run.agent_name === agentName);
}

export function parentRoleplayDetected(evidence: NativeDispatchEvidence): boolean {
  return evidence.parent_wrote_prd || evidence.parent_wrote_dev_result || evidence.parent_wrote_eval_report;
}

export function guardNativeDispatch(evidence: NativeDispatchEvidence, checks: Array<() => string | null>): DispatchGuardResult {
  const blockers = checks.map((check) => check()).filter((blocker): blocker is string => typeof blocker === "string");
  const roleplay = parentRoleplayDetected(evidence);
  if (roleplay) {
    blockers.push("Parent thread directly wrote PRD, DevResult, or EvalReport artifact.");
  }
  return {
    allowed: blockers.length === 0,
    blockers,
    parent_roleplay_detected: roleplay
  };
}

export function requireAgentRun(evidence: NativeDispatchEvidence, agentName: RequiredNativeAgentName, phase?: string): string | null {
  if (hasAgentRun(evidence, agentName, phase)) {
    return null;
  }
  return phase ? `Missing ${agentName} agent_run for phase ${phase}.` : `Missing ${agentName} agent_run.`;
}

export function requireArtifact(condition: boolean, message: string): string | null {
  return condition ? null : message;
}

export function requirePlannerFollowupDispatch(evidence: NativeDispatchEvidence): string | null {
  const plannerDone =
    hasAgentRun(evidence, "loop_planner") &&
    evidence.has_prd &&
    evidence.has_task_graph;
  if (!plannerDone || hasAgentRun(evidence, "loop_dev_worker")) {
    return null;
  }
  return "Planner completed PRD and TaskGraph, but loop_dev_worker has not been dispatched.";
}
