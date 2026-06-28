import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { DEFAULT_GATE6_LITE_TIME_BUDGET } from "../../src/runtime/time-budget.ts";

interface CommandResult {
  command: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

interface Gate6Preflight {
  codex_cli_available: boolean;
  codex_version: string;
  plugin_enable_status: "PASS" | "UNKNOWN" | "BLOCKED";
  marketplace_plugin_path: string | null;
  marketplace_native_skill: boolean;
  cache_native_skill: boolean;
  hooks_trusted_mode_checked: boolean;
  warnings: string[];
}

const repoRoot = process.cwd();
const targetRepo = resolve(repoRoot, "tmp/multi-agent/gate6-target-validate-project-name");
const reportsDir = resolve(repoRoot, "evals/multi-agent/reports");
const promptPath = resolve(repoRoot, "evals/multi-agent/prompts/gate6-user-goal.md");
const schemaPath = resolve(repoRoot, "evals/multi-agent/schemas/gate6-result.schema.json");
const eventsPath = join(reportsDir, "gate6-target-events.jsonl");
const stderrPath = join(reportsDir, "gate6-target-stderr.log");
const finalOutputPath = join(reportsDir, "gate6-target-final-output.json");
const commandPath = join(reportsDir, "gate6-target-command.txt");
const exitCodePath = join(reportsDir, "gate6-target-exit-code.txt");
const preflightPath = join(reportsDir, "gate6-preflight.json");
const gate6TimeoutMs = 12 * 60 * 1000;

mkdirSync(reportsDir, { recursive: true });

async function main(): Promise<void> {
  if (!isFullGate6ExplicitlyAllowed()) {
    resetRunOutputs();
    writeJson(finalOutputPath, {
      status: "BLOCKED",
      reason: "FULL_GATE6_RUN_DISABLED_BY_DEFAULT",
      real_thread_executed: false,
      parent_thread_id: "",
      agent_runs: [],
      mcp_cross_agent_state_verified: false,
      subagent_lifecycle_verified: false,
      initial_eval_verdict: "",
      repair_request_created: false,
      final_eval_verdict: "",
      tests_passed: false,
      parent_roleplay_detected: false,
      changed_files: [],
      artifacts: [],
      validation_commands: [],
      p0_blockers: ["Full Gate 6 run is disabled by default after Gate 6.2-Lite safety patch."],
      p1_issues: ["Use Gate 6.2-Lite continuation probe unless a full run is explicitly approved."],
      ready_for_M12_effectiveness_eval: false,
      runtime_budget: DEFAULT_GATE6_LITE_TIME_BUDGET
    });
    writeFileSync(commandPath, "not run: full Gate 6 disabled by default\n", "utf8");
    writeFileSync(exitCodePath, "blocked_full_gate6_disabled_by_default\n", "utf8");
    return;
  }
  resetRunOutputs();
  const preflight = await buildPreflight();
  writeJson(preflightPath, preflight);

  const setup = await createTargetRepo();
  writeJson(join(reportsDir, "gate6-target-setup.json"), setup);
  if (!setup.initial_tests_failed) {
    writeJson(finalOutputPath, {
      status: "NEEDS_REVISION",
      real_thread_executed: false,
      parent_thread_id: "",
      agent_runs: [],
      mcp_cross_agent_state_verified: false,
      subagent_lifecycle_verified: false,
      initial_eval_verdict: "",
      repair_request_created: false,
      final_eval_verdict: "",
      tests_passed: false,
      parent_roleplay_detected: false,
      changed_files: [],
      artifacts: [],
      validation_commands: ["npm test"],
      p0_blockers: ["Gate 6 target fixture was not initially failing."],
      p1_issues: [],
      ready_for_M12_effectiveness_eval: false
    });
    writeFileSync(exitCodePath, "not_run\n", "utf8");
    return;
  }

  if (!preflight.codex_cli_available) {
    writeJson(finalOutputPath, {
      status: "BLOCKED",
      real_thread_executed: false,
      parent_thread_id: "",
      agent_runs: [],
      mcp_cross_agent_state_verified: false,
      subagent_lifecycle_verified: false,
      initial_eval_verdict: "",
      repair_request_created: false,
      final_eval_verdict: "",
      tests_passed: false,
      parent_roleplay_detected: false,
      changed_files: [],
      artifacts: [],
      validation_commands: [],
      p0_blockers: ["codex CLI is unavailable."],
      p1_issues: [],
      ready_for_M12_effectiveness_eval: false
    });
    writeFileSync(exitCodePath, "not_run\n", "utf8");
    return;
  }

  const prompt = readFileSync(promptPath, "utf8");
  const targetStateDir = join(targetRepo, "state");
  const args = [
    "exec",
    "-c",
    `mcp_servers.codex_loop_store.command="node"`,
    "-c",
    `mcp_servers.codex_loop_store.args=["src/mcp/server.ts"]`,
    "-c",
    `mcp_servers.codex_loop_store.cwd="${tomlString(repoRoot)}"`,
    "-c",
    `mcp_servers.codex_loop_store.env.CODEX_LOOP_STATE_DIR="${tomlString(targetStateDir)}"`,
    "--json",
    "--sandbox",
    "workspace-write",
    "--output-schema",
    schemaPath,
    "-o",
    finalOutputPath,
    "-C",
    targetRepo,
    prompt
  ];
  writeFileSync(commandPath, `codex ${args.map(shellQuote).join(" ")}\n`, "utf8");

  const output = await spawnToFiles("codex", args, {
    cwd: targetRepo,
    stdoutPath: eventsPath,
    stderrPath,
    timeoutMs: gate6TimeoutMs,
    env: {
      ...process.env,
      CODEX_LOOP_STATE_DIR: targetStateDir
    }
  });
  writeFileSync(exitCodePath, output.timedOut ? `timeout_after_${gate6TimeoutMs}ms\n` : `${output.exitCode ?? "null"}\n`, "utf8");
  if (output.timedOut) {
    const currentFinalOutput = safeReadJson(finalOutputPath);
    if (readString(currentFinalOutput, "status") === "RUNNING") {
      writeJson(finalOutputPath, {
        status: "BLOCKED_NATIVE_SUBAGENT_NO_OUTPUT",
        real_thread_executed: true,
        parent_thread_id: "",
        agent_runs: [],
        mcp_cross_agent_state_verified: false,
        subagent_lifecycle_verified: false,
        initial_eval_verdict: "",
        repair_request_created: false,
        final_eval_verdict: "",
        tests_passed: false,
        parent_roleplay_detected: false,
        changed_files: [],
        artifacts: [],
        validation_commands: [],
        p0_blockers: ["Gate 6 codex exec timed out while waiting for native subagent output."],
        p1_issues: [],
        ready_for_M12_effectiveness_eval: false
      });
    }
  }
}

function isFullGate6ExplicitlyAllowed(): boolean {
  return process.env.CODEX_LOOP_ALLOW_FULL_GATE6 === "1" || process.argv.includes("--allow-full-gate6");
}

async function buildPreflight(): Promise<Gate6Preflight> {
  const warnings: string[] = [];
  const version = await runCommand("codex", ["--version"], repoRoot);
  const pluginList = await runCommand("codex", ["plugin", "list"], repoRoot);
  const marketplacePluginPath = parseCodexLoopPluginPath(pluginList.stdout);
  const marketplaceSkillPath = marketplacePluginPath ? join(marketplacePluginPath, "skills/codex-loop/SKILL.md") : null;
  const cacheSkillPath = join(homeDir(), ".codex/plugins/cache/codex-loop-proof/codex-loop/0.1.0/skills/codex-loop/SKILL.md");
  const marketplaceNativeSkill = marketplaceSkillPath ? fileContains(marketplaceSkillPath, "Native Subagent Mode") : false;
  const cacheNativeSkill = fileContains(cacheSkillPath, "Native Subagent Mode");

  if (!marketplaceNativeSkill) {
    warnings.push("Configured marketplace plugin source does not contain Native Subagent Mode.");
  }
  if (!cacheNativeSkill) {
    warnings.push("Installed plugin cache does not contain Native Subagent Mode; live Codex runs may use stale skill instructions.");
  }

  return {
    codex_cli_available: version.exitCode === 0,
    codex_version: version.stdout.trim(),
    plugin_enable_status: /codex-loop@codex-loop-proof\s+installed,\s+enabled/.test(pluginList.stdout) ? "PASS" : pluginList.exitCode === 0 ? "UNKNOWN" : "BLOCKED",
    marketplace_plugin_path: marketplacePluginPath,
    marketplace_native_skill: marketplaceNativeSkill,
    cache_native_skill: cacheNativeSkill,
    hooks_trusted_mode_checked: false,
    warnings
  };
}

async function createTargetRepo(): Promise<Record<string, unknown>> {
  rmSync(targetRepo, { recursive: true, force: true });
  mkdirSync(join(targetRepo, "src"), { recursive: true });
  mkdirSync(join(targetRepo, "test"), { recursive: true });
  mkdirSync(join(targetRepo, "state"), { recursive: true });
  mkdirSync(join(targetRepo, "artifacts"), { recursive: true });
  materializeProjectCodexConfig();

  writeFileSync(
    join(targetRepo, "package.json"),
    `${JSON.stringify(
      {
        name: "gate6-target-validate-project-name",
        version: "0.0.0",
        type: "module",
        scripts: {
          test: "node --test",
          validate: "node --test"
        }
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  writeFileSync(join(targetRepo, "README.md"), "# gate6-target-validate-project-name\n\nIsolated broken target repository for Gate 6 native multi-agent validation.\n", "utf8");
  writeFileSync(join(targetRepo, "AGENTS.md"), gate6TargetAgentInstructions(), "utf8");
  writeFileSync(join(targetRepo, "src/project-name.js"), "export function validateProjectName(name) {\n  return { ok: true };\n}\n", "utf8");
  writeFileSync(
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
`,
    "utf8"
  );

  const gitInit = await runCommand("git", ["init"], targetRepo);
  const initialTest = await runCommand("npm", ["test"], targetRepo);

  return {
    target_repo: targetRepo,
    git_init_exit_code: gitInit.exitCode,
    git_commit_exit_code: "not_run",
    git_commit_warning: "Gate 6 intentionally does not run git add or git commit.",
    initial_tests_failed: initialTest.exitCode !== 0,
    initial_test_exit_code: initialTest.exitCode,
    initial_test_stdout_excerpt: initialTest.stdout.slice(0, 2000),
    initial_test_stderr_excerpt: initialTest.stderr.slice(0, 2000)
  };
}

function gate6TargetAgentInstructions(): string {
  return `# Gate 6 Target Repo Instructions

This repository is an isolated Gate 6 native multi-agent validation target.

The parent \`$codex-loop\` thread is the Loop Manager only. Keep the parent run short.

Critical RCA guard:

- A previous Gate 6 run failed because the parent completed \`loop_planner\`, then loaded generic TDD/review skills and timed out before spawning \`loop_dev_worker\`.
- In this target repo, that exact pattern is forbidden. After planner success, the next parent tool call must be native \`spawn_agent\` for \`loop_dev_worker\` phase \`implementation\`.
- If the parent cannot do that, it must output \`BLOCKED_NATIVE_SUBAGENTS_UNAVAILABLE\` or \`NEEDS_REVISION\` with \`planner_done_without_dev_worker_spawn\`; it must not produce a partial success JSON.

Native dispatch rules:

1. Use Native Subagent Mode.
2. Parent must spawn \`loop_planner\` for PRD, acceptance criteria, and TaskGraph.
3. After planner completes, the next parent action must be a native \`spawn_agent\` call for \`loop_dev_worker\` phase \`implementation\`.
4. Parent must not load generic TDD/review/release skills before dispatching \`loop_dev_worker\`.
5. Parent must not directly edit \`src/project-name.js\`.
6. Parent must not directly write \`artifacts/dev-result.json\`, EvalReport artifacts, or FinalDeliveryReport before required subagent evidence exists.
7. Baseline evaluator must run after initial dev work and must produce NEEDS_REVISION if an acceptance gap remains.
8. RepairRequest must reference the baseline EvalReport.
9. Repair worker must run after RepairRequest.
10. Final evaluator must produce PASS before final validation/report.

Required native dispatch sequence:

1. \`spawn_agent(loop_planner)\`, then \`wait\`.
2. \`spawn_agent(loop_dev_worker)\` for phase \`implementation\`, then \`wait\`.
3. \`spawn_agent(loop_evaluator)\` for phase \`baseline\`, then \`wait\`.
4. Parent writes or records \`artifacts/repair-request.json\` only after baseline EvalReport NEEDS_REVISION.
5. \`spawn_agent(loop_dev_worker)\` for phase \`repair\`, then \`wait\`.
6. \`spawn_agent(loop_evaluator)\` for phase \`final\`, then \`wait\`.
7. Run \`npm test\` only after final evaluator PASS.
8. Write \`artifacts/FinalDeliveryReport.md\` only after tests pass.

Subagent work orders must contain exact MCP evidence requirements:

- \`agent_run_start\` at the beginning.
- \`artifact_write_by_agent\` for every produced artifact, using the same \`thread_id\` passed to \`agent_run_start\`.
- \`eval_report_write_by_agent\` for EvalReports.
- \`agent_run_finish\` at the end.
- Use legal artifact types: \`prd\`, \`acceptance_criteria\`, \`task_graph\`, \`dev_result\`, \`eval_report\`, \`repair_request\`, \`final_report\`, or \`log\`.

RepairRequest schema guard:

- \`repair_create_request\` expects the full M1 RepairRequest shape.
- Required top-level fields are \`repair_id\`, \`loop_run_id\`, \`task_id\`, \`module_id\`, \`source_eval_id\`, \`assigned_agent_id\`, \`findings\`, \`repair_instructions\`, \`allowed_scope\`, \`disallowed_scope\`, \`validation_commands\`, \`status\`, \`created_at\`, and \`updated_at\`.
- Use \`assigned_agent_id: "loop_dev_worker"\` and \`status: "REPAIR_REQUESTED"\`.
- Copy full evaluator finding objects into \`findings\`.
- Do not use rejected top-level fields: \`source_eval_report_path\`, \`finding_ids\`, \`required_fixes\`, \`created_by\`, or \`metadata\`.
- If \`repair_create_request\` returns \`ok: false\`, stop as \`NEEDS_REVISION\` with \`repair_request_schema_invalid\`; do not claim a valid RepairRequest and do not spawn the repair worker.

Allowed target implementation surface:

- \`src/project-name.js\`
- \`artifacts/*.json\`
- \`artifacts/FinalDeliveryReport.md\`
- \`docs/PRD.md\`
- \`docs/ACCEPTANCE_CRITERIA.md\`
- \`docs/TASK_GRAPH.json\`
- \`state/*.json\`

Do not modify \`package.json\` or \`test/project-name.test.js\`.
Do not access network or secrets.
`;
}

function materializeProjectCodexConfig(): void {
  const sourceCodexDir = resolve(repoRoot, ".codex");
  const targetCodexDir = join(targetRepo, ".codex");
  if (!existsSync(sourceCodexDir)) {
    return;
  }
  cpSync(sourceCodexDir, targetCodexDir, {
    recursive: true
  });
}

async function runCommand(command: string, args: string[], cwd: string): Promise<CommandResult> {
  return new Promise((resolveCommand) => {
    const child = spawn(command, args, { cwd, env: process.env });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (error) => {
      resolveCommand({
        command: [command, ...args].join(" "),
        exitCode: -1,
        stdout: "",
        stderr: error.message
      });
    });
    child.on("close", (code) => {
      resolveCommand({
        command: [command, ...args].join(" "),
        exitCode: code,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8")
      });
    });
  });
}

