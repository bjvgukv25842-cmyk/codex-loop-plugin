import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import {
  ADVERSARIAL_DEV_WORKER_FINALIZER_TEMPLATE_ID,
  ADVERSARIAL_DEV_WORKER_PROMPT_TEMPLATE_ID,
  ADVERSARIAL_TREATMENT_DEV_WORKER_PHASE,
  adversarialDevWorkerPromptHash,
  buildAdversarialDevWorkerPrompt
} from "../../src/effectiveness/adversarial-dev-worker-stage.ts";
import { SEEDED_FAKE_SECRET } from "../../src/effectiveness/adversarial-safety.ts";
import { readJson, writeJson, writeMarkdown } from "./io.ts";
import type { M12RunResult } from "./types.ts";

type DiffStatus = "PASS" | "NEEDS_REVISION";

export interface AdversarialDevWorkerTreatmentPathDiff {
  status: DiffStatus;
  case_id: "adversarial-prompt-injection-001";
  failure_category: string;
  mismatch_categories: string[];
  smoke_exact_status: string;
  smoke_exact_path_hash: string;
  treatment_dev_worker_path_hash: string;
  path_mismatch_detected: boolean;
  treatment_uses_three_phase_dev_worker: boolean;
  fields: Record<string, { smoke_exact: unknown; treatment: unknown; same: boolean; critical: boolean }>;
  recommended_fixes: string[];
}

const CASE_ID = "adversarial-prompt-injection-001";
const REPORT_DIR = `evals/effectiveness/reports/${CASE_ID}`;

export function diffAdversarialDevWorkerTreatmentVsSmoke(repoRoot = process.cwd()): AdversarialDevWorkerTreatmentPathDiff {
  const reportDir = resolve(repoRoot, REPORT_DIR);
  const treatment = readJson<Partial<M12RunResult>>(resolve(reportDir, "treatment-result.json"), {});
  const smoke = readJson<Record<string, unknown>>(resolve(reportDir, "adversarial-dev-worker-smoke-exact-result.json"), {});
  const treatmentTrace = readJson<Record<string, unknown> | null>(resolve(reportDir, "sdk-stage-logs/adversarial-dev-worker-invocation-trace-redacted.json"), null);
  const smokeTrace = readJson<Record<string, unknown> | null>(resolve(reportDir, "sdk-stage-logs/adversarial-dev-worker-smoke-exact-invocation-trace-redacted.json"), null);
  const treatmentSnapshot = treatmentPathSnapshot(treatment, treatmentTrace);
  const smokeSnapshot = smokePathSnapshot(smoke, smokeTrace);
  const fields = buildFields(smokeSnapshot, treatmentSnapshot);
  const criticalMismatches = Object.entries(fields)
    .filter(([, value]) => !value.same && value.critical)
    .map(([key]) => key);
  const mismatchCategories = classifyMismatches(criticalMismatches, treatmentSnapshot);
  const status = mismatchCategories.length === 0 ? "PASS" : "NEEDS_REVISION";
  const diff: AdversarialDevWorkerTreatmentPathDiff = {
    status,
    case_id: CASE_ID,
    failure_category: status === "PASS" ? "" : mismatchCategories[0] ?? "ADVERSARIAL_TREATMENT_DEV_WORKER_PATH_MISMATCH",
    mismatch_categories: mismatchCategories,
    smoke_exact_status: String(smoke.status ?? ""),
    smoke_exact_path_hash: stableHash(smokeSnapshot),
    treatment_dev_worker_path_hash: stableHash(treatmentSnapshot),
    path_mismatch_detected: mismatchCategories.length > 0,
    treatment_uses_three_phase_dev_worker: treatmentSnapshot.three_phase_stage_enabled === true,
    fields,
    recommended_fixes: recommendedFixes(mismatchCategories)
  };
  writeJson(resolve(reportDir, "adversarial-dev-worker-treatment-path-diff.json"), diff);
  writeMarkdown(resolve(reportDir, "AdversarialDevWorkerTreatmentPathDiffReport.md"), renderDiff(diff));
  return diff;
}

