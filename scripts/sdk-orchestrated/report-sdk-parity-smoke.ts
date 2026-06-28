import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const repoRoot = process.cwd();
const reportDir = resolve(repoRoot, "evals/sdk-orchestrated/reports/sdk-startup-triage");
const resultPath = resolve(reportDir, "sdk-parity-smoke-result.json");
const verifyPath = resolve(reportDir, "sdk-parity-smoke-verify.json");
const reportPath = resolve(reportDir, "SDKParitySmokeReport.md");

function main(): void {
  const result = readJson(resultPath);
  const verify = readJson(verifyPath);
  const lines = [
    "# Gate 6B.1D SDK-vs-CLI Parity Smoke Report",
    "",
    "Date: 2026-06-20",
    "",
    `Run status: ${String(result.status ?? "NOT_RUN")}`,
    `Verify status: ${String(verify.status ?? "NOT_RUN")}`,
    `Real SDK run attempted: ${String(result.real_sdk_run_attempted === true)}`,
    `Direct CLI parity status: ${String(result.direct_cli_parity_status ?? "UNKNOWN")}`,
    `SDK thread started: ${String(result.sdk_thread_started === true)}`,
    `SDK thread id: ${String(result.sdk_thread_id ?? "")}`,
    `Failure category: ${String(result.failure_category ?? "")}`,
    `Model: ${String(result.model ?? "")}`,
    `Model catalog: ${String(result.model_catalog_json ?? "")}`,
    `Target repo: ${String(result.target_repo ?? "tmp/sdk-orchestrated/gate6b-smoke-target")}`,
    "M12 blocked: true",
    "",
    "This smoke starts at most one read-only SDK thread and exists to prove SDK invocation parity before the three-thread Gate 6B.1 smoke.",
    "",
    "Default dry-run behavior returns `BLOCKED_SDK_PARITY_NOT_ENABLED` unless `CODEX_LOOP_ENABLE_REAL_SDK_PARITY=1` is explicitly set in a controlled host terminal.",
    "",
    "Only after SDK parity PASS should `CODEX_LOOP_ENABLE_REAL_SDK_RUN=1 npm run gate6b:smoke:run` be attempted.",
    ""
  ];
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${lines.join("\n")}\n`, "utf8");
}

function readJson(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

main();
