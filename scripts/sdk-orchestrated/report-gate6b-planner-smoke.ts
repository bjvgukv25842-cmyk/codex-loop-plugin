import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const repoRoot = process.cwd();
const reportDir = resolve(repoRoot, "evals/sdk-orchestrated/reports/sdk-startup-triage");
const resultPath = resolve(reportDir, "planner-smoke-result.json");
const verifyPath = resolve(reportDir, "planner-smoke-verify.json");
const reportPath = resolve(reportDir, "PlannerSmokeReport.md");
const triagePath = resolve(reportDir, "planner-timeout-triage.json");
const triageReportPath = resolve(reportDir, "PlannerTimeoutTriageReport.md");

function main(): void {
  const result = readJson(resultPath);
  const verify = readJson(verifyPath);
  const triageSource = result.status === "BLOCKED_SDK_PLANNER_NOT_ENABLED" ? readJson(resolve(reportDir, "planner-smoke-minimal-result.json")) : result;
  const triage = buildTriage(Object.keys(triageSource).length > 0 ? triageSource : result);
  const lines = [
    "# Gate 6B.1E Planner Smoke Report",
    "",
    "Date: 2026-06-20",
    "",
    `Mode: ${String(result.mode ?? "minimal")}`,
    `Run status: ${String(result.status ?? "NOT_RUN")}`,
    `Verify status: ${String(verify.status ?? "NOT_RUN")}`,
    `Real SDK run attempted: ${String(result.real_sdk_run_attempted === true)}`,
    `Planner thread started: ${String(result.planner_thread_started === true)}`,
    `Planner thread id: ${String(result.planner_thread_id ?? "")}`,
    `Failure category: ${String(result.failure_category ?? "")}`,
    `Planner stage shared: ${String(result.planner_stage_shared === true)}`,
    `Planner stage impl: ${String(result.planner_stage_impl ?? "")}`,
    `TaskGraph schema valid: ${String(result.task_graph_schema_valid === true)}`,
    `Ready for Gate 6B smoke: ${String(verify.ready_for_gate6b_smoke === true)}`,
    "M12 blocked: true",
    "",
    "Planner smoke slices must pass in order: parity-as-planner, minimal, schema-text-only, schema-output-minimal, schema-output-lite. schema-output-planner is diagnostic only. The three-thread Gate 6B.1 smoke remains blocked until all required planner slices pass.",
    ""
  ];
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${lines.join("\n")}\n`, "utf8");
  writeFileSync(triagePath, `${JSON.stringify(triage, null, 2)}\n`, "utf8");
  writeFileSync(triageReportPath, renderTriageReport(triage), "utf8");
}

function readJson(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

function buildTriage(planner: Record<string, unknown>): Record<string, unknown> {
  const mode = String(planner.mode ?? "minimal");
  const eventsPath = resolve(reportDir, `planner-smoke-${mode}-events.jsonl`);
  const stderrPath = resolve(reportDir, `planner-smoke-${mode}-stderr.log`);
  const stdoutPath = resolve(reportDir, `planner-smoke-${mode}-stdout.log`);
  const events = readJsonl(eventsPath);
  const parity = readJson(resolve(reportDir, "sdk-parity-smoke-result.json"));
  const diff = readJson(resolve(reportDir, "sdk-invocation-diff.json"));
  const threadId = detectThreadId(events) || stringField(planner.planner_thread_id);
  const criticalDiffs = criticalDiffFields(diff);
  return {
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
        return {};
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
  const errors = Array.isArray(planner.errors) ? planner.errors.join("\n") : "";
  const status = stringField(planner.status);
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

function renderTriageReport(triage: Record<string, unknown>): string {
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
