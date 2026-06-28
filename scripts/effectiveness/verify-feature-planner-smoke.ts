import { resolve } from "node:path";

import { readJson, writeJson } from "./io.ts";
import type { FeaturePlannerSmokeResult } from "./run-feature-planner-smoke.ts";

export interface FeaturePlannerSmokeVerifyResult {
  status: "PASS" | "NEEDS_REVISION";
  dry_run_status: string;
  mode: string;
  real_sdk_run_executed: boolean;
  planner_thread_started: boolean;
  structured_output_valid: boolean;
  no_task_graph_json: boolean;
  sdk_dependency_detected: boolean;
  sdk_dynamic_import_ok: boolean;
  codex_sdk_version: string;
  ready_for_one_feature_planner_parity_smoke: boolean;
  ready_for_feature_treatment_fresh_rerun: boolean;
  failure_category: string;
  errors: string[];
}

const resultPath = "evals/effectiveness/reports/feature-small-001/feature-planner-smoke-result.json";
const verifyPath = "evals/effectiveness/reports/feature-small-001/feature-planner-smoke-verify.json";

export function verifyFeaturePlannerSmoke(repoRoot = process.cwd()): FeaturePlannerSmokeVerifyResult {
  const result = readJson<FeaturePlannerSmokeResult | null>(resolve(repoRoot, resultPath), null);
  const blockedOk = result?.status === "BLOCKED_FEATURE_PLANNER_SMOKE_NOT_ENABLED" && result.real_sdk_run_executed === false;
  const passOk = result?.status === "PASS" &&
    result.planner_thread_started === true &&
    result.structured_output_valid === true &&
    result.no_task_graph_json === true &&
    result.artifact_thread_evidence_verified === true;
  const verify: FeaturePlannerSmokeVerifyResult = {
    status: blockedOk || passOk ? "PASS" : "NEEDS_REVISION",
    dry_run_status: result?.status ?? "NOT_RUN",
    mode: result?.mode ?? "",
    real_sdk_run_executed: result?.real_sdk_run_executed === true,
    planner_thread_started: result?.planner_thread_started === true,
    structured_output_valid: result?.structured_output_valid === true,
    no_task_graph_json: result?.no_task_graph_json !== false,
    sdk_dependency_detected: result?.sdk_diagnosis?.codex_named_export_available === true,
    sdk_dynamic_import_ok: result?.sdk_diagnosis?.dynamic_import_codex_sdk_ok === true,
    codex_sdk_version: result?.sdk_diagnosis?.codex_sdk_version ?? "",
    ready_for_one_feature_planner_parity_smoke: blockedOk,
    ready_for_feature_treatment_fresh_rerun: result?.ready_for_feature_treatment_fresh_rerun === true,
    failure_category: result?.failure_category ?? "",
    errors: blockedOk || passOk ? [] : ["Feature planner smoke did not produce a safe blocked state or valid planner evidence."]
  };
  writeJson(resolve(repoRoot, verifyPath), verify);
  return verify;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = verifyFeaturePlannerSmoke();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.status === "PASS" ? 0 : 2;
}
