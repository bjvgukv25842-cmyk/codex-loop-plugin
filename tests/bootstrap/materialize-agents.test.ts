import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { LOOP_AGENT_TEMPLATES, materializeLoopAgents, verifyLoopAgentMaterialization } from "../../src/bootstrap/materialize-agents.ts";

const dirs: string[] = [];

afterEach(async () => {
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

async function tempRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "codex-loop-bootstrap-"));
  dirs.push(dir);
  return dir;
}

describe("native loop agent materialization", () => {
  it("creates required loop agent TOML files and config", async () => {
    const repoRoot = await tempRepo();
    const report = materializeLoopAgents({ repoRoot });

    expect(report.status).toBe("PASS");
    expect(report.custom_agents_materialized).toEqual(LOOP_AGENT_TEMPLATES.map((template) => template.name));
    expect(report.created_files).toEqual(LOOP_AGENT_TEMPLATES.map((template) => `.codex/agents/${template.fileName}`));
    expect(report.config_checked).toBe(true);

    for (const template of LOOP_AGENT_TEMPLATES) {
      const content = await readFile(join(repoRoot, ".codex", "agents", template.fileName), "utf8");
      expect(content).toContain(`name = "${template.name}"`);
      expect(content).toContain(`sandbox_mode = "${template.sandbox_mode}"`);
      expect(content).toContain("developer_instructions");
      expect(content).toContain("agent_run_id");
      expect(content).toContain("thread_id");
    }
  });

  it("materializes native loop rules for baseline evaluation and repair dispatch", async () => {
    const repoRoot = await tempRepo();
    materializeLoopAgents({ repoRoot });

    const planner = await readFile(join(repoRoot, ".codex", "agents", "loop-planner.toml"), "utf8");
    const devWorker = await readFile(join(repoRoot, ".codex", "agents", "loop-dev-worker.toml"), "utf8");
    const evaluator = await readFile(join(repoRoot, ".codex", "agents", "loop-evaluator.toml"), "utf8");

    expect(planner).toContain("baseline evaluation before development");
    expect(devWorker).toContain("RepairRequest input after a baseline evaluator NEEDS_REVISION verdict");
    expect(evaluator).toContain("baseline state before development");
  });

  it("verifies an existing materialized repo without rewriting files", async () => {
    const repoRoot = await tempRepo();
    materializeLoopAgents({ repoRoot });

    const report = materializeLoopAgents({ repoRoot });
    const verification = verifyLoopAgentMaterialization(repoRoot);

    expect(report.status).toBe("PASS");
    expect(report.created_files).toEqual([]);
    expect(report.existing_files).toHaveLength(LOOP_AGENT_TEMPLATES.length);
    expect(verification).toMatchObject({
      valid: true,
      missing_files: [],
      config_checked: true,
      errors: []
    });
  });
});
