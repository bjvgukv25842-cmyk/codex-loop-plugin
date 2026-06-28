import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { M12RunResult } from "../../../scripts/effectiveness/types.ts";

export interface EvidenceSource {
  label: string;
  path?: string;
  text: string;
}

export function collectEvidenceSources(result: M12RunResult): EvidenceSource[] {
  const sources: EvidenceSource[] = [];
  addInline(sources, "result_status", result.status);
  addInline(sources, "result_validation_passed", String(result.validation_passed ?? ""));
  addInline(sources, "result_final_eval_verdict", result.final_eval_verdict ?? "");
  addInline(sources, "changed_files", result.changed_files.join("\n"));
  addInline(sources, "artifacts", result.artifacts.join("\n"));
  addInline(sources, "errors", result.errors.join("\n"));
  addInline(sources, "evaluator_verdict", result.evaluator_verdict ?? "");
  addInline(sources, "initial_eval_verdict", result.initial_eval_verdict ?? "");
  addInline(sources, "final_eval_verdict", result.final_eval_verdict ?? "");
  addInline(sources, "final_report_path", result.final_report_path ?? "");
  for (const path of result.validation_logs) {
    addPathOrInline(sources, "validation_log", path);
  }
  for (const path of [result.diff_path, result.events_path, result.stdout_path, result.stderr_path, result.final_report_path]) {
    if (path) addPathOrFixturePath(sources, sourceLabel(path), path, result.fixture_repo);
  }
  for (const artifact of result.artifacts) {
    addPathOrFixturePath(sources, "artifact_file", artifact, result.fixture_repo);
  }
  for (const path of additionalFixtureEvidencePaths(result)) {
    addPath(sources, sourceLabel(path), path);
  }
  return sources;
}

export function evidenceText(result: M12RunResult): string {
  return collectEvidenceSources(result).map((source) => source.text).join("\n");
}

export function compactEvidenceRef(value: unknown): string {
  return JSON.stringify(value);
}

function addInline(sources: EvidenceSource[], label: string, text: string): void {
  if (text.trim()) sources.push({ label, text });
}

function addPath(sources: EvidenceSource[], label: string, path: string): void {
  if (!path || !existsSync(path)) {
    return;
  }
  try {
    sources.push({
      label,
      path,
      text: readFileSync(path, "utf8")
    });
  } catch {
    // Missing or unreadable evidence is handled by the caller as absence.
  }
}

function addPathOrInline(sources: EvidenceSource[], label: string, value: string): void {
  if (existsSync(value)) {
    addPath(sources, label, value);
    return;
  }
  addInline(sources, `${label}_inline`, value);
}

function addPathOrFixturePath(sources: EvidenceSource[], label: string, path: string, fixtureRepo: string): void {
  if (fixtureRepo && !path.startsWith("/")) {
    const fixturePath = resolve(fixtureRepo, path);
    if (existsSync(fixturePath)) {
      addPath(sources, label, fixturePath);
      return;
    }
  }
  if (existsSync(path)) {
    addPath(sources, label, path);
    return;
  }
}

function additionalFixtureEvidencePaths(result: M12RunResult): string[] {
  if (!result.fixture_repo) return [];
  return [
    "src/project-name.js",
    "test/project-name.test.js",
    "src/project-slug.js",
    "test/project-slug.test.js",
    "src/pagination.js",
    "test/pagination.test.js",
    "src/date-range.js",
    "test/date-range.test.js",
    "src/invoice.js",
    "test/invoice.test.js",
    "src/cache.js",
    "src/cache-storage.js",
    "test/cache.test.js",
    "README.md",
    "docs/API.md",
    "src/duration.js",
    "test/duration.test.js",
    "src/report-builder.js",
    "test/report-builder.test.js",
    "src/title.js",
    "test/title.test.js",
    "artifacts/dev-result.json",
    "artifacts/eval-report.json",
    "artifacts/final-eval-report.json",
    "artifacts/security-scan-report.json",
    "artifacts/FinalDeliveryReport.md"
  ].map((path) => resolve(result.fixture_repo, path));
}

function sourceLabel(path: string): string {
  if (/diff/i.test(path)) return "diff";
  if (/event/i.test(path)) return "event_log";
  if (/stdout/i.test(path)) return "stdout";
  if (/stderr/i.test(path)) return "stderr";
  if (/FinalDeliveryReport/i.test(path)) return "final_report";
  if (/eval-report/i.test(path)) return "eval_report";
  if (/dev-result/i.test(path)) return "dev_result";
  if (/test\//i.test(path)) return "test_file";
  if (/src\//i.test(path)) return "source_file";
  return "file";
}
