import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";

import { DEFAULT_CODEX_MODEL } from "../runtime/sdk-runtime-adapter.ts";
import type { RuntimeThreadInput, RuntimeThreadResult } from "../runtime/runtime-types.ts";
import {
  readDevWorkerBaseline,
  verifyDevWorkerMutationEvidence
} from "./dev-worker-mutation-evidence.ts";
import { devWorkerLiteOutputSchema } from "./dev-worker-lite-output.ts";
import type {
  DevWorkerInvocationSnapshot,
  DevWorkerStageInput,
  DevWorkerStageResult
} from "./sdk-dev-worker-stage-types.ts";
import { validateDevWorkerLiteResult } from "./validate-dev-worker-result.ts";

export const DEV_WORKER_STAGE_IMPL = "runDevWorkerStage";

export function buildDevWorkerStagePrompt(input: Pick<DevWorkerStageInput, "prd_path" | "task_graph_path" | "intentional_gap_mode">): string {
  const lines = [
    "$codex-loop SDK-Orchestrated Smoke",
    "Role: dev_worker",
    `Read ${input.prd_path} and ${input.task_graph_path}.`,
    "Only fix validateProjectName(name) in src/project-name.js.",
    "Requirements:",
    "- Empty string fails.",
    "- Whitespace-only string fails.",
    "- Names longer than 80 characters fail.",
    "- Valid project names pass.",
    "Run npm test.",
    "Return JSON matching the DevResult lite output schema.",
    "changed_files must include src/project-name.js.",
    "tests_run must include npm test."
  ];
  if (input.intentional_gap_mode) {
    lines.push(
      "Gate 6B.2 seeded-gap mode: intentionally leave whitespace-only string handling incomplete so the initial evaluator can produce NEEDS_REVISION.",
      "Implement empty string, max length, and valid-name behavior, but do not fix the whitespace-only acceptance gap in this initial pass.",
      "Return honest test evidence; tests_passed may be false in this seeded-gap initial pass."
    );
  }
  return lines.join("\n");
}

export function createDevWorkerRuntimeInput(input: DevWorkerStageInput): RuntimeThreadInput {
  const repoRoot = input.repo_root ?? process.cwd();
  const reportDir = input.report_dir ?? resolve(repoRoot, "evals/sdk-orchestrated/reports/sdk-startup-triage");
  const prompt = input.prompt_override ?? buildDevWorkerStagePrompt(input);
  return {
    role: "dev_worker",
    loop_run_id: input.loop_run_id,
    task_id: input.task_id,
    prompt,
    sandbox: input.sandbox,
    working_directory: input.target_repo,
    timeout_ms: input.timeout_ms,
    output_schema_path: "",
    output_schema: devWorkerLiteOutputSchema,
    codex_model: input.model ?? process.env.CODEX_LOOP_CODEX_MODEL ?? DEFAULT_CODEX_MODEL,
    model_catalog_json: input.model_catalog_json || undefined,
    codex_config_overrides: {},
    skip_git_repo_check: false,
    direct_cli_parity_status: "PASS",
    invocation_trace_path: input.invocation_trace_path ?? resolve(reportDir, "dev-worker-smoke-output-lite-invocation-trace-redacted.json"),
    invocation_trace_label: input.invocation_trace_label ?? "gate6b-dev-worker-smoke-output-lite",
    error_capture_paths: {
      events_path: input.events_path ?? resolve(reportDir, "dev-worker-smoke-output-lite-events.jsonl"),
      stdout_path: input.stdout_path ?? resolve(reportDir, "dev-worker-smoke-output-lite-stdout.log"),
      stderr_path: input.stderr_path ?? resolve(reportDir, "dev-worker-smoke-output-lite-stderr.log"),
      result_path: input.result_path
    },
    no_event_timeout_ms: input.no_event_timeout_ms ?? Number.parseInt(process.env.CODEX_LOOP_SDK_NO_EVENT_TIMEOUT_MS ?? "30000", 10),
    env: {
      CODEX_SQLITE_HOME: input.sqlite_home
    }
  };
}

