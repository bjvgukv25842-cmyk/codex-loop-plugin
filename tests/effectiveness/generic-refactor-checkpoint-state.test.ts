import { describe, expect, it } from "vitest";

import { emptyGenericRefactorCheckpointState } from "../../src/effectiveness/generic-refactor-checkpoint-state.ts";

describe("generic refactor checkpoint state", () => {
  it("starts at PREPARED with empty stage evidence", () => {
    const state = emptyGenericRefactorCheckpointState();

    expect(state).toMatchObject({
      case_id: "refactor-small-001",
      current_stage: "PREPARED",
      planner: {
        status: "",
        thread_id: "",
        output_contract_version: ""
      },
      dev_worker: {
        tests_passed: false,
        file_change_verified: false
      },
      evaluator: {
        eval_verdict: ""
      },
      errors: []
    });
  });
});
