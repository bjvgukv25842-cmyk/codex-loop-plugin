import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { readJson, writeJson, writeMarkdown } from "./io.ts";
import type { M12RunResult } from "./types.ts";

interface PlannerTrace {
  trace_label?: string;
  target_repo?: string;
  target_repo_is_git?: boolean;
  constructor_options?: {
    config_values_redacted?: {
      sqlite_home?: string;
      model_catalog_json?: string;
      model?: string;
    };
  };
  start_thread_options?: {
    workingDirectory?: string;
    sandboxMode?: string;
    model?: string;
  };
  run_options?: {
    usesOutputSchema?: boolean;
    outputSchemaPath?: string;
    outputSchemaHash?: string;
    usesRunStreamed?: boolean;
  };
  prompt?: {
    length?: number;
    hash?: string;
  };
  sdk_api_method?: string;
  error_capture_paths?: Record<string, string>;
}

export interface FeaturePlannerInvocationDiffReport {
  case_id: "feature-small-001";
  status: "PASS" | "NEEDS_REVISION";
  failure_category: string;
  repair_loop_case_id: "repair-loop-001";
  fields: Record<string, { feature: unknown; repair_loop: unknown; same: boolean }>;
  critical_diffs: string[];
  uses_planner_lite_v2: boolean;
  uses_task_graph_json_string: boolean;
  feature_prompt_length: number;
  repair_loop_prompt_length: number;
  prompt_length_delta: number;
  recommended_fixes: string[];
}

const featureReportDir = "evals/effectiveness/reports/feature-small-001";
const repairReportDir = "evals/effectiveness/reports/repair-loop-001";

export function diffFeaturePlannerVsRepairPlanner(repoRoot = process.cwd()): FeaturePlannerInvocationDiffReport {
  const featureTrace = readTrace(resolve(repoRoot, featureReportDir, "sdk-stage-logs/generic-planner-invocation-trace-redacted.json"));
  const repairTrace = readTrace(resolve(repoRoot, repairReportDir, "sdk-stage-logs/gate6b2-planner-invocation-trace-redacted.json"));
  const featureSchemaTrace = readJson<Record<string, unknown>>(resolve(repoRoot, featureReportDir, "sdk-stage-logs/planner-schema-invocation-trace-redacted.json"), {});
  const repairSchemaTrace = readJson<Record<string, unknown>>(resolve(repoRoot, repairReportDir, "sdk-stage-logs/planner-schema-invocation-trace-redacted.json"), {});
  const featureResult = readJson<M12RunResult | null>(resolve(repoRoot, featureReportDir, "treatment-result.json"), null);
  const fieldPairs = {
    model: pair(model(featureTrace), model(repairTrace)),
    model_catalog_json: pair(modelCatalog(featureTrace), modelCatalog(repairTrace)),
    sqlite_home: pair(sqliteHome(featureTrace), sqliteHome(repairTrace)),
    workingDirectory: pair(featureTrace.start_thread_options?.workingDirectory ?? featureTrace.target_repo ?? "", repairTrace.start_thread_options?.workingDirectory ?? repairTrace.target_repo ?? ""),
    target_repo_git_status: pair(gitStatus(featureTrace.start_thread_options?.workingDirectory ?? featureTrace.target_repo ?? ""), gitStatus(repairTrace.start_thread_options?.workingDirectory ?? repairTrace.target_repo ?? "")),
    sandboxMode: pair(featureTrace.start_thread_options?.sandboxMode ?? "", repairTrace.start_thread_options?.sandboxMode ?? ""),
    outputSchemaPath: pair(featureTrace.run_options?.outputSchemaPath ?? "", repairTrace.run_options?.outputSchemaPath ?? ""),
    outputSchemaHash: pair(featureTrace.run_options?.outputSchemaHash ?? "", repairTrace.run_options?.outputSchemaHash ?? ""),
    planner_output_contract_version: pair(String(featureSchemaTrace.planner_output_contract_version ?? featureResult?.planner_output_contract_version ?? ""), String(repairSchemaTrace.planner_output_contract_version ?? "v2")),
    promptLength: pair(featureTrace.prompt?.length ?? 0, repairTrace.prompt?.length ?? 0),
    promptHash: pair(featureTrace.prompt?.hash ?? "", repairTrace.prompt?.hash ?? ""),
    promptSectionCount: pair(estimatePromptSections(featureTrace.prompt?.length ?? 0), estimatePromptSections(repairTrace.prompt?.length ?? 0)),
    usesTaskGraphJsonString: pair(usesTaskGraphJson(featureSchemaTrace), usesTaskGraphJson(repairSchemaTrace)),
    usesPlannerLiteV2TasksArray: pair(usesPlannerLiteV2(featureSchemaTrace, featureTrace), usesPlannerLiteV2(repairSchemaTrace, repairTrace)),
    sdkMethod: pair(featureTrace.sdk_api_method ?? "", repairTrace.sdk_api_method ?? ""),
    runStreamedUsage: pair(featureTrace.run_options?.usesRunStreamed === true, repairTrace.run_options?.usesRunStreamed === true),
    no_event_timeout_ms: pair(60000, 60000),
    checkpointStatePath: pair(featureResult?.checkpoint_state_path ?? "", resolve(repoRoot, repairReportDir, "treatment-gate6b2-state.json")),
    artifactOutputPaths: pair(featureTrace.error_capture_paths ?? {}, repairTrace.error_capture_paths ?? {})
  };
  const criticalDiffs = Object.entries(fieldPairs)
    .filter(([field, value]) => !value.same && criticalField(field))
    .map(([field]) => field);
  const usesV2 = usesPlannerLiteV2(featureSchemaTrace, featureTrace) || featureResult?.planner_output_contract_version === "v2";
  const usesTaskGraph = usesTaskGraphJson(featureSchemaTrace);
  const recommendedFixes = [
    usesV2 ? "" : "Force feature planner to use planner-lite-v2 before any rerun.",
    usesTaskGraph ? "Remove task_graph_json from feature planner prompt/schema path." : "",
    criticalDiffs.includes("promptLength") ? "Run feature planner parity/lite-minimal/exact smokes before rerun." : "",
    "Keep feature-small-001 rerun blocked until planner parity, lite-minimal, and exact smokes pass."
  ].filter(Boolean);
  const failureCategory = !usesV2
    ? "FEATURE_PLANNER_NOT_USING_LITE_V2"
    : (featureTrace.prompt?.length ?? 0) > (repairTrace.prompt?.length ?? 0) * 1.5
      ? "FEATURE_PLANNER_PROMPT_TOO_LARGE"
      : "";
  return {
    case_id: "feature-small-001",
    status: failureCategory || criticalDiffs.some((field) => field !== "workingDirectory" && field !== "target_repo_git_status" && field !== "artifactOutputPaths" && field !== "checkpointStatePath") ? "NEEDS_REVISION" : "PASS",
    failure_category: failureCategory,
    repair_loop_case_id: "repair-loop-001",
    fields: fieldPairs,
    critical_diffs: criticalDiffs,
    uses_planner_lite_v2: usesV2,
    uses_task_graph_json_string: usesTaskGraph,
    feature_prompt_length: featureTrace.prompt?.length ?? 0,
    repair_loop_prompt_length: repairTrace.prompt?.length ?? 0,
    prompt_length_delta: (featureTrace.prompt?.length ?? 0) - (repairTrace.prompt?.length ?? 0),
    recommended_fixes: recommendedFixes
  };
}

