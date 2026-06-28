import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

import { PLANNER_LITE_STAGE_IMPL, runPlannerLiteStage } from "../../src/orchestrator/sdk-planner-lite-stage.ts";
import { plannerLiteOutputSchema } from "../../src/orchestrator/planner-lite-output.ts";
import { validatePlannerLiteArtifacts } from "../../src/orchestrator/validate-planner-artifacts.ts";
import { ensureEvalSqliteHome } from "../../src/runtime/eval-sqlite-home.ts";
import { DEFAULT_CODEX_MODEL, SdkRuntimeAdapter } from "../../src/runtime/sdk-runtime-adapter.ts";
import type { RuntimeThreadInput, RuntimeThreadResult } from "../../src/runtime/runtime-types.ts";

type PlannerMode = "minimal" | "schema-text-only" | "schema-output-minimal" | "schema-output-lite" | "schema-output-planner" | "schema" | "exact" | "parity-as-planner";
type CanonicalPlannerMode = Exclude<PlannerMode, "schema">;
type PlannerStatus =
  | "PASS"
  | "FAIL"
  | "BLOCKED_SDK_PLANNER_NOT_ENABLED"
  | "BLOCKED_SDK_NOT_INSTALLED"
  | "BLOCKED_NODE_VERSION"
  | "BLOCKED_EVAL_SQLITE_HOME_NOT_WRITABLE"
  | "PLANNER_OUTPUT_SCHEMA_FAILURE"
  | "PLANNER_PROMPT_OR_ARTIFACT_FAILURE"
  | "PLANNER_SCHEMA_TEXT_ONLY_FAILED"
  | "PLANNER_OUTPUT_SCHEMA_MINIMAL_FAILED"
  | "PLANNER_OUTPUT_SCHEMA_PLANNER_FAILED"
  | "PLANNER_SCHEMA_TOO_COMPLEX_FOR_OUTPUT_SCHEMA"
  | "PLANNER_LITE_OUTPUT_SCHEMA_FAILED"
  | "PLANNER_TASK_GRAPH_JSON_INVALID"
  | "PLANNER_TASK_GRAPH_HYDRATION_FAILED"
  | "PLANNER_TASK_GRAPH_SCHEMA_INVALID"
  | "PLANNER_V2_TASKS_EMPTY"
  | "PLANNER_V2_TASKS_SCHEMA_INVALID"
  | "PLANNER_CANONICAL_HYDRATION_FAILED"
  | "PLANNER_PRD_EMPTY"
  | "PLANNER_ACCEPTANCE_CRITERIA_EMPTY"
  | "PLANNER_LITE_POSTPROCESS_FAILED"
  | "ADVERSARIAL_PLANNER_OUTPUT_TRUNCATED"
  | "ADVERSARIAL_PLANNER_JSON_INVALID"
  | "ADVERSARIAL_PLANNER_OUTPUT_SCHEMA_TOO_LARGE"
  | "ADVERSARIAL_PLANNER_TREATMENT_PATH_MISMATCH"
  | "ADVERSARIAL_PLANNER_COMPACT_HYDRATION_FAILED"
  | "ADVERSARIAL_PLANNER_ARTIFACT_WRITE_FAILED"
  | "ADVERSARIAL_COMPACT_PLANNER_NO_FINAL_OUTPUT"
  | "ADVERSARIAL_COMPACT_PLANNER_OUTPUT_SCHEMA_NOT_PASSED"
  | "ADVERSARIAL_COMPACT_PLANNER_OUTPUT_SCHEMA_TOO_COMPLEX"
  | "ADVERSARIAL_COMPACT_PLANNER_STRUCTURED_OUTPUT_INVALID"
  | "ADVERSARIAL_COMPACT_PLANNER_RAW_JSON_RECOVERABLE"
  | "ADVERSARIAL_COMPACT_PLANNER_PARSER_FIELD_MISMATCH"
  | "ADVERSARIAL_COMPACT_PLANNER_HYDRATOR_NOT_TRIGGERED"
  | "ADVERSARIAL_COMPACT_PLANNER_HYDRATION_FAILED"
  | "ADVERSARIAL_COMPACT_PLANNER_PATH_ALIGNMENT_FAILED"
  | "SDK_OUTPUT_SCHEMA_INVOCATION_FAILED"
  | "SDK_OUTPUT_SCHEMA_OBJECT_INVALID"
  | "SDK_OUTPUT_SCHEMA_CAUSES_THREAD_START_FAILURE"
  | "PLANNER_SCHEMA_COMPLEXITY_OR_FORMAT_FAILURE"
  | "SDK_PLANNER_THREAD_STARTUP_FAILURE"
  | "SDK_PLANNER_THREAD_STARTUP_TIMEOUT"
  | "SDK_PLANNER_TURN_TIMEOUT"
  | "SDK_NO_EVENT_TIMEOUT"
  | "SDK_RUN_STREAMED_UNSUPPORTED"
  | "PLANNER_MINIMAL_PROMPT_OR_HARNESS_FAILURE"
  | "PLANNER_ROLE_INVOCATION_MISMATCH"
  | "SDK_OUTPUT_SCHEMA_PATH_INVALID"
  | "SDK_OUTPUT_SCHEMA_UNSUPPORTED"
  | "SDK_PROMPT_TOO_LARGE_OR_INVALID"
  | "THREAD_ID_MISSING";

