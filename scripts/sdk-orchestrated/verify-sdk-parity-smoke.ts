import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const repoRoot = process.cwd();
const reportDir = resolve(repoRoot, "evals/sdk-orchestrated/reports/sdk-startup-triage");
const resultPath = resolve(reportDir, "sdk-parity-smoke-result.json");
const verifyPath = resolve(reportDir, "sdk-parity-smoke-verify.json");

interface VerifyResult {
  status: "PASS" | "NEEDS_REVISION";
  dry_run_status: string;
  real_sdk_run_executed: boolean;
  direct_cli_parity_status: string;
  ready_for_one_real_sdk_parity_smoke: boolean;
  ready_for_real_gate6b_smoke: boolean;
  failure_category: string;
  errors: string[];
}

function main(): void {
  const result = readJson(resultPath);
  const dryRunOk =
    result.status === "BLOCKED_SDK_PARITY_NOT_ENABLED" &&
    result.real_sdk_run_enabled === false &&
    result.real_sdk_run_attempted === false &&
    result.danger_full_access_used === false &&
    result.secret_leak_detected === false;
  const sdkParityPass =
    result.status === "PASS" &&
    result.sdk_thread_started === true &&
    typeof result.sdk_thread_id === "string" &&
    result.sdk_thread_id.length > 0 &&
    result.final_response_contains_expected === true;
  const verify: VerifyResult = {
    status: dryRunOk || sdkParityPass ? "PASS" : "NEEDS_REVISION",
    dry_run_status: typeof result.status === "string" ? result.status : "NOT_RUN",
    real_sdk_run_executed: result.real_sdk_run_attempted === true,
    direct_cli_parity_status: typeof result.direct_cli_parity_status === "string" ? result.direct_cli_parity_status : "UNKNOWN",
    ready_for_one_real_sdk_parity_smoke: dryRunOk && result.sdk_dependency_detected === true,
    ready_for_real_gate6b_smoke: sdkParityPass,
    failure_category: typeof result.failure_category === "string" ? result.failure_category : "",
    errors: dryRunOk || sdkParityPass ? [] : ["SDK parity smoke must either dry-run safely or prove one real SDK read-only thread."]
  };
  writeJson(verifyPath, verify);
  process.stdout.write(`${JSON.stringify(verify, null, 2)}\n`);
  process.exitCode = verify.status === "PASS" ? 0 : 2;
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
