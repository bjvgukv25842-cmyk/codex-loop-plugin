import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { getGenericTestCoverageCaseProfile } from "../../src/effectiveness/generic-test-coverage-case-profile.ts";
import {
  buildTestCoverageDevWorkerPrompt,
  TEST_COVERAGE_002_DEV_WORKER_PROMPT_MAX_LENGTH
} from "../../src/effectiveness/treatment-generic-test-coverage-runner.ts";
import { runTestCoverageDevWorkerSmoke } from "../../scripts/effectiveness/run-test-coverage-dev-worker-smoke.ts";
import { verifyTestCoverageDevWorkerSmoke } from "../../scripts/effectiveness/verify-test-coverage-dev-worker-smoke.ts";
import { reportTestCoverageDevWorkerSmoke } from "../../scripts/effectiveness/report-test-coverage-dev-worker-smoke.ts";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("test-coverage-002 dev-worker smoke harness", () => {
  it("defaults to blocked without starting a real SDK thread", async () => {
    const repoRoot = tempRoot("tc-dev-smoke-blocked-");
    const result = await runTestCoverageDevWorkerSmoke({ repoRoot, env: {} });
    const verify = verifyTestCoverageDevWorkerSmoke(repoRoot);

    expect(result.status).toBe("BLOCKED_TEST_COVERAGE_DEV_WORKER_SMOKE_NOT_ENABLED");
    expect(result.real_sdk_run_executed).toBe(false);
    expect(result.ready_for_one_dev_worker_parity_smoke).toBe(true);
    expect(result.ready_for_test_coverage_002_treatment_rerun).toBe(false);
    expect(verify.status).toBe("PASS");
  });

  it("passes parity with mock SDK", async () => {
    const repoRoot = tempRoot("tc-dev-smoke-parity-");
    const result = await runTestCoverageDevWorkerSmoke({
      repoRoot,
      env: {
        CODEX_LOOP_ENABLE_M12_TEST_COVERAGE_DEV_WORKER_SMOKE: "1",
        CODEX_LOOP_TEST_COVERAGE_DEV_WORKER_SMOKE_MODE: "parity",
        CODEX_LOOP_TEST_COVERAGE_DEV_WORKER_SMOKE_MOCK: "pass"
      }
    });

    expect(result.status).toBe("PASS");
    expect(result.real_sdk_run_executed).toBe(false);
    expect(result.dev_worker_thread_started).toBe(true);
    expect(result.final_response_contains_expected).toBe(true);
    expect(result.ready_for_next_dev_worker_smoke).toBe(true);
  });

  it("passes minimal with mock SDK after parity", async () => {
    const repoRoot = tempRoot("tc-dev-smoke-minimal-");
    await passMode(repoRoot, "parity");
    const result = await passMode(repoRoot, "minimal");

    expect(result.status).toBe("PASS");
    expect(result.file_change_verified).toBe(true);
    expect(result.changed_files).toContain("test/cache.test.js");
    expect(result.npm_test_run).toBe(true);
    expect(result.npm_test_passed).toBe(true);
    expect(result.coverage_contract_run).toBe(false);
    expect(result.src_modified).toBe(false);
    expect(result.ready_for_next_dev_worker_smoke).toBe(true);
  });

  it("passes exact with mock SDK after parity and minimal", async () => {
    const repoRoot = tempRoot("tc-dev-smoke-exact-");
    await passMode(repoRoot, "parity");
    await passMode(repoRoot, "minimal");
    const result = await passMode(repoRoot, "exact");

    expect(result.status).toBe("PASS");
    expect(result.file_change_verified).toBe(true);
    expect(result.npm_test_run).toBe(true);
    expect(result.coverage_contract_run).toBe(true);
    expect(result.coverage_contract_passed).toBe(true);
    expect(result.prompt_length).toBeLessThanOrEqual(TEST_COVERAGE_002_DEV_WORKER_PROMPT_MAX_LENGTH);
    expect(result.prompt_requires_npm_test).toBe(true);
    expect(result.prompt_requires_coverage_contract).toBe(true);
    expect(result.prompt_discourages_src_modification).toBe(true);
    expect(result.ready_for_test_coverage_002_treatment_rerun).toBe(true);
  });

  it("classifies minimal failure after parity", async () => {
    const repoRoot = tempRoot("tc-dev-smoke-minimal-fail-");
    await passMode(repoRoot, "parity");
    const result = await runTestCoverageDevWorkerSmoke({
      repoRoot,
      env: {
        CODEX_LOOP_ENABLE_M12_TEST_COVERAGE_DEV_WORKER_SMOKE: "1",
        CODEX_LOOP_TEST_COVERAGE_DEV_WORKER_SMOKE_MODE: "minimal",
        CODEX_LOOP_TEST_COVERAGE_DEV_WORKER_SMOKE_MOCK: "fail"
      }
    });

    expect(result.status).toBe("FAIL");
    expect(result.failure_category).toBe("TEST_COVERAGE_002_DEV_MINIMAL_FAILED");
    expect(result.ready_for_test_coverage_002_treatment_rerun).toBe(false);
  });

  it("classifies exact failure after minimal", async () => {
    const repoRoot = tempRoot("tc-dev-smoke-exact-fail-");
    await passMode(repoRoot, "parity");
    await passMode(repoRoot, "minimal");
    const result = await runTestCoverageDevWorkerSmoke({
      repoRoot,
      env: {
        CODEX_LOOP_ENABLE_M12_TEST_COVERAGE_DEV_WORKER_SMOKE: "1",
        CODEX_LOOP_TEST_COVERAGE_DEV_WORKER_SMOKE_MODE: "exact",
        CODEX_LOOP_TEST_COVERAGE_DEV_WORKER_SMOKE_MOCK: "fail"
      }
    });

    expect(result.status).toBe("FAIL");
    expect(result.failure_category).toBe("TEST_COVERAGE_002_DEV_EXACT_PROMPT_OR_VALIDATION_FAILED");
    expect(result.ready_for_test_coverage_002_treatment_rerun).toBe(false);
  });

  it("reports smoke and existing timeout triage artifacts", async () => {
    const repoRoot = tempRoot("tc-dev-smoke-report-");
    await runTestCoverageDevWorkerSmoke({ repoRoot, env: {} });
    reportTestCoverageDevWorkerSmoke(repoRoot);

    expect(existsSync(resolve(repoRoot, "evals/effectiveness/reports/test-coverage-002/DevWorkerSmokeReport.md"))).toBe(true);
    expect(existsSync(resolve(repoRoot, "evals/effectiveness/reports/test-coverage-002/dev-worker-timeout-triage.json"))).toBe(true);
    expect(existsSync(resolve(repoRoot, "evals/effectiveness/reports/test-coverage-002/dev-worker-invocation-diff.json"))).toBe(true);
  });
});

