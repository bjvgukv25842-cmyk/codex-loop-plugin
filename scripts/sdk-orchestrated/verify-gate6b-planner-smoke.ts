import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const repoRoot = process.cwd();
const reportDir = resolve(repoRoot, "evals/sdk-orchestrated/reports/sdk-startup-triage");
const resultPath = resolve(reportDir, "planner-smoke-result.json");
const verifyPath = resolve(reportDir, "planner-smoke-verify.json");

function main(): void {
  const result = readJson(resultPath);
  const dryRunOk = result.status === "BLOCKED_SDK_PLANNER_NOT_ENABLED" && result.real_sdk_run_attempted === false;
  const passOk =
    result.status === "PASS" &&
    result.planner_thread_started === true &&
    typeof result.planner_thread_id === "string" &&
    result.planner_thread_id.length > 0;
  const verify = {
    status: dryRunOk || passOk ? "PASS" : "NEEDS_REVISION",
    mode: typeof result.mode === "string" ? result.mode : "minimal",
    dry_run_status: typeof result.status === "string" ? result.status : "NOT_RUN",
    real_sdk_run_executed: result.real_sdk_run_attempted === true,
    planner_stage_shared: result.mode === "schema-output-lite" ? result.planner_stage_shared === true : true,
    planner_stage_impl: typeof result.planner_stage_impl === "string" ? result.planner_stage_impl : "",
    task_graph_schema_valid: result.mode === "schema-output-lite" ? result.task_graph_schema_valid === true : true,
    ready_for_one_real_planner_parity_as_planner_smoke: dryRunOk && result.sdk_dependency_detected === true,
    ready_for_one_real_planner_minimal_smoke: false,
    ready_for_schema_text_only_smoke: dryRunOk,
    ready_for_output_schema_minimal_smoke: false,
    ready_for_output_schema_planner_smoke: false,
    ready_for_one_real_planner_lite_smoke: dryRunOk,
    ready_for_gate6b_smoke: allPlannerModesPassed(),
    failure_category: typeof result.failure_category === "string" ? result.failure_category : "",
    errors:
      dryRunOk || passOk
        ? []
        : ["Planner smoke must either dry-run safely or prove one planner SDK slice."]
  };
  writeJson(verifyPath, verify);
  process.stdout.write(`${JSON.stringify(verify, null, 2)}\n`);
  process.exitCode = verify.status === "PASS" ? 0 : 2;
}

function allPlannerModesPassed(): boolean {
  return ["parity-as-planner", "minimal", "schema-text-only", "schema-output-minimal", "schema-output-lite"].every((mode) => {
    const result = readJson(resolve(reportDir, `planner-smoke-${mode}-result.json`));
    return result.status === "PASS" && result.planner_thread_started === true && (mode === "schema-output-lite" ? plannerLiteTaskGraphSchemaValid(result) : true);
  });
}

function plannerLiteTaskGraphSchemaValid(result: Record<string, unknown>): boolean {
  return (
    result.task_graph_schema_valid === true ||
    (result.structured_output_valid === true &&
      result.prd_artifact_created === true &&
      result.task_graph_artifact_created === true &&
      result.artifact_thread_evidence_verified === true)
  );
}

function readJson(path: string): Record<string, unknown> {
  const resolved = resolve(path);
  if (!existsSync(resolved)) return {};
  return JSON.parse(readFileSync(resolved, "utf8")) as Record<string, unknown>;
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

main();
