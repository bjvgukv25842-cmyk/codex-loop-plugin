import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { featureEvaluatorStageConfig } from "../../src/effectiveness/feature-evaluator-stage.ts";
import { readJson, writeJson, writeMarkdown } from "./io.ts";
import type { M12RunResult } from "./types.ts";

export interface FeatureEvaluatorTimeoutTriage {
  case_id: "feature-small-001";
  failure_category: "FEATURE_TREATMENT_EVALUATOR_TURN_NO_EVENT_TIMEOUT";
  planner_completed: boolean;
  dev_worker_completed: boolean;
  evaluator_thread_started: boolean;
  evaluator_thread_id: string;
  evaluator_completed: boolean;
  event_count: number;
  last_event_type: string;
  elapsed_ms: number;
  evaluator_events_path: string;
  evaluator_stdout_path: string;
  evaluator_stderr_path: string;
  evaluator_raw_output_path: string;
  evaluator_redacted_output_path: string;
  evaluator_prompt_length: number;
  evaluator_prompt_hash: string;
  uses_evaluator_lite_schema: boolean;
  uses_full_eval_report_schema: boolean;
  target_repo: string;
  target_repo_is_git: boolean;
  working_directory: string;
  critical_diffs: string[];
  recommended_fixes: string[];
}

const reportDir = "evals/effectiveness/reports/feature-small-001";

export function writeFeatureEvaluatorTimeoutTriage(repoRoot = process.cwd()): FeatureEvaluatorTimeoutTriage {
  const treatment = readJson<M12RunResult | null>(resolve(repoRoot, reportDir, "treatment-result.json"), null);
  const trace = readJson<Record<string, unknown> | null>(resolve(repoRoot, reportDir, "sdk-stage-logs/generic-evaluator-invocation-trace-redacted.json"), null);
  const config = featureEvaluatorStageConfig({
    prd_path: "docs/PRD.md",
    task_graph_path: "docs/TASK_GRAPH.json",
    dev_result_path: "artifacts/dev-result.json",
    test_log_path: resolve(repoRoot, reportDir, "treatment-validation.log"),
    diff_path: resolve(repoRoot, reportDir, "treatment-diff.patch")
  });
  const paths = readEvaluatorPaths(treatment, trace);
  const events = readEvents(paths.events_path);
  const targetRepo = stringAt(trace, ["target_repo"]) || treatment?.fixture_repo || "";
  const workingDirectory = stringAt(trace, ["start_thread_options", "workingDirectory"]) || targetRepo;
  const promptLength = numberAt(trace, ["prompt", "length"]) || treatment?.initial_evaluator_prompt_length || config.prompt_length;
  const promptHash = stringAt(trace, ["prompt", "hash"]) || treatment?.initial_evaluator_prompt_hash || config.prompt_hash;
  const triage: FeatureEvaluatorTimeoutTriage = {
    case_id: "feature-small-001",
    failure_category: "FEATURE_TREATMENT_EVALUATOR_TURN_NO_EVENT_TIMEOUT",
    planner_completed: treatment?.planner_stage_completed === true || Boolean(treatment?.planner_thread_id),
    dev_worker_completed: treatment?.initial_dev_worker?.file_change_verified === true || Boolean(treatment?.dev_worker_thread_id),
    evaluator_thread_started: Boolean(treatment?.initial_evaluator_thread_id || events.thread_id),
    evaluator_thread_id: treatment?.initial_evaluator_thread_id || events.thread_id,
    evaluator_completed: treatment?.initial_eval_verdict === "PASS" || treatment?.initial_eval_verdict === "NEEDS_REVISION",
    event_count: treatment?.initial_evaluator_event_count || events.count,
    last_event_type: treatment?.initial_evaluator_last_event_type || events.last_type,
    elapsed_ms: treatment?.initial_evaluator_elapsed_ms || 0,
    evaluator_events_path: paths.events_path,
    evaluator_stdout_path: paths.stdout_path,
    evaluator_stderr_path: paths.stderr_path,
    evaluator_raw_output_path: paths.raw_output_path,
    evaluator_redacted_output_path: paths.redacted_output_path,
    evaluator_prompt_length: promptLength,
    evaluator_prompt_hash: promptHash,
    uses_evaluator_lite_schema: true,
    uses_full_eval_report_schema: false,
    target_repo: targetRepo,
    target_repo_is_git: booleanAt(trace, ["target_repo_is_git"]),
    working_directory: workingDirectory,
    critical_diffs: criticalDiffs(promptLength),
    recommended_fixes: [
      "Keep feature-small-001 treatment blocked until an evaluator-only slice completes without timeout.",
      "Run evaluator parity, text-only, output-minimal, output-lite, and exact smokes in order.",
      "Use the shortened feature evaluator prompt with evaluator-lite outputSchema; do not use the full EvalReport schema as outputSchema.",
      "Use checkpoint evaluator retry only after planner and dev worker PASS evidence is present."
    ]
  };
  writeJson(resolve(repoRoot, reportDir, "feature-evaluator-timeout-triage.json"), triage);
  writeMarkdown(resolve(repoRoot, reportDir, "FeatureEvaluatorTimeoutTriageReport.md"), renderTriageReport(triage));
  return triage;
}

