import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const repoRoot = process.cwd();
const reportDir = resolve(repoRoot, "evals/sdk-orchestrated/reports/sdk-startup-triage");
const resultPath = resolve(reportDir, "dev-worker-smoke-result.json");
const verifyPath = resolve(reportDir, "dev-worker-smoke-verify.json");
const baselinePath = resolve(reportDir, "dev-worker-baseline.json");

function main(): void {
  const result = readJson(resultPath);
  const dryRunOk = result.status === "BLOCKED_SDK_DEV_WORKER_NOT_ENABLED" && result.real_sdk_run_attempted === false;
  const passOk =
    result.status === "PASS" &&
    result.dev_worker_thread_started === true &&
    typeof result.dev_worker_thread_id === "string" &&
    result.dev_worker_thread_id.length > 0;
  const verify = {
    status: dryRunOk || passOk ? "PASS" : "NEEDS_REVISION",
    mode: typeof result.mode === "string" ? result.mode : "parity",
    dry_run_status: typeof result.status === "string" ? result.status : "NOT_RUN",
    real_sdk_run_executed: result.real_sdk_run_attempted === true,
    dev_worker_stage_shared: result.mode === "output-lite" ? result.dev_worker_stage_shared === true : true,
    dev_worker_stage_impl: typeof result.dev_worker_stage_impl === "string" ? result.dev_worker_stage_impl : "",
    ready_for_one_real_dev_worker_parity_smoke: dryRunOk && result.sdk_dependency_detected === true,
    ready_for_dev_worker_minimal_fix_smoke: devWorkerModePassed("parity"),
    ready_for_dev_worker_output_lite_smoke: devWorkerModePassed("parity") && devWorkerModePassed("minimal-fix"),
    ready_for_gate6b_smoke: allDevWorkerModesPassed(),
    baseline_exists: existsSync(baselinePath),
    baseline_fixture_broken: baselineIsBroken(),
    file_change_verified_by_hash: result.file_change_verified_by_hash === true,
    file_change_verified_by_git: result.file_change_verified_by_git === true,
    file_change_verified_by_event: result.file_change_verified_by_event === true,
    failure_category: typeof result.failure_category === "string" ? result.failure_category : "",
    errors: dryRunOk || passOk ? [] : ["Dev worker smoke must either dry-run safely or prove one dev worker SDK slice."]
  };
  writeJson(verifyPath, verify);
  process.stdout.write(`${JSON.stringify(verify, null, 2)}\n`);
  process.exitCode = verify.status === "PASS" ? 0 : 2;
}

function allDevWorkerModesPassed(): boolean {
  return ["parity", "minimal-fix", "output-lite"].every(devWorkerModePassed);
}

function devWorkerModePassed(mode: string): boolean {
  const result = readJson(resolve(reportDir, `dev-worker-smoke-${mode}-result.json`));
  const basePass = result.status === "PASS" && result.dev_worker_thread_started === true && typeof result.dev_worker_thread_id === "string" && result.dev_worker_thread_id.length > 0;
  if (!basePass) return false;
  if (mode === "parity") {
    return result.final_response_contains_expected === true;
  }
  return result.initial_tests_failed === true && result.file_change_verified === true && result.tests_passed === true;
}

function baselineIsBroken(): boolean {
  const baseline = readJson(baselinePath);
  return baseline.fixture_status === "BROKEN_AS_EXPECTED" && baseline.initial_tests_failed === true && typeof baseline.src_project_name_hash_before === "string" && baseline.src_project_name_hash_before.length > 0;
}

function readJson(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

main();
