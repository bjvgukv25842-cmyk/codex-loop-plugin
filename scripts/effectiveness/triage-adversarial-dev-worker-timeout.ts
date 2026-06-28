import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { SEEDED_FAKE_SECRET } from "../../src/effectiveness/adversarial-safety.ts";
import { readJson, writeJson, writeMarkdown } from "./io.ts";
import type { M12RunResult } from "./types.ts";

const CASE_ID = "adversarial-prompt-injection-001";
const REPORT_DIR = `evals/effectiveness/reports/${CASE_ID}`;

export interface AdversarialDevWorkerTimeoutTriage {
  case_id: "adversarial-prompt-injection-001";
  failure_category: "ADVERSARIAL_DEV_WORKER_STARTUP_NO_EVENT_TIMEOUT" | "ADVERSARIAL_DEV_WORKER_TURN_TIMEOUT";
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
  contains_seeded_fake_secret_raw: boolean;
  contains_untrusted_instruction_raw: boolean;
  target_repo: string;
  target_repo_is_git: boolean;
  working_directory: string;
  validation_commands: string[];
  critical_diffs: string[];
  recommended_fixes: string[];
}

export function writeAdversarialDevWorkerTimeoutTriage(repoRoot = process.cwd()): AdversarialDevWorkerTimeoutTriage {
  const result = readJson<M12RunResult | null>(resolve(repoRoot, REPORT_DIR, "treatment-result.json"), null);
  const trace = readJson<Record<string, unknown> | null>(resolve(repoRoot, REPORT_DIR, "sdk-stage-logs/adversarial-dev-worker-invocation-trace-redacted.json"), null);
  const eventsPath = stringField(result?.dev_worker_events_path) || resolve(repoRoot, REPORT_DIR, "sdk-stage-logs/adversarial-dev-worker-events.jsonl");
  const events = readJsonlEvents(eventsPath);
  const promptLength = numberField(pathField(trace, "prompt", "length")) || numberField(result?.dev_worker_prompt_length);
  const promptHash = stringField(pathField(trace, "prompt", "hash")) || stringField(result?.dev_worker_prompt_hash);
  const targetRepo = result?.fixture_repo ?? stringField(pathField(trace, "target_repo"));
  const workingDirectory = stringField(pathField(trace, "start_thread_options", "workingDirectory")) || targetRepo;
  const lastType = stringField(result?.dev_worker_last_event_type) || lastEventType(events);
  const eventCount = numberField(result?.dev_worker_event_count) || events.length;
  const triage: AdversarialDevWorkerTimeoutTriage = {
    case_id: CASE_ID,
    failure_category: result?.dev_worker_thread_id || hasThreadStarted(events)
      ? "ADVERSARIAL_DEV_WORKER_TURN_TIMEOUT"
      : "ADVERSARIAL_DEV_WORKER_STARTUP_NO_EVENT_TIMEOUT",
    planner_thread_id_present: Boolean(result?.planner_thread_id),
    dev_worker_thread_started: Boolean(result?.dev_worker_thread_id || hasThreadStarted(events)),
    dev_worker_thread_id: result?.dev_worker_thread_id ?? threadIdFromEvents(events),
    dev_worker_completed: (result?.artifacts ?? []).includes("artifacts/dev-result.json") && existsSync(resolve(targetRepo, "artifacts/dev-result.json")),
    event_count: eventCount,
    last_event_type: lastType,
    elapsed_ms: numberField(result?.dev_worker_elapsed_ms),
    dev_worker_events_path: eventsPath,
    dev_worker_stdout_path: result?.dev_worker_stdout_path ?? resolve(repoRoot, REPORT_DIR, "sdk-stage-logs/adversarial-dev-worker-stdout.log"),
    dev_worker_stderr_path: result?.dev_worker_stderr_path ?? resolve(repoRoot, REPORT_DIR, "sdk-stage-logs/adversarial-dev-worker-stderr.log"),
    dev_worker_raw_output_path: result?.dev_worker_raw_output_path ?? "",
    dev_worker_redacted_output_path: result?.dev_worker_redacted_output_path ?? "",
    dev_worker_prompt_length: promptLength,
    dev_worker_prompt_hash: promptHash,
    contains_seeded_fake_secret_raw: promptContainsSeededSecret(trace),
    contains_untrusted_instruction_raw: promptCopiesUntrustedInstructions(trace, targetRepo),
    target_repo: targetRepo,
    target_repo_is_git: existsSync(resolve(targetRepo, ".git")),
    working_directory: workingDirectory,
    validation_commands: result?.validation_commands ?? ["npm test", "npm run security:contract"],
    critical_diffs: [],
    recommended_fixes: [
      "Run adversarial dev-worker parity, safety-minimal, and exact smokes before any treatment rerun.",
      "Keep the exact dev-worker prompt short and do not include the seeded fake secret or raw untrusted instruction body.",
      "Persist dev-worker event_count, last_event_type, elapsed_ms, and thread id on timeout."
    ]
  };
  if (triage.contains_seeded_fake_secret_raw) triage.critical_diffs.push("ADVERSARIAL_DEV_PROMPT_CONTAINS_SEEDED_SECRET_RAW");
  if (triage.contains_untrusted_instruction_raw) triage.critical_diffs.push("ADVERSARIAL_DEV_PROMPT_CONTAINS_UNTRUSTED_INSTRUCTIONS_RAW");
  writeJson(resolve(repoRoot, REPORT_DIR, "adversarial-dev-worker-timeout-triage.json"), triage);
  writeMarkdown(resolve(repoRoot, REPORT_DIR, "AdversarialDevWorkerTimeoutTriageReport.md"), renderTriage(triage));
  return triage;
}

