import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { validateAndHydrateAdversarialCompactPlan } from "../../src/effectiveness/adversarial-plan-hydrator.ts";
import { validateAdversarialCompactPlannerOutput } from "../../src/effectiveness/adversarial-compact-planner-contract.ts";
import { readJson, writeJson, writeMarkdown } from "./io.ts";
import type { AdversarialPlannerSmokeResult } from "./run-adversarial-planner-smoke.ts";
import { writeAdversarialPlannerPathAlignmentTriage } from "./triage-adversarial-planner-path-alignment.ts";

const CASE_ID = "adversarial-prompt-injection-001";
const REPORT_DIR = `evals/effectiveness/reports/${CASE_ID}`;
const LOG_DIR = `${REPORT_DIR}/sdk-stage-logs`;

export type AdversarialCompactPlannerFailureCategory =
  | "ADVERSARIAL_COMPACT_PLANNER_NO_FINAL_OUTPUT"
  | "ADVERSARIAL_COMPACT_PLANNER_OUTPUT_SCHEMA_NOT_PASSED"
  | "ADVERSARIAL_COMPACT_PLANNER_OUTPUT_SCHEMA_TOO_COMPLEX"
  | "ADVERSARIAL_COMPACT_PLANNER_STRUCTURED_OUTPUT_INVALID"
  | "ADVERSARIAL_COMPACT_PLANNER_RAW_JSON_RECOVERABLE"
  | "ADVERSARIAL_COMPACT_PLANNER_PARSER_FIELD_MISMATCH"
  | "ADVERSARIAL_COMPACT_PLANNER_HYDRATOR_NOT_TRIGGERED"
  | "ADVERSARIAL_COMPACT_PLANNER_HYDRATION_FAILED"
  | "ADVERSARIAL_COMPACT_PLANNER_PATH_ALIGNMENT_FAILED"
  | "";

export interface AdversarialCompactPlannerOutputTriage {
  case_id: "adversarial-prompt-injection-001";
  smoke_mode: "exact";
  failure_category_before: string;
  failure_category_corrected: AdversarialCompactPlannerFailureCategory;
  planner_thread_started: boolean;
  planner_thread_id: string;
  turn_started: boolean;
  turn_completed: boolean;
  turn_failed: boolean;
  event_count: number;
  last_event_type: string;
  raw_output_path: string;
  redacted_output_path: string;
  raw_output_bytes: number;
  output_truncated: boolean;
  raw_output_contains_json_candidate: boolean;
  json_parse_error: string;
  structured_output_valid: boolean;
  output_schema_was_passed_to_sdk: boolean;
  output_schema_hash: string;
  output_schema_too_complex: boolean;
  parser_read_wrong_field: boolean;
  hydrator_triggered: boolean;
  hydrator_failure_reason: string;
  lite_minimal_passed_same_adapter: boolean;
  exact_uses_same_adapter_as_lite_minimal: boolean;
  smoke_exact_path_matches_treatment_path: boolean;
  can_reparse_existing_output: boolean;
  requires_fresh_exact_rerun: boolean;
  recommended_fixes: string[];
}

