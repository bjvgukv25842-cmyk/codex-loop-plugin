import type { GraderResult, M12RunResult } from "../../../scripts/effectiveness/types.ts";
import { evaluateThreadEvidence } from "../../../src/effectiveness/thread-evidence-policy.ts";

export function gradeArtifactCompleteness(result: M12RunResult): GraderResult {
  const expected = expectedArtifactsForMode(result);
  const missing = expected.filter((artifact) => !artifactPresent(result, artifact));
  return {
    grader: "artifact-completeness",
    status: missing.length === 0 ? "PASS" : "FAIL",
    score: expected.length === 0 ? 1 : (expected.length - missing.length) / expected.length,
    p0: false,
    severe: missing.length > 0,
    summary: missing.length === 0 ? "All mode-specific expected artifacts are present." : "Mode-specific expected artifacts are missing.",
    evidence: missing
  };
}

export function expectedArtifactsForMode(result: M12RunResult): string[] {
  if (result.variant === "baseline") {
    return result.baseline_expected_artifacts ?? [];
  }
  const expected = result.treatment_expected_artifacts ?? result.expected_artifacts;
  const policy = evaluateThreadEvidence({ case_id: result.case_id, category: "" }, result);
  if (policy.policy !== "direct-pass") return expected;
  return expected.filter((artifact) => !isRepairArtifact(artifact));
}

function artifactPresent(result: M12RunResult, artifact: string): boolean {
  if (result.artifacts.includes(artifact) || result.artifacts.some((entry) => entry.endsWith(`/${artifact}`)) || result.final_report_path === artifact) {
    return true;
  }
  if (isEvalReportArtifact(artifact)) {
    return result.artifacts.some((entry) => isEvalReportArtifact(entry));
  }
  return false;
}

function isRepairArtifact(artifact: string): boolean {
  return /repair-request|repair-result|dev-repair-result|eval-report-needs-revision/.test(artifact);
}

function isEvalReportArtifact(artifact: string): boolean {
  return /(^|\/)(eval-report|final-eval-report|eval-report-pass)\.json$/.test(artifact);
}
