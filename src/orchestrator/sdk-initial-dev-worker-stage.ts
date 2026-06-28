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
import type {
  InitialDevWorkerSeededGapOutput,
  InitialDevWorkerSeededGapStageInput,
  InitialDevWorkerSeededGapStageResult
} from "./sdk-initial-dev-worker-stage-types.ts";

export const INITIAL_DEV_WORKER_SEEDED_GAP_STAGE_IMPL = "runInitialDevWorkerSeededGapStage";

export const initialDevWorkerSeededGapOutputSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "status",
    "changed_files",
    "baseline_tests_run",
    "baseline_tests_passed",
    "full_tests_run",
    "full_tests_expected_to_fail",
    "full_tests_failed",
    "known_gap_seeded",
    "summary"
  ],
  properties: {
    status: {
      type: "string",
      enum: ["PASS", "BLOCKED", "FAILED", "TIMEOUT"]
    },
    changed_files: {
      type: "array",
      items: {
        type: "string"
      }
    },
    baseline_tests_run: {
      type: "boolean"
    },
    baseline_tests_passed: {
      type: "boolean"
    },
    full_tests_run: {
      type: "boolean"
    },
    full_tests_expected_to_fail: {
      type: "boolean"
    },
    full_tests_failed: {
      type: "boolean"
    },
    known_gap_seeded: {
      type: "boolean"
    },
    summary: {
      type: "string"
    }
  }
} as const;

export function buildInitialDevWorkerSeededGapPrompt(
  input: Pick<InitialDevWorkerSeededGapStageInput, "prd_path" | "task_graph_path">
): string {
  return [
    "$codex-loop SDK-Orchestrated Gate 6B.2 initial dev worker",
    "Role: dev_worker",
    `Read ${input.prd_path} and ${input.task_graph_path}.`,
    "You are the initial seeded-gap implementer, not the final repair worker.",
    "Only edit src/project-name.js.",
    "Implement only the baseline acceptance criteria:",
    "- Empty string fails.",
    "- Names longer than 80 characters fail.",
    "- Valid project names pass.",
    "Intentionally preserve the whitespace-only gap:",
    "- Do not reject whitespace-only strings in this initial pass.",
    "- Do not use trim() or an equivalent whitespace-only guard yet.",
    "Run npm run test:baseline and make it pass.",
    "Run npm run test:full if possible and record that it is expected to fail because whitespace-only names remain accepted.",
    "Write artifacts/dev-result.json with known_gap_seeded = true.",
    "Return JSON matching the InitialDevWorkerSeededGap output schema.",
    "changed_files must include src/project-name.js.",
    "baseline_tests_passed must be true.",
    "full_tests_expected_to_fail and full_tests_failed must both be true.",
    "known_gap_seeded must be true."
  ].join("\n");
}

export function createInitialDevWorkerSeededGapRuntimeInput(input: InitialDevWorkerSeededGapStageInput): RuntimeThreadInput {
  const repoRoot = input.repo_root ?? process.cwd();
  const reportDir = input.report_dir ?? resolve(repoRoot, "evals/sdk-orchestrated/reports/sdk-startup-triage");
  const prompt = buildInitialDevWorkerSeededGapPrompt(input);
  return {
    role: "dev_worker",
    loop_run_id: input.loop_run_id,
    task_id: input.task_id,
    prompt,
    sandbox: input.sandbox,
    working_directory: input.target_repo,
    timeout_ms: input.timeout_ms,
    output_schema_path: "",
    output_schema: initialDevWorkerSeededGapOutputSchema,
    codex_model: input.model ?? process.env.CODEX_LOOP_CODEX_MODEL ?? DEFAULT_CODEX_MODEL,
    model_catalog_json: input.model_catalog_json || undefined,
    codex_config_overrides: {},
    skip_git_repo_check: false,
    direct_cli_parity_status: "PASS",
    invocation_trace_path: input.invocation_trace_path ?? resolve(reportDir, "gate6b2-initial-dev-worker-invocation-trace-redacted.json"),
    invocation_trace_label: input.invocation_trace_label ?? "gate6b2-initial-dev-worker",
    error_capture_paths: {
      events_path: input.events_path ?? resolve(reportDir, "gate6b2-initial-dev-worker-events.jsonl"),
      stdout_path: input.stdout_path ?? resolve(reportDir, "gate6b2-initial-dev-worker-stdout.log"),
      stderr_path: input.stderr_path ?? resolve(reportDir, "gate6b2-initial-dev-worker-stderr.log"),
      result_path: input.result_path
    },
    no_event_timeout_ms: input.no_event_timeout_ms ?? Number.parseInt(process.env.CODEX_LOOP_SDK_NO_EVENT_TIMEOUT_MS ?? "30000", 10),
    env: {
      CODEX_SQLITE_HOME: input.sqlite_home
    }
  };
}

