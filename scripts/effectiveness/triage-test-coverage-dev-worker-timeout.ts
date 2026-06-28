import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import type { M12RunResult } from "./types.ts";
import { readJson, writeJson, writeMarkdown } from "./io.ts";

export interface TestCoverageDevWorkerTimeoutTriage {
  case_id: "test-coverage-002";
  failure_category: "TEST_COVERAGE_002_DEV_WORKER_STARTUP_NO_EVENT_TIMEOUT" | "TEST_COVERAGE_002_DEV_WORKER_TURN_NO_EVENT_TIMEOUT";
  planner_thread_id_present: boolean;
  dev_worker_thread_started: boolean;
  dev_worker_thread_id: string;
  dev_worker_completed: boolean;
  event_count: number;
  last_event_type: string;
  elapsed_ms: number;
  dev_worker_events_path: string;
  dev_worker_stdout_path: string;
  dev_worker_stderr_path: string;
  dev_worker_raw_output_path: string;
  dev_worker_redacted_output_path: string;
  dev_worker_prompt_length: number;
  dev_worker_prompt_hash: string;
  test_coverage_001_dev_worker_prompt_hash: string;
  target_repo: string;
  target_repo_is_git: boolean;
  working_directory: string;
  validation_commands: ["npm test", "npm run coverage:contract"];
  critical_diffs: string[];
  recommended_fixes: string[];
}

const reportDir = "evals/effectiveness/reports/test-coverage-002";
const stageLogDir = `${reportDir}/sdk-stage-logs`;

export function writeTestCoverageDevWorkerTimeoutTriage(repoRoot = process.cwd()): TestCoverageDevWorkerTimeoutTriage {
  const treatment = readJson<M12RunResult | null>(resolve(repoRoot, reportDir, "treatment-result.json"), null);
  const trace = readJson<Record<string, unknown> | null>(resolve(repoRoot, stageLogDir, "generic-test-coverage-dev-worker-invocation-trace-redacted.json"), null);
  const tc001Trace = readJson<Record<string, unknown> | null>(
    resolve(repoRoot, "evals/effectiveness/reports/test-coverage-001/sdk-stage-logs/generic-test-coverage-dev-worker-invocation-trace-redacted.json"),
    null
  );
  const eventsPath = stringField(treatment?.dev_worker_events_path) || stringField(pathField(trace, "error_capture_paths", "events_path")) || resolve(repoRoot, stageLogDir, "generic-test-coverage-dev-worker-events.jsonl");
  const stdoutPath = stringField(treatment?.dev_worker_stdout_path) || stringField(pathField(trace, "error_capture_paths", "stdout_path")) || resolve(repoRoot, stageLogDir, "generic-test-coverage-dev-worker-stdout.log");
  const stderrPath = stringField(treatment?.dev_worker_stderr_path) || stringField(pathField(trace, "error_capture_paths", "stderr_path")) || resolve(repoRoot, stageLogDir, "generic-test-coverage-dev-worker-stderr.log");
  const parsedEvents = parseEvents(eventsPath);
  const eventCount = numberField(treatment?.dev_worker_event_count) || parsedEvents.event_count;
  const lastEventType = stringField(treatment?.dev_worker_last_event_type) || parsedEvents.last_event_type;
  const devWorkerThreadId = stringField(treatment?.dev_worker_thread_id);
  const failureCategory = devWorkerThreadId || eventCount > 0 || lastEventType
    ? "TEST_COVERAGE_002_DEV_WORKER_TURN_NO_EVENT_TIMEOUT"
    : "TEST_COVERAGE_002_DEV_WORKER_STARTUP_NO_EVENT_TIMEOUT";
  const promptLength = numberField(treatment?.dev_worker_prompt_length) || numberField(pathField(trace, "prompt", "length"));
  const promptHash = stringField(treatment?.dev_worker_prompt_hash) || stringField(pathField(trace, "prompt", "hash"));
  const tc001PromptHash = stringField(pathField(tc001Trace, "prompt", "hash"));
  const targetRepo = stringField(treatment?.fixture_repo) || stringField(pathField(trace, "target_repo"));
  const workingDirectory = stringField(pathField(trace, "start_thread_options", "workingDirectory")) || targetRepo;
  const criticalDiffs: string[] = [];
  if (promptLength > numberField(pathField(tc001Trace, "prompt", "length")) * 1.25) {
    criticalDiffs.push("TEST_COVERAGE_002_DEV_PROMPT_TOO_LARGE");
  }
  if (!workingDirectory || !existsSync(workingDirectory)) {
    criticalDiffs.push("TEST_COVERAGE_002_DEV_WORKING_DIR_MISMATCH");
  }
  const triage: TestCoverageDevWorkerTimeoutTriage = {
    case_id: "test-coverage-002",
    failure_category: failureCategory,
    planner_thread_id_present: Boolean(treatment?.planner_thread_id),
    dev_worker_thread_started: Boolean(devWorkerThreadId),
    dev_worker_thread_id: devWorkerThreadId,
    dev_worker_completed: Boolean((treatment?.artifacts ?? []).includes("artifacts/dev-result.json") || existsSync(resolve(targetRepo, "artifacts/dev-result.json"))),
    event_count: eventCount,
    last_event_type: lastEventType,
    elapsed_ms: numberField(treatment?.dev_worker_elapsed_ms),
    dev_worker_events_path: eventsPath,
    dev_worker_stdout_path: stdoutPath,
    dev_worker_stderr_path: stderrPath,
    dev_worker_raw_output_path: stringField(treatment?.dev_worker_raw_output_path) || stdoutPath,
    dev_worker_redacted_output_path: stringField(treatment?.dev_worker_redacted_output_path) || redactedPath(stdoutPath),
    dev_worker_prompt_length: promptLength,
    dev_worker_prompt_hash: promptHash,
    test_coverage_001_dev_worker_prompt_hash: tc001PromptHash,
    target_repo: targetRepo,
    target_repo_is_git: existsSync(resolve(targetRepo, ".git")),
    working_directory: workingDirectory,
    validation_commands: ["npm test", "npm run coverage:contract"],
    critical_diffs: criticalDiffs,
    recommended_fixes: [
      "Run test-coverage-002 dev-worker parity, minimal, and exact smokes in order before approving another treatment rerun.",
      "Keep the exact dev-worker prompt focused on test/cache.test.js, npm test, and npm run coverage:contract.",
      "Preserve dev_worker timeout diagnostics in treatment-result.json for regrade/report/gate evidence."
    ]
  };
  writeJson(resolve(repoRoot, reportDir, "dev-worker-timeout-triage.json"), triage);
  writeMarkdown(resolve(repoRoot, reportDir, "DevWorkerTimeoutTriageReport.md"), renderTriage(triage));
  return triage;
}

