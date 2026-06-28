import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";

import { DEFAULT_CODEX_MODEL } from "../runtime/sdk-runtime-adapter.ts";
import type { RuntimeThreadInput, RuntimeThreadResult } from "../runtime/runtime-types.ts";
import { plannerLiteOutputSchema } from "./planner-lite-output.ts";
import { plannerLiteV2OutputSchema } from "./planner-lite-v2-output.ts";
import { validatePlannerLiteArtifacts } from "./validate-planner-artifacts.ts";
import type {
  PlannerLiteInvocationSnapshot,
  PlannerLiteStageInput,
  PlannerLiteStageResult
} from "./sdk-planner-stage-types.ts";

export const PLANNER_LITE_STAGE_IMPL = "runPlannerLiteStage";
export const PLANNER_LITE_OUTPUT_SCHEMA_PATH = "evals/sdk-orchestrated/schemas/planner-lite-output.schema.json";
export const PLANNER_LITE_V2_OUTPUT_SCHEMA_PATH = "evals/sdk-orchestrated/schemas/planner-lite-v2-output.schema.json";

export function buildPlannerLiteStagePrompt(outputContractVersion: "v1" | "v2" = "v1"): string {
  if (outputContractVersion === "v2") {
    return [
      "Return JSON matching the planner-lite-v2 output schema.",
      "Fields: status, prd_markdown, tasks, acceptance_criteria, risks.",
      "Do not include task_graph_json.",
      "tasks must be a direct array of lightweight task objects.",
      "Each task must include id, title, description, acceptance_criteria, likely_files, and validation_commands.",
      "The orchestrator will hydrate these lightweight tasks into the canonical TaskGraph."
    ].join("\n");
  }
  return [
    "Return JSON matching the planner-lite output schema.",
    "Fields: status, prd_markdown, task_graph_json, acceptance_criteria, risks.",
    "task_graph_json must be a JSON string containing a lightweight task graph that the orchestrator can hydrate.",
    "Each task should include id or task_id, title, description, acceptance_criteria, files, validation, and dependencies when known.",
    "Do not nest the TaskGraph object directly in the SDK outputSchema response."
  ].join("\n");
}

export function createPlannerLiteRuntimeInput(input: PlannerLiteStageInput): RuntimeThreadInput {
  const repoRoot = input.repo_root ?? process.cwd();
  const reportDir = input.report_dir ?? resolve(repoRoot, "evals/sdk-orchestrated/reports/sdk-startup-triage");
  const outputContractVersion = input.output_contract_version ?? "v1";
  const prompt = input.prompt_override ?? buildPlannerLiteStagePrompt(outputContractVersion);
  return {
    role: "planner",
    loop_run_id: input.loop_run_id,
    task_id: input.task_id ?? "task_gate6b_planner_smoke",
    prompt,
    sandbox: input.sandbox,
    working_directory: input.target_repo,
    timeout_ms: input.timeout_ms,
    output_schema_path: "",
    output_schema: input.output_schema ?? (outputContractVersion === "v2" ? plannerLiteV2OutputSchema : plannerLiteOutputSchema),
    codex_model: input.model ?? process.env.CODEX_LOOP_CODEX_MODEL ?? DEFAULT_CODEX_MODEL,
    model_catalog_json: input.model_catalog_json || undefined,
    codex_config_overrides: {},
    skip_git_repo_check: false,
    direct_cli_parity_status: "PASS",
    invocation_trace_path: input.invocation_trace_path ?? resolve(reportDir, "planner-smoke-schema-output-lite-invocation-trace-redacted.json"),
    invocation_trace_label: input.invocation_trace_label ?? (outputContractVersion === "v2" ? "gate6b-planner-smoke-schema-output-lite-v2" : "gate6b-planner-smoke-schema-output-lite"),
    error_capture_paths: {
      events_path: input.events_path ?? resolve(reportDir, "planner-smoke-schema-output-lite-events.jsonl"),
      stdout_path: input.stdout_path ?? resolve(reportDir, "planner-smoke-schema-output-lite-stdout.log"),
      stderr_path: input.stderr_path ?? resolve(reportDir, "planner-smoke-schema-output-lite-stderr.log"),
      result_path: input.result_path
    },
    no_event_timeout_ms: input.no_event_timeout_ms ?? Number.parseInt(process.env.CODEX_LOOP_SDK_NO_EVENT_TIMEOUT_MS ?? "30000", 10),
    env: {
      CODEX_SQLITE_HOME: input.sqlite_home
    }
  };
}

