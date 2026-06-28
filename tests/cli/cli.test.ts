import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { runCli } from "../../src/cli/index.ts";
import type { EvalReport, RepairRequest, TaskNode } from "../../src/core/types.ts";
import { LoopController, StubRuntimeAdapter } from "../../src/orchestrator/index.ts";
import { JsonLoopStore } from "../../src/state/json-store.ts";

const createdDirectories: string[] = [];

async function createController(): Promise<{ controller: LoopController; store: JsonLoopStore }> {
  const stateDir = await mkdtemp(join(tmpdir(), "codex-loop-cli-"));
  createdDirectories.push(stateDir);
  const store = new JsonLoopStore({ stateDir });
  return {
    controller: new LoopController(store),
    store
  };
}

afterEach(async () => {
  while (createdDirectories.length > 0) {
    const directory = createdDirectories.pop();
    if (directory) {
      await rm(directory, { recursive: true, force: true });
    }
  }
});

describe("loop CLI", () => {
  it("loop init creates a LoopRun and default agents", async () => {
    const { controller, store } = await createController();

    const result = await runCli(["loop", "init", "--goal", "Ship M7 CLI", "--module-id", "M7"], {
      controller
    });

    expect(result).toMatchObject({
      registered_agents: ["agent_planner", "agent_dev_worker", "agent_evaluator", "agent_context_distiller", "agent_integration_manager"]
    });
    const loopRunId = (result as { loop_run_id: string }).loop_run_id;
    expect(await store.getLoopRun(loopRunId)).toMatchObject({
      status: "GOAL_RECEIVED",
      current_module_id: "M7"
    });
    expect(await store.listAgents()).toHaveLength(5);
  });

  it("loop status reads status, current module, task counts, and events", async () => {
    const { controller } = await createController();
    const initResult = (await runCli(["loop", "init", "--goal", "Status test"], {
      controller
    })) as { loop_run_id: string };

    const status = await runCli(["loop", "status", "--loop-run-id", initResult.loop_run_id], {
      controller
    });

    expect(status).toMatchObject({
      loop_run_id: initResult.loop_run_id,
      status: "GOAL_RECEIVED",
      current_module_id: "M7",
      task_count: 0
    });
    expect((status as { recent_events: unknown[] }).recent_events.length).toBeGreaterThan(0);
  });

  it("loop run returns RuntimeAdapter TODO instead of pretending Codex ran", async () => {
    const { controller } = await createController();
    const initResult = (await runCli(["loop", "init", "--goal", "Runtime stub test"], {
      controller
    })) as { loop_run_id: string };

    await runCli(["loop", "run", "--loop-run-id", initResult.loop_run_id], {
      controller
    });
    await runCli(["loop", "run", "--loop-run-id", initResult.loop_run_id], {
      controller
    });
    await runCli(["loop", "run", "--loop-run-id", initResult.loop_run_id], {
      controller
    });
    const dispatching = await runCli(["loop", "run", "--loop-run-id", initResult.loop_run_id], {
      controller
    });

    expect(dispatching).toMatchObject({
      previous_status: "TASK_GRAPH_READY",
      next_status: "DEV_DISPATCHING",
      runtime: null
    });

    const devRunning = await runCli(["loop", "run", "--loop-run-id", initResult.loop_run_id], {
      controller
    });
    expect(devRunning).toMatchObject({
      next_status: "DEV_RUNNING",
      runtime: {
        status: "TODO",
        operation: "startThread"
      }
    });
  });

  it("StubRuntimeAdapter returns structured TODO results", async () => {
    const result = await new StubRuntimeAdapter().runAgent();

    expect(result).toEqual({
      status: "TODO",
      operation: "runAgent",
      message: "RuntimeAdapter is a stub in M7 and does not call the Codex SDK or any external runtime."
    });
  });

  it("loop eval creates a repair request for NEEDS_REVISION", async () => {
    const { controller, store } = await createController();
    const initResult = (await runCli(["loop", "init", "--goal", "Eval command test"], {
      controller
    })) as { loop_run_id: string };
    await store.updateLoopRun(initResult.loop_run_id, { status: "EVAL_RUNNING" });
    await store.createTask(createTask(initResult.loop_run_id));
    await store.writeEvalReport(createEvalReport(initResult.loop_run_id));

    const result = await runCli(["loop", "eval", "--eval-id", "eval_cli_revision"], {
      controller
    });

    expect(result).toMatchObject({
      verdict: "NEEDS_REVISION",
      next_status: "REPAIR_REQUESTED"
    });
    expect(await store.getRepairRequest((result as { repair_request_id: string }).repair_request_id)).toMatchObject({
      source_eval_id: "eval_cli_revision"
    });
  });

  it("loop repair writes a dev_worker repair prompt file", async () => {
    const { controller, store } = await createController();
    const stateDir = await mkdtemp(join(tmpdir(), "codex-loop-cli-artifacts-"));
    createdDirectories.push(stateDir);
    const initResult = (await runCli(["loop", "init", "--goal", "Repair command test"], {
      controller
    })) as { loop_run_id: string };
    await store.createTask(createTask(initResult.loop_run_id));
    await store.createRepairRequest(createRepairRequest(initResult.loop_run_id));

    const result = await runCli(["loop", "repair", "--repair-id", "repair_cli", "--output-dir", stateDir], {
      controller
    });

    expect(result).toMatchObject({
      repair_id: "repair_cli",
      task_id: "task_cli"
    });
    expect((result as { prompt_path: string }).prompt_path).toContain("repair_cli.prompt.md");
    expect(await store.getTask("task_cli")).toMatchObject({
      status: "REPAIR_REQUESTED"
    });
  });

  it("loop capsule writes a ContextCapsule artifact and state entry", async () => {
    const { controller, store } = await createController();
    const artifactDir = await mkdtemp(join(tmpdir(), "codex-loop-capsule-"));
    createdDirectories.push(artifactDir);
    const initResult = (await runCli(["loop", "init", "--goal", "Capsule command test"], {
      controller
    })) as { loop_run_id: string };
    await store.createTask(createTask(initResult.loop_run_id));

    const result = await runCli(
      [
        "loop",
        "capsule",
        "--loop-run-id",
        initResult.loop_run_id,
        "--agent-id",
        "agent_dev_worker",
        "--task-id",
        "task_cli",
        "--restart-reason",
        "Context is long.",
        "--next-instruction",
        "Continue M7 validation.",
        "--artifact-dir",
        artifactDir
      ],
      { controller }
    );

    const capsuleId = (result as { capsule: { capsule_id: string } }).capsule.capsule_id;
    expect(await store.getContextCapsule(capsuleId)).toMatchObject({
      agent_id: "agent_dev_worker",
      next_instruction: "Continue M7 validation."
    });
    expect((result as { artifact_path: string }).artifact_path).toContain(capsuleId);
  });

  it("loop report writes a final delivery report", async () => {
    const { controller } = await createController();
    const reportDir = await mkdtemp(join(tmpdir(), "codex-loop-report-"));
    createdDirectories.push(reportDir);
    const initResult = (await runCli(["loop", "init", "--goal", "Report command test"], {
      controller
    })) as { loop_run_id: string };
    const reportPath = join(reportDir, "FinalDeliveryReport.md");

    const result = await runCli(["loop", "report", "--loop-run-id", initResult.loop_run_id, "--path", reportPath], {
      controller
    });

    expect(result).toMatchObject({
      path: reportPath
    });
    expect((result as { content: string }).content).toContain("# Final Delivery Report");
  });
});

