import { resolve } from "node:path";

import { readJson, writeMarkdown } from "./io.ts";
import type { FeaturePlannerSmokeResult } from "./run-feature-planner-smoke.ts";
import type { FeaturePlannerSmokeVerifyResult } from "./verify-feature-planner-smoke.ts";

const reportDir = "evals/effectiveness/reports/feature-small-001";

export function reportFeaturePlannerSmoke(repoRoot = process.cwd()): FeaturePlannerSmokeResult | null {
  const result = readJson<FeaturePlannerSmokeResult | null>(resolve(repoRoot, reportDir, "feature-planner-smoke-result.json"), null);
  const verify = readJson<FeaturePlannerSmokeVerifyResult | null>(resolve(repoRoot, reportDir, "feature-planner-smoke-verify.json"), null);
  const lines = [
    "# Feature Planner Smoke Report",
    "",
    `Smoke status: ${result?.status ?? "NOT_RUN"}`,
    `Verify status: ${verify?.status ?? "NOT_RUN"}`,
    `Mode: ${result?.mode ?? ""}`,
    `Real SDK run executed: ${String(result?.real_sdk_run_executed === true)}`,
    `Planner thread started: ${String(result?.planner_thread_started === true)}`,
    `Planner thread id: ${result?.planner_thread_id ?? ""}`,
    `Structured output valid: ${String(result?.structured_output_valid === true)}`,
    `Tasks count: ${String(result?.tasks_count ?? 0)}`,
    `No task_graph_json: ${String(result?.no_task_graph_json !== false)}`,
    `Failure category: ${result?.failure_category ?? ""}`,
    "",
    "## SDK Diagnosis",
    `package.json declares SDK: ${String(result?.sdk_diagnosis?.package_json_has_codex_sdk === true)}`,
    `package-lock includes SDK: ${String(result?.sdk_diagnosis?.package_lock_has_codex_sdk === true)}`,
    `npm/resolve sees SDK: ${String(result?.sdk_diagnosis?.npm_ls_codex_sdk_ok === true)}`,
    `dynamic import ok: ${String(result?.sdk_diagnosis?.dynamic_import_codex_sdk_ok === true)}`,
    `Codex export available: ${String(result?.sdk_diagnosis?.codex_named_export_available === true)}`,
    `SDK version: ${result?.sdk_diagnosis?.codex_sdk_version ?? ""}`,
    `SDK export keys: ${(result?.sdk_diagnosis?.codex_sdk_export_keys ?? []).join(", ")}`,
    `SDK failure category: ${result?.sdk_diagnosis?.failure_category ?? ""}`,
    `Ready for feature treatment fresh rerun: ${String(result?.ready_for_feature_treatment_fresh_rerun === true)}`,
    "M12 production ready: false",
    "",
    "## Required Smoke Order",
    "- parity",
    "- lite-minimal",
    "- exact",
    "",
    "Only after all three real planner-only smokes pass may one approved feature-small-001 treatment fresh rerun be considered.",
    ""
  ];
  writeMarkdown(resolve(repoRoot, reportDir, "FeaturePlannerSmokeReport.md"), `${lines.join("\n")}\n`);
  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = reportFeaturePlannerSmoke();
  process.stdout.write(`${JSON.stringify(result ?? { status: "NOT_RUN" }, null, 2)}\n`);
}