export async function runDevWorkerStage(input: DevWorkerStageInput): Promise<DevWorkerStageResult> {
  const runtimeInput = createDevWorkerRuntimeInput(input);
  const repoRoot = input.repo_root ?? process.cwd();
  const reportDir = input.report_dir ?? resolve(repoRoot, "evals/sdk-orchestrated/reports/sdk-startup-triage");
  const targetRepo = resolve(input.target_repo);
  const baselinePath = resolve(reportDir, "dev-worker-baseline.json");
  const baseline = readDevWorkerBaseline(baselinePath);
  const baselinePreflight = baselinePreflightResult(input, runtimeInput, baselinePath, baseline);
  if (baselinePreflight) {
    return baselinePreflight;
  }
  writeDevWorkerInvocationArtifacts(runtimeInput, {
    repoRoot,
    tracePath: resolve(reportDir, "dev-worker-output-lite-invocation-trace-redacted.json")
  });
  const beforeSource = readTargetSource(targetRepo, input.target_source_file);
  const thread = input.runtime_adapter.runThreadStreamed
    ? await input.runtime_adapter.runThreadStreamed(runtimeInput)
    : await input.runtime_adapter.runThread(runtimeInput);
  const afterSource = readTargetSource(targetRepo, input.target_source_file);
  return evaluateDevWorkerThread(input, runtimeInput, thread, beforeSource, afterSource);
}

export function evaluateDevWorkerThread(
  input: DevWorkerStageInput,
  runtimeInput: RuntimeThreadInput,
  thread: RuntimeThreadResult,
  beforeSource: string,
  afterSource: string
): DevWorkerStageResult {
  const repoRoot = input.repo_root ?? process.cwd();
  const targetRepo = resolve(input.target_repo);
  const threadId = thread.thread_id;
  const reportDir = input.report_dir ?? resolve(repoRoot, "evals/sdk-orchestrated/reports/sdk-startup-triage");
  const baselinePath = resolve(reportDir, "dev-worker-baseline.json");
  const mutation = verifyDevWorkerMutationEvidence({
    target_repo: targetRepo,
    baseline_path: baselinePath,
    events_path: runtimeInput.error_capture_paths?.events_path,
    target_source_file: input.target_source_file,
    target_test_files: input.target_test_files
  });
  const base: DevWorkerStageResult = {
    status: "FAILED",
    failure_category: thread.failure_category ?? "",
    dev_worker_thread_started: Boolean(threadId),
    dev_worker_thread_id: threadId,
    file_change_verified: beforeSource !== afterSource || mutation.file_change_verified,
    file_change_verified_by_hash: mutation.file_change_verified_by_hash,
    file_change_verified_by_git: mutation.file_change_verified_by_git,
    file_change_verified_by_event: mutation.file_change_verified_by_event,
    src_project_name_hash_before: mutation.target_source_hash_before || mutation.src_project_name_hash_before,
    src_project_name_hash_after: mutation.target_source_hash_after || mutation.src_project_name_hash_after,
    git_changed_files: mutation.git_changed_files,
    structured_output_valid: false,
    tests_run: [],
    tests_passed: false,
    known_gap_seeded: input.intentional_gap_mode === true,
    dev_result_path: relative(repoRoot, resolve(targetRepo, input.artifact_path ?? "artifacts/dev-result.json")),
    artifact_thread_evidence_verified: false,
    final_response_contains_expected: false,
    event_count: countEvents(runtimeInput.error_capture_paths?.events_path),
    no_event_timeout: thread.no_event_timeout === true,
    last_event_type: thread.last_event_type ?? "",
    elapsed_ms: thread.elapsed_ms ?? 0,
    runtime_input: runtimeInput,
    errors: [...thread.errors]
  };

  if (!mutation.test_project_name_test_exists) {
    return {
      ...base,
      status: "FAILED",
      failure_category: "DEV_WORKER_TEST_DELETED",
      errors: [...base.errors, `${(input.target_test_files ?? ["test/project-name.test.js"]).join(", ")} was deleted or is missing.`]
    };
  }

  const threadFailure = mapThreadFailure(thread, threadId);
  if (threadFailure) {
    return {
      ...base,
      status: threadFailure === "TIMEOUT" ? "TIMEOUT" : "BLOCKED",
      failure_category: classifyThreadStartupFailure(thread, threadFailure)
    };
  }

  if (!threadId) {
    return {
      ...base,
      status: "BLOCKED",
      failure_category: classifyThreadStartupFailure(thread, "DEV_WORKER_THREAD_STARTUP_FAILURE"),
      errors: [...base.errors, "Dev worker stage did not produce a thread id."]
    };
  }

  const validation = input.require_tests_passed === false
    ? validateDevWorkerLiteResultAllowingFailingTests(thread.final_response)
    : validateDevWorkerLiteResult(thread.final_response, { required_changed_file: input.target_source_file });
  if (validation.status !== "PASS") {
    return {
      ...base,
      status: validation.status === "BLOCKED" ? "BLOCKED" : "NEEDS_REVISION",
      structured_output_valid: validation.failure_category !== "DEV_WORKER_OUTPUT_SCHEMA_FAILURE" && validation.failure_category !== "DEV_WORKER_RESULT_SCHEMA_INVALID",
      tests_run: validation.tests_run,
      tests_passed: validation.tests_passed,
      failure_category: validation.failure_category || "DEV_WORKER_PROMPT_OR_HARNESS_FAILURE",
      errors: [...base.errors, ...validation.errors]
    };
  }

  if (!base.file_change_verified) {
    return {
      ...base,
      status: "NEEDS_REVISION",
      structured_output_valid: true,
      tests_run: validation.tests_run,
      tests_passed: validation.tests_passed,
      failure_category: "DEV_WORKER_NO_FILE_CHANGE",
    errors: [...base.errors, `${input.target_source_file ?? "src/project-name.js"} did not change by hash, git diff, or SDK event evidence.`]
    };
  }

  const metadata = {
    created_by_runtime: "sdk-orchestrated",
    created_by_role: "dev_worker",
    created_by_thread_id: threadId
  };
  writeTargetJson(targetRepo, input.artifact_path ?? "artifacts/dev-result.json", {
    status: "PASS",
    changed_files: validation.changed_files,
    tests_run: validation.tests_run,
    tests_passed: validation.tests_passed,
    summary: validation.summary,
    known_gap_seeded: input.intentional_gap_mode === true,
    ...metadata
  });

  return {
    ...base,
    status: "PASS",
    failure_category: "",
    structured_output_valid: true,
    file_change_verified: true,
    tests_run: validation.tests_run,
    tests_passed: validation.tests_passed,
    known_gap_seeded: input.intentional_gap_mode === true,
    artifact_thread_evidence_verified: existsSync(resolve(targetRepo, input.artifact_path ?? "artifacts/dev-result.json")),
    final_response_contains_expected: true,
    errors: base.errors
  };
}

