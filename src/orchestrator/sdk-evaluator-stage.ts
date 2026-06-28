import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";

import { DEFAULT_CODEX_MODEL } from "../runtime/sdk-runtime-adapter.ts";
import type { RuntimeThreadInput, RuntimeThreadResult } from "../runtime/runtime-types.ts";
import { hydrateEvalReport } from "./hydrate-eval-report.ts";
import { evaluatorLiteOutputSchema, parseEvaluatorLiteOutput } from "./parse-evaluator-lite-output.ts";
import type { EvaluatorStageInput, EvaluatorStageResult } from "./sdk-evaluator-stage-types.ts";
import { validateEvalReportArtifact } from "./validate-eval-report-artifacts.ts";

export { evaluatorLiteOutputSchema };

export const EVALUATOR_STAGE_IMPL = "runEvaluatorLiteStage";

export function buildEvaluatorStagePrompt(input: Pick<EvaluatorStageInput, "prd_path" | "task_graph_path" | "dev_result_path">): string {
  return [
    "$codex-loop SDK-Orchestrated Smoke",
    "Role: evaluator",
    `Read ${input.prd_path}, ${input.task_graph_path}, ${input.dev_result_path}, src/project-name.js, test/project-name.baseline.test.js, and test/project-name.full.test.js.`,
    "Do not modify files.",
    "Evaluate validateProjectName(name) against acceptance criteria, seeded-gap DevResult evidence, and npm test evidence.",
    "Return JSON matching the evaluator-lite output schema.",
    "findings_json must be a JSON string containing an array.",
    "For PASS, findings_json may be \"[]\".",
    "For NEEDS_REVISION, findings_json must include at least one finding object.",
    "For the initial Gate 6B.2 seeded-gap evaluation, known_gap_seeded=true with full-test failure for whitespace-only input must produce NEEDS_REVISION, not PASS.",
    "verdict must be PASS only when source, tests, and DevResult evidence support it.",
    "validation_commands_checked must include npm test."
  ].join("\n");
}

export function createEvaluatorRuntimeInput(input: EvaluatorStageInput): RuntimeThreadInput {
  const repoRoot = input.repo_root ?? process.cwd();
  const reportDir = input.report_dir ?? resolve(repoRoot, "evals/sdk-orchestrated/reports/sdk-startup-triage");
  const prompt = input.prompt_override ?? buildEvaluatorStagePrompt(input);
  return {
    role: "evaluator",
    loop_run_id: input.loop_run_id,
    task_id: input.task_id,
    prompt,
    sandbox: input.sandbox,
    working_directory: input.target_repo,
    timeout_ms: input.timeout_ms,
    output_schema_path: "",
    output_schema: evaluatorLiteOutputSchema,
    codex_model: input.model ?? process.env.CODEX_LOOP_CODEX_MODEL ?? DEFAULT_CODEX_MODEL,
    model_catalog_json: input.model_catalog_json || undefined,
    codex_config_overrides: {},
    skip_git_repo_check: false,
    direct_cli_parity_status: "PASS",
    invocation_trace_path: input.invocation_trace_path ?? resolve(reportDir, "evaluator-smoke-output-lite-invocation-trace-redacted.json"),
    invocation_trace_label: input.invocation_trace_label ?? "gate6b-evaluator-smoke-output-lite",
    error_capture_paths: {
      events_path: input.events_path ?? resolve(reportDir, "evaluator-smoke-output-lite-events.jsonl"),
      stdout_path: input.stdout_path ?? resolve(reportDir, "evaluator-smoke-output-lite-stdout.log"),
      stderr_path: input.stderr_path ?? resolve(reportDir, "evaluator-smoke-output-lite-stderr.log"),
      result_path: input.result_path
    },
    no_event_timeout_ms: input.no_event_timeout_ms ?? Number.parseInt(process.env.CODEX_LOOP_SDK_NO_EVENT_TIMEOUT_MS ?? "30000", 10),
    env: {
      CODEX_SQLITE_HOME: input.sqlite_home
    }
  };
}

