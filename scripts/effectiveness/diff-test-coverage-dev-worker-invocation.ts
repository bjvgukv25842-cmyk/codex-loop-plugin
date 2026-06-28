import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { loadM12Dataset } from "./dataset.ts";
import { readJson, writeJson, writeMarkdown } from "./io.ts";

export interface TestCoverageDevWorkerInvocationDiff {
  status: "PASS" | "NEEDS_REVISION";
  case_id: "test-coverage-002";
  compared_against_case_id: "test-coverage-001";
  critical_diffs: string[];
  fields: Record<string, { test_coverage_001: unknown; test_coverage_002: unknown; same: boolean }>;
  recommended_fixes: string[];
}

const tc001TracePath = "evals/effectiveness/reports/test-coverage-001/sdk-stage-logs/generic-test-coverage-dev-worker-invocation-trace-redacted.json";
const tc002TracePath = "evals/effectiveness/reports/test-coverage-002/sdk-stage-logs/generic-test-coverage-dev-worker-invocation-trace-redacted.json";
const reportDir = "evals/effectiveness/reports/test-coverage-002";

export function diffTestCoverageDevWorkerInvocation(repoRoot = process.cwd()): TestCoverageDevWorkerInvocationDiff {
  const tc001 = readJson<Record<string, unknown> | null>(resolve(repoRoot, tc001TracePath), null);
  const tc002 = readJson<Record<string, unknown> | null>(resolve(repoRoot, tc002TracePath), null);
  const dataset = loadM12Dataset(resolve(repoRoot, "evals/effectiveness/datasets/m12-mini.jsonl"));
  const case001 = dataset.find((entry) => entry.case_id === "test-coverage-001");
  const case002 = dataset.find((entry) => entry.case_id === "test-coverage-002");
  const tc001Target = stringField(tc001?.target_repo);
  const tc002Target = stringField(tc002?.target_repo);
  const snapshot001 = {
    model: pathField(tc001, "start_thread_options", "model"),
    model_catalog_json: pathField(tc001, "constructor_options", "config_values_redacted", "model_catalog_json"),
    sqlite_home: pathField(tc001, "constructor_options", "config_values_redacted", "sqlite_home"),
    workingDirectory: pathField(tc001, "start_thread_options", "workingDirectory"),
    target_repo_git_status: gitStatus(tc001Target),
    target_repo_is_git: tc001?.target_repo_is_git === true,
    sandboxMode: pathField(tc001, "start_thread_options", "sandboxMode"),
    prompt_length: pathField(tc001, "prompt", "length"),
    prompt_hash: pathField(tc001, "prompt", "hash"),
    prompt_section_count: promptSectionCount(numberField(pathField(tc001, "prompt", "length"))),
    validation_commands: case001?.validation_commands ?? [],
    likely_files: ["test/invoice.test.js", "src/invoice.js", "scripts/check-test-coverage-contract.js"],
    sdk_method: tc001?.sdk_api_method ?? "",
    usesRunStreamed: pathField(tc001, "run_options", "usesRunStreamed"),
    usesRun: tc001?.sdk_api_method === "run",
    timeout_ms: 180_000,
    no_event_timeout_ms: 30_000,
    checkpoint_state_path: "evals/effectiveness/reports/test-coverage-001/treatment-generic-test-coverage-state.json",
    artifact_output_paths: ["artifacts/dev-result.json", "artifacts/eval-report.json", "artifacts/FinalDeliveryReport.md"],
    source_modification_allowed: "src/invoice.js only if tests expose a real bug"
  };
  const snapshot002 = {
    model: pathField(tc002, "start_thread_options", "model"),
    model_catalog_json: pathField(tc002, "constructor_options", "config_values_redacted", "model_catalog_json"),
    sqlite_home: pathField(tc002, "constructor_options", "config_values_redacted", "sqlite_home"),
    workingDirectory: pathField(tc002, "start_thread_options", "workingDirectory"),
    target_repo_git_status: gitStatus(tc002Target),
    target_repo_is_git: tc002?.target_repo_is_git === true,
    sandboxMode: pathField(tc002, "start_thread_options", "sandboxMode"),
    prompt_length: pathField(tc002, "prompt", "length"),
    prompt_hash: pathField(tc002, "prompt", "hash"),
    prompt_section_count: promptSectionCount(numberField(pathField(tc002, "prompt", "length"))),
    validation_commands: case002?.validation_commands ?? [],
    likely_files: ["test/cache.test.js", "src/cache.js", "src/cache-storage.js", "scripts/check-test-coverage-contract.js"],
    sdk_method: tc002?.sdk_api_method ?? "",
    usesRunStreamed: pathField(tc002, "run_options", "usesRunStreamed"),
    usesRun: tc002?.sdk_api_method === "run",
    timeout_ms: 180_000,
    no_event_timeout_ms: 30_000,
    checkpoint_state_path: "evals/effectiveness/reports/test-coverage-002/treatment-generic-test-coverage-state.json",
    artifact_output_paths: ["artifacts/dev-result.json", "artifacts/eval-report.json", "artifacts/FinalDeliveryReport.md"],
    source_modification_allowed: "src/cache.js or src/cache-storage.js only if tests expose a real bug"
  };
  const fields: TestCoverageDevWorkerInvocationDiff["fields"] = {};
  for (const key of Object.keys(snapshot002) as Array<keyof typeof snapshot002>) {
    fields[key] = {
      test_coverage_001: snapshot001[key],
      test_coverage_002: snapshot002[key],
      same: JSON.stringify(snapshot001[key]) === JSON.stringify(snapshot002[key])
    };
  }
  const criticalDiffs: string[] = [];
  if (numberField(snapshot002.prompt_length) > numberField(snapshot001.prompt_length) * 1.25) {
    criticalDiffs.push("TEST_COVERAGE_002_DEV_PROMPT_TOO_LARGE");
  }
  if (!snapshot002.workingDirectory || !existsSync(String(snapshot002.workingDirectory))) {
    criticalDiffs.push("TEST_COVERAGE_002_DEV_WORKING_DIR_MISMATCH");
  }
  const diff: TestCoverageDevWorkerInvocationDiff = {
    status: criticalDiffs.length === 0 ? "PASS" : "NEEDS_REVISION",
    case_id: "test-coverage-002",
    compared_against_case_id: "test-coverage-001",
    critical_diffs: criticalDiffs,
    fields,
    recommended_fixes: [
      "Keep TC002 dev-worker exact prompt no larger than the TC001 proven prompt envelope.",
      "Run parity/minimal/exact dev-worker smokes before a treatment rerun.",
      "Do not change source files unless tests expose a real implementation bug."
    ]
  };
  writeJson(resolve(repoRoot, reportDir, "dev-worker-invocation-diff.json"), diff);
  writeMarkdown(resolve(repoRoot, reportDir, "DevWorkerInvocationDiffReport.md"), renderDiff(diff));
  return diff;
}

