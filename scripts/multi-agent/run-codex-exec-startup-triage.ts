import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { appendSqliteHomeConfig, ensureEvalSqliteHome, withEvalSqliteEnv } from "../../src/runtime/eval-sqlite-home.ts";
import { execWithBudget, type BudgetedExecResult, type BudgetedExecStatus } from "../../src/runtime/exec-with-budget.ts";

type FailureCategory =
  | ""
  | "CODEX_LOCAL_STATE_DB_READONLY"
  | "CODEX_AUTH_REQUIRED"
  | "OUTPUT_SCHEMA_ERROR"
  | "GIT_REPO_REQUIRED"
  | "MCP_INIT_FAILED"
  | "SANDBOX_OR_PERMISSION_ERROR"
  | "NO_JSONL_EVENT"
  | "UNKNOWN_CODEX_EXEC_STARTUP_FAILURE";

interface SmokeResult {
  status: BudgetedExecStatus;
  duration_ms: number;
  thread_started: boolean;
  event_count: number;
  stderr_excerpt: string;
  failure_category: FailureCategory;
  exit_code?: number | null;
  signal?: NodeJS.Signals | null;
  command_redacted?: string;
  stdout_path?: string;
  stderr_path?: string;
  events_path?: string;
  final_output_path?: string;
  output_schema_path?: string;
  output_schema_path_exists?: boolean;
}

type SchemaSmokeResult = Omit<SmokeResult, "status"> & {
  status: BudgetedExecStatus | "NOT_RUN";
};

const repoRoot = process.cwd();
const reportsDir = resolve(repoRoot, "evals/multi-agent/reports");
const schemasDir = resolve(repoRoot, "evals/multi-agent/schemas");
const targetRepo = resolve(repoRoot, "tmp/multi-agent/gate6-2-lite-repair-target");

const previousResultPath = join(reportsDir, "gate6-2-lite-result.json");
const previousReportPath = join(reportsDir, "Gate6_2_Lite_Report.md");
const previousStdoutPath = join(reportsDir, "gate6-2-lite-events.jsonl");
const previousJsonlPath = previousStdoutPath;
const previousStderrPath = join(reportsDir, "gate6-2-lite-stderr.log");
const previousCommandPath = join(reportsDir, "gate6-2-lite-command.txt");

const triageJsonPath = join(reportsDir, "gate6-2-lite-startup-triage.json");
const triageReportPath = join(reportsDir, "Gate6_2_Lite_Startup_Triage_Report.md");

const smokeEventsPath = join(reportsDir, "codex-exec-smoke-events.jsonl");
const smokeStdoutPath = join(reportsDir, "codex-exec-smoke-stdout.log");
const smokeStderrPath = join(reportsDir, "codex-exec-smoke-stderr.log");
const smokeResultPath = join(reportsDir, "codex-exec-smoke-result.json");

const schemaPath = join(schemasDir, "codex-exec-smoke.schema.json");
const schemaEventsPath = join(reportsDir, "codex-exec-schema-smoke-events.jsonl");
const schemaStderrPath = join(reportsDir, "codex-exec-schema-smoke-stderr.log");
const schemaOutputPath = join(reportsDir, "codex-exec-smoke-output.json");
const schemaResultPath = join(reportsDir, "codex-exec-schema-smoke-result.json");

const doctorOutputPath = join(reportsDir, "codex-doctor-output.log");