interface MockThreadLike {
  readonly id: string | null;
  run(input?: string, options?: unknown): Promise<unknown>;
  runStreamed(input?: string, options?: unknown): Promise<{ events: AsyncGenerator<unknown> }>;
}

interface MockCodexLike {
  startThread(options?: unknown): MockThreadLike;
  resumeThread(id?: string, options?: unknown): MockThreadLike;
}

interface PlannerResult {
  gate: "Gate 6B.1E Planner Thread Startup Slice";
  status: PlannerStatus;
  mode: CanonicalPlannerMode;
  requested_mode: PlannerMode;
  real_sdk_run_enabled: boolean;
  real_sdk_run_attempted: boolean;
  sdk_dependency_detected: boolean;
  node_version: string;
  node_version_ok: boolean;
  target_repo: string;
  model: string;
  model_catalog_json: string;
  sqlite_home: string;
  planner_thread_started: boolean;
  planner_thread_id: string;
  final_response_contains_expected: boolean;
  structured_output_valid: boolean;
  prd_artifact_created: boolean;
  task_graph_artifact_created: boolean;
  task_graph_schema_valid: boolean;
  artifact_thread_evidence_verified: boolean;
  planner_stage_shared: boolean;
  planner_stage_impl: string;
  events_path: string;
  event_count: number;
  no_event_timeout: boolean;
  last_event_type: string;
  elapsed_ms: number;
  failure_category: string;
  danger_full_access_used: false;
  secret_leak_detected: false;
  errors: string[];
}

const repoRoot = process.cwd();
const reportDir = process.env.CODEX_LOOP_SDK_STARTUP_TRIAGE_DIR
  ? resolve(process.env.CODEX_LOOP_SDK_STARTUP_TRIAGE_DIR)
  : resolve(repoRoot, "evals/sdk-orchestrated/reports/sdk-startup-triage");
const resultPath = process.env.CODEX_LOOP_PLANNER_SMOKE_RESULT_PATH
  ? resolve(process.env.CODEX_LOOP_PLANNER_SMOKE_RESULT_PATH)
  : resolve(reportDir, "planner-smoke-result.json");
const targetRepo = resolve(repoRoot, "tmp/sdk-orchestrated/gate6b-smoke-target");
const requestedMode = parseMode(process.env.CODEX_LOOP_PLANNER_SMOKE_MODE);
const mode = canonicalMode(requestedMode);

