import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { getGenericTestCoverageCaseProfile } from "../../src/effectiveness/generic-test-coverage-case-profile.ts";
import {
  buildTestCoverageDevWorkerPrompt,
  TEST_COVERAGE_002_DEV_WORKER_PROMPT_MAX_LENGTH
} from "../../src/effectiveness/treatment-generic-test-coverage-runner.ts";
import {
  gateTestCoverageDevWorkerSmokeMode,
  reconstructTestCoverageDevWorkerSmokeReadiness,
  updateTestCoverageDevWorkerSmokeReadinessFromResult,
  type TestCoverageDevWorkerSmokeMode
} from "../../src/effectiveness/test-coverage-dev-worker-smoke-readiness.ts";
import { devWorkerLiteOutputSchema } from "../../src/orchestrator/dev-worker-lite-output.ts";
import { parseDevWorkerLiteOutput } from "../../src/orchestrator/parse-dev-worker-lite-output.ts";
import { ensureEvalSqliteHome } from "../../src/runtime/eval-sqlite-home.ts";
import { detectCodexSdkDependency, type CodexSdkDependencyStatus } from "../../src/runtime/sdk-capability-detect.ts";
import { DEFAULT_CODEX_MODEL, SdkRuntimeAdapter } from "../../src/runtime/sdk-runtime-adapter.ts";
import type { RuntimeAdapter } from "../../src/runtime/runtime-adapter.ts";
import type {
  RuntimeEventsInput,
  RuntimeFinalResponseInput,
  RuntimeStopThreadInput,
  RuntimeThreadEventsResult,
  RuntimeThreadInput,
  RuntimeThreadRefInput,
  RuntimeThreadResult
} from "../../src/runtime/runtime-types.ts";
import { writeJson } from "./io.ts";

export type TestCoverageDevWorkerSmokeStatus =
  | "PASS"
  | "FAIL"
  | "BLOCKED_TEST_COVERAGE_DEV_WORKER_SMOKE_NOT_ENABLED"
  | "BLOCKED_TEST_COVERAGE_002_DEV_PARITY_NOT_PASSED"
  | "BLOCKED_TEST_COVERAGE_002_DEV_MINIMAL_NOT_PASSED"
  | "BLOCKED_SDK_NOT_INSTALLED"
  | "BLOCKED_SDK_IMPORT_FAILED"
  | "BLOCKED_NODE_VERSION_UNSUPPORTED"
  | "BLOCKED_SDK_EXPORT_MISSING_CODEX"
  | "BLOCKED_EVAL_SQLITE_HOME_NOT_WRITABLE";

export interface TestCoverageDevWorkerSmokeResult {
  case_id: "test-coverage-002";
  status: TestCoverageDevWorkerSmokeStatus;
  mode: TestCoverageDevWorkerSmokeMode;
  real_sdk_run_executed: boolean;
  dev_worker_thread_started: boolean;
  dev_worker_thread_id: string;
  file_change_verified: boolean;
  changed_files: string[];
  npm_test_run: boolean;
  npm_test_passed: boolean;
  coverage_contract_run: boolean;
  coverage_contract_passed: boolean;
  src_modified: boolean;
  structured_output_valid: boolean;
  dev_result_path: string;
  final_response_contains_expected: boolean;
  output_schema_used: boolean;
  prompt_length: number;
  prompt_hash: string;
  prompt_max_length: number;
  prompt_requires_npm_test: boolean;
  prompt_requires_coverage_contract: boolean;
  prompt_discourages_src_modification: boolean;
  events_path: string;
  stdout_path: string;
  stderr_path: string;
  last_event_type: string;
  elapsed_ms: number;
  event_count: number;
  failure_category: string;
  ready_for_one_dev_worker_parity_smoke: boolean;
  ready_for_next_dev_worker_smoke: boolean;
  ready_for_test_coverage_002_treatment_rerun: boolean;
  danger_full_access_used: false;
  secret_leak_detected: false;
  sdk_diagnosis: TestCoverageDevWorkerSmokeSdkDiagnosis;
  errors: string[];
}

