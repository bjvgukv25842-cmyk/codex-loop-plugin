import { describe, expect, it } from "vitest";

import { emptyGenericDocsCheckpointState } from "../../src/effectiveness/generic-docs-checkpoint-state.ts";

describe("generic docs checkpoint state", () => {
  it("starts at PREPARED with empty stage evidence", () => {
    const state = emptyGenericDocsCheckpointState();

    expect(state).toMatchObject({
      case_id: "docs-update-001",
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
