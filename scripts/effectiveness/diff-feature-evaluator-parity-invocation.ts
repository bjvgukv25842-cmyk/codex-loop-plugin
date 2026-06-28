import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { readJson, writeJson, writeMarkdown } from "./io.ts";

interface InvocationTrace {
  trace_label?: string;
  target_repo?: string;
  target_repo_is_git?: boolean;
  constructor_options?: {
    env_keys?: string[];
    config_keys?: string[];
    config_values_redacted?: {
      sqlite_home?: string;
      model_catalog_json?: string;
      model?: string;
    };
  };
  start_thread_options?: {
    workingDirectory?: string;
    skipGitRepoCheck?: boolean;
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

export interface FeatureEvaluatorParityInvocationDiff {
  case_id: "feature-small-001";
  status: "PASS" | "NEEDS_REVISION";
  failure_category: "" | "EVALUATOR_PARITY_INVOCATION_DIFF_DETECTED";
  compared_invocations: string[];
  fields: Record<string, Record<string, unknown>>;
  critical_diffs: string[];
  recommended_fixes: string[];
}

const reportDir = "evals/effectiveness/reports/feature-small-001";
const stageLogDir = `${reportDir}/sdk-stage-logs`;

export function diffFeatureEvaluatorParityInvocation(repoRoot = process.cwd()): FeatureEvaluatorParityInvocationDiff {
  const evaluator = readTrace(resolve(repoRoot, stageLogDir, "feature-evaluator-smoke-parity-invocation-trace-redacted.json"));
  const planner = firstAvailableTrace(repoRoot, [
    "feature-planner-smoke-parity-invocation-trace-redacted.json",
    "generic-planner-invocation-trace-redacted.json",
    "planner-schema-invocation-trace-redacted.json"
  ]);
  const devWorker = firstAvailableTrace(repoRoot, [
    "dev-worker-output-lite-invocation-trace-redacted.json",
    "generic-dev-worker-invocation-trace-redacted.json"
  ]);
  const fields = {
    workingDirectory: values(evaluatorWorkingDirectory(evaluator), evaluatorWorkingDirectory(planner), devWorkerWorkingDirectory(devWorker)),
    target_repo_git_status: values(gitStatus(evaluatorWorkingDirectory(evaluator)), gitStatus(evaluatorWorkingDirectory(planner)), gitStatus(devWorkerWorkingDirectory(devWorker))),
    model: values(model(evaluator), model(planner), devWorkerModel(devWorker)),
    model_catalog_json: values(modelCatalog(evaluator), modelCatalog(planner), devWorkerModelCatalog(devWorker)),
    sqlite_home: values(sqliteHome(evaluator), sqliteHome(planner), sqliteHome(devWorker)),
    sandboxMode: values(sandboxMode(evaluator), sandboxMode(planner), devWorkerSandboxMode(devWorker)),
    skipGitRepoCheck: values(skipGitRepoCheck(evaluator), skipGitRepoCheck(planner), skipGitRepoCheck(devWorker)),
    role_metadata: values("evaluator", "planner", "dev_worker"),
    promptLength: values(evaluator.prompt?.length ?? 0, planner.prompt?.length ?? 0, devWorker.prompt?.length ?? numberField(devWorker, "prompt_length")),
    promptHash: values(evaluator.prompt?.hash ?? "", planner.prompt?.hash ?? "", devWorker.prompt?.hash ?? stringField(devWorker, "prompt_hash")),
    sdkMethod: values(evaluator.sdk_api_method ?? "", planner.sdk_api_method ?? "", stringField(devWorker, "sdk_method")),
    runStreamedUsage: values(evaluator.run_options?.usesRunStreamed === true, planner.run_options?.usesRunStreamed === true, stringField(devWorker, "sdk_method") === "runStreamed"),
    outputSchemaUsage: values(evaluator.run_options?.usesOutputSchema === true, planner.run_options?.usesOutputSchema === true, booleanField(devWorker, "uses_output_schema")),
    outputSchemaHash: values(evaluator.run_options?.outputSchemaHash ?? "", planner.run_options?.outputSchemaHash ?? "", stringField(devWorker, "output_schema_hash")),
    envKeysHash: values(stableHash(evaluator.constructor_options?.env_keys ?? []), stableHash(planner.constructor_options?.env_keys ?? []), stableHash(devWorker.constructor_options?.env_keys ?? [])),
    configKeys: values(evaluator.constructor_options?.config_keys ?? [], planner.constructor_options?.config_keys ?? [], devWorker.constructor_options?.config_keys ?? []),
    no_event_timeout_ms: values(60000, 60000, 60000),
    timeout_ms: values(180000, 180000, 180000),
    cwd: values(process.cwd(), process.cwd(), process.cwd()),
    eventsPath: values(evaluator.error_capture_paths?.events_path ?? "", planner.error_capture_paths?.events_path ?? "", devWorker.error_capture_paths?.events_path ?? "")
  };
  const criticalDiffs = Object.entries(fields)
    .filter(([field, entry]) => criticalField(field) && differs(entry))
    .map(([field]) => field);
  const diff: FeatureEvaluatorParityInvocationDiff = {
    case_id: "feature-small-001",
    status: criticalDiffs.length > 0 ? "NEEDS_REVISION" : "PASS",
    failure_category: criticalDiffs.length > 0 ? "EVALUATOR_PARITY_INVOCATION_DIFF_DETECTED" : "",
    compared_invocations: [
      "feature-evaluator-parity",
      planner.trace_label ? "feature-planner-parity" : "feature-planner-generic",
      devWorker.trace_label || stringField(devWorker, "sdk_method") ? "dev-worker-parity-or-output-lite" : "dev-worker-unavailable"
    ],
    fields,
    critical_diffs: criticalDiffs,
    recommended_fixes: recommendedFixes(criticalDiffs)
  };
  writeJson(resolve(repoRoot, reportDir, "feature-evaluator-parity-invocation-diff.json"), diff);
  writeMarkdown(resolve(repoRoot, reportDir, "FeatureEvaluatorParityInvocationDiffReport.md"), renderReport(diff));
  return diff;
}

function readTrace(path: string): InvocationTrace {
  return readJson<InvocationTrace>(path, {});
}

function firstAvailableTrace(repoRoot: string, filenames: string[]): InvocationTrace {
  for (const filename of filenames) {
    const path = resolve(repoRoot, stageLogDir, filename);
    if (existsSync(path)) {
      return readTrace(path);
    }
  }
  return {};
}

function values(evaluator: unknown, planner: unknown, dev_worker: unknown): Record<string, unknown> {
  return {
    evaluator,
    planner,
    dev_worker,
    evaluator_matches_planner: JSON.stringify(evaluator) === JSON.stringify(planner),
    evaluator_matches_dev_worker: JSON.stringify(evaluator) === JSON.stringify(dev_worker)
  };
}

function differs(entry: Record<string, unknown>): boolean {
  return entry.evaluator_matches_planner !== true || entry.evaluator_matches_dev_worker !== true;
}

function criticalField(field: string): boolean {
  return [
    "workingDirectory",
    "target_repo_git_status",
    "model",
    "model_catalog_json",
    "sqlite_home",
    "sandboxMode",
    "skipGitRepoCheck",
    "promptLength",
    "promptHash",
    "sdkMethod",
    "runStreamedUsage",
    "outputSchemaUsage",
    "outputSchemaHash",
    "no_event_timeout_ms",
    "timeout_ms",
    "eventsPath"
  ].includes(field);
}

function recommendedFixes(criticalDiffs: string[]): string[] {
  const fixes = ["Keep later evaluator smoke modes and treatment rerun blocked until evaluator parity is proven."];
  if (criticalDiffs.includes("sandboxMode")) fixes.push("Confirm the evaluator read-only sandbox matches the intended CLI parity command.");
  if (criticalDiffs.includes("sdkMethod") || criticalDiffs.includes("runStreamedUsage")) fixes.push("Use CODEX_LOOP_EVALUATOR_PARITY_SDK_METHOD=run only as an explicitly approved diagnostic if CLI parity passes.");
  if (criticalDiffs.includes("workingDirectory") || criticalDiffs.includes("target_repo_git_status")) fixes.push("Confirm the evaluator parity target repo and git status match passed planner/dev worker slices.");
  if (criticalDiffs.includes("promptLength") || criticalDiffs.includes("promptHash")) fixes.push("Use the direct CLI parity prompt to determine whether prompt delivery or SDK event streaming is the blocker.");
  return fixes;
}

function renderReport(diff: FeatureEvaluatorParityInvocationDiff): string {
  return [
    "# Feature Evaluator Parity Invocation Diff",
    "",
    `Status: ${diff.status}`,
    `Failure category: ${diff.failure_category || "none"}`,
    `Compared invocations: ${diff.compared_invocations.join(", ")}`,
    `Critical diffs: ${diff.critical_diffs.length > 0 ? diff.critical_diffs.join(", ") : "none"}`,
    "",
    "## Recommended Fixes",
    ...diff.recommended_fixes.map((fix) => `- ${fix}`),
    "",
    "This report is generated from existing invocation traces only. It does not start SDK threads or Codex CLI.",
    ""
  ].join("\n");
}

function evaluatorWorkingDirectory(trace: InvocationTrace): string {
  return trace.start_thread_options?.workingDirectory ?? trace.target_repo ?? "";
}

function devWorkerWorkingDirectory(trace: InvocationTrace): string {
  return stringField(trace, "working_directory") || trace.start_thread_options?.workingDirectory || trace.target_repo || "";
}

function model(trace: InvocationTrace): string {
  return trace.start_thread_options?.model ?? trace.constructor_options?.config_values_redacted?.model ?? "";
}

function devWorkerModel(trace: InvocationTrace): string {
  return stringField(trace, "model") || model(trace);
}

function modelCatalog(trace: InvocationTrace): string {
  return trace.constructor_options?.config_values_redacted?.model_catalog_json ?? stringField(trace, "model_catalog_json");
}

function devWorkerModelCatalog(trace: InvocationTrace): string {
  return stringField(trace, "model_catalog_json") || modelCatalog(trace);
}

function sqliteHome(trace: InvocationTrace): string {
  return trace.constructor_options?.config_values_redacted?.sqlite_home ?? "";
}

function sandboxMode(trace: InvocationTrace): string {
  return trace.start_thread_options?.sandboxMode ?? stringField(trace, "sandbox_mode");
}

function devWorkerSandboxMode(trace: InvocationTrace): string {
  return stringField(trace, "sandbox_mode") || sandboxMode(trace);
}

function skipGitRepoCheck(trace: InvocationTrace): boolean | string {
  return typeof trace.start_thread_options?.skipGitRepoCheck === "boolean" ? trace.start_thread_options.skipGitRepoCheck : "";
}

function gitStatus(cwd: string): string {
  if (!cwd || !existsSync(cwd)) return "";
  try {
    return execFileSync("git", ["-C", cwd, "status", "--short"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return "UNAVAILABLE";
  }
}

function stringField(value: unknown, key: string): string {
  return isRecord(value) && typeof value[key] === "string" ? value[key] : "";
}

function numberField(value: unknown, key: string): number {
  return isRecord(value) && typeof value[key] === "number" ? value[key] : 0;
}

function booleanField(value: unknown, key: string): boolean {
  return isRecord(value) && value[key] === true;
}

function stableHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = diffFeatureEvaluatorParityInvocation();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.status === "PASS" ? 0 : 2;
}
