import { resolve } from "node:path";

import { reconstructAdversarialDevWorkerSmokeReadiness } from "../../src/effectiveness/adversarial-dev-worker-smoke-readiness.ts";
import { diffAdversarialDevWorkerInvocation } from "./diff-adversarial-dev-worker-invocation.ts";
import { readJson, writeMarkdown } from "./io.ts";
import type { AdversarialDevWorkerSmokeResult } from "./run-adversarial-dev-worker-smoke.ts";
import { writeAdversarialExactGitProofTriage } from "./triage-adversarial-exact-git-proof.ts";
import { writeAdversarialSafetyMinimalFileChangeTriage } from "./triage-adversarial-safety-minimal-file-change.ts";
import { writeAdversarialDevWorkerTimeoutTriage } from "./triage-adversarial-dev-worker-timeout.ts";
import type { AdversarialDevWorkerSmokeVerifyResult } from "./verify-adversarial-dev-worker-smoke.ts";

const reportDir = "evals/effectiveness/reports/adversarial-prompt-injection-001";

export function reportAdversarialDevWorkerSmoke(repoRoot = process.cwd()): AdversarialDevWorkerSmokeResult | null {
  const result = readJson<AdversarialDevWorkerSmokeResult | null>(resolve(repoRoot, reportDir, "adversarial-dev-worker-smoke-result.json"), null);
  const verify = readJson<AdversarialDevWorkerSmokeVerifyResult | null>(resolve(repoRoot, reportDir, "adversarial-dev-worker-smoke-verify.json"), null);
  const timeoutTriage = writeAdversarialDevWorkerTimeoutTriage(repoRoot);
  const invocationDiff = diffAdversarialDevWorkerInvocation(repoRoot);
  const fileChangeTriage = writeAdversarialSafetyMinimalFileChangeTriage(repoRoot);
  const exactGitProofTriage = writeAdversarialExactGitProofTriage(repoRoot);
  const readiness = reconstructAdversarialDevWorkerSmokeReadiness(repoRoot, { write: true });
  const lines = [
    "# Adversarial Dev Worker Smoke Report",
    "",
    `Smoke status: ${result?.status ?? "NOT_RUN"}`,
    `Verify status: ${verify?.status ?? "NOT_RUN"}`,
    `Mode: ${result?.mode ?? ""}`,
    `Real SDK run executed: ${String(result?.real_sdk_run_executed === true)}`,
    `Dev worker thread started: ${String(result?.dev_worker_thread_started === true)}`,
    `Dev worker thread id: ${result?.dev_worker_thread_id ?? ""}`,
    `Working directory: ${result?.working_directory ?? ""}`,
    `Working directory expected: ${result?.working_directory_expected ?? ""}`,
    `Working directory matches: ${String(result?.working_directory_matches === true)}`,
    `Fixture reset verified: ${String(result?.fixture_reset_verified === true)}`,
    `Pre-run npm test failed: ${String(result?.pre_run_test_failed === true)}`,
    `Post-run npm test passed: ${String(result?.post_run_test_passed === true)}`,
    `File change verified: ${String(result?.file_change_verified === true)}`,
    `Git diff files: ${(result?.git_diff_files ?? []).join(", ") || "none"}`,
    `DevResult changed_files: ${(result?.dev_result_changed_files ?? []).join(", ") || "none"}`,
    `Structured output valid: ${String(result?.structured_output_valid === true)}`,
    `npm test run: ${String(result?.npm_test_run === true)}`,
    `npm test passed: ${String(result?.npm_test_passed === true)}`,
    `security:contract run: ${String(result?.security_contract_run === true)}`,
    `security:contract passed: ${String(result?.security_contract_passed === true)}`,
    `Failure category: ${result?.failure_category ?? ""}`,
    `Prompt length: ${String(result?.prompt_length ?? 0)}`,
    `Prompt requires npm test: ${String(result?.prompt_requires_npm_test === true)}`,
    `Prompt requires security contract: ${String(result?.prompt_requires_security_contract === true)}`,
    `Prompt forbids secrets: ${String(result?.prompt_forbids_secrets === true)}`,
    `Prompt ignores untrusted instructions: ${String(result?.prompt_ignores_untrusted_instructions === true)}`,
    `Contains seeded fake secret raw: ${String(result?.contains_seeded_fake_secret_raw === true)}`,
    `Contains untrusted instruction raw: ${String(result?.contains_untrusted_instruction_raw === true)}`,
    `Seeded fake secret leaked: ${String(result?.seeded_fake_secret_leaked === true)}`,
    `Real secret leak detected: ${String(result?.real_secret_leak_detected === true)}`,
    `Prompt injection followed: ${String(result?.prompt_injection_followed === true)}`,
    `Forbidden files modified: ${(result?.forbidden_files_modified ?? []).join(", ") || "none"}`,
    `Tests deleted or weakened: ${String(result?.tests_deleted_or_weakened === true)}`,
    "",
    "## Existing Timeout Evidence",
    `Failure category: ${timeoutTriage.failure_category}`,
    `Planner thread id present: ${String(timeoutTriage.planner_thread_id_present)}`,
    `Dev worker thread started: ${String(timeoutTriage.dev_worker_thread_started)}`,
    `Event count: ${timeoutTriage.event_count}`,
    `Last event type: ${timeoutTriage.last_event_type}`,
    `Elapsed ms: ${timeoutTriage.elapsed_ms}`,
    "",
    "## Invocation Diff",
    `Status: ${invocationDiff.status}`,
    `Critical diffs: ${invocationDiff.critical_diffs.length ? invocationDiff.critical_diffs.join(", ") : "none"}`,
    "",
    "## Safety-Minimal File-Change Triage",
    `Failure category: ${fileChangeTriage.failure_category}`,
    `Fixture reset verified: ${String(fileChangeTriage.fixture_reset_verified)}`,
    `Pre-run npm test failed: ${String(fileChangeTriage.pre_run_test_failed)}`,
    `Post-run npm test passed: ${String(fileChangeTriage.post_run_test_passed)}`,
    `Git diff files: ${fileChangeTriage.git_diff_files.join(", ") || "none"}`,
    `DevResult changed_files: ${fileChangeTriage.dev_result_changed_files.join(", ") || "none"}`,
    "",
    "## Exact Git Proof Triage",
    `Failure category: ${exactGitProofTriage.failure_category}`,
    `Isolated target used: ${String(exactGitProofTriage.isolated_target_used)}`,
    `Target is git repo: ${String(exactGitProofTriage.target_is_git_repo)}`,
    `Fixture reset verified: ${String(exactGitProofTriage.fixture_reset_verified)}`,
    `Tracked diff files: ${exactGitProofTriage.tracked_diff_files.join(", ") || "none"}`,
    `Staged diff files: ${exactGitProofTriage.staged_diff_files.join(", ") || "none"}`,
    `Untracked files: ${exactGitProofTriage.untracked_files.join(", ") || "none"}`,
    `Combined git changed files: ${exactGitProofTriage.combined_git_changed_files.join(", ") || "none"}`,
    `DevResult changed_files: ${exactGitProofTriage.dev_result_changed_files.join(", ") || "none"}`,
    `Evidence mismatch detected: ${String(exactGitProofTriage.evidence_mismatch_detected)}`,
    "",
    "## Readiness State",
    `parity: ${readiness.parity.status}`,
    `safety-minimal: ${readiness.safety_minimal.status}`,
    `exact: ${readiness.exact.status}`,
    `ready_for_safety_minimal: ${String(readiness.ready_for_safety_minimal)}`,
    `ready_for_exact: ${String(readiness.ready_for_exact)}`,
    `ready_for_treatment_rerun: ${String(readiness.ready_for_treatment_rerun)}`,
    `readiness reconstruction status: ${readiness.reconstruction_status}`,
    "",
    "## Required Smoke Order",
    "- parity",
    "- safety-minimal",
    "- exact",
    "",
    "Only after all three real dev-worker-only smokes pass may one approved adversarial treatment fresh rerun be considered.",
    "M12 production ready: false",
    ""
  ];
  writeMarkdown(resolve(repoRoot, reportDir, "AdversarialDevWorkerSmokeReport.md"), `${lines.join("\n")}\n`);
  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = reportAdversarialDevWorkerSmoke();
  process.stdout.write(`${JSON.stringify(result ?? { status: "NOT_RUN" }, null, 2)}\n`);
}
