import { resolve } from "node:path";

import { reconstructFeatureEvaluatorSmokeReadiness } from "../../src/effectiveness/feature-evaluator-smoke-readiness.ts";
import { readJson, writeMarkdown } from "./io.ts";
import type { FeatureEvaluatorSmokeResult } from "./run-feature-evaluator-smoke.ts";
import { diffFeatureEvaluatorParityInvocation } from "./diff-feature-evaluator-parity-invocation.ts";
import { writeFeatureEvaluatorParityTimeoutTriage } from "./triage-feature-evaluator-parity-timeout.ts";
import { writeFeatureEvaluatorTimeoutTriage } from "./triage-feature-evaluator-timeout.ts";
import { writeSdkEvaluatorMethodTriage } from "./triage-sdk-evaluator-method.ts";
import type { FeatureEvaluatorSmokeVerifyResult } from "./verify-feature-evaluator-smoke.ts";

const reportDir = "evals/effectiveness/reports/feature-small-001";

export function reportFeatureEvaluatorSmoke(repoRoot = process.cwd()): FeatureEvaluatorSmokeResult | null {
  const result = readJson<FeatureEvaluatorSmokeResult | null>(resolve(repoRoot, reportDir, "feature-evaluator-smoke-result.json"), null);
  const verify = readJson<FeatureEvaluatorSmokeVerifyResult | null>(resolve(repoRoot, reportDir, "feature-evaluator-smoke-verify.json"), null);
  const triage = writeFeatureEvaluatorTimeoutTriage(repoRoot);
  const parityTriage = writeFeatureEvaluatorParityTimeoutTriage(repoRoot);
  const invocationDiff = diffFeatureEvaluatorParityInvocation(repoRoot);
  const methodTriage = writeSdkEvaluatorMethodTriage(repoRoot);
  const readiness = reconstructFeatureEvaluatorSmokeReadiness(repoRoot, { write: true });
  const oldParitySuperseded = readiness.parity.status === "PASS";
  const lines = [
    "# Feature Evaluator Smoke Report",
    "",
    `Smoke status: ${result?.status ?? "NOT_RUN"}`,
    `Verify status: ${verify?.status ?? "NOT_RUN"}`,
    `Mode: ${result?.mode ?? ""}`,
    `Real SDK run executed: ${String(result?.real_sdk_run_executed === true)}`,
    `Evaluator thread started: ${String(result?.evaluator_thread_started === true)}`,
    `Evaluator thread id: ${result?.evaluator_thread_id ?? ""}`,
    `Structured output valid: ${String(result?.structured_output_valid === true)}`,
    `Eval report created: ${String(result?.eval_report_created === true)}`,
    `Eval verdict: ${result?.eval_verdict ?? ""}`,
    `Output schema kind: ${result?.output_schema_kind ?? ""}`,
    `Uses evaluator-lite schema: ${String(result?.uses_evaluator_lite_schema === true)}`,
    `Uses full EvalReport schema: ${String(Boolean(result?.uses_full_eval_report_schema))}`,
    `Evaluator prompt length: ${String(result?.evaluator_prompt_length ?? 0)}`,
    `Failure category: ${result?.failure_category ?? ""}`,
    `Evaluator parity category: ${parityTriage.failure_category}`,
    `Evaluator parity event count: ${parityTriage.event_count}`,
    `Evaluator parity last event type: ${parityTriage.last_event_type}`,
    `Evaluator parity SDK method: ${result?.sdk_method ?? methodTriage.sdk_method_previous}`,
    `Recommended parity SDK method: ${methodTriage.recommended_sdk_method_for_parity}`,
    `Evaluator CLI/SDK parity invocation status: ${methodTriage.invocation_diff_status}`,
    `Old parity timeout triage superseded: ${oldParitySuperseded ? "superseded_by_sdk_method_run_parity_pass" : "false"}`,
    `Historical evaluator/planner/dev invocation diff status: ${invocationDiff.status}`,
    `Historical evaluator/planner/dev critical diffs: ${invocationDiff.critical_diffs.length > 0 ? invocationDiff.critical_diffs.join(", ") : "none"}`,
    `Current evaluator timeout category: ${triage.failure_category}`,
    `Historical evaluator event count: ${triage.event_count}`,
    `Historical evaluator last event type: ${triage.last_event_type}`,
    "",
    "## SDK Diagnosis",
    `package.json declares SDK: ${String(result?.sdk_diagnosis?.package_json_has_codex_sdk === true)}`,
    `package-lock includes SDK: ${String(result?.sdk_diagnosis?.package_lock_has_codex_sdk === true)}`,
    `npm/resolve sees SDK: ${String(result?.sdk_diagnosis?.npm_ls_codex_sdk_ok === true)}`,
    `dynamic import ok: ${String(result?.sdk_diagnosis?.dynamic_import_codex_sdk_ok === true)}`,
    `Codex export available: ${String(result?.sdk_diagnosis?.codex_named_export_available === true)}`,
    `SDK version: ${result?.sdk_diagnosis?.codex_sdk_version ?? ""}`,
    `SDK failure category: ${result?.sdk_diagnosis?.failure_category ?? ""}`,
    `SDK method likely failure: ${methodTriage.likely_failure || "none"}`,
    "",
    "## Readiness State",
    `parity: ${readiness.parity.status}`,
    `text-only: ${readiness.text_only.status}`,
    `output-minimal: ${readiness.output_minimal.status}`,
    `output-lite: ${readiness.output_lite.status}`,
    `exact: ${readiness.exact.status}`,
    `ready_for_output_minimal: ${String(readiness.ready_for_output_minimal)}`,
    `ready_for_output_lite: ${String(readiness.ready_for_output_lite)}`,
    `ready_for_exact: ${String(readiness.ready_for_exact)}`,
    `ready_for_treatment_rerun: ${String(readiness.ready_for_treatment_rerun)}`,
    `readiness reconstruction status: ${readiness.reconstruction_status}`,
    ...(readiness.blocked_attempt
      ? [
          `blocked_attempt.mode: ${readiness.blocked_attempt.mode}`,
          `blocked_attempt.status: ${readiness.blocked_attempt.status}`,
          `blocked_attempt.reason: ${readiness.blocked_attempt.reason}`
        ]
      : ["blocked_attempt: none"]),
    "",
    "## Required Smoke Order",
    "- parity",
    "- text-only",
    "- output-minimal",
    "- output-lite",
    "- exact",
    "",
    "Only after all five real evaluator-only smokes pass may one approved feature-small-001 treatment fresh rerun be considered.",
    "M12 production ready: false",
    ""
  ];
  writeMarkdown(resolve(repoRoot, reportDir, "FeatureEvaluatorSmokeReport.md"), `${lines.join("\n")}\n`);
  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = reportFeatureEvaluatorSmoke();
  process.stdout.write(`${JSON.stringify(result ?? { status: "NOT_RUN" }, null, 2)}\n`);
}