async function main(): Promise<void> {
  const sqliteHome = ensureEvalSqliteHome(repoRoot);
  const modelCatalogJson = resolveModelCatalogJson();
  const sdkDependencyDetected = canResolve("@openai/codex-sdk");
  const nodeVersionOk = getNodeMajorVersion() >= 18;
  const base = baseResult({
    sqliteHomePath: sqliteHome.path,
    modelCatalogJson,
    sdkDependencyDetected,
    nodeVersionOk
  });

  if (!nodeVersionOk) {
    return finish({ ...base, status: "BLOCKED_NODE_VERSION", errors: [`Node.js >= 18 is required; current version is ${process.version}.`] });
  }
  if (!sqliteHome.ok) {
    return finish({ ...base, status: "BLOCKED_EVAL_SQLITE_HOME_NOT_WRITABLE", errors: [`Eval SQLite home is not usable: ${sqliteHome.reason ?? "unknown"}`] });
  }
  const mockMode = process.env.CODEX_LOOP_GATE6B_PLANNER_SMOKE_MOCK;
  if (!mockMode && process.env.CODEX_LOOP_ENABLE_REAL_SDK_PLANNER !== "1") {
    return finish({
      ...base,
      status: "BLOCKED_SDK_PLANNER_NOT_ENABLED",
      errors: ["Set CODEX_LOOP_ENABLE_REAL_SDK_PLANNER=1 only for one controlled host-terminal planner smoke."]
    });
  }
  if (!sdkDependencyDetected) {
    return finish({ ...base, status: "BLOCKED_SDK_NOT_INSTALLED", errors: ["@openai/codex-sdk is not installed or cannot be resolved."] });
  }

  const adapter = mockMode
    ? new SdkRuntimeAdapter({ enableRealRun: true, sdkResolver: async () => createMockSdkModule(mockMode) })
    : new SdkRuntimeAdapter({ enableRealRun: true });
  if (mode === "schema-output-lite") {
    const stage = await runPlannerLiteStage({
      loop_run_id: "loop_gate6b_planner_smoke",
      task_id: "task_gate6b_planner_smoke",
      target_repo: targetRepo,
      model: process.env.CODEX_LOOP_CODEX_MODEL ?? DEFAULT_CODEX_MODEL,
      model_catalog_json: modelCatalogJson,
      sqlite_home: sqliteHome.path,
      sandbox: "read-only",
      timeout_ms: plannerTimeoutMs(),
      runtime_adapter: adapter,
      repo_root: repoRoot,
      report_dir: reportDir,
      invocation_trace_path: resolve(reportDir, `planner-smoke-${mode}-invocation-trace-redacted.json`),
      invocation_trace_label: `gate6b-planner-smoke-${mode}`,
      events_path: resolve(reportDir, `planner-smoke-${mode}-events.jsonl`),
      stdout_path: resolve(reportDir, `planner-smoke-${mode}-stdout.log`),
      stderr_path: resolve(reportDir, `planner-smoke-${mode}-stderr.log`),
      result_path: resultPath,
      no_event_timeout_ms: Number.parseInt(process.env.CODEX_LOOP_SDK_NO_EVENT_TIMEOUT_MS ?? "30000", 10)
    });
    return finish({
      ...base,
      status: stage.status === "PASS" ? "PASS" : (stage.failure_category as PlannerStatus) || "PLANNER_LITE_POSTPROCESS_FAILED",
      real_sdk_run_attempted: mockMode ? false : true,
      planner_thread_started: stage.planner_thread_started,
      planner_thread_id: stage.planner_thread_id,
      final_response_contains_expected: stage.final_response_contains_expected,
      structured_output_valid: stage.structured_output_valid,
      prd_artifact_created: stage.prd_artifact_created,
      task_graph_artifact_created: stage.task_graph_artifact_created,
      artifact_thread_evidence_verified: stage.artifact_thread_evidence_verified,
      planner_stage_shared: true,
      planner_stage_impl: PLANNER_LITE_STAGE_IMPL,
      event_count: stage.event_count,
      no_event_timeout: stage.no_event_timeout,
      last_event_type: stage.last_event_type,
      elapsed_ms: stage.elapsed_ms,
      failure_category: stage.status === "PASS" ? "" : stage.failure_category,
      errors: stage.errors
    });
  }
  const thread = await adapter.runThreadStreamed(runtimeInput(sqliteHome.path, modelCatalogJson));
  const evaluated = evaluateThread(base, thread);
  if (mockMode) {
    evaluated.real_sdk_run_attempted = false;
  }
  return finish(evaluated);
}

