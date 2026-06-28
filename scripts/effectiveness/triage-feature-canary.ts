import { existsSync } from "node:fs";

import { gradeSecurity } from "../../evals/effectiveness/graders/security-grader.ts";
import { readJson, writeJson, writeMarkdown } from "./io.ts";
import { resultPathForVariant } from "./m12-cli-args.ts";
import type { M12RunResult } from "./types.ts";

interface FeatureCanaryTriage {
  case_id: "feature-small-001";
  baseline: {
    real_run_executed: boolean;
    status: string;
    thread_id: string;
    secret_leak_detected: boolean;
    secret_leak_source: string;
    secret_leak_confirmed: boolean;
    secret_leak_false_positive: boolean;
    security_findings: unknown[];
  };
  treatment: {
    real_run_executed: boolean;
    status: string;
    failure_category: string;
    planner_thread_started: boolean;
    planner_thread_id: string;
    planner_completed: boolean;
    dev_worker_started: boolean;
    evaluator_started: boolean;
    timeout_stage: string;
    events_path: string;
    stderr_path: string;
    stdout_path: string;
    checkpoint_state_path: string;
    raw_output_path: string;
    redacted_output_path: string;
  };
  recommended_fixes: string[];
}

export function triageFeatureSmall001Canary(): FeatureCanaryTriage {
  const baseline = readJson<M12RunResult | null>(resultPathForVariant("feature-small-001", "baseline"), null);
  const treatment = readJson<M12RunResult | null>(resultPathForVariant("feature-small-001", "treatment"), null);
  const baselineSecurity = baseline ? gradeSecurity(baseline) : null;
  const securityFindings = (baselineSecurity?.evidence ?? []).map(parseEvidence);
  const confirmedSecret = securityFindings.some((finding) => isRecord(finding) && finding.whether_confirmed_secret === true);
  const legacySecretFlag = baseline?.secret_leak_detected === true;
  const treatmentFailureCategory = normalizeFeatureTreatmentFailure(treatment);
  const plannerOutputBase = treatment?.planner_stdout_path ||
    "evals/effectiveness/reports/feature-small-001/sdk-stage-logs/generic-planner-stdout.log";
  const triage: FeatureCanaryTriage = {
    case_id: "feature-small-001",
    baseline: {
      real_run_executed: baseline?.real_run_executed ?? false,
      status: baseline?.status ?? "",
      thread_id: baseline?.thread_id ?? "",
      secret_leak_detected: legacySecretFlag || confirmedSecret,
      secret_leak_source: confirmedSecret ? "security_grader_confirmed_redacted_evidence" : legacySecretFlag ? "legacy_result_flag_without_confirmed_secret" : "",
      secret_leak_confirmed: confirmedSecret,
      secret_leak_false_positive: legacySecretFlag && !confirmedSecret,
      security_findings: securityFindings
    },
    treatment: {
      real_run_executed: treatment?.real_run_executed ?? false,
      status: treatment?.status ?? "",
      failure_category: treatmentFailureCategory,
      planner_thread_started: Boolean(treatment?.planner_thread_id),
      planner_thread_id: treatment?.planner_thread_id ?? "",
      planner_completed: treatment?.planner_stage_completed === true,
      dev_worker_started: Boolean(treatment?.dev_worker_thread_id),
      evaluator_started: Boolean(treatment?.initial_evaluator_thread_id || treatment?.final_evaluator_thread_id),
      timeout_stage: plannerTimeoutCategory(treatmentFailureCategory) ? "planner" : "",
      events_path: treatment?.planner_events_path || "evals/effectiveness/reports/feature-small-001/sdk-stage-logs/generic-planner-events.jsonl",
      stderr_path: treatment?.planner_stderr_path || "evals/effectiveness/reports/feature-small-001/sdk-stage-logs/generic-planner-stderr.log",
      stdout_path: plannerOutputBase,
      checkpoint_state_path: treatment?.checkpoint_state_path || "evals/effectiveness/reports/feature-small-001/treatment-generic-feature-state.json",
      raw_output_path: treatment?.planner_raw_output_path || plannerOutputBase,
      redacted_output_path: treatment?.planner_redacted_output_path || "evals/effectiveness/reports/feature-small-001/sdk-stage-logs/generic-planner-stdout-redacted.log"
    },
    recommended_fixes: []
  };
  if (triage.baseline.secret_leak_false_positive) {
    triage.recommended_fixes.push("Keep the stricter security scanner and regrade-only so legacy secret_leak_detected text does not block without confirmed secret evidence.");
  }
  if (plannerTimeoutCategory(treatmentFailureCategory)) {
    triage.recommended_fixes.push("Before any rerun, keep generic feature treatment checkpointed and preserve planner events/stdout/stderr/checkpoint evidence for planner-lite-v2 timeouts.");
  }
  if (treatmentFailureCategory === "FEATURE_TREATMENT_DEV_WORKER_NOT_STARTED_AFTER_PLANNER") {
    triage.recommended_fixes.push("Do not mark planner success as treatment success; dispatch dev_worker from PLANNER_DONE or block with the explicit dev-worker-not-started category.");
  }
  if (triage.baseline.secret_leak_confirmed) {
    triage.recommended_fixes.push("Confirmed secret evidence remains P0; rotate the affected credential and keep all reports redacted.");
  }
  writeJson("evals/effectiveness/reports/feature-small-001/feature-canary-triage.json", triage);
  writeMarkdown("evals/effectiveness/reports/feature-small-001/FeatureCanaryTriageReport.md", renderFeatureTriageReport(triage));
  return triage;
}

