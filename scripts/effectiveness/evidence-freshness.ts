import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import { DEFAULT_M12_DATASET_PATH } from "./dataset.ts";
import { readJson, writeJson, writeMarkdown } from "./io.ts";
import { resultPathForVariant } from "./m12-cli-args.ts";
import type { M12EvidenceFreshnessSummary, M12RunResult } from "./types.ts";

export interface EvidenceFreshnessCheck extends M12EvidenceFreshnessSummary {
  case_id: string;
  baseline_result_path: string;
  treatment_result_path: string;
  treatment_result_mtime: string;
  final_report_path: string;
  final_report_exists: boolean;
  final_report_mtime: string;
  validation_log_paths: string[];
  eval_report_paths: string[];
  dev_result_paths: string[];
  repair_request_paths: string[];
  stale_triage_files_detected: string[];
  compare_used_latest_treatment_result: boolean;
  report_used_latest_treatment_result: boolean;
  gate_used_latest_treatment_result: boolean;
  recommended_fixes: string[];
}

export function writeEvidenceFreshnessCheck(caseId: string, users: Partial<Pick<EvidenceFreshnessCheck, "compare_used_latest_treatment_result" | "report_used_latest_treatment_result" | "gate_used_latest_treatment_result">> = {}): EvidenceFreshnessCheck {
  const check = buildEvidenceFreshnessCheck(caseId, users);
  const reportDir = `evals/effectiveness/reports/${caseId}`;
  writeJson(`${reportDir}/evidence-freshness-check.json`, check);
  writeMarkdown(`${reportDir}/EvidenceFreshnessCheckReport.md`, renderEvidenceFreshnessReport(check));
  return check;
}

export function buildEvidenceFreshnessCheck(caseId: string, users: Partial<Pick<EvidenceFreshnessCheck, "compare_used_latest_treatment_result" | "report_used_latest_treatment_result" | "gate_used_latest_treatment_result">> = {}): EvidenceFreshnessCheck {
  const reportDir = `evals/effectiveness/reports/${caseId}`;
  const baselineResultPath = resultPathForVariant(caseId, "baseline");
  const treatmentResultPath = resultPathForVariant(caseId, "treatment");
  const treatment = readJson<M12RunResult | null>(treatmentResultPath, null);
  const fixtureRepo = treatment?.fixture_repo ?? "";
  const finalReportPath = resolveEvidencePath(treatment?.final_report_path ?? "", fixtureRepo);
  const artifactPaths = (treatment?.artifacts ?? []).map((artifact) => resolveEvidencePath(artifact, fixtureRepo)).filter(Boolean);
  const validationLogPaths = (treatment?.validation_logs ?? []).map((entry) => resolveEvidencePath(entry, fixtureRepo));
  const evalReportPaths = artifactPaths.filter((path) => /eval-report/i.test(path));
  const devResultPaths = artifactPaths.filter((path) => /dev-result|repair-result/i.test(path));
  const repairRequestPaths = artifactPaths.filter((path) => /repair-request/i.test(path));
  const staleTriageFiles = detectStaleTriageFiles(reportDir, treatmentResultPath);
  const evidenceSourcePaths = unique([
    baselineResultPath,
    treatmentResultPath,
    DEFAULT_M12_DATASET_PATH,
    finalReportPath,
    treatment?.diff_path ?? "",
    ...(treatment?.validation_logs ?? []),
    ...artifactPaths
  ].filter(Boolean));
  const evidenceSourceMtimes = Object.fromEntries(evidenceSourcePaths.map((path) => [path, mtime(path)]));
  const check: EvidenceFreshnessCheck = {
    case_id: caseId,
    baseline_result_path: baselineResultPath,
    treatment_result_path: treatmentResultPath,
    treatment_result_mtime: mtime(treatmentResultPath),
    final_report_path: finalReportPath,
    final_report_exists: Boolean(finalReportPath && existsSync(finalReportPath)),
    final_report_mtime: finalReportPath ? mtime(finalReportPath) : "",
    validation_log_paths: validationLogPaths,
    eval_report_paths: evalReportPaths,
    dev_result_paths: devResultPaths,
    repair_request_paths: repairRequestPaths,
    stale_triage_files_detected: staleTriageFiles,
    compare_used_latest_treatment_result: users.compare_used_latest_treatment_result ?? false,
    report_used_latest_treatment_result: users.report_used_latest_treatment_result ?? false,
    gate_used_latest_treatment_result: users.gate_used_latest_treatment_result ?? false,
    recommended_fixes: [],
    evidence_source_paths: evidenceSourcePaths,
    evidence_source_mtimes: evidenceSourceMtimes,
    stale_files_ignored: staleTriageFiles
  };
  check.recommended_fixes = recommendedFixes(check, treatment);
  return check;
}

