import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const repoRoot = process.cwd();
const resultPath = resolve(repoRoot, "evals/sdk-orchestrated/reports/gate6b-result.json");
const verifyPath = resolve(repoRoot, "evals/sdk-orchestrated/reports/gate6b-verify.json");

function main(): void {
  const result = existsSync(resultPath) ? JSON.parse(readFileSync(resultPath, "utf8")) as Record<string, unknown> : {};
  const validSkeleton =
    result.status === "BLOCKED_SDK_NOT_ENABLED" &&
    result.real_sdk_run_executed === false &&
    result.m12_blocked === true;
  const verify = {
    status: validSkeleton ? "PASS" : "NEEDS_REVISION",
    gate6b_run_status: typeof result.status === "string" ? result.status : "NOT_RUN",
    real_sdk_run_executed: result.real_sdk_run_executed === true,
    m12_blocked: result.m12_blocked === true,
    errors: validSkeleton ? [] : ["gate6b:run must default to BLOCKED_SDK_NOT_ENABLED without real SDK execution."]
  };
  writeJson(verifyPath, verify);
  process.stdout.write(`${JSON.stringify(verify, null, 2)}\n`);
  process.exitCode = verify.status === "PASS" ? 0 : 2;
}

function writeJson(path: string, value: unknown): void {
  writeFileSyncWithDir(path, `${JSON.stringify(value, null, 2)}\n`);
}

function writeFileSyncWithDir(path: string, value: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value, "utf8");
}

main();
