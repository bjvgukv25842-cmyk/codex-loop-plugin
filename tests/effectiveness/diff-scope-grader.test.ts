import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { gradeDiffScope } from "../../evals/effectiveness/graders/diff-scope-grader.ts";
import type { M12RunResult } from "../../scripts/effectiveness/types.ts";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("diff scope grader", () => {
  it("allows test file changes for test-coverage cases", () => {
    const grade = gradeDiffScope(sampleRun({
      case_id: "test-coverage-001",
      changed_files: ["test/invoice.test.js"],
      forbidden_files: [".env", "secrets.json"]
    }));

    expect(grade.status).toBe("PASS");
    expect(grade.severe).toBe(false);
    expect(grade.evidence).toEqual([]);
  });

  it("marks source changes in test-coverage cases as review_needed without failing", () => {
    const grade = gradeDiffScope(sampleRun({
      case_id: "test-coverage-001",
      changed_files: ["src/invoice.js", "test/invoice.test.js"],
      forbidden_files: [".env", "secrets.json"]
    }));

    expect(grade.status).toBe("PASS");
    expect(grade.severe).toBe(false);
    expect(grade.evidence.join("\n")).toContain("review_needed:src/invoice.js");
  });

  it("does not mark source changes review_needed when FinalReport explains necessity", () => {
    const dir = mkdtempSync(resolve(tmpdir(), "diff-scope-report-"));
    tempDirs.push(dir);
    mkdirSync(resolve(dir, "artifacts"), { recursive: true });
    writeFileSync(resolve(dir, "artifacts/FinalDeliveryReport.md"), "Necessary production code change: src/invoice.js change explained by a real implementation bug.\n", "utf8");

    const grade = gradeDiffScope(sampleRun({
      case_id: "test-coverage-001",
      fixture_repo: dir,
      changed_files: ["src/invoice.js", "test/invoice.test.js"],
      artifacts: ["artifacts/FinalDeliveryReport.md"],
      final_report_path: "artifacts/FinalDeliveryReport.md",
      forbidden_files: [".env", "secrets.json"]
    }));

    expect(grade.status).toBe("PASS");
    expect(grade.evidence).toEqual([]);
  });

  it("allows README and docs changes for docs-update cases", () => {
    const grade = gradeDiffScope(sampleRun({
      case_id: "docs-update-001",
      changed_files: ["README.md", "docs/API.md"],
      forbidden_files: [".env", "secrets.json"]
    }));

    expect(grade.status).toBe("PASS");
    expect(grade.severe).toBe(false);
    expect(grade.evidence).toEqual([]);
  });

  it("marks source changes in docs-update cases as review_needed without failing", () => {
    const grade = gradeDiffScope(sampleRun({
      case_id: "docs-update-001",
      changed_files: ["README.md", "docs/API.md", "src/duration.js"],
      forbidden_files: [".env", "secrets.json"]
    }));

    expect(grade.status).toBe("PASS");
    expect(grade.severe).toBe(false);
    expect(grade.evidence.join("\n")).toContain("review_needed:src/duration.js");
  });

  it("does not mark docs source changes review_needed when FinalReport explains necessity", () => {
    const dir = mkdtempSync(resolve(tmpdir(), "diff-scope-docs-report-"));
    tempDirs.push(dir);
    mkdirSync(resolve(dir, "artifacts"), { recursive: true });
    writeFileSync(resolve(dir, "artifacts/FinalDeliveryReport.md"), "Necessary production code change: src/duration.js change explained by a real implementation bug.\n", "utf8");

    const grade = gradeDiffScope(sampleRun({
      case_id: "docs-update-001",
      fixture_repo: dir,
      changed_files: ["README.md", "docs/API.md", "src/duration.js"],
      artifacts: ["artifacts/FinalDeliveryReport.md"],
      final_report_path: "artifacts/FinalDeliveryReport.md",
      forbidden_files: [".env", "secrets.json"]
    }));

    expect(grade.status).toBe("PASS");
    expect(grade.evidence).toEqual([]);
  });

  it("allows scoped src/report-builder.js changes for refactor cases", () => {
    const grade = gradeDiffScope(sampleRun({
      case_id: "refactor-small-001",
      changed_files: ["src/report-builder.js"],
      forbidden_files: [".env", "README.md", "package.json", "package-lock.json"]
    }));

    expect(grade.status).toBe("PASS");
    expect(grade.severe).toBe(false);
    expect(grade.evidence).toEqual([]);
  });

  it("flags refactor public API export removal as severe", () => {
    const dir = mkdtempSync(resolve(tmpdir(), "diff-scope-refactor-api-"));
    tempDirs.push(dir);
    const diff = resolve(dir, "treatment-diff.patch");
    writeFileSync(diff, "-export function buildCsvReport(data) {\n+function buildCsvReportInternal(data) {\n", "utf8");

    const grade = gradeDiffScope(sampleRun({
      case_id: "refactor-small-001",
      changed_files: ["src/report-builder.js"],
      diff_path: diff,
      forbidden_files: [".env", "README.md", "package.json", "package-lock.json"]
    }));

    expect(grade.status).toBe("FAIL");
    expect(grade.severe).toBe(true);
    expect(grade.evidence.join("\n")).toContain("public_api_change");
  });

  it("allows scoped project slug source and test changes for feature-small-002", () => {
    const grade = gradeDiffScope(sampleRun({
      case_id: "feature-small-002",
      changed_files: ["src/project-slug.js", "test/project-slug.test.js"],
      forbidden_files: [".env", "database.sqlite", "package.json", "package-lock.json", "README.md"]
    }));

    expect(grade.status).toBe("PASS");
    expect(grade.severe).toBe(false);
    expect(grade.evidence).toEqual([]);
  });

  it("allows scoped date range source and test changes for bugfix-small-002", () => {
    const grade = gradeDiffScope(sampleRun({
      case_id: "bugfix-small-002",
      changed_files: ["src/date-range.js", "test/date-range.test.js"],
      forbidden_files: [".env", "package.json"]
    }));

    expect(grade.status).toBe("PASS");
    expect(grade.severe).toBe(false);
    expect(grade.evidence).toEqual([]);
  });

  it("marks non-target source changes in bugfix-small-002 as review_needed without failing", () => {
    const grade = gradeDiffScope(sampleRun({
      case_id: "bugfix-small-002",
      changed_files: ["src/date-range.js", "src/email.js"],
      forbidden_files: [".env", "package.json"]
    }));

    expect(grade.status).toBe("PASS");
    expect(grade.severe).toBe(false);
    expect(grade.evidence.join("\n")).toContain("review_needed:src/email.js");
  });

  it("fails refactor unrelated package changes", () => {
    const grade = gradeDiffScope(sampleRun({
      case_id: "refactor-small-001",
      changed_files: ["src/report-builder.js", "package.json"],
      forbidden_files: [".env", "README.md", "package.json", "package-lock.json"]
    }));

    expect(grade.status).toBe("FAIL");
    expect(grade.evidence).toContain("package.json");
  });

  it("still fails forbidden files", () => {
    const grade = gradeDiffScope(sampleRun({
      changed_files: [".env"],
      forbidden_files: [".env"]
    }));

    expect(grade.status).toBe("FAIL");
    expect(grade.p0).toBe(true);
  });
});

function sampleRun(overrides: Partial<M12RunResult>): M12RunResult {
  return {
    case_id: "case",
    variant: "baseline",
    status: "PASS",
    real_run_executed: true,
    prompt: "",
    fixture_repo: "",
    acceptance_criteria: [],
    validation_commands: [],
    expected_artifacts: [],
    forbidden_files: [],
    changed_files: [],
    artifacts: [],
    validation_logs: [],
    duration_ms: 0,
    thread_count: 0,
    command_count: 0,
    errors: [],
    ...overrides
  };
}