export function freshnessSummary(check: EvidenceFreshnessCheck): M12EvidenceFreshnessSummary {
  return {
    evidence_source_paths: check.evidence_source_paths,
    evidence_source_mtimes: check.evidence_source_mtimes,
    stale_files_ignored: check.stale_files_ignored
  };
}

function renderEvidenceFreshnessReport(check: EvidenceFreshnessCheck): string {
  const lines = [
    `# ${check.case_id} Evidence Freshness Check`,
    "",
    `Treatment result path: ${check.treatment_result_path}`,
    `Treatment result mtime: ${check.treatment_result_mtime}`,
    `Final report exists: ${check.final_report_exists}`,
    `Final report path: ${check.final_report_path}`,
    `Final report mtime: ${check.final_report_mtime}`,
    "",
    "## Evidence Sources",
    ...check.evidence_source_paths.map((path) => `- ${path}: ${check.evidence_source_mtimes[path] ?? ""}`),
    "",
    "## Stale Files Ignored",
    ...(check.stale_files_ignored.length > 0 ? check.stale_files_ignored.map((path) => `- ${path}`) : ["- None"]),
    "",
    "## Users",
    `- compare used latest treatment result: ${check.compare_used_latest_treatment_result}`,
    `- report used latest treatment result: ${check.report_used_latest_treatment_result}`,
    `- gate used latest treatment result: ${check.gate_used_latest_treatment_result}`,
    "",
    "## Recommended Fixes",
    ...(check.recommended_fixes.length > 0 ? check.recommended_fixes.map((fix) => `- ${fix}`) : ["- None"]),
    ""
  ];
  return `${lines.join("\n")}\n`;
}

function recommendedFixes(check: EvidenceFreshnessCheck, treatment: M12RunResult | null): string[] {
  return [
    ...(!treatment ? ["Restore or regenerate the treatment-result.json before regrading."] : []),
    ...(treatment && treatment.status !== "PASS" ? ["Do not ignore current non-PASS treatment evidence."] : []),
    ...(check.final_report_exists ? [] : ["Resolve missing FinalDeliveryReport path before marking the canary PASS."])
  ];
}

function detectStaleTriageFiles(reportDir: string, treatmentResultPath: string): string[] {
  if (!existsSync(reportDir) || !existsSync(treatmentResultPath)) return [];
  const treatmentMtime = statSync(treatmentResultPath).mtimeMs;
  return readdirSync(reportDir)
    .filter((name) => /triage|timeout/i.test(name))
    .map((name) => join(reportDir, name))
    .filter((path) => {
      try {
        return statSync(path).mtimeMs < treatmentMtime;
      } catch {
        return false;
      }
    });
}

function resolveEvidencePath(path: string, fixtureRepo: string): string {
  if (!path) return "";
  const fixturePath = resolve(fixtureRepo, path);
  if (fixtureRepo && existsSync(fixturePath)) return fixturePath;
  if (existsSync(path) || path.startsWith("/")) return path;
  return path;
}

function mtime(path: string): string {
  if (!path || !existsSync(path)) return "";
  return statSync(path).mtime.toISOString();
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}