describe("test-coverage-002 exact dev-worker prompt", () => {
  it("is short, requires validation, and discourages source modification", () => {
    const prompt = buildTestCoverageDevWorkerPrompt({
      profile: getGenericTestCoverageCaseProfile("test-coverage-002")!,
      prd_path: "docs/PRD.md",
      task_graph_path: "docs/TASK_GRAPH.json"
    });

    expect(prompt.length).toBeLessThanOrEqual(TEST_COVERAGE_002_DEV_WORKER_PROMPT_MAX_LENGTH);
    expect(prompt).toContain("npm test");
    expect(prompt).toContain("npm run coverage:contract");
    expect(prompt).toContain("Do not modify src/cache.js or src/cache-storage.js");
    expect(prompt).toContain("test/cache.test.js");
  });
});

async function passMode(repoRoot: string, mode: "parity" | "minimal" | "exact") {
  return runTestCoverageDevWorkerSmoke({
    repoRoot,
    env: {
      CODEX_LOOP_ENABLE_M12_TEST_COVERAGE_DEV_WORKER_SMOKE: "1",
      CODEX_LOOP_TEST_COVERAGE_DEV_WORKER_SMOKE_MODE: mode,
      CODEX_LOOP_TEST_COVERAGE_DEV_WORKER_SMOKE_MOCK: "pass"
    }
  });
}

