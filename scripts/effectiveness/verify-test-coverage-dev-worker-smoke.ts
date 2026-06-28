import { resolve } from "node:path";

import { reconstructTestCoverageDevWorkerSmokeReadiness } from "../../src/effectiveness/test-coverage-dev-worker-smoke-readiness.ts";
import { readJson, writeJson } from "./io.ts";
import type { TestCoverageDevWorkerSmokeResult } from "./run-test-coverage-dev-worker-smoke.ts";

export interface TestCoverageDevWorkerSmokeVerifyResult {
  status: "PASS" | "NEEDS_REVISION";
  dry_run_status: string;
  mode: string;
  real_sdk_run_executed: boolean;
  dev_worker_thread_started: boolean;
  file_change_verified: boolean;
  structured_output_valid: boolean;
  npm_test_run: boolean;
  npm_test_passed: boolean;
  coverage_contract_run: boolean;
  coverage_contract_passed: boolean;
  src_modified: boolean;
  prompt_length: number;
  prompt_max_length: number;
  prompt_requires_npm_test: boolean;
  prompt_requires_coverage_contract: boolean;
  prompt_discourages_src_modification: boolean;
  ready_for_one_dev_worker_parity_smoke: boolean;
  ready_for_next_dev_worker_smoke: boolean;
  ready_for_test_coverage_002_treatment_rerun: boolean;
  ready_for_minimal: boolean;
  ready_for_exact: boolean;
  readiness_reconstruction_status: string;
  failure_category: string;
  errors: string[];
}

const resultPath = "evals/effectiveness/reports/test-coverage-002/dev-worker-smoke-result.json";
const verifyPath = "evals/effectiveness/reports/test-coverage-002/dev-worker-smoke-verify.json";

export function verifyTestCoverageDevWorkerSmoke(repoRoot = process.cwd()): TestCoverageDevWorkerSmokeVerifyResult {
  const result = readJson<TestCoverageDevWorkerSmokeResult | null>(resolve(repoRoot, resultPath), null);
  const readiness = reconstructTestCoverageDevWorkerSmokeReadiness(repoRoot, { write: true });
  const blockedOk = result?.status === "BLOCKED_TEST_COVERAGE_DEV_WORKER_SMOKE_NOT_ENABLED" && result.real_sdk_run_executed === false;
  const orderedBlockedOk = typeof result?.status === "string" &&
    result.status.startsWith("BLOCKED_TEST_COVERAGE_002_DEV_") &&
    result.real_sdk_run_executed === false;
  const passOk = result?.status === "PASS" &&
    result.dev_worker_thread_started === true &&
    result.final_response_contains_expected === true &&
    (result.mode === "parity" || (result.file_change_verified === true && result.structured_output_valid === true && result.src_modified === false));
  const verify: TestCoverageDevWorkerSmokeVerifyResult = {
    status: blockedOk || orderedBlockedOk || passOk ? "PASS" : "NEEDS_REVISION",
    dry_run_status: result?.status ?? "NOT_RUN",
    mode: result?.mode ?? "",
    real_sdk_run_executed: result?.real_sdk_run_executed === true,
    dev_worker_thread_started: result?.dev_worker_thread_started === true,
    file_change_verified: result?.file_change_verified === true,
    structured_output_valid: result?.structured_output_valid === true,
    npm_test_run: result?.npm_test_run === true,
    npm_test_passed: result?.npm_test_passed === true,
    coverage_contract_run: result?.coverage_contract_run === true,
    coverage_contract_passed: result?.coverage_contract_passed === true,
    src_modified: result?.src_modified === true,
    prompt_length: result?.prompt_length ?? 0,
    prompt_max_length: result?.prompt_max_length ?? 0,
    prompt_requires_npm_test: result?.prompt_requires_npm_test === true,
    prompt_requires_coverage_contract: result?.prompt_requires_coverage_contract === true,
    prompt_discourages_src_modification: result?.prompt_discourages_src_modification === true,
    ready_for_one_dev_worker_parity_smoke: blockedOk || readiness.ready_for_parity,
    ready_for_next_dev_worker_smoke: result?.ready_for_next_dev_worker_smoke === true,
    ready_for_test_coverage_002_treatment_rerun: readiness.ready_for_treatment_rerun,
    ready_for_minimal: readiness.ready_for_minimal,
    ready_for_exact: readiness.ready_for_exact,
    readiness_reconstruction_status: readiness.reconstruction_status,
    failure_category: result?.failure_category ?? "",
    errors: blockedOk || orderedBlockedOk || passOk ? [] : ["Test coverage dev-worker smoke did not produce a safe blocked state or valid smoke evidence."]
  };
  writeJson(resolve(repoRoot, verifyPath), verify);
  return verify;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = verifyTestCoverageDevWorkerSmoke();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.status === "PASS" ? 0 : 2;
}
