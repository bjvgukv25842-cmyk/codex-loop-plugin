import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

import { devWorkerLiteOutputSchema } from "../../src/orchestrator/dev-worker-lite-output.ts";
import {
  createDevWorkerRuntimeInput,
  DEV_WORKER_STAGE_IMPL,
  runDevWorkerStage
} from "../../src/orchestrator/sdk-dev-worker-stage.ts";
import {
  readDevWorkerBaseline,
  verifyDevWorkerMutationEvidence
} from "../../src/orchestrator/dev-worker-mutation-evidence.ts";
import { validateDevWorkerLiteResult } from "../../src/orchestrator/validate-dev-worker-result.ts";
import { ensureEvalSqliteHome } from "../../src/runtime/eval-sqlite-home.ts";
import { DEFAULT_CODEX_MODEL, SdkRuntimeAdapter } from "../../src/runtime/sdk-runtime-adapter.ts";
import type { RuntimeThreadInput, RuntimeThreadResult } from "../../src/runtime/runtime-types.ts";

type DevWorkerMode = "parity" | "minimal-fix" | "output-lite";
type DevWorkerStatus =
  | "PASS"
  | "FAIL"
  | "BLOCKED_SDK_DEV_WORKER_NOT_ENABLED"
  | "BLOCKED_SDK_NOT_INSTALLED"
  | "BLOCKED_NODE_VERSION"
  | "BLOCKED_EVAL_SQLITE_HOME_NOT_WRITABLE"
  | "BLOCKED_DEV_WORKER_BASELINE_MISSING"
  | "BLOCKED_TARGET_FIXTURE_NOT_BROKEN"
  | "DEV_WORKER_PARITY_THREAD_STARTUP_FAILURE"
  | "DEV_WORKER_THREAD_STARTUP_FAILURE"
  | "DEV_WORKER_NO_FILE_CHANGE"
  | "DEV_WORKER_NO_TEST"
  | "DEV_WORKER_TESTS_FAILED"
  | "DEV_WORKER_OUTPUT_SCHEMA_FAILURE"
  | "DEV_WORKER_OUTPUT_SCHEMA_CAUSES_THREAD_START_FAILURE"
  | "DEV_WORKER_RESULT_SCHEMA_INVALID"
  | "DEV_WORKER_PROMPT_OR_HARNESS_FAILURE"
  | "DEV_WORKER_TEST_DELETED"
  | "THREAD_ID_MISSING";

interface DevWorkerSmokeResult {
  gate: "Gate 6B.1J Dev Worker Stage Slice";
  status: DevWorkerStatus;
  mode: DevWorkerMode;
  real_sdk_run_enabled: boolean;
  real_sdk_run_attempted: boolean;
  sdk_dependency_detected: boolean;
  node_version: string;
  node_version_ok: boolean;
  target_repo: string;
  model: string;
  model_catalog_json: string;
  sqlite_home: string;
  dev_worker_thread_started: boolean;
  dev_worker_thread_id: string;
  final_response_contains_expected: boolean;
  structured_output_valid: boolean;
  file_change_verified: boolean;
  file_change_verified_by_hash: boolean;
  file_change_verified_by_git: boolean;
  file_change_verified_by_event: boolean;
  src_project_name_hash_before: string;
  src_project_name_hash_after: string;
  git_changed_files: string[];
  initial_tests_failed: boolean;
  tests_run: string[];
  tests_passed: boolean;
  dev_result_text_detected: boolean;
  dev_result_path: string;
  artifact_thread_evidence_verified: boolean;
  dev_worker_stage_shared: boolean;
  dev_worker_stage_impl: string;
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
const resultPath = process.env.CODEX_LOOP_DEV_WORKER_SMOKE_RESULT_PATH
  ? resolve(process.env.CODEX_LOOP_DEV_WORKER_SMOKE_RESULT_PATH)
  : resolve(reportDir, "dev-worker-smoke-result.json");
const targetRepo = process.env.CODEX_LOOP_GATE6B_SMOKE_TARGET_REPO
  ? resolve(process.env.CODEX_LOOP_GATE6B_SMOKE_TARGET_REPO)
  : resolve(repoRoot, "tmp/sdk-orchestrated/gate6b-smoke-target");
const baselinePath = process.env.CODEX_LOOP_DEV_WORKER_BASELINE_PATH
  ? resolve(process.env.CODEX_LOOP_DEV_WORKER_BASELINE_PATH)
  : resolve(reportDir, "dev-worker-baseline.json");
const mode = parseMode(process.env.CODEX_LOOP_DEV_WORKER_SMOKE_MODE);

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
  const mockMode = process.env.CODEX_LOOP_GATE6B_DEV_WORKER_SMOKE_MOCK;
  if (!mockMode && process.env.CODEX_LOOP_ENABLE_REAL_SDK_DEV_WORKER !== "1") {
    return finish({
      ...base,
      status: "BLOCKED_SDK_DEV_WORKER_NOT_ENABLED",
      errors: ["Set CODEX_LOOP_ENABLE_REAL_SDK_DEV_WORKER=1 only for one controlled host-terminal dev worker smoke."]
    });
  }
  if (!sdkDependencyDetected) {
    return finish({ ...base, status: "BLOCKED_SDK_NOT_INSTALLED", errors: ["@openai/codex-sdk is not installed or cannot be resolved."] });
  }
  const baselineGate = mode === "parity" ? null : baselinePreflight(base);
  if (baselineGate) {
    return finish(baselineGate);
  }