function renderTriage(triage: TestCoverageDevWorkerTimeoutTriage): string {
  return [
    "# Test-Coverage-002 Dev Worker Timeout Triage",
    "",
    `Failure category: ${triage.failure_category}`,
    `Planner thread present: ${String(triage.planner_thread_id_present)}`,
    `Dev worker thread started: ${String(triage.dev_worker_thread_started)}`,
    `Dev worker thread id: ${triage.dev_worker_thread_id}`,
    `Dev worker completed: ${String(triage.dev_worker_completed)}`,
    `Event count: ${triage.event_count}`,
    `Last event type: ${triage.last_event_type}`,
    `Elapsed ms: ${triage.elapsed_ms}`,
    `Prompt length: ${triage.dev_worker_prompt_length}`,
    `Prompt hash: ${triage.dev_worker_prompt_hash}`,
    `TC001 prompt hash: ${triage.test_coverage_001_dev_worker_prompt_hash}`,
    "",
    "## Paths",
    `- events: ${triage.dev_worker_events_path}`,
    `- stdout: ${triage.dev_worker_stdout_path}`,
    `- stderr: ${triage.dev_worker_stderr_path}`,
    `- raw output: ${triage.dev_worker_raw_output_path}`,
    `- redacted output: ${triage.dev_worker_redacted_output_path}`,
    `- target repo: ${triage.target_repo}`,
    `- working directory: ${triage.working_directory}`,
    "",
    "## Critical Diffs",
    ...(triage.critical_diffs.length ? triage.critical_diffs.map((diff) => `- ${diff}`) : ["- none"]),
    "",
    "## Recommended Fixes",
    ...triage.recommended_fixes.map((fix) => `- ${fix}`),
    ""
  ].join("\n");
}

function parseEvents(path: string): { event_count: number; last_event_type: string } {
  if (!path || !existsSync(path)) return { event_count: 0, last_event_type: "" };
  let lastEventType = "";
  let eventCount = 0;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean)) {
    eventCount += 1;
    try {
      const parsed = JSON.parse(line) as { type?: unknown };
      if (typeof parsed.type === "string") lastEventType = parsed.type;
    } catch {
      lastEventType = "invalid-json";
    }
  }
  return { event_count: eventCount, last_event_type: lastEventType };
}

function pathField(value: Record<string, unknown> | null | undefined, key: string, child?: string): unknown {
  if (!value) return "";
  const parent = value[key];
  if (!child) return parent;
  if (typeof parent !== "object" || parent === null || Array.isArray(parent)) return "";
  return (parent as Record<string, unknown>)[child];
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberField(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function redactedPath(path: string): string {
  if (!path) return "";
  return resolve(dirname(path), `${path.split("/").pop()?.replace(/\.log$/, "-redacted.log") ?? stableHash(path)}`);
}

function stableHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const triage = writeTestCoverageDevWorkerTimeoutTriage();
  process.stdout.write(`${JSON.stringify(triage, null, 2)}\n`);
}