export async function runEvaluatorLiteStage(input: EvaluatorStageInput): Promise<EvaluatorStageResult> {
  const runtimeInput = createEvaluatorRuntimeInput(input);
  const repoRoot = input.repo_root ?? process.cwd();
  const reportDir = input.report_dir ?? resolve(repoRoot, "evals/sdk-orchestrated/reports/sdk-startup-triage");
  writeEvaluatorInvocationArtifacts(runtimeInput, {
    repoRoot,
    tracePath: resolve(reportDir, "evaluator-output-lite-invocation-trace-redacted.json"),
    sdkMethod: input.sdk_method ?? "runStreamed"
  });
  const thread = input.sdk_method !== "run" && input.runtime_adapter.runThreadStreamed
    ? await input.runtime_adapter.runThreadStreamed(runtimeInput)
    : await input.runtime_adapter.runThread(runtimeInput);
  return evaluateEvaluatorThread(input, runtimeInput, thread);
}

export const runEvaluatorStage = runEvaluatorLiteStage;

export function evaluateEvaluatorThread(
  input: EvaluatorStageInput,
  runtimeInput: RuntimeThreadInput,
  thread: RuntimeThreadResult
): EvaluatorStageResult {
  const repoRoot = input.repo_root ?? process.cwd();
  const targetRepo = resolve(input.target_repo);
  const threadId = thread.thread_id;
  const base: EvaluatorStageResult = {
    status: "FAILED",
    failure_category: thread.failure_category ?? "",
    evaluator_thread_started: Boolean(threadId),
    evaluator_thread_id: threadId,
    structured_output_valid: false,
    eval_report_path: relative(repoRoot, resolve(targetRepo, input.artifact_path ?? "artifacts/eval-report.json")),
    eval_report_created: false,
    eval_verdict: "",
    artifact_thread_evidence_verified: false,
    final_response_contains_expected: false,
    event_count: countEvents(runtimeInput.error_capture_paths?.events_path),
    no_event_timeout: thread.no_event_timeout === true,
    last_event_type: thread.last_event_type ?? "",
    elapsed_ms: thread.elapsed_ms ?? 0,
    runtime_input: runtimeInput,
    errors: [...thread.errors]
  };

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
      failure_category: classifyThreadStartupFailure(thread, "EVALUATOR_THREAD_STARTUP_FAILURE"),
      errors: [...base.errors, "Evaluator stage did not produce a thread id."]
    };
  }

  const parsed = parseEvaluatorLiteOutput(thread.final_response);
  if (parsed.status !== "PASS" || !parsed.output) {
    return {
      ...base,
      status: "NEEDS_REVISION",
      failure_category: parsed.failure_category || "EVALUATOR_LITE_OUTPUT_SCHEMA_FAILED",
      errors: [...base.errors, ...parsed.errors]
    };
  }

  const output = parsed.output;
  const hydrated = hydrateEvalReport({
    loop_run_id: input.loop_run_id,
    task_id: input.task_id,
    module_id: "Gate6B",
    evaluator_agent_id: "sdk-evaluator",
    evaluator_thread_id: threadId,
    output,
    findings: parsed.findings
  });
  if (hydrated.status !== "PASS" || !hydrated.eval_report) {
    return {
      ...base,
      status: "NEEDS_REVISION",
      structured_output_valid: true,
      eval_verdict: output.verdict,
      failure_category: hydrated.failure_category,
      errors: [...base.errors, ...hydrated.errors]
    };
  }

  if (!output.validation_commands_checked.some((command) => command === "npm test" || command.includes("npm test"))) {
    return {
      ...base,
      status: "NEEDS_REVISION",
      structured_output_valid: true,
      eval_verdict: output.verdict,
      failure_category: "EVALUATOR_NO_TEST_EVIDENCE",
      errors: [...base.errors, "validation_commands_checked must include npm test."]
    };
  }

  const artifactValidation = validateEvalReportArtifact(hydrated.eval_report);
  if (artifactValidation.status !== "PASS") {
    return {
      ...base,
      status: "NEEDS_REVISION",
      structured_output_valid: true,
      eval_verdict: output.verdict,
      failure_category: artifactValidation.failure_category,
      errors: [...base.errors, ...artifactValidation.errors]
    };
  }

  writeTargetJson(targetRepo, input.artifact_path ?? "artifacts/eval-report.json", hydrated.eval_report);

  return {
    ...base,
    status: output.verdict === "PASS" ? "PASS" : "NEEDS_REVISION",
    failure_category: "",
    structured_output_valid: true,
    eval_report_created: existsSync(resolve(targetRepo, input.artifact_path ?? "artifacts/eval-report.json")),
    eval_verdict: output.verdict,
    artifact_thread_evidence_verified: existsSync(resolve(targetRepo, input.artifact_path ?? "artifacts/eval-report.json")),
    final_response_contains_expected: output.verdict === "PASS",
    errors: base.errors
  };
}