  const adapter = mockMode
    ? new SdkRuntimeAdapter({ enableRealRun: true, sdkResolver: async () => createMockSdkModule(mockMode) })
    : new SdkRuntimeAdapter({ enableRealRun: true });

  if (mode === "output-lite") {
    const stage = await runDevWorkerStage({
      loop_run_id: "loop_gate6b_dev_worker_smoke",
      task_id: "task_gate6b_dev_worker_smoke",
      target_repo: targetRepo,
      prd_path: "docs/PRD.md",
      task_graph_path: "docs/TASK_GRAPH.json",
      model: process.env.CODEX_LOOP_CODEX_MODEL ?? DEFAULT_CODEX_MODEL,
      model_catalog_json: modelCatalogJson,
      sqlite_home: sqliteHome.path,
      sandbox: "workspace-write",
      timeout_ms: 180_000,
      runtime_adapter: adapter,
      repo_root: repoRoot,
      report_dir: reportDir,
      invocation_trace_path: resolve(reportDir, "dev-worker-smoke-output-lite-invocation-trace-redacted.json"),
      invocation_trace_label: "gate6b-dev-worker-smoke-output-lite",
      events_path: resolve(reportDir, "dev-worker-smoke-output-lite-events.jsonl"),
      stdout_path: resolve(reportDir, "dev-worker-smoke-output-lite-stdout.log"),
      stderr_path: resolve(reportDir, "dev-worker-smoke-output-lite-stderr.log"),
      result_path: resultPath
    });
    return finish({
      ...base,
      status: stage.status === "PASS" ? "PASS" : (stage.failure_category as DevWorkerStatus) || "DEV_WORKER_PROMPT_OR_HARNESS_FAILURE",
      real_sdk_run_attempted: mockMode ? false : true,
      dev_worker_thread_started: stage.dev_worker_thread_started,
      dev_worker_thread_id: stage.dev_worker_thread_id,
      final_response_contains_expected: stage.final_response_contains_expected,
      structured_output_valid: stage.structured_output_valid,
      file_change_verified: stage.file_change_verified,
      file_change_verified_by_hash: stage.file_change_verified_by_hash,
      file_change_verified_by_git: stage.file_change_verified_by_git,
      file_change_verified_by_event: stage.file_change_verified_by_event,
      src_project_name_hash_before: stage.src_project_name_hash_before,
      src_project_name_hash_after: stage.src_project_name_hash_after,
      git_changed_files: stage.git_changed_files,
      initial_tests_failed: true,
      tests_run: stage.tests_run,
      tests_passed: stage.tests_passed,
      dev_result_text_detected: stage.final_response_contains_expected,
      dev_result_path: stage.dev_result_path,
      artifact_thread_evidence_verified: stage.artifact_thread_evidence_verified,
      dev_worker_stage_shared: true,
      dev_worker_stage_impl: DEV_WORKER_STAGE_IMPL,
      events_path: resolve(reportDir, "dev-worker-smoke-output-lite-events.jsonl"),
      event_count: stage.event_count,
      no_event_timeout: stage.no_event_timeout,
      last_event_type: stage.last_event_type,
      elapsed_ms: stage.elapsed_ms,
      failure_category: stage.status === "PASS" ? "" : stage.failure_category,
      errors: stage.errors
    });
  }

  const beforeSource = readTargetSource();
  const thread = await adapter.runThreadStreamed(runtimeInput(sqliteHome.path, modelCatalogJson));
  if (mode === "minimal-fix" && mockMode === "minimal-fix-pass") {
    writeFixedSource();
  }
  return finish(evaluateThread(base, thread, beforeSource, readTargetSource(), mockMode));
}