export async function runInitialDevWorkerSeededGapStage(
  input: InitialDevWorkerSeededGapStageInput
): Promise<InitialDevWorkerSeededGapStageResult> {
  const runtimeInput = createInitialDevWorkerSeededGapRuntimeInput(input);
  const repoRoot = input.repo_root ?? process.cwd();
  const reportDir = input.report_dir ?? resolve(repoRoot, "evals/sdk-orchestrated/reports/sdk-startup-triage");
  const baselinePath = resolve(reportDir, "dev-worker-baseline.json");
  const baseline = readDevWorkerBaseline(baselinePath);
  const preflight = initialDevWorkerBaselinePreflight(input, runtimeInput, baselinePath, baseline);
  if (preflight) {
    return preflight;
  }
  writeInitialDevWorkerInvocationArtifacts(runtimeInput, {
    tracePath: resolve(reportDir, "gate6b2-initial-dev-worker-invocation-trace-redacted.json")
  });
  const beforeSource = readTargetSource(input.target_repo);
  const thread = input.runtime_adapter.runThreadStreamed
    ? await input.runtime_adapter.runThreadStreamed(runtimeInput)
    : await input.runtime_adapter.runThread(runtimeInput);
  const afterSource = readTargetSource(input.target_repo);
  return evaluateInitialDevWorkerSeededGapThread(input, runtimeInput, thread, beforeSource, afterSource);
}