async function spawnToFiles(
  command: string,
  args: string[],
  options: { cwd: string; stdoutPath: string; stderrPath: string; timeoutMs: number; env: NodeJS.ProcessEnv }
): Promise<{ exitCode: number | null; timedOut: boolean }> {
  return new Promise((resolveSpawn) => {
    mkdirSync(dirname(options.stdoutPath), { recursive: true });
    const stdoutFd = writeFileSync(options.stdoutPath, "", "utf8");
    void stdoutFd;
    writeFileSync(options.stderrPath, "", "utf8");
    let finished = false;
    let timedOut = false;
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const timeout = setTimeout(() => {
      if (finished) {
        return;
      }
      timedOut = true;
      child.kill("SIGINT");
      setTimeout(() => {
        if (!finished) {
          child.kill("SIGTERM");
        }
      }, 5_000).unref();
    }, options.timeoutMs);
    timeout.unref();
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => {
      stdoutChunks.push(chunk);
      writeFileSync(options.stdoutPath, Buffer.concat(stdoutChunks));
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrChunks.push(chunk);
      writeFileSync(options.stderrPath, Buffer.concat(stderrChunks));
    });
    child.on("error", (error) => {
      finished = true;
      clearTimeout(timeout);
      writeFileSync(options.stderrPath, error.message, "utf8");
      resolveSpawn({ exitCode: -1, timedOut });
    });
    child.on("close", (code) => {
      finished = true;
      clearTimeout(timeout);
      resolveSpawn({ exitCode: code, timedOut });
    });
  });
}

