import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { FEATURE_EVALUATOR_PARITY_PROMPT } from "../../src/effectiveness/feature-evaluator-stage.ts";

const repoRoot = process.cwd();

export interface FeatureEvaluatorCliParityPrintResult {
  module: "M12.2H.1 Feature Evaluator CLI Parity Print";
  status: "PRINT_ONLY";
  executed: false;
  target_repo_exists: boolean;
  target_repo: string;
  sqlite_home: string;
  model: string;
  model_catalog_json: string;
  prompt: typeof FEATURE_EVALUATOR_PARITY_PROMPT;
  events_path: string;
  stderr_path: string;
  command: string;
}

export function printFeatureEvaluatorCliParity(root = repoRoot, env: NodeJS.ProcessEnv = process.env): FeatureEvaluatorCliParityPrintResult {
  const reportDir = resolve(root, "evals/effectiveness/reports/feature-small-001");
  const targetRepo = resolve(root, "evals/effectiveness/runs/feature-small-001/treatment/target-repo");
  const sqliteHome = resolve(root, ".codex-eval/sqlite");
  const modelCatalogJson = env.CODEX_LOOP_MODEL_CATALOG_JSON
    ? resolve(env.CODEX_LOOP_MODEL_CATALOG_JSON)
    : resolve(root, "evals/sdk-orchestrated/model-catalog-bundled.json");
  const model = env.CODEX_LOOP_CODEX_MODEL || "gpt-5.5";
  const eventsPath = resolve(reportDir, "evaluator-cli-parity-events.jsonl");
  const stderrPath = resolve(reportDir, "evaluator-cli-parity-stderr.log");
  mkdirSync(reportDir, { recursive: true });
  const command = [
    "cd",
    shellQuote(targetRepo),
    "&&",
    `CODEX_SQLITE_HOME=${shellQuote(sqliteHome)}`,
    "codex",
    "exec",
    "--json",
    "--sandbox",
    "read-only",
    "-m",
    shellQuote(model),
    "-c",
    shellQuote(`sqlite_home="${sqliteHome}"`),
    "-c",
    shellQuote(`model_catalog_json="${modelCatalogJson}"`),
    shellQuote(FEATURE_EVALUATOR_PARITY_PROMPT),
    ">",
    shellQuote(eventsPath),
    "2>",
    shellQuote(stderrPath)
  ].join(" ");
  const result = {
    module: "M12.2H.1 Feature Evaluator CLI Parity Print",
    status: "PRINT_ONLY",
    executed: false,
    target_repo_exists: existsSync(targetRepo),
    target_repo: targetRepo,
    sqlite_home: sqliteHome,
    model,
    model_catalog_json: modelCatalogJson,
    prompt: FEATURE_EVALUATOR_PARITY_PROMPT,
    events_path: eventsPath,
    stderr_path: stderrPath,
    command
  } satisfies FeatureEvaluatorCliParityPrintResult;
  const outputPath = resolve(reportDir, "evaluator-cli-parity-print.json");
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  return result;
}

function main(): void {
  const result = printFeatureEvaluatorCliParity();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
