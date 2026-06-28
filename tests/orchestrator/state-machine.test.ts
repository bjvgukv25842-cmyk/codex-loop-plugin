import { describe, expect, it } from "vitest";

import {
  InvalidStateTransitionError,
  advanceLoopStatus,
  assertTransition,
  isLegalTransition
} from "../../src/orchestrator/state-machine.ts";

describe("Loop state machine", () => {
  it("allows the required happy-path transitions", () => {
    expect(isLegalTransition("IDLE", "GOAL_RECEIVED")).toBe(true);
    expect(isLegalTransition("GOAL_RECEIVED", "PRD_DRAFTING")).toBe(true);
    expect(isLegalTransition("PRD_DRAFTING", "PRD_READY")).toBe(true);
    expect(isLegalTransition("PRD_READY", "TASK_GRAPH_READY")).toBe(true);
    expect(isLegalTransition("TASK_GRAPH_READY", "DEV_DISPATCHING")).toBe(true);
    expect(isLegalTransition("DEV_DISPATCHING", "DEV_RUNNING")).toBe(true);
    expect(isLegalTransition("DEV_RUNNING", "DEV_DONE")).toBe(true);
    expect(isLegalTransition("DEV_DONE", "EVAL_RUNNING")).toBe(true);
    expect(isLegalTransition("EVAL_RUNNING", "VALIDATION_RUNNING", { evalVerdict: "PASS" })).toBe(true);
    expect(isLegalTransition("EVAL_RUNNING", "REPAIR_REQUESTED", { evalVerdict: "NEEDS_REVISION" })).toBe(true);
    expect(isLegalTransition("REPAIR_REQUESTED", "DEV_RUNNING")).toBe(true);
    expect(isLegalTransition("VALIDATION_RUNNING", "READY_FOR_NEXT_MODULE", { validationResult: "passed" })).toBe(true);
    expect(isLegalTransition("VALIDATION_RUNNING", "READY_FOR_MERGE", { validationResult: "passed" })).toBe(true);
    expect(isLegalTransition("READY_FOR_MERGE", "DONE")).toBe(true);
  });

  it("rejects illegal transitions", () => {
    expect(isLegalTransition("IDLE", "DONE")).toBe(false);
    expect(() => assertTransition("IDLE", "DONE")).toThrow(InvalidStateTransitionError);
  });

  it("allows blocker, failed, and context restart from any state", () => {
    expect(isLegalTransition("DEV_RUNNING", "BLOCKED", { blocker: true })).toBe(true);
    expect(isLegalTransition("PRD_READY", "FAILED", { unrecoverableError: true })).toBe(true);
    expect(isLegalTransition("EVAL_RUNNING", "CONTEXT_RESTARTING", { contextRestart: true })).toBe(true);
  });

  it("advances EVAL_RUNNING with PASS to VALIDATION_RUNNING", () => {
    expect(advanceLoopStatus("EVAL_RUNNING", { evalVerdict: "PASS" })).toBe("VALIDATION_RUNNING");
  });

  it("advances EVAL_RUNNING with NEEDS_REVISION to REPAIR_REQUESTED", () => {
    expect(advanceLoopStatus("EVAL_RUNNING", { evalVerdict: "NEEDS_REVISION" })).toBe("REPAIR_REQUESTED");
  });
});