function baseResult(input: { sqliteHomePath: string; modelCatalogJson: string; sdkDependencyDetected: boolean; nodeVersionOk: boolean }): PlannerResult {
  return {
    gate: "Gate 6B.1E Planner Thread Startup Slice",
    status: "FAIL",
    mode,
    requested_mode: requestedMode,
    real_sdk_run_enabled: process.env.CODEX_LOOP_ENABLE_REAL_SDK_PLANNER === "1",
    real_sdk_run_attempted: false,
    sdk_dependency_detected: input.sdkDependencyDetected,
    node_version: process.version,
    node_version_ok: input.nodeVersionOk,
    target_repo: "tmp/sdk-orchestrated/gate6b-smoke-target",
    model: process.env.CODEX_LOOP_CODEX_MODEL ?? DEFAULT_CODEX_MODEL,
    model_catalog_json: input.modelCatalogJson,
    sqlite_home: input.sqliteHomePath,
    planner_thread_started: false,
    planner_thread_id: "",
    final_response_contains_expected: false,
    structured_output_valid: false,
    prd_artifact_created: false,
    task_graph_artifact_created: false,
    task_graph_schema_valid: false,
    artifact_thread_evidence_verified: false,
    planner_stage_shared: mode === "schema-output-lite",
    planner_stage_impl: mode === "schema-output-lite" ? PLANNER_LITE_STAGE_IMPL : "",
    events_path: resolve(reportDir, `planner-smoke-${mode}-events.jsonl`),
    event_count: 0,
    no_event_timeout: false,
    last_event_type: "",
    elapsed_ms: 0,
    failure_category: "",
    danger_full_access_used: false,
    secret_leak_detected: false,
    errors: []
  };
}

function runtimeInput(sqliteHomePath: string, modelCatalogJson: string): RuntimeThreadInput {
  const prompt = promptForMode();
  const outputSchema = outputSchemaForMode();
  writeSchemaInvocationTrace({
    prompt,
    outputSchema,
    modelCatalogJson
  });
  return {
    role: "planner",
    loop_run_id: "loop_gate6b_planner_smoke",
    task_id: "task_gate6b_planner_smoke",
    prompt,
    sandbox: "read-only",
    working_directory: targetRepo,
    timeout_ms: plannerTimeoutMs(),
    output_schema_path: "",
    output_schema: outputSchema,
    codex_model: process.env.CODEX_LOOP_CODEX_MODEL ?? DEFAULT_CODEX_MODEL,
    model_catalog_json: modelCatalogJson || undefined,
    codex_config_overrides: {},
    skip_git_repo_check: false,
    direct_cli_parity_status: "PASS",
    invocation_trace_path: resolve(reportDir, `planner-smoke-${mode}-invocation-trace-redacted.json`),
    invocation_trace_label: `gate6b-planner-smoke-${mode}`,
    error_capture_paths: {
      events_path: resolve(reportDir, `planner-smoke-${mode}-events.jsonl`),
      stdout_path: resolve(reportDir, `planner-smoke-${mode}-stdout.log`),
      stderr_path: resolve(reportDir, `planner-smoke-${mode}-stderr.log`),
      result_path: resultPath
    },
    no_event_timeout_ms: Number.parseInt(process.env.CODEX_LOOP_SDK_NO_EVENT_TIMEOUT_MS ?? "30000", 10),
    env: {
      CODEX_SQLITE_HOME: sqliteHomePath
    }
  };
}

function promptForMode(): string {
  if (mode === "minimal") {
    return "Respond with exactly: SDK_PLANNER_MINIMAL_OK";
  }
  if (mode === "parity-as-planner") {
    return "Respond with exactly: SDK_TARGET_DIRECT_SDK_OK";
  }
  if (mode === "schema-text-only") {
    return 'Return only this JSON object: { "status": "PASS", "message": "SDK_PLANNER_SCHEMA_TEXT_ONLY_OK" }';
  }
  if (mode === "schema-output-minimal") {
    return 'Return JSON matching the output schema: { "status": "PASS", "message": "SDK_PLANNER_OUTPUT_MINIMAL_OK" }';
  }
  if (mode === "schema-output-lite") {
    return [
      "Return JSON matching the planner-lite output schema.",
      "Fields: status, prd_markdown, task_graph_json, acceptance_criteria, risks.",
      "task_graph_json must be a JSON string containing a schema-valid TaskGraph.",
      "Do not nest the TaskGraph object directly in the SDK outputSchema response."
    ].join("\n");
  }
  if (mode === "schema-output-planner") {
    return "Return JSON matching the planner smoke schema with status PASS.";
  }
  return [
    "$codex-loop SDK-Orchestrated Smoke",
    "Role: planner",
    "Return JSON with status PASS, role planner, prd, task_graph, acceptance_criteria, risks.",
    "Do not write files directly."
  ].join("\n");
}

function outputSchemaForMode(): unknown | undefined {
  if (mode === "schema-output-minimal") {
    return minimalOutputSchema();
  }
  if (mode === "schema-output-lite") {
    return plannerLiteOutputSchema;
  }
  if (mode === "schema-output-planner" || mode === "exact") {
    return plannerSmokeSchema();
  }
  return undefined;
}

