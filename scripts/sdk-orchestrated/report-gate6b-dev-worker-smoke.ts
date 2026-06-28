import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const repoRoot = process.cwd();
const reportDir = resolve(repoRoot, "evals/sdk-orchestrated/reports/sdk-startup-triage");
const resultPath = resolve(reportDir, "dev-worker-smoke-result.json");
const verifyPath = resolve(reportDir, "dev-worker-smoke-verify.json");
const reportPath = resolve(reportDir, "DevWorkerSmokeReport.md");

function main(): void {
  const result = readJson(resultPath);
  const verify = readJson(verifyPath);
  const lines = [
    "# Gate 6B.1J Dev Worker Smoke Report",
    "",
    "Date: 2026-06-20",
    "",
    `Mode: ${String(result.mode ?? "parity")}`,
    `Run status: ${String(result.status ?? "NOT_RUN")}`,
    `Verify status: ${String(verify.status ?? "NOT_RUN")}`,
    `Real SDK run attempted: ${String(result.real_sdk_run_attempted === true)}`,
    `Dev worker thread started: ${String(result.dev_worker_thread_started === true)}`,
    `Dev worker thread id: ${String(result.dev_worker_thread_id ?? "")}`,
    `File change verified: ${String(result.file_change_verified === true)}`,
    `File change verified by hash: ${String(result.file_change_verified_by_hash === true)}`,
    `File change verified by git diff: ${String(result.file_change_verified_by_git === true)}`,
    `File change verified by SDK event: ${String(result.file_change_verified_by_event === true)}`,
    `Initial tests failed: ${String(result.initial_tests_failed === true)}`,
    `Tests passed: ${String(result.tests_passed === true)}`,
    `Dev worker stage shared: ${String(result.dev_worker_stage_shared === true)}`,
    `Dev worker stage impl: ${String(result.dev_worker_stage_impl ?? "")}`,
    `Failure category: ${String(result.failure_category ?? "")}`,
    `Ready for Gate 6B smoke: ${String(verify.ready_for_gate6b_smoke === true)}`,
    "M12 blocked: true",
    "",
    "Dev worker smoke slices must pass in order: parity, minimal-fix, output-lite. The three-thread Gate 6B.1 smoke remains blocked until all required dev worker slices pass.",
    ""
  ];
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${lines.join("\n")}\n`, "utf8");
}

function readJson(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  const text = readFileSync(path, "utf8").trim();
  if (!text) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return {};
  }
}

main();