function resetRunOutputs(): void {
  writeJson(finalOutputPath, {
    status: "RUNNING",
    real_thread_executed: false,
    parent_thread_id: "",
    agent_runs: [],
    mcp_cross_agent_state_verified: false,
    subagent_lifecycle_verified: false,
    initial_eval_verdict: "",
    repair_request_created: false,
    final_eval_verdict: "",
    tests_passed: false,
    parent_roleplay_detected: false,
    changed_files: [],
    artifacts: [],
    validation_commands: [],
    p0_blockers: [],
    p1_issues: ["Gate 6 run has started; this placeholder must be overwritten by codex exec."],
    ready_for_M12_effectiveness_eval: false
  });
  writeFileSync(eventsPath, "", "utf8");
  writeFileSync(stderrPath, "", "utf8");
  writeFileSync(exitCodePath, "running\n", "utf8");
}

function parseCodexLoopPluginPath(pluginList: string): string | null {
  const line = pluginList
    .split(/\r?\n/)
    .find((entry) => entry.includes("codex-loop@codex-loop-proof") && entry.includes("installed"));
  if (!line) {
    return null;
  }
  const match = line.match(/(\/.+\/tmp\/plugin-marketplace\/plugins\/codex-loop)\s*$/);
  return match?.[1] ?? null;
}

function fileContains(path: string, needle: string): boolean {
  return existsSync(path) && readFileSync(path, "utf8").includes(needle);
}

function homeDir(): string {
  const home = process.env.HOME;
  if (!home) {
    throw new Error("HOME is not set.");
  }
  return home;
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function tomlString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function safeReadJson(path: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(readFileSync(path, "utf8"));
    return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function readString(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  return typeof value === "string" ? value : "";
}

main().catch((error: unknown) => {
  writeFileSync(stderrPath, error instanceof Error ? error.stack ?? error.message : String(error), "utf8");
  writeFileSync(exitCodePath, "-1\n", "utf8");
  process.exitCode = 1;
});