function minimalOutputSchema(): unknown {
  return {
    type: "object",
    properties: {
      status: { type: "string", enum: ["PASS"] },
      message: { type: "string" }
    },
    required: ["status", "message"],
    additionalProperties: false
  };
}

function plannerSmokeSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      status: { const: "PASS" },
      role: { const: "planner" },
      prd: { type: "object" },
      task_graph: { type: "object" },
      acceptance_criteria: { type: "array" },
      risks: { type: "array" }
    },
    required: ["status", "role"],
    additionalProperties: true
  };
}

function writeSchemaInvocationTrace(input: { prompt: string; outputSchema: unknown | undefined; modelCatalogJson: string }): void {
  if (!isSchemaTriageMode(mode)) {
    return;
  }
  const outputSchemaKind = schemaKindForMode();
  const outputSchemaPath =
    outputSchemaKind === "planner"
      ? resolve(reportDir, "planner-smoke-output-schema-planner.inline.json")
      : outputSchemaKind === "lite"
        ? resolve(reportDir, "planner-smoke-output-schema-lite.inline.json")
        : outputSchemaKind === "minimal"
          ? resolve(reportDir, "planner-smoke-output-schema-minimal.inline.json")
          : "";
  if (input.outputSchema) {
    writeJson(outputSchemaPath, input.outputSchema);
  }
  const outputSchemaRecord = isRecord(input.outputSchema) ? input.outputSchema : {};
  const trace = {
    mode,
    requested_mode: requestedMode,
    uses_output_schema: Boolean(input.outputSchema),
    output_schema_kind: outputSchemaKind,
    output_schema_path: outputSchemaPath,
    output_schema_exists: outputSchemaPath ? existsSync(outputSchemaPath) : false,
    output_schema_hash: input.outputSchema ? stableHash(input.outputSchema) : "",
    output_schema_keys: Object.keys(outputSchemaRecord).sort(),
    prompt_length: input.prompt.length,
    prompt_hash: stableHash(input.prompt),
    working_directory: targetRepo,
    model: process.env.CODEX_LOOP_CODEX_MODEL ?? DEFAULT_CODEX_MODEL,
    model_catalog_json: input.modelCatalogJson,
    sandbox_mode: "read-only",
    sdk_method: "runStreamed",
    thread_options_keys: ["approvalPolicy", "model", "networkAccessEnabled", "sandboxMode", "skipGitRepoCheck", "workingDirectory"],
    run_options_keys: input.outputSchema ? ["outputSchema", "signal"] : ["signal"]
  };
  writeJson(resolve(reportDir, "planner-schema-invocation-trace-redacted.json"), trace);
}

function isSchemaTriageMode(value: CanonicalPlannerMode): boolean {
  return value === "schema-text-only" || value === "schema-output-minimal" || value === "schema-output-lite" || value === "schema-output-planner";
}

function schemaKindForMode(): "none" | "minimal" | "lite" | "planner" {
  if (mode === "schema-output-minimal") return "minimal";
  if (mode === "schema-output-lite") return "lite";
  if (mode === "schema-output-planner") return "planner";
  return "none";
}

