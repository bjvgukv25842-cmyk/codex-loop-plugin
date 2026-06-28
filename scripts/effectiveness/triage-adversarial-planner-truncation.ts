import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  ADVERSARIAL_PLANNER_OUTPUT_CONTRACT_VERSION,
  containsUntrustedInstructionRaw
} from "../../src/effectiveness/adversarial-planner-stage.ts";
import {
  isLikelyTruncatedJson,
  validateAdversarialCompactPlannerOutput
} from "../../src/effectiveness/adversarial-compact-planner-contract.ts";
import { SEEDED_FAKE_SECRET } from "../../src/effectiveness/adversarial-safety.ts";
import { readJson, writeJson, writeMarkdown } from "./io.ts";
import type { M12RunResult } from "./types.ts";
import { writeAdversarialPlannerPathAlignmentTriage } from "./triage-adversarial-planner-path-alignment.ts";

const CASE_ID = "adversarial-prompt-injection-001";
const REPORT_DIR = `evals/effectiveness/reports/${CASE_ID}`;

export interface AdversarialPlannerTruncationTriage {
  case_id: "adversarial-prompt-injection-001";
  failure_category: "ADVERSARIAL_PLANNER_PROMPT_TOO_LARGE" | "ADVERSARIAL_PLANNER_OUTPUT_TRUNCATED" | "ADVERSARIAL_PLANNER_JSON_INVALID";
  planner_thread_id_present: boolean;
  dev_worker_thread_id_present: boolean;
  planner_output_started: boolean;
  planner_output_completed: boolean;
  raw_output_path: string;
  redacted_output_path: string;
  raw_output_bytes: number;
  output_truncated_detected: boolean;
  json_parse_error: string;
  prompt_length: number;
  prompt_section_count: number;
  output_schema_hash: string;
  uses_planner_lite_v2: boolean;
  uses_task_graph_json_string: false;
  prompt_contains_seeded_fake_secret_raw: boolean;
  prompt_contains_untrusted_instruction_raw: boolean;
  smoke_exact_path_matches_treatment_path: boolean;
  recommended_fixes: string[];
}

export function writeAdversarialPlannerTruncationTriage(repoRoot = process.cwd()): AdversarialPlannerTruncationTriage {
  const treatment = readJson<M12RunResult>(resolve(repoRoot, REPORT_DIR, "treatment-result.json"), missingTreatmentResult());
  const treatmentTrace = readJson<Record<string, unknown> | null>(resolve(repoRoot, REPORT_DIR, "sdk-stage-logs/adversarial-planner-invocation-trace-redacted.json"), null);
  const treatmentSchema = readJson<Record<string, unknown> | null>(resolve(repoRoot, REPORT_DIR, "sdk-stage-logs/planner-schema-invocation-trace-redacted.json"), null);
  const alignmentTriage = writeAdversarialPlannerPathAlignmentTriage(repoRoot);
  const rawOutputPath = stringValue(treatment.planner_raw_output_path || treatment.planner_stdout_path || pathValue(treatmentTrace, "error_capture_paths", "stdout_path"));
  const redactedOutputPath = stringValue(treatment.planner_redacted_output_path || (rawOutputPath ? rawOutputPath.replace(/(\.[^.]+)?$/, "-redacted$1") : ""));
  const rawOutput = readIfExists(rawOutputPath);
  const compactValidation = rawOutput ? validateAdversarialCompactPlannerOutput(rawOutput) : null;
  const jsonParseError = compactValidation?.json_parse_error ?? "";
  const outputTruncated = compactValidation?.output_truncated_detected === true || isLikelyTruncatedJson(rawOutput, jsonParseError);
  const promptLength = numberValue(treatment.planner_prompt_length) || numberValue(pathValue(treatmentTrace, "prompt", "length")) || numberValue(pathValue(treatmentSchema, "prompt_length"));
  const promptText = readIfExists(resolve(repoRoot, REPORT_DIR, "sdk-stage-logs/adversarial-planner-prompt-redacted.txt"));
  const failureCategory = classifyFailureCategory({
    existing: stringValue(treatment.corrected_failure_category || treatment.failure_category),
    promptLength,
    outputTruncated,
    jsonParseError,
    compactFailure: compactValidation?.failure_category ?? ""
  });
  const triage: AdversarialPlannerTruncationTriage = {
    case_id: CASE_ID,
    failure_category: failureCategory,
    planner_thread_id_present: Boolean(treatment.planner_thread_id),
    dev_worker_thread_id_present: Boolean(treatment.dev_worker_thread_id),
    planner_output_started: rawOutput.length > 0,
    planner_output_completed: compactValidation?.status === "PASS",
    raw_output_path: rawOutputPath,
    redacted_output_path: redactedOutputPath,
    raw_output_bytes: Buffer.byteLength(rawOutput),
    output_truncated_detected: outputTruncated,
    json_parse_error: jsonParseError,
    prompt_length: promptLength,
    prompt_section_count: promptSectionCount(promptText || treatment.prompt || "", promptLength),
    output_schema_hash: stringValue(pathValue(treatmentSchema, "output_schema_hash")),
    uses_planner_lite_v2: (treatment.planner_output_contract_version ?? pathValue(treatmentSchema, "planner_output_contract_version")) === ADVERSARIAL_PLANNER_OUTPUT_CONTRACT_VERSION,
    uses_task_graph_json_string: false,
    prompt_contains_seeded_fake_secret_raw: promptText.includes(SEEDED_FAKE_SECRET),
    prompt_contains_untrusted_instruction_raw: containsUntrustedInstructionRaw(promptText),
    smoke_exact_path_matches_treatment_path: alignmentTriage.corrected_alignment_status === "PASS",
    recommended_fixes: recommendedFixes(failureCategory)
  };
  writeJson(resolve(repoRoot, REPORT_DIR, "adversarial-planner-truncation-triage.json"), triage);
  writeMarkdown(resolve(repoRoot, REPORT_DIR, "AdversarialPlannerTruncationTriageReport.md"), renderReport(triage));
  return triage;
}

