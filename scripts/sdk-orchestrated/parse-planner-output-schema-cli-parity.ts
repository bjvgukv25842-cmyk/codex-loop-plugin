import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const repoRoot = process.cwd();
const reportDir = process.env.CODEX_LOOP_SDK_STARTUP_TRIAGE_DIR
  ? resolve(process.env.CODEX_LOOP_SDK_STARTUP_TRIAGE_DIR)
  : resolve(repoRoot, "evals/sdk-orchestrated/reports/sdk-startup-triage");
const inputPath = resolve(reportDir, "planner-output-schema-cli-parity-result.json");
const outputPath = resolve(reportDir, "planner-output-schema-cli-parity-parse.json");

function main(): void {
  const input = readJson(inputPath);
  const noSchemaStatus = stringField(input.no_output_schema_status);
  const outputSchemaMinimalStatus = stringField(input.output_schema_minimal_status);
  const outputSchemaLiteStatus = stringField(input.output_schema_lite_status);
  const outputSchemaPlannerStatus = stringField(input.output_schema_planner_status);
  const parsed = {
    gate: "Gate 6B.1H Planner Schema OutputSchema CLI Parity Parse",
    status: noSchemaStatus || outputSchemaMinimalStatus || outputSchemaLiteStatus || outputSchemaPlannerStatus ? "PARSED" : "NO_INPUT",
    input_path: inputPath,
    no_output_schema_status: noSchemaStatus,
    output_schema_minimal_status: outputSchemaMinimalStatus,
    output_schema_lite_status: outputSchemaLiteStatus,
    output_schema_planner_status: outputSchemaPlannerStatus,
    interpretation: interpret(noSchemaStatus, outputSchemaMinimalStatus, outputSchemaLiteStatus, outputSchemaPlannerStatus)
  };
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(parsed, null, 2)}\n`);
}

function interpret(noSchemaStatus: string, outputSchemaMinimalStatus: string, outputSchemaLiteStatus: string, outputSchemaPlannerStatus: string): string {
  if (!noSchemaStatus && !outputSchemaMinimalStatus && !outputSchemaLiteStatus && !outputSchemaPlannerStatus) {
    return "No CLI parity result file was provided; this parser does not execute commands.";
  }
  if (outputSchemaLiteStatus === "PASS" && outputSchemaPlannerStatus !== "PASS") {
    return "CLI planner-lite output-schema works while full planner output-schema does not; use planner-lite and keep full validation in orchestrator post-processing.";
  }
  if (noSchemaStatus === "PASS" && outputSchemaMinimalStatus === "PASS" && outputSchemaLiteStatus === "PASS") {
    return "CLI output-schema path works for minimal and planner-lite schemas; SDK full planner schema should remain diagnostic only.";
  }
  if (noSchemaStatus === "PASS" && outputSchemaMinimalStatus !== "PASS") {
    return "CLI no-schema path works but CLI output-schema path fails; investigate Codex CLI/model/output-schema compatibility.";
  }
  return "CLI text-only path is not yet proven; fix CLI baseline before comparing SDK outputSchema.";
}

function readJson(path: string): Record<string, unknown> {
  if (!existsSync(path)) {
    return {};
  }
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value : "";
}

main();