async function main(): Promise<void> {
  mkdirSync(reportsDir, { recursive: true });
  mkdirSync(schemasDir, { recursive: true });

  const sqliteHome = ensureEvalSqliteHome(repoRoot);
  const previous = collectPreviousEvidence(sqliteHome.ok ? sqliteHome.path : "");
  writeJson(triageJsonPath, previous);

  let smokeResult: SmokeResult = {
    status: "BLOCKED",
    duration_ms: 0,
    thread_started: false,
    event_count: 0,
    stderr_excerpt: "",
    failure_category: sqliteHome.ok ? "" : "UNKNOWN_CODEX_EXEC_STARTUP_FAILURE"
  };
  let schemaSmokeResult: SchemaSmokeResult = {
    status: "NOT_RUN",
    duration_ms: 0,
    thread_started: false,
    event_count: 0,
    stderr_excerpt: "",
    failure_category: ""
  };
  let doctorRun = false;
  let doctorStatus = "NOT_RUN";

  if (!sqliteHome.ok) {
    smokeResult = {
      status: "BLOCKED",
      duration_ms: 0,
      thread_started: false,
      event_count: 0,
      stderr_excerpt: sqliteHome.reason ?? "",
      failure_category: sqliteHome.reason === "CODEX_LOCAL_STATE_DB_READONLY" ? "CODEX_LOCAL_STATE_DB_READONLY" : "UNKNOWN_CODEX_EXEC_STARTUP_FAILURE"
    };
  } else {
    smokeResult = await runReadOnlySmoke(sqliteHome.path);
  }
  writeJson(smokeResultPath, smokeResult);

  if (smokeResult.status === "PASS" && smokeResult.thread_started) {
    schemaSmokeResult = await runSchemaSmoke(sqliteHome.ok ? sqliteHome.path : "");
    writeJson(schemaResultPath, schemaSmokeResult);
  } else {
    const doctor = runCodexDoctor();
    doctorRun = true;
    doctorStatus = doctor.status;
  }

  const triage = {
    ...previous,
    minimal_codex_exec_smoke: smokeResult,
    schema_codex_exec_smoke: schemaSmokeResult,
    doctor_run: doctorRun,
    doctor_status: doctorStatus,
    final_diagnosis: finalDiagnosis(smokeResult, schemaSmokeResult),
    m12_blocked: true
  };
  writeJson(triageJsonPath, triage);
  writeReport(triage, sqliteHome.ok ? sqliteHome.path : String(previous.codex_sqlite_home ?? ""));
}

function collectPreviousEvidence(sqliteHomePath: string): Record<string, unknown> {
  const result = readJsonObject(previousResultPath);
  const command = readText(previousCommandPath);
  const stderr = readText(previousStderrPath);
  const stdoutStats = fileStats(previousStdoutPath);
  const stderrStats = fileStats(previousStderrPath);
  const jsonlStats = fileStats(previousJsonlPath);
  const sqliteOverride = parseSqliteHomeOverride(command);
  return {
    previous_result_status: readString(result, "status"),
    previous_failure_category: readString(result, "failure_category"),
    previous_duration_ms: readNestedNumber(result, ["runtime_budget", "duration_ms"]),
    stdout_exists: stdoutStats.exists,
    stdout_bytes: stdoutStats.bytes,
    stderr_exists: stderrStats.exists,
    stderr_bytes: stderrStats.bytes,
    stderr_excerpt: excerpt(stderr),
    jsonl_exists: jsonlStats.exists,
    jsonl_bytes: jsonlStats.bytes,
    actual_codex_command_redacted: redact(command.trim()),
    cwd: targetRepo,
    codex_sqlite_home: sqliteHomePath || resolve(repoRoot, ".codex-eval/sqlite"),
    sqlite_home_config_override: sqliteOverride,
    output_schema_path_exists: command.includes("--output-schema") ? outputSchemaPathExists(command) : false,
    target_repo_is_git_repo: existsSync(join(targetRepo, ".git")),
    mcp_required_servers: command.includes("mcp_servers.codex_loop_store") ? ["codex_loop_store"] : [],
    diagnosed_failure_category: classifyFailure(stderr, jsonlStats.bytes)
  };
}

async function runReadOnlySmoke(sqliteHomePath: string): Promise<SmokeResult> {
  const args = appendSqliteHomeConfig([
    "exec",
    "--json",
    "--sandbox",
    "read-only",
    "-C",
    repoRoot,
    "Respond with exactly: CODEX_EXEC_SMOKE_OK"
  ], sqliteHomePath);
  const result = await execWithBudget({
    command: "codex",
    args,
    cwd: repoRoot,
    stdout_path: smokeEventsPath,
    stderr_path: smokeStderrPath,
    env: withEvalSqliteEnv(process.env, sqliteHomePath),
    budget: {
      single_codex_exec_budget_ms: 60_000,
      no_event_timeout_ms: 30_000,
      max_codex_exec_runs: 1,
      max_retries: 0,
      allow_full_gate6_run: false
    }
  });
  copyIfExists(smokeEventsPath, smokeStdoutPath);
  return normalizeSmokeResult(result, smokeEventsPath, smokeStderrPath, `codex ${args.map(shellQuote).join(" ")}`);
}

