import { loadM12Dataset } from "./dataset.ts";
import { readJson, writeJson, writeMarkdown } from "./io.ts";
import { resultPathForVariant } from "./m12-cli-args.ts";
import type { M12RunResult } from "./types.ts";
import { expectedArtifactsForMode } from "../../evals/effectiveness/graders/artifact-completeness-grader.ts";
import { gradeSecurity } from "../../evals/effectiveness/graders/security-grader.ts";
import { gradeTaskSuccess } from "../../evals/effectiveness/graders/task-success-grader.ts";
import { gradeValidationPass } from "../../evals/effectiveness/graders/validation-pass-grader.ts";

interface CanaryTriage {
  case_id: "repair-loop-001";
  baseline_real_run_executed: boolean;
  treatment_real_run_executed: boolean;
  secret_leak_detected: boolean;
  secret_leak_source: string;
  secret_leak_is_confirmed: boolean;
  secret_leak_is_false_positive: boolean;
  security_findings: unknown[];
  baseline_artifact_paths: string[];
  treatment_artifact_paths: string[];
  missing_artifacts_by_mode: Record<string, string[]>;
  validation_evidence_by_mode: Record<string, unknown>;
  acceptance_evidence_by_mode: Record<string, unknown>;
  grader_mapping_issues: string[];
  recommended_fixes: string[];
}

export function triageRepairLoopCanary(): CanaryTriage {
  const testCase = loadM12Dataset().find((entry) => entry.case_id === "repair-loop-001");
  if (!testCase) throw new Error("repair-loop-001 not found in M12 dataset.");
  const baseline = hydrate(readJson<M12RunResult | null>(resultPathForVariant("repair-loop-001", "baseline"), null), testCase.baseline_expected_artifacts, testCase.treatment_expected_artifacts);
  const treatment = hydrate(readJson<M12RunResult | null>(resultPathForVariant("repair-loop-001", "treatment"), null), testCase.baseline_expected_artifacts, testCase.treatment_expected_artifacts);
  const baselineSecurity = baseline ? gradeSecurity(baseline) : null;
  const treatmentSecurity = treatment ? gradeSecurity(treatment) : null;
  const securityFindings = [...(baselineSecurity?.evidence ?? []), ...(treatmentSecurity?.evidence ?? [])].map(parseEvidence);
  const confirmed = securityFindings.some((finding) => isRecord(finding) && finding.whether_confirmed_secret === true);
  const flagged = Boolean(baseline?.secret_leak_detected || treatment?.secret_leak_detected || securityFindings.length > 0);
  const triage: CanaryTriage = {
    case_id: "repair-loop-001",
    baseline_real_run_executed: baseline?.real_run_executed ?? false,
    treatment_real_run_executed: treatment?.real_run_executed ?? false,
    secret_leak_detected: flagged,
    secret_leak_source: confirmed ? "security_grader_confirmed_redacted_evidence" : flagged ? "legacy_result_flag_or_false_positive" : "",
    secret_leak_is_confirmed: confirmed,
    secret_leak_is_false_positive: flagged && !confirmed,
    security_findings: securityFindings,
    baseline_artifact_paths: baseline?.artifacts ?? [],
    treatment_artifact_paths: treatment?.artifacts ?? [],
    missing_artifacts_by_mode: {
      baseline: baseline ? missingArtifacts(baseline) : ["baseline result missing"],
      treatment: treatment ? missingArtifacts(treatment) : ["treatment result missing"]
    },
    validation_evidence_by_mode: {
      baseline: baseline ? gradeValidationPass(baseline) : { status: "BLOCKED", evidence: ["baseline result missing"] },
      treatment: treatment ? gradeValidationPass(treatment) : { status: "BLOCKED", evidence: ["treatment result missing"] }
    },
    acceptance_evidence_by_mode: {
      baseline: baseline ? gradeTaskSuccess(baseline) : { status: "BLOCKED", evidence: ["baseline result missing"] },
      treatment: treatment ? gradeTaskSuccess(treatment) : { status: "BLOCKED", evidence: ["treatment result missing"] }
    },
    grader_mapping_issues: [],
    recommended_fixes: []
  };
  if ((baseline?.expected_artifacts.length ?? 0) > 0 && (baseline?.baseline_expected_artifacts?.length ?? 0) === 0) {
    triage.grader_mapping_issues.push("baseline legacy expected_artifacts included treatment artifacts; baseline_expected_artifacts now overrides this to empty.");
  }
  if (triage.secret_leak_is_false_positive) {
    triage.grader_mapping_issues.push("legacy result or old grader flagged secret-like field/path text without confirmed secret value.");
  }
  if (Object.values(triage.missing_artifacts_by_mode).some((entries) => entries.length > 0)) {
    triage.recommended_fixes.push("Use mode-specific expected artifacts and ensure treatment artifact paths match generated artifacts.");
  }
  if (triage.secret_leak_is_confirmed) {
    triage.recommended_fixes.push("Confirmed secret evidence remains P0; rotate affected credential and keep reports redacted.");
  }
  if (!triage.secret_leak_is_confirmed) {
    triage.recommended_fixes.push("Run regrade-only compare/report/gate before rerunning the repair-loop canary.");
  }
  writeJson("evals/effectiveness/reports/repair-loop-001/canary-triage.json", triage);
  writeMarkdown("evals/effectiveness/reports/repair-loop-001/CanaryTriageReport.md", renderTriageReport(triage));
  return triage;
}

function hydrate(result: M12RunResult | null, baselineExpected?: string[], treatmentExpected?: string[]): M12RunResult | null {
  if (!result) return null;
  return {
    ...result,
    baseline_expected_artifacts: baselineExpected,
    treatment_expected_artifacts: treatmentExpected
  };
}

function missingArtifacts(result: M12RunResult): string[] {
  return expectedArtifactsForMode(result).filter((artifact) => !result.artifacts.includes(artifact) && !result.artifacts.some((entry) => entry.endsWith(`/${artifact}`)));
}

function parseEvidence(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function renderTriageReport(triage: CanaryTriage): string {
  return [
    "# M12 repair-loop-001 Canary Triage",
    "",
    `Baseline real run executed: ${triage.baseline_real_run_executed}`,
    `Treatment real run executed: ${triage.treatment_real_run_executed}`,
    `Secret leak confirmed: ${triage.secret_leak_is_confirmed}`,
    `Secret leak false positive: ${triage.secret_leak_is_false_positive}`,
    "",
    "## Missing Artifacts",
    `Baseline: ${triage.missing_artifacts_by_mode.baseline.join(", ") || "none"}`,
    `Treatment: ${triage.missing_artifacts_by_mode.treatment.join(", ") || "none"}`,
    "",
    "## Grader Mapping Issues",
    ...(triage.grader_mapping_issues.length > 0 ? triage.grader_mapping_issues.map((entry) => `- ${entry}`) : ["- None"]),
    "",
    "## Recommended Fixes",
    ...(triage.recommended_fixes.length > 0 ? triage.recommended_fixes.map((entry) => `- ${entry}`) : ["- None"]),
    "",
    "All security excerpts in this report are redacted. Raw secrets, if any, must not be copied into reports.",
    ""
  ].join("\n");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = triageRepairLoopCanary();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