export function evaluateInitialDevWorkerSeededGapThread(
  input: InitialDevWorkerSeededGapStageInput,
  runtimeInput: RuntimeThreadInput,
  thread: RuntimeThreadResult,
  beforeSource: string,
  afterSource: string
): InitialDevWorkerSeededGapStageResult {
  const repoRoot = input.repo_root ?? process.cwd();
  const targetRepo = resolve(input.target_repo);
  const threadId = thread.thread_id;
  const reportDir = input.report_dir ?? resolve(repoRoot, "evals/sdk-orchestrated/reports/sdk-startup-triage");
  const baselinePath = resolve(reportDir, "dev-worker-baseline.json");
  const mutation = verifyDevWorkerMutationEvidence({
    target_repo: targetRepo,
    baseline_path: baselinePath,
    events_path: runtimeInput.error_capture_paths?.events_path
  });
  const base: InitialDevWorkerSeededGapStageResult = {
    status: "FAILED",
    failure_category: normalizeFailureCategory(thread.failure_category),
    thread_id: threadId,
    dev_worker_thread_started: Boolean(threadId),
    dev_worker_thread_id: threadId,
    known_gap_seeded: false,
    file_change_verified: beforeSource !== afterSource || mutation.file_change_verified,
    baseline_tests_run: false,
    baseline_tests_passed: false,
    full_tests_run: false,
    full_tests_expected_to_fail: false,
    full_tests_failed: false,
    dev_result_path: relative(repoRoot, resolve(targetRepo, input.artifact_path ?? "artifacts/dev-result.json")),
    artifact_thread_evidence_verified: false,
    structured_output_valid: false,
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
      errors: [...base.errors, "project-name test files were deleted or are missing."]
    };
  }

  const threadFailure = mapThreadFailure(thread, threadId);
  if (threadFailure) {
    const fallback = threadFailure === "TIMEOUT" ? "SDK_THREAD_TIMEOUT" : "DEV_WORKER_THREAD_STARTUP_FAILURE";
    return {
      ...base,
      status: threadFailure === "TIMEOUT" ? "TIMEOUT" : "BLOCKED",
      failure_category: classifyThreadStartupFailure(thread, fallback)
    };
  }

  if (!threadId) {
    return {
      ...base,
      status: "BLOCKED",
      failure_category: classifyThreadStartupFailure(thread, "DEV_WORKER_THREAD_STARTUP_FAILURE"),
      errors: [...base.errors, "Initial dev worker stage did not produce a thread id."]
    };
  }

  const parsed = parseInitialDevWorkerSeededGapOutput(thread.final_response);
  if (parsed.status !== "PASS" || !parsed.output) {
    return {
      ...base,
      status: parsed.status === "TIMEOUT" ? "TIMEOUT" : parsed.status === "BLOCKED" ? "BLOCKED" : "FAILED",
      failure_category: parsed.failure_category,
      errors: [...base.errors, ...parsed.errors]
    };
  }

  const output = parsed.output;
  const actualBaselineTestsPassed = commandPasses(["npm", "run", "test:baseline"], targetRepo);
  const actualFullTestsFailed = !commandPasses(["npm", "run", "test:full"], targetRepo);
  const outputBase = {
    ...base,
    structured_output_valid: true,
    baseline_tests_run: output.baseline_tests_run,
    baseline_tests_passed: actualBaselineTestsPassed,
    full_tests_run: true,
    full_tests_expected_to_fail: output.full_tests_expected_to_fail,
    full_tests_failed: actualFullTestsFailed,
    known_gap_seeded: output.known_gap_seeded
  };

  if (!output.changed_files.includes("src/project-name.js")) {
    return {
      ...outputBase,
      status: "FAILED",
      failure_category: "INITIAL_DEV_NO_FILE_CHANGE",
      errors: [...base.errors, "changed_files must include src/project-name.js."]
    };
  }

  if (!base.file_change_verified) {
    return {
      ...outputBase,
      status: "FAILED",
      failure_category: "INITIAL_DEV_NO_FILE_CHANGE",
      errors: [...base.errors, "src/project-name.js did not change by hash, git diff, or SDK event evidence."]
    };
  }

  if (!output.baseline_tests_run) {
    return {
      ...outputBase,
      status: "FAILED",
      failure_category: "INITIAL_DEV_NO_BASELINE_TEST",
      errors: [...base.errors, "Initial dev worker must run npm run test:baseline."]
    };
  }

  if (!output.baseline_tests_passed || !actualBaselineTestsPassed) {
    return {
      ...outputBase,
      status: "FAILED",
      failure_category: "INITIAL_DEV_BASELINE_TESTS_FAILED",
      errors: [...base.errors, "Initial dev worker baseline tests did not pass."]
    };
  }

  if (!output.full_tests_expected_to_fail || !output.full_tests_failed || !actualFullTestsFailed) {
    return {
      ...outputBase,
      status: "FAILED",
      failure_category: "SEEDED_GAP_NOT_PRESERVED",
      errors: [...base.errors, "Full tests must fail in the initial seeded-gap stage."]
    };
  }

  if (!output.known_gap_seeded) {
    return {
      ...outputBase,
      status: "FAILED",
      failure_category: "INITIAL_DEV_SEEDED_GAP_CONTRACT_FAILED",
      errors: [...base.errors, "Initial dev worker must report known_gap_seeded=true."]
    };
  }

  writeTargetJson(targetRepo, input.artifact_path ?? "artifacts/dev-result.json", {
    status: "PASS",
    changed_files: output.changed_files,
    baseline_tests_run: output.baseline_tests_run,
    baseline_tests_passed: actualBaselineTestsPassed,
    full_tests_run: true,
    full_tests_expected_to_fail: output.full_tests_expected_to_fail,
    full_tests_failed: actualFullTestsFailed,
    known_gap_seeded: output.known_gap_seeded,
    summary: output.summary,
    created_by_runtime: "sdk-orchestrated",
    created_by_role: "dev_worker",
    created_by_thread_id: threadId
  });

  const artifactExists = existsSync(resolve(targetRepo, input.artifact_path ?? "artifacts/dev-result.json"));
  if (!artifactExists) {
    return {
      ...outputBase,
      status: "FAILED",
      failure_category: "INITIAL_DEV_RESULT_MISSING",
      errors: [...base.errors, "Initial DevResult artifact was not created."]
    };
  }

  return {
    ...outputBase,
    status: "PASS",
    failure_category: "",
    thread_id: threadId,
    dev_worker_thread_started: true,
    dev_worker_thread_id: threadId,
    file_change_verified: true,
    artifact_thread_evidence_verified: true,
    final_response_contains_expected: true,
    errors: base.errors
  };
}

