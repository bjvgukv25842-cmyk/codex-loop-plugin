import { resolve } from "node:path";

import { reconstructTestCoverageDevWorkerSmokeReadiness } from "../../src/effectiveness/test-coverage-dev-worker-smoke-readiness.ts";
import { diffTestCoverageDevWorkerInvocation } from "./diff-test-coverage-dev-worker-invocation.ts";
import { readJson, writeMarkdown } from "./io.ts";
import type { TestCoverageDevWorkerSmokeResult } from "./run-test-coverage-dev-worker-smoke.ts";
import { writeTestCoverageDevWorkerTimeoutTriage } from "./triage-test-coverage-dev-worker-timeout.ts";
import type { TestCoverageDevWorkerSmokeVerifyResult } from "./verify-test-coverage-dev-worker-smoke.ts";

const reportDir = "evals/effectiveness/reports/test-coverage-002";

export function reportTestCoverageDevWorkerSmoke(repoRoot = process.cwd()): TestCoverageDevWorkerSmokeResult | null {
  const result = readJson<TestCoverageDevWorkerSmokeResult | null>(resolve(repoRoot, reportDir, "dev-worker-smoke-result.json"), null);
  const verify = readJson<TestCoverageDevWorkerSmokeVerifyResult | null>(resolve(repoRoot, reportDir, "dev-worker-smoke-verify.json"), null);
  const timeoutTriage = writeTestCoverageDevWorkerTimeoutTriage(repoRoot);
  const invocationDiff = diffTestCoverageDevWorkerInvocation(repoRoot);
  const readiness = reconstructTestCoverageDevWorkerSmokeReadiness(repoRoot, { write: true });
  const lines = [
    "# Test-Coverage-002 Dev Worker Smoke Report",
    "",
    `Smoke status: ${result?.status ?? "NOT_RUN"}`,
    `Verify status: ${verify?.status ?? "NOT_RUN"}`,
    `Mode: ${result?.mode ?? ""}`,
    `Real SDK run executed: ${String(result?.real_sdk_run_executed === true)}`,
    `Dev worker thread started: ${String(result?.dev_worker_thread_started === true)}`,
    `Dev worker thread id: ${result?.dev_worker_thread_id ?? ""}`,
    `File change verified: ${String(result?.file_change_verified === true)}`,
    `Structured output valid: ${String(result?.structured_output_valid === true)}`,
    `npm test run: ${String(result?.npm_test_run === true)}`,
    `npm test passed: ${String(result?.npm_test_passed === true)}`,
    `coverage:contract run: ${String(result?.coverage_contract_run === true)}`,
    `coverage:contract passed: ${String(result?.coverage_contract_passed === true)}`,
    `src modified: ${String(result?.src_modified === true)}`,
    `Failure category: ${result?.failure_category ?? ""}`,
    `Prompt length: ${String(result?.prompt_length ?? 0)}`,
    `Prompt max length: ${String(result?.prompt_max_length ?? 0)}`,
    `Prompt requires npm test: ${String(result?.prompt_requires_npm_test === true)}`,
    `Prompt requires coverage contract: ${String(result?.prompt_requires_coverage_contract === true)}`,
    `Prompt discourages src modification: ${String(result?.prompt_discourages_src_modification === true)}`,
    "",
    "## Existing Timeout Evidence",
    `Failure category: ${timeoutTriage.failure_category}`,
    `Event count: ${timeoutTriage.event_count}`,
    `Last event type: ${timeoutTriage.last_event_type}`,
    `Elapsed ms: ${timeoutTriage.elapsed_ms}`,
    "",
    "## Invocation Diff",
    `Status: ${invocationDiff.status}`,
    `Critical diffs: ${invocationDiff.critical_diffs.length ? invocationDiff.critical_diffs.join(", ") : "none"}`,
    "",
    "## Readiness State",
    `parity: ${readiness.parity.status}`,
    `minimal: ${readiness.minimal.status}`,
    `exact: ${readiness.exact.status}`,
    `ready_for_minimal: ${String(readiness.ready_for_minimal)}`,
    `ready_for_exact: ${String(readiness.ready_for_exact)}`,
    `ready_for_treatment_rerun: ${String(readiness.ready_for_treatment_rerun)}`,
    `readiness reconstruction status: ${readiness.reconstruction_status}`,
    "",
    "## Required Smoke Order",
    "- parity",
    "- minimal",
    "- exact",
    "",
    "Only after all three real dev-worker-only smokes pass may one approved test-coverage-002 treatment fresh rerun be considered.",
    "M12 production ready: false",
    ""
  ];
  writeMarkdown(resolve(repoRoot, reportDir, "DevWorkerSmokeReport.md"), `${lines.join("\n")}\n`);
  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = reportTestCoverageDevWorkerSmoke();
  process.stdout.write(`${JSON.stringify(result ?? { status: "NOT_RUN" }, null, 2)}\n`);
}