function renderTriage(triage: AdversarialDevWorkerTimeoutTriage): string {
  return [
    "# Adversarial Dev Worker Timeout Triage",
    "",
    `Case: ${triage.case_id}`,
    `Failure category: ${triage.failure_category}`,
    `Planner thread id present: ${String(triage.planner_thread_id_present)}`,
    `Dev worker thread started: ${String(triage.dev_worker_thread_started)}`,
    `Dev worker completed: ${String(triage.dev_worker_completed)}`,
    `Event count: ${triage.event_count}`,
    `Last event type: ${triage.last_event_type}`,
    `Elapsed ms: ${triage.elapsed_ms}`,
    `Prompt length: ${triage.dev_worker_prompt_length}`,
    `Prompt hash: ${triage.dev_worker_prompt_hash}`,
    `Contains seeded fake secret raw: ${String(triage.contains_seeded_fake_secret_raw)}`,
    `Contains untrusted instruction raw: ${String(triage.contains_untrusted_instruction_raw)}`,
    `Target repo is git: ${String(triage.target_repo_is_git)}`,
    "",
    "## Critical Diffs",
    ...(triage.critical_diffs.length ? triage.critical_diffs.map((entry) => `- ${entry}`) : ["- None"]),
    "",
    "## Recommended Fixes",
    ...triage.recommended_fixes.map((entry) => `- ${entry}`),
    ""
  ].join("\n");
}

function promptContainsSeededSecret(trace: Record<string, unknown> | null): boolean {
  const promptHash = stringField(pathField(trace, "prompt", "hash"));
  return promptHash === stableHash(SEEDED_FAKE_SECRET);
}

function promptCopiesUntrustedInstructions(trace: Record<string, unknown> | null, targetRepo: string): boolean {
  const promptHash = stringField(pathField(trace, "prompt", "hash"));
  const untrusted = readText(resolve(targetRepo, "UNTRUSTED_INSTRUCTIONS.md")).trim();
  return Boolean(untrusted && promptHash === stableHash(untrusted));
}

function readJsonlEvents(path: string): unknown[] {
  if (!path || !existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as unknown;
      } catch {
        return { type: "unparseable" };
      }
    });
}

function hasThreadStarted(events: unknown[]): boolean {
  return Boolean(threadIdFromEvents(events));
}

function threadIdFromEvents(events: unknown[]): string {
  for (const event of events) {
    if (isRecord(event) && event.type === "thread.started" && typeof event.thread_id === "string") return event.thread_id;
  }
  return "";
}

function lastEventType(events: unknown[]): string {
  let last = "";
  for (const event of events) {
    if (isRecord(event) && typeof event.type === "string") last = event.type;
  }
  return last;
}

function pathField(value: Record<string, unknown> | null | undefined, ...keys: string[]): unknown {
  let current: unknown = value;
  for (const key of keys) {
    if (!isRecord(current)) return "";
    current = current[key];
  }
  return current ?? "";
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberField(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function stableHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function readText(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const triage = writeAdversarialDevWorkerTimeoutTriage();
  process.stdout.write(`${JSON.stringify(triage, null, 2)}\n`);
}
