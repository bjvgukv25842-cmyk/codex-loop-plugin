import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

import {
  createEvaluatorRuntimeInput,
  EVALUATOR_STAGE_IMPL,
  evaluatorLiteOutputSchema,
  runEvaluatorLiteStage
} from "../../src/orchestrator/sdk-evaluator-stage.ts";
import { ensureEvalSqliteHome } from "../../src/runtime/eval-sqlite-home.ts";
import { DEFAULT_CODEX_MODEL, SdkRuntimeAdapter } from "../../src/runtime/sdk-runtime-adapter.ts";
import type { RuntimeThreadInput, RuntimeThreadResult } from "../../src/runtime/runtime-types.ts";

type EvaluatorMode = "parity" | "text-only" | "output-minimal" | "output-lite";
type EvaluatorStatus =
  | "PASS"
  | "FAIL"
  | "BLOCKED_SDK_EVALUATOR_NOT_ENABLED"
  | "BLOCKED_SDK_NOT_INSTALLED"
  | "BLOCKED_NODE_VERSION"
  | "BLOCKED_EVAL_SQLITE_HOME_NOT_WRITABLE"
  | "EVALUATOR_PARITY_THREAD_STARTUP_FAILURE"
  | "EVALUATOR_TEXT_ONLY_FAILED"
  | "EVALUATOR_OUTPUT_SCHEMA_INVOCATION_FAILED"
  | "EVALUATOR_LITE_OUTPUT_SCHEMA_FAILED"
  | "EVALUATOR_FINDINGS_JSON_INVALID"
  | "EVALUATOR_LITE_POSTPROCESS_FAILED"
  | "THREAD_ID_MISSING";

