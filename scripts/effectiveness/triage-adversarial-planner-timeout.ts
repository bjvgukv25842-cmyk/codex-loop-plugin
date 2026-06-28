import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  ADVERSARIAL_PLANNER_OUTPUT_CONTRACT_VERSION,
  classifyAdversarialPlannerFailure,
  containsUntrustedInstructionRaw
} from "../../src/effectiveness/adversarial-planner-stage.ts";
import { SEEDED_FAKE_SECRET } from "../../src/effectiveness/adversarial-safety.ts";
import type { M12RunResult, M12StageTimelineEntry } from "./types.ts";
import { readJson, writeJson, writeMarkdown } from "./io.ts";

const CASE_ID = "adversarial-prompt-injection-001";
const REPORT_DIR = `evals/effectiveness/reports/${CASE_ID}`;

export interface AdversarialPlannerTimeoutTriage {
  case_id: "adversarial-prompt-injection-001";
  failure_category: string;
  baseline_seeded_fake_secret_leaked: boolean;
  baseline_real_secret_leak_detected: boolean;
  treatment_real_run_executed: boolean;
  planner_thread_started: boolean;
  planner_thread_id: string;
  planner_completed: boolean;
  turn_started: boolean;
  turn_completed: boolean;
  turn_failed: boolean;
  event_count: number;
  last_event_type: string;
  elapsed_ms: number;
  timeout_ms: number;
  planner_events_path: string;
  planner_stdout_path: string;
  planner_stderr_path: string;
  planner_raw_output_path: string;
  planner_redacted_output_path: string;
  working_directory: string;
  target_repo_is_git: boolean;
  model: string;
  model_catalog_json: string;
  sqlite_home: string;
  prompt_length: number;
  prompt_hash: string;
  prompt_contains_seeded_fake_secret_raw: boolean;
  prompt_contains_untrusted_instruction_raw: boolean;
  uses_planner_lite_v2: boolean;
  uses_task_graph_json_string: false;
  recommended_fixes: string[];
}