function parseInitialDevWorkerSeededGapOutput(finalResponse: string): {
  status: "PASS" | "BLOCKED" | "FAILED" | "TIMEOUT";
  output?: InitialDevWorkerSeededGapOutput;
  failure_category: InitialDevWorkerSeededGapStageResult["failure_category"];
  errors: string[];
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(finalResponse) as unknown;
  } catch (error) {
    return {
      status: "FAILED",
      failure_category: "INITIAL_DEV_OUTPUT_SCHEMA_FAILURE",
      errors: [`Initial dev worker output is not valid JSON: ${error instanceof Error ? error.message : String(error)}`]
    };
  }

  if (!isInitialDevWorkerSeededGapOutput(parsed)) {
    return {
      status: "FAILED",
      failure_category: "INITIAL_DEV_RESULT_SCHEMA_INVALID",
      errors: ["Initial dev worker output does not match the seeded-gap output shape."]
    };
  }

  return {
    status: parsed.status,
    output: parsed,
    failure_category: "",
    errors: []
  };
}

function initialDevWorkerBaselinePreflight(
  input: InitialDevWorkerSeededGapStageInput,
  runtimeInput: RuntimeThreadInput,
  baselinePath: string,
  baseline: ReturnType<typeof readDevWorkerBaseline>
): InitialDevWorkerSeededGapStageResult | null {
  const repoRoot = input.repo_root ?? process.cwd();
  const targetRepo = resolve(input.target_repo);
  const mutation = verifyDevWorkerMutationEvidence({
    target_repo: targetRepo,
    baseline_path: baselinePath,
    events_path: runtimeInput.error_capture_paths?.events_path
  });
  const base: InitialDevWorkerSeededGapStageResult = {
    status: "BLOCKED",
    failure_category: "",
    thread_id: "",
    dev_worker_thread_started: false,
    dev_worker_thread_id: "",
    known_gap_seeded: false,
    file_change_verified: false,
    baseline_tests_run: false,
    baseline_tests_passed: false,
    full_tests_run: false,
    full_tests_expected_to_fail: false,
    full_tests_failed: false,
    dev_result_path: relative(repoRoot, resolve(targetRepo, input.artifact_path ?? "artifacts/dev-result.json")),
    artifact_thread_evidence_verified: false,
    structured_output_valid: false,
    final_response_contains_expected: false,
    event_count: countEvents(runtimeInput.error_capture_paths?.events_path),
    no_event_timeout: false,
    last_event_type: "",
    elapsed_ms: 0,
    runtime_input: runtimeInput,
    errors: []
  };

  if (!baseline) {
    return {
      ...base,
      failure_category: "BLOCKED_DEV_WORKER_BASELINE_MISSING",
      errors: ["Dev worker baseline is missing. Run npm run gate6b2:prepare first."]
    };
  }
  if (
    baseline.fixture_status !== "BROKEN_AS_EXPECTED" ||
    baseline.initial_baseline_tests_failed !== true ||
    baseline.initial_full_tests_failed !== true ||
    baseline.seeded_gap_fixture_created !== true ||
    !baseline.src_project_name_hash_before
  ) {
    return {
      ...base,
      failure_category: baseline.fixture_status === "BLOCKED_TARGET_FIXTURE_NOT_BROKEN" ? "BLOCKED_TARGET_FIXTURE_NOT_BROKEN" : "BLOCKED_DEV_WORKER_BASELINE_MISSING",
      errors: ["Dev worker baseline does not prove a seeded-gap broken starting fixture."]
    };
  }
  if (!mutation.test_project_name_baseline_test_exists || !mutation.test_project_name_full_test_exists) {
    return {
      ...base,
      failure_category: "BLOCKED_DEV_WORKER_BASELINE_MISSING",
      errors: ["Gate 6B.2 split baseline/full test fixture is missing."]
    };
  }
  return null;
}

export function writeInitialDevWorkerInvocationArtifacts(input: RuntimeThreadInput, options: { tracePath?: string; outputSchemaPath?: string } = {}): void {
  const tracePath = options.tracePath ?? input.invocation_trace_path;
  const outputSchemaPath = options.outputSchemaPath;
  if (outputSchemaPath) {
    writeJson(resolve(outputSchemaPath), input.output_schema ?? initialDevWorkerSeededGapOutputSchema);
  }
  if (tracePath) {
    writeJson(resolve(tracePath), {
      mode: "initial-dev-worker-seeded-gap",
      uses_output_schema: true,
      output_schema_kind: "initial-dev-worker-seeded-gap",
      output_schema_hash: stableHash(input.output_schema ?? initialDevWorkerSeededGapOutputSchema),
      prompt_length: input.prompt.length,
      prompt_hash: stableHash(input.prompt),
      working_directory: input.working_directory,
      model: input.codex_model ?? DEFAULT_CODEX_MODEL,
      model_catalog_json: input.model_catalog_json ?? "",
      sandbox_mode: input.sandbox,
      sdk_method: "runStreamed",
      initial_dev_worker_stage_impl: INITIAL_DEV_WORKER_SEEDED_GAP_STAGE_IMPL
    });
  }
}

