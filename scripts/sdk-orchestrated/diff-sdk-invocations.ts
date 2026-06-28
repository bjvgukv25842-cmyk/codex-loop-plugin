import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

type InvocationName = "sdk_parity" | "gate6b_planner" | "planner_minimal" | "planner_parity_as_planner";

interface InvocationSummary {
  name: InvocationName;
  trace_path: string;
  trace_exists: boolean;
  trace_trusted: boolean;
  workingDirectory: string;
  target_repo_absolute_path: string;
  target_repo_git_status: string;
  CODEX_SQLITE_HOME: string;
  sqlite_home: string;
  model_catalog_json: string;
  model: string;
  sandboxMode: string;
  skipGitRepoCheck: boolean | null;
  usesOutputSchema: boolean;
  outputSchemaPath: string;
  outputSchemaHash: string;
  prompt_length: number | null;
  prompt_hash: string;
  config_keys: string[];
  env_keys: string[];
  sdk_api_method: string;
  node_process_cwd: string;
  error_capture_paths: Record<string, unknown>;
}

interface FieldDiff {
  field: string;
  values: Record<InvocationName, unknown>;
  missing_traces: InvocationName[];
}

const repoRoot = process.cwd();
const reportDir = process.env.CODEX_LOOP_SDK_STARTUP_TRIAGE_DIR
  ? resolve(process.env.CODEX_LOOP_SDK_STARTUP_TRIAGE_DIR)
  : resolve(repoRoot, "evals/sdk-orchestrated/reports/sdk-startup-triage");
const diffPath = resolve(reportDir, "sdk-invocation-diff.json");
const reportPath = resolve(reportDir, "SDKInvocationDiffReport.md");