export function writeFeaturePlannerInvocationDiff(repoRoot = process.cwd()): FeaturePlannerInvocationDiffReport {
  const diff = diffFeaturePlannerVsRepairPlanner(repoRoot);
  writeJson(resolve(repoRoot, featureReportDir, "feature-planner-invocation-diff.json"), diff);
  writeMarkdown(resolve(repoRoot, featureReportDir, "FeaturePlannerInvocationDiffReport.md"), renderReport(diff));
  return diff;
}

function renderReport(diff: FeaturePlannerInvocationDiffReport): string {
  return [
    "# Feature Planner Invocation Diff",
    "",
    `Status: ${diff.status}`,
    `Failure category: ${diff.failure_category || "none"}`,
    `Uses planner-lite-v2: ${diff.uses_planner_lite_v2}`,
    `Uses task_graph_json string: ${diff.uses_task_graph_json_string}`,
    `Feature prompt length: ${diff.feature_prompt_length}`,
    `Repair-loop prompt length: ${diff.repair_loop_prompt_length}`,
    `Prompt length delta: ${diff.prompt_length_delta}`,
    `Critical diffs: ${diff.critical_diffs.length > 0 ? diff.critical_diffs.join(", ") : "none"}`,
    "",
    "## Recommended Fixes",
    ...(diff.recommended_fixes.length > 0 ? diff.recommended_fixes.map((entry) => `- ${entry}`) : ["- None"]),
    "",
    "This report is generated from existing invocation traces only. It does not start Codex, SDK threads, or another M12 case.",
    ""
  ].join("\n");
}

function readTrace(path: string): PlannerTrace {
  return readJson<PlannerTrace>(path, {});
}

function pair(feature: unknown, repairLoop: unknown): { feature: unknown; repair_loop: unknown; same: boolean } {
  return {
    feature,
    repair_loop: repairLoop,
    same: JSON.stringify(feature) === JSON.stringify(repairLoop)
  };
}

function criticalField(field: string): boolean {
  return [
    "model",
    "model_catalog_json",
    "sqlite_home",
    "workingDirectory",
    "target_repo_git_status",
    "sandboxMode",
    "outputSchemaHash",
    "planner_output_contract_version",
    "promptLength",
    "promptHash",
    "usesTaskGraphJsonString",
    "usesPlannerLiteV2TasksArray",
    "sdkMethod",
    "runStreamedUsage",
    "no_event_timeout_ms",
    "checkpointStatePath",
    "artifactOutputPaths"
  ].includes(field);
}

function model(trace: PlannerTrace): string {
  return trace.start_thread_options?.model ?? trace.constructor_options?.config_values_redacted?.model ?? "";
}

function modelCatalog(trace: PlannerTrace): string {
  return trace.constructor_options?.config_values_redacted?.model_catalog_json ?? "";
}

function sqliteHome(trace: PlannerTrace): string {
  return trace.constructor_options?.config_values_redacted?.sqlite_home ?? "";
}

function usesTaskGraphJson(schemaTrace: Record<string, unknown>): boolean {
  return stableText(schemaTrace).includes("task_graph_json");
}

function usesPlannerLiteV2(schemaTrace: Record<string, unknown>, trace: PlannerTrace): boolean {
  return schemaTrace.planner_output_contract_version === "v2" ||
    trace.run_options?.outputSchemaHash === "4eb7a92b5497403e234940e49f9dcdf234d805eb037f1dc3d6683b8651f330de";
}

function estimatePromptSections(length: number): number {
  return length > 0 ? 1 : 0;
}

function gitStatus(cwd: string): string {
  if (!cwd) return "";
  try {
    return execFileSync("git", ["-C", cwd, "status", "--short"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return "UNAVAILABLE";
  }
}

function stableText(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

export function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = writeFeaturePlannerInvocationDiff();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.status === "PASS" ? 0 : 2;
}