function isInitialDevWorkerSeededGapOutput(value: unknown): value is InitialDevWorkerSeededGapOutput {
  if (!isRecord(value)) return false;
  return (
    (value.status === "PASS" || value.status === "BLOCKED" || value.status === "FAILED" || value.status === "TIMEOUT") &&
    isStringArray(value.changed_files) &&
    typeof value.baseline_tests_run === "boolean" &&
    typeof value.baseline_tests_passed === "boolean" &&
    typeof value.full_tests_run === "boolean" &&
    typeof value.full_tests_expected_to_fail === "boolean" &&
    typeof value.full_tests_failed === "boolean" &&
    typeof value.known_gap_seeded === "boolean" &&
    typeof value.summary === "string"
  );
}

function classifyThreadStartupFailure(thread: RuntimeThreadResult, fallback: InitialDevWorkerSeededGapStageResult["failure_category"]): InitialDevWorkerSeededGapStageResult["failure_category"] {
  if (thread.errors.some((error) => /THREAD_ID_MISSING|thread_id|thread id/i.test(error))) return "THREAD_ID_MISSING";
  if (thread.failure_category === "SDK_OUTPUT_SCHEMA_CAUSES_THREAD_START_FAILURE") return "DEV_WORKER_OUTPUT_SCHEMA_CAUSES_THREAD_START_FAILURE";
  if (thread.failure_category) return normalizeFailureCategory(thread.failure_category);
  if (thread.status === "TIMEOUT") return "SDK_THREAD_TIMEOUT";
  return fallback;
}

function normalizeFailureCategory(category: string | undefined): InitialDevWorkerSeededGapStageResult["failure_category"] {
  const allowed = new Set<string>([
    "INITIAL_DEV_OUTPUT_SCHEMA_FAILURE",
    "INITIAL_DEV_RESULT_SCHEMA_INVALID",
    "INITIAL_DEV_BASELINE_TESTS_FAILED",
    "INITIAL_DEV_NO_FILE_CHANGE",
    "INITIAL_DEV_NO_BASELINE_TEST",
    "INITIAL_DEV_RESULT_MISSING",
    "INITIAL_DEV_SEEDED_GAP_CONTRACT_FAILED",
    "SEEDED_GAP_NOT_PRESERVED",
    "DEV_WORKER_TEST_DELETED",
    "DEV_WORKER_THREAD_STARTUP_FAILURE",
    "THREAD_ID_MISSING",
    "SDK_THREAD_TIMEOUT",
    "BLOCKED_DEV_WORKER_BASELINE_MISSING",
    "BLOCKED_TARGET_FIXTURE_NOT_BROKEN",
    "DEV_WORKER_OUTPUT_SCHEMA_CAUSES_THREAD_START_FAILURE"
  ]);
  return category && allowed.has(category) ? category as InitialDevWorkerSeededGapStageResult["failure_category"] : "";
}

function mapThreadFailure(thread: RuntimeThreadResult, threadId: string): "DEV_WORKER_THREAD_STARTUP_FAILURE" | "TIMEOUT" | "" {
  if (thread.status === "TIMEOUT") return "TIMEOUT";
  if (thread.status === "BLOCKED" && !threadId) return "DEV_WORKER_THREAD_STARTUP_FAILURE";
  if (thread.status === "FAILED" && !threadId) return "DEV_WORKER_THREAD_STARTUP_FAILURE";
  return "";
}

function readTargetSource(targetRepo: string): string {
  try {
    return readFileSync(resolve(targetRepo, "src/project-name.js"), "utf8");
  } catch {
    return "";
  }
}

function commandPasses(command: string[], cwd: string): boolean {
  try {
    execFileSync(command[0] ?? "", command.slice(1), {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
    return true;
  } catch {
    return false;
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

function stableHash(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return createHash("sha256").update(text ?? "").digest("hex");
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