export async function runPlannerLiteStage(input: PlannerLiteStageInput): Promise<PlannerLiteStageResult> {
  const runtimeInput = createPlannerLiteRuntimeInput(input);
  const repoRoot = input.repo_root ?? process.cwd();
  const reportDir = input.report_dir ?? resolve(repoRoot, "evals/sdk-orchestrated/reports/sdk-startup-triage");
  const schemaTracePath = input.invocation_trace_path
    ? input.invocation_trace_path.replace(/-invocation-trace-redacted\.json$/, "-schema-invocation-trace-redacted.json")
    : resolve(reportDir, "planner-schema-invocation-trace-redacted.json");
  writePlannerLiteInvocationArtifacts(runtimeInput, {
    repoRoot,
    tracePath: schemaTracePath,
    outputContractVersion: input.output_contract_version ?? "v1",
    outputSchemaKind: input.output_schema_kind ?? "lite",
    artifactValidatorName: input.artifact_validator ? "adversarial-compact-hydrator" : "default-planner-lite"
  });
  if (schemaTracePath !== resolve(reportDir, "planner-schema-invocation-trace-redacted.json")) {
    writePlannerLiteInvocationArtifacts(runtimeInput, {
      repoRoot,
      tracePath: resolve(reportDir, "planner-schema-invocation-trace-redacted.json"),
      outputContractVersion: input.output_contract_version ?? "v1",
      outputSchemaKind: input.output_schema_kind ?? "lite",
      artifactValidatorName: input.artifact_validator ? "adversarial-compact-hydrator" : "default-planner-lite"
    });
  }
  const thread = input.runtime_adapter.runThreadStreamed
    ? await input.runtime_adapter.runThreadStreamed(runtimeInput)
    : await input.runtime_adapter.runThread(runtimeInput);
  return evaluatePlannerLiteThread(input, runtimeInput, thread);
}

