import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";

import {
  buildSmokeAdversarialPlannerCanonicalConfig,
  buildTreatmentAdversarialPlannerCanonicalConfig,
  compareAdversarialPlannerCanonicalConfigs
} from "../../src/effectiveness/adversarial-planner-path-alignment.ts";
import { loadM12Dataset } from "./dataset.ts";
import { readJson, writeJson, writeMarkdown } from "./io.ts";
import type { AdversarialPlannerSmokeResult } from "./run-adversarial-planner-smoke.ts";

const CASE_ID = "adversarial-prompt-injection-001";
const REPORT_DIR = `evals/effectiveness/reports/${CASE_ID}`;
const LOG_DIR = `${REPORT_DIR}/sdk-stage-logs`;

export interface AdversarialPlannerPathAlignmentTriage {
  case_id: "adversarial-prompt-injection-001";
  smoke_mode: "exact";
  latest_exact_smoke_status: "PASS" | "NEEDS_REVISION";
  alignment_status_before: "PASS" | "NEEDS_REVISION" | "NOT_RUN";
  alignment_failure_category_before: "ADVERSARIAL_PLANNER_TREATMENT_PATH_MISMATCH" | "";
  stale_alignment_evidence_detected: boolean;
  actual_path_mismatch_detected: boolean;
  smoke_prompt_builder_hash: string;
  treatment_prompt_builder_hash: string;
  smoke_schema_hash: string;
  treatment_schema_hash: string;
  smoke_hydrator_hash: string;
  treatment_hydrator_hash: string;
  smoke_adapter_path_hash: string;
  treatment_adapter_path_hash: string;
  smoke_redaction_policy_hash: string;
  treatment_redaction_policy_hash: string;
  mismatched_fields: string[];
  corrected_alignment_status: "PASS" | "NEEDS_REVISION" | "BLOCKED";
  evidence_source_paths: string[];
  evidence_mtimes: Record<string, string>;
  recommended_fixes: string[];
}