export function writeEvaluatorInvocationArtifacts(input: RuntimeThreadInput, options: { repoRoot?: string; tracePath?: string; outputSchemaPath?: string; sdkMethod?: "run" | "runStreamed" } = {}): void {
  const repoRoot = options.repoRoot ?? process.cwd();
  const tracePath = options.tracePath ?? input.invocation_trace_path;
  const outputSchemaPath = options.outputSchemaPath ?? resolve(repoRoot, "evals/sdk-orchestrated/reports/sdk-startup-triage/evaluator-smoke-output-schema-lite.inline.json");
  if (outputSchemaPath) {
    writeJson(resolve(outputSchemaPath), input.output_schema ?? evaluatorLiteOutputSchema);
  }
  if (tracePath) {
    writeJson(resolve(tracePath), {
      mode: "output-lite",
      uses_output_schema: true,
      output_schema_kind: "evaluator-lite",
      output_schema_path: outputSchemaPath,
      output_schema_exists: existsSync(resolve(outputSchemaPath)),
      output_schema_hash: stableHash(input.output_schema ?? evaluatorLiteOutputSchema),
      output_schema_keys: Object.keys(isRecord(input.output_schema) ? input.output_schema : {}).sort(),
      prompt_length: input.prompt.length,
      prompt_hash: stableHash(input.prompt),
      working_directory: input.working_directory,
      model: input.codex_model ?? DEFAULT_CODEX_MODEL,
      model_catalog_json: input.model_catalog_json ?? "",
      sandbox_mode: input.sandbox,
      sdk_method: options.sdkMethod ?? "runStreamed",
      thread_options_keys: ["approvalPolicy", "model", "networkAccessEnabled", "sandboxMode", "skipGitRepoCheck", "workingDirectory"],
      run_options_keys: input.output_schema || input.output_schema_path ? ["outputSchema", "signal"] : ["signal"],
      evaluator_stage_shared: true,
      evaluator_stage_impl: EVALUATOR_STAGE_IMPL,
      full_eval_report_schema_in_output_schema: false,
      eval_report_hydration: true
    });
  }
}

function classifyThreadStartupFailure(thread: RuntimeThreadResult, fallback: string): string {
  if (thread.errors.some((error) => /THREAD_ID_MISSING|thread_id|thread id/i.test(error))) return "THREAD_ID_MISSING";
  if (thread.failure_category === "SDK_OUTPUT_SCHEMA_CAUSES_THREAD_START_FAILURE") return "EVALUATOR_LITE_OUTPUT_SCHEMA_FAILED";
  if (thread.failure_category) return thread.failure_category;
  if (thread.status === "TIMEOUT") return "SDK_THREAD_TIMEOUT";
  return fallback;
}

function mapThreadFailure(thread: RuntimeThreadResult, threadId: string): "EVALUATOR_THREAD_STARTUP_FAILURE" | "TIMEOUT" | "" {
  if (thread.status === "TIMEOUT") return "TIMEOUT";
  if (thread.status === "BLOCKED" && !threadId) return "EVALUATOR_THREAD_STARTUP_FAILURE";
  if (thread.status === "FAILED" && !threadId) return "EVALUATOR_THREAD_STARTUP_FAILURE";
  return "";
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