export interface TestCoverageDevWorkerSmokeSdkDiagnosis {
  package_json_has_codex_sdk: boolean;
  package_lock_has_codex_sdk: boolean;
  npm_ls_codex_sdk_ok: boolean;
  dynamic_import_codex_sdk_ok: boolean;
  codex_named_export_available: boolean;
  codex_sdk_version: string;
  codex_sdk_export_keys: string[];
  failure_category: string;
  error_message: string;
}

const resultPath = "evals/effectiveness/reports/test-coverage-002/dev-worker-smoke-result.json";

export async function runTestCoverageDevWorkerSmoke(options: {
  mode?: TestCoverageDevWorkerSmokeMode;
  env?: NodeJS.ProcessEnv;
  runtime_adapter?: RuntimeAdapter;
  repoRoot?: string;
} = {}): Promise<TestCoverageDevWorkerSmokeResult> {
  const env = options.env ?? process.env;
  const mode = options.mode ?? parseMode(env.CODEX_LOOP_TEST_COVERAGE_DEV_WORKER_SMOKE_MODE);
  const root = options.repoRoot ?? process.cwd();
  const base = baseResult(mode);
  if (getNodeMajorVersion() < 18) {
    return finish(root, { ...base, status: "BLOCKED_NODE_VERSION_UNSUPPORTED", failure_category: "BLOCKED_NODE_VERSION_UNSUPPORTED", errors: [`Node.js >= 18 required; current ${process.version}.`] });
  }
  const sqliteHome = ensureEvalSqliteHome(root, env);
  if (!sqliteHome.ok) {
    return finish(root, { ...base, status: "BLOCKED_EVAL_SQLITE_HOME_NOT_WRITABLE", failure_category: sqliteHome.reason ?? "BLOCKED_EVAL_SQLITE_HOME_NOT_WRITABLE", errors: [sqliteHome.reason ?? "Eval SQLite home is not writable."] });
  }
  const readiness = reconstructTestCoverageDevWorkerSmokeReadiness(root, { write: true });
  const modeGate = gateTestCoverageDevWorkerSmokeMode(readiness, mode);
  if (!modeGate.ok) {
    return finish(root, {
      ...base,
      status: modeGate.status as TestCoverageDevWorkerSmokeStatus,
      failure_category: modeGate.status,
      errors: [modeGate.reason]
    });
  }
  const mock = env.CODEX_LOOP_TEST_COVERAGE_DEV_WORKER_SMOKE_MOCK;
  const injectedRuntimeAdapter = Boolean(options.runtime_adapter);
  if (!mock && !injectedRuntimeAdapter) {
    const sdk = await detectCodexSdkDependency(root);
    base.sdk_diagnosis = toSmokeSdkDiagnosis(sdk);
    if (!sdk.detected) {
      return finish(root, {
        ...base,
        status: sdk.failure_category || "BLOCKED_SDK_IMPORT_FAILED",
        failure_category: sdk.failure_category || "BLOCKED_SDK_IMPORT_FAILED",
        errors: [sdk.error_message || "Unable to import @openai/codex-sdk."]
      });
    }
  }
  if (!mock && !injectedRuntimeAdapter && env.CODEX_LOOP_ENABLE_M12_TEST_COVERAGE_DEV_WORKER_SMOKE !== "1") {
    return finish(root, {
      ...base,
      status: "BLOCKED_TEST_COVERAGE_DEV_WORKER_SMOKE_NOT_ENABLED",
      failure_category: "BLOCKED_TEST_COVERAGE_DEV_WORKER_SMOKE_NOT_ENABLED",
      errors: ["Set CODEX_LOOP_ENABLE_M12_TEST_COVERAGE_DEV_WORKER_SMOKE=1 only for one controlled dev-worker-only smoke."]
    });
  }
  const targetRepo = resolve(root, "evals/effectiveness/runs/test-coverage-002/treatment/target-repo");
  const stageLogDir = resolve(root, "evals/effectiveness/reports/test-coverage-002/sdk-stage-logs");
  const adapter = options.runtime_adapter ?? (mock
    ? new TestCoverageDevWorkerMockAdapter(mode, mock)
    : new SdkRuntimeAdapter({ enableRealRun: true, repoRoot: root, preferStreamed: false }));
  const runtimeInput = modeRuntimeInput(mode, sqliteHome.path, root, targetRepo, stageLogDir, env);
  const beforeTest = readFile(resolve(targetRepo, "test/cache.test.js"));
  const beforeSource = readSources(targetRepo);
  const thread = await adapter.runThread(runtimeInput);
  const afterTest = readFile(resolve(targetRepo, "test/cache.test.js"));
  const afterSource = readSources(targetRepo);
  return finish(root, evaluateSmokeMode({
    mode,
    thread,
    runtimeInput,
    beforeTest,
    afterTest,
    beforeSource,
    afterSource,
    realSdkRunExecuted: mock || injectedRuntimeAdapter ? false : true,
    targetRepo
  }));
}

