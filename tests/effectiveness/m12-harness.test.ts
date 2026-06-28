import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { gradeArtifactCompleteness } from "../../evals/effectiveness/graders/artifact-completeness-grader.ts";
import { gradeDiffScope } from "../../evals/effectiveness/graders/diff-scope-grader.ts";
import { gradeSecurity } from "../../evals/effectiveness/graders/security-grader.ts";
import { gradeTaskSuccess } from "../../evals/effectiveness/graders/task-success-grader.ts";
import { gradeValidationPass } from "../../evals/effectiveness/graders/validation-pass-grader.ts";
import { buildBaselineCodexExecCommand, runBaselineCodexExecCanary } from "../../src/effectiveness/baseline-codex-exec-runner.ts";
import { m12CasePaths } from "../../src/effectiveness/effectiveness-fixtures.ts";
import { runTreatmentSdkOrchestratedCanary, treatmentStagePlan } from "../../src/effectiveness/treatment-sdk-orchestrated-runner.ts";
import { loadM12Dataset } from "../../scripts/effectiveness/dataset.ts";
import { evaluateM12ReleaseGate } from "../../scripts/effectiveness/m12-release-gate.ts";
import { parseM12CliArgs, selectM12Cases } from "../../scripts/effectiveness/m12-cli-args.ts";
import { compareM12Results } from "../../scripts/effectiveness/compare-m12-results.ts";
import { buildEvidenceFreshnessCheck } from "../../scripts/effectiveness/evidence-freshness.ts";
import { runBaselineCase } from "../../scripts/effectiveness/run-baseline-case.ts";
import { reportM12Mini } from "../../scripts/effectiveness/report-m12-mini.ts";
import { runM12Mini } from "../../scripts/effectiveness/run-m12-mini.ts";
import { runTreatmentCase } from "../../scripts/effectiveness/run-treatment-case.ts";
import { writeJson } from "../../scripts/effectiveness/io.ts";
import type { M12ComparisonReport, M12RunResult } from "../../scripts/effectiveness/types.ts";

const tempDirs: string[] = [];
const FAKE_OPENAI_KEY_ENV = "OPENAI_API_KEY";
const FAKE_OPENAI_KEY = "sk-" + "abcdefghijklmnopqrstuvwxyz123456";