function normalizeFeatureTreatmentFailure(result: M12RunResult | null): string {
  if (!result) return "TREATMENT_RESULT_MISSING";
  if (result.failure_category === "SDK_NO_EVENT_TIMEOUT" && result.planner_thread_id) return "FEATURE_TREATMENT_PLANNER_TURN_NO_EVENT_TIMEOUT";
  if (result.failure_category === "SDK_THREAD_TIMEOUT" && result.planner_thread_id) return "FEATURE_TREATMENT_PLANNER_TIMEOUT";
  return result.failure_category || "";
}

function plannerTimeoutCategory(category: string): boolean {
  return category === "FEATURE_TREATMENT_PLANNER_NO_EVENT_TIMEOUT" ||
    category === "FEATURE_TREATMENT_PLANNER_STARTUP_NO_EVENT_TIMEOUT" ||
    category === "FEATURE_TREATMENT_PLANNER_TURN_NO_EVENT_TIMEOUT" ||
    category === "FEATURE_TREATMENT_PLANNER_TIMEOUT";
}

function renderFeatureTriageReport(triage: FeatureCanaryTriage): string {
  return [
    "# M12 feature-small-001 Canary Triage",
    "",
    `Baseline status: ${triage.baseline.status}`,
    `Baseline real run executed: ${triage.baseline.real_run_executed}`,
    `Baseline thread_id: ${triage.baseline.thread_id}`,
    `Baseline secret leak confirmed: ${triage.baseline.secret_leak_confirmed}`,
    `Baseline secret leak false positive: ${triage.baseline.secret_leak_false_positive}`,
    "",
    `Treatment status: ${triage.treatment.status}`,
    `Treatment failure category: ${triage.treatment.failure_category}`,
    `Planner thread_id: ${triage.treatment.planner_thread_id}`,
    `Planner completed: ${triage.treatment.planner_completed}`,
    `Dev worker started: ${triage.treatment.dev_worker_started}`,
    `Evaluator started: ${triage.treatment.evaluator_started}`,
    "",
    "## Planner Evidence",
    `- events: ${pathStatus(triage.treatment.events_path)}`,
    `- stdout: ${pathStatus(triage.treatment.stdout_path)}`,
    `- stderr: ${pathStatus(triage.treatment.stderr_path)}`,
    `- checkpoint: ${pathStatus(triage.treatment.checkpoint_state_path)}`,
    `- redacted output: ${pathStatus(triage.treatment.redacted_output_path)}`,
    "",
    "## Recommended Fixes",
    ...(triage.recommended_fixes.length > 0 ? triage.recommended_fixes.map((entry) => `- ${entry}`) : ["- None"]),
    "",
    "This report is generated from existing feature-small-001 evidence only. It does not start Codex, SDK threads, or another M12 case.",
    ""
  ].join("\n");
}

function pathStatus(path: string): string {
  return `${path} (${existsSync(path) ? "exists" : "missing"})`;
}

function parseEvidence(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = triageFeatureSmall001Canary();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
