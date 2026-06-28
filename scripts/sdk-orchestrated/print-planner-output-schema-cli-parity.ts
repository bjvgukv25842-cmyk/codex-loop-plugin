import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { plannerLiteOutputSchema } from "../../src/orchestrator/planner-lite-output.ts";

const repoRoot = process.cwd();
const reportDir = process.env.CODEX_LOOP_SDK_STARTUP_TRIAGE_DIR
  ? resolve(process.env.CODEX_LOOP_SDK_STARTUP_TRIAGE_DIR)
  : resolve(repoRoot, "evals/sdk-orchestrated/reports/sdk-startup-triage");
const targetRepo = resolve(repoRoot, "tmp/sdk-orchestrated/gate6b-smoke-target");
const prompt = 'Return only this JSON object: { "status": "PASS", "message": "SDK_PLANNER_OUTPUT_MINIMAL_OK" }';
const minimalSchemaPath = resolve(reportDir, "planner-output-schema-cli-minimal.schema.json");
const liteSchemaPath = resolve(reportDir, "planner-output-schema-cli-lite.schema.json");
const plannerSchemaPath = resolve(reportDir, "planner-output-schema-cli-planner.schema.json");

const minimalSchema = {
  type: "object",
  properties: {
    status: { type: "string", enum: ["PASS"] },
    message: { type: "string" }
  },
  required: ["status", "message"],
  additionalProperties: false
};

function main(): void {
  mkdirSync(dirname(minimalSchemaPath), { recursive: true });
  writeFileSync(minimalSchemaPath, `${JSON.stringify(minimalSchema, null, 2)}\n`, "utf8");
  writeFileSync(liteSchemaPath, `${JSON.stringify(plannerLiteOutputSchema, null, 2)}\n`, "utf8");
  writeFileSync(plannerSchemaPath, `${JSON.stringify(plannerSchema(), null, 2)}\n`, "utf8");
  const noOutputSchemaCommand = [
    "cd",
    shellQuote(targetRepo),
    "&&",
    "codex",
    "exec",
    "--json",
    "--sandbox",
    "read-only",
    shellQuote(prompt)
  ].join(" ");
  const outputSchemaMinimalCommand = [
    "cd",
    shellQuote(targetRepo),
    "&&",
    "codex",
    "exec",
    "--json",
    "--sandbox",
    "read-only",
    "--output-schema",
    shellQuote(minimalSchemaPath),
    shellQuote(prompt)
  ].join(" ");
  const outputSchemaLiteCommand = [
    "cd",
    shellQuote(targetRepo),
    "&&",
    "codex",
    "exec",
    "--json",
    "--sandbox",
    "read-only",
    "--output-schema",
    shellQuote(liteSchemaPath),
    shellQuote("Return JSON matching the planner-lite output schema.")
  ].join(" ");
  const outputSchemaPlannerCommand = [
    "cd",
    shellQuote(targetRepo),
    "&&",
    "codex",
    "exec",
    "--json",
    "--sandbox",
    "read-only",
    "--output-schema",
    shellQuote(plannerSchemaPath),
    shellQuote("Return JSON matching the full planner output schema.")
  ].join(" ");
  const result = {
    gate: "Gate 6B.1H Planner Schema OutputSchema CLI Parity",
    status: "PRINT_ONLY",
    executed: false,
    target_repo_exists: existsSync(targetRepo),
    minimal_schema_path: minimalSchemaPath,
    lite_schema_path: liteSchemaPath,
    planner_schema_path: plannerSchemaPath,
    commands: {
      no_output_schema: noOutputSchemaCommand,
      output_schema_minimal: outputSchemaMinimalCommand,
      output_schema_lite: outputSchemaLiteCommand,
      output_schema_planner: outputSchemaPlannerCommand
    }
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function plannerSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      status: { const: "PASS" },
      role: { const: "planner" },
      prd: { type: "object" },
      task_graph: { type: "object" },
      acceptance_criteria: { type: "array" },
      risks: { type: "array" }
    },
    required: ["status", "role", "prd", "task_graph", "acceptance_criteria", "risks"],
    additionalProperties: true
  };
}

main();
