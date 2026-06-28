import { resolve } from "node:path";

import { featurePlannerExactPathMatchesTreatment } from "../../src/effectiveness/feature-planner-stage.ts";
import { analyzeFeatureTreatmentTimeline } from "../../src/effectiveness/feature-treatment-stage-timeline.ts";
import { readJson, writeJson, writeMarkdown } from "./io.ts";
import type { M12RunResult, M12StageTimelineEntry } from "./types.ts";

export interface FeatureTreatmentTimeoutTriage {
  case_id: "feature-small-001";
  current_failure_category: string;
  corrected_failure_category: string;
  failure_category_was_stale_or_inconsistent: boolean;
  stage_timeline: M12StageTimelineEntry[];
  last_completed_stage: string;
  first_failed_stage: string;
  thread_ids_present: {
    planner: boolean;
    dev_worker: boolean;
    evaluator: boolean;
    repair_dev_worker: boolean;
    final_evaluator: boolean;
  };
  planner_smokes_all_passed: boolean;
  treatment_uses_feature_planner_exact_path: boolean;
  checkpoint_state_path: string;
  checkpoint_state_valid: boolean;
  recommended_fixes: string[];
}

export function writeFeatureTreatmentTimeoutTriage(repoRoot = process.cwd()): FeatureTreatmentTimeoutTriage {
  const reportDir = resolve(repoRoot, "evals/effectiveness/reports/feature-small-001");
  const treatment = readJson<M12RunResult | null>(resolve(reportDir, "treatment-result.json"), null);
  const smoke = readJson<{ status?: string; mode?: string; no_task_graph_json?: boolean } | null>(resolve(reportDir, "feature-planner-smoke-result.json"), null);
  const analysis = analyzeFeatureTreatmentTimeline(treatment ?? minimalTreatmentResult(), repoRoot);
  const triage: FeatureTreatmentTimeoutTriage = {
    case_id: "feature-small-001",
    current_failure_category: analysis.current_failure_category,
    corrected_failure_category: analysis.corrected_failure_category,
    failure_category_was_stale_or_inconsistent: analysis.failure_category_was_stale_or_inconsistent,
    stage_timeline: analysis.stage_timeline,
    last_completed_stage: analysis.last_completed_stage,
    first_failed_stage: analysis.first_failed_stage,
    thread_ids_present: {
      planner: Boolean(treatment?.planner_thread_id),
      dev_worker: Boolean(treatment?.dev_worker_thread_id),
      evaluator: Boolean(treatment?.initial_evaluator_thread_id),
      repair_dev_worker: Boolean(treatment?.repair_dev_worker_thread_id),
      final_evaluator: Boolean(treatment?.final_evaluator_thread_id)
    },
    planner_smokes_all_passed: smoke?.status === "PASS" && smoke.mode === "exact" && smoke.no_task_graph_json === true,
    treatment_uses_feature_planner_exact_path: featurePlannerExactPathMatchesTreatment(),
    checkpoint_state_path: analysis.checkpoint_state_path,
    checkpoint_state_valid: analysis.checkpoint_state_valid,
    recommended_fixes: recommendedFixes(analysis.corrected_failure_category, analysis.failure_category_was_stale_or_inconsistent)
  };
  if (treatment) {
    writeJson(resolve(reportDir, "treatment-result.json"), {
      ...treatment,
      current_stage: analysis.current_stage,
      last_completed_stage: analysis.last_completed_stage,
      first_failed_stage: analysis.first_failed_stage,
      stage_timeline: analysis.stage_timeline,
      failure_category_was_stale_or_inconsistent: analysis.failure_category_was_stale_or_inconsistent,
      corrected_failure_category: analysis.corrected_failure_category
    });
  }
  writeJson(resolve(reportDir, "feature-treatment-timeout-triage.json"), triage);
  writeMarkdown(resolve(reportDir, "FeatureTreatmentTimeoutTriageReport.md"), renderTriageReport(triage));
  return triage;
}

function recommendedFixes(category: string, stale: boolean): string[] {
  const fixes = [
    "Keep feature-small-001 treatment blocked; do not mark the canary PASS without FinalDeliveryReport and validation evidence.",
    "Use stage timeline and checkpoint state for compare/report/gate regrade-only decisions.",
    "Preserve planner, dev worker, and evaluator thread ids even when downstream stages fail."
  ];
  if (stale) {
    fixes.push("Replace stale planner-timeout language with the corrected stage-specific category in release-gate output.");
  }
  if (category === "FEATURE_TREATMENT_EVALUATOR_TURN_NO_EVENT_TIMEOUT") {
    fixes.push("Investigate evaluator turn timeout before approving exactly one feature-small-001 treatment fresh rerun.");
  }
  return fixes;
}

function renderTriageReport(triage: FeatureTreatmentTimeoutTriage): string {
  return [
    "# Feature Treatment Timeout Triage",
    "",
    `Case: ${triage.case_id}`,
    `Current failure category: ${triage.current_failure_category}`,
    `Corrected failure category: ${triage.corrected_failure_category}`,
    `Stale or inconsistent: ${triage.failure_category_was_stale_or_inconsistent}`,
    `Last completed stage: ${triage.last_completed_stage}`,
    `First failed stage: ${triage.first_failed_stage}`,
    `Checkpoint state valid: ${triage.checkpoint_state_valid}`,
    `Treatment uses feature planner exact path: ${triage.treatment_uses_feature_planner_exact_path}`,
    "",
    "## Stage Timeline",
    ...triage.stage_timeline.map((entry) => [
      `- ${entry.stage}: started=${entry.started}, completed=${entry.completed}, status=${entry.status}`,
      entry.thread_id ? `, thread_id=${entry.thread_id}` : "",
      entry.events_path ? `, events_path=${entry.events_path}` : ""
    ].join("")),
    "",
    "## Thread IDs Present",
    ...Object.entries(triage.thread_ids_present).map(([key, value]) => `- ${key}: ${value}`),
    "",
    "## Recommended Fixes",
    ...triage.recommended_fixes.map((fix) => `- ${fix}`),
    ""
  ].join("\n");
}

function minimalTreatmentResult(): Partial<M12RunResult> {
  return {
    case_id: "feature-small-001",
    variant: "treatment",
    failure_category: ""
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const triage = writeFeatureTreatmentTimeoutTriage();
  process.stdout.write(`${JSON.stringify(triage, null, 2)}\n`);
}
