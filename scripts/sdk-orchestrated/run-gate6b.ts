import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const repoRoot = process.cwd();
const reportsDir = resolve(repoRoot, "evals/sdk-orchestrated/reports");
const resultPath = resolve(reportsDir, "gate6b-result.json");

function main(): void {
  const enabled = process.env.CODEX_LOOP_ENABLE_REAL_SDK_RUN === "1";
  const result = enabled
    ? {
        gate: "Gate 6B SDK-Orchestrated Mode",
        status: "BLOCKED_SDK_NOT_INSTALLED",
        real_sdk_run_executed: false,
        sdk_thread_runs: [],
        m12_blocked: true,
        errors: [
          "Gate 6B.0 ships an adapter skeleton only. Real SDK execution is reserved for Gate 6B.1 after review.",
          "@openai/codex-sdk is not installed or not wired for real thread execution."
        ]
      }
    : {
        gate: "Gate 6B SDK-Orchestrated Mode",
        status: "BLOCKED_SDK_NOT_ENABLED",
        real_sdk_run_executed: false,
        sdk_thread_runs: [],
        m12_blocked: true,
        errors: ["Set CODEX_LOOP_ENABLE_REAL_SDK_RUN=1 only in a controlled host terminal for Gate 6B.1."]
      };

  writeJson(resultPath, result);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

main();
