import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { analyzeTestCoverage002Treatment, normalizeTestCoverage002TreatmentFailureCategory } from "../../src/effectiveness/test-coverage-treatment-triage.ts";
import type { GenericTestCoverageCheckpointState } from "../../src/effectiveness/generic-test-coverage-checkpoint-state.ts";
import type { M12RunResult } from "../../scripts/effectiveness/types.ts";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("test-coverage-002 treatment triage", () => {
  it("classifies dev worker thread id with no dev result as DEV_RESULT_MISSING", () => {
    const result = treatment({ dev_worker_thread_id: "dev", failure_category: "" });

    expect(normalizeTestCoverage002TreatmentFailureCategory(result)).toBe("TEST_COVERAGE_002_DEV_RESULT_MISSING");
  });

  it("classifies a started timed out dev worker as DEV_WORKER_TURN_NO_EVENT_TIMEOUT", () => {
    const result = treatment({ dev_worker_thread_id: "dev", failure_category: "SDK_THREAD_TIMEOUT" });

    expect(normalizeTestCoverage002TreatmentFailureCategory(result, checkpoint({ devStatus: "TIMEOUT" }))).toBe("TEST_COVERAGE_002_DEV_WORKER_TURN_NO_EVENT_TIMEOUT");
  });

  it("classifies missing validation logs after dev result", () => {
    const { repo, devResult } = repoWithDevResult();
    const result = treatment({ fixture_repo: repo, artifacts: ["artifacts/dev-result.json"] });

    expect(normalizeTestCoverage002TreatmentFailureCategory(result)).toBe("TEST_COVERAGE_002_VALIDATION_LOG_MISSING");
    expect(analyzeTestCoverage002Treatment({ treatment: result }).dev_result_path).toBe(devResult);
  });

  it("classifies npm test failure", () => {
    const { repo, log } = repoWithValidationLog("$ npm test\nnot ok 1\n$ npm run coverage:contract\nPASS\n");
    const result = treatment({ fixture_repo: repo, artifacts: ["artifacts/dev-result.json"], validation_logs: [log] });

    expect(normalizeTestCoverage002TreatmentFailureCategory(result)).toBe("TEST_COVERAGE_002_NPM_TEST_FAILED");
  });

  it("classifies coverage contract failure", () => {
    const { repo, log } = repoWithValidationLog("$ npm test\nok 1\n$ npm run coverage:contract\nError: missing stale cache test\n");
    const result = treatment({ fixture_repo: repo, artifacts: ["artifacts/dev-result.json"], validation_logs: [log] });

    expect(normalizeTestCoverage002TreatmentFailureCategory(result)).toBe("TEST_COVERAGE_002_COVERAGE_CONTRACT_FAILED");
  });

  it("classifies coverage contract passed but aggregate mapping false as ARTIFACT_MAPPING_STALE", () => {
    const { repo, log } = repoWithValidationLog("$ npm test\nok 1\n$ npm run coverage:contract\nCache coverage contract satisfied.\n");
    const result = treatment({ fixture_repo: repo, artifacts: ["artifacts/dev-result.json"], validation_logs: [log], validation_passed: false });

    expect(normalizeTestCoverage002TreatmentFailureCategory(result)).toBe("TEST_COVERAGE_002_ARTIFACT_MAPPING_STALE");
  });

  it("classifies validation pass without evaluator as EVALUATOR_NOT_STARTED_AFTER_DEV when mapping is true", () => {
    const { repo, log } = repoWithValidationLog("$ npm test\nok 1\n$ npm run coverage:contract\nCache coverage contract satisfied.\n");
    const result = treatment({ fixture_repo: repo, artifacts: ["artifacts/dev-result.json"], validation_logs: [log], validation_passed: true });

    expect(normalizeTestCoverage002TreatmentFailureCategory(result)).toBe("TEST_COVERAGE_002_EVALUATOR_NOT_STARTED_AFTER_DEV");
  });
});

function treatment(overrides: Partial<M12RunResult>): M12RunResult {
  return {
    case_id: "test-coverage-002",
    variant: "treatment",
    mode: "treatment",
    runtime: "sdk-orchestrated",
    status: "BLOCKED",
    real_run_executed: true,
    prompt: "",
    fixture_repo: "",
    acceptance_criteria: [],
    validation_commands: ["npm test", "npm run coverage:contract"],
    expected_artifacts: [],
    forbidden_files: [".env"],
    changed_files: ["test/cache.test.js"],
    artifacts: [],
    validation_logs: [],
    validation_passed: false,
    planner_thread_id: "planner",
    dev_worker_thread_id: "",
    duration_ms: 0,
    thread_count: 1,
    command_count: 1,
    errors: [],
    ...overrides
  };
}

function checkpoint(input: { devStatus: string }): GenericTestCoverageCheckpointState {
  return {
    case_id: "test-coverage-002",
    current_stage: "FAILED",
    planner: { status: "PASS", thread_id: "planner", prd_path: "docs/PRD.md", task_graph_path: "docs/TASK_GRAPH.json" },
    dev_worker: { status: input.devStatus, thread_id: "dev", file_change_verified: false, tests_passed: false, dev_result_path: "" },
    evaluator: { status: "", thread_id: "", eval_verdict: "", eval_report_path: "" },
    repair_request: {},
    repair_dev_worker: {},
    final_evaluator: {},
    final_report: {},
    errors: []
  };
}

function repoWithDevResult(): { repo: string; devResult: string } {
  const repo = mkdtempSync(resolve(tmpdir(), "tc2-triage-"));
  tempDirs.push(repo);
  const devResult = resolve(repo, "artifacts/dev-result.json");
  mkdirSync(resolve(repo, "artifacts"), { recursive: true });
  writeFileSync(devResult, "{}\n", "utf8");
  return { repo, devResult };
}

function repoWithValidationLog(text: string): { repo: string; log: string } {
  const { repo } = repoWithDevResult();
  const log = resolve(repo, "validation.log");
  writeFileSync(log, text, "utf8");
  return { repo, log };
}
