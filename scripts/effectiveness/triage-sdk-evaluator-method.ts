import { createHash } from "node:crypto";
import { resolve } from "node:path";

import { FEATURE_EVALUATOR_PARITY_PROMPT } from "../../src/effectiveness/feature-evaluator-stage.ts";
import { readJson, writeJson, writeMarkdown } from "./io.ts";
import type { EvaluatorCliParityResult } from "./parse-feature-evaluator-cli-parity.ts";
import type { FeatureEvaluatorParityTimeoutTriage } from "./triage-feature-evaluator-parity-timeout.ts";
import type { FeatureEvaluatorSmokeResult } from "./run-feature-evaluator-smoke.ts";

export interface SdkEvaluatorMethodTriage {
  case_id: "feature-small-001";
  cli_parity_status: "PASS" | "FAIL" | "NO_INPUT" | "NOT_RUN";
  sdk_parity_previous_status: "PASS" | "FAIL" | "BLOCKED" | "NOT_RUN";
  likely_failure: "" | "SDK_EVALUATOR_ADAPTER_OR_EVENT_STREAM_ISSUE" | "CODEX_CLI_TARGET_REPO_SANDBOX_MODEL_OR_RUNTIME_ISSUE" | "CLI_PARITY_NOT_EXECUTED";
  sdk_method_previous: "" | "run" | "runStreamed";
  sdk_method_candidates: ["run", "runStreamed"];
  recommended_sdk_method_for_parity: "run";
  runstreamed_no_event_timeout_risk: boolean;
  target_repo: string;
  model: string;
  model_catalog_json: string;
  sqlite_home: string;
  prompt: typeof FEATURE_EVALUATOR_PARITY_PROMPT;
  prompt_hash: string;
  invocation_alignment_checked: boolean;
  invocation_diff_status: string;
  historical_role_invocation_diff_status: string;
  recommended_next_action: string;
}

const reportDir = "evals/effectiveness/reports/feature-small-001";

export function writeSdkEvaluatorMethodTriage(repoRoot = process.cwd()): SdkEvaluatorMethodTriage {
  const cli = readJson<EvaluatorCliParityResult | null>(resolve(repoRoot, reportDir, "evaluator-cli-parity-result.json"), null);
  const cliPrint = readJson<Record<string, unknown> | null>(resolve(repoRoot, reportDir, "evaluator-cli-parity-print.json"), null);
  const smoke = readJson<FeatureEvaluatorSmokeResult | null>(resolve(repoRoot, reportDir, "feature-evaluator-smoke-result.json"), null);
  const parity = readJson<FeatureEvaluatorParityTimeoutTriage | null>(resolve(repoRoot, reportDir, "feature-evaluator-parity-timeout-triage.json"), null);
  const invocationDiff = readJson<{ status?: string } | null>(resolve(repoRoot, reportDir, "feature-evaluator-parity-invocation-diff.json"), null);
  const sdkPreviousStatus = previousSdkStatus(smoke, parity);
  const cliAlignmentDiffs = cliSdkDiffs(cliPrint, parity);
  const triage: SdkEvaluatorMethodTriage = {
    case_id: "feature-small-001",
    cli_parity_status: cli?.status ?? "NOT_RUN",
    sdk_parity_previous_status: sdkPreviousStatus,
    likely_failure: cli?.likely_failure ?? "",
    sdk_method_previous: parity?.sdk_method ?? methodFromSmoke(smoke),
    sdk_method_candidates: ["run", "runStreamed"],
    recommended_sdk_method_for_parity: "run",
    runstreamed_no_event_timeout_risk: parity?.failure_category === "FEATURE_EVALUATOR_PARITY_TURN_NO_EVENT_TIMEOUT" &&
      (parity.sdk_method === "runStreamed" || methodFromSmoke(smoke) === "runStreamed"),
    target_repo: parity?.working_directory ?? "",
    model: parity?.model ?? "",
    model_catalog_json: parity?.model_catalog_json ?? "",
    sqlite_home: parity?.sqlite_home ?? "",
    prompt: FEATURE_EVALUATOR_PARITY_PROMPT,
    prompt_hash: createHash("sha256").update(FEATURE_EVALUATOR_PARITY_PROMPT).digest("hex"),
    invocation_alignment_checked: cliPrint !== null && parity !== null,
    invocation_diff_status: cliAlignmentDiffs.length === 0 ? "PASS" : "NEEDS_REVISION",
    historical_role_invocation_diff_status: invocationDiff?.status ?? "NOT_RUN",
    recommended_next_action: "Rerun evaluator SDK parity once with CODEX_LOOP_EVALUATOR_PARITY_SDK_METHOD=run. Do not run text-only or treatment unless parity passes."
  };
  writeJson(resolve(repoRoot, reportDir, "sdk-evaluator-method-triage.json"), triage);
  writeMarkdown(resolve(repoRoot, reportDir, "SDKEvaluatorMethodTriageReport.md"), renderReport(triage));
  return triage;
}