function baseResult(input: { sqliteHomePath: string; modelCatalogJson: string; sdkDependencyDetected: boolean; nodeVersionOk: boolean }): DevWorkerSmokeResult {
  return {
    gate: "Gate 6B.1J Dev Worker Stage Slice",
    status: "FAIL",
    mode,
    real_sdk_run_enabled: process.env.CODEX_LOOP_ENABLE_REAL_SDK_DEV_WORKER === "1",
    real_sdk_run_attempted: false,
    sdk_dependency_detected: input.sdkDependencyDetected,
    node_version: process.version,
    node_version_ok: input.nodeVersionOk,
    target_repo: "tmp/sdk-orchestrated/gate6b-smoke-target",
    model: process.env.CODEX_LOOP_CODEX_MODEL ?? DEFAULT_CODEX_MODEL,
    model_catalog_json: input.modelCatalogJson,
    sqlite_home: input.sqliteHomePath,
    dev_worker_thread_started: false,
    dev_worker_thread_id: "",
    final_response_contains_expected: false,
    structured_output_valid: false,
    file_change_verified: false,
    file_change_verified_by_hash: false,
    file_change_verified_by_git: false,
    file_change_verified_by_event: false,
    src_project_name_hash_before: "",
    src_project_name_hash_after: "",
    git_changed_files: [],
    initial_tests_failed: false,
    tests_run: [],
    tests_passed: false,
    dev_result_text_detected: false,
    dev_result_path: "tmp/sdk-orchestrated/gate6b-smoke-target/artifacts/dev-result.json",
    artifact_thread_evidence_verified: false,
    dev_worker_stage_shared: mode === "output-lite",
    dev_worker_stage_impl: mode === "output-lite" ? DEV_WORKER_STAGE_IMPL : "",
    events_path: resolve(reportDir, `dev-worker-smoke-${mode}-events.jsonl`),
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
  const outputSchema = mode === "output-lite" ? devWorkerLiteOutputSchema : undefined;
  return {
    role: "dev_worker",
    loop_run_id: "loop_gate6b_dev_worker_smoke",
    task_id: "task_gate6b_dev_worker_smoke",
    prompt,
    sandbox: "workspace-write",
    working_directory: targetRepo,
    timeout_ms: 180_000,
    output_schema_path: "",
    output_schema: outputSchema,
    codex_model: process.env.CODEX_LOOP_CODEX_MODEL ?? DEFAULT_CODEX_MODEL,
    model_catalog_json: modelCatalogJson || undefined,
    codex_config_overrides: {},
    skip_git_repo_check: false,
    direct_cli_parity_status: "PASS",
    invocation_trace_path: resolve(reportDir, `dev-worker-smoke-${mode}-invocation-trace-redacted.json`),
    invocation_trace_label: `gate6b-dev-worker-smoke-${mode}`,
    error_capture_paths: {
      events_path: resolve(reportDir, `dev-worker-smoke-${mode}-events.jsonl`),
      stdout_path: resolve(reportDir, `dev-worker-smoke-${mode}-stdout.log`),
      stderr_path: resolve(reportDir, `dev-worker-smoke-${mode}-stderr.log`),
      result_path: resultPath
    },
    env: {
      CODEX_SQLITE_HOME: sqliteHomePath
    }
  };
}

function promptForMode(): string {
  if (mode === "parity") {
    return "Respond with exactly: SDK_DEV_WORKER_PARITY_OK";
  }
  if (mode === "minimal-fix") {
    return [
      "Read docs/PRD.md and docs/TASK_GRAPH.json.",
      "Only fix validateProjectName(name) in src/project-name.js.",
      "Reject empty, whitespace-only, and >80 char names; accept valid names.",
      "Run npm test.",
      "Return a short DevResult JSON with status, changed_files, tests_run, tests_passed, summary."
    ].join("\n");
  }
  return [
    "Read docs/PRD.md and docs/TASK_GRAPH.json.",
    "Only fix validateProjectName(name) in src/project-name.js.",
    "Run npm test.",
    "Return JSON matching the DevResult lite output schema."
  ].join("\n");
}

function evaluateThread(base: DevWorkerSmokeResult, thread: RuntimeThreadResult, beforeSource: string, afterSource: string, mockMode: string | undefined): DevWorkerSmokeResult {
  const mutation = verifyDevWorkerMutationEvidence({
    target_repo: targetRepo,
    baseline_path: baselinePath,
    events_path: resolve(reportDir, `dev-worker-smoke-${mode}-events.jsonl`)
  });
  const next: DevWorkerSmokeResult = {
    ...base,
    real_sdk_run_attempted: mockMode ? false : true,
    dev_worker_thread_started: Boolean(thread.thread_id),
    dev_worker_thread_id: thread.thread_id,
    errors: [...base.errors, ...thread.errors],
    event_count: countEvents(resolve(reportDir, `dev-worker-smoke-${mode}-events.jsonl`)),
    last_event_type: thread.last_event_type ?? "",
    elapsed_ms: thread.elapsed_ms ?? 0,
    no_event_timeout: thread.no_event_timeout === true,
    failure_category: thread.failure_category ?? "",
    file_change_verified_by_hash: mutation.file_change_verified_by_hash,
    file_change_verified_by_git: mutation.file_change_verified_by_git,
    file_change_verified_by_event: mutation.file_change_verified_by_event,
    src_project_name_hash_before: mutation.src_project_name_hash_before,
    src_project_name_hash_after: mutation.src_project_name_hash_after,
    git_changed_files: mutation.git_changed_files,
    initial_tests_failed: mutation.initial_tests_failed,
    file_change_verified: beforeSource !== afterSource || mutation.file_change_verified
  };
  if (!thread.thread_id) {
    next.status = "DEV_WORKER_THREAD_STARTUP_FAILURE";
    next.failure_category = mode === "parity" ? "DEV_WORKER_PARITY_THREAD_STARTUP_FAILURE" : "DEV_WORKER_THREAD_STARTUP_FAILURE";
    return next;
  }
  if (mode === "parity") {
    next.final_response_contains_expected = thread.final_response.includes("SDK_DEV_WORKER_PARITY_OK");
    next.status = next.final_response_contains_expected ? "PASS" : "DEV_WORKER_PARITY_THREAD_STARTUP_FAILURE";
    next.failure_category = next.status === "PASS" ? "" : "DEV_WORKER_PARITY_THREAD_STARTUP_FAILURE";
    return next;
  }
  if (mode === "minimal-fix") {
    next.tests_run = parseStringArrayField(thread.final_response, "tests_run");
    next.tests_passed = parseBooleanField(thread.final_response, "tests_passed");
    next.dev_result_text_detected = thread.final_response.includes("changed_files") || thread.final_response.includes("tests_passed");
    if (!mutation.test_project_name_test_exists) {
      next.status = "FAIL";
      next.failure_category = "DEV_WORKER_TEST_DELETED";
    } else if (!next.file_change_verified) {
      next.status = "DEV_WORKER_NO_FILE_CHANGE";
      next.failure_category = "DEV_WORKER_NO_FILE_CHANGE";
    } else if (!next.tests_run.some((command) => command.includes("npm test"))) {
      next.status = "DEV_WORKER_NO_TEST";
      next.failure_category = "DEV_WORKER_NO_TEST";
    } else if (!next.tests_passed) {
      next.status = "DEV_WORKER_TESTS_FAILED";
      next.failure_category = "DEV_WORKER_TESTS_FAILED";
    } else if (!next.dev_result_text_detected) {
      next.status = "DEV_WORKER_PROMPT_OR_HARNESS_FAILURE";
      next.failure_category = "DEV_WORKER_PROMPT_OR_HARNESS_FAILURE";
    } else {
      next.status = "PASS";
      next.failure_category = "";
    }
    return next;
  }
  const validation = validateDevWorkerLiteResult(thread.final_response);
  next.structured_output_valid = validation.status === "PASS";
  next.tests_run = validation.tests_run;
  next.tests_passed = validation.tests_passed;
  next.dev_result_text_detected = validation.status === "PASS";
  next.status = validation.status === "PASS" && next.file_change_verified ? "PASS" : (validation.failure_category as DevWorkerStatus) || "DEV_WORKER_PROMPT_OR_HARNESS_FAILURE";
  next.failure_category = next.status === "PASS" ? "" : next.status;
  next.errors = [...next.errors, ...validation.errors];
  return next;
}

function baselinePreflight(base: DevWorkerSmokeResult): DevWorkerSmokeResult | null {
  const baseline = readDevWorkerBaseline(baselinePath);
  const mutation = verifyDevWorkerMutationEvidence({ target_repo: targetRepo, baseline_path: baselinePath });
  const patch = {
    file_change_verified_by_hash: mutation.file_change_verified_by_hash,
    file_change_verified_by_git: mutation.file_change_verified_by_git,
    file_change_verified_by_event: mutation.file_change_verified_by_event,
    src_project_name_hash_before: mutation.src_project_name_hash_before,
    src_project_name_hash_after: mutation.src_project_name_hash_after,
    git_changed_files: mutation.git_changed_files,
    initial_tests_failed: mutation.initial_tests_failed
  };
  if (!baseline) {
    return {
      ...base,
      ...patch,
      status: "BLOCKED_DEV_WORKER_BASELINE_MISSING",
      failure_category: "BLOCKED_DEV_WORKER_BASELINE_MISSING",
      errors: ["Dev worker baseline is missing. Run npm run gate6b:dev-worker-smoke:prepare first."]
    };
  }
  if (baseline.fixture_status !== "BROKEN_AS_EXPECTED" || baseline.initial_tests_failed !== true || !baseline.src_project_name_hash_before) {
    return {
      ...base,
      ...patch,
      status: baseline.fixture_status === "BLOCKED_TARGET_FIXTURE_NOT_BROKEN" ? "BLOCKED_TARGET_FIXTURE_NOT_BROKEN" : "BLOCKED_DEV_WORKER_BASELINE_MISSING",
      failure_category: baseline.fixture_status === "BLOCKED_TARGET_FIXTURE_NOT_BROKEN" ? "BLOCKED_TARGET_FIXTURE_NOT_BROKEN" : "BLOCKED_DEV_WORKER_BASELINE_MISSING",
      errors: ["Dev worker baseline does not prove a broken starting fixture."]
    };
  }
  return null;
}

function finish(result: DevWorkerSmokeResult): void {
  if (!existsSync(targetRepo)) {
    result.errors.push("Smoke target repo is missing. Run npm run gate6b:smoke:prepare first.");
  }
  mkdirSync(dirname(resultPath), { recursive: true });
  writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  if (result.status !== "BLOCKED_SDK_DEV_WORKER_NOT_ENABLED") {
    writeFileSync(resolve(reportDir, `dev-worker-smoke-${result.mode}-result.json`), `${JSON.stringify(result, null, 2)}\n`, "utf8");
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.status === "FAIL" ? 2 : 0;
}

function parseMode(value: string | undefined): DevWorkerMode {
  return value === "minimal-fix" || value === "output-lite" ? value : "parity";
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

function readTargetSource(): string {
  try {
    return readFileSync(resolve(targetRepo, "src/project-name.js"), "utf8");
  } catch {
    return "";
  }
}

function writeFixedSource(): void {
  mkdirSync(resolve(targetRepo, "src"), { recursive: true });
  writeFileSync(
    resolve(targetRepo, "src/project-name.js"),
    [
      "export function validateProjectName(name) {",
      "  if (typeof name !== \"string\") return { ok: false, reason: \"name must be a string\" };",
      "  if (name.trim().length === 0) return { ok: false, reason: \"name is required\" };",
      "  if (name.length > 80) return { ok: false, reason: \"name is too long\" };",
      "  return { ok: true };",
      "}",
      ""
    ].join("\n"),
    "utf8"
  );
}

function parseJsonObject(text: string): Record<string, unknown> {
  try {
    const value = JSON.parse(text) as unknown;
    return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function parseBooleanField(text: string, field: string): boolean {
  return parseJsonObject(text)[field] === true;
}

function parseStringArrayField(text: string, field: string): string[] {
  const value = parseJsonObject(text)[field];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
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
    readonly id = mockMode === "missing-thread" ? null : "thread_dev_worker_smoke_mock";
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
  const mockMode = process.env.CODEX_LOOP_GATE6B_DEV_WORKER_SMOKE_MOCK ?? "";
  if (mockMode === "parity-pass") return "SDK_DEV_WORKER_PARITY_OK";
  if (mockMode === "minimal-fix-pass") {
    return JSON.stringify({
      status: "PASS",
      changed_files: ["src/project-name.js"],
      tests_run: ["npm test"],
      tests_passed: true,
      summary: "Fixed validateProjectName and tests pass."
    });
  }
  if (mockMode === "output-lite-pass") {
    writeFixedSource();
    return JSON.stringify({
      status: "PASS",
      changed_files: ["src/project-name.js"],
      tests_run: ["npm test"],
      tests_passed: true,
      summary: "Fixed validateProjectName and tests pass."
    });
  }
  if (mockMode === "output-lite-no-test") {
    return JSON.stringify({
      status: "PASS",
      changed_files: ["src/project-name.js"],
      tests_run: [],
      tests_passed: true,
      summary: "No test evidence."
    });
  }
  return JSON.stringify({ status: "BLOCKED", changed_files: [], tests_run: [], tests_passed: false, summary: "mock blocked" });
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