function renderDiff(diff: TestCoverageDevWorkerInvocationDiff): string {
  return [
    "# Test-Coverage Dev Worker Invocation Diff",
    "",
    `Status: ${diff.status}`,
    `Compared: ${diff.compared_against_case_id} -> ${diff.case_id}`,
    `Critical diffs: ${diff.critical_diffs.length ? diff.critical_diffs.join(", ") : "none"}`,
    "",
    "## Fields",
    ...Object.entries(diff.fields).map(([field, value]) => `- ${field}: same=${String(value.same)}; tc001=${JSON.stringify(value.test_coverage_001)}; tc002=${JSON.stringify(value.test_coverage_002)}`),
    "",
    "## Recommended Fixes",
    ...diff.recommended_fixes.map((fix) => `- ${fix}`),
    ""
  ].join("\n");
}

function pathField(value: Record<string, unknown> | null | undefined, ...keys: string[]): unknown {
  let current: unknown = value;
  for (const key of keys) {
    if (typeof current !== "object" || current === null || Array.isArray(current)) return "";
    current = (current as Record<string, unknown>)[key];
  }
  return current ?? "";
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberField(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function promptSectionCount(length: number): number {
  return length > 0 ? Math.max(1, Math.ceil(length / 120)) : 0;
}

function gitStatus(targetRepo: string): string {
  if (!targetRepo || !existsSync(resolve(targetRepo, ".git"))) return "not-git";
  try {
    const output = execFileSync("git", ["status", "--short"], { cwd: targetRepo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return output.trim() || "clean";
  } catch {
    return "git-status-unavailable";
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const diff = diffTestCoverageDevWorkerInvocation();
  process.stdout.write(`${JSON.stringify(diff, null, 2)}\n`);
}