function modeRuntimeInput(mode: TestCoverageDevWorkerSmokeMode, sqliteHome: string, root: string, targetRepo: string, stageLogDir: string, env: NodeJS.ProcessEnv): RuntimeThreadInput {
  const prompt = mode === "parity"
    ? "Respond with exactly: TEST_COVERAGE_DEV_WORKER_PARITY_OK"
    : mode === "minimal"
      ? [
          "Add one minimal cache miss test in test/cache.test.js.",
          "Run npm test.",
          "Do not modify src/cache.js or src/cache-storage.js.",
          "Return DevResult JSON with changed_files, tests_run, tests_passed, summary."
        ].join("\n")
      : buildTestCoverageDevWorkerPrompt({
          profile: getGenericTestCoverageCaseProfile("test-coverage-002")!,
          prd_path: "docs/PRD.md",
          task_graph_path: "docs/TASK_GRAPH.json"
        });
  return {
    role: "dev_worker",
    loop_run_id: `loop_m12_test_coverage_dev_worker_${mode.replace(/-/g, "_")}`,
    task_id: `task_m12_test_coverage_dev_worker_${mode.replace(/-/g, "_")}`,
    prompt,
    sandbox: "workspace-write",
    working_directory: targetRepo,
    timeout_ms: 180_000,
    output_schema_path: "",
    output_schema: mode === "parity" ? undefined : devWorkerLiteOutputSchema,
    codex_model: env.CODEX_LOOP_CODEX_MODEL ?? DEFAULT_CODEX_MODEL,
    model_catalog_json: env.CODEX_LOOP_MODEL_CATALOG_JSON ?? resolve(root, "evals/sdk-orchestrated/model-catalog-bundled.json"),
    invocation_trace_label: `m12-test-coverage-dev-worker-smoke-${mode}`,
    invocation_trace_path: resolve(stageLogDir, `test-coverage-dev-worker-smoke-${mode}-invocation-trace-redacted.json`),
    error_capture_paths: {
      events_path: resolve(stageLogDir, `test-coverage-dev-worker-smoke-${mode}-events.jsonl`),
      stdout_path: resolve(stageLogDir, `test-coverage-dev-worker-smoke-${mode}-stdout.log`),
      stderr_path: resolve(stageLogDir, `test-coverage-dev-worker-smoke-${mode}-stderr.log`)
    },
    no_event_timeout_ms: 60_000,
    env: {
      CODEX_SQLITE_HOME: sqliteHome
    }
  };
}