export function writeAdversarialCompactPlannerOutputTriage(repoRoot = process.cwd()): AdversarialCompactPlannerOutputTriage {
  const result = readJson<AdversarialPlannerSmokeResult | null>(resolve(repoRoot, REPORT_DIR, "adversarial-planner-smoke-result.json"), null);
  const exactTrace = readJson<Record<string, unknown> | null>(resolve(repoRoot, LOG_DIR, "adversarial-planner-smoke-exact-invocation-trace-redacted.json"), null);
  const exactSchemaTrace = readJson<Record<string, unknown> | null>(resolve(repoRoot, LOG_DIR, "adversarial-planner-smoke-exact-schema-invocation-trace-redacted.json"), null) ??
    readJson<Record<string, unknown> | null>(resolve(repoRoot, LOG_DIR, "planner-schema-invocation-trace-redacted.json"), null);
  const liteMinimal = readJson<Partial<AdversarialPlannerSmokeResult> | null>(resolve(repoRoot, REPORT_DIR, "adversarial-planner-smoke-lite-minimal-result.json"), null);
  const alignmentTriage = writeAdversarialPlannerPathAlignmentTriage(repoRoot);
  const rawOutputPath = result?.raw_output_path || pathString(exactTrace, "error_capture_paths", "stdout_path");
  const redactedOutputPath = result?.redacted_output_path || (rawOutputPath ? rawOutputPath.replace(/(\.[^.]+)?$/, "-redacted$1") : "");
  const rawOutput = readText(rawOutputPath);
  const validation = rawOutput ? validateAdversarialCompactPlannerOutput(rawOutput) : null;
  const hydration = validation?.status === "PASS"
    ? validateAndHydrateAdversarialCompactPlan(rawOutput, { target_repo: pathString(exactTrace, "target_repo") || undefined })
    : null;
  const eventInfo = readEventInfo(result?.events_path || pathString(exactTrace, "error_capture_paths", "events_path"));
  const outputSchemaWasPassed = Boolean(pathBool(exactTrace, "run_options", "usesOutputSchema") || pathString(exactSchemaTrace, "output_schema_hash"));
  const outputSchemaHash = pathString(exactTrace, "run_options", "outputSchemaHash") || pathString(exactSchemaTrace, "output_schema_hash");
  const canReparse = validation?.status === "PASS" && hydration?.status === "PASS";
  const pathAligned = alignmentTriage.corrected_alignment_status === "PASS";
  const exactUsesSameAdapter = pathString(exactSchemaTrace, "planner_stage_impl") === "runPlannerLiteStage" &&
    pathString(exactSchemaTrace, "sdk_method") === "runStreamed";
  const triage: AdversarialCompactPlannerOutputTriage = {
    case_id: CASE_ID,
    smoke_mode: "exact",
    failure_category_before: result?.failure_category ?? "",
    failure_category_corrected: classifyCorrectedFailure({
      result,
      rawOutput,
      validation,
      hydration,
      outputSchemaWasPassed,
      pathAligned
    }),
    planner_thread_started: result?.planner_thread_started === true || eventInfo.threadStarted,
    planner_thread_id: result?.planner_thread_id ?? "",
    turn_started: eventInfo.turnStarted || result?.last_event_type === "turn.started",
    turn_completed: eventInfo.turnCompleted || result?.structured_output_valid === true,
    turn_failed: !(eventInfo.turnCompleted || result?.structured_output_valid === true),
    event_count: result?.event_count ?? eventInfo.eventCount,
    last_event_type: result?.last_event_type || eventInfo.lastEventType,
    raw_output_path: rawOutputPath,
    redacted_output_path: redactedOutputPath,
    raw_output_bytes: Buffer.byteLength(rawOutput),
    output_truncated: validation?.output_truncated_detected === true,
    raw_output_contains_json_candidate: /\{[\s\S]*\}/.test(rawOutput),
    json_parse_error: validation?.json_parse_error ?? "",
    structured_output_valid: result?.structured_output_valid === true || validation?.status === "PASS",
    output_schema_was_passed_to_sdk: outputSchemaWasPassed,
    output_schema_hash: outputSchemaHash,
    output_schema_too_complex: false,
    parser_read_wrong_field: Boolean(rawOutput && validation?.status === "PASS" && result?.structured_output_valid !== true),
    hydrator_triggered: Boolean(rawOutput && validation?.status === "PASS"),
    hydrator_failure_reason: hydration?.status === "NEEDS_REVISION" ? hydration.errors.join("; ") : "",
    lite_minimal_passed_same_adapter: liteMinimal?.status === "PASS" && liteMinimal.planner_lite_v2_used === true,
    exact_uses_same_adapter_as_lite_minimal: exactUsesSameAdapter,
    smoke_exact_path_matches_treatment_path: pathAligned,
    can_reparse_existing_output: canReparse,
    requires_fresh_exact_rerun: !canReparse,
    recommended_fixes: recommendedFixes(!outputSchemaWasPassed, canReparse, pathAligned)
  };
  writeJson(resolve(repoRoot, REPORT_DIR, "adversarial-compact-planner-output-triage.json"), triage);
  writeMarkdown(resolve(repoRoot, REPORT_DIR, "AdversarialCompactPlannerOutputTriageReport.md"), renderReport(triage));
  return triage;
}

function classifyCorrectedFailure(input: {
  result: AdversarialPlannerSmokeResult | null;
  rawOutput: string;
  validation: ReturnType<typeof validateAdversarialCompactPlannerOutput> | null;
  hydration: ReturnType<typeof validateAndHydrateAdversarialCompactPlan> | null;
  outputSchemaWasPassed: boolean;
  pathAligned: boolean;
}): AdversarialCompactPlannerFailureCategory {
  if (!input.outputSchemaWasPassed) return "ADVERSARIAL_COMPACT_PLANNER_OUTPUT_SCHEMA_NOT_PASSED";
  if (!input.rawOutput.trim() && input.result?.structured_output_valid !== true) return "ADVERSARIAL_COMPACT_PLANNER_NO_FINAL_OUTPUT";
  if (input.result?.status === "PASS" && input.result.structured_output_valid === true && input.pathAligned) return "";
  if (input.validation?.status === "PASS" && input.hydration?.status === "PASS" && input.result?.structured_output_valid !== true) return "ADVERSARIAL_COMPACT_PLANNER_PARSER_FIELD_MISMATCH";
  if (input.validation?.status === "PASS" && !input.hydration) return "ADVERSARIAL_COMPACT_PLANNER_HYDRATOR_NOT_TRIGGERED";
  if (input.validation?.status === "PASS" && input.hydration?.status !== "PASS") return "ADVERSARIAL_COMPACT_PLANNER_HYDRATION_FAILED";
  if (input.validation?.status === "PASS" && !input.pathAligned) return "ADVERSARIAL_COMPACT_PLANNER_PATH_ALIGNMENT_FAILED";
  if (input.validation?.status === "PASS") return "ADVERSARIAL_COMPACT_PLANNER_RAW_JSON_RECOVERABLE";
  return "ADVERSARIAL_COMPACT_PLANNER_STRUCTURED_OUTPUT_INVALID";
}

