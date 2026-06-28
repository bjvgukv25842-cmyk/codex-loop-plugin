import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { compareM12Results } from "../../scripts/effectiveness/compare-m12-results.ts";
import { reportM12Mini } from "../../scripts/effectiveness/report-m12-mini.ts";
import { evaluateM12ReleaseGate } from "../../scripts/effectiveness/m12-release-gate.ts";
import { writeJson } from "../../scripts/effectiveness/io.ts";
import type { M12RunResult } from "../../scripts/effectiveness/types.ts";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("M12 validation regrade evidence precedence", () => {
  it("uses treatment command evidence and ignores stale validation mappings across compare/report/gate", () => {
    withTempRegrade(() => {
      writeInputs();

      const compare = compareM12Results();
      const report = reportM12Mini();
      const gate = evaluateM12ReleaseGate();

      expect(compare.status).toBe("PASS");
      expect(report.status).toBe("PASS");
      expect(gate.status).toBe("PASS");
      expect(compare.production_ready).toBe(false);
      expect(gate.production_ready).toBe(false);
      expect(compare.validation_command_results_used).toEqual([
        expect.objectContaining({ command: "npm test", status: "PASS", passed: true }),
        expect.objectContaining({ command: "npm run coverage:contract", status: "PASS", passed: true })
      ]);
      expect(gate.validation_command_results_used).toEqual([
        expect.objectContaining({ command: "npm test", status: "PASS", passed: true }),
        expect.objectContaining({ command: "npm run coverage:contract", status: "PASS", passed: true })
      ]);
      expect(readFileSync("evals/effectiveness/reports/M12_Mini_Report.md", "utf8")).toContain("## Validation Evidence Used");
      expect(readFileSync("evals/effectiveness/reports/m12-mini-run.json", "utf8")).toContain('"dry_run": true');
    });
  });
});

function withTempRegrade(fn: () => void): void {
  const tempDir = mkdtempSync(resolve(tmpdir(), "m12-validation-regrade-"));
  tempDirs.push(tempDir);
  const cwd = process.cwd();
  const argv = process.argv;
  process.chdir(tempDir);
  process.argv = ["node", "m12", "--case", "test-coverage-002", "--regrade-only"];
  try {
    fn();
  } finally {
    process.argv = argv;
    process.chdir(cwd);
  }
}

function writeInputs(): void {
  writeFile("evals/effectiveness/datasets/m12-mini.jsonl", readFileSync(resolve("/Users/litmus/Downloads/codex-loop-plugin/evals/effectiveness/datasets/m12-mini.jsonl"), "utf8"));
  const fixtureRepo = resolve(process.cwd(), "evals/effectiveness/runs/test-coverage-002/treatment/target-repo");
  writeFile(resolve(fixtureRepo, "artifacts/dev-result.json"), "{}\n");
  writeFile(resolve(fixtureRepo, "artifacts/eval-report.json"), JSON.stringify({ verdict: "PASS" }));
  writeFile(resolve(fixtureRepo, "artifacts/FinalDeliveryReport.md"), "Final report\n");
  writeFile(resolve(fixtureRepo, "test/cache.test.js"), "updateUser(); getUser(); missing user returns null;\n");
  const validationLog = resolve(process.cwd(), "evals/effectiveness/reports/test-coverage-002/treatment-validation.log");
  writeFile(validationLog, [
    "$ npm test",
    "✔ returns a cached user on repeated reads",
    "✔ returns null on a cache miss and records the storage lookup",
    "✔ returns the updated user instead of stale cached data",
    "ℹ tests 3",
    "ℹ pass 3",
    "ℹ fail 0",
    "$ npm run coverage:contract",
    "Coverage contract passed.",
    ""
  ].join("\n"));
  writeFile("evals/effectiveness/reports/test-coverage-002/old-timeout-triage.log", "$ npm test\nnot ok 1\n");
  writeJson("evals/effectiveness/reports/m12-mini-run.json", { dry_run: true, real_m12_run_executed: false });
  writeJson("evals/effectiveness/reports/test-coverage-002/baseline-result.json", baselineResult("test-coverage-002"));
  writeJson("evals/effectiveness/reports/test-coverage-002/treatment-result.json", treatmentResult("test-coverage-002", fixtureRepo, validationLog));
}

function baselineResult(caseId: string): M12RunResult {
  return {
    case_id: caseId,
    variant: "baseline",
    mode: "baseline",
    runtime: "codex-exec",
    status: "PASS",
    real_run_executed: true,
    prompt: "",
    fixture_repo: "",
    acceptance_criteria: ["npm test passes."],
    validation_commands: ["npm test", "npm run coverage:contract"],
    expected_artifacts: [],
    baseline_expected_artifacts: [],
    forbidden_files: [".env"],
    changed_files: ["test/cache.test.js"],
    artifacts: [],
    validation_logs: [],
    validation_passed: true,
    secret_leak_detected: false,
    danger_full_access_used: false,
    duration_ms: 1,
    thread_count: 1,
    command_count: 1,
    thread_id: "baseline-thread",
    errors: []
  };
}

function treatmentResult(caseId: string, fixtureRepo: string, validationLog: string): M12RunResult {
  return {
    ...baselineResult(caseId),
    variant: "treatment",
    mode: "treatment",
    runtime: "sdk-orchestrated",
    prompt: "$codex-loop",
    fixture_repo: fixtureRepo,
    acceptance_criteria: [
      "Tests cover stale cache after update.",
      "Tests cover cache miss path.",
      "No unrelated cache API changes.",
      "npm test passes.",
      "npm run coverage:contract passes."
    ],
    treatment_expected_artifacts: ["docs/PRD.md", "docs/TASK_GRAPH.json", "artifacts/dev-result.json", "artifacts/eval-report.json", "artifacts/FinalDeliveryReport.md"],
    artifacts: ["docs/PRD.md", "docs/TASK_GRAPH.json", "artifacts/dev-result.json", "artifacts/eval-report.json", "artifacts/FinalDeliveryReport.md"],
    validation_logs: [validationLog, "evals/effectiveness/reports/test-coverage-002/old-timeout-triage.log"],
    validation_log_paths: [validationLog],
    validation_command_results: [
      { command: "npm test", status: "FAIL", passed: false, log_path: validationLog, evidence: "failure marker detected" },
      { command: "npm run coverage:contract", status: "PASS", passed: true, log_path: validationLog }
    ],
    coverage_contract_passed: true,
    changed_files: ["test/cache.test.js"],
    evaluator_verdict: "PASS",
    initial_eval_verdict: "PASS",
    final_eval_verdict: "PASS",
    planner_thread_id: "planner",
    dev_worker_thread_id: "dev",
    initial_evaluator_thread_id: "eval",
    repair_request_created: false,
    repair_dev_worker_thread_id: "",
    final_evaluator_thread_id: "eval",
    final_report_path: "artifacts/FinalDeliveryReport.md",
    artifact_thread_evidence_verified: true
  };
}

function writeFile(path: string, value: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value, "utf8");
}
