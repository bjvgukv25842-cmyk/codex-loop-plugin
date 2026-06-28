import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const repoRoot = process.cwd();
const reportsDir = resolve(repoRoot, "evals/multi-agent/reports");
const resultPath = resolve(reportsDir, "gate6-2-lite-result.json");
const reportPath = resolve(reportsDir, "Gate6_2_Lite_Report.md");

function main(): void {
  const result = readJsonObject(resultPath);
  const status = readString(result, "status") || "NOT_RUN";
  const markdown = `# Gate 6.2-Lite Repair Continuation

Date: 2026-06-19

Verdict: ${status}

Gate 6.2-Lite is a timeboxed continuation probe. It starts from a prepared \`NEEDS_REVISION\` EvalReport and schema-valid RepairRequest, then verifies only the repair worker and final evaluator slice.

This probe deliberately does not run full Gate 6, planner validation, M12, or multiple real Codex executions.

## Runtime Budget

- Overall budget: 1800000 ms
- Single \`codex exec\` budget: 180000 ms
- No-event timeout: 60000 ms
- Max \`codex exec\` runs: 1
- Max retries: 0
- Full Gate 6 run allowed: false

## Result

\`\`\`json
${JSON.stringify(result, null, 2)}
\`\`\`

## Required Manual Next Step

Run one budgeted continuation probe only when explicitly approved:

\`\`\`bash
npm run gate6:lite:run
npm run gate6:lite:verify
npm run gate6:lite:report
\`\`\`

Do not run \`npm run gate6:run\` as part of Gate 6.2-Lite.
`;
  writeText(reportPath, markdown);
}

function readJsonObject(path: string): Record<string, unknown> {
  if (!existsSync(path)) {
    return {};
  }
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  return isRecord(parsed) ? parsed : {};
}

function readString(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  return typeof value === "string" ? value : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function writeText(path: string, value: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value, "utf8");
}

main();