export function writeAdversarialPlannerTimeoutTriage(repoRoot = process.cwd()): AdversarialPlannerTimeoutTriage {
  const baseline = readJson<Partial<M12RunResult> | null>(resolve(repoRoot, REPORT_DIR, "baseline-result.json"), null);
  const treatment = readJson<M12RunResult>(resolve(repoRoot, REPORT_DIR, "treatment-result.json"), missingTreatmentResult());
  const trace = readJson<Record<string, unknown> | null>(resolve(repoRoot, REPORT_DIR, "sdk-stage-logs/adversarial-planner-invocation-trace-redacted.json"), null);
  const schemaTrace = readJson<Record<string, unknown> | null>(resolve(repoRoot, REPORT_DIR, "sdk-stage-logs/planner-schema-invocation-trace-redacted.json"), null);
  const plannerStage = (treatment.stage_timeline ?? []).find((entry) => entry.stage === "planner") as M12StageTimelineEntry | undefined;
  const eventsPath = stringValue(treatment.planner_events_path || plannerStage?.events_path || pathValue(trace, "error_capture_paths", "events_path"));
  const stdoutPath = stringValue(treatment.planner_stdout_path || pathValue(trace, "error_capture_paths", "stdout_path"));
  const stderrPath = stringValue(treatment.planner_stderr_path || pathValue(trace, "error_capture_paths", "stderr_path"));
  const eventInfo = readEventInfo(eventsPath);
  const promptLength = numberValue(treatment.planner_prompt_length) || numberValue(pathValue(trace, "prompt", "length")) || numberValue(pathValue(schemaTrace, "prompt_length"));
  const promptHash = stringValue(treatment.planner_prompt_hash || pathValue(trace, "prompt", "hash") || pathValue(schemaTrace, "prompt_hash"));
  const rawOutputPath = stringValue(treatment.planner_raw_output_path || stdoutPath);
  const redactedOutputPath = stringValue(treatment.planner_redacted_output_path || (stdoutPath ? stdoutPath.replace(/(\.[^.]+)?$/, "-redacted$1") : ""));
  const promptText = readIfExists(resolve(repoRoot, REPORT_DIR, "sdk-stage-logs/adversarial-planner-prompt-redacted.txt"));
  const turnStarted = Boolean(treatment.planner_thread_id || eventInfo.threadStarted || plannerStage?.started);
  const turnCompleted = treatment.planner_stage_completed === true && plannerArtifactsExist(treatment);
  const category = classifyAdversarialPlannerFailure({
    thread_id: treatment.planner_thread_id,
    turn_started: turnStarted,
    turn_completed: turnCompleted,
    output_valid: treatment.planner_stage_completed === true,
    artifacts_created: plannerArtifactsExist(treatment),
    failure_category: treatment.corrected_failure_category || treatment.failure_category,
    prompt: promptText,
    working_directory_matches: workingDirectoryMatches(trace),
    model_catalog_ok: Boolean(pathValue(trace, "constructor_options", "config_values_redacted", "model_catalog_json") || pathValue(schemaTrace, "model_catalog_json")),
    sqlite_home_ok: Boolean(pathValue(trace, "constructor_options", "config_values_redacted", "sqlite_home") || pathValue(schemaTrace, "sqlite_home"))
  }) || "ADVERSARIAL_PLANNER_TURN_TIMEOUT";
  const triage: AdversarialPlannerTimeoutTriage = {
    case_id: CASE_ID,
    failure_category: category,
    baseline_seeded_fake_secret_leaked: baseline?.seeded_fake_secret_leaked === true,
    baseline_real_secret_leak_detected: baseline?.real_secret_leak_detected === true,
    treatment_real_run_executed: treatment.real_run_executed === true,
    planner_thread_started: Boolean(treatment.planner_thread_id),
    planner_thread_id: treatment.planner_thread_id ?? "",
    planner_completed: turnCompleted,
    turn_started: turnStarted,
    turn_completed: turnCompleted,
    turn_failed: !turnCompleted,
    event_count: numberValue(treatment.planner_event_count) || eventInfo.eventCount,
    last_event_type: stringValue(treatment.planner_last_event_type || eventInfo.lastEventType || plannerStage?.last_event_type),
    elapsed_ms: numberValue(treatment.planner_elapsed_ms) || numberValue(plannerStage?.elapsed_ms),
    timeout_ms: numberValue(treatment.timeout_ms) || 180_000,
    planner_events_path: eventsPath,
    planner_stdout_path: stdoutPath,
    planner_stderr_path: stderrPath,
    planner_raw_output_path: rawOutputPath,
    planner_redacted_output_path: redactedOutputPath,
    working_directory: stringValue(treatment.fixture_repo || pathValue(trace, "start_thread_options", "workingDirectory") || pathValue(schemaTrace, "working_directory")),
    target_repo_is_git: trace?.target_repo_is_git === true || existsSync(resolve(String(treatment.fixture_repo ?? ""), ".git")),
    model: stringValue(pathValue(trace, "constructor_options", "config_values_redacted", "model") || pathValue(schemaTrace, "model")),
    model_catalog_json: stringValue(pathValue(trace, "constructor_options", "config_values_redacted", "model_catalog_json") || pathValue(schemaTrace, "model_catalog_json")),
    sqlite_home: stringValue(pathValue(trace, "constructor_options", "config_values_redacted", "sqlite_home") || pathValue(schemaTrace, "sqlite_home")),
    prompt_length: promptLength,
    prompt_hash: promptHash || (promptText ? hash(promptText) : ""),
    prompt_contains_seeded_fake_secret_raw: promptText.includes(SEEDED_FAKE_SECRET),
    prompt_contains_untrusted_instruction_raw: containsUntrustedInstructionRaw(promptText),
    uses_planner_lite_v2: (treatment.planner_output_contract_version ?? schemaTrace?.planner_output_contract_version) === ADVERSARIAL_PLANNER_OUTPUT_CONTRACT_VERSION,
    uses_task_graph_json_string: false,
    recommended_fixes: recommendedFixes(category)
  };
  writeJson(resolve(repoRoot, REPORT_DIR, "adversarial-planner-timeout-triage.json"), triage);
  writeMarkdown(resolve(repoRoot, REPORT_DIR, "AdversarialPlannerTimeoutTriageReport.md"), renderTriage(triage));
  return triage;
}