function now(): string {
  return "2026-06-18T09:00:00.000Z";
}

function createTask(loopRunId: string): TaskNode {
  return {
    task_id: "task_cli",
    loop_run_id: loopRunId,
    module_id: "M7",
    title: "CLI test task",
    description: "Exercise CLI commands.",
    owner_agent_type: "dev_worker",
    owner_agent_id: "agent_dev_worker",
    reviewer_agent_type: "evaluator",
    reviewer_agent_id: "agent_evaluator",
    dependencies: [],
    scope: ["src/cli"],
    non_goals: ["Do not call real Codex SDK"],
    likely_files: [
      {
        path: "src/cli/index.ts"
      }
    ],
    acceptance_criteria: ["CLI command works"],
    validation_commands: [
      {
        command: "npm test -- tests/cli/cli.test.ts"
      }
    ],
    risk_level: "medium",
    status: "EVAL_RUNNING",
    revision_count: 0,
    branch: null,
    worktree_path: null,
    artifact_ids: [],
    created_at: now(),
    updated_at: now(),
    metadata: {}
  };
}

function createEvalReport(loopRunId: string): EvalReport {
  return {
    eval_id: "eval_cli_revision",
    loop_run_id: loopRunId,
    task_id: "task_cli",
    module_id: "M7",
    evaluator_agent_id: "agent_evaluator",
    verdict: "NEEDS_REVISION",
    confidence: 0.8,
    findings: [
      {
        finding_id: "finding_cli",
        severity: "medium",
        category: "correctness",
        description: "CLI eval test finding.",
        evidence: [
          {
            type: "text",
            ref: "tests/cli/cli.test.ts"
          }
        ],
        required_fix: "Create a RepairRequest."
      }
    ],
    required_fixes: [
      {
        fix_id: "fix_cli",
        finding_ids: ["finding_cli"],
        instruction: "Repair the CLI command behavior.",
        expected_files: [
          {
            path: "src/cli/index.ts"
          }
        ],
        validation_commands: [
          {
            command: "npm test -- tests/cli/cli.test.ts"
          }
        ]
      }
    ],
    validation_commands_checked: [
      {
        command: "npm test"
      }
    ],
    created_at: now(),
    updated_at: now(),
    metadata: {}
  };
}

function createRepairRequest(loopRunId: string): RepairRequest {
  return {
    repair_id: "repair_cli",
    loop_run_id: loopRunId,
    task_id: "task_cli",
    module_id: "M7",
    source_eval_id: "eval_cli_revision",
    assigned_agent_id: "agent_dev_worker",
    findings: [
      {
        finding_id: "finding_cli",
        severity: "medium",
        category: "correctness",
        description: "CLI repair test finding.",
        evidence: [
          {
            type: "text",
            ref: "tests/cli/cli.test.ts"
          }
        ],
        required_fix: "Write repair prompt."
      }
    ],
    repair_instructions: ["Repair only this CLI finding."],
    allowed_scope: ["src/cli"],
    disallowed_scope: ["src/hooks"],
    validation_commands: [
      {
        command: "npm test -- tests/cli/cli.test.ts"
      }
    ],
    status: "REPAIR_REQUESTED",
    created_at: now(),
    updated_at: now()
  };
}