export function writeAdversarialPlannerPathAlignmentTriage(repoRoot = process.cwd()): AdversarialPlannerPathAlignmentTriage {
  const smokeResultPath = resolve(repoRoot, REPORT_DIR, "adversarial-planner-smoke-exact-result.json");
  const genericSmokeResultPath = resolve(repoRoot, REPORT_DIR, "adversarial-planner-smoke-result.json");
  const diffPath = resolve(repoRoot, REPORT_DIR, "adversarial-planner-invocation-diff.json");
  const smokeTracePath = resolve(repoRoot, LOG_DIR, "adversarial-planner-smoke-exact-invocation-trace-redacted.json");
  const smokeSchemaPath = resolve(repoRoot, LOG_DIR, "adversarial-planner-smoke-exact-schema-invocation-trace-redacted.json");
  const treatmentTracePath = resolve(repoRoot, LOG_DIR, "adversarial-planner-invocation-trace-redacted.json");
  const treatmentSchemaPath = resolve(repoRoot, LOG_DIR, "adversarial-planner-schema-invocation-trace-redacted.json");
  const legacyTreatmentSchemaPath = resolve(repoRoot, LOG_DIR, "planner-schema-invocation-trace-redacted.json");

  const smokeResult =
    readJson<AdversarialPlannerSmokeResult | null>(smokeResultPath, null) ??
    readJson<AdversarialPlannerSmokeResult | null>(genericSmokeResultPath, null);
  const previousDiff = readJson<{ status?: string; critical_diffs?: string[] } | null>(diffPath, null);
  const smokeTrace = readJson<Record<string, unknown> | null>(smokeTracePath, null);
  const smokeSchema = readJson<Record<string, unknown> | null>(smokeSchemaPath, null);
  const treatmentTrace = readJson<Record<string, unknown> | null>(treatmentTracePath, null);
  const treatmentSchema = readJson<Record<string, unknown> | null>(treatmentSchemaPath, null) ??
    readJson<Record<string, unknown> | null>(legacyTreatmentSchemaPath, null);
  const testCase = loadM12Dataset().find((entry) => entry.case_id === CASE_ID);
  const treatmentCanonical = testCase
    ? buildTreatmentAdversarialPlannerCanonicalConfig({
      testCase,
      model: stringPath(smokeTrace, "start_thread_options", "model") || stringPath(treatmentTrace, "start_thread_options", "model") || process.env.CODEX_LOOP_CODEX_MODEL || "",
      model_catalog_json: stringPath(smokeTrace, "constructor_options", "config_values_redacted", "model_catalog_json") ||
        stringPath(treatmentTrace, "constructor_options", "config_values_redacted", "model_catalog_json") ||
        process.env.CODEX_LOOP_MODEL_CATALOG_JSON ||
        resolve(repoRoot, "evals/sdk-orchestrated/model-catalog-bundled.json")
    })
    : null;
  const smokeCanonical = buildSmokeAdversarialPlannerCanonicalConfig({
    invocationTrace: smokeTrace,
    schemaTrace: smokeSchema,
    fallback: treatmentCanonical ?? undefined
  });
  const mismatchedFields = treatmentCanonical
    ? compareAdversarialPlannerCanonicalConfigs({ smoke: smokeCanonical, treatment: treatmentCanonical })
    : ["treatment_canonical_config_missing"];
  const staleAlignmentEvidenceDetected = isStale(diffPath, smokeResultPath) || isStale(diffPath, genericSmokeResultPath);
  const latestExactSmokeStatus = smokeResult?.status === "PASS" ? "PASS" : "NEEDS_REVISION";
  const actualMismatchDetected = mismatchedFields.length > 0;
  const correctedStatus: AdversarialPlannerPathAlignmentTriage["corrected_alignment_status"] =
    latestExactSmokeStatus !== "PASS" ? "BLOCKED" : actualMismatchDetected ? "NEEDS_REVISION" : "PASS";
  const sourcePaths = [
    smokeResultPath,
    genericSmokeResultPath,
    diffPath,
    smokeTracePath,
    smokeSchemaPath,
    treatmentTracePath,
    treatmentSchemaPath,
    legacyTreatmentSchemaPath
  ].filter((path, index, array) => existsSync(path) && array.indexOf(path) === index);
  const triage: AdversarialPlannerPathAlignmentTriage = {
    case_id: CASE_ID,
    smoke_mode: "exact",
    latest_exact_smoke_status: latestExactSmokeStatus,
    alignment_status_before: previousDiff?.status === "PASS" ? "PASS" : previousDiff?.status === "NEEDS_REVISION" ? "NEEDS_REVISION" : "NOT_RUN",
    alignment_failure_category_before: previousDiff?.critical_diffs?.includes("ADVERSARIAL_PLANNER_TREATMENT_PATH_MISMATCH") ? "ADVERSARIAL_PLANNER_TREATMENT_PATH_MISMATCH" : "",
    stale_alignment_evidence_detected: staleAlignmentEvidenceDetected,
    actual_path_mismatch_detected: actualMismatchDetected,
    smoke_prompt_builder_hash: smokeCanonical.prompt_builder_hash,
    treatment_prompt_builder_hash: treatmentCanonical?.prompt_builder_hash ?? "",
    smoke_schema_hash: smokeCanonical.schema_hash,
    treatment_schema_hash: treatmentCanonical?.schema_hash ?? "",
    smoke_hydrator_hash: smokeCanonical.hydrator_hash,
    treatment_hydrator_hash: treatmentCanonical?.hydrator_hash ?? "",
    smoke_adapter_path_hash: smokeCanonical.adapter_path_hash,
    treatment_adapter_path_hash: treatmentCanonical?.adapter_path_hash ?? "",
    smoke_redaction_policy_hash: smokeCanonical.redaction_policy_hash,
    treatment_redaction_policy_hash: treatmentCanonical?.redaction_policy_hash ?? "",
    mismatched_fields: mismatchedFields,
    corrected_alignment_status: correctedStatus,
    evidence_source_paths: sourcePaths,
    evidence_mtimes: Object.fromEntries(sourcePaths.map((path) => [path, mtime(path)])),
    recommended_fixes: recommendedFixes(correctedStatus, staleAlignmentEvidenceDetected, actualMismatchDetected)
  };
  writeJson(resolve(repoRoot, REPORT_DIR, "adversarial-planner-path-alignment-triage.json"), triage);
  writeMarkdown(resolve(repoRoot, REPORT_DIR, "AdversarialPlannerPathAlignmentTriageReport.md"), renderReport(triage));
  return triage;
}