function tempRoot(prefix: string): string {
  const dir = mkdtempSync(resolve(tmpdir(), prefix));
  tempDirs.push(dir);
  writeFile(
    resolve(dir, "evals/effectiveness/datasets/m12-mini.jsonl"),
    readFileSync(resolve(process.cwd(), "evals/effectiveness/datasets/m12-mini.jsonl"), "utf8")
  );
  copyFixture(dir);
  seedExistingEvidence(dir);
  return dir;
}

function copyFixture(repoRoot: string): void {
  const source = resolve(process.cwd(), "evals/effectiveness/fixtures/test-coverage-002");
  for (const file of ["package.json", "README.md", "src/cache.js", "src/cache-storage.js", "test/cache.test.js", "scripts/check-test-coverage-contract.js"]) {
    writeFile(resolve(repoRoot, "evals/effectiveness/runs/test-coverage-002/treatment/target-repo", file), readFileSync(resolve(source, file), "utf8"));
  }
}

function seedExistingEvidence(repoRoot: string): void {
  const tc001Trace = resolve(repoRoot, "evals/effectiveness/reports/test-coverage-001/sdk-stage-logs/generic-test-coverage-dev-worker-invocation-trace-redacted.json");
  const tc002Trace = resolve(repoRoot, "evals/effectiveness/reports/test-coverage-002/sdk-stage-logs/generic-test-coverage-dev-worker-invocation-trace-redacted.json");
  const targetRepo = resolve(repoRoot, "evals/effectiveness/runs/test-coverage-002/treatment/target-repo");
  const trace = {
    target_repo: targetRepo,
    target_repo_is_git: false,
    constructor_options: { config_values_redacted: { sqlite_home: resolve(repoRoot, ".codex-eval/sqlite"), model_catalog_json: "catalog.json", model: "gpt-test" } },
    start_thread_options: { workingDirectory: targetRepo, sandboxMode: "workspace-write", model: "gpt-test" },
    run_options: { usesOutputSchema: true, usesRunStreamed: false },
    prompt: { length: 300, hash: "hash" },
    sdk_api_method: "run",
    error_capture_paths: {
      events_path: resolve(repoRoot, "evals/effectiveness/reports/test-coverage-002/sdk-stage-logs/generic-test-coverage-dev-worker-events.jsonl"),
      stdout_path: resolve(repoRoot, "evals/effectiveness/reports/test-coverage-002/sdk-stage-logs/generic-test-coverage-dev-worker-stdout.log"),
      stderr_path: resolve(repoRoot, "evals/effectiveness/reports/test-coverage-002/sdk-stage-logs/generic-test-coverage-dev-worker-stderr.log")
    }
  };
  writeFile(tc001Trace, JSON.stringify({ ...trace, target_repo: resolve(repoRoot, "evals/effectiveness/runs/test-coverage-001/treatment/target-repo") }, null, 2));
  writeFile(tc002Trace, JSON.stringify(trace, null, 2));
  writeFile(resolve(repoRoot, "evals/effectiveness/reports/test-coverage-002/treatment-result.json"), JSON.stringify({
    case_id: "test-coverage-002",
    variant: "treatment",
    status: "BLOCKED",
    real_run_executed: true,
    prompt: "",
    fixture_repo: targetRepo,
    acceptance_criteria: [],
    validation_commands: ["npm test", "npm run coverage:contract"],
    expected_artifacts: [],
    forbidden_files: [],
    changed_files: [],
    artifacts: [],
    validation_logs: [],
    duration_ms: 0,
    thread_count: 2,
    command_count: 2,
    planner_thread_id: "thread_planner",
    dev_worker_thread_id: "thread_dev_worker",
    failure_category: "TEST_COVERAGE_002_DEV_WORKER_TURN_NO_EVENT_TIMEOUT",
    errors: []
  }, null, 2));
}

function writeFile(path: string, value: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value, "utf8");
}
