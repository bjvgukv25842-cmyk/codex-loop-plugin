import { describe, expect, it } from "vitest";

import { emptyGenericTestCoverageCheckpointState } from "../../src/effectiveness/generic-test-coverage-checkpoint-state.ts";

describe("generic test coverage checkpoint state", () => {
  it("starts at PREPARED with empty stage evidence", () => {
    const state = emptyGenericTestCoverageCheckpointState();

    expect(state).toMatchObject({
      case_id: "test-coverage-001",
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
