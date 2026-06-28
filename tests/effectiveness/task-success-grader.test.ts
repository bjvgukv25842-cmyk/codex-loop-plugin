import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { gradeTaskSuccess } from "../../evals/effectiveness/graders/task-success-grader.ts";
import type { M12RunResult } from "../../scripts/effectiveness/types.ts";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("task success grader", () => {
  it("uses validation log evidence for baseline acceptance criteria", () => {
    const dir = mkdtempSync(resolve(tmpdir(), "task-grader-"));
    tempDirs.push(dir);
    const log = resolve(dir, "validation.log");
    mkdirSync(dir, { recursive: true });
    writeFileSync(log, "npm test\nPASS rejects whitespace-only project names\n", "utf8");

    const grade = gradeTaskSuccess(sampleRun({
      variant: "baseline",
      acceptance_criteria: ["Reject whitespace-only project names"],
      validation_logs: [log]
    }));

    expect(grade.status).toBe("PASS");
  });

  it("reports checked evidence sources for missing criteria", () => {
    const grade = gradeTaskSuccess(sampleRun({
      acceptance_criteria: ["RepairRequest references evaluator finding"],
      validation_logs: []
    }));

    expect(grade.status).toBe("FAIL");
    expect(grade.evidence[0]).toContain("evidence_sources_checked");
    expect(grade.evidence[0]).toContain("checked_files");
  });

  it("reads latest treatment result artifacts for feature-small-001 PASS evidence", () => {
    const dir = mkdtempSync(resolve(tmpdir(), "task-grader-treatment-"));
    tempDirs.push(dir);
    mkdirSync(resolve(dir, "src"), { recursive: true });
    mkdirSync(resolve(dir, "test"), { recursive: true });
    mkdirSync(resolve(dir, "artifacts"), { recursive: true });
    writeFileSync(resolve(dir, "src/project-name.js"), "if (name.length > 80) return { ok: false };\n", "utf8");
    writeFileSync(resolve(dir, "test/project-name.test.js"), "validateProjectName(\"x\".repeat(81)).ok === false\n", "utf8");
    writeFileSync(resolve(dir, "artifacts/FinalDeliveryReport.md"), "npm test: PASS\nFinal EvalReport: PASS\n", "utf8");
    writeFileSync(resolve(dir, "artifacts/final-eval-report.json"), "{\"verdict\":\"PASS\"}\n", "utf8");

    const grade = gradeTaskSuccess(sampleRun({
      case_id: "feature-small-001",
      variant: "treatment",
      status: "PASS",
      fixture_repo: dir,
      acceptance_criteria: ["Reject names longer than 80 characters."],
      artifacts: ["artifacts/FinalDeliveryReport.md", "artifacts/final-eval-report.json"],
      final_report_path: "artifacts/FinalDeliveryReport.md",
      final_eval_verdict: "PASS",
      validation_passed: true
    }));

    expect(grade.status).toBe("PASS");
  });

  it("recognizes test-coverage-001 invoice coverage evidence", () => {
    const dir = mkdtempSync(resolve(tmpdir(), "task-grader-test-coverage-"));
    tempDirs.push(dir);
    mkdirSync(resolve(dir, "test"), { recursive: true });
    mkdirSync(resolve(dir, "artifacts"), { recursive: true });
    writeFileSync(resolve(dir, "test/invoice.test.js"), [
      "test('covers empty items', () => calculateInvoiceTotal([]));",
      "test('covers zero discount', () => calculateInvoiceTotal(items, { discount: 0 }));",
      "test('covers percent discount', () => calculateInvoiceTotal(items, { discountType: 'percent' }));",
      "test('covers fixed discount', () => calculateInvoiceTotal(items, { discountType: 'fixed' }));",
      "test('covers taxable=false', () => calculateInvoiceTotal(items, { taxable: false }));",
      "test('covers shippingFee', () => calculateInvoiceTotal(items, { shippingFee: 4 }));",
      "test('throws for invalid price', () => assert.throws(() => calculateInvoiceTotal([{ price: -1, quantity: 1 }])));",
      "test('throws for invalid quantity', () => assert.throws(() => calculateInvoiceTotal([{ price: 1, quantity: -1 }])));"
    ].join("\n"), "utf8");
    writeFileSync(resolve(dir, "artifacts/FinalDeliveryReport.md"), "npm test: PASS\nnpm run coverage:contract: PASS\nFinal EvalReport: PASS\n", "utf8");

    const grade = gradeTaskSuccess(sampleRun({
      case_id: "test-coverage-001",
      variant: "treatment",
      status: "PASS",
      fixture_repo: dir,
      acceptance_criteria: [
        "Adds tests for empty items.",
        "Adds tests for discount of 0.",
        "Adds tests for percentage discount.",
        "Adds tests for fixed discount.",
        "Adds tests for taxable=false.",
        "Adds tests for shippingFee.",
        "Adds tests for invalid item price and quantity.",
        "Does not modify src/invoice.js unless a new test exposes a real implementation bug.",
        "npm test passes.",
        "npm run coverage:contract passes."
      ],
      changed_files: ["test/invoice.test.js"],
      artifacts: ["artifacts/FinalDeliveryReport.md"],
      final_report_path: "artifacts/FinalDeliveryReport.md",
      final_eval_verdict: "PASS",
      validation_passed: true
    }));

    expect(grade.status).toBe("PASS");
  });

  it("recognizes docs-update-001 README and API documentation evidence", () => {
    const dir = mkdtempSync(resolve(tmpdir(), "task-grader-docs-"));
    tempDirs.push(dir);
    mkdirSync(resolve(dir, "docs"), { recursive: true });
    mkdirSync(resolve(dir, "artifacts"), { recursive: true });
    writeFileSync(resolve(dir, "README.md"), [
      "# Duration Utils",
      "",
      "## Installation",
      "Run npm install.",
      "",
      "## Usage",
      "`parseDuration(\"30s\")`, `parseDuration(\"5m\")`, and `parseDuration(\"2h\")` return millisecond values.",
      "",
      "## API Reference",
      "`parseDuration(input)` accepts strings with units.",
      "",
      "## Testing",
      "Run `npm test` and `npm run docs:contract`."
    ].join("\n"), "utf8");
    writeFileSync(resolve(dir, "docs/API.md"), [
      "# API",
      "",
      "parseDuration(input) supports units s, m, h.",
      "Invalid input returns null."
    ].join("\n"), "utf8");
    writeFileSync(resolve(dir, "artifacts/FinalDeliveryReport.md"), "npm test: PASS\nnpm run docs:contract: PASS\nFinal EvalReport: PASS\n", "utf8");

    const grade = gradeTaskSuccess(sampleRun({
      case_id: "docs-update-001",
      variant: "treatment",
      status: "PASS",
      fixture_repo: dir,
      acceptance_criteria: [
        "README.md contains an Installation section.",
        "README.md contains a Usage section.",
        "README.md contains an API Reference section.",
        "README.md contains a Testing section.",
        "README.md contains at least 3 parseDuration examples.",
        "docs/API.md exists.",
        "docs/API.md describes supported units: s, m, h.",
        "docs/API.md describes invalid input returns null.",
        "Does not modify src/duration.js unless there is a clear reason.",
        "npm test passes.",
        "npm run docs:contract passes."
      ],
      changed_files: ["README.md", "docs/API.md"],
      artifacts: ["artifacts/FinalDeliveryReport.md"],
      final_report_path: "artifacts/FinalDeliveryReport.md",
      final_eval_verdict: "PASS",
      validation_passed: true
    }));

    expect(grade.status).toBe("PASS");
  });

  it("recognizes refactor-small-001 structure and behavior preservation evidence", () => {
    const dir = mkdtempSync(resolve(tmpdir(), "task-grader-refactor-"));
    tempDirs.push(dir);
    mkdirSync(resolve(dir, "src"), { recursive: true });
    mkdirSync(resolve(dir, "artifacts"), { recursive: true });
    writeFileSync(resolve(dir, "src/report-builder.js"), [
      "export function buildSummaryReport(data) { return formatText(data?.title, 'Untitled'); }",
      "export function buildDetailedReport(data) { return formatReportDate(data?.createdAt); }",
      "export function buildCsvReport(data) { return formatStatus(data?.status); }",
      "function formatText(value, fallback) { return String(value ?? fallback).trim(); }",
      "function formatReportDate(value) { return '2026-01-01'; }",
      "function formatStatus(value) { return String(value ?? 'draft').toLowerCase() === 'archived' ? 'Archived' : 'Draft'; }",
      "function formatMoney(value) { return `$${Number(value ?? 0).toFixed(2)}`; }"
    ].join("\n"), "utf8");
    writeFileSync(resolve(dir, "artifacts/FinalDeliveryReport.md"), [
      "Public function outputs are unchanged.",
      "Public API exports remain buildSummaryReport, buildDetailedReport, and buildCsvReport.",
      "npm test: PASS",
      "npm run refactor:contract: PASS",
      "npm run lint:structure: PASS"
    ].join("\n"), "utf8");

    const grade = gradeTaskSuccess(sampleRun({
      case_id: "refactor-small-001",
      variant: "treatment",
      status: "PASS",
      fixture_repo: dir,
      acceptance_criteria: [
        "Duplicate trimming logic is centralized.",
        "Duplicate date formatting logic is centralized.",
        "Duplicate status mapping logic is centralized.",
        "Public function outputs are unchanged.",
        "Public API exports remain buildSummaryReport, buildDetailedReport, and buildCsvReport.",
        "npm test passes.",
        "npm run refactor:contract passes.",
        "npm run lint:structure passes.",
        "No unrelated files changed."
      ],
      changed_files: ["src/report-builder.js"],
      artifacts: ["artifacts/FinalDeliveryReport.md"],
      final_report_path: "artifacts/FinalDeliveryReport.md",
      final_eval_verdict: "PASS",
      validation_passed: true
    }));

    expect(grade.status).toBe("PASS");
  });

  it("recognizes feature-small-002 slug normalization evidence", () => {
    const dir = mkdtempSync(resolve(tmpdir(), "task-grader-feature-002-"));
    tempDirs.push(dir);
    mkdirSync(resolve(dir, "src"), { recursive: true });
    mkdirSync(resolve(dir, "test"), { recursive: true });
    mkdirSync(resolve(dir, "artifacts"), { recursive: true });
    writeFileSync(resolve(dir, "src/project-slug.js"), [
      "export function normalizeProjectSlug(input) {",
      "  const normalized = String(input ?? \"\").trim().toLowerCase().replaceAll(\" \", \"-\");",
      "  if (normalized.length === 0) throw new Error(\"empty slug\");",
      "  return normalized;",
      "}"
    ].join("\n"), "utf8");
    writeFileSync(resolve(dir, "test/project-slug.test.js"), [
      "normalizeProjectSlug(\"ProjectAlpha\") === \"projectalpha\";",
      "normalizeProjectSlug(\"project alpha beta\") === \"project-alpha-beta\";",
      "normalizeProjectSlug(\"  Project Alpha  \") === \"project-alpha\";",
      "assert.throws(() => normalizeProjectSlug(\"   \"), /empty/i);"
    ].join("\n"), "utf8");
    writeFileSync(resolve(dir, "artifacts/FinalDeliveryReport.md"), "npm test: PASS\nFinal EvalReport: PASS\n", "utf8");

    const grade = gradeTaskSuccess(sampleRun({
      case_id: "feature-small-002",
      variant: "treatment",
      status: "PASS",
      fixture_repo: dir,
      acceptance_criteria: [
        "Lowercase ASCII letters.",
        "Convert spaces to hyphens.",
        "Trim surrounding whitespace.",
        "Reject empty slugs after normalization."
      ],
      changed_files: ["src/project-slug.js"],
      artifacts: ["artifacts/FinalDeliveryReport.md"],
      final_report_path: "artifacts/FinalDeliveryReport.md",
      final_eval_verdict: "PASS",
      validation_passed: true
    }));

    expect(grade.status).toBe("PASS");
  });

  it("recognizes bugfix-small-002 date range overlap evidence", () => {
    const dir = mkdtempSync(resolve(tmpdir(), "task-grader-bugfix-002-"));
    tempDirs.push(dir);
    mkdirSync(resolve(dir, "src"), { recursive: true });
    mkdirSync(resolve(dir, "test"), { recursive: true });
    mkdirSync(resolve(dir, "artifacts"), { recursive: true });
    writeFileSync(resolve(dir, "src/date-range.js"), [
      "export function rangesOverlap(first, second) {",
      "  if (!isValidRange(first) || !isValidRange(second)) return false;",
      "  return first.start < second.end && second.start < first.end;",
      "}",
      "function isValidRange(range) {",
      "  return Boolean(range) && Number.isFinite(range.start) && Number.isFinite(range.end) && range.start < range.end;",
      "}"
    ].join("\n"), "utf8");
    writeFileSync(resolve(dir, "test/date-range.test.js"), [
      "rangesOverlap({ start: 1, end: 3 }, { start: 3, end: 5 }) === false;",
      "rangesOverlap({ start: 1, end: 10 }, { start: 3, end: 5 }) === true;",
      "rangesOverlap({ start: 2, end: 6 }, { start: 2, end: 6 }) === true;",
      "rangesOverlap({ start: 3, end: 3 }, { start: 1, end: 2 }) === false;"
    ].join("\n"), "utf8");
    writeFileSync(resolve(dir, "artifacts/FinalDeliveryReport.md"), "npm test: PASS\nFinal EvalReport: PASS\n", "utf8");

    const grade = gradeTaskSuccess(sampleRun({
      case_id: "bugfix-small-002",
      variant: "treatment",
      status: "PASS",
      fixture_repo: dir,
      acceptance_criteria: [
        "Adjacent ranges do not overlap.",
        "Nested ranges overlap.",
        "Identical ranges overlap.",
        "Invalid ranges are rejected."
      ],
      changed_files: ["src/date-range.js"],
      artifacts: ["artifacts/FinalDeliveryReport.md"],
      final_report_path: "artifacts/FinalDeliveryReport.md",
      final_eval_verdict: "PASS",
      validation_passed: true
    }));

    expect(grade.status).toBe("PASS");
  });

  it("returns mapping error when PASS treatment has rich evidence but a criterion is unmapped", () => {
    const dir = mkdtempSync(resolve(tmpdir(), "task-grader-mapping-"));
    tempDirs.push(dir);
    mkdirSync(resolve(dir, "artifacts"), { recursive: true });
    writeFileSync(resolve(dir, "artifacts/FinalDeliveryReport.md"), "npm test: PASS\nFinal EvalReport: PASS\n", "utf8");

    const grade = gradeTaskSuccess(sampleRun({
      variant: "treatment",
      status: "PASS",
      fixture_repo: dir,
      acceptance_criteria: ["Criterion phrased in a way the grader does not understand"],
      artifacts: ["artifacts/FinalDeliveryReport.md"],
      final_report_path: "artifacts/FinalDeliveryReport.md",
      final_eval_verdict: "PASS",
      validation_passed: true
    }));

    expect(grade.status).toBe("FAIL");
    expect(grade.summary).toContain("GRADER_EVIDENCE_MAPPING_ERROR");
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
