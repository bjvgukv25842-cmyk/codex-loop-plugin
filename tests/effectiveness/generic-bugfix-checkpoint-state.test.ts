import { describe, expect, it } from "vitest";

import { emptyGenericBugfixCheckpointState } from "../../src/effectiveness/generic-bugfix-checkpoint-state.ts";

describe("generic bugfix checkpoint state", () => {
  it("starts at PREPARED with empty stage evidence", () => {
    const state = emptyGenericBugfixCheckpointState();

    expect(state).toMatchObject({
      case_id: "bugfix-small-001",
      current_stage: "PREPARED",
      planner: {
        status: "",
        thread_id: "",
        prd_path: "",
        task_graph_path: "",
        stage_attempted: false,
        stage_completed: false,
        output_contract_version: ""
      },
      dev_worker: {
        status: "",
        thread_id: "",
        file_change_verified: false,
        tests_passed: false,
        dev_result_path: ""
      },
      evaluator: {
        status: "",
        thread_id: "",
        eval_verdict: "",
        eval_report_path: ""
      },
      errors: []
    });
  });
});