afterEach(() => {
  vi.unstubAllEnvs();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("M12 effectiveness harness", () => {
  it("loads a schema-valid 10-case M12-mini dataset", () => {
    const cases = loadM12Dataset();

    expect(cases.map((testCase) => testCase.case_id)).toEqual([
      "feature-small-001",
      "feature-small-002",
      "bugfix-small-001",
      "bugfix-small-002",
      "test-coverage-001",
      "test-coverage-002",
      "docs-update-001",
      "refactor-small-001",
      "repair-loop-001",
      "adversarial-prompt-injection-001"
    ]);
    expect(cases.every((testCase) => testCase.acceptance_criteria.length > 0)).toBe(true);
    expect(cases.every((testCase) => testCase.graders.length > 0)).toBe(true);
  });

  it("baseline runner defaults to dry-run without real Codex", async () => {
    vi.stubEnv("CODEX_LOOP_ENABLE_M12_REAL_RUN", "");
    const result = await runBaselineCase(loadM12Dataset()[0]!);

    expect(result.status).toBe("DRY_RUN");
    expect(result.real_run_executed).toBe(false);
  });

  it("baseline runner supports feature-small-001 dry-run", async () => {
    vi.stubEnv("CODEX_LOOP_ENABLE_M12_REAL_RUN", "");
    const testCase = loadM12Dataset().find((entry) => entry.case_id === "feature-small-001")!;
    const result = await runBaselineCase(testCase);

    expect(result.status).toBe("DRY_RUN");
    expect(result.case_id).toBe("feature-small-001");
    expect(result.real_run_executed).toBe(false);
    expect(result.baseline_expected_artifacts).toEqual([]);
  });

  it("baseline runner supports bugfix-small-001 dry-run", async () => {
    vi.stubEnv("CODEX_LOOP_ENABLE_M12_REAL_RUN", "");
    const testCase = loadM12Dataset().find((entry) => entry.case_id === "bugfix-small-001")!;
    const result = await runBaselineCase(testCase);

    expect(result.status).toBe("DRY_RUN");
    expect(result.case_id).toBe("bugfix-small-001");
    expect(result.real_run_executed).toBe(false);
    expect(result.baseline_expected_artifacts).toEqual([]);
  });

  it("treatment runner defaults to dry-run without real SDK", async () => {
    vi.stubEnv("CODEX_LOOP_ENABLE_M12_REAL_RUN", "");
    const result = await runTreatmentCase(loadM12Dataset()[0]!);

    expect(result.status).toBe("DRY_RUN");
    expect(result.real_run_executed).toBe(false);
    expect(result.prompt).toContain("$codex-loop");
  });

  it("treatment runner supports feature-small-001 dry-run", async () => {
    vi.stubEnv("CODEX_LOOP_ENABLE_M12_REAL_RUN", "");
    const testCase = loadM12Dataset().find((entry) => entry.case_id === "feature-small-001")!;
    const result = await runTreatmentCase(testCase);

    expect(result.status).toBe("DRY_RUN");
    expect(result.case_id).toBe("feature-small-001");
    expect(result.real_run_executed).toBe(false);
    expect(result.treatment_expected_artifacts).toEqual([
      "docs/PRD.md",
      "docs/TASK_GRAPH.json",
      "artifacts/dev-result.json",
      "artifacts/eval-report.json",
      "artifacts/FinalDeliveryReport.md"
    ]);
  });

  it("baseline and treatment runners support feature-small-002 dry-run without real execution", async () => {
    vi.stubEnv("CODEX_LOOP_ENABLE_M12_REAL_RUN", "");
    const testCase = loadM12Dataset().find((entry) => entry.case_id === "feature-small-002")!;

    const baseline = await runBaselineCase(testCase);
    const treatment = await runTreatmentCase(testCase);

    expect(baseline).toMatchObject({
      case_id: "feature-small-002",
      mode: "baseline",
      runtime: "codex-exec",
      status: "DRY_RUN",
      real_run_executed: false,
      validation_commands: ["npm test"],
      danger_full_access_used: false
    });
    expect(treatment).toMatchObject({
      case_id: "feature-small-002",
      mode: "treatment",
      runtime: "sdk-orchestrated",
      status: "DRY_RUN",
      real_run_executed: false,
      validation_commands: ["npm test"],
      danger_full_access_used: false
    });
    expect(treatment.treatment_expected_artifacts).toEqual([
      "docs/PRD.md",
      "docs/TASK_GRAPH.json",
      "artifacts/dev-result.json",
      "artifacts/eval-report.json",
      "artifacts/FinalDeliveryReport.md",
      "artifacts/repair-request.json",
      "artifacts/repair-result.json",
      "artifacts/final-eval-report.json"
    ]);
  });

  it("treatment runner supports bugfix-small-001 dry-run", async () => {
    vi.stubEnv("CODEX_LOOP_ENABLE_M12_REAL_RUN", "");
    const testCase = loadM12Dataset().find((entry) => entry.case_id === "bugfix-small-001")!;
    const result = await runTreatmentCase(testCase);

    expect(result.status).toBe("DRY_RUN");
    expect(result.case_id).toBe("bugfix-small-001");
    expect(result.real_run_executed).toBe(false);
    expect(result.treatment_expected_artifacts).toEqual([
      "docs/PRD.md",
      "docs/TASK_GRAPH.json",
      "artifacts/dev-result.json",
      "artifacts/eval-report.json",
      "artifacts/FinalDeliveryReport.md"
    ]);
  });

  it("baseline and treatment runners support adversarial-prompt-injection-001 dry-run without real execution", async () => {
    vi.stubEnv("CODEX_LOOP_ENABLE_M12_REAL_RUN", "");
    const testCase = loadM12Dataset().find((entry) => entry.case_id === "adversarial-prompt-injection-001")!;

    const baseline = await runBaselineCase(testCase);
    const treatment = await runTreatmentCase(testCase);

    expect(baseline).toMatchObject({
      case_id: "adversarial-prompt-injection-001",
      mode: "baseline",
      runtime: "codex-exec",
      status: "DRY_RUN",
      real_run_executed: false,
      validation_commands: ["npm test", "npm run security:contract"],
      seeded_fake_secret_leaked: false,
      real_secret_leak_detected: false
    });
    expect(treatment).toMatchObject({
      case_id: "adversarial-prompt-injection-001",
      mode: "treatment",
      runtime: "sdk-orchestrated",
      status: "DRY_RUN",
      real_run_executed: false,
      validation_commands: ["npm test", "npm run security:contract"],
      seeded_fake_secret_leaked: false,
      real_secret_leak_detected: false,
      danger_full_access_used: false
    });
    expect(treatment.treatment_expected_artifacts).toContain("artifacts/security-scan-report.json");
  });

  it("task-success grader checks acceptance evidence", () => {
    const result = sampleRun({
      acceptance_criteria: ["Reject empty names"],
      validation_logs: ["PASS: reject empty names"]
    });

    expect(gradeTaskSuccess(result).status).toBe("PASS");
  });

  it("validation-pass grader detects failing command logs", () => {
    const result = sampleRun({
      validation_commands: ["npm test"],
      validation_logs: ["npm test\nnot ok 1"]
    });

    expect(gradeValidationPass(result).status).toBe("FAIL");
  });

  it("diff-scope grader detects forbidden files", () => {
    const result = sampleRun({
      forbidden_files: [".env"],
      changed_files: [".env"]
    });

    const grade = gradeDiffScope(result);
    expect(grade.status).toBe("FAIL");
    expect(grade.p0).toBe(true);
  });

  it("artifact-completeness grader detects missing artifacts", () => {
    const result = sampleRun({
      expected_artifacts: ["artifacts/FinalDeliveryReport.md"],
      artifacts: []
    });

    expect(gradeArtifactCompleteness(result).status).toBe("FAIL");
  });

  it("security grader detects secret leaks", () => {
    const result = sampleRun({
      validation_logs: [`${FAKE_OPENAI_KEY_ENV}=${FAKE_OPENAI_KEY}`]
    });

    const grade = gradeSecurity(result);
    expect(grade.status).toBe("BLOCKED");
    expect(grade.p0).toBe(true);
  });

  it("M12 release gate blocks P0 issues", () => {
    const tempDir = mkdtempSync(resolve(tmpdir(), "m12-gate-test-"));
    tempDirs.push(tempDir);
    const cwd = process.cwd();
    process.chdir(tempDir);
    try {
      mkdirSync("evals/effectiveness/reports", { recursive: true });
      writeJson("evals/effectiveness/reports/m12-mini-compare.json", {
        status: "BLOCKED",
        baseline_cases: 1,
        treatment_cases: 1,
        p0_blockers: ["treatment/adversarial: security: secret leak"],
        severe_issues: [],
        production_ready: false,
        ready_for_m12_mini_real_run: false
      } satisfies M12ComparisonReport);

      expect(evaluateM12ReleaseGate().status).toBe("BLOCKED");
    } finally {
      process.chdir(cwd);
    }
  });

  it("does not execute real run without CODEX_LOOP_ENABLE_M12_REAL_RUN=1", async () => {
    vi.stubEnv("CODEX_LOOP_ENABLE_M12_REAL_RUN", "0");
    const baseline = await runBaselineCase(loadM12Dataset()[0]!);
    const treatment = await runTreatmentCase(loadM12Dataset()[0]!);

    expect(baseline.real_run_executed).toBe(false);
    expect(treatment.real_run_executed).toBe(false);
  });

  it("--case repair-loop-001 selects one case", () => {
    const selection = selectM12Cases(loadM12Dataset(), parseM12CliArgs(["--case", "repair-loop-001"]));

    expect(selection.status).toBe("PASS");
    expect(selection.cases.map((testCase) => testCase.case_id)).toEqual(["repair-loop-001"]);
  });

  it("--mode baseline and treatment select variants", () => {
    expect(selectM12Cases(loadM12Dataset(), parseM12CliArgs(["--case", "repair-loop-001", "--mode", "baseline"])).modes).toEqual(["baseline"]);
    expect(selectM12Cases(loadM12Dataset(), parseM12CliArgs(["--case", "repair-loop-001", "--mode", "treatment"])).modes).toEqual(["treatment"]);
    expect(selectM12Cases(loadM12Dataset(), parseM12CliArgs(["--case", "repair-loop-001", "--mode", "both"])).modes).toEqual(["baseline", "treatment"]);
  });

  it("parses --fresh separately from --resume", () => {
    expect(parseM12CliArgs(["--case", "repair-loop-001", "--mode", "treatment", "--fresh"])).toMatchObject({
      case_id: "repair-loop-001",
      mode: "treatment",
      fresh: true,
      resume: false
    });
    expect(parseM12CliArgs(["--case=repair-loop-001", "--resume"])).toMatchObject({
      case_id: "repair-loop-001",
      fresh: false,
      resume: true
    });
  });

  it("blocks real M12 without a case selector or max-cases", () => {
    const selection = selectM12Cases(loadM12Dataset(), parseM12CliArgs([]), { CODEX_LOOP_ENABLE_M12_REAL_RUN: "1" });

    expect(selection.status).toBe("BLOCKED");
    expect(selection.block_code).toBe("BLOCKED_M12_REQUIRES_CASE_SELECTOR");
  });

  it("blocks unknown selected M12 case", () => {
    const selection = selectM12Cases(loadM12Dataset(), parseM12CliArgs(["--case", "missing-case"]));

    expect(selection.status).toBe("BLOCKED");
    expect(selection.block_code).toBe("BLOCKED_M12_CASE_NOT_FOUND");
  });

  it("runM12Mini honors --case and --mode baseline", async () => {
    const originalArgv = process.argv;
    process.argv = ["node", "run-m12-mini", "--case", "repair-loop-001", "--mode", "baseline"];
    vi.stubEnv("CODEX_LOOP_ENABLE_M12_REAL_RUN", "");
    try {
      const result = await runM12Mini();
      expect(result.case_count).toBe(1);
      expect(result.baseline_results).toBe(1);
      expect(result.treatment_results).toBe(0);
    } finally {
      process.argv = originalArgv;
    }
  });

  it("runM12Mini full dry-run writes placeholders for all treatment cases", async () => {
    const tempDir = mkdtempSync(resolve(tmpdir(), "m12-full-dry-run-"));
    tempDirs.push(tempDir);
    const cwd = process.cwd();
    const originalArgv = process.argv;
    process.chdir(tempDir);
    process.argv = ["node", "run-m12-mini"];
    vi.stubEnv("CODEX_LOOP_ENABLE_M12_REAL_RUN", "");
    try {
      writeDatasetCopy();

      const result = await runM12Mini();

      expect(result.status).toBe("PASS");
      expect(result.case_count).toBe(10);
      expect(result.baseline_results).toBe(10);
      expect(result.treatment_results).toBe(10);
      expect(result.real_m12_run_executed).toBe(false);
      expect(result.errors).toEqual([]);

      const futureUnsupportedTreatment = JSON.parse(readFileSync("evals/effectiveness/reports/refactor-small-001/treatment-result.json", "utf8")) as M12RunResult;
      expect(futureUnsupportedTreatment.status).toBe("DRY_RUN");
      expect(futureUnsupportedTreatment.real_run_executed).toBe(false);
    } finally {
      process.argv = originalArgv;
      process.chdir(cwd);
    }
  });

  it("bugfix-small-002 treatment dry-run support replaces the previous unsupported future-case block", async () => {
    const testCase = loadM12Dataset().find((entry) => entry.case_id === "bugfix-small-002")!;

    const result = await runTreatmentCase(testCase, { env: { CODEX_LOOP_ENABLE_M12_REAL_RUN: "" } });

    expect(result.status).toBe("DRY_RUN");
    expect(result.real_run_executed).toBe(false);
    expect(result.runtime).toBe("sdk-orchestrated");
  });

  it("runM12Mini treatment dry-run does not overwrite existing baseline real result", async () => {
    const tempDir = mkdtempSync(resolve(tmpdir(), "m12-dry-run-preserve-baseline-"));
    tempDirs.push(tempDir);
    const cwd = process.cwd();
    const originalArgv = process.argv;
    const testCase = loadM12Dataset().find((entry) => entry.case_id === "repair-loop-001")!;
    process.chdir(tempDir);
    process.argv = ["node", "run-m12-mini", "--case", "repair-loop-001", "--mode", "treatment"];
    vi.stubEnv("CODEX_LOOP_ENABLE_M12_REAL_RUN", "");
    try {
      writeDatasetCopy();
      mkdirSync("evals/effectiveness/reports/repair-loop-001", { recursive: true });
      writeJson("evals/effectiveness/reports/repair-loop-001/baseline-result.json", validBaselineResult(testCase));

      const result = await runM12Mini();
      const baseline = JSON.parse(readFileSync("evals/effectiveness/reports/repair-loop-001/baseline-result.json", "utf8")) as M12RunResult;

      expect(result.treatment_results).toBe(1);
      expect(baseline.real_run_executed).toBe(true);
      expect(baseline.thread_id).toBe("thread_baseline");
    } finally {
      process.argv = originalArgv;
      process.chdir(cwd);
    }
  });

  it("runM12Mini treatment dry-run does not overwrite existing treatment partial result", async () => {
    const tempDir = mkdtempSync(resolve(tmpdir(), "m12-dry-run-preserve-treatment-"));
    tempDirs.push(tempDir);
    const cwd = process.cwd();
    const originalArgv = process.argv;
    const testCase = loadM12Dataset().find((entry) => entry.case_id === "repair-loop-001")!;
    process.chdir(tempDir);
    process.argv = ["node", "run-m12-mini", "--case", "repair-loop-001", "--mode", "treatment"];
    vi.stubEnv("CODEX_LOOP_ENABLE_M12_REAL_RUN", "");
    try {
      writeDatasetCopy();
      mkdirSync("evals/effectiveness/reports/repair-loop-001", { recursive: true });
      writeJson("evals/effectiveness/reports/repair-loop-001/treatment-result.json", {
        ...createTreatmentDryRun(testCase),
        status: "BLOCKED",
        real_run_executed: true,
        planner_thread_id: "thread_planner_partial",
        failure_category: "PLANNER_V2_TASKS_EMPTY"
      });

      const result = await runM12Mini();
      const treatment = JSON.parse(readFileSync("evals/effectiveness/reports/repair-loop-001/treatment-result.json", "utf8")) as M12RunResult;

      expect(result.treatment_results).toBe(1);
      expect(treatment.status).toBe("BLOCKED");
      expect(treatment.planner_thread_id).toBe("thread_planner_partial");
    } finally {
      process.argv = originalArgv;
      process.chdir(cwd);
    }
  });

  it("runM12Mini treatment dry-run replaces stale non-real blocked placeholders", async () => {
    const tempDir = mkdtempSync(resolve(tmpdir(), "m12-dry-run-replace-stale-blocked-"));
    tempDirs.push(tempDir);
    const cwd = process.cwd();
    const originalArgv = process.argv;
    const testCase = loadM12Dataset().find((entry) => entry.case_id === "refactor-small-001")!;
    process.chdir(tempDir);
    process.argv = ["node", "run-m12-mini", "--case", "refactor-small-001", "--mode", "treatment"];
    vi.stubEnv("CODEX_LOOP_ENABLE_M12_REAL_RUN", "");
    try {
      writeDatasetCopy();
      mkdirSync("evals/effectiveness/reports/refactor-small-001", { recursive: true });
      writeJson("evals/effectiveness/reports/refactor-small-001/treatment-result.json", {
        ...createTreatmentDryRun(testCase),
        status: "BLOCKED",
        real_run_executed: false,
        failure_category: "BLOCKED_TREATMENT_CASE_NOT_IMPLEMENTED",
        errors: ["stale dry-run placeholder from an older router"]
      });

      const result = await runM12Mini();
      const treatment = JSON.parse(readFileSync("evals/effectiveness/reports/refactor-small-001/treatment-result.json", "utf8")) as M12RunResult;

      expect(result.status).toBe("PASS");
      expect(treatment.status).toBe("DRY_RUN");
      expect(treatment.real_run_executed).toBe(false);
      expect(treatment.errors).toEqual([]);
    } finally {
      process.argv = originalArgv;
      process.chdir(cwd);
    }
  });

  it("baseline real runner builds codex exec command without danger-full-access", () => {
    const testCase = loadM12Dataset().find((entry) => entry.case_id === "repair-loop-001")!;
    const paths = m12CasePaths(testCase, "baseline", process.cwd());
    const command = buildBaselineCodexExecCommand(paths, testCase, resolve(process.cwd(), ".codex-eval/sqlite"), {});

    expect(command.command).toBe("codex");
    expect(command.args).toContain("exec");
    expect(command.args).toContain("--json");
    expect(command.args).toContain("workspace-write");
    expect(command.args.join(" ")).not.toMatch(/danger-full-access/);
  });

  it("baseline real runner writes expected result paths with mocked exec", async () => {
    const tempDir = mkdtempSync(resolve(tmpdir(), "m12-baseline-runner-"));
    tempDirs.push(tempDir);
    const testCase = loadM12Dataset().find((entry) => entry.case_id === "repair-loop-001")!;
    const result = await runBaselineCodexExecCanary({
      testCase,
      repoRoot: tempDir,
      env: { CODEX_LOOP_ENABLE_M12_REAL_RUN: "1" },
      executor: async (command) => {
        expect(command.args.join(" ")).not.toMatch(/danger-full-access/);
        return {
          exit_code: 0,
          signal: null,
          stdout: "{\"type\":\"thread.started\",\"thread_id\":\"thread_baseline_mock\"}\n{\"type\":\"command_execution\",\"command\":\"npm test\"}\n",
          stderr: "",
          duration_ms: 1,
          process_started: true,
          killed_by_timeout: false,
          killed_by_no_event_timeout: false,
          timeout_ms: command.timeout_ms,
          no_event_timeout_ms: command.no_event_timeout_ms
        };
      }
    });

    expect(result.thread_id).toBe("thread_baseline_mock");
    expect(result.events_path).toContain("repair-loop-001/baseline-events.jsonl");
    expect(existsSync(resolve(tempDir, "evals/effectiveness/reports/repair-loop-001/baseline-events.jsonl"))).toBe(true);
  });

  it("treatment real runner plans Gate 6B.2 checkpoint stages", () => {
    expect(treatmentStagePlan().map((entry) => entry.stage)).toEqual([
      "prepare",
      "planner",
      "initial_dev_worker",
      "initial_evaluator",
      "repair_request",
      "repair_dev_worker",
      "final_evaluator",
      "final_report",
      "verify"
    ]);
  });

  it("treatment real runner can PASS with mocked checkpoint runtime", () => {
    const tempDir = mkdtempSync(resolve(tmpdir(), "m12-treatment-runner-"));
    tempDirs.push(tempDir);
    const testCase = loadM12Dataset().find((entry) => entry.case_id === "repair-loop-001")!;
    const result = runTreatmentSdkOrchestratedCanary({
      testCase,
      repoRoot: tempDir,
      env: { CODEX_LOOP_ENABLE_M12_REAL_RUN: "1" },
      stageExecutor: (command) => {
        if (command.stage === "verify") {
          const statePath = command.env.CODEX_LOOP_GATE6B2_STATE_PATH!;
          mkdirSync(resolve(statePath, ".."), { recursive: true });
          writeJson(statePath, mockGate6B2State());
        }
        return { stage: command.stage, exit_code: 0, stdout: "{}", stderr: "" };
      }
    });

    expect(result.status).toBe("PASS");
    expect(result.final_eval_verdict).toBe("PASS");
    expect(result.final_report_path).toBe("artifacts/FinalDeliveryReport.md");
    expect(result.thread_count).toBe(5);
  });

  it("compare only reports selected case and marks dry-run inconclusive", () => {
    const tempDir = mkdtempSync(resolve(tmpdir(), "m12-compare-"));
    tempDirs.push(tempDir);
    const cwd = process.cwd();
    const originalArgv = process.argv;
    const testCase = loadM12Dataset().find((entry) => entry.case_id === "repair-loop-001")!;
    process.chdir(tempDir);
    process.argv = ["node", "compare", "--case", "repair-loop-001"];
    try {
      mkdirSync("evals/effectiveness/datasets", { recursive: true });
      writeDatasetCopy();
      writeJson("evals/effectiveness/reports/repair-loop-001/baseline-result.json", createBaselineDryRun(testCase));
      writeJson("evals/effectiveness/reports/repair-loop-001/treatment-result.json", createTreatmentDryRun(testCase));
      const report = compareM12Results();
      expect(report.status).toBe("INCONCLUSIVE_DRY_RUN_RESULT");
      expect(report.baseline_cases).toBe(1);
      expect(report.treatment_cases).toBe(1);
    } finally {
      process.argv = originalArgv;
      process.chdir(cwd);
    }
  });

  it("M12 gate blocks dry-run placeholders for selected canary", () => {
    const tempDir = mkdtempSync(resolve(tmpdir(), "m12-gate-dry-"));
    tempDirs.push(tempDir);
    const cwd = process.cwd();
    const originalArgv = process.argv;
    const testCase = loadM12Dataset().find((entry) => entry.case_id === "repair-loop-001")!;
    process.chdir(tempDir);
    process.argv = ["node", "gate", "--case", "repair-loop-001"];
    try {
      mkdirSync("evals/effectiveness/reports/repair-loop-001", { recursive: true });
      writeJson("evals/effectiveness/reports/m12-mini-compare.json", {
        status: "INCONCLUSIVE_DRY_RUN_RESULT",
        baseline_cases: 1,
        treatment_cases: 1,
        p0_blockers: [],
        severe_issues: [],
        production_ready: false,
        ready_for_m12_mini_real_run: true
      } satisfies M12ComparisonReport);
      writeJson("evals/effectiveness/reports/repair-loop-001/baseline-result.json", createBaselineDryRun(testCase));
      writeJson("evals/effectiveness/reports/repair-loop-001/treatment-result.json", createTreatmentDryRun(testCase));

      expect(evaluateM12ReleaseGate().status).toBe("BLOCKED");
    } finally {
      process.argv = originalArgv;
      process.chdir(cwd);
    }
  });

  it("M12 gate allows feature-small-001 regrade-only dry-run readiness", () => {
    const tempDir = mkdtempSync(resolve(tmpdir(), "m12-gate-feature-readiness-"));
    tempDirs.push(tempDir);
    const cwd = process.cwd();
    const originalArgv = process.argv;
    const testCase = loadM12Dataset().find((entry) => entry.case_id === "feature-small-001")!;
    process.chdir(tempDir);
    process.argv = ["node", "gate", "--case", "feature-small-001", "--regrade-only"];
    try {
      writeDatasetCopy();
      mkdirSync("evals/effectiveness/fixtures/feature-small-001/src", { recursive: true });
      mkdirSync("evals/effectiveness/fixtures/feature-small-001/test", { recursive: true });
      writeFileSync("evals/effectiveness/fixtures/feature-small-001/package.json", "{\"scripts\":{\"test\":\"node --test\"}}\n", "utf8");
      writeFileSync("evals/effectiveness/fixtures/feature-small-001/src/project-name.js", "export function validateProjectName(name) { return { ok: true }; }\n", "utf8");
      writeFileSync("evals/effectiveness/fixtures/feature-small-001/test/project-name.test.js", "import test from 'node:test';\ntest('placeholder', () => {});\n", "utf8");
      mkdirSync("evals/effectiveness/reports/feature-small-001", { recursive: true });
      writeJson("evals/effectiveness/reports/m12-mini-compare.json", {
        status: "INCONCLUSIVE_DRY_RUN_RESULT",
        baseline_cases: 1,
        treatment_cases: 1,
        p0_blockers: [],
        severe_issues: [],
        production_ready: false,
        ready_for_m12_mini_real_run: true,
        regrade_only: true
      } satisfies M12ComparisonReport);
      writeJson("evals/effectiveness/reports/feature-small-001/baseline-result.json", createBaselineDryRun(testCase));
      writeJson("evals/effectiveness/reports/feature-small-001/treatment-result.json", createTreatmentDryRun(testCase));

      const gate = evaluateM12ReleaseGate();
      expect(gate.status).toBe("PASS");
      expect(gate.production_ready).toBe(false);
      expect(JSON.parse(readFileSync("evals/effectiveness/reports/feature-small-001/next-case-readiness.json", "utf8")).status).toBe("READY");
    } finally {
      process.argv = originalArgv;
      process.chdir(cwd);
    }
  });

  it("M12 gate allows bugfix-small-001 regrade-only dry-run readiness", () => {
    const tempDir = mkdtempSync(resolve(tmpdir(), "m12-gate-bugfix-readiness-"));
    tempDirs.push(tempDir);
    const cwd = process.cwd();
    const originalArgv = process.argv;
    const testCase = loadM12Dataset().find((entry) => entry.case_id === "bugfix-small-001")!;
    process.chdir(tempDir);
    process.argv = ["node", "gate", "--case", "bugfix-small-001", "--regrade-only"];
    try {
      writeDatasetCopy();
      mkdirSync("evals/effectiveness/fixtures/bugfix-small-001/src", { recursive: true });
      mkdirSync("evals/effectiveness/fixtures/bugfix-small-001/test", { recursive: true });
      writeFileSync("evals/effectiveness/fixtures/bugfix-small-001/package.json", "{\"scripts\":{\"test\":\"node --test\"}}\n", "utf8");
      writeFileSync("evals/effectiveness/fixtures/bugfix-small-001/src/pagination.js", "export function hasNextPage(currentPage, totalPages) { return currentPage <= totalPages; }\n", "utf8");
      writeFileSync(
        "evals/effectiveness/fixtures/bugfix-small-001/test/pagination.test.js",
        "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { hasNextPage } from '../src/pagination.js';\ntest('final page has no next page', () => { assert.equal(hasNextPage(3, 3), false); });\n",
        "utf8"
      );
      mkdirSync("evals/effectiveness/reports/bugfix-small-001", { recursive: true });
      writeJson("evals/effectiveness/reports/m12-mini-compare.json", {
        status: "INCONCLUSIVE_DRY_RUN_RESULT",
        baseline_cases: 1,
        treatment_cases: 1,
        p0_blockers: [],
        severe_issues: [],
        production_ready: false,
        ready_for_m12_mini_real_run: true,
        regrade_only: true
      } satisfies M12ComparisonReport);
      writeJson("evals/effectiveness/reports/bugfix-small-001/baseline-result.json", createBaselineDryRun(testCase));
      writeJson("evals/effectiveness/reports/bugfix-small-001/treatment-result.json", createTreatmentDryRun(testCase));

      const gate = evaluateM12ReleaseGate();
      expect(gate.status).toBe("PASS");
      expect(gate.production_ready).toBe(false);
      expect(JSON.parse(readFileSync("evals/effectiveness/reports/bugfix-small-001/next-case-readiness.json", "utf8")).status).toBe("READY");
    } finally {
      process.argv = originalArgv;
      process.chdir(cwd);
    }
  });

  it("M12 gate blocks treatment missing FinalReport and thread ids", () => {
    const tempDir = mkdtempSync(resolve(tmpdir(), "m12-gate-treatment-"));
    tempDirs.push(tempDir);
    const cwd = process.cwd();
    const originalArgv = process.argv;
    const testCase = loadM12Dataset().find((entry) => entry.case_id === "repair-loop-001")!;
    process.chdir(tempDir);
    process.argv = ["node", "gate", "--case", "repair-loop-001"];
    try {
      mkdirSync("evals/effectiveness/reports/repair-loop-001", { recursive: true });
      writeJson("evals/effectiveness/reports/m12-mini-compare.json", {
        status: "PASS",
        baseline_cases: 1,
        treatment_cases: 1,
        p0_blockers: [],
        severe_issues: [],
        production_ready: false,
        ready_for_m12_mini_real_run: true
      } satisfies M12ComparisonReport);
      writeJson("evals/effectiveness/reports/repair-loop-001/baseline-result.json", {
        ...createBaselineDryRun(testCase),
        status: "PASS",
        real_run_executed: true,
        thread_id: "thread_baseline"
      });
      writeJson("evals/effectiveness/reports/repair-loop-001/treatment-result.json", {
        ...createTreatmentDryRun(testCase),
        status: "PASS",
        real_run_executed: true,
        final_eval_verdict: "PASS",
        validation_passed: true
      });

      const gate = evaluateM12ReleaseGate();
      expect(gate.status).toBe("BLOCKED");
      expect(gate.p0_blockers.join("\n")).toMatch(/thread ids missing|FinalReport missing/);
    } finally {
      process.argv = originalArgv;
      process.chdir(cwd);
    }
  });

  it("M12 gate reports partial treatment stage failure before downstream missing artifacts", () => {
    const tempDir = mkdtempSync(resolve(tmpdir(), "m12-gate-treatment-partial-"));
    tempDirs.push(tempDir);
    const cwd = process.cwd();
    const originalArgv = process.argv;
    const testCase = loadM12Dataset().find((entry) => entry.case_id === "repair-loop-001")!;
    process.chdir(tempDir);
    process.argv = ["node", "gate", "--case", "repair-loop-001", "--regrade-only"];
    try {
      mkdirSync("evals/effectiveness/reports/repair-loop-001", { recursive: true });
      writeJson("evals/effectiveness/reports/m12-mini-compare.json", {
        status: "NEEDS_REVISION",
        baseline_cases: 1,
        treatment_cases: 1,
        p0_blockers: [],
        severe_issues: ["treatment/repair-loop-001: initial_dev_worker failed with M12_TREATMENT_INITIAL_DEV_THREAD_MISSING"],
        production_ready: false,
        ready_for_m12_mini_real_run: true,
        regrade_only: true
      } satisfies M12ComparisonReport);
      writeJson("evals/effectiveness/reports/repair-loop-001/baseline-result.json", validBaselineResult(testCase));
      writeJson("evals/effectiveness/reports/repair-loop-001/treatment-result.json", {
        ...createTreatmentDryRun(testCase),
        status: "BLOCKED",
        real_run_executed: true,
        planner_thread_id: "thread_planner",
        failure_category: "M12_TREATMENT_INITIAL_DEV_THREAD_MISSING",
        validation_passed: false
      });

      const gate = evaluateM12ReleaseGate();
      expect(gate.status).toBe("BLOCKED");
      expect(gate.p0_blockers.join("\n")).toContain("partial treatment failed with M12_TREATMENT_INITIAL_DEV_THREAD_MISSING");
      expect(gate.p0_blockers.join("\n")).toContain("partial thread ids present");
    } finally {
      process.argv = originalArgv;
      process.chdir(cwd);
    }
  });

  it("compare and gate report planner-specific treatment failure with partial planner evidence", () => {
    const tempDir = mkdtempSync(resolve(tmpdir(), "m12-planner-partial-"));
    tempDirs.push(tempDir);
    const cwd = process.cwd();
    const originalArgv = process.argv;
    const testCase = loadM12Dataset().find((entry) => entry.case_id === "repair-loop-001")!;
    process.chdir(tempDir);
    process.argv = ["node", "compare", "--case", "repair-loop-001", "--regrade-only"];
    try {
      writeDatasetCopy();
      mkdirSync("evals/effectiveness/reports/repair-loop-001", { recursive: true });
      writeJson("evals/effectiveness/reports/repair-loop-001/baseline-result.json", validBaselineResult(testCase));
      writeJson("evals/effectiveness/reports/repair-loop-001/treatment-result.json", {
        ...createTreatmentDryRun(testCase),
        status: "BLOCKED",
        real_run_executed: true,
        planner_thread_id: "thread_planner_partial",
        planner_stage_attempted: true,
        planner_stage_completed: false,
        planner_output_contract_version: "v2",
        planner_raw_output_path: "reports/planner-stdout.log",
        planner_redacted_output_path: "reports/planner-stdout-redacted.log",
        planner_events_path: "reports/planner-events.jsonl",
        failure_category: "PLANNER_V2_TASKS_EMPTY"
      });

      const compare = compareM12Results();
      expect(compare.status).toBe("NEEDS_REVISION");
      expect(compare.severe_issues.join("\n")).toContain("planner failed with PLANNER_V2_TASKS_EMPTY");

      process.argv = ["node", "gate", "--case", "repair-loop-001", "--regrade-only"];
      const gate = evaluateM12ReleaseGate();
      expect(gate.status).toBe("BLOCKED");
      expect(gate.p0_blockers.join("\n")).toContain("planner postprocess blocker PLANNER_V2_TASKS_EMPTY using v2");
      expect(gate.p0_blockers.join("\n")).not.toContain("treatment thread ids missing");
    } finally {
      process.argv = originalArgv;
      process.chdir(cwd);
    }
  });

  it("compare and gate report feature planner no-event timeout without generic missing-thread noise", () => {
    const tempDir = mkdtempSync(resolve(tmpdir(), "m12-feature-planner-timeout-gate-"));
    tempDirs.push(tempDir);
    const cwd = process.cwd();
    const originalArgv = process.argv;
    const testCase = loadM12Dataset().find((entry) => entry.case_id === "feature-small-001")!;
    process.chdir(tempDir);
    process.argv = ["node", "compare", "--case", "feature-small-001", "--regrade-only"];
    try {
      writeDatasetCopy();
      mkdirSync("evals/effectiveness/reports/feature-small-001", { recursive: true });
      writeJson("evals/effectiveness/reports/feature-small-001/baseline-result.json", validBaselineResult(testCase));
      writeJson("evals/effectiveness/reports/feature-small-001/treatment-generic-feature-state.json", {
        case_id: "feature-small-001",
        current_stage: "FAILED",
        planner: {
          status: "TIMEOUT",
          thread_id: "thread_feature_planner_partial",
          prd_path: "",
          task_graph_path: "",
          stage_attempted: true,
          stage_completed: false,
          output_contract_version: "v2",
          failure_category: "FEATURE_TREATMENT_PLANNER_TURN_NO_EVENT_TIMEOUT"
        },
        dev_worker: {
          status: "",
          thread_id: "",
          file_change_verified: false,
          tests_passed: false,
          dev_result_path: ""
        },
        evaluator: {
          status: "",
          thread_id: "",
          eval_verdict: "",
          eval_report_path: ""
        },
        repair_request: {},
        repair_dev_worker: {},
        final_evaluator: {},
        final_report: {},
        errors: ["Planner no-event timeout."]
      });
      writeJson("evals/effectiveness/reports/feature-small-001/treatment-result.json", {
        ...createTreatmentDryRun(testCase),
        status: "BLOCKED",
        real_run_executed: true,
        planner_thread_id: "thread_feature_planner_partial",
        planner_stage_attempted: true,
        planner_stage_completed: false,
        planner_output_contract_version: "v2",
        planner_events_path: "reports/generic-planner-events.jsonl",
        planner_stdout_path: "reports/generic-planner-stdout.log",
        planner_stderr_path: "reports/generic-planner-stderr.log",
        checkpoint_state_path: "evals/effectiveness/reports/feature-small-001/treatment-generic-feature-state.json",
        failure_category: "FEATURE_TREATMENT_PLANNER_TURN_NO_EVENT_TIMEOUT"
      });

      const compare = compareM12Results();
      expect(compare.status).toBe("NEEDS_REVISION");
      expect(compare.severe_issues.join("\n")).toContain("planner failed with FEATURE_TREATMENT_PLANNER_TURN_NO_EVENT_TIMEOUT");

      process.argv = ["node", "gate", "--case", "feature-small-001", "--regrade-only"];
      const gate = evaluateM12ReleaseGate();
      const blockers = gate.p0_blockers.join("\n");
      expect(gate.status).toBe("BLOCKED");
      expect(blockers).toContain("planner stage blocker FEATURE_TREATMENT_PLANNER_TURN_NO_EVENT_TIMEOUT using v2");
      expect(blockers).not.toContain("treatment thread ids missing");
      expect(blockers).not.toContain("treatment FinalReport missing");
    } finally {
      process.argv = originalArgv;
      process.chdir(cwd);
    }
  });

  it("compare and gate correct stale feature planner timeout when later stage threads exist", () => {
    const tempDir = mkdtempSync(resolve(tmpdir(), "m12-feature-stale-stage-gate-"));
    tempDirs.push(tempDir);
    const cwd = process.cwd();
    const originalArgv = process.argv;
    const testCase = loadM12Dataset().find((entry) => entry.case_id === "feature-small-001")!;
    process.chdir(tempDir);
    process.argv = ["node", "compare", "--case", "feature-small-001", "--regrade-only"];
    try {
      writeDatasetCopy();
      mkdirSync("evals/effectiveness/reports/feature-small-001", { recursive: true });
      writeJson("evals/effectiveness/reports/feature-small-001/baseline-result.json", validBaselineResult(testCase));
      writeJson("evals/effectiveness/reports/feature-small-001/treatment-generic-feature-state.json", {
        case_id: "feature-small-001",
        current_stage: "FAILED",
        planner: {
          status: "PASS",
          thread_id: "thread_feature_planner",
          prd_path: "docs/PRD.md",
          task_graph_path: "docs/TASK_GRAPH.json",
          stage_attempted: true,
          stage_completed: true,
          output_contract_version: "v2"
        },
        dev_worker: {
          status: "PASS",
          thread_id: "thread_feature_dev_worker",
          file_change_verified: true,
          tests_passed: true,
          dev_result_path: "artifacts/dev-result.json"
        },
        evaluator: {
          status: "TIMEOUT",
          thread_id: "thread_feature_evaluator",
          eval_verdict: "",
          eval_report_path: "artifacts/eval-report.json"
        },
        repair_request: {},
        repair_dev_worker: {},
        final_evaluator: {},
        final_report: {},
        errors: ["SDK thread exceeded timeout_ms=180000."]
      });
      writeJson("evals/effectiveness/reports/feature-small-001/treatment-result.json", {
        ...createTreatmentDryRun(testCase),
        status: "BLOCKED",
        real_run_executed: true,
        planner_thread_id: "thread_feature_planner",
        planner_stage_attempted: true,
        planner_stage_completed: true,
        planner_output_contract_version: "v2",
        dev_worker_thread_id: "thread_feature_dev_worker",
        initial_evaluator_thread_id: "thread_feature_evaluator",
        changed_files: ["src/project-name.js"],
        artifacts: ["docs/PRD.md", "docs/TASK_GRAPH.json", "artifacts/dev-result.json"],
        checkpoint_state_path: "evals/effectiveness/reports/feature-small-001/treatment-generic-feature-state.json",
        failure_category: "FEATURE_TREATMENT_PLANNER_TURN_NO_EVENT_TIMEOUT"
      });

      const compare = compareM12Results();
      const severe = compare.severe_issues.join("\n");
      expect(compare.status).toBe("NEEDS_REVISION");
      expect(severe).toContain("evaluator failed with FEATURE_TREATMENT_EVALUATOR_TURN_NO_EVENT_TIMEOUT");
      expect(severe).toContain("stale failure category FEATURE_TREATMENT_PLANNER_TURN_NO_EVENT_TIMEOUT corrected to FEATURE_TREATMENT_EVALUATOR_TURN_NO_EVENT_TIMEOUT");
      expect(severe).not.toContain("planner failed with FEATURE_TREATMENT_PLANNER_TURN_NO_EVENT_TIMEOUT");

      process.argv = ["node", "gate", "--case", "feature-small-001", "--regrade-only"];
      const gate = evaluateM12ReleaseGate();
      const blockers = gate.p0_blockers.join("\n");
      expect(gate.status).toBe("BLOCKED");
      expect(blockers).toContain("evaluator stage blocker FEATURE_TREATMENT_EVALUATOR_TURN_NO_EVENT_TIMEOUT using v2");
      expect(blockers).not.toContain("planner postprocess blocker FEATURE_TREATMENT_PLANNER_TURN_NO_EVENT_TIMEOUT");
      expect(blockers).not.toContain("treatment FinalReport missing");
    } finally {
      process.argv = originalArgv;
      process.chdir(cwd);
    }
  });

  it("compare --regrade-only reads existing results without running real runners", () => {
    const tempDir = mkdtempSync(resolve(tmpdir(), "m12-regrade-compare-"));
    tempDirs.push(tempDir);
    const cwd = process.cwd();
    const originalArgv = process.argv;
    const testCase = loadM12Dataset().find((entry) => entry.case_id === "repair-loop-001")!;
    process.chdir(tempDir);
    process.argv = ["node", "compare", "--case", "repair-loop-001", "--regrade-only"];
    try {
      writeDatasetCopy();
      mkdirSync("evals/effectiveness/reports/repair-loop-001", { recursive: true });
      writeJson("evals/effectiveness/reports/repair-loop-001/baseline-result.json", validBaselineResult(testCase));
      writeJson("evals/effectiveness/reports/repair-loop-001/treatment-result.json", validTreatmentResult(testCase));

      const report = compareM12Results();
      expect(report.regrade_only).toBe(true);
      expect(report.p0_blockers).toEqual([]);
    } finally {
      process.argv = originalArgv;
      process.chdir(cwd);
    }
  });

  it("gate --regrade-only blocks baseline secret leak flags", () => {
    const tempDir = mkdtempSync(resolve(tmpdir(), "m12-regrade-gate-false-positive-"));
    tempDirs.push(tempDir);
    const cwd = process.cwd();
    const originalArgv = process.argv;
    const testCase = loadM12Dataset().find((entry) => entry.case_id === "repair-loop-001")!;
    process.chdir(tempDir);
    process.argv = ["node", "gate", "--case", "repair-loop-001", "--regrade-only"];
    try {
      mkdirSync("evals/effectiveness/reports/repair-loop-001", { recursive: true });
      writeJson("evals/effectiveness/reports/m12-mini-compare.json", {
        status: "PASS",
        baseline_cases: 1,
        treatment_cases: 1,
        p0_blockers: [],
        severe_issues: [],
        production_ready: false,
        ready_for_m12_mini_real_run: true,
        regrade_only: true
      } satisfies M12ComparisonReport);
      writeJson("evals/effectiveness/reports/repair-loop-001/baseline-result.json", {
        ...validBaselineResult(testCase),
        secret_leak_detected: true,
        validation_logs: ["secret_leak_detected=false\ntoken_count=1"]
      });
      writeJson("evals/effectiveness/reports/repair-loop-001/treatment-result.json", validTreatmentResult(testCase));

      const gate = evaluateM12ReleaseGate();
      expect(gate.status).toBe("BLOCKED");
      expect(gate.p0_blockers).toContain("secret leak detected in M12 canary result");
    } finally {
      process.argv = originalArgv;
      process.chdir(cwd);
    }
  });

  it("compare/report/gate treat baseline TIMEOUT as a valid baseline outcome with triage", () => {
    const tempDir = mkdtempSync(resolve(tmpdir(), "m12-baseline-timeout-outcome-"));
    tempDirs.push(tempDir);
    const cwd = process.cwd();
    const originalArgv = process.argv;
    const testCase = loadM12Dataset().find((entry) => entry.case_id === "bugfix-small-001")!;
    process.chdir(tempDir);
    process.argv = ["node", "compare", "--case", "bugfix-small-001", "--regrade-only"];
    try {
      writeDatasetCopy();
      mkdirSync("evals/effectiveness/reports/bugfix-small-001", { recursive: true });
      writeJson("evals/effectiveness/reports/bugfix-small-001/baseline-result.json", baselineTimeoutResult(testCase));
      writeJson("evals/effectiveness/reports/bugfix-small-001/baseline-codex-exec-timeout-triage.json", {
        case_id: "bugfix-small-001",
        failure_category: "BASELINE_CODEX_EXEC_TIMEOUT",
        process_started: true,
        process_exit_code: null,
        killed_by_timeout: true,
        thread_started: false,
        thread_id: "",
        event_count: 0,
        last_event_type: "",
        stdout_bytes: 0,
        stderr_bytes: 0,
        duration_ms: 180001,
        timeout_ms: 180000,
        no_event_timeout_ms: 60000,
        invocation_trace_path: "evals/effectiveness/reports/bugfix-small-001/baseline-invocation-trace-redacted.json",
        events_path: "evals/effectiveness/reports/bugfix-small-001/baseline-events.jsonl",
        stdout_path: "evals/effectiveness/reports/bugfix-small-001/baseline-stdout.log",
        stderr_path: "evals/effectiveness/reports/bugfix-small-001/baseline-stderr.log",
        recommended_fixes: []
      });
      writeJson("evals/effectiveness/reports/bugfix-small-001/treatment-result.json", validTreatmentResult(testCase));

      const compare = compareM12Results();
      expect(compare.status).toBe("NEEDS_REVISION");
      expect(compare.p0_blockers).toEqual([]);
      expect(compare.severe_issues.join("\n")).toContain("baseline/bugfix-small-001: baseline real outcome TIMEOUT with BASELINE_CODEX_EXEC_TIMEOUT");

      process.argv = ["node", "report", "--case", "bugfix-small-001", "--regrade-only"];
      const report = reportM12Mini();
      expect(report.status).toBe("NEEDS_REVISION");
      const markdown = readFileSync("evals/effectiveness/reports/M12_Mini_Report.md", "utf8");
      expect(markdown).toContain("## Baseline Timeout Triage");
      expect(markdown).toContain("failure_category: BASELINE_CODEX_EXEC_TIMEOUT");

      process.argv = ["node", "gate", "--case", "bugfix-small-001", "--regrade-only"];
      const gate = evaluateM12ReleaseGate();
      expect(gate.status).toBe("PASS");
      expect(gate.p0_blockers.join("\n")).not.toContain("baseline/bugfix-small-001");
    } finally {
      process.argv = originalArgv;
      process.chdir(cwd);
    }
  });

  it("docs-update-001 accepts baseline TIMEOUT as valid failure when treatment passes safely", () => {
    const tempDir = mkdtempSync(resolve(tmpdir(), "m12-docs-timeout-policy-"));
    tempDirs.push(tempDir);
    const cwd = process.cwd();
    const originalArgv = process.argv;
    const testCase = loadM12Dataset().find((entry) => entry.case_id === "docs-update-001")!;
    process.chdir(tempDir);
    process.argv = ["node", "compare", "--case", "docs-update-001", "--regrade-only"];
    try {
      writeDatasetCopy();
      writeDocsUpdate001TimeoutBaselineAndPassTreatment(testCase);

      const compare = compareM12Results();
      expect(compare.status).toBe("PASS");
      expect(compare.p0_blockers).toEqual([]);
      expect(compare.severe_issues).toEqual([]);
      expect(compare.production_ready).toBe(false);
      expect(compare.baseline_outcome).toBe("TIMEOUT");
      expect(compare.treatment_outcome).toBe("PASS");
      expect(compare.baseline_score).toBe(0);
      expect(compare.treatment_score).toBe(1);
      expect(compare.winner).toBe("treatment");

      const baselineGrades = JSON.parse(readFileSync("evals/effectiveness/reports/m12-mini-baseline-grades.json", "utf8")) as Array<{ grader_results: Array<{ grader: string; status: string; score: number }> }>;
      expect(baselineGrades[0]!.grader_results.find((entry) => entry.grader === "task-success")).toMatchObject({
        status: "FAIL",
        score: 0
      });

      process.argv = ["node", "report", "--case", "docs-update-001", "--regrade-only"];
      const report = reportM12Mini();
      expect(report.status).toBe("PASS");
      const markdown = readFileSync("evals/effectiveness/reports/M12_Mini_Report.md", "utf8");
      expect(markdown).toContain("Status: PASS");
      expect(markdown).toContain("winner: treatment");
      expect(markdown).toContain("baseline_outcome: TIMEOUT");
      expect(markdown).toContain("baseline_score: 0");

      process.argv = ["node", "gate", "--case", "docs-update-001", "--regrade-only"];
      const gate = evaluateM12ReleaseGate();
      expect(gate.status).toBe("PASS");
      expect(gate.production_ready).toBe(false);
      expect(gate.p0_blockers).toEqual([]);
    } finally {
      process.argv = originalArgv;
      process.chdir(cwd);
    }
  });

  it("gate --regrade-only keeps confirmed secret leaks blocked", () => {
    const tempDir = mkdtempSync(resolve(tmpdir(), "m12-regrade-gate-secret-"));
    tempDirs.push(tempDir);
    const cwd = process.cwd();
    const originalArgv = process.argv;
    const testCase = loadM12Dataset().find((entry) => entry.case_id === "repair-loop-001")!;
    process.chdir(tempDir);
    process.argv = ["node", "gate", "--case", "repair-loop-001", "--regrade-only"];
    try {
      mkdirSync("evals/effectiveness/reports/repair-loop-001", { recursive: true });
      writeJson("evals/effectiveness/reports/m12-mini-compare.json", {
        status: "BLOCKED",
        baseline_cases: 1,
        treatment_cases: 1,
        p0_blockers: ["baseline/repair-loop-001: security: P0 safety issue detected."],
        severe_issues: ["baseline/repair-loop-001: security: P0 safety issue detected."],
        production_ready: false,
        ready_for_m12_mini_real_run: true,
        regrade_only: true
      } satisfies M12ComparisonReport);
      writeJson("evals/effectiveness/reports/repair-loop-001/baseline-result.json", validBaselineResult(testCase));
      writeJson("evals/effectiveness/reports/repair-loop-001/treatment-result.json", validTreatmentResult(testCase));

      expect(evaluateM12ReleaseGate().status).toBe("BLOCKED");
    } finally {
      process.argv = originalArgv;
      process.chdir(cwd);
    }
  });

  it("feature-small-001 regrade uses latest PASS treatment result and ignores stale triage", () => {
    const tempDir = mkdtempSync(resolve(tmpdir(), "m12-feature-regrade-fresh-"));
    tempDirs.push(tempDir);
    const cwd = process.cwd();
    const originalArgv = process.argv;
    const testCase = loadM12Dataset().find((entry) => entry.case_id === "feature-small-001")!;
    process.chdir(tempDir);
    process.argv = ["node", "compare", "--case", "feature-small-001", "--regrade-only"];
    try {
      writeDatasetCopy();
      writeFeatureSmall001PassEvidence(testCase);
      writeJson("evals/effectiveness/reports/m12-mini-compare.json", {
        status: "NEEDS_REVISION",
        baseline_cases: 1,
        treatment_cases: 1,
        p0_blockers: [],
        severe_issues: ["stale cache should be ignored"],
        production_ready: false,
        ready_for_m12_mini_real_run: true,
        regrade_only: true
      } satisfies M12ComparisonReport);

      const compare = compareM12Results();
      expect(compare.status).toBe("PASS");
      expect(compare.severe_issues).toEqual([]);
      expect(compare.evidence_source_paths).toContain("evals/effectiveness/reports/feature-small-001/treatment-result.json");
      expect(compare.stale_files_ignored?.join("\n")).toContain("feature-canary-triage.json");

      const treatmentGrades = JSON.parse(readFileSync("evals/effectiveness/reports/m12-mini-treatment-grades.json", "utf8")) as Array<{ grader_results: Array<{ grader: string; status: string }> }>;
      expect(treatmentGrades[0]!.grader_results.find((entry) => entry.grader === "task-success")?.status).toBe("PASS");
    } finally {
      process.argv = originalArgv;
      process.chdir(cwd);
    }
  });

  it("report --regrade-only recomputes compare and writes freshness evidence", () => {
    const tempDir = mkdtempSync(resolve(tmpdir(), "m12-feature-report-fresh-"));
    tempDirs.push(tempDir);
    const cwd = process.cwd();
    const originalArgv = process.argv;
    const testCase = loadM12Dataset().find((entry) => entry.case_id === "feature-small-001")!;
    process.chdir(tempDir);
    process.argv = ["node", "report", "--case", "feature-small-001", "--regrade-only"];
    try {
      writeDatasetCopy();
      writeFeatureSmall001PassEvidence(testCase);
      writeJson("evals/effectiveness/reports/m12-mini-compare.json", {
        status: "NEEDS_REVISION",
        baseline_cases: 1,
        treatment_cases: 1,
        p0_blockers: [],
        severe_issues: ["stale report cache should be ignored"],
        production_ready: false,
        ready_for_m12_mini_real_run: true,
        regrade_only: true
      } satisfies M12ComparisonReport);

      const report = reportM12Mini();
      expect(report.status).toBe("PASS");
      expect(readFileSync("evals/effectiveness/reports/M12_Mini_Report.md", "utf8")).toContain("Status: PASS");
      expect(JSON.parse(readFileSync("evals/effectiveness/reports/feature-small-001/evidence-freshness-check.json", "utf8")).report_used_latest_treatment_result).toBe(true);
    } finally {
      process.argv = originalArgv;
      process.chdir(cwd);
    }
  });

  it("gate diagnoses compare/gate validation inconsistency and keeps production_ready false", () => {
    const tempDir = mkdtempSync(resolve(tmpdir(), "m12-feature-gate-inconsistency-"));
    tempDirs.push(tempDir);
    const cwd = process.cwd();
    const originalArgv = process.argv;
    const testCase = loadM12Dataset().find((entry) => entry.case_id === "feature-small-001")!;
    process.chdir(tempDir);
    process.argv = ["node", "gate", "--case", "feature-small-001", "--regrade-only"];
    try {
      writeDatasetCopy();
      writeFeatureSmall001PassEvidence(testCase);
      writeJson("evals/effectiveness/reports/m12-mini-compare.json", {
        status: "NEEDS_REVISION",
        baseline_cases: 1,
        treatment_cases: 1,
        p0_blockers: [],
        severe_issues: ["treatment/feature-small-001: task-success: Missing acceptance evidence for 1 criteria."],
        production_ready: false,
        ready_for_m12_mini_real_run: true,
        regrade_only: true
      } satisfies M12ComparisonReport);

      const gate = evaluateM12ReleaseGate();
      expect(gate.status).toBe("PASS");
      expect(gate.production_ready).toBe(false);
      expect(gate.inconsistency_diagnosis?.join("\n")).toContain("COMPARE_GATE_VALIDATION_INCONSISTENCY");
      expect(gate.evidence_source_paths).toContain("evals/effectiveness/reports/feature-small-001/treatment-result.json");
    } finally {
      process.argv = originalArgv;
      process.chdir(cwd);
    }
  });

  it("evidence freshness report lists stale files", () => {
    const tempDir = mkdtempSync(resolve(tmpdir(), "m12-feature-freshness-"));
    tempDirs.push(tempDir);
    const cwd = process.cwd();
    const testCase = loadM12Dataset().find((entry) => entry.case_id === "feature-small-001")!;
    process.chdir(tempDir);
    try {
      writeDatasetCopy();
      writeFeatureSmall001PassEvidence(testCase);
      const freshness = buildEvidenceFreshnessCheck("feature-small-001", { compare_used_latest_treatment_result: true });
      expect(freshness.stale_triage_files_detected.join("\n")).toContain("feature-canary-triage.json");
      expect(freshness.final_report_exists).toBe(true);
    } finally {
      process.chdir(cwd);
    }
  });
});

function sampleRun(overrides: Partial<M12RunResult> = {}): M12RunResult {
  return {
    case_id: "case",
    variant: "treatment",
    status: "DRY_RUN",
    real_run_executed: false,
    prompt: "",
    fixture_repo: "",
    acceptance_criteria: [],
    validation_commands: [],
    expected_artifacts: [],
    forbidden_files: [],
    changed_files: [],
    artifacts: [],
    validation_logs: [],
    evaluator_verdict: "",
    repair_attempted: false,
    repaired: false,
    p0_safety_issue: false,
    secret_leak_detected: false,
    dangerous_command_detected: false,
    prompt_injection_followed: false,
    duration_ms: 0,
    thread_count: 0,
    command_count: 0,
    errors: [],
    ...overrides
  };
}

function writeDatasetCopy(): void {
  const dataset = readFileSync(resolve("/Users/litmus/Downloads/codex-loop-plugin/evals/effectiveness/datasets/m12-mini.jsonl"), "utf8");
  mkdirSync("evals/effectiveness/datasets", { recursive: true });
  writeFileSync("evals/effectiveness/datasets/m12-mini.jsonl", dataset, "utf8");
}

function createBaselineDryRun(testCase: ReturnType<typeof loadM12Dataset>[number]): M12RunResult {
  return {
    ...sampleRun(),
    case_id: testCase.case_id,
    variant: "baseline",
    mode: "baseline",
    status: "DRY_RUN",
    real_run_executed: false
  };
}

function createTreatmentDryRun(testCase: ReturnType<typeof loadM12Dataset>[number]): M12RunResult {
  return {
    ...sampleRun(),
    case_id: testCase.case_id,
    variant: "treatment",
    mode: "treatment",
    status: "DRY_RUN",
    real_run_executed: false
  };
}

function validBaselineResult(testCase: ReturnType<typeof loadM12Dataset>[number]): M12RunResult {
  const acceptanceEvidence = testCase.acceptance_criteria.join(" ");
  return {
    ...sampleRun(),
    case_id: testCase.case_id,
    variant: "baseline",
    mode: "baseline",
    status: "PASS",
    real_run_executed: true,
    thread_id: "thread_baseline",
    validation_passed: true,
    acceptance_criteria: testCase.acceptance_criteria,
    validation_commands: testCase.validation_commands,
    baseline_expected_artifacts: [],
    artifacts: [],
    validation_logs: [`npm test PASS ${acceptanceEvidence}`]
  };
}

function baselineTimeoutResult(testCase: ReturnType<typeof loadM12Dataset>[number]): M12RunResult {
  return {
    ...sampleRun(),
    case_id: testCase.case_id,
    variant: "baseline",
    mode: "baseline",
    status: "TIMEOUT",
    real_run_executed: true,
    runtime: "codex-exec",
    thread_id: "",
    validation_passed: false,
    acceptance_criteria: testCase.acceptance_criteria,
    validation_commands: testCase.validation_commands,
    baseline_expected_artifacts: [],
    artifacts: [],
    validation_logs: ["NOT_RUN: baseline codex exec timed out before validation."],
    events_path: "evals/effectiveness/reports/bugfix-small-001/baseline-events.jsonl",
    stdout_path: "evals/effectiveness/reports/bugfix-small-001/baseline-stdout.log",
    stderr_path: "evals/effectiveness/reports/bugfix-small-001/baseline-stderr.log",
    diff_path: "evals/effectiveness/reports/bugfix-small-001/baseline-diff.patch",
    invocation_trace_path: "evals/effectiveness/reports/bugfix-small-001/baseline-invocation-trace-redacted.json",
    duration_ms: 180001,
    timeout_ms: 180000,
    no_event_timeout_ms: 60000,
    failure_category: "BASELINE_CODEX_EXEC_TIMEOUT",
    errors: ["Baseline codex exec exceeded timeout."]
  };
}

function validTreatmentResult(testCase: ReturnType<typeof loadM12Dataset>[number]): M12RunResult {
  const acceptanceEvidence = testCase.acceptance_criteria.join(" ");
  return {
    ...sampleRun(),
    case_id: testCase.case_id,
    variant: "treatment",
    mode: "treatment",
    status: "PASS",
    real_run_executed: true,
    planner_thread_id: "thread_planner",
    dev_worker_thread_id: "thread_dev_worker",
    initial_evaluator_thread_id: "thread_initial_evaluator",
    repair_dev_worker_thread_id: "thread_repair_dev_worker",
    final_evaluator_thread_id: "thread_final_evaluator",
    final_eval_verdict: "PASS",
    validation_passed: true,
    final_report_path: "artifacts/FinalDeliveryReport.md",
    acceptance_criteria: testCase.acceptance_criteria,
    validation_commands: testCase.validation_commands,
    treatment_expected_artifacts: testCase.treatment_expected_artifacts ?? testCase.expected_artifacts,
    artifacts: testCase.treatment_expected_artifacts ?? testCase.expected_artifacts,
    validation_logs: [`npm test PASS ${acceptanceEvidence}`]
  };
}

function writeDocsUpdate001TimeoutBaselineAndPassTreatment(testCase: ReturnType<typeof loadM12Dataset>[number]): void {
  mkdirSync("evals/effectiveness/reports/docs-update-001", { recursive: true });
  mkdirSync("evals/effectiveness/runs/docs-update-001/treatment/target-repo/docs", { recursive: true });
  mkdirSync("evals/effectiveness/runs/docs-update-001/treatment/target-repo/artifacts", { recursive: true });
  writeJson("evals/effectiveness/reports/docs-update-001/baseline-result.json", {
    ...baselineTimeoutResult(testCase),
    case_id: "docs-update-001",
    events_path: "evals/effectiveness/reports/docs-update-001/baseline-events.jsonl",
    stdout_path: "evals/effectiveness/reports/docs-update-001/baseline-stdout.log",
    stderr_path: "evals/effectiveness/reports/docs-update-001/baseline-stderr.log",
    diff_path: "evals/effectiveness/reports/docs-update-001/baseline-diff.patch",
    invocation_trace_path: "evals/effectiveness/reports/docs-update-001/baseline-invocation-trace-redacted.json"
  });
  writeJson("evals/effectiveness/reports/docs-update-001/baseline-codex-exec-timeout-triage.json", {
    case_id: "docs-update-001",
    failure_category: "BASELINE_CODEX_EXEC_TIMEOUT",
    process_started: true,
    killed_by_timeout: true,
    thread_started: true,
    thread_id: "thread_baseline_timeout",
    event_count: 2,
    duration_ms: 180001,
    timeout_ms: 180000,
    no_event_timeout_ms: 60000,
    invocation_trace_path: "evals/effectiveness/reports/docs-update-001/baseline-invocation-trace-redacted.json",
    events_path: "evals/effectiveness/reports/docs-update-001/baseline-events.jsonl",
    stdout_path: "evals/effectiveness/reports/docs-update-001/baseline-stdout.log",
    stderr_path: "evals/effectiveness/reports/docs-update-001/baseline-stderr.log"
  });
  writeFileSync("evals/effectiveness/runs/docs-update-001/treatment/target-repo/README.md", [
    "# Duration Parser",
    "",
    "## Installation",
    "npm install",
    "",
    "## Usage",
    "parseDuration(\"30s\");",
    "parseDuration(\"5m\");",
    "parseDuration(\"2h\");",
    "",
    "## API Reference",
    "parseDuration(input) parses s, m, and h units.",
    "",
    "## Testing",
    "Run npm test and npm run docs:contract."
  ].join("\n"), "utf8");
  writeFileSync("evals/effectiveness/runs/docs-update-001/treatment/target-repo/docs/API.md", [
    "# API",
    "",
    "parseDuration(input) supports units s, m, h.",
    "Invalid input returns null."
  ].join("\n"), "utf8");
  writeFileSync("evals/effectiveness/runs/docs-update-001/treatment/target-repo/artifacts/FinalDeliveryReport.md", [
    "Final EvalReport: PASS",
    "README.md contains Installation, Usage, API Reference, and Testing sections.",
    "README.md includes parseDuration(\"30s\"), parseDuration(\"5m\"), and parseDuration(\"2h\") examples.",
    "docs/API.md describes supported units: s, m, h.",
    "docs/API.md describes invalid input returns null.",
    "npm test: PASS",
    "npm run docs:contract: PASS",
    "No src/duration.js changes."
  ].join("\n"), "utf8");
  writeFileSync("evals/effectiveness/runs/docs-update-001/treatment/target-repo/artifacts/eval-report.json", "{\"verdict\":\"PASS\"}\n", "utf8");
  writeFileSync("evals/effectiveness/runs/docs-update-001/treatment/target-repo/artifacts/dev-result.json", "{\"status\":\"PASS\"}\n", "utf8");
  writeFileSync("evals/effectiveness/runs/docs-update-001/treatment/target-repo/docs/PRD.md", "Document parseDuration(input).\n", "utf8");
  writeFileSync("evals/effectiveness/runs/docs-update-001/treatment/target-repo/docs/TASK_GRAPH.json", "{\"tasks\":[]}\n", "utf8");
  writeFileSync("evals/effectiveness/reports/docs-update-001/treatment-validation.log", "npm test\nPASS\nnpm run docs:contract\nDocs contract satisfied.\n", "utf8");
  writeFileSync("evals/effectiveness/reports/docs-update-001/treatment-diff.patch", "+++ b/README.md\n+++ b/docs/API.md\n", "utf8");
  writeJson("evals/effectiveness/reports/docs-update-001/treatment-result.json", {
    ...validTreatmentResult(testCase),
    case_id: "docs-update-001",
    repair_request_created: false,
    repair_dev_worker_thread_id: "",
    changed_files: ["README.md", "docs/API.md"],
    artifacts: [
      "docs/PRD.md",
      "docs/TASK_GRAPH.json",
      "artifacts/dev-result.json",
      "artifacts/eval-report.json",
      "artifacts/FinalDeliveryReport.md"
    ],
    validation_logs: ["evals/effectiveness/reports/docs-update-001/treatment-validation.log"],
    final_report_path: "artifacts/FinalDeliveryReport.md",
    secret_leak_detected: false,
    danger_full_access_used: false
  });
}

function writeFeatureSmall001PassEvidence(testCase: ReturnType<typeof loadM12Dataset>[number]): void {
  mkdirSync("evals/effectiveness/reports/feature-small-001", { recursive: true });
  mkdirSync("evals/effectiveness/runs/feature-small-001/treatment/target-repo/src", { recursive: true });
  mkdirSync("evals/effectiveness/runs/feature-small-001/treatment/target-repo/test", { recursive: true });
  mkdirSync("evals/effectiveness/runs/feature-small-001/treatment/target-repo/artifacts", { recursive: true });
  writeFileSync("evals/effectiveness/runs/feature-small-001/treatment/target-repo/src/project-name.js", "if (name.trim().length === 0) return { ok: false };\nif (name.length > 80) return { ok: false };\nreturn { ok: true };\n", "utf8");
  writeFileSync("evals/effectiveness/runs/feature-small-001/treatment/target-repo/test/project-name.test.js", "validateProjectName(\"\").ok === false\nvalidateProjectName(\"   \").ok === false\nvalidateProjectName(\"x\".repeat(81)).ok === false\nvalidateProjectName(\"My Project\").ok === true\n", "utf8");
  writeFileSync("evals/effectiveness/runs/feature-small-001/treatment/target-repo/artifacts/FinalDeliveryReport.md", "Final EvalReport: PASS\nnpm test: PASS\nReject empty project names. Reject whitespace-only project names. Reject names longer than 80 characters. Accept normal project names.\n", "utf8");
  writeFileSync("evals/effectiveness/runs/feature-small-001/treatment/target-repo/artifacts/final-eval-report.json", "{\"verdict\":\"PASS\"}\n", "utf8");
  writeFileSync("evals/effectiveness/reports/feature-small-001/treatment-validation.log", "npm test\nPASS rejects names longer than 80 characters\n", "utf8");
  writeFileSync("evals/effectiveness/reports/feature-small-001/treatment-diff.patch", "+  if (name.length > 80) return { ok: false };\n", "utf8");
  writeFileSync("evals/effectiveness/reports/feature-small-001/feature-canary-triage.json", "{\"status\":\"BLOCKED\",\"failure_category\":\"FEATURE_TREATMENT_PLANNER_NO_EVENT_TIMEOUT\"}\n", "utf8");
  writeFileSync("evals/effectiveness/reports/feature-small-001/FeatureCanaryTriageReport.md", "old blocked planner timeout\n", "utf8");
  writeJson("evals/effectiveness/reports/feature-small-001/baseline-result.json", validBaselineResult(testCase));
  writeJson("evals/effectiveness/reports/feature-small-001/treatment-result.json", {
    ...sampleRun(),
    case_id: testCase.case_id,
    variant: "treatment",
    mode: "treatment",
    runtime: "sdk-orchestrated",
    status: "PASS",
    real_run_executed: true,
    prompt: "$codex-loop",
    fixture_repo: resolve("evals/effectiveness/runs/feature-small-001/treatment/target-repo"),
    acceptance_criteria: testCase.acceptance_criteria,
    validation_commands: testCase.validation_commands,
    expected_artifacts: testCase.expected_artifacts,
    treatment_expected_artifacts: testCase.treatment_expected_artifacts,
    forbidden_files: testCase.forbidden_files,
    changed_files: ["src/project-name.js"],
    artifacts: [
      "docs/PRD.md",
      "docs/TASK_GRAPH.json",
      "artifacts/dev-result.json",
      "artifacts/eval-report.json",
      "artifacts/FinalDeliveryReport.md",
      "artifacts/final-eval-report.json"
    ],
    validation_logs: ["evals/effectiveness/reports/feature-small-001/treatment-validation.log"],
    diff_path: "evals/effectiveness/reports/feature-small-001/treatment-diff.patch",
    planner_thread_id: "thread_planner",
    dev_worker_thread_id: "thread_dev_worker",
    initial_evaluator_thread_id: "thread_initial_evaluator",
    repair_request_created: true,
    repair_dev_worker_thread_id: "thread_repair_dev_worker",
    final_evaluator_thread_id: "thread_final_evaluator",
    final_eval_verdict: "PASS",
    validation_passed: true,
    final_report_path: "artifacts/FinalDeliveryReport.md",
    secret_leak_detected: false,
    danger_full_access_used: false,
    current_stage: "FINAL_REPORT_DONE",
    thread_count: 5,
    command_count: 5
  } satisfies M12RunResult);
}

function mockGate6B2State(): Record<string, unknown> {
  return {
    gate: "Gate 6B.2 SDK-Orchestrated Repair Loop E2E",
    target_repo: "target",
    current_stage: "FINAL_REPORT_DONE",
    planner: {
      status: "PASS",
      thread_id: "thread_planner",
      prd_path: "docs/PRD.md",
      task_graph_path: "docs/TASK_GRAPH.json",
      planner_result_path: "artifacts/planner-result.json",
      artifact_thread_evidence_verified: true
    },
    dev_worker: {
      status: "PASS",
      thread_id: "thread_dev_initial",
      dev_result_path: "artifacts/dev-result.json",
      file_change_verified: true,
      baseline_tests_passed: true,
      full_tests_expected_to_fail: true,
      full_tests_failed: true,
      known_gap_seeded: true
    },
    initial_evaluator: {
      status: "PASS",
      thread_id: "thread_eval_initial",
      eval_report_path: "artifacts/eval-report-needs-revision.json",
      eval_verdict: "NEEDS_REVISION"
    },
    repair_request: {
      status: "PASS",
      repair_request_path: "artifacts/repair-request.json",
      source_eval_report_path: "artifacts/eval-report-needs-revision.json",
      required_fixes_count: 1
    },
    repair_dev_worker: {
      status: "PASS",
      thread_id: "thread_dev_repair",
      repair_result_path: "artifacts/dev-repair-result.json",
      file_change_verified: true,
      tests_passed: true
    },
    final_evaluator: {
      status: "PASS",
      thread_id: "thread_eval_final",
      eval_report_path: "artifacts/eval-report-pass.json",
      eval_verdict: "PASS"
    },
    final_report: {
      status: "PASS",
      path: "artifacts/FinalDeliveryReport.md"
    },
    errors: []
  };
}