async function runSchemaSmoke(sqliteHomePath: string): Promise<SmokeResult> {
  writeJson(schemaPath, {
    type: "object",
    properties: {
      status: { type: "string", enum: ["PASS"] },
      message: { type: "string" }
    },
    required: ["status", "message"],
    additionalProperties: false
  });
  const args = appendSqliteHomeConfig([
    "exec",
    "--json",
    "--sandbox",
    "read-only",
    "--output-schema",
    schemaPath,
    "-o",
    schemaOutputPath,
    "-C",
    repoRoot,
    "Return JSON with status PASS and message CODEX_EXEC_SCHEMA_SMOKE_OK."
  ], sqliteHomePath);
  const result = await execWithBudget({
    command: "codex",
    args,
    cwd: repoRoot,
    stdout_path: schemaEventsPath,
    stderr_path: schemaStderrPath,
    env: withEvalSqliteEnv(process.env, sqliteHomePath),
    budget: {
      single_codex_exec_budget_ms: 60_000,
      no_event_timeout_ms: 30_000,
      max_codex_exec_runs: 1,
      max_retries: 0,
      allow_full_gate6_run: false
    }
  });
  return {
    ...normalizeSmokeResult(result, schemaEventsPath, schemaStderrPath, `codex ${args.map(shellQuote).join(" ")}`),
    final_output_path: schemaOutputPath,
    output_schema_path: schemaPath,
    output_schema_path_exists: existsSync(schemaPath)
  };
}

function normalizeSmokeResult(result: BudgetedExecResult, eventsPath: string, stderrPath: string, command: string): SmokeResult {
  const stderr = readText(stderrPath);
  const threadStarted = hasThreadStarted(eventsPath);
  const failure = classifyFailure(stderr, fileStats(eventsPath).bytes, result.status);
  const status = result.status === "PASS" && threadStarted ? "PASS" : result.status;
  return {
    status,
    duration_ms: result.duration_ms,
    thread_started: threadStarted,
    event_count: result.event_count,
    stderr_excerpt: excerpt(stderr),
    failure_category: status === "PASS" ? "" : failure,
    exit_code: result.exit_code,
    signal: result.signal,
    command_redacted: redact(command),
    stdout_path: eventsPath,
    stderr_path: stderrPath,
    events_path: eventsPath
  };
}

function runCodexDoctor(): { status: string } {
  const result = spawnSync("codex", ["doctor"], {
    cwd: repoRoot,
    encoding: "utf8",
    env: process.env
  });
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  const text = [`exit_code=${result.status ?? "null"}`, stdout, stderr].filter(Boolean).join("\n");
  writeText(doctorOutputPath, redact(text));
  if (result.error && (result.error as NodeJS.ErrnoException).code === "ENOENT") {
    return { status: "DOCTOR_UNAVAILABLE" };
  }
  if (result.status === 0) {
    return { status: "PASS" };
  }
  return { status: "FAIL" };
}

function finalDiagnosis(smoke: SmokeResult, schemaSmoke: SchemaSmokeResult): string {
  if (smoke.status !== "PASS") {
    return smoke.failure_category || "UNKNOWN_CODEX_EXEC_STARTUP_FAILURE";
  }
  if (schemaSmoke.status !== "NOT_RUN" && schemaSmoke.status !== "PASS") {
    return schemaSmoke.failure_category || "OUTPUT_SCHEMA_ERROR";
  }
  return "CODEX_EXEC_STARTUP_OK";
}

function classifyFailure(stderr: string, jsonlBytes: number, status?: string): FailureCategory {
  if (/attempt to write a readonly database/i.test(stderr)) {
    return "CODEX_LOCAL_STATE_DB_READONLY";
  }
  if (/auth|login|token|credential/i.test(stderr)) {
    return "CODEX_AUTH_REQUIRED";
  }
  if (/schema/i.test(stderr)) {
    return "OUTPUT_SCHEMA_ERROR";
  }
  if (/git repo|git repository|not a git/i.test(stderr)) {
    return "GIT_REPO_REQUIRED";
  }
  if (/mcp/i.test(stderr)) {
    return "MCP_INIT_FAILED";
  }
  if (/permission|sandbox|operation not permitted/i.test(stderr)) {
    return "SANDBOX_OR_PERMISSION_ERROR";
  }
  if (!stderr.trim() && jsonlBytes === 0) {
    return status === "NO_EVENT_TIMEOUT" ? "NO_JSONL_EVENT" : "NO_JSONL_EVENT";
  }
  return "UNKNOWN_CODEX_EXEC_STARTUP_FAILURE";
}