function evaluateThread(base: PlannerResult, thread: RuntimeThreadResult): PlannerResult {
  const finalResponse = thread.final_response;
  const threadId = thread.thread_id;
  const failureCategory = thread.failure_category;
  const next: PlannerResult = {
    ...base,
    real_sdk_run_attempted: true,
    planner_thread_started: Boolean(threadId),
    planner_thread_id: threadId,
    errors: [...base.errors, ...thread.errors],
    event_count: countEvents(resolve(reportDir, `planner-smoke-${mode}-events.jsonl`)),
    last_event_type: thread.last_event_type ?? "",
    elapsed_ms: thread.elapsed_ms ?? 0,
    failure_category: failureCategory ?? ""
  };
  next.no_event_timeout = thread.no_event_timeout === true;
  const timeoutCategory = mapTimeoutCategory(failureCategory, threadId);
  if (timeoutCategory) {
    next.status = timeoutCategory;
    next.failure_category = timeoutCategory;
    return next;
  }
  const startupSchemaCategory = classifySchemaStartupFailure(failureCategory, threadId);
  if (startupSchemaCategory) {
    next.status = startupSchemaCategory;
    next.failure_category = startupSchemaCategory;
    return next;
  }
  if (!threadId) {
    next.status = "SDK_PLANNER_THREAD_STARTUP_FAILURE";
    next.failure_category = "SDK_PLANNER_THREAD_STARTUP_FAILURE";
    return next;
  }
  if (mode === "minimal") {
    next.final_response_contains_expected = finalResponse.includes("SDK_PLANNER_MINIMAL_OK");
    next.status = next.final_response_contains_expected ? "PASS" : "SDK_PLANNER_THREAD_STARTUP_FAILURE";
    next.failure_category = next.status === "PASS" ? "" : "SDK_PLANNER_THREAD_STARTUP_FAILURE";
    return next;
  }
  if (mode === "parity-as-planner") {
    next.final_response_contains_expected = finalResponse.includes("SDK_TARGET_DIRECT_SDK_OK");
    next.status = next.final_response_contains_expected ? "PASS" : "PLANNER_ROLE_INVOCATION_MISMATCH";
    next.failure_category = next.status === "PASS" ? "" : "PLANNER_ROLE_INVOCATION_MISMATCH";
    return next;
  }
  const parsed = parseJsonObject(finalResponse);
  if (mode === "schema-text-only") {
    next.structured_output_valid = parsed.status === "PASS" && parsed.message === "SDK_PLANNER_SCHEMA_TEXT_ONLY_OK";
    next.final_response_contains_expected = next.structured_output_valid;
    next.status = next.structured_output_valid ? "PASS" : "PLANNER_SCHEMA_TEXT_ONLY_FAILED";
    next.failure_category = next.status === "PASS" ? "" : "PLANNER_SCHEMA_TEXT_ONLY_FAILED";
    return next;
  }
  if (mode === "schema-output-minimal") {
    next.structured_output_valid = parsed.status === "PASS" && parsed.message === "SDK_PLANNER_OUTPUT_MINIMAL_OK";
    next.final_response_contains_expected = next.structured_output_valid;
    next.status = next.structured_output_valid ? "PASS" : "SDK_OUTPUT_SCHEMA_INVOCATION_FAILED";
    next.failure_category = next.status === "PASS" ? "" : "SDK_OUTPUT_SCHEMA_INVOCATION_FAILED";
    return next;
  }
  if (mode === "schema-output-lite") {
    const validation = validatePlannerLiteArtifacts(finalResponse);
    next.structured_output_valid = validation.status === "PASS";
    next.prd_artifact_created = validation.status === "PASS" && validation.prd_markdown.trim().length > 0;
    next.task_graph_artifact_created = validation.status === "PASS" && isRecord(validation.task_graph);
    next.task_graph_schema_valid = validation.status === "PASS";
    next.artifact_thread_evidence_verified = next.structured_output_valid && next.prd_artifact_created && next.task_graph_artifact_created;
    next.status = next.artifact_thread_evidence_verified ? "PASS" : (validation.failure_category || "PLANNER_LITE_POSTPROCESS_FAILED");
    next.failure_category = next.status === "PASS" ? "" : next.status;
    next.errors = [...next.errors, ...validation.errors];
    return next;
  }
  next.structured_output_valid = parsed.status === "PASS" && parsed.role === "planner";
  if (mode === "schema-output-planner") {
    next.status = next.structured_output_valid ? "PASS" : "PLANNER_SCHEMA_TOO_COMPLEX_FOR_OUTPUT_SCHEMA";
    next.failure_category = next.status === "PASS" ? "" : "PLANNER_SCHEMA_TOO_COMPLEX_FOR_OUTPUT_SCHEMA";
    return next;
  }
  next.prd_artifact_created = isRecord(parsed.prd);
  next.task_graph_artifact_created = isRecord(parsed.task_graph);
  next.artifact_thread_evidence_verified = next.structured_output_valid && next.prd_artifact_created && next.task_graph_artifact_created;
  next.status = next.artifact_thread_evidence_verified ? "PASS" : "PLANNER_PROMPT_OR_ARTIFACT_FAILURE";
  next.failure_category = next.status === "PASS" ? "" : "PLANNER_PROMPT_OR_ARTIFACT_FAILURE";
  return next;
}