function previousSdkStatus(smoke: FeatureEvaluatorSmokeResult | null, parity: FeatureEvaluatorParityTimeoutTriage | null): SdkEvaluatorMethodTriage["sdk_parity_previous_status"] {
  if (smoke?.mode === "parity" && smoke.status === "PASS") return "PASS";
  if (parity?.failure_category || smoke?.mode === "parity" && smoke.status === "FAIL") return "FAIL";
  if (smoke?.status?.startsWith("BLOCKED_")) return "BLOCKED";
  return "NOT_RUN";
}

function methodFromSmoke(smoke: FeatureEvaluatorSmokeResult | null): "" | "run" | "runStreamed" {
  if (smoke?.sdk_method === "run" || smoke?.sdk_method === "runStreamed") return smoke.sdk_method;
  return "";
}

function cliSdkDiffs(cliPrint: Record<string, unknown> | null, parity: FeatureEvaluatorParityTimeoutTriage | null): string[] {
  if (!cliPrint || !parity) return [];
  const diffs: string[] = [];
  compare("target_repo", parity.working_directory, stringField(cliPrint, "target_repo"), diffs);
  compare("sqlite_home", parity.sqlite_home, stringField(cliPrint, "sqlite_home"), diffs);
  compare("model", parity.model, stringField(cliPrint, "model"), diffs);
  compare("model_catalog_json", parity.model_catalog_json, stringField(cliPrint, "model_catalog_json"), diffs);
  compare("prompt", parity.prompt, stringField(cliPrint, "prompt"), diffs);
  return diffs;
}

function compare(field: string, actual: string, expected: string, diffs: string[]): void {
  if (expected && actual !== expected) diffs.push(field);
}

function stringField(value: unknown, key: string): string {
  return isRecord(value) && typeof value[key] === "string" ? value[key] : "";
}

function renderReport(triage: SdkEvaluatorMethodTriage): string {
  return [
    "# SDK Evaluator Method Triage",
    "",
    `Case: ${triage.case_id}`,
    `CLI parity status: ${triage.cli_parity_status}`,
    `Previous SDK parity status: ${triage.sdk_parity_previous_status}`,
    `Likely failure: ${triage.likely_failure || "none"}`,
    `Previous SDK method: ${triage.sdk_method_previous || "unknown"}`,
    `Recommended parity method: ${triage.recommended_sdk_method_for_parity}`,
    `runStreamed no-event timeout risk: ${triage.runstreamed_no_event_timeout_risk}`,
    `Invocation alignment checked: ${triage.invocation_alignment_checked}`,
    `CLI/SDK invocation diff status: ${triage.invocation_diff_status}`,
    `Historical role invocation diff status: ${triage.historical_role_invocation_diff_status}`,
    "",
    "## Invocation",
    `Target repo: ${triage.target_repo}`,
    `Model: ${triage.model}`,
    `Model catalog JSON: ${triage.model_catalog_json}`,
    `SQLite home: ${triage.sqlite_home}`,
    `Prompt: ${triage.prompt}`,
    "",
    "## Next Action",
    triage.recommended_next_action,
    "",
    "This report is generated from existing evidence only. It does not start SDK threads or Codex CLI.",
    ""
  ].join("\n");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const triage = writeSdkEvaluatorMethodTriage();
  process.stdout.write(`${JSON.stringify(triage, null, 2)}\n`);
}
