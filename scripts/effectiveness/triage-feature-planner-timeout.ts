import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { buildFeatureSmall001PlannerPrompt } from "../../src/effectiveness/treatment-generic-feature-runner.ts";
import { readJson, writeJson, writeMarkdown } from "./io.ts";
import type { M12RunResult } from "./types.ts";

interface FeaturePlannerTimeoutTriage {
  case_id: "feature-small-001";
  failure_category: string;
  planner_thread_started: boolean;
  planner_thread_id: string;
  last_event_type: string;
  event_count: number;
  elapsed_ms: number;
  planner_events_path: string;
  planner_stdout_path: string;
  planner_stderr_path: string;
  planner_raw_output_path: string;
  planner_redacted_output_path: string;
  feature_planner_prompt_length: number;
  feature_planner_prompt_hash: string;
  repair_loop_planner_prompt_hash: string;
  uses_planner_lite_v2: boolean;
  uses_task_graph_json_string: boolean;
  target_repo: string;
  target_repo_is_git: boolean;
  working_directory: string;
  critical_diffs: string[];
  recommended_fixes: string[];
}

const reportDir = "evals/effectiveness/reports/feature-small-001";

export function triageFeaturePlannerTimeout(repoRoot = process.cwd()): FeaturePlannerTimeoutTriage {
  const result = readJson<M12RunResult | null>(resolve(repoRoot, reportDir, "treatment-result.json"), null);
  const checkpoint = readJson<Record<string, unknown>>(resolve(repoRoot, reportDir, "treatment-generic-feature-state.json"), {});
  const planner = isRecord(checkpoint.planner) ? checkpoint.planner : {};
  const trace = readJson<Record<string, unknown>>(resolve(repoRoot, reportDir, "sdk-stage-logs/generic-planner-invocation-trace-redacted.json"), {});
  const schemaTrace = readJson<Record<string, unknown>>(resolve(repoRoot, reportDir, "sdk-stage-logs/planner-schema-invocation-trace-redacted.json"), {});
  const diff = readJson<{ critical_diffs?: string[] }>(resolve(repoRoot, reportDir, "feature-planner-invocation-diff.json"), { critical_diffs: [] });
  const eventsPath = stringField(result?.planner_events_path) || stringField(planner.events_path) || resolve(repoRoot, reportDir, "sdk-stage-logs/generic-planner-events.jsonl");
  const events = readJsonl(eventsPath);
  const prompt = buildFeatureSmall001PlannerPrompt();
  const repairTrace = readJson<Record<string, unknown>>(resolve(repoRoot, "evals/effectiveness/reports/repair-loop-001/sdk-stage-logs/gate6b2-planner-invocation-trace-redacted.json"), {});
  const triage: FeaturePlannerTimeoutTriage = {
    case_id: "feature-small-001",
    failure_category: normalizeFeaturePlannerFailure(result?.failure_category ?? stringField(planner.failure_category), result?.planner_thread_id ?? stringField(planner.thread_id)),
    planner_thread_started: Boolean(result?.planner_thread_id || planner.thread_id),
    planner_thread_id: result?.planner_thread_id ?? stringField(planner.thread_id),
    last_event_type: result?.planner_last_event_type ?? stringField(planner.last_event_type),
    event_count: (result?.planner_event_count ?? numberField(planner.event_count)) || events.length,
    elapsed_ms: result?.planner_elapsed_ms ?? numberField(planner.elapsed_ms),
    planner_events_path: eventsPath,
    planner_stdout_path: stringField(result?.planner_stdout_path) || stringField(planner.stdout_path),
    planner_stderr_path: stringField(result?.planner_stderr_path) || stringField(planner.stderr_path),
    planner_raw_output_path: stringField(result?.planner_raw_output_path) || stringField(planner.raw_output_path),
    planner_redacted_output_path: stringField(result?.planner_redacted_output_path) || stringField(planner.redacted_output_path),
    feature_planner_prompt_length: prompt.length,
    feature_planner_prompt_hash: hash(prompt),
    repair_loop_planner_prompt_hash: readPromptHash(repairTrace),
    uses_planner_lite_v2: result?.planner_output_contract_version === "v2" ||
      schemaTrace.planner_output_contract_version === "v2" ||
      readOutputSchemaHash(trace) === "4eb7a92b5497403e234940e49f9dcdf234d805eb037f1dc3d6683b8651f330de",
    uses_task_graph_json_string: JSON.stringify(schemaTrace).includes("task_graph_json") || prompt.includes("task_graph_json"),
    target_repo: result?.fixture_repo ?? stringField(trace.target_repo),
    target_repo_is_git: Boolean(isRecord(trace) && trace.target_repo_is_git === true) || existsSync(resolve(result?.fixture_repo ?? "", ".git")),
    working_directory: readWorkingDirectory(trace),
    critical_diffs: diff.critical_diffs ?? [],
    recommended_fixes: [
      "Keep feature-small-001 blocked until planner parity, lite-minimal, and exact smokes pass.",
      "Use planner-lite-v2 with direct tasks[] and no nested JSON strings.",
      "Classify no-event timeout as startup or turn timeout based on thread/event evidence.",
      "Do not rerun full M12 or another case before this planner slice is isolated."
    ]
  };
  return triage;
}

