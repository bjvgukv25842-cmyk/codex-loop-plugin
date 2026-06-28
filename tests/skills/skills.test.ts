import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { REQUIRED_SKILLS, loadSkillDocuments, validateSkills } from "../../src/skills/validate-skills.ts";

function readSkill(skillName: string): string {
  return readFileSync(join("skills", skillName, "SKILL.md"), "utf8");
}

describe("loop skills", () => {
  it("has all required skill files", () => {
    const result = validateSkills();

    expect(result.valid).toBe(true);
    expect(result.skillsChecked).toEqual(expect.arrayContaining([...REQUIRED_SKILLS]));
  });

  it("has valid frontmatter for every SKILL.md", () => {
    const errors: Array<{ path: string; message: string }> = [];
    const skills = loadSkillDocuments(errors);

    expect(errors).toEqual([]);
    for (const skill of skills) {
      expect(skill.name).toBeTruthy();
      expect(skill.description.length).toBeGreaterThanOrEqual(30);
    }
  });

  it("codex-loop contains all loop phases", () => {
    const content = readSkill("codex-loop");

    for (const phase of [
      "Goal Normalization",
      "PRD Generation",
      "Task Graph Generation",
      "Module Implementation",
      "Evaluation",
      "Repair",
      "Validation",
      "Context Recovery",
      "Final Report"
    ]) {
      expect(content).toContain(phase);
    }
  });

  it("evaluator is explicitly read-only", () => {
    const content = readSkill("evaluator");

    expect(content).toMatch(/read-only|只读/i);
    expect(content).toContain("PASS");
    expect(content).toContain("NEEDS_REVISION");
  });

  it("context-distiller contains ContextCapsule", () => {
    const content = readSkill("context-distiller");

    expect(content).toContain("ContextCapsule");
    expect(content).toContain("next_instruction");
  });

  it("dev-worker contains scope limits", () => {
    const content = readSkill("dev-worker");

    expect(content).toMatch(/scope/i);
    expect(content).toContain("Do not enter the next module");
  });

  it("codex-loop includes Gate 6 fast path dispatch constraints", () => {
    const content = readSkill("codex-loop");

    expect(content).toContain("Gate 6 Fast Path");
    expect(content).toContain("Do not run `npm run verify:agents` inside the isolated target repo unless that script exists");
    expect(content).toContain("spawn `loop_dev_worker` immediately");
    expect(content).toContain("planner_task_graph_schema_invalid");
    expect(content).toContain("planner_done_without_dev_worker_spawn");
    expect(content).toContain("repair_request_schema_invalid");
    expect(content).toContain('assigned_agent_id: "loop_dev_worker"');
    expect(content).toContain("source_eval_report_path");
    expect(content).toContain("A `spawn_agent` event without a matching `wait` completion is not sufficient evidence");
    expect(content).toContain('artifact_type: "dev_result"');
    expect(content).toContain('artifact_type: "eval_report"');
  });

  it("Gate 6.1 native dispatch probe uses schema-valid MCP artifact types", () => {
    const content = readFileSync("evals/multi-agent/probes/native-subagent-dispatch-probe.md", "utf8");

    expect(content).toContain("`artifact_type`: `log`");
    expect(content).not.toContain("probe_result");
    expect(content).toContain("the same `thread_id` used in `agent_run_start`");
  });
});