function readEvaluatorPaths(treatment: M12RunResult | null, trace: Record<string, unknown> | null): {
  events_path: string;
  stdout_path: string;
  stderr_path: string;
  raw_output_path: string;
  redacted_output_path: string;
} {
  const eventsPath = treatment?.initial_evaluator_events_path || stringAt(trace, ["error_capture_paths", "events_path"]);
  const stdoutPath = treatment?.initial_evaluator_stdout_path || stringAt(trace, ["error_capture_paths", "stdout_path"]);
  const stderrPath = treatment?.initial_evaluator_stderr_path || stringAt(trace, ["error_capture_paths", "stderr_path"]);
  return {
    events_path: eventsPath,
    stdout_path: stdoutPath,
    stderr_path: stderrPath,
    raw_output_path: treatment?.initial_evaluator_raw_output_path || stdoutPath,
    redacted_output_path: treatment?.initial_evaluator_redacted_output_path || ""
  };
}

function readEvents(path: string): { count: number; last_type: string; thread_id: string } {
  if (!path || !existsSync(path)) return { count: 0, last_type: "", thread_id: "" };
  const lines = readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean);
  let lastType = "";
  let threadId = "";
  for (const line of lines) {
    try {
      const event = JSON.parse(line) as Record<string, unknown>;
      if (typeof event.type === "string") lastType = event.type;
      if (typeof event.thread_id === "string") threadId = event.thread_id;
    } catch {
      lastType = "unparseable";
    }
  }
  return { count: lines.length, last_type: lastType, thread_id: threadId };
}

function criticalDiffs(promptLength: number): string[] {
  const diffs = [
    "evaluator_thread_started_but_no_eval_report",
    "planner_and_dev_worker_completed_before_evaluator_timeout"
  ];
  if (promptLength > 700) diffs.push("historical_evaluator_prompt_exceeded_m12_2g_budget");
  return diffs;
}

function renderTriageReport(triage: FeatureEvaluatorTimeoutTriage): string {
  return [
    "# Feature Evaluator Timeout Triage",
    "",
    `Case: ${triage.case_id}`,
    `Failure category: ${triage.failure_category}`,
    `Planner completed: ${triage.planner_completed}`,
    `Dev worker completed: ${triage.dev_worker_completed}`,
    `Evaluator thread started: ${triage.evaluator_thread_started}`,
    `Evaluator thread id: ${triage.evaluator_thread_id}`,
    `Evaluator completed: ${triage.evaluator_completed}`,
    `Event count: ${triage.event_count}`,
    `Last event type: ${triage.last_event_type}`,
    `Prompt length: ${triage.evaluator_prompt_length}`,
    `Prompt hash: ${triage.evaluator_prompt_hash}`,
    `Uses evaluator-lite schema: ${triage.uses_evaluator_lite_schema}`,
    `Uses full EvalReport schema: ${triage.uses_full_eval_report_schema}`,
    `Target repo: ${triage.target_repo}`,
    `Target repo is git: ${triage.target_repo_is_git}`,
    "",
    "## Critical Diffs",
    ...triage.critical_diffs.map((diff) => `- ${diff}`),
    "",
    "## Recommended Fixes",
    ...triage.recommended_fixes.map((fix) => `- ${fix}`),
    ""
  ].join("\n");
}

function stringAt(value: unknown, path: string[]): string {
  const found = path.reduce<unknown>((current, key) => isRecord(current) ? current[key] : undefined, value);
  return typeof found === "string" ? found : "";
}

function numberAt(value: unknown, path: string[]): number {
  const found = path.reduce<unknown>((current, key) => isRecord(current) ? current[key] : undefined, value);
  return typeof found === "number" ? found : 0;
}

function booleanAt(value: unknown, path: string[]): boolean {
  const found = path.reduce<unknown>((current, key) => isRecord(current) ? current[key] : undefined, value);
  return found === true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const triage = writeFeatureEvaluatorTimeoutTriage();
  process.stdout.write(`${JSON.stringify(triage, null, 2)}\n`);
}