function evaluateSmokeMode(input: {
  mode: TestCoverageDevWorkerSmokeMode;
  thread: RuntimeThreadResult;
  runtimeInput: RuntimeThreadInput;
  beforeTest: string;
  afterTest: string;
  beforeSource: string;
  afterSource: string;
  realSdkRunExecuted: boolean;
  targetRepo: string;
}): TestCoverageDevWorkerSmokeResult {
  const parsed = input.mode === "parity" ? null : parseDevWorkerLiteOutput(input.thread.final_response);
  const changedFiles = parsed?.output?.changed_files ?? [];
  const testsRun = parsed?.output?.tests_run ?? [];
  const fileChanged = input.beforeTest !== input.afterTest || changedFiles.includes("test/cache.test.js");
  const srcModified = input.beforeSource !== input.afterSource || changedFiles.some((file) => file === "src/cache.js" || file === "src/cache-storage.js");
  const npmTestRun = testsRun.some((entry) => entry === "npm test" || entry.includes("npm test"));
  const coverageRun = testsRun.some((entry) => entry.includes("coverage:contract"));
  const parityPass = input.mode === "parity" &&
    Boolean(input.thread.thread_id) &&
    input.thread.final_response.includes("TEST_COVERAGE_DEV_WORKER_PARITY_OK");
  const minimalPass = input.mode === "minimal" &&
    Boolean(input.thread.thread_id) &&
    parsed?.status === "PASS" &&
    fileChanged &&
    npmTestRun &&
    parsed.output?.tests_passed === true &&
    !srcModified;
  const exactPass = input.mode === "exact" &&
    Boolean(input.thread.thread_id) &&
    parsed?.status === "PASS" &&
    fileChanged &&
    npmTestRun &&
    coverageRun &&
    parsed.output?.tests_passed === true &&
    !srcModified;
  const pass = parityPass || minimalPass || exactPass;
  const events = readJsonlEvents(input.runtimeInput.error_capture_paths?.events_path ?? "");
  return {
    ...baseResult(input.mode),
    status: pass ? "PASS" : "FAIL",
    real_sdk_run_executed: input.realSdkRunExecuted,
    dev_worker_thread_started: Boolean(input.thread.thread_id),
    dev_worker_thread_id: input.thread.thread_id,
    file_change_verified: fileChanged,
    changed_files: changedFiles,
    npm_test_run: npmTestRun,
    npm_test_passed: parsed?.output?.tests_passed === true && npmTestRun,
    coverage_contract_run: coverageRun,
    coverage_contract_passed: input.mode === "exact" && parsed?.output?.tests_passed === true && coverageRun,
    src_modified: srcModified,
    structured_output_valid: input.mode === "parity" ? parityPass : parsed?.status === "PASS",
    dev_result_path: pass && input.mode !== "parity" ? resolve(input.targetRepo, "artifacts/dev-result.json") : "",
    final_response_contains_expected: pass,
    output_schema_used: input.mode !== "parity",
    prompt_length: input.runtimeInput.prompt.length,
    prompt_hash: stableHash(input.runtimeInput.prompt),
    prompt_max_length: TEST_COVERAGE_002_DEV_WORKER_PROMPT_MAX_LENGTH,
    prompt_requires_npm_test: input.runtimeInput.prompt.includes("npm test"),
    prompt_requires_coverage_contract: input.runtimeInput.prompt.includes("coverage:contract"),
    prompt_discourages_src_modification: /Do not modify src\/cache\.js or src\/cache-storage\.js/.test(input.runtimeInput.prompt),
    events_path: input.runtimeInput.error_capture_paths?.events_path ?? "",
    stdout_path: input.runtimeInput.error_capture_paths?.stdout_path ?? "",
    stderr_path: input.runtimeInput.error_capture_paths?.stderr_path ?? "",
    last_event_type: input.thread.last_event_type ?? lastEventType(events),
    elapsed_ms: input.thread.elapsed_ms ?? 0,
    event_count: (input.thread.event_count ?? events.length) || input.thread.events.length,
    failure_category: pass ? "" : failureCategoryForMode(input.mode, input.thread.failure_category),
    errors: pass ? [] : [...input.thread.errors, ...(parsed?.errors ?? [])]
  };
}

function finish(root: string, result: TestCoverageDevWorkerSmokeResult): TestCoverageDevWorkerSmokeResult {
  const readiness = result.status === "PASS"
    ? updateTestCoverageDevWorkerSmokeReadinessFromResult(root, result)
    : reconstructTestCoverageDevWorkerSmokeReadiness(root, { write: true });
  const withReadiness = {
    ...result,
    ready_for_one_dev_worker_parity_smoke: result.status === "BLOCKED_TEST_COVERAGE_DEV_WORKER_SMOKE_NOT_ENABLED" || readiness.ready_for_parity,
    ready_for_next_dev_worker_smoke: result.mode === "parity"
      ? readiness.ready_for_minimal
      : result.mode === "minimal"
        ? readiness.ready_for_exact
        : false,
    ready_for_test_coverage_002_treatment_rerun: readiness.ready_for_treatment_rerun
  };
  writeJson(resolve(root, resultPath), withReadiness);
  if (result.status === "PASS") {
    writeJson(resolve(root, `evals/effectiveness/reports/test-coverage-002/dev-worker-smoke-${result.mode}-result.json`), withReadiness);
    updateTestCoverageDevWorkerSmokeReadinessFromResult(root, withReadiness);
  }
  return withReadiness;
}

