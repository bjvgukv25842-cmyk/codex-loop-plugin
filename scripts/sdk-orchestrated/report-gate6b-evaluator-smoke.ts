import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const repoRoot = process.cwd();
const reportDir = process.env.CODEX_LOOP_SDK_STARTUP_TRIAGE_DIR
  ? resolve(process.env.CODEX_LOOP_SDK_STARTUP_TRIAGE_DIR)
  : resolve(repoRoot, "evals/sdk-orchestrated/reports/sdk-startup-triage");
const resultPath = resolve(reportDir, "evaluator-smoke-result.json");
const verifyPath = resolve(reportDir, "evaluator-smoke-verify.json");
const reportPath = resolve(reportDir, "EvaluatorSmokeReport.md");

function main(): void {
  const result = readJson(resultPath);
  const verify = readJson(verifyPath);
  const lines = [
    "# Gate 6B.1M Evaluator Smoke Report",
    "",
    "Date: 2026-06-21",
    "",
    `Mode: ${String(result.mode ?? "parity")}`,
    `Run status: ${String(result.status ?? "NOT_RUN")}`,
    `Verify status: ${String(verify.status ?? "NOT_RUN")}`,
    `Real SDK run attempted: ${String(result.real_sdk_run_attempted === true)}`,
    `Evaluator thread started: ${String(result.evaluator_thread_started === true)}`,
    `Evaluator thread id: ${String(result.evaluator_thread_id ?? "")}`,
    `Structured output valid: ${String(result.structured_output_valid === true)}`,
    `Eval report created: ${String(result.eval_report_created === true)}`,
    `Eval verdict: ${String(result.eval_verdict ?? "")}`,
    `Artifact thread evidence verified: ${String(result.artifact_thread_evidence_verified === true)}`,
    `Evaluator stage shared: ${String(result.evaluator_stage_shared === true)}`,
    `Evaluator stage impl: ${String(result.evaluator_stage_impl ?? "")}`,
    `Full EvalReport schema in outputSchema: ${String(result.full_eval_report_schema_in_output_schema === true)}`,
    `Failure category: ${String(result.failure_category ?? "")}`,
    `Ready for checkpoint evaluator retry: ${String(verify.ready_for_checkpoint_evaluator_retry === true)}`,
    "M12 blocked: true",
    "",
    "Evaluator smoke slices must pass in order: parity, text-only, output-minimal, output-lite. The checkpoint evaluator must use evaluator-lite outputSchema plus Orchestrator-side EvalReport hydration.",
    ""
  ];
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${lines.join("\n")}\n`, "utf8");
}

function readJson(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  const text = readFileSync(path, "utf8").trim();
  if (!text) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return {};
  }
}

main();
