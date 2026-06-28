import { resolve } from "node:path";

import { readJson, writeMarkdown } from "./io.ts";
import type {
  AdversarialExactCompletionRecoveryResult,
  AdversarialExactCompletionTriage
} from "./run-adversarial-exact-completion-recovery.ts";
import { writeAdversarialCompletionSecurityContractTriage } from "./triage-adversarial-completion-security-contract.ts";
import { writeAdversarialExactSecurityContractModeTriage } from "./triage-adversarial-exact-security-contract-mode.ts";
import type { AdversarialExactCompletionRecoveryVerifyResult } from "./verify-adversarial-exact-completion-recovery.ts";

const reportDir = "evals/effectiveness/reports/adversarial-prompt-injection-001";

export function reportAdversarialExactCompletionRecovery(repoRoot = process.cwd()): AdversarialExactCompletionRecoveryResult | null {
  const result = readJson<AdversarialExactCompletionRecoveryResult | null>(resolve(repoRoot, reportDir, "adversarial-exact-completion-recovery-result.json"), null);
  const verify = readJson<AdversarialExactCompletionRecoveryVerifyResult | null>(resolve(repoRoot, reportDir, "adversarial-exact-completion-recovery-verify.json"), null);
  const triage = readJson<AdversarialExactCompletionTriage | null>(resolve(repoRoot, reportDir, "adversarial-exact-completion-triage.json"), null);
  const contractModeTriage = writeAdversarialExactSecurityContractModeTriage(repoRoot);
  const completionSecurityTriage = writeAdversarialCompletionSecurityContractTriage(repoRoot, {
    context_used: verify?.security_contract_context_used ?? "dev-worker-smoke"
  });
  const lines = [
    "# Adversarial Exact Completion Triage Report",
    "",
    `Module: ${result?.module ?? "M12.10B.13 Adversarial Exact Dev Worker Completion Recovery & Two-Phase Finalization"}`,
    `Status: ${result?.status ?? "NOT_RUN"}`,
    `Verify status: ${verify?.status ?? "NOT_RUN"}`,
    `Failure category: ${triage?.failure_category ?? result?.failure_category ?? ""}`,
    `Real SDK run executed: ${String(result?.real_sdk_run_executed === true)}`,
    `Exact smoke rerun executed: ${String(Boolean(result?.exact_smoke_rerun_executed))}`,
    `Adversarial treatment rerun executed: ${String(Boolean(result?.adversarial_treatment_rerun_executed))}`,
    `Evidence frozen: ${String(result?.evidence_frozen === true)}`,
    `Evidence dir: ${result?.evidence_dir ?? ""}`,
    "",
    "## Partial Exact Evidence",
    `Thread started: ${String(triage?.thread_started === true)}`,
    `Thread id: ${triage?.thread_id ?? ""}`,
    `Turn completed: ${String(triage?.turn_completed === true)}`,
    `Target: ${triage?.target ?? ""}`,
    `Baseline commit: ${triage?.baseline_commit ?? ""}`,
    `Git changed files: ${(triage?.git_changed_files ?? []).join(", ") || "none"}`,
    `Code change present: ${String(triage?.code_change_present === true)}`,
    `Valid DevResult present: ${String(triage?.valid_dev_result_present === true)}`,
    "",
    "## Deterministic Validation",
    `Pre-run validation present: ${String(result?.pre_run_validation_present === true)}`,
    `Pre-run npm test failed: ${String(result?.pre_run_test_failed === true)}`,
    `Post-run validation present: ${String(result?.post_run_validation_present === true)}`,
    `Post-run npm test passed: ${String(result?.post_run_test_passed === true)}`,
    `Security contract passed: ${String(result?.security_contract_passed === true)}`,
    `Security scan clean: ${String(result?.security_scan_clean === true)}`,
    `Ready for one adversarial exact completion recovery: ${String(result?.ready_for_one_adversarial_exact_completion_recovery === true)}`,
    `Completion recovery blockers: ${(result?.completion_recovery_blockers ?? []).join(", ") || "none"}`,
    `Security contract mode detected: ${contractModeTriage.contract_mode_detected}`,
    `Security contract mode expected: ${contractModeTriage.contract_mode_expected}`,
    `Completion security contract context used: ${completionSecurityTriage.security_contract_context_used}`,
    `Completion security contract context expected: ${completionSecurityTriage.security_contract_context_expected}`,
    `Completion context requires FinalDeliveryReport: ${String(completionSecurityTriage.security_contract_required_final_delivery_report)}`,
    `Treatment contract still requires FinalDeliveryReport: ${String(completionSecurityTriage.treatment_contract_unchanged)}`,
    `Forbidden files modified: ${(result?.post_run_validation.forbidden_files_modified ?? []).join(", ") || "none"}`,
    `Seeded fake secret leaked: ${String(result?.post_run_validation.seeded_fake_secret_leaked === true)}`,
    `Real secret leak detected: ${String(result?.post_run_validation.real_secret_leak_detected === true)}`,
    `Prompt injection followed: ${String(result?.post_run_validation.prompt_injection_followed === true)}`,
    "",
    "## Completion Finalizer",
    `Completion enabled: ${String(result?.completion_enabled === true)}`,
    `Completion attempted: ${String(result?.completion_attempted === true)}`,
    `Thread resumable: ${String(result?.thread_resumable === true)}`,
    `Completion DevResult valid: ${String(result?.completion_dev_result_valid === true)}`,
    `Completion DevResult status: ${result?.completion_dev_result_status ?? ""}`,
    `Completion DevResult changed files: ${(result?.completion_dev_result_changed_files ?? []).join(", ") || "none"}`,
    `DevResult prompt_injection_ignored field present: ${String(completionSecurityTriage.dev_result_has_prompt_injection_ignored_field)}`,
    `DevResult prompt_injection_ignored value: ${String(completionSecurityTriage.dev_result_prompt_injection_ignored_value)}`,
    `DevResult security_summary present: ${String(completionSecurityTriage.dev_result_security_summary_present)}`,
    `DevResult security_summary supports ignored: ${String(completionSecurityTriage.dev_result_security_summary_supports_ignored)}`,
    `Completion was read-only: ${String(result?.completion_was_read_only === true)}`,
    `Files modified during completion: ${(result?.files_modified_during_completion ?? []).join(", ") || "none"}`,
    `Can reverify existing completion: ${String(completionSecurityTriage.can_reverify_existing_completion)}`,
    `Requires fresh exact rerun: ${String(completionSecurityTriage.requires_fresh_exact_rerun)}`,
    `Ready for one adversarial exact fresh rerun: ${String(completionSecurityTriage.ready_for_one_adversarial_exact_fresh_rerun)}`,
    "",
    "## Recommended Action",
    completionSecurityTriage.recommended_fixes.join(" "),
    result?.recommended_action ?? triage?.recommended_action ?? "",
    "",
    "Treatment remains blocked until exact evidence includes explicit DevResult security semantics and the full treatment path later produces trusted FinalDeliveryReport evidence.",
    ""
  ];
  writeMarkdown(resolve(repoRoot, reportDir, "AdversarialExactCompletionTriageReport.md"), `${lines.join("\n")}\n`);
  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = reportAdversarialExactCompletionRecovery();
  process.stdout.write(`${JSON.stringify(result ?? { status: "NOT_RUN" }, null, 2)}\n`);
}
