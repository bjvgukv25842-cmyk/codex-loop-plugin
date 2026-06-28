import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const repoRoot = process.cwd();
const reportDir = process.env.CODEX_LOOP_SDK_STARTUP_TRIAGE_DIR
  ? resolve(process.env.CODEX_LOOP_SDK_STARTUP_TRIAGE_DIR)
  : resolve(repoRoot, "evals/sdk-orchestrated/reports/sdk-startup-triage");
const resultPath = resolve(reportDir, "evaluator-smoke-result.json");
const verifyPath = resolve(reportDir, "evaluator-smoke-verify.json");

function main(): void {
  const result = readJson(resultPath);
  const dryRunOk = result.status === "BLOCKED_SDK_EVALUATOR_NOT_ENABLED" && result.real_sdk_run_attempted === false;
  const passOk =
    result.status === "PASS" &&
    result.evaluator_thread_started === true &&
    typeof result.evaluator_thread_id === "string" &&
    result.evaluator_thread_id.length > 0;
  const verify = {
    status: dryRunOk || passOk ? "PASS" : "NEEDS_REVISION",
    mode: typeof result.mode === "string" ? result.mode : "parity",
    dry_run_status: typeof result.status === "string" ? result.status : "NOT_RUN",
    real_sdk_run_executed: result.real_sdk_run_attempted === true,
    evaluator_stage_shared: result.mode === "output-lite" ? result.evaluator_stage_shared === true : true,
    evaluator_stage_impl: typeof result.evaluator_stage_impl === "string" ? result.evaluator_stage_impl : "",
    full_eval_report_schema_in_output_schema: result.full_eval_report_schema_in_output_schema === true,
    ready_for_one_real_evaluator_parity_smoke: dryRunOk && result.sdk_dependency_detected === true,
    ready_for_evaluator_text_only_smoke: evaluatorModePassed("parity"),
    ready_for_evaluator_output_minimal_smoke: evaluatorModePassed("parity") && evaluatorModePassed("text-only"),
    ready_for_evaluator_output_lite_smoke: evaluatorModePassed("parity") && evaluatorModePassed("text-only") && evaluatorModePassed("output-minimal"),
    ready_for_checkpoint_evaluator_retry: allEvaluatorModesPassed(),
    evaluator_smoke_gate_passed: allEvaluatorModesPassed(),
    failure_category: typeof result.failure_category === "string" ? result.failure_category : "",
    errors: dryRunOk || passOk ? [] : ["Evaluator smoke must either dry-run safely or prove one evaluator SDK slice."]
  };
  writeJson(verifyPath, verify);
  process.stdout.write(`${JSON.stringify(verify, null, 2)}\n`);
  process.exitCode = verify.status === "PASS" ? 0 : 2;
}

function allEvaluatorModesPassed(): boolean {
  return ["parity", "text-only", "output-minimal", "output-lite"].every(evaluatorModePassed);
}

function evaluatorModePassed(mode: string): boolean {
  const result = readJson(resolve(reportDir, `evaluator-smoke-${mode}-result.json`));
  const basePass = result.status === "PASS" && result.evaluator_thread_started === true && typeof result.evaluator_thread_id === "string" && result.evaluator_thread_id.length > 0;
  if (!basePass) return false;
  if (mode === "parity" || mode === "text-only" || mode === "output-minimal") {
    return result.final_response_contains_expected === true;
  }
  return result.evaluator_stage_shared === true && result.eval_report_created === true && result.eval_verdict === "PASS" && result.artifact_thread_evidence_verified === true;
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
