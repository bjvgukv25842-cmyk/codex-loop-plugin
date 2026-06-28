import { analyzeTestCoverage002Treatment, readCheckpointState, type TestCoverageTreatmentTriage } from "../../src/effectiveness/test-coverage-treatment-triage.ts";
import type { M12RunResult } from "./types.ts";
import { readJson, writeJson, writeMarkdown } from "./io.ts";

export function writeTestCoverageTreatmentTriage(): TestCoverageTreatmentTriage {
  const baseline = readJson<M12RunResult | null>("evals/effectiveness/reports/test-coverage-002/baseline-result.json", null);
  const treatment = readJson<M12RunResult>("evals/effectiveness/reports/test-coverage-002/treatment-result.json", {
    case_id: "test-coverage-002",
    variant: "treatment",
    status: "BLOCKED",
    real_run_executed: false,
    prompt: "",
    fixture_repo: "",
    acceptance_criteria: [],
    validation_commands: ["npm test", "npm run coverage:contract"],
    expected_artifacts: [],
    forbidden_files: [],
    changed_files: [],
    artifacts: [],
    validation_logs: [],
    duration_ms: 0,
    thread_count: 0,
    command_count: 0,
    errors: ["treatment result missing"]
  });
  const triage = analyzeTestCoverage002Treatment({
    baseline,
    treatment,
    checkpoint_state: readCheckpointState(treatment)
  });
  writeJson("evals/effectiveness/reports/test-coverage-002/test-coverage-treatment-triage.json", triage);
  writeMarkdown("evals/effectiveness/reports/test-coverage-002/TestCoverageTreatmentTriageReport.md", renderTriageReport(triage));
  return triage;
}

function renderTriageReport(triage: TestCoverageTreatmentTriage): string {
  return [
    "# Test-Coverage-002 Treatment Triage",
    "",
    `Baseline status: ${triage.baseline_status}`,
    `Treatment status: ${triage.treatment_status}`,
    `First failed stage: ${triage.first_failed_stage}`,
    `Current failure category: ${triage.failure_category_current}`,
    `Corrected failure category: ${triage.failure_category_corrected}`,
    "",
    "## Stage Evidence",
    `- planner_thread_id_present: ${String(triage.planner_thread_id_present)}`,
    `- dev_worker_thread_id_present: ${String(triage.dev_worker_thread_id_present)}`,
    `- dev_worker_completed: ${String(triage.dev_worker_completed)}`,
    `- dev_result_path: ${triage.dev_result_path}`,
    `- initial_evaluator_started: ${String(triage.initial_evaluator_started)}`,
    "",
    "## Validation Evidence",
    `- validation_log_paths: ${triage.validation_log_paths.join(", ") || "None"}`,
    `- npm_test_run: ${String(triage.npm_test_run)}`,
    `- npm_test_passed: ${String(triage.npm_test_passed)}`,
    `- coverage_contract_run: ${String(triage.coverage_contract_run)}`,
    `- coverage_contract_passed: ${String(triage.coverage_contract_passed)}`,
    ...triage.validation_command_results.map((entry) => `- ${entry.command}: ${entry.status}${entry.evidence ? ` (${entry.evidence})` : ""}`),
    "",
    "## Recovery",
    `- can_recover_from_existing_evidence: ${String(triage.can_recover_from_existing_evidence)}`,
    `- requires_treatment_rerun: ${String(triage.requires_treatment_rerun)}`,
    "",
    "## Recommended Fixes",
    ...triage.recommended_fixes.map((fix) => `- ${fix}`),
    ""
  ].join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const triage = writeTestCoverageTreatmentTriage();
  process.stdout.write(`${JSON.stringify(triage, null, 2)}\n`);
}
