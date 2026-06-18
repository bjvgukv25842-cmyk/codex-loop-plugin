import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  AGENT_FILE_BY_NAME,
  REQUIRED_AGENTS,
  loadAgentDefinitions,
  validateAgents
} from "../../src/agents/validate-agents.ts";

function readAgent(fileName: string): string {
  return readFileSync(join(".codex", "agents", fileName), "utf8");
}

describe("custom agent definitions", () => {
  it("has all required agent files", () => {
    for (const agentName of REQUIRED_AGENTS) {
      expect(existsSync(join(".codex", "agents", AGENT_FILE_BY_NAME[agentName]))).toBe(true);
    }
  });

  it("validates every required agent and project agent config", () => {
    const result = validateAgents();

    expect(result).toMatchObject({
      valid: true,
      errors: [],
      configChecked: true
    });
    expect(result.agentsChecked).toEqual([...REQUIRED_AGENTS].sort());
  });

  it("has required fields for every agent", () => {
    const errors: Array<{ path: string; message: string }> = [];
    const agents = loadAgentDefinitions(errors);

    expect(errors).toEqual([]);
    for (const agent of agents) {
      expect(agent.name).toBeTruthy();
      expect(agent.description).toBeTruthy();
      expect(agent.developer_instructions).toBeTruthy();
      expect(agent.sandbox_mode).toMatch(/^(read-only|workspace-write)$/);
    }
  });

  it("keeps read-only agents out of workspace-write mode", () => {
    for (const fileName of [
      "planner.toml",
      "evaluator.toml",
      "context-distiller.toml",
      "test-reviewer.toml",
      "architecture-reviewer.toml"
    ]) {
      const content = readAgent(fileName);

      expect(content).toContain('sandbox_mode = "read-only"');
      expect(content).not.toContain('sandbox_mode = "workspace-write"');
    }
  });

  it("dev_worker includes scope limits and validation reporting", () => {
    const content = readAgent("dev-worker.toml");

    expect(content).toContain('sandbox_mode = "workspace-write"');
    expect(content).toMatch(/scope/i);
    expect(content).toContain("changed_files");
    expect(content).toContain("remaining_risks");
    expect(content).toMatch(/Do not proceed to the next module/i);
  });

  it("evaluator contains PASS, NEEDS_REVISION, and required fixes", () => {
    const content = readAgent("evaluator.toml");

    expect(content).toContain("PASS");
    expect(content).toContain("NEEDS_REVISION");
    expect(content).toContain("EvalReport");
    expect(content).toContain("required_fixes");
  });

  it("context_distiller contains ContextCapsule restart fields", () => {
    const content = readAgent("context-distiller.toml");

    expect(content).toMatch(/Context Capsule|ContextCapsule/);
    expect(content).toContain("agent_id");
    expect(content).toContain("old_thread_id");
    expect(content).toContain("open_issues");
    expect(content).toContain("next_instruction");
  });
});