export function writeFeaturePlannerTimeoutTriage(repoRoot = process.cwd()): FeaturePlannerTimeoutTriage {
  const triage = triageFeaturePlannerTimeout(repoRoot);
  writeJson(resolve(repoRoot, reportDir, "feature-planner-timeout-triage.json"), triage);
  writeMarkdown(resolve(repoRoot, reportDir, "FeaturePlannerTimeoutTriageReport.md"), renderReport(triage));
  return triage;
}

function renderReport(triage: FeaturePlannerTimeoutTriage): string {
  return [
    "# Feature Planner Timeout Triage",
    "",
    `Failure category: ${triage.failure_category}`,
    `Planner thread started: ${triage.planner_thread_started}`,
    `Planner thread id: ${triage.planner_thread_id}`,
    `Last event type: ${triage.last_event_type}`,
    `Event count: ${triage.event_count}`,
    `Elapsed ms: ${triage.elapsed_ms}`,
    `Uses planner-lite-v2: ${triage.uses_planner_lite_v2}`,
    `Uses task_graph_json string: ${triage.uses_task_graph_json_string}`,
    `Feature prompt length: ${triage.feature_planner_prompt_length}`,
    `Feature prompt hash: ${triage.feature_planner_prompt_hash}`,
    `Repair-loop prompt hash: ${triage.repair_loop_planner_prompt_hash}`,
    `Critical diffs: ${triage.critical_diffs.length > 0 ? triage.critical_diffs.join(", ") : "none"}`,
    "",
    "## Evidence Paths",
    `- events: ${triage.planner_events_path}`,
    `- stdout: ${triage.planner_stdout_path}`,
    `- stderr: ${triage.planner_stderr_path}`,
    `- raw output: ${triage.planner_raw_output_path}`,
    `- redacted output: ${triage.planner_redacted_output_path}`,
    "",
    "## Recommended Fixes",
    ...triage.recommended_fixes.map((entry) => `- ${entry}`),
    "",
    "This report is generated from existing evidence only. It does not start Codex, SDK threads, or another M12 case.",
    ""
  ].join("\n");
}

function normalizeFeaturePlannerFailure(category: string, threadId: string): string {
  if (category === "SDK_NO_EVENT_TIMEOUT") {
    return threadId ? "FEATURE_TREATMENT_PLANNER_TURN_NO_EVENT_TIMEOUT" : "FEATURE_TREATMENT_PLANNER_STARTUP_NO_EVENT_TIMEOUT";
  }
  return category || "FEATURE_TREATMENT_PLANNER_NO_EVENT_TIMEOUT";
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

function readPromptHash(trace: Record<string, unknown>): string {
  const prompt = isRecord(trace.prompt) ? trace.prompt : {};
  return stringField(prompt.hash);
}

function readOutputSchemaHash(trace: Record<string, unknown>): string {
  const runOptions = isRecord(trace.run_options) ? trace.run_options : {};
  return stringField(runOptions.outputSchemaHash);
}

function readWorkingDirectory(trace: Record<string, unknown>): string {
  const start = isRecord(trace.start_thread_options) ? trace.start_thread_options : {};
  return stringField(start.workingDirectory) || stringField(trace.target_repo);
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberField(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = writeFeaturePlannerTimeoutTriage();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
