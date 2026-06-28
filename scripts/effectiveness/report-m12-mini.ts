import { existsSync } from "node:fs";

import { loadM12Dataset } from "./dataset.ts";
import { readJson, writeMarkdown } from "./io.ts";
import { parseM12CliArgs } from "./m12-cli-args.ts";
import { evaluateNextCaseReadiness, writeNextCaseReadinessReport } from "./next-case-readiness.ts";
import type { M12ComparisonReport, M12RunResult } from "./types.ts";
import { analyzeFeatureTreatmentTimeline } from "../../src/effectiveness/feature-treatment-stage-timeline.ts";
import { writeFeatureTreatmentTimeoutTriage } from "./triage-feature-treatment-timeout.ts";
import { compareM12Results } from "./compare-m12-results.ts";
import { freshnessSummary, writeEvidenceFreshnessCheck } from "./evidence-freshness.ts";
import { evaluateThreadEvidence } from "../../src/effectiveness/thread-evidence-policy.ts";
import { writeTestCoverageTreatmentTriage } from "./triage-test-coverage-treatment.ts";
import { writeAdversarialTreatmentTimeoutTriage } from "./triage-adversarial-treatment-timeout.ts";

export function reportM12Mini(): M12ComparisonReport {
  const args = parseM12CliArgs();
  const selectedCase = args.case_id ? loadM12Dataset().find((entry) => entry.case_id === args.case_id) : undefined;
  const readiness = selectedCase ? evaluateNextCaseReadiness(selectedCase) : undefined;
  if (readiness) {
    writeNextCaseReadinessReport(readiness);
  }
  const compare = args.regrade_only
    ? compareM12Results()
    : readJson<M12ComparisonReport>("evals/effectiveness/reports/m12-mini-compare.json", {
        status: "BLOCKED",
        baseline_cases: 0,
        treatment_cases: 0,
        p0_blockers: ["compare report missing"],
        severe_issues: [],
        production_ready: false,
        ready_for_m12_mini_real_run: false
      });
  const treatment = args.case_id
    ? readJson<M12RunResult | null>(`evals/effectiveness/reports/${args.case_id}/treatment-result.json`, null)
    : null;
  const baseline = args.case_id
    ? readJson<M12RunResult | null>(`evals/effectiveness/reports/${args.case_id}/baseline-result.json`, null)
    : null;
  const baselineTimeoutTriage = args.case_id
    ? readJson<Record<string, unknown> | null>(`evals/effectiveness/reports/${args.case_id}/baseline-codex-exec-timeout-triage.json`, null)
    : null;
  const treatmentTimeline = treatment?.case_id === "feature-small-001" && treatment.variant === "treatment"
    ? analyzeFeatureTreatmentTimeline(treatment)
    : null;
  const featureTreatmentTriage = treatmentTimeline && treatment?.status !== "PASS" ? writeFeatureTreatmentTimeoutTriage() : null;
  const testCoverageTreatmentTriage = treatment?.case_id === "test-coverage-002" && treatment.variant === "treatment" && treatment.status !== "PASS"
    ? writeTestCoverageTreatmentTriage()
    : null;
  const adversarialTreatmentTriage = treatment?.case_id === "adversarial-prompt-injection-001" && treatment.variant === "treatment" && treatment.status !== "PASS"
    ? writeAdversarialTreatmentTimeoutTriage()
    : null;
  const treatmentThreadPolicy = treatment ? evaluateThreadEvidence(selectedCase, treatment) : null;
  const freshness = args.case_id ? writeEvidenceFreshnessCheck(args.case_id, { compare_used_latest_treatment_result: true, report_used_latest_treatment_result: true }) : null;
  const compareWithFreshness = freshness ? { ...compare, ...freshnessSummary(freshness) } : compare;
  const lines = [
    "# M12 Mini Effectiveness Report",
    "",
    `Status: ${compare.status}`,
    `Selected case: ${args.case_id ?? "all"}`,
    `Selected mode: ${args.mode}`,
    `Regrade only: ${args.regrade_only}`,
    `Baseline cases: ${compare.baseline_cases}`,
    `Treatment cases: ${compare.treatment_cases}`,
    "Production ready: false",
    `Ready for one controlled M12-mini real run: ${compare.ready_for_m12_mini_real_run}`,
    ...(compare.baseline_outcome || compare.treatment_outcome || compare.winner
      ? [
          `baseline_outcome: ${compare.baseline_outcome ?? ""}`,
          `treatment_outcome: ${compare.treatment_outcome ?? ""}`,
          `baseline_score: ${String(compare.baseline_score ?? "")}`,
          `treatment_score: ${String(compare.treatment_score ?? "")}`,
          `winner: ${compare.winner ?? "inconclusive"}`
        ]
      : []),
    "",
    "## Evidence Freshness",
    ...(freshness
      ? [
          `- treatment_result_path: ${freshness.treatment_result_path}`,
          `- treatment_result_mtime: ${freshness.treatment_result_mtime}`,
          `- final_report_exists: ${freshness.final_report_exists}`,
          `- stale_files_ignored: ${freshness.stale_files_ignored.length > 0 ? freshness.stale_files_ignored.join(", ") : "None"}`
        ]
      : ["- Not case-scoped."]),
    "",
    "## P0 Blockers",
    ...(compare.p0_blockers.length > 0 ? compare.p0_blockers.map((entry) => `- ${entry}`) : ["- None"]),
    "",
    "## Severe Issues",
    ...(compare.severe_issues.length > 0 ? compare.severe_issues.map((entry) => `- ${entry}`) : ["- None"]),
    "",
    "## Accepted Baseline Safety Failures",
    ...(compare.accepted_baseline_safety_failures && compare.accepted_baseline_safety_failures.length > 0
      ? compare.accepted_baseline_safety_failures.map((entry) => `- ${entry}`)
      : ["- None"]),
    "",
    "## Validation Evidence Used",
    ...(compare.validation_command_results_used && compare.validation_command_results_used.length > 0
      ? compare.validation_command_results_used.map((entry) =>
          `- ${entry.command}: ${entry.status}; source=${entry.evidence_source ?? entry.log_path ?? "result.validation_command_results"}; mtime=${entry.evidence_mtime ?? ""}; reason=${entry.reason ?? entry.evidence ?? ""}`
        )
      : ["- None"]),
    "",
    "## Stale Validation Logs Ignored",
    ...(compare.stale_validation_logs_ignored && compare.stale_validation_logs_ignored.length > 0
      ? compare.stale_validation_logs_ignored.map((entry) => `- ${entry}`)
      : ["- None"]),
    "",
    "## Notes",
    "- M12.0 creates the harness only.",
    "- Dry-run mode does not prove production effectiveness.",
    "- `INCONCLUSIVE_DRY_RUN_RESULT` means no winner should be inferred.",
    "- `BLOCKED_M12_RESULT_MISSING` means a selected case/mode did not produce a result file.",
    "- Real M12-mini execution requires explicit approval and `CODEX_LOOP_ENABLE_M12_REAL_RUN=1`.",
    ...(readiness
      ? [
          "",
          "## Next Case Readiness",
          `- case_id: ${readiness.case_id}`,
          `- status: ${readiness.status}`,
          `- fixture_repo_exists: ${readiness.fixture_repo_exists}`,
          `- treatment_runner_supports_case: ${readiness.treatment_real_runner_supports_case}`,
          `- ready_for_one_next_case_canary: ${readiness.ready_for_one_next_case_canary}`
        ]
      : []),
    ...(treatment?.planner_output_contract_version
      ? [
          "",
          "## Planner Evidence",
          `- planner_output_contract_version: ${treatment.planner_output_contract_version}`,
          `- planner_thread_id: ${treatment.planner_thread_id ?? ""}`,
          `- planner_stage_attempted: ${String(treatment.planner_stage_attempted === true)}`,
          `- planner_stage_completed: ${String(treatment.planner_stage_completed === true)}`,
          `- planner_raw_output_path: ${treatment.planner_raw_output_path ?? ""}`,
          `- planner_redacted_output_path: ${treatment.planner_redacted_output_path ?? ""}`,
          `- planner_events_path: ${treatment.planner_events_path ?? ""}`,
          `- planner_failure_category: ${treatment.failure_category ?? ""}`
        ]
      : []),
    ...(treatmentThreadPolicy
      ? [
          "",
          "## Treatment Thread Evidence Policy",
          `- policy: ${treatmentThreadPolicy.policy}`,
          `- repair_path_required: ${String(treatmentThreadPolicy.repair_path_required)}`,
          `- required_thread_roles: ${treatmentThreadPolicy.required_thread_roles.join(", ")}`,
          `- optional_thread_roles: ${treatmentThreadPolicy.optional_thread_roles.join(", ") || "None"}`,
          `- missing_required_roles: ${treatmentThreadPolicy.missing_required_roles.join(", ") || "None"}`
        ]
      : []),
    ...(baseline?.status === "TIMEOUT" || baselineTimeoutTriage
      ? [
          "",
          "## Baseline Timeout Triage",
          `- baseline_status: ${baseline?.status ?? ""}`,
          `- failure_category: ${String(baselineTimeoutTriage?.failure_category ?? baseline?.failure_category ?? "")}`,
          `- process_started: ${String(baselineTimeoutTriage?.process_started ?? baseline?.real_run_executed ?? false)}`,
          `- killed_by_timeout: ${String(baselineTimeoutTriage?.killed_by_timeout ?? "")}`,
          `- thread_started: ${String(baselineTimeoutTriage?.thread_started ?? "")}`,
          `- thread_id: ${String(baselineTimeoutTriage?.thread_id ?? baseline?.thread_id ?? "")}`,
          `- event_count: ${String(baselineTimeoutTriage?.event_count ?? "")}`,
          `- invocation_trace_path: ${String(baselineTimeoutTriage?.invocation_trace_path ?? baseline?.invocation_trace_path ?? "")}`
        ]
      : []),
    ...(treatmentTimeline
      ? [
          "",
          "## Feature Treatment Stage Timeline",
          `- current_failure_category: ${treatmentTimeline.current_failure_category}`,
          `- corrected_failure_category: ${treatmentTimeline.corrected_failure_category}`,
          `- failure_category_was_stale_or_inconsistent: ${String(treatmentTimeline.failure_category_was_stale_or_inconsistent)}`,
          `- current_stage: ${treatmentTimeline.current_stage}`,
          `- last_completed_stage: ${treatmentTimeline.last_completed_stage}`,
          `- first_failed_stage: ${treatmentTimeline.first_failed_stage}`,
          `- triage_report: ${featureTreatmentTriage ? "evals/effectiveness/reports/feature-small-001/FeatureTreatmentTimeoutTriageReport.md" : ""}`,
          ...treatmentTimeline.stage_timeline.map((entry) => `- ${entry.stage}: started=${entry.started}, completed=${entry.completed}, status=${entry.status}, thread_id=${entry.thread_id ?? ""}`)
        ]
      : []),
    ...(testCoverageTreatmentTriage
      ? [
          "",
          "## Test Coverage Treatment Triage",
          `- first_failed_stage: ${testCoverageTreatmentTriage.first_failed_stage}`,
          `- failure_category_current: ${testCoverageTreatmentTriage.failure_category_current}`,
          `- failure_category_corrected: ${testCoverageTreatmentTriage.failure_category_corrected}`,
          `- dev_worker_completed: ${String(testCoverageTreatmentTriage.dev_worker_completed)}`,
          `- npm_test_run: ${String(testCoverageTreatmentTriage.npm_test_run)}`,
          `- npm_test_passed: ${String(testCoverageTreatmentTriage.npm_test_passed)}`,
          `- coverage_contract_run: ${String(testCoverageTreatmentTriage.coverage_contract_run)}`,
          `- coverage_contract_passed: ${String(testCoverageTreatmentTriage.coverage_contract_passed)}`,
          `- can_recover_from_existing_evidence: ${String(testCoverageTreatmentTriage.can_recover_from_existing_evidence)}`,
          `- requires_treatment_rerun: ${String(testCoverageTreatmentTriage.requires_treatment_rerun)}`,
          "- triage_report: evals/effectiveness/reports/test-coverage-002/TestCoverageTreatmentTriageReport.md"
        ]
      : []),
    ...(adversarialTreatmentTriage
      ? [
          "",
          "## Adversarial Treatment Timeout Triage",
          `- current_failure_category: ${adversarialTreatmentTriage.current_failure_category}`,
          `- corrected_failure_category: ${adversarialTreatmentTriage.corrected_failure_category}`,
          `- failure_category_was_stale_or_inconsistent: ${String(adversarialTreatmentTriage.failure_category_was_stale_or_inconsistent)}`,
          `- first_failed_stage: ${adversarialTreatmentTriage.first_failed_stage}`,
          `- validation_passed: ${String(adversarialTreatmentTriage.validation_passed)}`,
          `- security_contract_passed: ${String(adversarialTreatmentTriage.security_contract_passed)}`,
          `- can_recover_from_existing_evidence: ${String(adversarialTreatmentTriage.can_recover_from_existing_evidence)}`,
          `- requires_treatment_rerun: ${String(adversarialTreatmentTriage.requires_treatment_rerun)}`,
          "- triage_report: evals/effectiveness/reports/adversarial-prompt-injection-001/AdversarialTreatmentTimeoutTriageReport.md"
        ]
      : []),
    ""
  ];
  writeMarkdown("evals/effectiveness/reports/M12_Mini_Report.md", `${lines.join("\n")}\n`);
  return compareWithFreshness;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (!existsSync("evals/effectiveness/reports/m12-mini-compare.json")) {
    process.stderr.write("Missing compare report. Run npm run m12:mini:compare first.\n");
  }
  const report = reportM12Mini();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = report.status === "BLOCKED" ? 2 : 0;
}
