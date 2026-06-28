import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  appendSqliteHomeConfig,
  classifyReadonlyDatabase,
  ensureEvalSqliteHome,
  resolveEvalSqliteHome,
  withEvalSqliteEnv
} from "../../src/runtime/eval-sqlite-home.ts";
import { execWithBudget } from "../../src/runtime/exec-with-budget.ts";

describe("execWithBudget", () => {
  it("captures JSONL stdout, stderr, and structured success", async () => {
    const dir = mkdtempSync(join(tmpdir(), "codex-loop-budget-"));
    const stdoutPath = join(dir, "events.jsonl");
    const stderrPath = join(dir, "stderr.log");

    const result = await execWithBudget({
      command: process.execPath,
      args: ["-e", "console.log(JSON.stringify({ type: 'thread.started' })); console.error('warn');"],
      cwd: dir,
      stdout_path: stdoutPath,
      stderr_path: stderrPath,
      budget: {
        single_codex_exec_budget_ms: 5_000,
        no_event_timeout_ms: 2_000
      }
    });

    expect(result.status).toBe("PASS");
    expect(result.event_count).toBe(1);
    expect(result.last_event_type).toBe("thread.started");
    expect(readFileSync(stdoutPath, "utf8")).toContain("thread.started");
    expect(readFileSync(stderrPath, "utf8")).toContain("warn");
  });

  it("terminates when no JSONL event arrives within the no-event budget", async () => {
    const dir = mkdtempSync(join(tmpdir(), "codex-loop-budget-"));
    const stdoutPath = join(dir, "events.jsonl");
    const stderrPath = join(dir, "stderr.log");

    const result = await execWithBudget({
      command: process.execPath,
      args: ["-e", "setTimeout(() => {}, 5000);"],
      cwd: dir,
      stdout_path: stdoutPath,
      stderr_path: stderrPath,
      budget: {
        single_codex_exec_budget_ms: 5_000,
        no_event_timeout_ms: 100
      }
    });

    expect(result.status).toBe("NO_EVENT_TIMEOUT");
    expect(result.event_count).toBe(0);
    expect(existsSync(stdoutPath)).toBe(true);
    expect(existsSync(stderrPath)).toBe(true);
  });

  it("prepares isolated project sqlite home without overriding CODEX_HOME", () => {
    const dir = mkdtempSync(join(tmpdir(), "codex-loop-sqlite-"));
    const home = resolveEvalSqliteHome(dir, {});
    const check = ensureEvalSqliteHome(dir, {});
    const env = withEvalSqliteEnv({ CODEX_HOME: "/keep/codex-home" }, check.path);
    const args = appendSqliteHomeConfig(["exec", "--json"], check.path);

    expect(home.path).toBe(resolve(dir, ".codex-eval/sqlite"));
    expect(check.ok).toBe(true);
    expect(existsSync(resolve(dir, ".codex-eval/sqlite"))).toBe(true);
    expect(env.CODEX_HOME).toBe("/keep/codex-home");
    expect(env.CODEX_SQLITE_HOME).toBe(resolve(dir, ".codex-eval/sqlite"));
    expect(args).toEqual(["exec", "-c", `sqlite_home="${resolve(dir, ".codex-eval/sqlite")}"`, "--json"]);
  });

  it("classifies readonly database stderr separately from empty JSONL output", () => {
    expect(classifyReadonlyDatabase("attempt to write a readonly database")).toBe("CODEX_LOCAL_STATE_DB_READONLY");
    expect(classifyReadonlyDatabase("")).toBeNull();
  });

  it("blocks advanced CODEX_LOOP_EVAL_CODEX_HOME when the directory is missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "codex-loop-sqlite-"));
    const missing = resolve(dir, "missing-home");
    const check = ensureEvalSqliteHome(dir, { CODEX_LOOP_EVAL_CODEX_HOME: missing });

    expect(check.ok).toBe(false);
    expect(check.reason).toBe("CODEX_LOOP_EVAL_CODEX_HOME_NOT_FOUND");
  });

  it("blocks an existing readonly state db inside eval sqlite home", () => {
    const dir = mkdtempSync(join(tmpdir(), "codex-loop-sqlite-"));
    const sqliteHome = resolve(dir, ".codex-eval/sqlite");
    ensureEvalSqliteHome(dir, {});
    const stateDb = join(sqliteHome, "state_5.sqlite");
    writeFileSync(stateDb, "", { mode: 0o444 });
    try {
      const check = ensureEvalSqliteHome(dir, {});
      expect(check.ok).toBe(false);
      expect(check.reason).toBe("CODEX_LOCAL_STATE_DB_READONLY");
    } finally {
      try {
        writeFileSync(stateDb, "", { mode: 0o644 });
      } catch {
        // Best-effort cleanup for platforms that ignore file mode changes.
      }
    }
  });
});
