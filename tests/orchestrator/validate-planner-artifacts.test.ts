import { describe, expect, it } from "vitest";

import { validateWithSchema } from "../../src/core/validate.ts";
import { validatePlannerLiteArtifacts } from "../../src/orchestrator/validate-planner-artifacts.ts";
import { validPlannerLiteOutput } from "./parse-planner-lite-output.test.ts";
import { validPlannerLiteV2Output } from "./planner-lite-v2-output.test.ts";

describe("validatePlannerLiteArtifacts", () => {
  it("passes valid planner-lite output after hydrating canonical TaskGraph", () => {
    const result = validatePlannerLiteArtifacts(
      JSON.stringify(
        validPlannerLiteOutput({
          task_graph_json: JSON.stringify({
            tasks: [
              {
                id: "TASK-001",
                title: "Implement validateProjectName",
                description: "Reject invalid names.",
                files: ["src/project-name.js"],
                validation: ["npm test"]
              }
            ]
          })
        })
      ),
      {
        loop_run_id: "loop_validate",
        prd_artifact_id: "artifact_prd_validate",
        root_goal: "Validate project names",
        now: "2026-06-21T00:00:00.000Z"
      }
    );

    expect(result.status).toBe("PASS");
    expect(result.failure_category).toBe("");
    expect(result.prd_markdown).toContain("Validate project names");
    expect(result.task_graph).toEqual(expect.objectContaining({ loop_run_id: "loop_validate" }));
    expect(result.task_graph.tasks[0]).toEqual(expect.objectContaining({ task_id: "TASK-001" }));
    expect(validateWithSchema("task-graph", result.task_graph).valid).toBe(true);
  });

  it("returns PLANNER_TASK_GRAPH_HYDRATION_FAILED for task graph without tasks", () => {
    const result = validatePlannerLiteArtifacts(
      JSON.stringify(
        validPlannerLiteOutput({
          task_graph_json: JSON.stringify({ task_graph_id: "missing_required_fields" })
        })
      )
    );

    expect(result.status).toBe("NEEDS_REVISION");
    expect(result.failure_category).toBe("PLANNER_TASK_GRAPH_HYDRATION_FAILED");
  });

  it("returns PLANNER_TASK_GRAPH_SCHEMA_INVALID when hydrated graph still fails canonical schema", () => {
    const result = validatePlannerLiteArtifacts(
      JSON.stringify(
        validPlannerLiteOutput({
          task_graph_json: JSON.stringify({
            tasks: [
              {
                id: "TASK-001",
                title: "Implement validateProjectName",
                description: "Reject invalid names."
              }
            ]
          })
        })
      ),
      {
        loop_run_id: "",
        prd_artifact_id: "artifact_prd_validate",
        root_goal: "Validate project names",
        now: "2026-06-21T00:00:00.000Z"
      }
    );

    expect(result.status).toBe("NEEDS_REVISION");
    expect(result.failure_category).toBe("PLANNER_TASK_GRAPH_SCHEMA_INVALID");
  });

  it("returns PLANNER_PRD_EMPTY when prd_markdown is empty", () => {
    const result = validatePlannerLiteArtifacts(JSON.stringify(validPlannerLiteOutput({ prd_markdown: "   " })));

    expect(result.status).toBe("NEEDS_REVISION");
    expect(result.failure_category).toBe("PLANNER_PRD_EMPTY");
  });

  it("returns PLANNER_ACCEPTANCE_CRITERIA_EMPTY when acceptance_criteria is empty", () => {
    const result = validatePlannerLiteArtifacts(JSON.stringify(validPlannerLiteOutput({ acceptance_criteria: [] })));

    expect(result.status).toBe("NEEDS_REVISION");
    expect(result.failure_category).toBe("PLANNER_ACCEPTANCE_CRITERIA_EMPTY");
  });

  it("passes planner-lite-v2 output after hydrating direct tasks", () => {
    const result = validatePlannerLiteArtifacts(JSON.stringify(validPlannerLiteV2Output()), {
      loop_run_id: "loop_validate",
      prd_artifact_id: "artifact_prd_validate",
      root_goal: "Validate project names",
      preferred_contract_version: "v2",
      now: "2026-06-21T00:00:00.000Z"
    });

    expect(result.status).toBe("PASS");
    expect(result.output_contract_version).toBe("v2");
    expect(result.task_graph).toEqual(expect.objectContaining({ loop_run_id: "loop_validate" }));
    expect(result.task_graph.tasks[0]).toEqual(expect.objectContaining({ task_id: "TASK-001" }));
  });
});
