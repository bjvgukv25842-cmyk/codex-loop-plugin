import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const repoRoot = process.cwd();
const reportDir = resolve(repoRoot, "evals/sdk-orchestrated/reports/sdk-startup-triage");
const triagePath = resolve(reportDir, "planner-timeout-triage.json");
const reportPath = resolve(reportDir, "PlannerTimeoutTriageReport.md");

function main(): void {
  const planner = readJson(resolve(reportDir, "planner-smoke-result.json"));
  const parity = readJson(resolve(reportDir, "sdk-parity-smoke-result.json"));
  const diff = readJson(resolve(reportDir, "sdk-invocation-diff.json"));
  const eventsPath = resolve(reportDir, `planner-smoke-${String(planner.mode ?? "minimal")}-events.jsonl`);
  const stderrPath = resolve(reportDir, `planner-smoke-${String(planner.mode ?? "minimal")}-stderr.log`);
  const stdoutPath = resolve(reportDir, `planner-smoke-${String(planner.mode ?? "minimal")}-stdout.log`);
  const events = readJsonl(eventsPath);
  const threadId = detectThreadId(events) || stringField(planner.planner_thread_id);
  const criticalDiffs = criticalDiffFields(diff);
  const triage = {
    sdk_parity_status: stringField(parity.status),
    planner_minimal_status: stringField(planner.status),
    planner_timeout_ms: 180000,
    planner_thread_started_detected: Boolean(threadId),
    planner_thread_id_detected: threadId,
    planner_events_path_exists: existsSync(eventsPath),
    planner_event_count: events.length,
    planner_stderr_exists: existsSync(stderrPath),
    planner_stderr_excerpt: excerpt(stderrPath),
    planner_stdout_exists: existsSync(stdoutPath),
    planner_stdout_excerpt: excerpt(stdoutPath),
    invocation_diff_detected: Array.isArray(diff.differences) && diff.differences.length > 0,
    critical_diffs: criticalDiffs,
    diagnosed_failure_category: diagnose(planner, events, criticalDiffs)
  };
  mkdirSync(dirname(triagePath), { recursive: true });
  writeFileSync(triagePath, `${JSON.stringify(triage, null, 2)}\n`, "utf8");
  writeFileSync(reportPath, renderReport(triage), "utf8");
  process.stdout.write(`${JSON.stringify(triage, null, 2)}\n`);
}

function readJson(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function readJsonl(path: string): unknown[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as unknown;
      } catch {
        return { parse_error: true };
      }
    });
}

function detectThreadId(events: unknown[]): string {
  for (const event of events) {
    if (isRecord(event) && event.type === "thread.started" && typeof event.thread_id === "string") {
      return event.thread_id;
    }
  }
  return "";
}

function criticalDiffFields(diff: Record<string, unknown>): string[] {
  const differences = Array.isArray(diff.differences) ? diff.differences : [];
  const critical = new Set(["workingDirectory", "skipGitRepoCheck", "sandboxMode", "model", "model_catalog_json", "sqlite_home", "CODEX_SQLITE_HOME", "prompt_length", "prompt_hash", "usesOutputSchema", "sdk_api_method", "config_keys", "env_keys", "target_repo_git_status", "node_process_cwd"]);
  return differences
    .filter((entry): entry is Record<string, unknown> => isRecord(entry) && typeof entry.field === "string" && critical.has(entry.field))
    .map((entry) => String(entry.field));
}

function diagnose(planner: Record<string, unknown>, events: unknown[], criticalDiffs: string[]): string {
  const failure = stringField(planner.failure_category);
  const status = stringField(planner.status);
  const errors = Array.isArray(planner.errors) ? planner.errors.join("\n") : "";
  if (/exceeded timeout_ms/i.test(errors) || status.includes("TIMEOUT")) {
    return detectThreadId(events) || stringField(planner.planner_thread_id) ? "SDK_PLANNER_TURN_TIMEOUT" : "SDK_PLANNER_THREAD_STARTUP_TIMEOUT";
  }
  if (failure) return failure;
  if (status.includes("TIMEOUT") && events.length === 0) return "SDK_PLANNER_THREAD_STARTUP_TIMEOUT";
  if (status.includes("TIMEOUT") && detectThreadId(events)) return "SDK_PLANNER_TURN_TIMEOUT";
  if (criticalDiffs.length > 0) return "SDK_INVOCATION_DIFF_DETECTED";
  return status || "UNKNOWN";
}

function excerpt(path: string): string {
  if (!existsSync(path)) return "";
  return readFileSync(path, "utf8").slice(0, 1200);
}

function renderReport(triage: Record<string, unknown>): string {
  return [
    "# Gate 6B.1F Planner Timeout Triage Report",
    "",
    "Date: 2026-06-20",
    "",
    `SDK parity status: ${String(triage.sdk_parity_status)}`,
    `Planner minimal status: ${String(triage.planner_minimal_status)}`,
    `Planner thread started detected: ${String(triage.planner_thread_started_detected)}`,
    `Planner thread id detected: ${String(triage.planner_thread_id_detected)}`,
    `Planner event count: ${String(triage.planner_event_count)}`,
    `Invocation diff detected: ${String(triage.invocation_diff_detected)}`,
    `Critical diffs: ${JSON.stringify(triage.critical_diffs)}`,
    `Diagnosed failure category: ${String(triage.diagnosed_failure_category)}`,
    "M12 blocked: true",
    ""
  ].join("\n");
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

main();