function readEventInfo(path: string): { eventCount: number; lastEventType: string; threadStarted: boolean; turnStarted: boolean; turnCompleted: boolean } {
  if (!path || !existsSync(path)) return { eventCount: 0, lastEventType: "", threadStarted: false, turnStarted: false, turnCompleted: false };
  const lines = readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean);
  let lastEventType = "";
  let threadStarted = false;
  let turnStarted = false;
  let turnCompleted = false;
  for (const line of lines) {
    try {
      const event = JSON.parse(line) as { type?: unknown };
      if (typeof event.type === "string") {
        lastEventType = event.type;
        if (event.type === "thread.started") threadStarted = true;
        if (event.type === "turn.started") turnStarted = true;
        if (event.type === "turn.completed") turnCompleted = true;
      }
    } catch {
      lastEventType = "unparseable";
    }
  }
  return { eventCount: lines.length, lastEventType, threadStarted, turnStarted, turnCompleted };
}

function recommendedFixes(outputSchemaMissing: boolean, canReparse: boolean, pathAligned: boolean): string[] {
  if (canReparse) {
    return ["Reparse existing compact output, rerun verify/report, and do not rerun SDK."];
  }
  const fixes = [
    "Use the ultra-compact planner schema v2 for exact planner smoke and treatment.",
    "Keep deterministic hydrator responsible for PRD and TaskGraph generation.",
    "Require one fresh exact compact planner smoke before treatment rerun."
  ];
  if (outputSchemaMissing) fixes.unshift("Ensure outputSchema is passed to the SDK run options.");
  if (!pathAligned) fixes.push("Keep exact smoke and treatment prompt/schema/hydrator invocation hashes aligned.");
  return fixes;
}

function renderReport(triage: AdversarialCompactPlannerOutputTriage): string {
  return [
    "# Adversarial Compact Planner Output Triage",
    "",
    `Case: ${triage.case_id}`,
    `Smoke mode: ${triage.smoke_mode}`,
    `Failure category before: ${triage.failure_category_before}`,
    `Failure category corrected: ${triage.failure_category_corrected}`,
    `Planner thread started: ${String(triage.planner_thread_started)}`,
    `Planner thread id: ${triage.planner_thread_id}`,
    `Turn started: ${String(triage.turn_started)}`,
    `Turn completed: ${String(triage.turn_completed)}`,
    `Event count: ${triage.event_count}`,
    `Last event type: ${triage.last_event_type}`,
    `Raw output bytes: ${triage.raw_output_bytes}`,
    `Output schema passed to SDK: ${String(triage.output_schema_was_passed_to_sdk)}`,
    `Output schema hash: ${triage.output_schema_hash}`,
    `Structured output valid: ${String(triage.structured_output_valid)}`,
    `Hydrator triggered: ${String(triage.hydrator_triggered)}`,
    `Can reparse existing output: ${String(triage.can_reparse_existing_output)}`,
    `Requires fresh exact rerun: ${String(triage.requires_fresh_exact_rerun)}`,
    `Smoke exact path matches treatment path: ${String(triage.smoke_exact_path_matches_treatment_path)}`,
    "",
    "## Recommended Fixes",
    ...triage.recommended_fixes.map((fix) => `- ${fix}`),
    ""
  ].join("\n");
}

function pathString(value: Record<string, unknown> | null | undefined, ...keys: string[]): string {
  const field = pathValue(value, ...keys);
  return typeof field === "string" ? field : "";
}

function pathBool(value: Record<string, unknown> | null | undefined, ...keys: string[]): boolean {
  return pathValue(value, ...keys) === true;
}

function pathValue(value: Record<string, unknown> | null | undefined, ...keys: string[]): unknown {
  let current: unknown = value;
  for (const key of keys) {
    if (!isRecord(current)) return "";
    current = current[key];
  }
  return current ?? "";
}

function readText(path: string): string {
  if (!path || !existsSync(path)) return "";
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
  const result = writeAdversarialCompactPlannerOutputTriage();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
