import { resolve } from "node:path";

import { reconstructFeatureEvaluatorSmokeReadiness } from "../../src/effectiveness/feature-evaluator-smoke-readiness.ts";
import { readJson, writeJson } from "./io.ts";
import type { FeatureEvaluatorSmokeResult } from "./run-feature-evaluator-smoke.ts";

export interface FeatureEvaluatorSmokeVerifyResult {
  status: "PASS" | "NEEDS_REVISION";
  dry_run_status: string;
  mode: string;
  real_sdk_run_executed: boolean;
  evaluator_thread_started: boolean;
  structured_output_valid: boolean;
  eval_report_created: boolean;
  eval_verdict: string;
  uses_evaluator_lite_schema: boolean;
  uses_full_eval_report_schema: boolean;
  sdk_dependency_detected: boolean;
  sdk_dynamic_import_ok: boolean;
  codex_sdk_version: string;
  sdk_method: string;
  ready_for_one_feature_evaluator_parity_smoke: boolean;
  ready_for_next_evaluator_smoke: boolean;
  ready_for_feature_treatment_fresh_rerun: boolean;
  ready_for_output_minimal: boolean;
  ready_for_output_lite: boolean;
  ready_for_exact: boolean;
  readiness_reconstruction_status: string;
  failure_category: string;
  errors: string[];
}

const resultPath = "evals/effectiveness/reports/feature-small-001/feature-evaluator-smoke-result.json";
const verifyPath = "evals/effectiveness/reports/feature-small-001/feature-evaluator-smoke-verify.json";

export function verifyFeatureEvaluatorSmoke(repoRoot = process.cwd()): FeatureEvaluatorSmokeVerifyResult {
  const result = readJson<FeatureEvaluatorSmokeResult | null>(resolve(repoRoot, resultPath), null);
  const readiness = reconstructFeatureEvaluatorSmokeReadiness(repoRoot, { write: true });
  const blockedOk = result?.status === "BLOCKED_FEATURE_EVALUATOR_SMOKE_NOT_ENABLED" && result.real_sdk_run_executed === false;
  const orderedBlockedOk = typeof result?.status === "string" &&
    result.status.startsWith("BLOCKED_EVALUATOR_") &&
    result.real_sdk_run_executed === false;
  const passOk = result?.status === "PASS" &&
    result.evaluator_thread_started === true &&
    result.structured_output_valid === true &&
    result.artifact_thread_evidence_verified === true &&
    result.uses_full_eval_report_schema === false;
  const verify: FeatureEvaluatorSmokeVerifyResult = {
    status: blockedOk || orderedBlockedOk || passOk ? "PASS" : "NEEDS_REVISION",
    dry_run_status: result?.status ?? "NOT_RUN",
    mode: result?.mode ?? "",
    real_sdk_run_executed: result?.real_sdk_run_executed === true,
    evaluator_thread_started: result?.evaluator_thread_started === true,
    structured_output_valid: result?.structured_output_valid === true,
    eval_report_created: result?.eval_report_created === true,
    eval_verdict: result?.eval_verdict ?? "",
    uses_evaluator_lite_schema: result?.uses_evaluator_lite_schema === true,
    uses_full_eval_report_schema: Boolean(result?.uses_full_eval_report_schema),
    sdk_dependency_detected: result?.sdk_diagnosis?.codex_named_export_available === true,
    sdk_dynamic_import_ok: result?.sdk_diagnosis?.dynamic_import_codex_sdk_ok === true,
    codex_sdk_version: result?.sdk_diagnosis?.codex_sdk_version ?? "",
    sdk_method: result?.sdk_method ?? "",
    ready_for_one_feature_evaluator_parity_smoke: blockedOk,
    ready_for_next_evaluator_smoke: passOk && result?.ready_for_next_evaluator_smoke === true,
    ready_for_feature_treatment_fresh_rerun: readiness.ready_for_treatment_rerun,
    ready_for_output_minimal: readiness.ready_for_output_minimal,
    ready_for_output_lite: readiness.ready_for_output_lite,
    ready_for_exact: readiness.ready_for_exact,
    readiness_reconstruction_status: readiness.reconstruction_status,
    failure_category: result?.failure_category ?? "",
    errors: blockedOk || orderedBlockedOk || passOk ? [] : ["Feature evaluator smoke did not produce a safe blocked state or valid evaluator evidence."]
  };
  writeJson(resolve(repoRoot, verifyPath), verify);
  return verify;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = verifyFeatureEvaluatorSmoke();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.status === "PASS" ? 0 : 2;
}