function baselinePreflightResult(
  input: DevWorkerStageInput,
  runtimeInput: RuntimeThreadInput,
  baselinePath: string,
  baseline: ReturnType<typeof readDevWorkerBaseline>
): DevWorkerStageResult | null {
  const repoRoot = input.repo_root ?? process.cwd();
  const targetRepo = resolve(input.target_repo);
  const mutation = verifyDevWorkerMutationEvidence({
    target_repo: targetRepo,
    baseline_path: baselinePath,
    events_path: runtimeInput.error_capture_paths?.events_path,
    target_source_file: input.target_source_file,
    target_test_files: input.target_test_files
  });
  const base: DevWorkerStageResult = {
    status: "BLOCKED",
    failure_category: "",
    dev_worker_thread_started: false,
    dev_worker_thread_id: "",
    file_change_verified: false,
    file_change_verified_by_hash: false,
    file_change_verified_by_git: mutation.file_change_verified_by_git,
    file_change_verified_by_event: false,
    src_project_name_hash_before: mutation.target_source_hash_before || mutation.src_project_name_hash_before,
    src_project_name_hash_after: mutation.target_source_hash_after || mutation.src_project_name_hash_after,
    git_changed_files: mutation.git_changed_files,
    structured_output_valid: false,
    tests_run: [],
    tests_passed: false,
    known_gap_seeded: input.intentional_gap_mode === true,
    dev_result_path: relative(repoRoot, resolve(targetRepo, input.artifact_path ?? "artifacts/dev-result.json")),
    artifact_thread_evidence_verified: false,
    final_response_contains_expected: false,
    event_count: countEvents(runtimeInput.error_capture_paths?.events_path),
    no_event_timeout: false,
    last_event_type: "",
    elapsed_ms: 0,
    runtime_input: runtimeInput,
    errors: []
  };

  if (input.baseline_preflight?.fixture_status === "BROKEN_AS_EXPECTED" && input.baseline_preflight.initial_tests_failed && input.baseline_preflight.target_source_hash_before) {
    return null;
  }
  if (!baseline) {
    return {
      ...base,
      failure_category: "BLOCKED_DEV_WORKER_BASELINE_MISSING",
      errors: ["Dev worker baseline is missing. Run npm run gate6b:dev-worker-smoke:prepare first."]
    };
  }
  const sourceHashBefore = baseline.target_source_hash_before || baseline.src_project_name_hash_before;
  if (baseline.fixture_status !== "BROKEN_AS_EXPECTED" || baseline.initial_tests_failed !== true || !sourceHashBefore) {
    return {
      ...base,
      failure_category: baseline.fixture_status === "BLOCKED_TARGET_FIXTURE_NOT_BROKEN" ? "BLOCKED_TARGET_FIXTURE_NOT_BROKEN" : "BLOCKED_DEV_WORKER_BASELINE_MISSING",
      errors: ["Dev worker baseline does not prove a broken starting fixture."]
    };
  }
  return null;
}

