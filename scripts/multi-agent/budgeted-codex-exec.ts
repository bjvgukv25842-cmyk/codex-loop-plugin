import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { appendSqliteHomeConfig, ensureEvalSqliteHome, withEvalSqliteEnv } from "../../src/runtime/eval-sqlite-home.ts";
import { execWithBudget } from "../../src/runtime/exec-with-budget.ts";
import { DEFAULT_GATE6_LITE_TIME_BUDGET } from "../../src/runtime/time-budget.ts";

interface RequestFile {
  cwd: string;
  args: string[];
  stdout_path: string;
  stderr_path: string;
  env?: Record<string, string>;
}

async function main(): Promise<void> {
  const requestPath = process.argv[2];
  const resultPath = process.argv[3];
  if (!requestPath || !resultPath) {
    console.error("Usage: node scripts/multi-agent/budgeted-codex-exec.ts <request.json> <result.json>");
    process.exitCode = 2;
    return;
  }

  const request = readRequest(resolve(requestPath));
  const sqliteHome = ensureEvalSqliteHome(process.cwd());
  if (!sqliteHome.ok) {
    const blockedResult = {
      status: "BLOCKED",
      duration_ms: 0,
      exit_code: null,
      signal: null,
      stdout_path: resolve(request.stdout_path),
      stderr_path: resolve(request.stderr_path),
      event_count: 0,
      last_event_type: "",
      failure_category: sqliteHome.reason,
      isolated_sqlite_home: sqliteHome.path
    };
    mkdirSync(dirname(resolve(resultPath)), { recursive: true });
    writeFileSync(resolve(resultPath), `${JSON.stringify(blockedResult, null, 2)}\n`, "utf8");
    process.exitCode = 2;
    return;
  }
  const result = await execWithBudget({
    command: "codex",
    args: appendSqliteHomeConfig(request.args, sqliteHome.path),
    cwd: request.cwd,
    stdout_path: resolve(request.stdout_path),
    stderr_path: resolve(request.stderr_path),
    env: {
      ...withEvalSqliteEnv(process.env, sqliteHome.path),
      ...request.env
    },
    budget: DEFAULT_GATE6_LITE_TIME_BUDGET
  });

  mkdirSync(dirname(resolve(resultPath)), { recursive: true });
  writeFileSync(resolve(resultPath), `${JSON.stringify(result, null, 2)}\n`, "utf8");
  process.exitCode = result.status === "PASS" ? 0 : 2;
}

function readRequest(path: string): RequestFile {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!isRecord(parsed)) {
    throw new Error("Budgeted exec request must be a JSON object.");
  }
  const cwd = readString(parsed, "cwd");
  const args = readStringArray(parsed, "args");
  const stdoutPath = readString(parsed, "stdout_path");
  const stderrPath = readString(parsed, "stderr_path");
  const env = isRecord(parsed.env) ? Object.fromEntries(Object.entries(parsed.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")) : undefined;
  if (!cwd || args.length === 0 || !stdoutPath || !stderrPath) {
    throw new Error("Budgeted exec request requires cwd, args, stdout_path, and stderr_path.");
  }
  if (args.some((arg) => /danger-full-access|dangerously-bypass/i.test(arg))) {
    throw new Error("Refusing to run codex exec with danger/bypass sandbox flags.");
  }
  return {
    cwd,
    args,
    stdout_path: stdoutPath,
    stderr_path: stderrPath,
    env
  };
}

function readString(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  return typeof value === "string" ? value : "";
}

function readStringArray(input: Record<string, unknown>, key: string): string[] {
  const value = input[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
});