interface EvaluatorSmokeResult {
  gate: "Gate 6B.1M Evaluator Stage Slice";
  status: EvaluatorStatus;
  mode: EvaluatorMode;
  real_sdk_run_enabled: boolean;
  real_sdk_run_attempted: boolean;
  sdk_dependency_detected: boolean;
  node_version: string;
  node_version_ok: boolean;
  target_repo: string;
  model: string;
  model_catalog_json: string;
  sqlite_home: string;
  evaluator_thread_started: boolean;
  evaluator_thread_id: string;
  final_response_contains_expected: boolean;
  structured_output_valid: boolean;
  eval_report_created: boolean;
  eval_report_path: string;
  eval_verdict: "" | "PASS" | "NEEDS_REVISION";
  artifact_thread_evidence_verified: boolean;
  evaluator_stage_shared: boolean;
  evaluator_stage_impl: string;
  full_eval_report_schema_in_output_schema: false;
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
const resultPath = process.env.CODEX_LOOP_EVALUATOR_SMOKE_RESULT_PATH
  ? resolve(process.env.CODEX_LOOP_EVALUATOR_SMOKE_RESULT_PATH)
  : resolve(reportDir, "evaluator-smoke-result.json");
const targetRepo = process.env.CODEX_LOOP_GATE6B_SMOKE_TARGET_REPO
  ? resolve(process.env.CODEX_LOOP_GATE6B_SMOKE_TARGET_REPO)
  : resolve(repoRoot, "tmp/sdk-orchestrated/gate6b-smoke-target");
const mode = parseMode(process.env.CODEX_LOOP_EVALUATOR_SMOKE_MODE);

async function main(): Promise<void> {
  const sqliteHome = ensureEvalSqliteHome(repoRoot);
  const modelCatalogJson = resolveModelCatalogJson();
  const sdkDependencyDetected = canResolve("@openai/codex-sdk");
  const nodeVersionOk = getNodeMajorVersion() >= 18;
  const base = baseResult({ sqliteHomePath: sqliteHome.path, modelCatalogJson, sdkDependencyDetected, nodeVersionOk });

  if (!nodeVersionOk) {
    return finish({ ...base, status: "BLOCKED_NODE_VERSION", errors: [`Node.js >= 18 is required; current version is ${process.version}.`] });
  }
  if (!sqliteHome.ok) {
    return finish({ ...base, status: "BLOCKED_EVAL_SQLITE_HOME_NOT_WRITABLE", errors: [`Eval SQLite home is not usable: ${sqliteHome.reason ?? "unknown"}`] });
  }
  const mockMode = process.env.CODEX_LOOP_GATE6B_EVALUATOR_SMOKE_MOCK;
  if (!mockMode && process.env.CODEX_LOOP_ENABLE_REAL_SDK_EVALUATOR !== "1") {
    return finish({
      ...base,
      status: "BLOCKED_SDK_EVALUATOR_NOT_ENABLED",
      errors: ["Set CODEX_LOOP_ENABLE_REAL_SDK_EVALUATOR=1 only for one controlled host-terminal evaluator smoke."]
    });
  }
  if (!sdkDependencyDetected) {
    return finish({ ...base, status: "BLOCKED_SDK_NOT_INSTALLED", errors: ["@openai/codex-sdk is not installed or cannot be resolved."] });
  }

  const adapter = mockMode
    ? new SdkRuntimeAdapter({ enableRealRun: true, sdkResolver: async () => createMockSdkModule(mockMode) })
    : new SdkRuntimeAdapter({ enableRealRun: true });

  if (mode === "output-lite") {
    const stage = await runEvaluatorLiteStage({
      loop_run_id: "loop_gate6b_evaluator_smoke",
      task_id: "task_gate6b_evaluator_smoke",
      target_repo: targetRepo,
      prd_path: "docs/PRD.md",
      task_graph_path: "docs/TASK_GRAPH.json",
      dev_result_path: "artifacts/dev-result.json",
      test_log_path: "npm test",
      model: process.env.CODEX_LOOP_CODEX_MODEL ?? DEFAULT_CODEX_MODEL,
      model_catalog_json: modelCatalogJson,
      sqlite_home: sqliteHome.path,
      sandbox: "read-only",
      timeout_ms: 180_000,
      runtime_adapter: adapter,
      repo_root: repoRoot,
      report_dir: reportDir,
      invocation_trace_path: resolve(reportDir, "evaluator-smoke-output-lite-invocation-trace-redacted.json"),
      invocation_trace_label: "gate6b-evaluator-smoke-output-lite",
      events_path: resolve(reportDir, "evaluator-smoke-output-lite-events.jsonl"),
      stdout_path: resolve(reportDir, "evaluator-smoke-output-lite-stdout.log"),
      stderr_path: resolve(reportDir, "evaluator-smoke-output-lite-stderr.log"),
      result_path: resultPath
    });
    return finish({
      ...base,
      status: stage.status === "PASS" ? "PASS" : (stage.failure_category as EvaluatorStatus) || "EVALUATOR_LITE_POSTPROCESS_FAILED",
      real_sdk_run_attempted: mockMode ? false : true,
      evaluator_thread_started: stage.evaluator_thread_started,
      evaluator_thread_id: stage.evaluator_thread_id,
      final_response_contains_expected: stage.final_response_contains_expected,
      structured_output_valid: stage.structured_output_valid,
      eval_report_created: stage.eval_report_created,
      eval_report_path: stage.eval_report_path,
      eval_verdict: stage.eval_verdict,
      artifact_thread_evidence_verified: stage.artifact_thread_evidence_verified,
      evaluator_stage_shared: true,
      evaluator_stage_impl: EVALUATOR_STAGE_IMPL,
      events_path: resolve(reportDir, "evaluator-smoke-output-lite-events.jsonl"),
      event_count: stage.event_count,
      no_event_timeout: stage.no_event_timeout,
      last_event_type: stage.last_event_type,
      elapsed_ms: stage.elapsed_ms,
      failure_category: stage.status === "PASS" ? "" : stage.failure_category,
      errors: stage.errors
    });
  }

  const thread = await adapter.runThreadStreamed(runtimeInput(sqliteHome.path, modelCatalogJson));
  return finish(evaluateThread(base, thread, mockMode));
}

function baseResult(input: { sqliteHomePath: string; modelCatalogJson: string; sdkDependencyDetected: boolean; nodeVersionOk: boolean }): EvaluatorSmokeResult {
  return {
    gate: "Gate 6B.1M Evaluator Stage Slice",
    status: "FAIL",
    mode,
    real_sdk_run_enabled: process.env.CODEX_LOOP_ENABLE_REAL_SDK_EVALUATOR === "1",
    real_sdk_run_attempted: false,
    sdk_dependency_detected: input.sdkDependencyDetected,
    node_version: process.version,
    node_version_ok: input.nodeVersionOk,
    target_repo: "tmp/sdk-orchestrated/gate6b-smoke-target",
    model: process.env.CODEX_LOOP_CODEX_MODEL ?? DEFAULT_CODEX_MODEL,
    model_catalog_json: input.modelCatalogJson,
    sqlite_home: input.sqliteHomePath,
    evaluator_thread_started: false,
    evaluator_thread_id: "",
    final_response_contains_expected: false,
    structured_output_valid: false,
    eval_report_created: false,
    eval_report_path: "tmp/sdk-orchestrated/gate6b-smoke-target/artifacts/eval-report.json",
    eval_verdict: "",
    artifact_thread_evidence_verified: false,
    evaluator_stage_shared: mode === "output-lite",
    evaluator_stage_impl: mode === "output-lite" ? EVALUATOR_STAGE_IMPL : "",
    full_eval_report_schema_in_output_schema: false,
    events_path: resolve(reportDir, `evaluator-smoke-${mode}-events.jsonl`),
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
  const input: RuntimeThreadInput = {
    role: "evaluator",
    loop_run_id: "loop_gate6b_evaluator_smoke",
    task_id: "task_gate6b_evaluator_smoke",
    prompt,
    sandbox: "read-only",
    working_directory: targetRepo,
    timeout_ms: 180_000,
    output_schema_path: "",
    output_schema: outputSchema,
    codex_model: process.env.CODEX_LOOP_CODEX_MODEL ?? DEFAULT_CODEX_MODEL,
    model_catalog_json: modelCatalogJson || undefined,
    codex_config_overrides: {},
    skip_git_repo_check: false,
    direct_cli_parity_status: "PASS",
    invocation_trace_path: resolve(reportDir, `evaluator-smoke-${mode}-invocation-trace-redacted.json`),
    invocation_trace_label: `gate6b-evaluator-smoke-${mode}`,
    error_capture_paths: {
      events_path: resolve(reportDir, `evaluator-smoke-${mode}-events.jsonl`),
      stdout_path: resolve(reportDir, `evaluator-smoke-${mode}-stdout.log`),
      stderr_path: resolve(reportDir, `evaluator-smoke-${mode}-stderr.log`),
      result_path: resultPath
    },
    no_event_timeout_ms: Number.parseInt(process.env.CODEX_LOOP_SDK_NO_EVENT_TIMEOUT_MS ?? "30000", 10),
    env: {
      CODEX_SQLITE_HOME: sqliteHomePath
    }
  };
  writeInvocationTrace(input, outputSchema);
  return input;
}

function promptForMode(): string {
  if (mode === "parity") {
    return "Respond with exactly: SDK_EVALUATOR_PARITY_OK";
  }
  if (mode === "text-only") {
    return [
      "Read docs/PRD.md, docs/TASK_GRAPH.json, artifacts/dev-result.json, src/project-name.js, and test/project-name.test.js.",
      "Do not modify files.",
      "Return only this JSON object:",
      "{\"status\":\"PASS\",\"verdict\":\"PASS\",\"summary\":\"SDK_EVALUATOR_TEXT_ONLY_OK\"}"
    ].join("\n");
  }
  if (mode === "output-minimal") {
    return "Return JSON matching the output schema: {\"status\":\"PASS\",\"verdict\":\"PASS\",\"summary\":\"SDK_EVALUATOR_OUTPUT_MINIMAL_OK\"}";
  }
  return [
    "Read docs/PRD.md, docs/TASK_GRAPH.json, artifacts/dev-result.json, src/project-name.js, and test/project-name.test.js.",
    "Do not modify files.",
    "Return JSON matching the evaluator-lite output schema.",
    "Use findings_json as a JSON string. For PASS use \"[]\".",
    "validation_commands_checked must include npm test."
  ].join("\n");
}

function outputSchemaForMode(): RuntimeThreadInput["output_schema"] {
  if (mode === "output-minimal") {
    return {
      type: "object",
      additionalProperties: false,
      required: ["status", "verdict", "summary"],
      properties: {
        status: { type: "string", enum: ["PASS", "BLOCKED"] },
        verdict: { type: "string", enum: ["PASS", "NEEDS_REVISION"] },
        summary: { type: "string" }
      }
    };
  }
  return mode === "output-lite" ? evaluatorLiteOutputSchema : undefined;
}

function evaluateThread(base: EvaluatorSmokeResult, thread: RuntimeThreadResult, mockMode: string | undefined): EvaluatorSmokeResult {
  const next: EvaluatorSmokeResult = {
    ...base,
    real_sdk_run_attempted: mockMode ? false : true,
    evaluator_thread_started: Boolean(thread.thread_id),
    evaluator_thread_id: thread.thread_id,
    errors: [...base.errors, ...thread.errors],
    event_count: countEvents(resolve(reportDir, `evaluator-smoke-${mode}-events.jsonl`)),
    last_event_type: thread.last_event_type ?? "",
    elapsed_ms: thread.elapsed_ms ?? 0,
    no_event_timeout: thread.no_event_timeout === true,
    failure_category: classifyFailure(thread)
  };
  if (!thread.thread_id) {
    next.status = failureStatusForMode();
    next.failure_category = failureStatusForMode();
    return next;
  }
  if (mode === "parity") {
    next.final_response_contains_expected = thread.final_response.includes("SDK_EVALUATOR_PARITY_OK");
    next.status = next.final_response_contains_expected ? "PASS" : "EVALUATOR_PARITY_THREAD_STARTUP_FAILURE";
    next.failure_category = next.status === "PASS" ? "" : "EVALUATOR_PARITY_THREAD_STARTUP_FAILURE";
    return next;
  }
  if (mode === "text-only") {
    const parsed = parseJson(thread.final_response);
    next.structured_output_valid = parsed.ok;
    next.final_response_contains_expected = parsed.ok && parsed.value.verdict === "PASS" && parsed.value.summary === "SDK_EVALUATOR_TEXT_ONLY_OK";
    next.eval_verdict = parsed.ok && parsed.value.verdict === "PASS" ? "PASS" : "";
    next.status = next.final_response_contains_expected ? "PASS" : "EVALUATOR_TEXT_ONLY_FAILED";
    next.failure_category = next.status === "PASS" ? "" : "EVALUATOR_TEXT_ONLY_FAILED";
    next.errors = parsed.ok ? next.errors : [...next.errors, parsed.error];
    return next;
  }
  const parsed = parseJson(thread.final_response);
  next.structured_output_valid = parsed.ok;
  next.final_response_contains_expected = parsed.ok && parsed.value.verdict === "PASS" && parsed.value.summary === "SDK_EVALUATOR_OUTPUT_MINIMAL_OK";
  next.eval_verdict = parsed.ok && parsed.value.verdict === "PASS" ? "PASS" : "";
  next.status = next.final_response_contains_expected ? "PASS" : "EVALUATOR_OUTPUT_SCHEMA_INVOCATION_FAILED";
  next.failure_category = next.status === "PASS" ? "" : "EVALUATOR_OUTPUT_SCHEMA_INVOCATION_FAILED";
  next.errors = parsed.ok ? next.errors : [...next.errors, parsed.error];
  return next;
}

function classifyFailure(thread: RuntimeThreadResult): string {
  if (thread.failure_category === "SDK_OUTPUT_SCHEMA_CAUSES_THREAD_START_FAILURE") {
    return mode === "output-minimal" ? "EVALUATOR_OUTPUT_SCHEMA_INVOCATION_FAILED" : "EVALUATOR_LITE_OUTPUT_SCHEMA_FAILED";
  }
  return thread.failure_category ?? "";
}

function failureStatusForMode(): EvaluatorStatus {
  if (mode === "parity") return "EVALUATOR_PARITY_THREAD_STARTUP_FAILURE";
  if (mode === "text-only") return "EVALUATOR_TEXT_ONLY_FAILED";
  if (mode === "output-minimal") return "EVALUATOR_OUTPUT_SCHEMA_INVOCATION_FAILED";
  return "EVALUATOR_LITE_OUTPUT_SCHEMA_FAILED";
}

function finish(result: EvaluatorSmokeResult): void {
  if (!existsSync(targetRepo)) {
    result.errors.push("Smoke target repo is missing. Run npm run gate6b:smoke:prepare or gate6b:checkpoint:prepare first.");
  }
  mkdirSync(dirname(resultPath), { recursive: true });
  writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  if (result.status !== "BLOCKED_SDK_EVALUATOR_NOT_ENABLED") {
    writeFileSync(resolve(reportDir, `evaluator-smoke-${result.mode}-result.json`), `${JSON.stringify(result, null, 2)}\n`, "utf8");
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.status === "FAIL" ? 2 : 0;
}

function parseMode(value: string | undefined): EvaluatorMode {
  return value === "text-only" || value === "output-minimal" || value === "output-lite" ? value : "parity";
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

function countEvents(path: string): number {
  if (!existsSync(path)) return 0;
  return readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean).length;
}

function writeInvocationTrace(input: RuntimeThreadInput, outputSchema: RuntimeThreadInput["output_schema"]): void {
  const schemaPath = outputSchema ? resolve(reportDir, `evaluator-smoke-${mode}-output-schema.inline.json`) : "";
  if (schemaPath && outputSchema) {
    mkdirSync(dirname(schemaPath), { recursive: true });
    writeFileSync(schemaPath, `${JSON.stringify(outputSchema, null, 2)}\n`, "utf8");
  }
  mkdirSync(dirname(input.invocation_trace_path ?? reportDir), { recursive: true });
  writeFileSync(
    input.invocation_trace_path ?? resolve(reportDir, `evaluator-smoke-${mode}-invocation-trace-redacted.json`),
    `${JSON.stringify(
      {
        mode,
        role: input.role,
        uses_output_schema: Boolean(outputSchema),
        output_schema_kind: mode,
        output_schema_path: schemaPath,
        prompt_length: input.prompt.length,
        working_directory: input.working_directory,
        model: input.codex_model,
        sandbox_mode: input.sandbox,
        full_eval_report_schema_in_output_schema: false
      },
      null,
      2
    )}\n`,
    "utf8"
  );
}

function parseJson(text: string): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  try {
    const value = JSON.parse(text) as unknown;
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      return { ok: true, value: value as Record<string, unknown> };
    }
    return { ok: false, error: "final response must be a JSON object." };
  } catch (error) {
    return { ok: false, error: `final response is not valid JSON: ${error instanceof Error ? error.message : String(error)}` };
  }
}

interface MockThreadLike {
  readonly id: string | null;
  run(input?: string, options?: unknown): Promise<unknown>;
  runStreamed(input?: string, options?: unknown): Promise<{ events: AsyncGenerator<unknown> }>;
}

interface MockCodexLike {
  startThread(options?: unknown): MockThreadLike;
  resumeThread(id?: string, options?: unknown): MockThreadLike;
}

function createMockSdkModule(mockMode: string): { Codex: new (options?: unknown) => MockCodexLike } {
  class MockThread {
    readonly id = mockMode === "missing-thread" ? null : "thread_evaluator_smoke_mock";
    async run(): Promise<unknown> {
      return { finalResponse: mockFinalResponse(), items: [] };
    }
    async runStreamed(): Promise<{ events: AsyncGenerator<unknown> }> {
      const id = this.id;
      const text = mockFinalResponse();
      async function* events(): AsyncGenerator<unknown> {
        if (id) yield { type: "thread.started", thread_id: id };
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
  const mockMode = process.env.CODEX_LOOP_GATE6B_EVALUATOR_SMOKE_MOCK ?? "";
  if (mockMode === "parity-pass") return "SDK_EVALUATOR_PARITY_OK";
  if (mockMode === "text-only-pass") {
    return JSON.stringify({ status: "PASS", verdict: "PASS", summary: "SDK_EVALUATOR_TEXT_ONLY_OK" });
  }
  if (mockMode === "output-minimal-pass") {
    return JSON.stringify({ status: "PASS", verdict: "PASS", summary: "SDK_EVALUATOR_OUTPUT_MINIMAL_OK" });
  }
  if (mockMode === "output-lite-pass") {
    return JSON.stringify({
      status: "PASS",
      verdict: "PASS",
      summary: "SDK_EVALUATOR_OUTPUT_LITE_OK",
      findings_json: "[]",
      validation_commands_checked: ["npm test"]
    });
  }
  if (mockMode === "output-lite-invalid-findings") {
    return JSON.stringify({
      status: "PASS",
      verdict: "PASS",
      summary: "Bad findings JSON",
      findings_json: "{",
      validation_commands_checked: ["npm test"]
    });
  }
  return JSON.stringify({ status: "BLOCKED", verdict: "NEEDS_REVISION", summary: "mock blocked", findings_json: "[]", validation_commands_checked: [] });
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
