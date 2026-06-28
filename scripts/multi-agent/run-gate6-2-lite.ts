import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { appendSqliteHomeConfig, ensureEvalSqliteHome, withEvalSqliteEnv } from "../../src/runtime/eval-sqlite-home.ts";
import { execWithBudget } from "../../src/runtime/exec-with-budget.ts";
import { DEFAULT_GATE6_LITE_TIME_BUDGET, checkBudget, createTimeBudget, recordCodexExecRun } from "../../src/runtime/time-budget.ts";

const repoRoot = process.cwd();
const targetRepo = resolve(repoRoot, "tmp/multi-agent/gate6-2-lite-repair-target");
const reportsDir = resolve(repoRoot, "evals/multi-agent/reports");
const promptPath = resolve(repoRoot, "evals/multi-agent/probes/gate6-2-lite-repair-continuation.md");
const resultPath = resolve(reportsDir, "gate6-2-lite-result.json");
const commandPath = resolve(reportsDir, "gate6-2-lite-command.txt");
const eventsPath = resolve(reportsDir, "gate6-2-lite-events.jsonl");
const stderrPath = resolve(reportsDir, "gate6-2-lite-stderr.log");
const budgetResultPath = resolve(reportsDir, "gate6-2-lite-budget-result.json");
const finalOutputPath = resolve(reportsDir, "gate6-2-lite-final-output.json");

async function main(): Promise<void> {
  const command = process.argv[2] ?? "prepare";
  if (command === "prepare") {
    prepareTargetRepo();
    writeInitialResult("PREPARED");
    return;
  }
  if (command === "run") {
    await runOnce();
    return;
  }
  throw new Error(`Unknown Gate 6.2-Lite command: ${command}`);
}