export function evaluatePlannerLiteThread(
  input: PlannerLiteStageInput,
  runtimeInput: RuntimeThreadInput,
  thread: RuntimeThreadResult
): PlannerLiteStageResult {
  const repoRoot = input.repo_root ?? process.cwd();
  const targetRepo = resolve(input.target_repo);
  const threadId = thread.thread_id;
  const outputContractVersion = input.output_contract_version ?? "v1";
  const rawOutputPath = runtimeInput.error_capture_paths?.stdout_path ?? thread.stdout_path ?? "";
  const redactedOutputPath = rawOutputPath ? rawOutputPath.replace(/(\.[^.]+)?$/, "-redacted$1") : "";
  if (redactedOutputPath) {
    writeTextFile(redactedOutputPath, redactSensitiveText(thread.final_response));
  }
  const base: PlannerLiteStageResult = {
    status: "FAILED",
    failure_category: thread.failure_category ?? "",
    planner_thread_started: Boolean(threadId),
    planner_thread_id: threadId,
    structured_output_valid: false,
    prd_artifact_created: false,
    task_graph_artifact_created: false,
    task_graph_schema_valid: false,
    artifact_thread_evidence_verified: false,
    prd_path: relative(repoRoot, resolve(targetRepo, "docs/PRD.md")),
    task_graph_path: relative(repoRoot, resolve(targetRepo, "docs/TASK_GRAPH.json")),
    planner_result_path: relative(repoRoot, resolve(targetRepo, "artifacts/planner-result.json")),
    final_response_contains_expected: false,
    event_count: countEvents(runtimeInput.error_capture_paths?.events_path),
    no_event_timeout: thread.no_event_timeout === true,
    last_event_type: thread.last_event_type ?? "",
    elapsed_ms: thread.elapsed_ms ?? 0,
    runtime_input: runtimeInput,
    output_contract_version: outputContractVersion,
    raw_output_path: rawOutputPath,
    redacted_output_path: redactedOutputPath,
    events_path: runtimeInput.error_capture_paths?.events_path ?? thread.events_path ?? "",
    errors: [...thread.errors]
  };

  const timeoutCategory = mapThreadFailure(thread, threadId);
  if (timeoutCategory) {
    const missingThreadId = thread.errors.some((error) => /THREAD_ID_MISSING|thread_id|thread id/i.test(error));
    return {
      ...base,
      status: timeoutCategory === "TIMEOUT" ? "TIMEOUT" : "BLOCKED",
      failure_category: missingThreadId ? "THREAD_ID_MISSING" : thread.failure_category || timeoutCategory
    };
  }

  if (!threadId) {
    return {
      ...base,
      status: "BLOCKED",
      failure_category: thread.errors.some((error) => /THREAD_ID_MISSING|thread id/i.test(error)) ? "THREAD_ID_MISSING" : (thread.failure_category ?? "THREAD_ID_MISSING"),
      errors: [...base.errors, "Planner lite stage did not produce a thread id."]
    };
  }

  const validationOptions = {
    loop_run_id: input.loop_run_id,
    prd_artifact_id: "artifact_prd_gate6b_planner",
    root_goal: input.root_goal ?? "Validate project names",
    default_module_id: "M1",
    default_owner_agent_type: "dev_worker",
    default_owner_agent_id: "sdk-dev-worker",
    default_reviewer_agent_type: "evaluator",
    default_reviewer_agent_id: "sdk-evaluator",
    default_validation_commands: input.default_validation_commands ?? ["npm test"],
    default_likely_files: input.default_likely_files ?? ["src/project-name.js"],
    now: new Date().toISOString(),
    preferred_contract_version: outputContractVersion
  } as const;
  const validation = input.artifact_validator
    ? input.artifact_validator(thread.final_response, { ...validationOptions, target_repo: targetRepo })
    : validatePlannerLiteArtifacts(thread.final_response, validationOptions);
  if (validation.status !== "PASS") {
    return {
      ...base,
      status: "NEEDS_REVISION",
      failure_category: validation.failure_category || "PLANNER_LITE_POSTPROCESS_FAILED",
      errors: [...base.errors, ...validation.errors]
    };
  }

  const metadata = {
    created_by_runtime: "sdk-orchestrated",
    created_by_role: "planner",
    created_by_thread_id: threadId
  };
  writeTargetText(targetRepo, "docs/PRD.md", withFrontMatter(validation.prd_markdown, metadata));
  writeTargetJson(targetRepo, "docs/TASK_GRAPH.json", validation.task_graph);
  writeTargetJson(targetRepo, "artifacts/planner-result.json", {
    status: "PASS",
    artifacts: [
      {
        artifact_type: "prd",
        artifact_path: "docs/PRD.md",
        ...metadata
      },
      {
        artifact_type: "task_graph",
        artifact_path: "docs/TASK_GRAPH.json",
        ...metadata
      }
    ],
    prd_path: "docs/PRD.md",
    task_graph_path: "docs/TASK_GRAPH.json",
    acceptance_criteria: validation.acceptance_criteria,
    risks: validation.risks,
    safety_notes: validation.safety_notes,
    planner_output_contract_version: validation.output_contract_version,
    ...metadata
  });

  return {
    ...base,
    status: "PASS",
    failure_category: "",
    structured_output_valid: true,
    prd_artifact_created: existsSync(resolve(targetRepo, "docs/PRD.md")),
    task_graph_artifact_created: existsSync(resolve(targetRepo, "docs/TASK_GRAPH.json")),
    task_graph_schema_valid: true,
    artifact_thread_evidence_verified: true,
    final_response_contains_expected: true,
    errors: base.errors
  };
}

