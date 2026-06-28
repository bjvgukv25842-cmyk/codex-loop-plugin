import { createHash } from "node:crypto";
import { resolve } from "node:path";

import { readJson, writeMarkdown } from "./io.ts";
import type { AdversarialDevResultCompletionResult } from "./run-adversarial-dev-result-completion.ts";
import type { AdversarialDevResultCompletionVerifyResult } from "./verify-adversarial-dev-result-completion.ts";

const reportDir = "evals/effectiveness/reports/adversarial-prompt-injection-001";

export function reportAdversarialDevResultCompletion(repoRoot = process.cwd()): AdversarialDevResultCompletionResult | null {
  const result = readJson<AdversarialDevResultCompletionResult | null>(
    resolve(repoRoot, reportDir, "adversarial-dev-result-completion-result.json"),
    null
  );
  const verify = readJson<AdversarialDevResultCompletionVerifyResult | null>(
    resolve(repoRoot, reportDir, "adversarial-dev-result-completion-verify.json"),
    null
  );
  const threadFingerprint = result?.original_dev_worker_thread_id
    ? createHash("sha256").update(result.original_dev_worker_thread_id).digest("hex").slice(0, 12)
    : "";
  const lines = [
    "# Adversarial DevResult Completion Report",
    "",
    "Module: M12.10B.32A Adversarial Treatment DevResult Completion Harness",
    `Status: ${result?.status ?? "NOT_RUN"}`,
    `Verify status: ${verify?.status ?? "NOT_RUN"}`,
    `Real SDK run executed: ${String(result?.real_sdk_run_executed === true)}`,
    `Completion run executed: ${String(result?.completion_run_executed === true)}`,
    `Completion run count: ${String(result?.completion_run_count ?? 0)}`,
    `Exact completion scripts reused: ${String(Boolean(result?.exact_completion_scripts_reused))}`,
    `Default run blocked without enable flag: ${String(verify?.default_run_blocked_without_enable_flag === true)}`,
    "",
    "## Script Availability",
    `Completion scripts created: ${String(verify?.completion_scripts_created === true)}`,
    `Exact completion scripts not reused: ${String(verify?.exact_completion_scripts_not_reused === true)}`,
    "",
    "## Thread",
    `Original dev worker thread id hash: ${threadFingerprint || "missing"}`,
    `Uses original treatment dev worker thread: ${String(result?.completion_used_original_thread === true || (result?.completion_enabled === false && Boolean(result?.original_dev_worker_thread_id)))}`,
    "",
    "## Read-Only Proof",
    `Completion used read-only mode: ${String(result?.completion_used_read_only_mode === true)}`,
    `Completion used SDK run: ${String(result?.completion_uses_sdk_run === true)}`,
    `Completion timeout ms: ${String(result?.completion_timeout_ms ?? 60000)}`,
    `Completion was read-only: ${String(result?.completion_was_read_only === true)}`,
    `Files modified during completion: ${(result?.files_modified_during_completion ?? []).join(", ") || "none"}`,
    "",
    "## Evidence Preconditions",
    `Treatment real run executed: ${String(result?.treatment_real_run_executed === true)}`,
    `Planner thread id present: ${String(result?.planner_thread_id_present === true)}`,
    `Dev worker thread id present: ${String(result?.dev_worker_thread_id_present === true)}`,
    `Validation passed: ${String(result?.validation_passed === true)}`,
    `Security contract passed: ${String(result?.security_contract_passed === true)}`,
    `Security scan clean: ${String(result?.security_scan_clean === true)}`,
    `Preconditions met: ${String(result?.preconditions_met === true)}`,
    `Precondition errors: ${(result?.precondition_errors ?? []).join("; ") || "none"}`,
    "",
    "## DevResult",
    `DevResult valid: ${String(result?.dev_result_valid === true)}`,
    `DevResult path: ${result?.dev_result_path || "missing"}`,
    `DevResult changed files: ${(result?.dev_result_changed_files ?? []).join(", ") || "none"}`,
    `Security summary present: ${String(result?.dev_result_security_summary_present === true)}`,
    `Security summary sufficient: ${String(result?.dev_result_security_summary_sufficient === true)}`,
    `Prompt injection ignored: ${String(result?.dev_result_prompt_injection_ignored === true)}`,
    "",
    "## Safety",
    `Seeded fake secret leaked: ${String(result?.seeded_fake_secret_leaked === true)}`,
    `Real secret leak detected: ${String(result?.real_secret_leak_detected === true)}`,
    `Prompt injection followed: ${String(result?.prompt_injection_followed === true)}`,
    `Forbidden files modified: ${(result?.forbidden_files_modified ?? []).join(", ") || "none"}`,
    `Danger full access used: ${String(result?.danger_full_access_used === true)}`,
    `Tests deleted or weakened: ${String(result?.tests_deleted_or_weakened === true)}`,
    "",
    "## Checkpoint",
    `Checkpoint stage: ${result?.checkpoint_stage ?? ""}`,
    `Checkpoint transition to DEV_WORKER_DONE: ${String(result?.checkpoint_transition_to_dev_worker_done === true)}`,
    `Ready for one adversarial checkpoint resume: ${String(result?.ready_for_one_adversarial_checkpoint_resume === true)}`,
    `Ready for one adversarial treatment rerun: ${String(Boolean(result?.ready_for_one_adversarial_treatment_rerun))}`,
    "",
    "## Next Action",
    result?.next_manual_action ?? "Run dry-run first, then request explicit approval before enabling real DevResult completion.",
    ""
  ];
  writeMarkdown(resolve(repoRoot, reportDir, "AdversarialDevResultCompletionReport.md"), `${lines.join("\n")}\n`);
  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = reportAdversarialDevResultCompletion();
  process.stdout.write(`${JSON.stringify(result ?? { status: "NOT_RUN" }, null, 2)}\n`);
}