function classifyFailureCategory(input: {
  existing: string;
  promptLength: number;
  outputTruncated: boolean;
  jsonParseError: string;
  compactFailure: string;
}): AdversarialPlannerTruncationTriage["failure_category"] {
  if (input.outputTruncated || input.existing === "ADVERSARIAL_PLANNER_OUTPUT_TRUNCATED") return "ADVERSARIAL_PLANNER_OUTPUT_TRUNCATED";
  if (input.compactFailure === "ADVERSARIAL_PLANNER_JSON_INVALID" || input.jsonParseError) return "ADVERSARIAL_PLANNER_JSON_INVALID";
  return "ADVERSARIAL_PLANNER_PROMPT_TOO_LARGE";
}

function recommendedFixes(category: string): string[] {
  const common = [
    "Use the adversarial compact planner contract.",
    "Hydrate PRD and TaskGraph deterministically from compact output.",
    "Keep exact planner smoke and treatment planner on the same prompt/schema/hydrator path.",
    "Do not unlock treatment until exact compact planner smoke PASS evidence exists."
  ];
  if (category === "ADVERSARIAL_PLANNER_OUTPUT_TRUNCATED") {
    return ["Keep planner output small enough to avoid truncated JSON.", ...common];
  }
  if (category === "ADVERSARIAL_PLANNER_JSON_INVALID") {
    return ["Classify invalid complete JSON separately from truncated output.", ...common];
  }
  return ["Keep planner prompt below the adversarial planner budget.", ...common];
}

function renderReport(triage: AdversarialPlannerTruncationTriage): string {
  return [
    "# Adversarial Planner Truncation Triage",
    "",
    `Case: ${triage.case_id}`,
    `Failure category: ${triage.failure_category}`,
    `Planner thread id present: ${String(triage.planner_thread_id_present)}`,
    `Dev worker thread id present: ${String(triage.dev_worker_thread_id_present)}`,
    `Planner output started: ${String(triage.planner_output_started)}`,
    `Planner output completed: ${String(triage.planner_output_completed)}`,
    `Raw output bytes: ${triage.raw_output_bytes}`,
    `Output truncated detected: ${String(triage.output_truncated_detected)}`,
    `JSON parse error: ${triage.json_parse_error}`,
    `Prompt length: ${triage.prompt_length}`,
    `Prompt section count: ${triage.prompt_section_count}`,
    `Uses planner-lite-v2: ${String(triage.uses_planner_lite_v2)}`,
    `Uses task_graph_json string: ${String(triage.uses_task_graph_json_string)}`,
    `Prompt contains seeded fake secret raw: ${String(triage.prompt_contains_seeded_fake_secret_raw)}`,
    `Prompt contains untrusted instruction raw: ${String(triage.prompt_contains_untrusted_instruction_raw)}`,
    `Smoke exact path matches treatment path: ${String(triage.smoke_exact_path_matches_treatment_path)}`,
    "",
    "## Recommended Fixes",
    ...triage.recommended_fixes.map((fix) => `- ${fix}`),
    ""
  ].join("\n");
}

function promptSectionCount(promptText: string, fallbackLength: number): number {
  if (promptText.trim()) return promptText.split(/\n(?=[A-Z][A-Za-z ]+:|- )/).filter(Boolean).length;
  return fallbackLength > 0 ? Math.max(1, Math.ceil(fallbackLength / 120)) : 0;
}

function readIfExists(path: string): string {
  if (!path || !existsSync(path)) return "";
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
    validation_commands: [],
    expected_artifacts: [],
    baseline_expected_artifacts: [],
    forbidden_files: [],
    changed_files: [],
    artifacts: [],
    validation_logs: [],
    evaluator_verdict: "",
    initial_eval_verdict: "",
    final_eval_verdict: "",
    repair_attempted: false,
    repaired: false,
    repair_request_created: false,
    p0_safety_issue: false,
    secret_leak_detected: false,
    seeded_fake_secret_leaked: false,
    real_secret_leak_detected: false,
    dangerous_command_detected: false,
    prompt_injection_followed: false,
    forbidden_files_modified: [],
    tests_deleted_or_weakened: false,
    security_contract_passed: false,
    duration_ms: 0,
    thread_count: 0,
    command_count: 0,
    validation_passed: false,
    danger_full_access_used: false,
    artifact_thread_evidence_verified: false,
    failure_category: "ADVERSARIAL_TREATMENT_RESULT_MISSING",
    errors: []
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = writeAdversarialPlannerTruncationTriage();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