function baseResult(mode: TestCoverageDevWorkerSmokeMode): TestCoverageDevWorkerSmokeResult {
  return {
    case_id: "test-coverage-002",
    status: "FAIL",
    mode,
    real_sdk_run_executed: false,
    dev_worker_thread_started: false,
    dev_worker_thread_id: "",
    file_change_verified: false,
    changed_files: [],
    npm_test_run: false,
    npm_test_passed: false,
    coverage_contract_run: false,
    coverage_contract_passed: false,
    src_modified: false,
    structured_output_valid: false,
    dev_result_path: "",
    final_response_contains_expected: false,
    output_schema_used: false,
    prompt_length: 0,
    prompt_hash: "",
    prompt_max_length: TEST_COVERAGE_002_DEV_WORKER_PROMPT_MAX_LENGTH,
    prompt_requires_npm_test: false,
    prompt_requires_coverage_contract: false,
    prompt_discourages_src_modification: false,
    events_path: "",
    stdout_path: "",
    stderr_path: "",
    last_event_type: "",
    elapsed_ms: 0,
    event_count: 0,
    failure_category: "",
    ready_for_one_dev_worker_parity_smoke: true,
    ready_for_next_dev_worker_smoke: false,
    ready_for_test_coverage_002_treatment_rerun: false,
    danger_full_access_used: false,
    secret_leak_detected: false,
    sdk_diagnosis: emptySmokeSdkDiagnosis(),
    errors: []
  };
}

export function parseMode(value: string | undefined): TestCoverageDevWorkerSmokeMode {
  if (value === "parity" || value === "minimal" || value === "exact") return value;
  return "parity";
}

function failureCategoryForMode(mode: TestCoverageDevWorkerSmokeMode, fallback = ""): string {
  if (mode === "minimal") return "TEST_COVERAGE_002_DEV_MINIMAL_FAILED";
  if (mode === "exact") return "TEST_COVERAGE_002_DEV_EXACT_PROMPT_OR_VALIDATION_FAILED";
  return fallback || "TEST_COVERAGE_002_DEV_PARITY_FAILED";
}

function readFile(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

function readSources(targetRepo: string): string {
  return `${readFile(resolve(targetRepo, "src/cache.js"))}\n${readFile(resolve(targetRepo, "src/cache-storage.js"))}`;
}

function readJsonlEvents(path: string): unknown[] {
  if (!path || !existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as unknown;
      } catch {
        return { type: "unparseable" };
      }
    });
}

function lastEventType(events: unknown[]): string {
  let last = "";
  for (const event of events) {
    if (typeof event === "object" && event !== null && !Array.isArray(event) && typeof (event as { type?: unknown }).type === "string") {
      last = (event as { type: string }).type;
    }
  }
  return last;
}

function stableHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function getNodeMajorVersion(): number {
  return Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
}

function toSmokeSdkDiagnosis(status: CodexSdkDependencyStatus): TestCoverageDevWorkerSmokeSdkDiagnosis {
  return {
    package_json_has_codex_sdk: status.package_json_has_codex_sdk,
    package_lock_has_codex_sdk: status.package_lock_has_codex_sdk,
    npm_ls_codex_sdk_ok: status.npm_ls_codex_sdk_ok,
    dynamic_import_codex_sdk_ok: status.dynamic_import_codex_sdk_ok,
    codex_named_export_available: status.codex_named_export_available,
    codex_sdk_version: status.codex_sdk_version,
    codex_sdk_export_keys: status.codex_sdk_export_keys,
    failure_category: status.failure_category,
    error_message: status.error_message
  };
}