function validateDevWorkerLiteResultAllowingFailingTests(finalResponse: string): ReturnType<typeof validateDevWorkerLiteResult> {
  const validation = validateDevWorkerLiteResult(finalResponse);
  if (validation.failure_category !== "DEV_WORKER_TESTS_FAILED") {
    return validation;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(finalResponse) as unknown;
  } catch {
    return validation;
  }

  if (!isSeededGapDevWorkerOutput(parsed)) {
    return validation;
  }
  if (!parsed.changed_files.includes("src/project-name.js")) {
    return validation;
  }
  if (!parsed.tests_run.some((command) => command === "npm test" || command.includes("npm test"))) {
    return validation;
  }

  return {
    status: "PASS",
    changed_files: parsed.changed_files,
    tests_run: parsed.tests_run,
    tests_passed: false,
    summary: parsed.summary,
    failure_category: "",
    errors: []
  };
}

function isSeededGapDevWorkerOutput(value: unknown): value is {
  changed_files: string[];
  tests_run: string[];
  tests_passed: boolean;
  summary: string;
} {
  if (!isRecord(value)) return false;
  return (
    Array.isArray(value.changed_files) &&
    value.changed_files.every((entry) => typeof entry === "string") &&
    Array.isArray(value.tests_run) &&
    value.tests_run.every((entry) => typeof entry === "string") &&
    typeof value.tests_passed === "boolean" &&
    typeof value.summary === "string"
  );
}

export function devWorkerInvocationSnapshot(input: RuntimeThreadInput, repoRoot = process.cwd()): DevWorkerInvocationSnapshot {
  const configKeys = Object.keys(input.codex_config_overrides ?? {}).sort();
  const envKeys = Object.keys(input.env ?? {}).sort();
  return {
    workingDirectory: resolve(input.working_directory),
    model: input.codex_model ?? DEFAULT_CODEX_MODEL,
    model_catalog_json: input.model_catalog_json ?? "",
    sqlite_home: input.env.CODEX_SQLITE_HOME ?? "",
    sandboxMode: input.sandbox,
    skipGitRepoCheck: input.skip_git_repo_check ?? false,
    outputSchemaHash: stableHash(input.output_schema ?? {}),
    promptHash: stableHash(input.prompt),
    promptLength: input.prompt.length,
    prdPath: extractPromptPath(input.prompt, "docs/PRD.md"),
    taskGraphPath: extractPromptPath(input.prompt, "docs/TASK_GRAPH.json"),
    sdkMethod: "runStreamed",
    runOptions: input.output_schema || input.output_schema_path ? ["outputSchema", "signal"] : ["signal"],
    envKeys,
    configKeys,
    targetRepoGitStatus: gitStatus(input.working_directory, repoRoot)
  };
}

