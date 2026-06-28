import { resolve } from "node:path";

import { reconstructAdversarialPlannerSmokeReadiness } from "../../src/effectiveness/adversarial-planner-smoke-readiness.ts";
import { diffAdversarialPlannerInvocation } from "./diff-adversarial-planner-invocation.ts";
import { readJson, writeMarkdown } from "./io.ts";
import type { AdversarialPlannerSmokeResult } from "./run-adversarial-planner-smoke.ts";
import { writeAdversarialPlannerSafetyNotesTriage } from "./triage-adversarial-planner-safety-notes.ts";
import { writeAdversarialCompactPlannerOutputTriage } from "./triage-adversarial-compact-planner-output.ts";
import { writeAdversarialPlannerTruncationTriage } from "./triage-adversarial-planner-truncation.ts";
import { writeAdversarialPlannerTimeoutTriage } from "./triage-adversarial-planner-timeout.ts";
import type { AdversarialPlannerSmokeVerifyResult } from "./verify-adversarial-planner-smoke.ts";

const reportDir = "evals/effectiveness/reports/adversarial-prompt-injection-001";

export function reportAdversarialPlannerSmoke(repoRoot = process.cwd()): AdversarialPlannerSmokeResult | null {
  const result = readJson<AdversarialPlannerSmokeResult | null>(resolve(repoRoot, reportDir, "adversarial-planner-smoke-result.json"), null);
  const verify = readJson<AdversarialPlannerSmokeVerifyResult | null>(resolve(repoRoot, reportDir, "adversarial-planner-smoke-verify.json"), null);
  const timeoutTriage = writeAdversarialPlannerTimeoutTriage(repoRoot);
  const truncationTriage = writeAdversarialPlannerTruncationTriage(repoRoot);
  const safetyTriage = writeAdversarialPlannerSafetyNotesTriage(repoRoot);
  const compactOutputTriage = writeAdversarialCompactPlannerOutputTriage(repoRoot);
  const readiness = reconstructAdversarialPlannerSmokeReadiness(repoRoot, { write: true });
  const invocationDiff = diffAdversarialPlannerInvocation(repoRoot);
  const treatmentReady = readiness.ready_for_treatment_rerun && invocationDiff.planner_smoke_treatment_path_aligned;
  const lines = [
    "# Adversarial Planner Smoke Report",
    "",
    `Smoke status: ${result?.status ?? "NOT_RUN"}`,
    `Verify status: ${verify?.status ?? "NOT_RUN"}`,
    `Mode: ${result?.mode ?? ""}`,
    `Real SDK run executed: ${String(result?.real_sdk_run_executed === true)}`,
    `Planner thread started: ${String(result?.planner_thread_started === true)}`,
    `Planner thread id: ${result?.planner_thread_id ?? ""}`,
    `Structured output valid: ${String(result?.structured_output_valid === true)}`,
    `Tasks count: ${String(result?.tasks_count ?? 0)}`,
    `PRD artifact created: ${String(result?.prd_artifact_created === true)}`,
    `TaskGraph artifact created: ${String(result?.task_graph_artifact_created === true)}`,
    `Validation commands include npm test and security contract: ${String(result?.validation_commands_include_required === true)}`,
    `Safety notes include untrusted ignored: ${String(result?.safety_notes_include_untrusted_ignored === true)}`,
    `Safety notes sources checked: ${(result?.safety_notes_sources_checked?.length ? result.safety_notes_sources_checked : safetyTriage.safety_notes_sources_checked).join(", ") || "none"}`,
    `Untrusted ignored evidence present: ${String(Boolean(result?.untrusted_content_ignored_evidence || safetyTriage.untrusted_content_ignored_evidence))}`,
    `No secret access evidence present: ${String(Boolean(result?.no_secret_access_evidence || safetyTriage.no_secret_access_evidence))}`,
    `Forbidden file protection evidence present: ${String(Boolean(result?.forbidden_file_protection_evidence || safetyTriage.forbidden_file_protection_evidence))}`,
    `Planner-lite-v2 used: ${String(result?.planner_lite_v2_used === true)}`,
    `Compact planner contract used: ${String(result?.compact_planner_contract_used === true)}`,
    `Deterministic hydrator used: ${String(result?.deterministic_hydrator_used === true)}`,
    `task_graph_json string used: ${String(result?.task_graph_json_string_used === true)}`,
    `Prompt length: ${String(result?.prompt_length ?? 0)}`,
    `Prompt contains seeded fake secret raw: ${String(result?.prompt_contains_seeded_fake_secret_raw === true)}`,
    `Prompt contains untrusted instruction raw: ${String(result?.prompt_contains_untrusted_instruction_raw === true)}`,
    `Seeded fake secret leaked: ${String(result?.seeded_fake_secret_leaked === true)}`,
    `Real secret leak detected: ${String(result?.real_secret_leak_detected === true)}`,
    `Failure category: ${result?.mode === "exact" ? compactOutputTriage.failure_category_corrected : result?.failure_category ?? ""}`,
    `Planner smoke/treatment path aligned: ${String(invocationDiff.planner_smoke_treatment_path_aligned)}`,
    `Alignment evidence source: ${invocationDiff.alignment_evidence_source}`,
    `Alignment evidence mtime: ${invocationDiff.alignment_evidence_mtime}`,
    `Stale alignment evidence ignored: ${String(invocationDiff.stale_alignment_evidence_ignored)}`,
    "",
    "## Compact Output Triage",
    `Failure category before: ${compactOutputTriage.failure_category_before}`,
    `Failure category corrected: ${compactOutputTriage.failure_category_corrected}`,
    `Output schema passed to SDK: ${String(compactOutputTriage.output_schema_was_passed_to_sdk)}`,
    `Output schema hash: ${compactOutputTriage.output_schema_hash}`,
    `Raw output bytes: ${String(compactOutputTriage.raw_output_bytes)}`,
    `Raw output contains JSON candidate: ${String(compactOutputTriage.raw_output_contains_json_candidate)}`,
    `Parser read wrong field: ${String(compactOutputTriage.parser_read_wrong_field)}`,
    `Hydrator triggered: ${String(compactOutputTriage.hydrator_triggered)}`,
    `Lite-minimal passed same adapter: ${String(compactOutputTriage.lite_minimal_passed_same_adapter)}`,
    `Exact uses same adapter as lite-minimal: ${String(compactOutputTriage.exact_uses_same_adapter_as_lite_minimal)}`,
    `Can reparse existing output: ${String(compactOutputTriage.can_reparse_existing_output)}`,
    `Requires fresh exact rerun: ${String(compactOutputTriage.requires_fresh_exact_rerun)}`,
    "",
    "## Timeout Triage",
    `Failure category: ${timeoutTriage.failure_category}`,
    `Planner thread started: ${String(timeoutTriage.planner_thread_started)}`,
    `Planner completed: ${String(timeoutTriage.planner_completed)}`,
    `Prompt length: ${String(timeoutTriage.prompt_length)}`,
    `Prompt contains seeded fake secret raw: ${String(timeoutTriage.prompt_contains_seeded_fake_secret_raw)}`,
    `Prompt contains untrusted instruction raw: ${String(timeoutTriage.prompt_contains_untrusted_instruction_raw)}`,
    "",
    "## Truncation Triage",
    `Failure category: ${truncationTriage.failure_category}`,
    `Planner output started: ${String(truncationTriage.planner_output_started)}`,
    `Planner output completed: ${String(truncationTriage.planner_output_completed)}`,
    `Output truncated detected: ${String(truncationTriage.output_truncated_detected)}`,
    `Smoke exact path matches treatment path: ${String(truncationTriage.smoke_exact_path_matches_treatment_path)}`,
    "",
    "## Safety Notes Triage",
    `Can reverify existing exact: ${String(safetyTriage.can_reverify_existing_exact)}`,
    `Requires fresh exact rerun: ${String(safetyTriage.requires_fresh_exact_rerun)}`,
    `Explicit untrusted content ignored: ${String(safetyTriage.explicit_untrusted_content_ignored_present)}`,
    `Explicit no secret access: ${String(safetyTriage.explicit_no_secret_access_present)}`,
    `Explicit no secret output: ${String(safetyTriage.explicit_no_secret_output_present)}`,
    `Explicit forbidden file protection: ${String(safetyTriage.explicit_forbidden_file_protection_present)}`,
    "",
    "## Invocation Diff",
    `Status: ${invocationDiff.status}`,
    `Compared against: ${invocationDiff.compared_against_case_ids.join(", ") || "none"}`,
    `Critical diffs: ${invocationDiff.critical_diffs.join(", ") || "none"}`,
    `Planner smoke/treatment path aligned: ${String(invocationDiff.planner_smoke_treatment_path_aligned)}`,
    `Alignment evidence source: ${invocationDiff.alignment_evidence_source}`,
    `Alignment evidence mtime: ${invocationDiff.alignment_evidence_mtime}`,
    `Stale alignment evidence ignored: ${String(invocationDiff.stale_alignment_evidence_ignored)}`,
    "",
    "## Readiness State",
    `parity: ${readiness.parity.status}`,
    `lite-minimal: ${readiness.lite_minimal.status}`,
    `exact: ${readiness.exact.status}`,
    `dev-worker exact: ${readiness.dev_worker_exact_status}`,
    `ready_for_treatment_rerun: ${String(treatmentReady)}`,
    "M12 production ready: false",
    "",
    "## Required Smoke Order",
    "- parity",
    "- lite-minimal",
    "- exact",
    "",
    "Only after all three real planner-only smokes pass, and existing dev-worker exact smoke remains PASS, may one approved adversarial treatment fresh rerun be considered.",
    ""
  ];
  writeMarkdown(resolve(repoRoot, reportDir, "AdversarialPlannerSmokeReport.md"), `${lines.join("\n")}\n`);
  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = reportAdversarialPlannerSmoke();
  process.stdout.write(`${JSON.stringify(result ?? { status: "NOT_RUN" }, null, 2)}\n`);
}
