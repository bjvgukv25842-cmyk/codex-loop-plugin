import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  classifyFeatureEvaluatorParityFailure,
  FEATURE_EVALUATOR_PARITY_PROMPT,
  parseFeatureEvaluatorEvents
} from "../../src/effectiveness/feature-evaluator-stage.ts";
import { readJson, writeJson, writeMarkdown } from "./io.ts";
import type { FeatureEvaluatorSmokeResult } from "./run-feature-evaluator-smoke.ts";

export interface FeatureEvaluatorParityTimeoutTriage {
  case_id: "feature-small-001";
  stage: "evaluator-parity";
  failure_category:
    | "FEATURE_EVALUATOR_PARITY_TURN_NO_EVENT_TIMEOUT"
    | "FEATURE_EVALUATOR_PARITY_STARTUP_NO_EVENT_TIMEOUT"
    | "FEATURE_EVALUATOR_PARITY_TURN_FAILED"
    | "FEATURE_EVALUATOR_PARITY_RESPONSE_MISSING"
    | "FEATURE_EVALUATOR_PARITY_THREAD_STARTUP_FAILURE"
    | "SDK_EVALUATOR_RUNSTREAMED_EVENT_STREAM_ISSUE"
    | "SDK_EVALUATOR_METHOD_BOTH_FAILED";
  evaluator_thread_started: boolean;
  evaluator_thread_id: string;
  turn_started: boolean;
  turn_completed: boolean;
  turn_failed: boolean;
  event_count: number;
  last_event_type: string;
  elapsed_ms: number;
  events_path: string;
  stdout_path: string;
  stderr_path: string;
  raw_output_path: string;
  redacted_output_path: string;
  prompt: typeof FEATURE_EVALUATOR_PARITY_PROMPT;
  prompt_hash: string;
  working_directory: string;
  target_repo_is_git: boolean;
  sandbox_mode: "read-only";
  model: string;
  model_catalog_json: string;
  sqlite_home: string;
  uses_output_schema: false;
  sdk_method: "run" | "runStreamed";
  recommended_fixes: string[];
}

const reportDir = "evals/effectiveness/reports/feature-small-001";
const stageLogDir = `${reportDir}/sdk-stage-logs`;

export function writeFeatureEvaluatorParityTimeoutTriage(repoRoot = process.cwd()): FeatureEvaluatorParityTimeoutTriage {
  const result = readJson<FeatureEvaluatorSmokeResult | null>(resolve(repoRoot, reportDir, "feature-evaluator-smoke-result.json"), null);
  const trace = readJson<Record<string, unknown> | null>(resolve(repoRoot, stageLogDir, "feature-evaluator-smoke-parity-invocation-trace-redacted.json"), null);
  const eventsPath = result?.evaluator_events_path || stringAt(trace, ["error_capture_paths", "events_path"]) || resolve(repoRoot, stageLogDir, "feature-evaluator-smoke-parity-events.jsonl");
  const stdoutPath = result?.evaluator_stdout_path || stringAt(trace, ["error_capture_paths", "stdout_path"]) || resolve(repoRoot, stageLogDir, "feature-evaluator-smoke-parity-stdout.log");
  const stderrPath = result?.evaluator_stderr_path || stringAt(trace, ["error_capture_paths", "stderr_path"]) || resolve(repoRoot, stageLogDir, "feature-evaluator-smoke-parity-stderr.log");
  const events = readEvents(eventsPath);
  const parsedEvents = parseFeatureEvaluatorEvents(events);
  const evaluatorThreadId = result?.evaluator_thread_id || parsedEvents.thread_id;
  const failureCategory = classifyFeatureEvaluatorParityFailure({
    thread_id: evaluatorThreadId,
    status: result?.status === "FAIL" ? "TIMEOUT" : undefined,
    failure_category: result?.failure_category,
    final_response: result?.final_response_contains_expected ? FEATURE_EVALUATOR_PARITY_PROMPT : "",
    events,
    last_event_type: result?.evaluator_last_event_type || parsedEvents.last_event_type,
    no_event_timeout: result?.failure_category === "SDK_NO_EVENT_TIMEOUT",
    event_count: parsedEvents.event_count
  });
  const triage: FeatureEvaluatorParityTimeoutTriage = {
    case_id: "feature-small-001",
    stage: "evaluator-parity",
    failure_category: failureCategory,
    evaluator_thread_started: Boolean(evaluatorThreadId || parsedEvents.thread_id),
    evaluator_thread_id: evaluatorThreadId,
    turn_started: parsedEvents.turn_started,
    turn_completed: parsedEvents.turn_completed,
    turn_failed: parsedEvents.turn_failed,
    event_count: parsedEvents.event_count,
    last_event_type: result?.evaluator_last_event_type || parsedEvents.last_event_type,
    elapsed_ms: result?.evaluator_elapsed_ms ?? 0,
    events_path: eventsPath,
    stdout_path: stdoutPath,
    stderr_path: stderrPath,
    raw_output_path: stdoutPath,
    redacted_output_path: "",
    prompt: FEATURE_EVALUATOR_PARITY_PROMPT,
    prompt_hash: stringAt(trace, ["prompt", "hash"]) || stableHash(FEATURE_EVALUATOR_PARITY_PROMPT),
    working_directory: stringAt(trace, ["start_thread_options", "workingDirectory"]) || stringAt(trace, ["target_repo"]),
    target_repo_is_git: booleanAt(trace, ["target_repo_is_git"]),
    sandbox_mode: "read-only",
    model: stringAt(trace, ["start_thread_options", "model"]) || stringAt(trace, ["constructor_options", "config_values_redacted", "model"]),
    model_catalog_json: stringAt(trace, ["constructor_options", "config_values_redacted", "model_catalog_json"]),
    sqlite_home: stringAt(trace, ["constructor_options", "config_values_redacted", "sqlite_home"]),
    uses_output_schema: false,
    sdk_method: sdkMethod(trace),
    recommended_fixes: recommendedFixes(failureCategory)
  };
  writeJson(resolve(repoRoot, reportDir, "feature-evaluator-parity-timeout-triage.json"), triage);
  writeMarkdown(resolve(repoRoot, reportDir, "FeatureEvaluatorParityTimeoutTriageReport.md"), renderReport(triage));
  return triage;
}

