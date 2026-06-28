import {
  analyzeAdversarialTreatmentTimeout,
  type AdversarialTreatmentTimeoutTriage
} from "../../src/effectiveness/adversarial-checkpoint-state.ts";
import type { M12RunResult } from "./types.ts";
import { readJson, writeJson, writeMarkdown } from "./io.ts";

const CASE_ID = "adversarial-prompt-injection-001";
const REPORT_DIR = `evals/effectiveness/reports/${CASE_ID}`;

export function writeAdversarialTreatmentTimeoutTriage(): AdversarialTreatmentTimeoutTriage {
  const baseline = readJson<M12RunResult | null>(`${REPORT_DIR}/baseline-result.json`, null);
  const treatment = readJson<M12RunResult>(`${REPORT_DIR}/treatment-result.json`, missingTreatmentResult());
  const triage = analyzeAdversarialTreatmentTimeout({ baseline, treatment });
  writeJson(`${REPORT_DIR}/adversarial-treatment-timeout-triage.json`, triage);
  writeMarkdown(`${REPORT_DIR}/AdversarialTreatmentTimeoutTriageReport.md`, renderTriageReport(triage));
  return triage;
}

function renderTriageReport(triage: AdversarialTreatmentTimeoutTriage): string {
  return [
    "# Adversarial Treatment Timeout Triage",
    "",
    `Case: ${triage.case_id}`,
    `Current failure category: ${triage.current_failure_category}`,
    `Corrected failure category: ${triage.corrected_failure_category}`,
    `Failure category was stale or inconsistent: ${String(triage.failure_category_was_stale_or_inconsistent)}`,
    `Last completed stage: ${triage.last_completed_stage || "none"}`,
    `First failed stage: ${triage.first_failed_stage || "none"}`,
    "",
    "## Safety",
    "",
    `- Baseline seeded fake secret leaked: ${String(triage.baseline_seeded_fake_secret_leaked)}`,
    `- Baseline real secret leak detected: ${String(triage.baseline_real_secret_leak_detected)}`,
    `- Treatment seeded fake secret leaked: ${String(triage.seeded_fake_secret_leaked)}`,
    `- Treatment real secret leak detected: ${String(triage.real_secret_leak_detected)}`,
    `- Prompt injection followed: ${String(triage.prompt_injection_followed)}`,
    `- Forbidden files modified: ${triage.forbidden_files_modified.join(", ") || "None"}`,
    `- danger-full-access used: ${String(triage.danger_full_access_used)}`,
    `- Tests deleted or weakened: ${String(triage.tests_deleted_or_weakened)}`,
    "",
    "## Stage Timeline",
    "",
    ...triage.stage_timeline.map((entry) => renderStage(entry)),
    "",
    "## Recovery",
    "",
    `- Validation passed: ${String(triage.validation_passed)}`,
    `- Security contract passed: ${String(triage.security_contract_passed)}`,
    `- Can recover from existing evidence: ${String(triage.can_recover_from_existing_evidence)}`,
    `- Requires treatment rerun: ${String(triage.requires_treatment_rerun)}`,
    "",
    "## Recommended Fixes",
    "",
    ...triage.recommended_fixes.map((fix) => `- ${fix}`),
    ""
  ].join("\n");
}

function renderStage(entry: AdversarialTreatmentTimeoutTriage["stage_timeline"][number]): string {
  if (isValidationStage(entry)) {
    return `- validation: started=${entry.started}, completed=${entry.completed}, npm_test_passed=${entry.npm_test_passed}, security_contract_passed=${entry.security_contract_passed}, logs=${entry.log_paths.join(", ") || "none"}`;
  }
  if (isFinalReportStage(entry)) {
    return `- final_report: started=${entry.started}, completed=${entry.completed}, path=${entry.path || "missing"}`;
  }
  return `- ${entry.stage}: started=${entry.started}, completed=${entry.completed}, status=${entry.status}, thread_id=${entry.thread_id ?? ""}, last_event_type=${entry.last_event_type ?? ""}`;
}

function isValidationStage(
  entry: AdversarialTreatmentTimeoutTriage["stage_timeline"][number]
): entry is Extract<AdversarialTreatmentTimeoutTriage["stage_timeline"][number], { stage: "validation" }> {
  return entry.stage === "validation" && "npm_test_passed" in entry;
}

function isFinalReportStage(
  entry: AdversarialTreatmentTimeoutTriage["stage_timeline"][number]
): entry is Extract<AdversarialTreatmentTimeoutTriage["stage_timeline"][number], { stage: "final_report" }> {
  return entry.stage === "final_report" && "path" in entry;
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
  const triage = writeAdversarialTreatmentTimeoutTriage();
  process.stdout.write(`${JSON.stringify(triage, null, 2)}\n`);
}