function renderTriage(triage: AdversarialPlannerTimeoutTriage): string {
  return [
    "# Adversarial Planner Timeout Triage",
    "",
    `Case: ${triage.case_id}`,
    `Failure category: ${triage.failure_category}`,
    `Planner thread started: ${String(triage.planner_thread_started)}`,
    `Planner thread id: ${triage.planner_thread_id}`,
    `Planner completed: ${String(triage.planner_completed)}`,
    `Turn started: ${String(triage.turn_started)}`,
    `Turn completed: ${String(triage.turn_completed)}`,
    `Event count: ${triage.event_count}`,
    `Last event type: ${triage.last_event_type}`,
    `Timeout ms: ${triage.timeout_ms}`,
    "",
    "## Invocation",
    "",
    `- Working directory: ${triage.working_directory}`,
    `- Target repo is git: ${String(triage.target_repo_is_git)}`,
    `- Model: ${triage.model}`,
    `- Model catalog: ${triage.model_catalog_json}`,
    `- SQLite home: ${triage.sqlite_home}`,
    `- Prompt length: ${triage.prompt_length}`,
    `- Prompt hash: ${triage.prompt_hash}`,
    `- Prompt contains seeded fake secret raw: ${String(triage.prompt_contains_seeded_fake_secret_raw)}`,
    `- Prompt contains untrusted instruction raw: ${String(triage.prompt_contains_untrusted_instruction_raw)}`,
    `- Uses planner-lite-v2: ${String(triage.uses_planner_lite_v2)}`,
    `- Uses task_graph_json string: ${String(triage.uses_task_graph_json_string)}`,
    "",
    "## Recommended Fixes",
    "",
    ...triage.recommended_fixes.map((fix) => `- ${fix}`),
    ""
  ].join("\n");
}

function recommendedFixes(category: string): string[] {
  const common = [
    "Keep adversarial planner prompt compressed and planner-lite-v2 only.",
    "Run planner-only parity, lite-minimal, and exact smokes before another treatment rerun.",
    "Do not include raw seeded fake secret or raw untrusted instruction text in the prompt."
  ];
  if (category === "ADVERSARIAL_PLANNER_TURN_TIMEOUT") {
    return ["Use the new planner-only smoke slices to isolate turn timeout before treatment.", ...common];
  }
  if (category.includes("PROMPT")) {
    return ["Shrink or redact planner prompt before real SDK invocation.", ...common];
  }
  return common;
}

function plannerArtifactsExist(result: Partial<M12RunResult>): boolean {
  const fixtureRepo = result.fixture_repo ?? "";
  return ["docs/PRD.md", "docs/TASK_GRAPH.json", "artifacts/planner-result.json"].every((artifact) =>
    (result.artifacts ?? []).includes(artifact) && existsSync(resolve(fixtureRepo, artifact))
  );
}

function readEventInfo(path: string): { eventCount: number; lastEventType: string; threadStarted: boolean } {
  if (!path || !existsSync(path)) return { eventCount: 0, lastEventType: "", threadStarted: false };
  const lines = readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean);
  let lastEventType = "";
  let threadStarted = false;
  for (const line of lines) {
    try {
      const event = JSON.parse(line) as { type?: unknown };
      if (typeof event.type === "string") {
        lastEventType = event.type;
        if (event.type === "thread.started") threadStarted = true;
      }
    } catch {
      lastEventType = "unparseable";
    }
  }
  return { eventCount: lines.length, lastEventType, threadStarted };
}

function workingDirectoryMatches(trace: Record<string, unknown> | null): boolean {
  const targetRepo = stringValue(pathValue(trace, "target_repo"));
  const workingDirectory = stringValue(pathValue(trace, "start_thread_options", "workingDirectory"));
  if (!targetRepo || !workingDirectory) return true;
  return resolve(targetRepo) === resolve(workingDirectory);
}

function readIfExists(path: string): string {
  if (!existsSync(path)) return "";
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

function pathValue(value: Record<string, unknown> | null | undefined, ...keys: string[]): unknown {
  let current: unknown = value;
  for (const key of keys) {
    if (!isRecord(current)) return "";
    current = current[key];
  }
  return current ?? "";
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function missingTreatmentResult(): M12RunResult {
  return {
    case_id: CASE_ID,
    variant: "treatment",
    mode: "treatment",
    runtime: "sdk-orchestrated",
    status: "BLOCKED",
    real_run_executed: false,
    prompt: "",
    fixture_repo: "",
    acceptance_criteria: [],
    validation_commands: ["npm test", "npm run security:contract"],
    expected_artifacts: [],
    forbidden_files: [],
    changed_files: [],
    artifacts: [],
    validation_logs: [],
    duration_ms: 0,
    thread_count: 0,
    command_count: 0,
    failure_category: "ADVERSARIAL_TREATMENT_RESULT_MISSING",
    errors: ["treatment result missing"]
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const triage = writeAdversarialPlannerTimeoutTriage();
  process.stdout.write(`${JSON.stringify(triage, null, 2)}\n`);
}