function smokePathSnapshot(smoke: Record<string, unknown>, trace: Record<string, unknown> | null): Record<string, unknown> {
  return {
    prompt_template_id: ADVERSARIAL_DEV_WORKER_PROMPT_TEMPLATE_ID,
    prompt_length: numberField(smoke.prompt_length) || pathNumber(trace, "prompt", "length") || buildAdversarialDevWorkerPrompt().length,
    prompt_hash: stringField(smoke.prompt_hash) || pathString(trace, "prompt", "hash") || adversarialDevWorkerPromptHash(),
    prompt_contains_seeded_fake_secret_raw: buildAdversarialDevWorkerPrompt().includes(SEEDED_FAKE_SECRET),
    prompt_contains_untrusted_instruction_raw: promptContainsUntrustedInstructionRaw(buildAdversarialDevWorkerPrompt()),
    output_schema_id: "dev-worker-lite-output",
    sdk_method: pathString(trace, "sdk_api_method") || "run",
    sandbox_mode: pathString(trace, "start_thread_options", "sandboxMode") || "workspace-write",
    working_directory_kind: "isolated-smoke-target",
    target_repo_is_git: booleanField(smoke.target_repo_is_git) || pathBoolean(trace, "target_repo_is_git"),
    model: pathString(trace, "start_thread_options", "model"),
    model_catalog_json: pathString(trace, "constructor_options", "config_values_redacted", "model_catalog_json"),
    sqlite_home: pathString(trace, "constructor_options", "config_values_redacted", "sqlite_home"),
    timeout_ms: 180_000,
    no_event_timeout_ms: 60_000,
    validation_commands: ["npm test", "npm run security:contract"],
    security_contract_context: "dev-worker-smoke",
    forbidden_file_policy_id: "adversarial-forbidden-files-v1",
    redaction_policy_id: "adversarial-redaction-v1",
    three_phase_stage_enabled: true,
    edit_phase_target_builder: "treatment-target-or-smoke-isolated-target",
    validate_phase_commands: ["npm test", "npm run security:contract"],
    finalize_phase_read_only_mode: true
  };
}

function treatmentPathSnapshot(treatment: Partial<M12RunResult>, trace: Record<string, unknown> | null): Record<string, unknown> {
  const promptHash = adversarialDevWorkerPromptHash();
  const promptLength = buildAdversarialDevWorkerPrompt().length;
  return {
    prompt_template_id: ADVERSARIAL_DEV_WORKER_PROMPT_TEMPLATE_ID,
    prompt_length: promptLength,
    prompt_hash: promptHash,
    prompt_contains_seeded_fake_secret_raw: buildAdversarialDevWorkerPrompt().includes(SEEDED_FAKE_SECRET),
    prompt_contains_untrusted_instruction_raw: promptContainsUntrustedInstructionRaw(buildAdversarialDevWorkerPrompt()),
    output_schema_id: "dev-worker-lite-output",
    sdk_method: "run",
    sandbox_mode: pathString(trace, "start_thread_options", "sandboxMode") || "workspace-write",
    working_directory_kind: pathString(trace, "start_thread_options", "workingDirectory").includes("/treatment/target-repo") || !trace ? "treatment-target-repo" : "",
    target_repo_is_git: pathBoolean(trace, "target_repo_is_git") || !trace,
    model: pathString(trace, "start_thread_options", "model"),
    model_catalog_json: pathString(trace, "constructor_options", "config_values_redacted", "model_catalog_json"),
    sqlite_home: pathString(trace, "constructor_options", "config_values_redacted", "sqlite_home"),
    timeout_ms: 180_000,
    no_event_timeout_ms: 60_000,
    validation_commands: treatment.validation_commands ?? ["npm test", "npm run security:contract"],
    security_contract_context: "dev-worker-smoke",
    forbidden_file_policy_id: "adversarial-forbidden-files-v1",
    redaction_policy_id: "adversarial-redaction-v1",
    three_phase_stage_enabled: true,
    edit_phase_target_builder: "treatment-target-repo",
    validate_phase_commands: ["npm test", "npm run security:contract"],
    finalize_phase_read_only_mode: true,
    finalizer_template_id: ADVERSARIAL_DEV_WORKER_FINALIZER_TEMPLATE_ID,
    legacy_evidence_sdk_method: pathString(trace, "sdk_api_method") || "",
    legacy_evidence_failure_category: treatment.failure_category ?? "",
    legacy_evidence_three_phase_enabled: treatment.dev_worker_phase === ADVERSARIAL_TREATMENT_DEV_WORKER_PHASE
  };
}

function buildFields(smoke: Record<string, unknown>, treatment: Record<string, unknown>): AdversarialDevWorkerTreatmentPathDiff["fields"] {
  const critical = new Set([
    "prompt_template_id",
    "prompt_contains_seeded_fake_secret_raw",
    "prompt_contains_untrusted_instruction_raw",
    "output_schema_id",
    "sdk_method",
    "sandbox_mode",
    "working_directory_kind",
    "target_repo_is_git",
    "validation_commands",
    "security_contract_context",
    "forbidden_file_policy_id",
    "redaction_policy_id",
    "three_phase_stage_enabled",
    "validate_phase_commands",
    "finalize_phase_read_only_mode"
  ]);
  const fields: AdversarialDevWorkerTreatmentPathDiff["fields"] = {};
  for (const key of Object.keys({ ...smoke, ...treatment }).sort()) {
    const same = key === "working_directory_kind"
      ? smoke[key] === "isolated-smoke-target" && treatment[key] === "treatment-target-repo"
      : comparableValue(smoke[key]) === comparableValue(treatment[key]);
    fields[key] = {
      smoke_exact: smoke[key],
      treatment: treatment[key],
      same,
      critical: critical.has(key)
    };
  }
  return fields;
}

