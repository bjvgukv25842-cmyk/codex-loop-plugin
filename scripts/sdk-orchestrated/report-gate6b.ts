import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const repoRoot = process.cwd();
const resultPath = resolve(repoRoot, "evals/sdk-orchestrated/reports/gate6b-result.json");
const verifyPath = resolve(repoRoot, "evals/sdk-orchestrated/reports/gate6b-verify.json");
const reportPath = resolve(repoRoot, "evals/sdk-orchestrated/reports/Gate6B_SDK_Orchestrated_Report.md");

function main(): void {
  const result = readJson(resultPath);
  const verify = readJson(verifyPath);
  const lines = [
    "# Gate 6B SDK-Orchestrated Mode Report",
    "",
    "Date: 2026-06-20",
    "",
    `Run status: ${String(result.status ?? "NOT_RUN")}`,
    `Verify status: ${String(verify.status ?? "NOT_RUN")}`,
    `Real SDK run executed: ${String(result.real_sdk_run_executed === true)}`,
    `M12 blocked: ${String(result.m12_blocked !== false)}`,
    "",
    "Gate 6B.0 is an adapter skeleton and planning gate. It does not execute real SDK threads and must not be used as Gate 6B PASS evidence.",
    ""
  ];
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${lines.join("\n")}\n`, "utf8");
}

function readJson(path: string): Record<string, unknown> {
  if (!existsSync(path)) {
    return {};
  }
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

main();