export function prepareTargetRepo(): void {
  const sqliteHome = ensureEvalSqliteHome(repoRoot);
  if (!sqliteHome.ok) {
    writeJson(resultPath, {
      status: "BLOCKED",
      failure_category: sqliteHome.reason,
      real_thread_executed: false,
      isolated_sqlite_home: sqliteHome.path,
      sqlite_home_mode: sqliteHome.mode
    });
    return;
  }
  rmSync(targetRepo, { recursive: true, force: true });
  mkdirSync(join(targetRepo, "src"), { recursive: true });
  mkdirSync(join(targetRepo, "test"), { recursive: true });
  mkdirSync(join(targetRepo, "docs"), { recursive: true });
  mkdirSync(join(targetRepo, "artifacts"), { recursive: true });
  mkdirSync(join(targetRepo, "state"), { recursive: true });
  mkdirSync(join(targetRepo, ".codex/agents"), { recursive: true });

  writeJson(join(targetRepo, "package.json"), {
    name: "gate6-2-lite-repair-target",
    version: "0.0.0",
    type: "module",
    scripts: {
      test: "node --test",
      validate: "node --test"
    }
  });
  writeText(join(targetRepo, "README.md"), "# Gate 6.2-Lite Repair Target\n\nPrepared continuation target for repair-only native subagent validation.\n");
  writeText(join(targetRepo, "src/project-name.js"), "export function validateProjectName(name) {\n  return { ok: true };\n}\n");
  writeText(
    join(targetRepo, "test/project-name.test.js"),
    `import test from "node:test";
import assert from "node:assert/strict";
import { validateProjectName } from "../src/project-name.js";

test("rejects empty string", () => {
  assert.equal(validateProjectName("").ok, false);
});

test("rejects whitespace-only string", () => {
  assert.equal(validateProjectName("   ").ok, false);
});

test("rejects names longer than 80 characters", () => {
  assert.equal(validateProjectName("x".repeat(81)).ok, false);
});

test("accepts valid project names", () => {
  assert.equal(validateProjectName("My Project").ok, true);
});
`
  );
  writeText(join(targetRepo, "docs/PRD.md"), "# PRD\n\nUsers need project name validation before creating a project.\n");
  writeText(
    join(targetRepo, "docs/ACCEPTANCE_CRITERIA.md"),
    "# Acceptance Criteria\n\n- Empty string fails.\n- Whitespace-only string fails.\n- Names longer than 80 characters fail.\n- Valid project names pass.\n- No UI or database work is required.\n"
  );
  writeJson(join(targetRepo, "docs/TASK_GRAPH.json"), {
    task_graph_id: "task_graph_gate6_2_lite",
    loop_run_id: "loop_gate6_2_lite",
    prd_artifact_id: "artifact_prd_gate6_2_lite",
    root_goal: "Repair validateProjectName continuation from a prepared RepairRequest.",
    tasks: [
      {
        task_id: "TASK-REPAIR-001",
        loop_run_id: "loop_gate6_2_lite",
        module_id: "repair",
        title: "Repair validateProjectName",
        description: "Repair the existing implementation so all project-name acceptance criteria pass.",
        status: "REPAIR_REQUESTED",
        owner_agent_type: "dev_worker",
        owner_agent_id: "loop_dev_worker",
        reviewer_agent_type: "evaluator",
        reviewer_agent_id: "loop_evaluator",
        dependencies: [],
        scope: ["src/project-name.js", "artifacts/dev-repair-result.json"],
        non_goals: ["UI", "database", "third-party dependencies"],
        acceptance_criteria: [
          "Empty string fails.",
          "Whitespace-only string fails.",
          "Names longer than 80 characters fail.",
          "Valid project names pass."
        ],
        likely_files: [
          { path: "src/project-name.js", purpose: "implementation" },
          { path: "test/project-name.test.js", purpose: "validation" }
        ],
        validation_commands: [{ command: "npm test", reason: "Run target repo tests" }],
        risk_level: "low",
        revision_count: 1,
        branch: null,
        worktree_path: targetRepo,
        artifact_ids: ["eval_gate6_2_lite_needs_revision", "repair_gate6_2_lite"],
        created_at: "2026-06-19T00:00:00.000Z",
        updated_at: "2026-06-19T00:00:00.000Z",
        metadata: {}
      }
    ],
    edges: [],
    status: "TASK_GRAPH_READY",
    created_at: "2026-06-19T00:00:00.000Z",
    updated_at: "2026-06-19T00:00:00.000Z"
  });
  writeJson(join(targetRepo, "artifacts/eval-report-needs-revision.json"), {
    eval_id: "eval_gate6_2_lite_needs_revision",
    loop_run_id: "loop_gate6_2_lite",
    task_id: "TASK-REPAIR-001",
    module_id: "repair",
    evaluator_agent_id: "loop_evaluator",
    verdict: "NEEDS_REVISION",
    summary: "Current validateProjectName implementation accepts invalid names.",
    findings: [
      {
        finding_id: "finding_gate6_2_lite_invalid_names",
        severity: "high",
        category: "correctness",
        description: "Current validateProjectName implementation accepts invalid empty, whitespace-only, and overlong names.",
        evidence: [{ type: "file", ref: "src/project-name.js", summary: "Implementation returns { ok: true } unconditionally." }],
        required_fix: "Implement validation for empty strings, whitespace-only strings, and names longer than 80 characters."
      }
    ],
    required_fixes: [
      {
        fix_id: "fix_gate6_2_lite_invalid_names",
        finding_ids: ["finding_gate6_2_lite_invalid_names"],
        instruction: "Implement validation for invalid project names without changing tests or package.json.",
        expected_files: [{ path: "src/project-name.js", purpose: "implementation" }],
        validation_commands: [{ command: "npm test", reason: "Verify project name validation" }]
      }
    ],
    validation_commands_checked: [{ command: "npm test", reason: "Prepared failing validation command" }],
    created_at: "2026-06-19T00:00:00.000Z",
    updated_at: "2026-06-19T00:00:00.000Z",
    metadata: {
      created_by_agent_run_id: "agent_run_loop_evaluator_prepared"
    }
  });
  writeJson(join(targetRepo, "artifacts/repair-request.json"), {
    repair_id: "repair_gate6_2_lite",
    loop_run_id: "loop_gate6_2_lite",
    task_id: "TASK-REPAIR-001",
    module_id: "repair",
    source_eval_id: "eval_gate6_2_lite_needs_revision",
    assigned_agent_id: "loop_dev_worker",
    findings: [
      {
        finding_id: "finding_gate6_2_lite_invalid_names",
        severity: "high",
        category: "correctness",
        description: "Current validateProjectName implementation accepts invalid empty, whitespace-only, and overlong names.",
        evidence: [{ type: "file", ref: "src/project-name.js", summary: "Implementation returns { ok: true } unconditionally." }],
        required_fix: "Implement validation for empty strings, whitespace-only strings, and names longer than 80 characters."
      }
    ],
    repair_instructions: ["Only repair src/project-name.js so project-name validation acceptance criteria pass. Do not modify package.json or delete tests."],
    allowed_scope: ["src/project-name.js", "artifacts/dev-repair-result.json"],
    disallowed_scope: ["package.json", "test/project-name.test.js", ".env", "node_modules"],
    validation_commands: [{ command: "npm test", reason: "Verify project name validation" }],
    status: "REPAIR_REQUESTED",
    created_at: "2026-06-19T00:00:00.000Z",
    updated_at: "2026-06-19T00:00:00.000Z"
  });
  writeJson(join(targetRepo, "state/events.json"), [
    {
      event_id: "event_gate6_2_lite_eval_needs_revision",
      loop_run_id: "loop_gate6_2_lite",
      type: "eval_needs_revision",
      message: "Prepared NEEDS_REVISION EvalReport exists.",
      created_at: "2026-06-19T00:00:00.000Z",
      updated_at: "2026-06-19T00:00:00.000Z",
      metadata: { eval_id: "eval_gate6_2_lite_needs_revision" }
    },
    {
      event_id: "event_gate6_2_lite_repair_requested",
      loop_run_id: "loop_gate6_2_lite",
      type: "repair_requested",
      message: "Prepared schema-valid RepairRequest exists.",
      created_at: "2026-06-19T00:00:00.000Z",
      updated_at: "2026-06-19T00:00:00.000Z",
      metadata: { repair_id: "repair_gate6_2_lite" }
    }
  ]);
  writeText(
    join(targetRepo, "AGENTS.md"),
    "# Gate 6.2-Lite Target\n\nParent is Loop Manager only. Do not run full Gate 6. Spawn loop_dev_worker repair, wait, then spawn loop_evaluator final.\n"
  );
  writeText(
    join(targetRepo, ".codex/config.toml"),
    "[agents]\nmax_threads = 6\nmax_depth = 1\n"
  );
  copyAgent("loop-dev-worker.toml");
  copyAgent("loop-evaluator.toml");
}