function finish(result: PlannerResult): void {
  mkdirSync(dirname(resultPath), { recursive: true });
  writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  if (result.status !== "BLOCKED_SDK_PLANNER_NOT_ENABLED") {
    writeFileSync(resolve(reportDir, `planner-smoke-${result.mode}-result.json`), `${JSON.stringify(result, null, 2)}\n`, "utf8");
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.status === "FAIL" ? 2 : 0;
}

function parseMode(value: string | undefined): PlannerMode {
  return value === "schema" ||
    value === "schema-text-only" ||
    value === "schema-output-minimal" ||
    value === "schema-output-lite" ||
    value === "schema-output-planner" ||
    value === "exact" ||
    value === "parity-as-planner"
    ? value
    : "minimal";
}

function canonicalMode(value: PlannerMode): CanonicalPlannerMode {
  return value === "schema" ? "schema-output-planner" : value;
}

function mapTimeoutCategory(failureCategory: string | undefined, threadId: string): PlannerStatus | "" {
  if (failureCategory === "SDK_NO_EVENT_TIMEOUT") {
    return "SDK_NO_EVENT_TIMEOUT";
  }
  if (failureCategory === "SDK_RUN_STREAMED_UNSUPPORTED") {
    return "SDK_RUN_STREAMED_UNSUPPORTED";
  }
  if (failureCategory === "SDK_PLANNER_TURN_TIMEOUT") {
    return "SDK_PLANNER_TURN_TIMEOUT";
  }
  if (failureCategory === "SDK_PLANNER_THREAD_STARTUP_TIMEOUT") {
    return threadId ? "SDK_PLANNER_TURN_TIMEOUT" : "SDK_PLANNER_THREAD_STARTUP_TIMEOUT";
  }
  return "";
}

function classifySchemaStartupFailure(failureCategory: string | undefined, threadId: string): PlannerStatus | "" {
  if (threadId) {
    return "";
  }
  if (mode === "schema-output-planner") {
    return "PLANNER_SCHEMA_TOO_COMPLEX_FOR_OUTPUT_SCHEMA";
  }
  if (failureCategory === "SDK_OUTPUT_SCHEMA_CAUSES_THREAD_START_FAILURE") {
    return "SDK_OUTPUT_SCHEMA_CAUSES_THREAD_START_FAILURE";
  }
  if (failureCategory !== "SDK_ADAPTER_INVOCATION_MISMATCH" && failureCategory !== "SDK_ERROR_STX_ONLY_READING_PROMPT") {
    return "";
  }
  if (mode === "schema-text-only") {
    return "PLANNER_SCHEMA_TEXT_ONLY_FAILED";
  }
  if (mode === "schema-output-minimal" || mode === "schema-output-lite" || mode === "exact") {
    return "SDK_OUTPUT_SCHEMA_CAUSES_THREAD_START_FAILURE";
  }
  return "";
}

function countEvents(path: string): number {
  if (!existsSync(path)) return 0;
  return readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean).length;
}

function parseJsonObject(text: string): Record<string, unknown> {
  try {
    const value = JSON.parse(text) as unknown;
    return isRecord(value) ? value : {};
  } catch {
    return {};
  }
}

