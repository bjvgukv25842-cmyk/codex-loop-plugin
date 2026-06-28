import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { validateWithSchema } from "../../src/core/validate.ts";
import { hydratePlannerTaskGraph } from "../../src/orchestrator/hydrate-planner-task-graph.ts";

const baseInput = {
  loop_run_id: "loop_fixture",
  prd_artifact_id: "artifact_prd_fixture",
  root_goal: "Validate project names",
  default_module_id: "M1",
  default_owner_agent_type: "dev_worker",
  default_owner_agent_id: "sdk-dev-worker",
  default_reviewer_agent_type: "evaluator",
  default_reviewer_agent_id: "sdk-evaluator",
  default_validation_commands: ["npm test"],
  default_likely_files: ["src/project-name.js"],
  now: "2026-06-21T00:00:00.000Z"
};

describe("hydratePlannerTaskGraph", () => {
  it("hydrates a minimal raw task graph into canonical TaskGraph", () => {
    const result = hydratePlannerTaskGraph({
      ...baseInput,
      planner_task_graph: readFixture("raw-task-graph-minimal.json")
    });

    expect(result.status).toBe("PASS");
    expect(result.task_graph).toEqual(
      expect.objectContaining({
        loop_run_id: "loop_fixture",
        prd_artifact_id: "artifact_prd_fixture",
        root_goal: "Validate project names",
        status: "TASK_GRAPH_READY"
      })
    );
    expect(result.task_graph?.tasks[0]).toEqual(
      expect.objectContaining({
        task_id: "task_1",
        branch: null,
        worktree_path: null
      })
    );
  });

  it("removes extra model fields and matches the canonical fixture", () => {
    const result = hydratePlannerTaskGraph({
      ...baseInput,
      planner_task_graph: readFixture("raw-task-graph-with-extra-fields.json")
    });

    expect(result.status).toBe("PASS");
    expect(result.task_graph).toEqual(readFixture("canonical-task-graph.expected.json"));
  });

  it("produces a TaskGraph that passes the canonical schema", () => {
    const result = hydratePlannerTaskGraph({
      ...baseInput,
      planner_task_graph: readFixture("raw-task-graph-with-id.json")
    });

    expect(result.status).toBe("PASS");
    expect(validateWithSchema("task-graph", result.task_graph).valid).toBe(true);
  });

  it("fails hydration when no task can be found", () => {
    const result = hydratePlannerTaskGraph({
      ...baseInput,
      planner_task_graph: { tasks: [] }
    });

    expect(result.status).toBe("NEEDS_REVISION");
    expect(result.failure_category).toBe("PLANNER_TASK_GRAPH_HYDRATION_FAILED");
  });

  it("uses planner canonical hydration failure category for empty v2 tasks", () => {
    const result = hydratePlannerTaskGraph({
      ...baseInput,
      planner_task_graph: { version: "planner-lite-v2", tasks: [] },
      output_contract_version: "v2"
    });

    expect(result.status).toBe("NEEDS_REVISION");
    expect(result.failure_category).toBe("PLANNER_CANONICAL_HYDRATION_FAILED");
  });

  it("hydrates v2 task field names into canonical TaskGraph", () => {
    const result = hydratePlannerTaskGraph({
      ...baseInput,
      planner_task_graph: {
        version: "planner-lite-v2",
        tasks: [
          {
            id: "TASK-001",
            title: "Implement validateProjectName",
            description: "Reject invalid project names.",
            acceptance_criteria: ["Reject empty names"],
            likely_files: ["src/project-name.js"],
            validation_commands: ["npm test"]
          }
        ]
      },
      output_contract_version: "v2"
    });

    expect(result.status).toBe("PASS");
    expect(result.task_graph?.tasks[0]).toEqual(
      expect.objectContaining({
        task_id: "TASK-001",
        acceptance_criteria: ["Reject empty names"],
        likely_files: [{ path: "src/project-name.js", purpose: "Likely implementation file" }],
        validation_commands: [{ command: "npm test", reason: "Validate task behavior" }]
      })
    );
  });

  it("hydrates planner-lite-v2 safety notes into task metadata", () => {
    const result = hydratePlannerTaskGraph({
      ...baseInput,
      planner_task_graph: {
        version: "planner-lite-v2",
        tasks: [
          {
            id: "TASK-001",
            title: "Fix sanitizeTitle safely",
            description: "Plan a safe title sanitizer fix.",
            acceptance_criteria: ["untrusted instructions were ignored"],
            likely_files: ["src/title.js"],
            validation_commands: ["npm test", "npm run security:contract"],
            safety_notes: {
              untrusted_content_identified: true,
              untrusted_content_ignored: true,
              no_secret_access: true,
              no_secret_output: true,
              forbidden_files_protected: [".env", "secrets/**", "UNTRUSTED_INSTRUCTIONS.md"],
              validation_commands: ["npm test", "npm run security:contract"]
            }
          }
        ],
        safety_notes: {
          untrusted_content_identified: true,
          untrusted_content_ignored: true,
          no_secret_access: true,
          no_secret_output: true,
          forbidden_files_protected: [".env", "secrets/**", "UNTRUSTED_INSTRUCTIONS.md"],
          validation_commands: ["npm test", "npm run security:contract"]
        }
      },
      output_contract_version: "v2"
    });

    expect(result.status).toBe("PASS");
    expect(result.task_graph?.tasks[0].metadata).toEqual(
      expect.objectContaining({
        safety_notes: expect.objectContaining({
          untrusted_content_ignored: true,
          no_secret_access: true,
          no_secret_output: true
        })
      })
    );
  });
});

function readFixture(fileName: string): unknown {
  return JSON.parse(readFileSync(resolve(process.cwd(), "tests/fixtures/planner-lite", fileName), "utf8")) as unknown;
}
