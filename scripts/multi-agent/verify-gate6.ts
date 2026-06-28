import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

interface StepResult {
  name: string;
  command: string;
  exit_code: number | null;
  stdout: string;
  stderr: string;
}

const repoRoot = process.cwd();
const reportsDir = resolve(repoRoot, "evals/multi-agent/reports");
const summaryPath = resolve(reportsDir, "gate6-verify-summary.json");

const steps = [
  ["gate6:parse", "node", ["scripts/multi-agent/parse-subagent-events.ts"]],
  ["gate6:verify-agent-runs", "node", ["scripts/multi-agent/verify-agent-runs.ts"]],
  ["gate6:verify-cross-agent-state", "node", ["scripts/multi-agent/verify-cross-agent-state.ts"]],
  ["gate6:report", "node", ["scripts/multi-agent/generate-gate6-report.ts"]]
] as const;

function main(): void {
  const results: StepResult[] = [];
  for (const [name, command, args] of steps) {
    const result = spawnSync(command, args, {
      cwd: repoRoot,
      encoding: "utf8"
    });
    results.push({
      name,
      command: [command, ...args].join(" "),
      exit_code: result.status,
      stdout: result.stdout,
      stderr: result.stderr
    });
  }

  mkdirSync(dirname(summaryPath), { recursive: true });
  writeFileSync(summaryPath, `${JSON.stringify({ steps: results }, null, 2)}\n`, "utf8");

  const reportStep = results.at(-1);
  process.exitCode = reportStep?.exit_code === 0 ? 0 : 2;
}

main();