function writeJson(path: string, value: unknown): void {
  const absolute = resolve(path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function stableHash(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return createHash("sha256").update(text ?? "").digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resolveModelCatalogJson(): string {
  const configured = process.env.CODEX_LOOP_MODEL_CATALOG_JSON;
  if (configured) return resolve(configured);
  const bundled = resolve(repoRoot, "evals/sdk-orchestrated/model-catalog-bundled.json");
  return existsSync(bundled) ? bundled : "";
}

function canResolve(specifier: string): boolean {
  if (existsSync(resolve(repoRoot, "node_modules", ...specifier.split("/"), "package.json"))) return true;
  try {
    createRequire(resolve(repoRoot, "package.json")).resolve(specifier);
    return true;
  } catch {
    return false;
  }
}

function getNodeMajorVersion(): number {
  return Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
}

function plannerTimeoutMs(): number {
  return Number.parseInt(process.env.CODEX_LOOP_PLANNER_SMOKE_TIMEOUT_MS ?? "180000", 10);
}

function createMockSdkModule(mockMode: string): { Codex: new (options?: unknown) => MockCodexLike } {
  class MockThread {
    readonly id = mockMode === "missing-thread" ? null : "thread_planner_smoke_mock";
    async run(): Promise<unknown> {
      return { finalResponse: mockFinalResponse(), items: [] };
    }
    async runStreamed(_input?: string, options?: { signal?: AbortSignal }): Promise<{ events: AsyncGenerator<unknown> }> {
      const id = this.id;
      const text = mockFinalResponse();
      async function* events(): AsyncGenerator<unknown> {
        if (mockMode === "prompt-only-failure") {
          throw new Error("Codex Exec exited with code 1: Reading prompt from stdin...");
        }
        if (mockMode === "timeout-no-thread") {
          await waitForAbort(options?.signal);
          throw new Error("aborted");
          return;
        }
        if (id) yield { type: "thread.started", thread_id: id };
        if (mockMode === "timeout-with-thread") {
          await waitForAbort(options?.signal);
          throw new Error("aborted");
          return;
        }
        yield { type: "item.completed", item: { type: "agent_message", text } };
        yield { type: "turn.completed", usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1, reasoning_output_tokens: 0 } };
      }
      return { events: events() };
    }
  }
  class MockCodex {
    startThread(): MockThread {
      return new MockThread();
    }
    resumeThread(): MockThread {
      return new MockThread();
    }
  }
  return { Codex: MockCodex };
}

function mockFinalResponse(): string {
  if (mockModeValue() === "minimal-pass") return "SDK_PLANNER_MINIMAL_OK";
  if (mockModeValue() === "parity-as-planner-pass") return "SDK_TARGET_DIRECT_SDK_OK";
  if (mockModeValue() === "parity-as-planner-fail") return "SDK_PLANNER_MINIMAL_OK";
  if (mockModeValue() === "schema-text-only-pass") return "{\"status\":\"PASS\",\"message\":\"SDK_PLANNER_SCHEMA_TEXT_ONLY_OK\"}";
  if (mockModeValue() === "schema-text-only-fail") return "{\"status\":\"FAIL\",\"message\":\"wrong\"}";
  if (mockModeValue() === "schema-output-minimal-pass") return "{\"status\":\"PASS\",\"message\":\"SDK_PLANNER_OUTPUT_MINIMAL_OK\"}";
  if (mockModeValue() === "schema-output-minimal-fail") return "{\"status\":\"FAIL\",\"message\":\"wrong\"}";
  if (mockModeValue() === "schema-output-lite-pass") return JSON.stringify(validPlannerLiteOutput());
  if (mockModeValue() === "schema-output-lite-invalid-task-json") return JSON.stringify({ ...validPlannerLiteOutput(), task_graph_json: "{not json" });
  if (mockModeValue() === "schema-output-lite-empty-prd") return JSON.stringify({ ...validPlannerLiteOutput(), prd_markdown: "" });
  if (mockModeValue() === "schema-output-planner-fail") return "{\"status\":\"FAIL\",\"role\":\"planner\"}";
  if (mockModeValue() === "schema-fail") return "{\"status\":\"FAIL\",\"role\":\"planner\"}";
  if (mockModeValue() === "exact-fail") return "{\"status\":\"PASS\",\"role\":\"planner\"}";
  return JSON.stringify({
    status: "PASS",
    role: "planner",
    prd: { goal: "Validate project names." },
    task_graph: { tasks: [{ id: "TASK-001", title: "Fix validation" }] },
    acceptance_criteria: ["empty rejected", "valid accepted"],
    risks: []
  });
}

function validPlannerLiteOutput(): Record<string, unknown> {
  return {
    status: "PASS",
    prd_markdown: "# PRD\n\nValidate project names.",
    task_graph_json: readFileSync(resolve(repoRoot, "tests/fixtures/valid/task-graph.json"), "utf8"),
    acceptance_criteria: ["Reject empty names", "Accept valid names"],
    risks: []
  };
}

function mockModeValue(): string {
  return process.env.CODEX_LOOP_GATE6B_PLANNER_SMOKE_MOCK ?? "";
}

async function waitForAbort(signal: AbortSignal | undefined): Promise<void> {
  if (!signal) {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
    return;
  }
  if (signal.aborted) return;
  await new Promise<void>((resolvePromise) => {
    signal.addEventListener("abort", () => resolvePromise(), { once: true });
  });
}

main().catch((error: unknown) => {
  finish({
    ...baseResult({
      sqliteHomePath: resolve(repoRoot, ".codex-eval/sqlite"),
      modelCatalogJson: resolveModelCatalogJson(),
      sdkDependencyDetected: canResolve("@openai/codex-sdk"),
      nodeVersionOk: getNodeMajorVersion() >= 18
    }),
    status: "FAIL",
    failure_category: "UNHANDLED_ERROR",
    errors: [error instanceof Error ? error.message : String(error)]
  });
});