async function runOnce(): Promise<void> {
  if (!existsSync(join(targetRepo, "artifacts/repair-request.json"))) {
    prepareTargetRepo();
  }
  const budget = createTimeBudget();
  const check = checkBudget(budget, { fullGate6Run: false });
  if (!check.ok) {
    writeJson(resultPath, {
      status: "BLOCKED",
      failure_category: check.reason,
      real_thread_executed: false
    });
    return;
  }
  const sqliteHome = ensureEvalSqliteHome(repoRoot);
  if (!sqliteHome.ok) {
    writeJson(resultPath, {
      status: "BLOCKED",
      failure_category: sqliteHome.reason,
      real_thread_executed: false,
      isolated_sqlite_home: sqliteHome.path,
      sqlite_home_mode: sqliteHome.mode
    });
    writeJson(budgetResultPath, {
      status: "BLOCKED",
      duration_ms: 0,
      exit_code: null,
      signal: null,
      stdout_path: eventsPath,
      stderr_path: stderrPath,
      event_count: 0,
      last_event_type: "",
      failure_category: sqliteHome.reason
    });
    return;
  }
  const prompt = readFileSync(promptPath, "utf8");
  const args = appendSqliteHomeConfig([
    "exec",
    "-c",
    `mcp_servers.codex_loop_store.command="node"`,
    "-c",
    `mcp_servers.codex_loop_store.args=["src/mcp/server.ts"]`,
    "-c",
    `mcp_servers.codex_loop_store.cwd="${repoRoot}"`,
    "-c",
    `mcp_servers.codex_loop_store.env.CODEX_LOOP_STATE_DIR="${join(targetRepo, "state")}"`,
    "--json",
    "--sandbox",
    "workspace-write",
    "-o",
    finalOutputPath,
    "-C",
    targetRepo,
    prompt
  ], sqliteHome.path);
  if (args.some((arg) => /danger-full-access|dangerously-bypass/i.test(arg))) {
    throw new Error("Refusing to run Gate 6.2-Lite with danger/bypass sandbox flags.");
  }
  writeText(commandPath, `codex ${args.map(shellQuote).join(" ")}\n`);
  const result = await execWithBudget({
    command: "codex",
    args,
    cwd: targetRepo,
    stdout_path: eventsPath,
    stderr_path: stderrPath,
    env: {
      ...withEvalSqliteEnv(process.env, sqliteHome.path),
      CODEX_LOOP_STATE_DIR: join(targetRepo, "state")
    },
    budget: budget.config
  });
  writeJson(budgetResultPath, result);
  recordCodexExecRun(budget);
  if (result.status !== "PASS") {
    writeJson(resultPath, {
      status: result.status,
      failure_category: result.status,
      real_thread_executed: result.event_count > 0,
      runtime_budget: result
    });
  }
}

function copyAgent(fileName: string): void {
  const source = resolve(repoRoot, ".codex/agents", fileName);
  const target = join(targetRepo, ".codex/agents", fileName);
  if (existsSync(source)) {
    writeText(target, readFileSync(source, "utf8"));
  }
}

function writeInitialResult(status: "PREPARED"): void {
  writeJson(resultPath, {
    gate: "Gate 6.2-Lite Repair Continuation",
    status,
    real_thread_executed: false,
    target_repo: targetRepo,
    gate6_2_lite_real_run_executed: false,
    runtime_budget: DEFAULT_GATE6_LITE_TIME_BUDGET
  });
}

function writeJson(path: string, value: unknown): void {
  writeText(path, `${JSON.stringify(value, null, 2)}\n`);
}

function writeText(path: string, value: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value, "utf8");
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  });
}