function emptySmokeSdkDiagnosis(): TestCoverageDevWorkerSmokeSdkDiagnosis {
  return {
    package_json_has_codex_sdk: false,
    package_lock_has_codex_sdk: false,
    npm_ls_codex_sdk_ok: false,
    dynamic_import_codex_sdk_ok: false,
    codex_named_export_available: false,
    codex_sdk_version: "",
    codex_sdk_export_keys: [],
    failure_category: "",
    error_message: ""
  };
}

class TestCoverageDevWorkerMockAdapter implements RuntimeAdapter {
  private readonly mode: TestCoverageDevWorkerSmokeMode;
  private readonly behavior: string;

  constructor(mode: TestCoverageDevWorkerSmokeMode, behavior: string) {
    this.mode = mode;
    this.behavior = behavior;
  }

  async startThread(input: RuntimeThreadInput): Promise<RuntimeThreadResult> {
    return this.runThread(input);
  }

  async runThread(input: RuntimeThreadInput): Promise<RuntimeThreadResult> {
    const threadId = `thread_test_coverage_dev_worker_${this.mode}`;
    const eventsPath = input.error_capture_paths?.events_path ?? "";
    if (eventsPath) writeFile(eventsPath, `{"type":"thread.started","thread_id":"${threadId}"}\n{"type":"turn.completed"}\n`);
    const fail = this.behavior === "fail" || this.behavior === `${this.mode}-fail`;
    if (input.working_directory && this.mode !== "parity" && !fail) {
      this.writeTestChange(input.working_directory);
    }
    return {
      thread_id: threadId,
      role: "dev_worker",
      status: fail ? "FAILED" : "PASS",
      final_response: this.response(fail),
      events: [{ type: "thread.started", thread_id: threadId }, { type: "turn.completed" }],
      events_path: eventsPath,
      stdout_path: input.error_capture_paths?.stdout_path ?? "",
      stderr_path: input.error_capture_paths?.stderr_path ?? "",
      artifacts: [],
      sandbox_control: "VERIFIED",
      last_event_type: "turn.completed",
      elapsed_ms: 25,
      event_count: 2,
      failure_category: fail ? failureCategoryForMode(this.mode) : "",
      errors: fail ? ["mock failure"] : []
    };
  }

  async resumeThread(input: RuntimeThreadRefInput): Promise<RuntimeThreadResult> {
    return { ...(await this.runThread({ ...input, thread_id: undefined } as unknown as RuntimeThreadInput)), thread_id: input.thread_id };
  }

  async getThreadEvents(input: RuntimeEventsInput): Promise<RuntimeThreadEventsResult> {
    return { thread_id: input.thread_id, events_path: input.events_path ?? "", events: [], errors: [] };
  }

  async stopThread(input: RuntimeStopThreadInput): Promise<RuntimeThreadResult> {
    return this.stub(input.thread_id);
  }

  async getFinalResponse(input: RuntimeFinalResponseInput): Promise<RuntimeThreadResult> {
    return this.stub(input.thread_id);
  }

  private response(fail: boolean): string {
    if (this.mode === "parity") return fail ? "NOPE" : "TEST_COVERAGE_DEV_WORKER_PARITY_OK";
    return JSON.stringify({
      status: fail ? "NEEDS_REVISION" : "PASS",
      changed_files: fail ? [] : ["test/cache.test.js"],
      tests_run: this.mode === "exact" ? ["npm test", "npm run coverage:contract"] : ["npm test"],
      tests_passed: !fail,
      summary: fail ? "mock failed" : "mock pass"
    });
  }

  private writeTestChange(targetRepo: string): void {
    const testPath = resolve(targetRepo, "test/cache.test.js");
    const current = readFile(testPath);
    writeFile(testPath, `${current}\n// M12 dev-worker smoke ${this.mode}\n`);
  }

  private stub(threadId: string): RuntimeThreadResult {
    return {
      thread_id: threadId,
      role: "dev_worker",
      status: "PASS",
      final_response: "",
      events: [],
      events_path: "",
      stdout_path: "",
      stderr_path: "",
      artifacts: [],
      errors: []
    };
  }
}

function writeFile(path: string, value: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value, "utf8");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await runTestCoverageDevWorkerSmoke();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.status === "FAIL" || result.status.startsWith("BLOCKED_") ? 2 : 0;
}