function readEvents(path: string): unknown[] {
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

function recommendedFixes(category: string): string[] {
  const fixes = [
    "Keep feature evaluator text-only, output-minimal, output-lite, exact, and treatment rerun blocked until parity is proven.",
    "Run evaluator CLI parity once to isolate whether Codex CLI can return FEATURE_EVALUATOR_PARITY_OK with the same target repo and prompt.",
    "If CLI parity passes while SDK parity times out, investigate SDK evaluator adapter event streaming or switch the controlled parity method to run() for diagnosis."
  ];
  if (category === "FEATURE_EVALUATOR_PARITY_STARTUP_NO_EVENT_TIMEOUT") {
    fixes.unshift("Investigate evaluator SDK thread startup before any turn-level prompt changes.");
  }
  if (category === "FEATURE_EVALUATOR_PARITY_TURN_FAILED") {
    fixes.unshift("Inspect stderr and error events before rerunning any evaluator smoke.");
  }
  return fixes;
}

function renderReport(triage: FeatureEvaluatorParityTimeoutTriage): string {
  return [
    "# Feature Evaluator Parity Timeout Triage",
    "",
    `Case: ${triage.case_id}`,
    `Stage: ${triage.stage}`,
    `Failure category: ${triage.failure_category}`,
    `Evaluator thread started: ${triage.evaluator_thread_started}`,
    `Evaluator thread id: ${triage.evaluator_thread_id}`,
    `Turn started: ${triage.turn_started}`,
    `Turn completed: ${triage.turn_completed}`,
    `Turn failed: ${triage.turn_failed}`,
    `Event count: ${triage.event_count}`,
    `Last event type: ${triage.last_event_type}`,
    `Elapsed ms: ${triage.elapsed_ms}`,
    `Working directory: ${triage.working_directory}`,
    `Target repo is git: ${triage.target_repo_is_git}`,
    `Sandbox mode: ${triage.sandbox_mode}`,
    `Model: ${triage.model}`,
    `Uses output schema: ${triage.uses_output_schema}`,
    `SDK method: ${triage.sdk_method}`,
    "",
    "## Paths",
    `Events: ${triage.events_path}`,
    `Stdout: ${triage.stdout_path}`,
    `Stderr: ${triage.stderr_path}`,
    "",
    "## Recommended Fixes",
    ...triage.recommended_fixes.map((fix) => `- ${fix}`),
    "",
    "This report is generated from existing evaluator parity evidence only. It does not start SDK threads or Codex CLI.",
    ""
  ].join("\n");
}

function sdkMethod(trace: Record<string, unknown> | null): "run" | "runStreamed" {
  return stringAt(trace, ["sdk_api_method"]) === "run" ? "run" : "runStreamed";
}

function stringAt(value: unknown, path: string[]): string {
  const found = path.reduce<unknown>((current, key) => isRecord(current) ? current[key] : undefined, value);
  return typeof found === "string" ? found : "";
}

function booleanAt(value: unknown, path: string[]): boolean {
  const found = path.reduce<unknown>((current, key) => isRecord(current) ? current[key] : undefined, value);
  return found === true;
}

function stableHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const triage = writeFeatureEvaluatorParityTimeoutTriage();
  process.stdout.write(`${JSON.stringify(triage, null, 2)}\n`);
}