export function plannerLiteInvocationSnapshot(input: RuntimeThreadInput, repoRoot = process.cwd()): PlannerLiteInvocationSnapshot {
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
    sdkMethod: "runStreamed",
    runOptions: input.output_schema || input.output_schema_path ? ["outputSchema", "signal"] : ["signal"],
    envKeys,
    configKeys,
    targetRepoGitStatus: gitStatus(input.working_directory, repoRoot)
  };
}

export function writePlannerLiteInvocationArtifacts(input: RuntimeThreadInput, options: {
  repoRoot?: string;
  tracePath?: string;
  outputSchemaPath?: string;
  outputContractVersion?: "v1" | "v2";
  outputSchemaKind?: string;
  artifactValidatorName?: string;
} = {}): void {
  const repoRoot = options.repoRoot ?? process.cwd();
  const tracePath = options.tracePath ?? input.invocation_trace_path;
  const outputContractVersion = options.outputContractVersion ?? (input.output_schema === plannerLiteV2OutputSchema ? "v2" : "v1");
  const outputSchemaKind = options.outputSchemaKind ?? "lite";
  const outputSchemaPath = options.outputSchemaPath ?? resolve(repoRoot, `evals/sdk-orchestrated/reports/sdk-startup-triage/planner-smoke-output-schema-lite-${outputContractVersion}.inline.json`);
  if (outputSchemaPath) {
    writeJson(resolve(outputSchemaPath), input.output_schema ?? plannerLiteOutputSchema);
  }
  if (tracePath) {
    writeJson(resolve(tracePath), {
      mode: "schema-output-lite",
      planner_output_contract_version: outputContractVersion,
      uses_output_schema: true,
      output_schema_kind: outputSchemaKind,
      planner_artifact_validator: options.artifactValidatorName ?? "default-planner-lite",
      output_schema_path: outputSchemaPath,
      output_schema_exists: existsSync(resolve(outputSchemaPath)),
      output_schema_hash: stableHash(input.output_schema ?? plannerLiteOutputSchema),
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
      planner_lite_stage_shared: true,
      planner_stage_impl: PLANNER_LITE_STAGE_IMPL
    });
  }
}

function mapThreadFailure(thread: RuntimeThreadResult, threadId: string): "BLOCKED" | "TIMEOUT" | "" {
  if (thread.status === "TIMEOUT") return "TIMEOUT";
  if (thread.status === "BLOCKED" && !threadId) return "BLOCKED";
  return "";
}

function withFrontMatter(markdown: string, metadata: Record<string, string>): string {
  return [
    "---",
    `created_by_runtime: ${metadata.created_by_runtime}`,
    `created_by_role: ${metadata.created_by_role}`,
    `created_by_thread_id: ${metadata.created_by_thread_id}`,
    "---",
    "",
    markdown.trim()
  ].join("\n");
}

function writeTargetText(targetRepo: string, path: string, value: string): void {
  const absolute = resolve(targetRepo, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, `${value.trim()}\n`, "utf8");
}

function writeTargetJson(targetRepo: string, path: string, value: unknown): void {
  writeTargetText(targetRepo, path, JSON.stringify(value, null, 2));
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeTextFile(path: string, value: string): void {
  mkdirSync(dirname(resolve(path)), { recursive: true });
  writeFileSync(resolve(path), `${value.trim()}\n`, "utf8");
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

function stableHash(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return createHash("sha256").update(text ?? "").digest("hex");
}

function redactSensitiveText(value: string): string {
  return value
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "sk-REDACTED")
    .replace(/(OPENAI_API_KEY\s*=\s*)[^\s"']+/gi, "$1REDACTED")
    .replace(/(token\s*[:=]\s*)[^\s"']+/gi, "$1REDACTED");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
