import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { baselineCaseSupported, buildBaselineCodexExecCommand, runBaselineCodexExecCanary, spawnBaselineCommand } from "../../src/effectiveness/baseline-codex-exec-runner.ts";
import { m12CasePaths } from "../../src/effectiveness/effectiveness-fixtures.ts";
import { runBaselineCase } from "../../scripts/effectiveness/run-baseline-case.ts";
import { loadM12Dataset } from "../../scripts/effectiveness/dataset.ts";
import { writeJson } from "../../scripts/effectiveness/io.ts";

const tempDirs: string[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("M12 baseline codex exec runner", () => {
  it("supports bugfix-small-001 dry-run without starting Codex", async () => {
    vi.stubEnv("CODEX_LOOP_ENABLE_M12_REAL_RUN", "");
    const testCase = bugfixCase();

    const result = await runBaselineCase(testCase);

    expect(baselineCaseSupported(testCase)).toBe(true);
    expect(result).toMatchObject({
      case_id: "bugfix-small-001",
      mode: "baseline",
      runtime: "codex-exec",
      status: "DRY_RUN",
      real_run_executed: false,
      validation_commands: ["npm test"],
      validation_passed: false,
      danger_full_access_used: false,
      secret_leak_detected: false
    });
    expect(result.baseline_expected_artifacts).toEqual([]);
  });

  it("supports bugfix-small-002 dry-run without starting Codex", async () => {
    vi.stubEnv("CODEX_LOOP_ENABLE_M12_REAL_RUN", "");
    const testCase = loadM12Dataset().find((entry) => entry.case_id === "bugfix-small-002")!;

    const result = await runBaselineCase(testCase);

    expect(baselineCaseSupported(testCase)).toBe(true);
    expect(result).toMatchObject({
      case_id: "bugfix-small-002",
      mode: "baseline",
      runtime: "codex-exec",
      status: "DRY_RUN",
      real_run_executed: false,
      validation_commands: ["npm test"],
      validation_passed: false,
      danger_full_access_used: false,
      secret_leak_detected: false
    });
    expect(result.baseline_expected_artifacts).toEqual([]);
  });

  it("supports test-coverage-001 dry-run without starting Codex", async () => {
    vi.stubEnv("CODEX_LOOP_ENABLE_M12_REAL_RUN", "");
    const testCase = loadM12Dataset().find((entry) => entry.case_id === "test-coverage-001")!;

    const result = await runBaselineCase(testCase);

    expect(baselineCaseSupported(testCase)).toBe(true);
    expect(result).toMatchObject({
      case_id: "test-coverage-001",
      mode: "baseline",
      runtime: "codex-exec",
      status: "DRY_RUN",
      real_run_executed: false,
      validation_commands: ["npm test", "npm run coverage:contract"],
      validation_passed: false,
      danger_full_access_used: false,
      secret_leak_detected: false
    });
    expect(result.baseline_expected_artifacts).toEqual([]);
  });

  it("supports test-coverage-002 dry-run without starting Codex", async () => {
    vi.stubEnv("CODEX_LOOP_ENABLE_M12_REAL_RUN", "");
    const testCase = loadM12Dataset().find((entry) => entry.case_id === "test-coverage-002")!;

    const result = await runBaselineCase(testCase);

    expect(baselineCaseSupported(testCase)).toBe(true);
    expect(result).toMatchObject({
      case_id: "test-coverage-002",
      mode: "baseline",
      runtime: "codex-exec",
      status: "DRY_RUN",
      real_run_executed: false,
      validation_commands: ["npm test", "npm run coverage:contract"],
      validation_passed: false,
      danger_full_access_used: false,
      secret_leak_detected: false
    });
    expect(result.baseline_expected_artifacts).toEqual([]);
  });

  it("supports docs-update-001 dry-run without starting Codex", async () => {
    vi.stubEnv("CODEX_LOOP_ENABLE_M12_REAL_RUN", "");
    const testCase = loadM12Dataset().find((entry) => entry.case_id === "docs-update-001")!;

    const result = await runBaselineCase(testCase);

    expect(baselineCaseSupported(testCase)).toBe(true);
    expect(result).toMatchObject({
      case_id: "docs-update-001",
      mode: "baseline",
      runtime: "codex-exec",
      status: "DRY_RUN",
      real_run_executed: false,
      validation_commands: ["npm test", "npm run docs:contract"],
      validation_passed: false,
      danger_full_access_used: false,
      secret_leak_detected: false
    });
    expect(result.baseline_expected_artifacts).toEqual([]);
  });

  it("supports refactor-small-001 dry-run without starting Codex", async () => {
    vi.stubEnv("CODEX_LOOP_ENABLE_M12_REAL_RUN", "");
    const testCase = loadM12Dataset().find((entry) => entry.case_id === "refactor-small-001")!;

    const result = await runBaselineCase(testCase);

    expect(baselineCaseSupported(testCase)).toBe(true);
    expect(result).toMatchObject({
      case_id: "refactor-small-001",
      mode: "baseline",
      runtime: "codex-exec",
      status: "DRY_RUN",
      real_run_executed: false,
      validation_commands: ["npm test", "npm run refactor:contract", "npm run lint:structure"],
      validation_passed: false,
      danger_full_access_used: false,
      secret_leak_detected: false
    });
    expect(result.baseline_expected_artifacts).toEqual([]);
  });

  it("supports feature-small-002 dry-run without starting Codex", async () => {
    vi.stubEnv("CODEX_LOOP_ENABLE_M12_REAL_RUN", "");
    const testCase = loadM12Dataset().find((entry) => entry.case_id === "feature-small-002")!;

    const result = await runBaselineCase(testCase);

    expect(baselineCaseSupported(testCase)).toBe(true);
    expect(result).toMatchObject({
      case_id: "feature-small-002",
      mode: "baseline",
      runtime: "codex-exec",
      status: "DRY_RUN",
      real_run_executed: false,
      validation_commands: ["npm test"],
      validation_passed: false,
      danger_full_access_used: false,
      secret_leak_detected: false
    });
    expect(result.baseline_expected_artifacts).toEqual([]);
  });

  it("supports adversarial-prompt-injection-001 dry-run without starting Codex", async () => {
    vi.stubEnv("CODEX_LOOP_ENABLE_M12_REAL_RUN", "");
    const testCase = loadM12Dataset().find((entry) => entry.case_id === "adversarial-prompt-injection-001")!;

    const result = await runBaselineCase(testCase);

    expect(baselineCaseSupported(testCase)).toBe(true);
    expect(result).toMatchObject({
      case_id: "adversarial-prompt-injection-001",
      mode: "baseline",
      runtime: "codex-exec",
      status: "DRY_RUN",
      real_run_executed: false,
      validation_commands: ["npm test", "npm run security:contract"],
      seeded_fake_secret_leaked: false,
      real_secret_leak_detected: false,
      danger_full_access_used: false
    });
    expect(result.baseline_expected_artifacts).toEqual([]);
  });

  it("builds the bugfix-small-001 real command with isolated sqlite and no danger-full-access", () => {
    const testCase = bugfixCase();
    const paths = m12CasePaths(testCase, "baseline", process.cwd());
    const sqliteHome = `${process.cwd()}/.codex-eval/sqlite`;

    const command = buildBaselineCodexExecCommand(paths, testCase, sqliteHome, {});

    expect(command.command).toBe("codex");
    expect(command.args).toEqual(expect.arrayContaining(["exec", "--json", "--sandbox", "workspace-write"]));
    expect(command.args.join(" ")).not.toContain("danger-full-access");
    expect(command.env.CODEX_SQLITE_HOME).toBe(sqliteHome);
    expect(command.cwd).toContain("bugfix-small-001/baseline/target-repo");
    expect(command.timeout_ms).toBe(180_000);
    expect(command.no_event_timeout_ms).toBe(60_000);
    expect(command.invocation_trace_path).toContain("baseline-invocation-trace-redacted.json");
  });

  it.each([
    ["test-coverage-001", "calculateInvoiceTotal"],
    ["test-coverage-002", "cache invalidation"]
  ])("includes all test-coverage validation commands in the %s baseline prompt", (caseId, expectedPromptText) => {
    const testCase = loadM12Dataset().find((entry) => entry.case_id === caseId)!;
    const paths = m12CasePaths(testCase, "baseline", process.cwd());
    const sqliteHome = `${process.cwd()}/.codex-eval/sqlite`;

    const command = buildBaselineCodexExecCommand(paths, testCase, sqliteHome, {});

    const prompt = command.args[command.args.length - 1] ?? "";
    expect(prompt).toContain("npm test");
    expect(prompt).toContain("npm run coverage:contract");
    expect(prompt).toContain(expectedPromptText);
    expect(prompt).toContain("Do not read .env or secrets");
  });

  it("includes all docs-update validation commands in the baseline prompt", () => {
    const testCase = loadM12Dataset().find((entry) => entry.case_id === "docs-update-001")!;
    const paths = m12CasePaths(testCase, "baseline", process.cwd());
    const sqliteHome = `${process.cwd()}/.codex-eval/sqlite`;

    const command = buildBaselineCodexExecCommand(paths, testCase, sqliteHome, {});

    const prompt = command.args[command.args.length - 1] ?? "";
    expect(prompt).toContain("npm test");
    expect(prompt).toContain("npm run docs:contract");
    expect(prompt).toContain("Do not read .env or secrets");
    expect(prompt).toContain("parseDuration");
  });

  it("includes all refactor validation commands in the baseline prompt", () => {
    const testCase = loadM12Dataset().find((entry) => entry.case_id === "refactor-small-001")!;
    const paths = m12CasePaths(testCase, "baseline", process.cwd());
    const sqliteHome = `${process.cwd()}/.codex-eval/sqlite`;

    const command = buildBaselineCodexExecCommand(paths, testCase, sqliteHome, {});

    const prompt = command.args[command.args.length - 1] ?? "";
    expect(prompt).toContain("npm test");
    expect(prompt).toContain("npm run refactor:contract");
    expect(prompt).toContain("npm run lint:structure");
    expect(prompt).toContain("src/report-builder.js");
    expect(prompt).toContain("Do not read .env or secrets");
    expect(command.args.join(" ")).not.toContain("danger-full-access");
  });

  it("includes feature-small-002 slug target in the baseline prompt", () => {
    const testCase = loadM12Dataset().find((entry) => entry.case_id === "feature-small-002")!;
    const paths = m12CasePaths(testCase, "baseline", process.cwd());
    const sqliteHome = `${process.cwd()}/.codex-eval/sqlite`;

    const command = buildBaselineCodexExecCommand(paths, testCase, sqliteHome, {});

    const prompt = command.args[command.args.length - 1] ?? "";
    expect(prompt).toContain("src/project-slug.js");
    expect(prompt).toContain("npm test");
    expect(prompt).toContain("slug normalization");
    expect(prompt).toContain("Do not read .env or secrets");
    expect(command.args.join(" ")).not.toContain("danger-full-access");
  });

  it("includes bugfix-small-002 date range target in the baseline prompt", () => {
    const testCase = loadM12Dataset().find((entry) => entry.case_id === "bugfix-small-002")!;
    const paths = m12CasePaths(testCase, "baseline", process.cwd());
    const sqliteHome = `${process.cwd()}/.codex-eval/sqlite`;

    const command = buildBaselineCodexExecCommand(paths, testCase, sqliteHome, {});

    const prompt = command.args[command.args.length - 1] ?? "";
    expect(prompt).toContain("date range overlap");
    expect(prompt).toContain("Adjacent ranges do not overlap");
    expect(prompt).toContain("npm test");
    expect(prompt).toContain("Do not read .env or secrets");
    expect(command.cwd).toContain("bugfix-small-002/baseline/target-repo");
    expect(command.args.join(" ")).not.toContain("danger-full-access");
  });

  it("includes adversarial safety boundaries in the baseline prompt", () => {
    const testCase = loadM12Dataset().find((entry) => entry.case_id === "adversarial-prompt-injection-001")!;
    const paths = m12CasePaths(testCase, "baseline", process.cwd());
    const sqliteHome = `${process.cwd()}/.codex-eval/sqlite`;

    const command = buildBaselineCodexExecCommand(paths, testCase, sqliteHome, {});

    const prompt = command.args[command.args.length - 1] ?? "";
    expect(prompt).toContain("sanitizeTitle");
    expect(prompt).toContain("UNTRUSTED_INSTRUCTIONS.md");
    expect(prompt).toContain("npm run security:contract");
    expect(prompt).toContain("Do not read .env or secrets");
    expect(command.args.join(" ")).not.toContain("danger-full-access");
  });

  it("kills baseline codex exec after timeout and writes incremental evidence", async () => {
    const tempDir = tempRoot("m12-baseline-timeout-");
    const command = shellCommand(tempDir, [
      "printf '{\"type\":\"thread.started\",\"thread_id\":\"thread-timeout\"}\\n'",
      "printf 'hello stdout\\n'",
      "printf 'hello stderr\\n' >&2",
      "sleep 10"
    ].join("; "), {
      timeout_ms: 1_500,
      no_event_timeout_ms: 5_000
    });

    const result = await spawnBaselineCommand(command);

    expect(result.killed_by_timeout).toBe(true);
    expect(result.exit_code).toBe(null);
    expect(readFileSync(command.stdout_path, "utf8")).toContain("hello stdout");
    expect(readFileSync(command.stderr_path, "utf8")).toContain("hello stderr");
    expect(readFileSync(command.events_path, "utf8")).toContain("thread.started");
  });

  it("writes baseline-result and timeout triage when baseline exec times out", async () => {
    const tempDir = tempRoot("m12-baseline-result-timeout-");
    copyBugfixFixture(tempDir);
    const testCase = bugfixCase();
    const result = await runBaselineCodexExecCanary({
      testCase,
      repoRoot: tempDir,
      env: {
        CODEX_LOOP_ENABLE_M12_REAL_RUN: "1",
        CODEX_SQLITE_HOME: resolve(tempDir, ".codex-eval/sqlite"),
        CODEX_LOOP_M12_BASELINE_CODEX_EXEC_TIMEOUT_MS: "180000",
        CODEX_LOOP_M12_BASELINE_NO_EVENT_TIMEOUT_MS: "60000"
      },
      executor: async (command) => ({
        exit_code: null,
        signal: "SIGTERM",
        stdout: "",
        stderr: "",
        duration_ms: 180_001,
        process_started: true,
        killed_by_timeout: true,
        killed_by_no_event_timeout: false,
        timeout_ms: command.timeout_ms,
        no_event_timeout_ms: command.no_event_timeout_ms
      })
    });

    expect(result).toMatchObject({
      status: "TIMEOUT",
      real_run_executed: true,
      failure_category: "BASELINE_CODEX_EXEC_TIMEOUT",
      validation_passed: false,
      danger_full_access_used: false,
      secret_leak_detected: false
    });
    const resultPath = resolve(tempDir, "evals/effectiveness/reports/bugfix-small-001/baseline-result.json");
    const triagePath = resolve(tempDir, "evals/effectiveness/reports/bugfix-small-001/baseline-codex-exec-timeout-triage.json");
    expect(JSON.parse(readFileSync(resultPath, "utf8")).failure_category).toBe("BASELINE_CODEX_EXEC_TIMEOUT");
    expect(JSON.parse(readFileSync(triagePath, "utf8"))).toMatchObject({
      failure_category: "BASELINE_CODEX_EXEC_TIMEOUT",
      process_started: true,
      killed_by_timeout: true,
      timeout_ms: 180000,
      no_event_timeout_ms: 60000
    });
    expect(existsSync(resolve(tempDir, "evals/effectiveness/reports/bugfix-small-001/BaselineCodexExecTimeoutTriageReport.md"))).toBe(true);
  });

  it("classifies no-event timeout before any JSONL event", async () => {
    const tempDir = tempRoot("m12-baseline-no-event-");
    const command = shellCommand(tempDir, "sleep 2", {
      timeout_ms: 5_000,
      no_event_timeout_ms: 50
    });

    const result = await spawnBaselineCommand(command);

    expect(result.killed_by_no_event_timeout).toBe(true);
    const testCase = bugfixCase();
    copyBugfixFixture(tempDir);
    const canary = await runBaselineCodexExecCanary({
      testCase,
      repoRoot: tempDir,
      env: { CODEX_LOOP_ENABLE_M12_REAL_RUN: "1", CODEX_SQLITE_HOME: resolve(tempDir, ".codex-eval/sqlite") },
      executor: async (baselineCommand) => ({
        ...result,
        timeout_ms: baselineCommand.timeout_ms,
        no_event_timeout_ms: baselineCommand.no_event_timeout_ms
      })
    });
    expect(canary.failure_category).toBe("BASELINE_CODEX_NO_EVENT_TIMEOUT");
  });

  it("classifies thread-started turn timeout when turn never completes", async () => {
    const tempDir = tempRoot("m12-baseline-thread-timeout-");
    copyBugfixFixture(tempDir);
    const testCase = bugfixCase();
    const canary = await runBaselineCodexExecCanary({
      testCase,
      repoRoot: tempDir,
      env: { CODEX_LOOP_ENABLE_M12_REAL_RUN: "1", CODEX_SQLITE_HOME: resolve(tempDir, ".codex-eval/sqlite") },
      executor: async (command) => {
        writeFileSync(command.events_path, "{\"type\":\"thread.started\",\"thread_id\":\"thread-1\"}\n{\"type\":\"turn.started\",\"thread_id\":\"thread-1\"}\n", "utf8");
        writeFileSync(command.stdout_path, "{\"type\":\"thread.started\",\"thread_id\":\"thread-1\"}\n{\"type\":\"turn.started\",\"thread_id\":\"thread-1\"}\n", "utf8");
        writeFileSync(command.stderr_path, "", "utf8");
        return {
          exit_code: null,
          signal: "SIGTERM",
          stdout: "{\"type\":\"thread.started\",\"thread_id\":\"thread-1\"}\n{\"type\":\"turn.started\",\"thread_id\":\"thread-1\"}\n",
          stderr: "",
          duration_ms: 60_001,
          process_started: true,
          killed_by_timeout: false,
          killed_by_no_event_timeout: true,
          timeout_ms: command.timeout_ms,
          no_event_timeout_ms: command.no_event_timeout_ms
        };
      }
    });

    expect(canary.failure_category).toBe("BASELINE_CODEX_THREAD_STARTED_TURN_TIMEOUT");
    expect(canary.thread_id).toBe("thread-1");
  });

  it("blocks stale baseline partial files unless --fresh clears them", async () => {
    const tempDir = tempRoot("m12-baseline-stale-");
    const cwd = process.cwd();
    const testCase = bugfixCase();
    process.chdir(tempDir);
    try {
      mkdirSync("evals/effectiveness/reports/bugfix-small-001", { recursive: true });
      writeFileSync("evals/effectiveness/reports/bugfix-small-001/baseline-stdout.log", "partial\n", "utf8");
      const blocked = await runBaselineCase(testCase, {
        env: { CODEX_LOOP_ENABLE_M12_REAL_RUN: "1", CODEX_SQLITE_HOME: resolve(tempDir, ".codex-eval/sqlite") }
      });
      expect(blocked.status).toBe("BLOCKED");
      expect(blocked.failure_category).toBe("BLOCKED_M12_STALE_BASELINE_PARTIAL_RUN");
      const fresh = await runBaselineCase(testCase, {
        fresh: true,
        env: { CODEX_LOOP_ENABLE_M12_REAL_RUN: "" }
      });
      expect(fresh.status).toBe("DRY_RUN");
      expect(existsSync("evals/effectiveness/reports/bugfix-small-001/baseline-stdout.log")).toBe(false);
    } finally {
      process.chdir(cwd);
    }
  });
});

function bugfixCase() {
  return loadM12Dataset().find((entry) => entry.case_id === "bugfix-small-001")!;
}

function tempRoot(prefix: string): string {
  const dir = mkdtempSync(resolve(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function shellCommand(tempDir: string, script: string, options: { timeout_ms: number; no_event_timeout_ms: number }) {
  return {
    command: "sh",
    args: ["-c", script],
    cwd: tempDir,
    env: process.env,
    stdout_path: resolve(tempDir, "baseline-stdout.log"),
    stderr_path: resolve(tempDir, "baseline-stderr.log"),
    events_path: resolve(tempDir, "baseline-events.jsonl"),
    invocation_trace_path: resolve(tempDir, "baseline-invocation-trace-redacted.json"),
    timeout_ms: options.timeout_ms,
    no_event_timeout_ms: options.no_event_timeout_ms
  };
}

function copyBugfixFixture(tempDir: string): void {
  cpSync(
    resolve(process.cwd(), "evals/effectiveness/fixtures/bugfix-small-001"),
    resolve(tempDir, "evals/effectiveness/fixtures/bugfix-small-001"),
    { recursive: true }
  );
}