function recommendedFixes(
  status: AdversarialPlannerPathAlignmentTriage["corrected_alignment_status"],
  stale: boolean,
  mismatch: boolean
): string[] {
  if (status === "PASS" && stale) {
    return ["Regenerate invocation diff from latest exact smoke and ignore stale previous alignment evidence."];
  }
  if (status === "PASS") return [];
  if (mismatch) {
    return ["Fix treatment planner canonical prompt/schema/hydrator/adapter/redaction path before any treatment rerun."];
  }
  return ["Produce a fresh exact planner smoke PASS before alignment can unlock treatment readiness."];
}

function renderReport(triage: AdversarialPlannerPathAlignmentTriage): string {
  return [
    "# Adversarial Planner Path Alignment Triage",
    "",
    `Case: ${triage.case_id}`,
    `Smoke mode: ${triage.smoke_mode}`,
    `Latest exact smoke status: ${triage.latest_exact_smoke_status}`,
    `Alignment status before: ${triage.alignment_status_before}`,
    `Alignment failure category before: ${triage.alignment_failure_category_before}`,
    `Stale alignment evidence detected: ${String(triage.stale_alignment_evidence_detected)}`,
    `Actual path mismatch detected: ${String(triage.actual_path_mismatch_detected)}`,
    `Corrected alignment status: ${triage.corrected_alignment_status}`,
    `Mismatched fields: ${triage.mismatched_fields.join(", ") || "none"}`,
    "",
    "## Canonical Hashes",
    `Smoke prompt builder hash: ${triage.smoke_prompt_builder_hash}`,
    `Treatment prompt builder hash: ${triage.treatment_prompt_builder_hash}`,
    `Smoke schema hash: ${triage.smoke_schema_hash}`,
    `Treatment schema hash: ${triage.treatment_schema_hash}`,
    `Smoke hydrator hash: ${triage.smoke_hydrator_hash}`,
    `Treatment hydrator hash: ${triage.treatment_hydrator_hash}`,
    `Smoke adapter path hash: ${triage.smoke_adapter_path_hash}`,
    `Treatment adapter path hash: ${triage.treatment_adapter_path_hash}`,
    `Smoke redaction policy hash: ${triage.smoke_redaction_policy_hash}`,
    `Treatment redaction policy hash: ${triage.treatment_redaction_policy_hash}`,
    "",
    "## Evidence Sources",
    ...triage.evidence_source_paths.map((path) => `- ${path}: ${triage.evidence_mtimes[path] ?? ""}`),
    "",
    "## Recommended Fixes",
    ...(triage.recommended_fixes.length ? triage.recommended_fixes.map((fix) => `- ${fix}`) : ["- none"]),
    ""
  ].join("\n");
}

function isStale(candidatePath: string, referencePath: string): boolean {
  if (!existsSync(candidatePath) || !existsSync(referencePath)) return false;
  return statSync(candidatePath).mtimeMs < statSync(referencePath).mtimeMs;
}

function mtime(path: string): string {
  try {
    return statSync(path).mtime.toISOString();
  } catch {
    return "";
  }
}

function stringPath(value: Record<string, unknown> | null | undefined, ...keys: string[]): string {
  let current: unknown = value;
  for (const key of keys) {
    if (!isRecord(current)) return "";
    current = current[key];
  }
  return typeof current === "string" ? current : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const triage = writeAdversarialPlannerPathAlignmentTriage();
  process.stdout.write(`${JSON.stringify(triage, null, 2)}\n`);
  process.exitCode = triage.corrected_alignment_status === "PASS" ? 0 : 2;
}
