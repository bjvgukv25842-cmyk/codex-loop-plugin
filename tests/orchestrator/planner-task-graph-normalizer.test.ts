import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { normalizePlannerTaskGraph } from "../../src/orchestrator/planner-task-graph-normalizer.ts";

const defaults = {
  loop_run_id: "loop_fixture",
  default_module_id: "M1",
  default_owner_agent_type: "dev_worker",
  default_owner_agent_id: "sdk-dev-worker",
  default_reviewer_agent_type: "evaluator",
  default_reviewer_agent_id: "sdk-evaluator",
  default_validation_commands: ["npm test"],
  default_likely_files: ["src/project-name.js"],
  now: "2026-06-21T00:00:00.000Z"
};

describe("normalizePlannerTaskGraph", () => {
  it("maps lightweight id to task_id", () => {
    const raw = readFixture("raw-task-graph-with-id.json");
    const result = normalizePlannerTaskGraph(raw, defaults);

    expect(result.tasks[0]?.task_id).toBe("TASK-001");
  });

  it("defaults missing validation commands, likely files, and dependencies", () => {
    const raw = readFixture("raw-task-graph-minimal.json");
    const result = normalizePlannerTaskGraph(raw, defaults);

    expect(result.tasks[0]?.validation_commands).toEqual([
      {
        command: "npm test",
        reason: "Validate task behavior"
      }
    ]);
    expect(result.tasks[0]?.likely_files).toEqual([
      {
        path: "src/project-name.js",
        purpose: "Likely implementation file"
      }
    ]);
    expect(result.tasks[0]?.dependencies).toEqual([]);
  });

  it("removes raw model-only fields from normalized tasks", () => {
    const raw = readFixture("raw-task-graph-with-extra-fields.json");
    const result = normalizePlannerTaskGraph(raw, defaults);
    const task = result.tasks[0] as unknown as Record<string, unknown>;

    expect(task.id).toBeUndefined();
    expect(task.owner).toBeUndefined();
    expect(task.reviewer).toBeUndefined();
    expect(task.files).toBeUndefined();
    expect(task.validation).toBeUndefined();
    expect(task.arbitrary_extra).toBeUndefined();
  });
});

function readFixture(fileName: string): unknown {
  return JSON.parse(readFileSync(resolve(process.cwd(), "tests/fixtures/planner-lite", fileName), "utf8")) as unknown;
}