function writeReport(triage: Record<string, unknown>, sqliteHomePath: string): void {
  const smoke = triage.minimal_codex_exec_smoke as SmokeResult;
  const schemaSmoke = triage.schema_codex_exec_smoke as SchemaSmokeResult;
  const lines = [
    "# Gate 6.2.2 Codex Exec Startup Triage",
    "",
    "Date: 2026-06-20",
    "",
    `Status: ${smoke.status === "PASS" && schemaSmoke.status === "PASS" ? "PASS" : "NEEDS_REVISION"}`,
    "",
    "This triage diagnoses why the isolated Gate 6.2-Lite repair continuation probe produced no JSONL events. It does not run full Gate 6, Gate 6.2-Lite, native multi-agent probes, or M12.",
    "",
    "## Previous Gate 6.2-Lite Evidence",
    "",
    `- Previous status: ${String(triage.previous_result_status ?? "")}`,
    `- Previous failure category: ${String(triage.previous_failure_category ?? "")}`,
    `- Previous duration: ${String(triage.previous_duration_ms ?? 0)} ms`,
    `- Previous stdout bytes: ${String(triage.stdout_bytes ?? 0)}`,
    `- Previous stderr bytes: ${String(triage.stderr_bytes ?? 0)}`,
    `- Previous JSONL bytes: ${String(triage.jsonl_bytes ?? 0)}`,
    `- Previous diagnosed category: ${String(triage.diagnosed_failure_category ?? "")}`,
    "",
    "## Isolated SQLite",
    "",
    `- SQLite home: \`${sqliteHomePath}\``,
    `- Config override: \`${String(triage.sqlite_home_config_override ?? "")}\``,
    "",
    "## Minimal Read-Only Smoke",
    "",
    `- Status: ${smoke.status}`,
    `- Thread started: ${String(smoke.thread_started)}`,
    `- Event count: ${String(smoke.event_count)}`,
    `- Duration: ${String(smoke.duration_ms)} ms`,
    `- Failure category: ${smoke.failure_category}`,
    "",
    "## Output Schema Smoke",
    "",
    `- Status: ${schemaSmoke.status}`,
    `- Thread started: ${String(schemaSmoke.thread_started)}`,
    `- Event count: ${String(schemaSmoke.event_count)}`,
    `- Failure category: ${schemaSmoke.failure_category}`,
    "",
    "## Doctor",
    "",
    `- Doctor run: ${String(triage.doctor_run)}`,
    `- Doctor status: ${String(triage.doctor_status)}`,
    "",
    "## Conclusion",
    "",
    `- Final diagnosis: ${String(triage.final_diagnosis)}`,
    "- M12 remains blocked.",
    "- This result does not prove native repair continuation failed, because Gate 6.2-Lite did not reach native dispatch.",
    ""
  ];
  writeText(triageReportPath, `${lines.join("\n")}\n`);
}

function hasThreadStarted(path: string): boolean {
  return readText(path)
    .split(/\r?\n/)
    .some((line) => {
      try {
        const parsed: unknown = JSON.parse(line);
        return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) && (parsed as Record<string, unknown>).type === "thread.started";
      } catch {
        return false;
      }
    });
}

function fileStats(path: string): { exists: boolean; bytes: number } {
  if (!existsSync(path)) {
    return { exists: false, bytes: 0 };
  }
  return { exists: true, bytes: statSync(path).size };
}

function parseSqliteHomeOverride(command: string): string {
  const match = command.match(/sqlite_home="([^"]+)"/);
  return match?.[1] ?? "";
}

function outputSchemaPathExists(command: string): boolean {
  const parts = command.split(/\s+/);
  const index = parts.indexOf("--output-schema");
  if (index < 0 || !parts[index + 1]) {
    return false;
  }
  return existsSync(parts[index + 1].replace(/^'|'$/g, ""));
}

function readJsonObject(path: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function readString(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  return typeof value === "string" ? value : "";
}

function readNestedNumber(input: Record<string, unknown>, keys: string[]): number {
  let current: unknown = input;
  for (const key of keys) {
    if (typeof current !== "object" || current === null || Array.isArray(current)) {
      return 0;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === "number" ? current : 0;
}

function readText(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

function writeJson(path: string, value: unknown): void {
  writeText(path, `${JSON.stringify(value, null, 2)}\n`);
}

function writeText(path: string, value: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value, "utf8");
}

function copyIfExists(source: string, target: string): void {
  if (existsSync(source)) {
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(source, target);
  }
}

function excerpt(value: string): string {
  return redact(value).slice(0, 2000);
}

function redact(value: string): string {
  return value
    .replace(/(sk-[A-Za-z0-9_-]{10,})/g, "[REDACTED_SECRET]")
    .replace(/([A-Za-z0-9_-]*(?:token|secret|api[_-]?key|credential)[A-Za-z0-9_-]*=)([^\\s'"]+)/gi, "$1[REDACTED]")
    .replace(/(Authorization:\\s*Bearer\\s+)([^\\s]+)/gi, "$1[REDACTED]");
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
});
