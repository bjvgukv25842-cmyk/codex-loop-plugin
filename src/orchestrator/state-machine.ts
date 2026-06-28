import type { EvalVerdict, LoopStatus, ValidationResult } from "../core/types.ts";

export interface TransitionContext {
  evalVerdict?: EvalVerdict;
  validationResult?: ValidationResult;
  mergeReady?: boolean;
  blocker?: boolean;
  unrecoverableError?: boolean;
  contextRestart?: boolean;
}

export class InvalidStateTransitionError extends Error {
  constructor(
    readonly from: LoopStatus,
    readonly to: LoopStatus,
    readonly context: TransitionContext = {}
  ) {
    super(`Illegal loop state transition: ${from} -> ${to}`);
    this.name = "InvalidStateTransitionError";
  }
}

export const LOOP_STATUSES: LoopStatus[] = [
  "IDLE",
  "GOAL_RECEIVED",
  "PRD_DRAFTING",
  "PRD_READY",
  "TASK_GRAPH_READY",
  "DEV_DISPATCHING",
  "DEV_RUNNING",
  "DEV_DONE",
  "EVAL_RUNNING",
  "REPAIR_REQUESTED",
  "VALIDATION_RUNNING",
  "READY_FOR_NEXT_MODULE",
  "READY_FOR_MERGE",
  "DONE",
  "BLOCKED",
  "FAILED",
  "CONTEXT_RESTARTING"
];

const SIMPLE_TRANSITIONS = new Map<LoopStatus, LoopStatus[]>([
  ["IDLE", ["GOAL_RECEIVED"]],
  ["GOAL_RECEIVED", ["PRD_DRAFTING"]],
  ["PRD_DRAFTING", ["PRD_READY"]],
  ["PRD_READY", ["TASK_GRAPH_READY"]],
  ["TASK_GRAPH_READY", ["DEV_DISPATCHING"]],
  ["DEV_DISPATCHING", ["DEV_RUNNING"]],
  ["DEV_RUNNING", ["DEV_DONE"]],
  ["DEV_DONE", ["EVAL_RUNNING"]],
  ["REPAIR_REQUESTED", ["DEV_RUNNING"]],
  ["READY_FOR_MERGE", ["DONE"]]
]);

export function isLegalTransition(from: LoopStatus, to: LoopStatus, context: TransitionContext = {}): boolean {
  if (to === "BLOCKED") {
    return context.blocker === true;
  }

  if (to === "FAILED") {
    return context.unrecoverableError === true;
  }

  if (to === "CONTEXT_RESTARTING") {
    return context.contextRestart === true;
  }

  if (from === "EVAL_RUNNING") {
    if (to === "VALIDATION_RUNNING") {
      return context.evalVerdict === "PASS";
    }

    if (to === "REPAIR_REQUESTED") {
      return context.evalVerdict === "NEEDS_REVISION";
    }
  }

  if (from === "VALIDATION_RUNNING" && context.validationResult === "passed") {
    return to === "READY_FOR_NEXT_MODULE" || to === "READY_FOR_MERGE";
  }

  return SIMPLE_TRANSITIONS.get(from)?.includes(to) ?? false;
}

export function assertTransition(from: LoopStatus, to: LoopStatus, context: TransitionContext = {}): void {
  if (!isLegalTransition(from, to, context)) {
    throw new InvalidStateTransitionError(from, to, context);
  }
}

export function advanceLoopStatus(current: LoopStatus, context: TransitionContext = {}): LoopStatus {
  if (context.blocker) {
    return "BLOCKED";
  }

  if (context.unrecoverableError) {
    return "FAILED";
  }

  if (context.contextRestart) {
    return "CONTEXT_RESTARTING";
  }

  if (current === "EVAL_RUNNING") {
    if (context.evalVerdict === "PASS") {
      return "VALIDATION_RUNNING";
    }
    if (context.evalVerdict === "NEEDS_REVISION") {
      return "REPAIR_REQUESTED";
    }
  }

  if (current === "VALIDATION_RUNNING" && context.validationResult === "passed") {
    return context.mergeReady ? "READY_FOR_MERGE" : "READY_FOR_NEXT_MODULE";
  }

  const next = SIMPLE_TRANSITIONS.get(current)?.[0];
  if (!next) {
    throw new InvalidStateTransitionError(current, current, context);
  }

  assertTransition(current, next, context);
  return next;
}
