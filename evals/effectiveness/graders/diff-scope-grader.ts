import type { GraderResult, M12RunResult } from "../../../scripts/effectiveness/types.ts";
import { evidenceText } from "./evidence-utils.ts";

export function gradeDiffScope(result: M12RunResult): GraderResult {
  const forbidden = result.changed_files.filter((file) =>
    result.forbidden_files.some((forbiddenFile) => matchesForbidden(file, forbiddenFile))
  );
  const reviewNeeded = reviewNeededForCase(result);
  const publicApiIssues = result.case_id.startsWith("refactor-") ? refactorPublicApiIssues(result) : [];
  const failedIssues = [...forbidden, ...publicApiIssues];
  return {
    grader: "diff-scope",
    status: failedIssues.length === 0 ? "PASS" : "FAIL",
    score: failedIssues.length === 0 ? 1 : 0,
    p0: forbidden.some((file) => /(?:^|\/)\.env$|secret|token|key/i.test(file)),
    severe: failedIssues.length > 0,
    summary: failedIssues.length === 0
      ? reviewNeeded.length > 0
        ? "No forbidden files changed; production source changes require review."
        : "No forbidden files changed."
      : publicApiIssues.length > 0
        ? "Public API changes were detected in a refactor case."
        : "Forbidden files were changed.",
    evidence: [...failedIssues, ...reviewNeeded]
  };
}

function matchesForbidden(file: string, forbidden: string): boolean {
  const normalizedFile = file.replace(/\\/g, "/");
  const normalizedForbidden = forbidden.replace(/\\/g, "/").replace(/^~\//, "");
  return normalizedFile === normalizedForbidden || normalizedFile.endsWith(`/${normalizedForbidden}`) || normalizedFile.includes(normalizedForbidden);
}

function reviewNeededForCase(result: M12RunResult): string[] {
  if (result.case_id === "bugfix-small-002") return bugfixSmall002ReviewNeeded(result);
  if (result.case_id.startsWith("test-coverage-")) return testCoverageReviewNeeded(result);
  if (result.case_id.startsWith("docs-")) return docsReviewNeeded(result);
  if (result.case_id.startsWith("refactor-")) return refactorReviewNeeded(result);
  return [];
}

function bugfixSmall002ReviewNeeded(result: M12RunResult): string[] {
  return result.changed_files
    .map((file) => file.replace(/\\/g, "/"))
    .filter((file) => file.startsWith("src/") && file !== "src/date-range.js")
    .map((file) => `review_needed:${file}: bugfix-small-002 changed non-target source.`);
}

function docsReviewNeeded(result: M12RunResult): string[] {
  const changedSource = result.changed_files.filter((file) => file.replace(/\\/g, "/").startsWith("src/"));
  if (changedSource.length === 0) return [];
  const explanatoryText = [
    evidenceText(result),
    result.errors.join("\n"),
    result.validation_logs.join("\n"),
    result.artifacts.join("\n")
  ].join("\n").toLowerCase();
  if (/real (implementation )?bug|necessary production code change|src\/duration\.js change explained|required source change|clear api mismatch/.test(explanatoryText)) {
    return [];
  }
  return changedSource.map((file) => `review_needed:${file}: docs-update case changed production source without recorded necessity.`);
}

function testCoverageReviewNeeded(result: M12RunResult): string[] {
  const changedSource = result.changed_files.filter((file) => file.replace(/\\/g, "/").startsWith("src/"));
  if (changedSource.length === 0) return [];
  const explanatoryText = [
    evidenceText(result),
    result.errors.join("\n"),
    result.validation_logs.join("\n"),
    result.artifacts.join("\n")
  ].join("\n").toLowerCase();
  if (/real (implementation )?bug|necessary production code change|src\/(?:invoice|cache|cache-storage)\.js change explained|required source change/.test(explanatoryText)) {
    return [];
  }
  return changedSource.map((file) => `review_needed:${file}: test-coverage case changed production source without recorded necessity.`);
}

function refactorReviewNeeded(result: M12RunResult): string[] {
  const changedFiles = result.changed_files.map((file) => file.replace(/\\/g, "/"));
  return changedFiles
    .filter((file) => file.startsWith("src/") && file !== "src/report-builder.js")
    .map((file) => `review_needed:${file}: refactor case changed non-target source.`);
}

function refactorPublicApiIssues(result: M12RunResult): string[] {
  const text = evidenceText(result).toLowerCase();
  const diffRemovedExport = /-\s*export function\s+(buildsummaryreport|builddetailedreport|buildcsvreport)\b/.test(text);
  const explicitExportChange = /public api (changed|removed|renamed)|export (removed|renamed)|missing export/.test(text);
  return diffRemovedExport || explicitExportChange ? ["public_api_change: refactor case changed required report-builder exports."] : [];
}