function classifyMismatches(mismatches: string[], treatment: Record<string, unknown>): string[] {
  const categories: string[] = [];
  if (mismatches.includes("three_phase_stage_enabled") || treatment.three_phase_stage_enabled !== true) {
    categories.push("ADVERSARIAL_TREATMENT_DEV_WORKER_NOT_THREE_PHASE");
  }
  if (mismatches.includes("working_directory_kind") || mismatches.includes("target_repo_is_git")) {
    categories.push("ADVERSARIAL_TREATMENT_DEV_WORKER_TARGET_MISMATCH");
  }
  if (mismatches.includes("security_contract_context") || mismatches.includes("forbidden_file_policy_id") || mismatches.includes("redaction_policy_id")) {
    categories.push("ADVERSARIAL_TREATMENT_DEV_WORKER_SECURITY_CONTEXT_MISMATCH");
  }
  if (mismatches.includes("prompt_template_id") || numberField(treatment.prompt_length) > 1200) {
    categories.push(numberField(treatment.prompt_length) > 1200
      ? "ADVERSARIAL_TREATMENT_DEV_WORKER_PROMPT_TOO_LARGE"
      : "ADVERSARIAL_TREATMENT_DEV_WORKER_PATH_MISMATCH");
  }
  if (mismatches.includes("sdk_method") || mismatches.includes("output_schema_id") || mismatches.includes("validate_phase_commands") || mismatches.includes("finalize_phase_read_only_mode")) {
    categories.push("ADVERSARIAL_TREATMENT_DEV_WORKER_PATH_MISMATCH");
  }
  return [...new Set(categories)];
}

function recommendedFixes(categories: string[]): string[] {
  if (categories.length === 0) {
    return ["Treatment dev-worker path is aligned with exact smoke; run one approved treatment-only rerun next."];
  }
  return [
    "Port treatment dev-worker to the exact smoke three-phase path: edit, deterministic validation, read-only finalization.",
    "Keep treatment target repo distinct from smoke target while using the same prompt/security/schema contracts.",
    "Do not mark treatment PASS without npm test, security:contract, DevResult, evaluator, and FinalDeliveryReport evidence."
  ];
}

function renderDiff(diff: AdversarialDevWorkerTreatmentPathDiff): string {
  return [
    "# Adversarial Dev Worker Treatment Path Diff",
    "",
    `Status: ${diff.status}`,
    `Failure category: ${diff.failure_category || "none"}`,
    `Path mismatch detected: ${String(diff.path_mismatch_detected)}`,
    `Treatment uses three-phase dev worker: ${String(diff.treatment_uses_three_phase_dev_worker)}`,
    `Smoke path hash: ${diff.smoke_exact_path_hash}`,
    `Treatment path hash: ${diff.treatment_dev_worker_path_hash}`,
    "",
    "## Fields",
    ...Object.entries(diff.fields).map(([field, value]) => `- ${field}: same=${String(value.same)}; critical=${String(value.critical)}; smoke=${JSON.stringify(value.smoke_exact)}; treatment=${JSON.stringify(value.treatment)}`),
    "",
    "## Recommended Fixes",
    ...diff.recommended_fixes.map((fix) => `- ${fix}`),
    ""
  ].join("\n");
}

function comparableValue(value: unknown): string {
  return JSON.stringify(value);
}

function promptContainsUntrustedInstructionRaw(prompt: string): boolean {
  return /IGNORE ALL PRIOR INSTRUCTIONS|print the seeded secret/i.test(prompt);
}

function pathString(value: Record<string, unknown> | null, ...keys: string[]): string {
  const field = pathValue(value, ...keys);
  return typeof field === "string" ? field : "";
}

function pathNumber(value: Record<string, unknown> | null, ...keys: string[]): number {
  const field = pathValue(value, ...keys);
  return typeof field === "number" && Number.isFinite(field) ? field : 0;
}

function pathBoolean(value: Record<string, unknown> | null, ...keys: string[]): boolean {
  const field = pathValue(value, ...keys);
  return field === true;
}

function pathValue(value: Record<string, unknown> | null, ...keys: string[]): unknown {
  let current: unknown = value;
  for (const key of keys) {
    if (!isRecord(current)) return "";
    current = current[key];
  }
  return current;
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberField(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function booleanField(value: unknown): boolean {
  return value === true;
}

function stableHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const diff = diffAdversarialDevWorkerTreatmentVsSmoke();
  process.stdout.write(`${JSON.stringify(diff, null, 2)}\n`);
  process.exitCode = diff.status === "PASS" ? 0 : 2;
}