function main(): void {
  const invocations = [
    summarize("sdk_parity", firstExistingPath(["sdk-parity-invocation-trace-redacted.json", "sdk-invocation-trace-redacted.json"])),
    summarize("gate6b_planner", resolve(reportDir, "gate6b-smoke-planner-invocation-trace-redacted.json")),
    summarize("planner_minimal", resolve(reportDir, "planner-smoke-minimal-invocation-trace-redacted.json")),
    summarize("planner_parity_as_planner", resolve(reportDir, "planner-smoke-parity-as-planner-invocation-trace-redacted.json"))
  ];
  const compared_fields = [
    "workingDirectory",
    "target_repo_absolute_path",
    "target_repo_git_status",
    "CODEX_SQLITE_HOME",
    "sqlite_home",
    "model_catalog_json",
    "model",
    "sandboxMode",
    "skipGitRepoCheck",
    "usesOutputSchema",
    "outputSchemaPath",
    "outputSchemaHash",
    "prompt_length",
    "prompt_hash",
    "config_keys",
    "env_keys",
    "sdk_api_method",
    "node_process_cwd",
    "error_capture_paths"
  ];
  const differences = compared_fields
    .map((field) => diffField(invocations, field as keyof InvocationSummary))
    .filter((diff) => hasMeaningfulDiff(diff));
  const critical_diffs = differences
    .map((difference) => difference.field)
    .filter((field) => ["workingDirectory", "skipGitRepoCheck", "sandboxMode", "model", "model_catalog_json", "sqlite_home", "CODEX_SQLITE_HOME", "prompt_length", "prompt_hash", "usesOutputSchema", "sdk_api_method", "config_keys", "env_keys", "target_repo_git_status", "node_process_cwd"].includes(field));
  const result = {
    gate: "Gate 6B.1F SDK Invocation Differential",
    status: differences.length > 0 ? "SDK_INVOCATION_DIFF_DETECTED" : "PASS",
    report_dir: relativeToRepo(reportDir),
    invocations,
    differences,
    critical_diffs,
    real_sdk_run_executed: false
  };
  mkdirSync(dirname(diffPath), { recursive: true });
  writeFileSync(diffPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  writeFileSync(reportPath, renderReport(result), "utf8");
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

function firstExistingPath(names: string[]): string {
  for (const name of names) {
    const path = resolve(reportDir, name);
    if (existsSync(path)) return path;
  }
  return resolve(reportDir, names[0] ?? "");
}

function summarize(name: InvocationName, tracePath: string): InvocationSummary {
  const trace = readJson(tracePath);
  const constructorOptions = toRecord(trace.constructor_options);
  const configValues = toRecord(constructorOptions.config_values_redacted);
  const startOptions = toRecord(trace.start_thread_options);
  const runOptions = toRecord(trace.run_options);
  const prompt = toRecord(trace.prompt);
  const envKeys = toStringArray(constructorOptions.env_keys);
  const traceTrusted = existsSync(tracePath) && !envKeys.includes("VITEST") && !envKeys.some((key) => /^CODEX_LOOP_GATE6B_.*MOCK$/.test(key));
  const targetRepo = stringField(trace.target_repo) || stringField(startOptions.workingDirectory);
  return {
    name,
    trace_path: relativeToRepo(tracePath),
    trace_exists: existsSync(tracePath),
    trace_trusted: traceTrusted,
    workingDirectory: stringField(startOptions.workingDirectory),
    target_repo_absolute_path: targetRepo,
    target_repo_git_status: safeGitStatus(targetRepo),
    CODEX_SQLITE_HOME: envKeys.includes("CODEX_SQLITE_HOME") ? "present" : "",
    sqlite_home: stringField(configValues.sqlite_home),
    model_catalog_json: stringField(configValues.model_catalog_json),
    model: stringField(startOptions.model) || stringField(configValues.model),
    sandboxMode: stringField(startOptions.sandboxMode),
    skipGitRepoCheck: typeof startOptions.skipGitRepoCheck === "boolean" ? startOptions.skipGitRepoCheck : null,
    usesOutputSchema: runOptions.usesOutputSchema === true,
    outputSchemaPath: stringField(runOptions.outputSchemaPath),
    outputSchemaHash: stringField(runOptions.outputSchemaHash),
    prompt_length: typeof prompt.length === "number" ? prompt.length : null,
    prompt_hash: stringField(prompt.hash),
    config_keys: toStringArray(constructorOptions.config_keys),
    env_keys: envKeys,
    sdk_api_method: stringField(trace.sdk_api_method) || (runOptions.usesRunStreamed === true ? "runStreamed" : ""),
    node_process_cwd: stringField(trace.node_process_cwd),
    error_capture_paths: toRecord(trace.error_capture_paths)
  };
}

function diffField(invocations: InvocationSummary[], field: keyof InvocationSummary): FieldDiff {
  const values = Object.fromEntries(invocations.map((invocation) => [invocation.name, normalizedValue(invocation[field])])) as Record<InvocationName, unknown>;
  return {
    field: String(field),
    values,
    missing_traces: invocations.filter((invocation) => !invocation.trace_exists || !invocation.trace_trusted).map((invocation) => invocation.name)
  };
}

function hasMeaningfulDiff(diff: FieldDiff): boolean {
  if (diff.missing_traces.length > 0) return true;
  const values = Object.values(diff.values).map((value) => JSON.stringify(value));
  return new Set(values).size > 1;
}

function renderReport(result: { status: string; invocations: InvocationSummary[]; differences: FieldDiff[]; critical_diffs: string[] }): string {
  const lines = [
    "# Gate 6B.1F SDK Invocation Diff Report",
    "",
    "Date: 2026-06-20",
    "",
    `Status: ${result.status}`,
    "Planner smoke modes compared: minimal and parity-as-planner",
    `Critical diffs: ${JSON.stringify(result.critical_diffs)}`,
    "Real SDK run executed: false",
    "",
    "## Traces",
    "",
    ...result.invocations.map((invocation) => `- ${invocation.name}: ${traceLabel(invocation)}`),
    "",
    "## Differences",
    ""
  ];
  if (result.differences.length === 0) {
    lines.push("No compared invocation differences were detected.");
  } else {
    for (const diff of result.differences) {
      lines.push(`- ${diff.field}: ${stableInlineJson(diff.values)}`);
    }
  }
  lines.push("", "M12 blocked: true", "");
  return `${lines.join("\n")}\n`;
}

function traceLabel(invocation: InvocationSummary): string {
  if (!invocation.trace_exists) return `${invocation.trace_path} (missing)`;
  if (!invocation.trace_trusted) return `${invocation.trace_path} (untrusted test/mock trace)`;
  return invocation.trace_path;
}

function safeGitStatus(cwd: string): string {
  if (!cwd || !existsSync(cwd) || !existsSync(resolve(cwd, ".git"))) return "";
  try {
    return execFileSync("git", ["-C", cwd, "status", "--short"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

function readJson(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function toRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").sort() : [];
}

function normalizedValue(value: unknown): unknown {
  if (Array.isArray(value)) return [...value].sort();
  if (typeof value === "object" && value !== null) return stableObject(value as Record<string, unknown>);
  return value;
}

function stableObject(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, normalizedValue(value[key])]));
}

function stableInlineJson(value: unknown): string {
  return JSON.stringify(normalizedValue(value));
}

function relativeToRepo(path: string): string {
  return path.startsWith(`${repoRoot}/`) ? path.slice(repoRoot.length + 1) : path;
}

export function stableHashForTest(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return createHash("sha256").update(text ?? "").digest("hex");
}

main();