export function writeDevWorkerInvocationArtifacts(input: RuntimeThreadInput, options: { repoRoot?: string; tracePath?: string; outputSchemaPath?: string } = {}): void {
  const repoRoot = options.repoRoot ?? process.cwd();
  const tracePath = options.tracePath ?? input.invocation_trace_path;
  const outputSchemaPath = options.outputSchemaPath ?? resolve(repoRoot, "evals/sdk-orchestrated/reports/sdk-startup-triage/dev-worker-smoke-output-schema-lite.inline.json");
  if (outputSchemaPath) {
    writeJson(resolve(outputSchemaPath), input.output_schema ?? devWorkerLiteOutputSchema);
  }
  if (tracePath) {
    writeJson(resolve(tracePath), {
      mode: "output-lite",
      uses_output_schema: true,
      output_schema_kind: "dev-worker-lite",
      output_schema_path: outputSchemaPath,
      output_schema_exists: existsSync(resolve(outputSchemaPath)),
      output_schema_hash: stableHash(input.output_schema ?? devWorkerLiteOutputSchema),
      output_schema_keys: Object.keys(isRecord(input.output_schema) ? input.output_schema : {}).sort(),
      prompt_length: input.prompt.length,
      prompt_hash: stableHash(input.prompt),
      working_directory: input.working_directory,
      model: input.codex_model ?? DEFAULT_CODEX_MODEL,
      model_catalog_json: input.model_catalog_json ?? "",
      sandbox_mode: input.sandbox,
      sdk_method: "runStreamed",
      thread_options_keys: ["approvalPolicy", "model", "networkAccessEnabled", "sandboxMode", "skipGitRepoCheck", "workingDirectory"],
      run_options_keys: input.output_schema || input.output_schema_path ? ["outputSchema", "signal"] : ["signal"],
      dev_worker_stage_shared: true,
      dev_worker_stage_impl: DEV_WORKER_STAGE_IMPL
    });
  }
}

function classifyThreadStartupFailure(thread: RuntimeThreadResult, fallback: string): string {
  if (thread.errors.some((error) => /THREAD_ID_MISSING|thread_id|thread id/i.test(error))) return "THREAD_ID_MISSING";
  if (thread.failure_category === "SDK_OUTPUT_SCHEMA_CAUSES_THREAD_START_FAILURE") return "DEV_WORKER_OUTPUT_SCHEMA_CAUSES_THREAD_START_FAILURE";
  if (thread.failure_category) return thread.failure_category;
  if (thread.status === "TIMEOUT") return "SDK_THREAD_TIMEOUT";
  return fallback;
}

function mapThreadFailure(thread: RuntimeThreadResult, threadId: string): "DEV_WORKER_THREAD_STARTUP_FAILURE" | "TIMEOUT" | "" {
  if (thread.status === "TIMEOUT") return "TIMEOUT";
  if (thread.status === "BLOCKED" && !threadId) return "DEV_WORKER_THREAD_STARTUP_FAILURE";
  if (thread.status === "FAILED" && !threadId) return "DEV_WORKER_THREAD_STARTUP_FAILURE";
  return "";
}

function readTargetSource(targetRepo: string, targetSourceFile = "src/project-name.js"): string {
  try {
    return readFileSync(resolve(targetRepo, targetSourceFile), "utf8");
  } catch {
    return "";
  }
}

function writeTargetJson(targetRepo: string, path: string, value: unknown): void {
  const absolute = resolve(targetRepo, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function countEvents(path: string | undefined): number {
  if (!path || !existsSync(path)) return 0;
  return readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean).length;
}

function gitStatus(targetRepo: string, repoRoot: string): string {
  try {
    return execFileSync("git", ["-C", targetRepo, "status", "--short"], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return "UNAVAILABLE";
  }
}

function extractPromptPath(prompt: string, fallback: string): string {
  return prompt.includes(fallback) ? fallback : "";
}

function stableHash(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return createHash("sha256").update(text ?? "").digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
