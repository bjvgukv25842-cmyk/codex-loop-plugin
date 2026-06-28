import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { parsePlannerLiteOutput } from "../../src/orchestrator/parse-planner-lite-output.ts";
import { validPlannerLiteV2Output } from "./planner-lite-v2-output.test.ts";

describe("parsePlannerLiteOutput", () => {
  it("parses valid planner-lite output and task_graph_json", () => {
    const result = parsePlannerLiteOutput(JSON.stringify(validPlannerLiteOutput()));

    expect(result.status).toBe("PASS");
    expect(result.failure_category).toBe("");
    expect(result.task_graph).toEqual(expect.objectContaining({ task_graph_id: "task_graph_001" }));
  });

  it("returns PLANNER_TASK_GRAPH_JSON_INVALID for invalid task_graph_json", () => {
    const result = parsePlannerLiteOutput(
      JSON.stringify({
        ...validPlannerLiteOutput(),
        task_graph_json: "{not json"
      })
    );

    expect(result.status).toBe("NEEDS_REVISION");
    expect(result.failure_category).toBe("PLANNER_TASK_GRAPH_JSON_INVALID");
    expect(result.output_contract_version).toBe("v1");
  });

  it("parses planner-lite-v2 structured tasks without task_graph_json", () => {
    const result = parsePlannerLiteOutput(JSON.stringify(validPlannerLiteV2Output()), {
      preferred_contract_version: "v2"
    });

    expect(result.status).toBe("PASS");
    expect(result.output_contract_version).toBe("v2");
    expect(result.task_graph).toEqual(
      expect.objectContaining({
        version: "planner-lite-v2",
        tasks: expect.arrayContaining([expect.objectContaining({ id: "TASK-001" })])
      })
    );
  });

  it("returns PLANNER_V2_TASKS_EMPTY for empty v2 tasks", () => {
    const result = parsePlannerLiteOutput(JSON.stringify(validPlannerLiteV2Output({ tasks: [] })), {
      preferred_contract_version: "v2"
    });

    expect(result.status).toBe("NEEDS_REVISION");
    expect(result.failure_category).toBe("PLANNER_V2_TASKS_EMPTY");
    expect(result.output_contract_version).toBe("v2");
  });

  it("returns PLANNER_V2_TASKS_SCHEMA_INVALID for malformed v2 tasks", () => {
    const result = parsePlannerLiteOutput(
      JSON.stringify(
        validPlannerLiteV2Output({
          tasks: [{ id: "TASK-001", title: "Missing fields" }]
        })
      ),
      { preferred_contract_version: "v2" }
    );

    expect(result.status).toBe("NEEDS_REVISION");
    expect(result.failure_category).toBe("PLANNER_V2_TASKS_SCHEMA_INVALID");
  });
});

export function validPlannerLiteOutput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const taskGraph = readFileSync(resolve(process.cwd(), "tests/fixtures/valid/task-graph.json"), "utf8");
  return {
    status: "PASS",
    prd_markdown: "# PRD\n\nValidate project names.",
    task_graph_json: taskGraph,
    acceptance_criteria: ["Reject invalid names", "Accept valid names"],
    risks: [],
    ...overrides
  };
}
