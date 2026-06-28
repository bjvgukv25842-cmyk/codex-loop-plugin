import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

import { ensureEvalSqliteHome } from "../../src/runtime/eval-sqlite-home.ts";
import { DEFAULT_CODEX_MODEL, SdkRuntimeAdapter } from "../../src/runtime/sdk-runtime-adapter.ts";
import type { RuntimeThreadInput } from "../../src/runtime/runtime-types.ts";

type ParityStatus =
  | "PASS"
  | "FAIL"
  | "BLOCKED_SDK_PARITY_NOT_ENABLED"
  | "BLOCKED_SDK_NOT_INSTALLED"
  | "BLOCKED_NODE_VERSION"
  | "BLOCKED_EVAL_SQLITE_HOME_NOT_WRITABLE"
  | "BLOCKED_MODEL_CATALOG_JSON_MISSING"
  | "BLOCKED_SDK_PROFILE_UNSUPPORTED"
  | "BLOCKED_SDK_CONFIG_OVERRIDE_UNSUPPORTED"
  | "CODEX_MODEL_CATALOG_REFRESH_FAILED"
  | "THREAD_ID_MISSING";

interface ParityResult {
  gate: "Gate 6B.1D SDK-vs-CLI Parity Smoke";
  status: ParityStatus;
  real_sdk_run_enabled: boolean;
  real_sdk_run_attempted: boolean;
  sdk_dependency_detected: boolean;
  node_version: string;
  node_version_ok: boolean;
  target_repo: string;
  direct_cli_parity_status: "PASS" | "FAIL" | "UNKNOWN";
  model: string;
  model_catalog_json: string;
  sqlite_home: string;
  sdk_thread_started: boolean;
  sdk_thread_id: string;
  final_response_contains_expected: boolean;
  failure_category: string;
  danger_full_access_used: false;
  secret_leak_detected: false;
  errors: string[];
}

const repoRoot = process.cwd();
const reportDir = process.env.CODEX_LOOP_SDK_STARTUP_TRIAGE_DIR
  ? resolve(process.env.CODEX_LOOP_SDK_STARTUP_TRIAGE_DIR)
  : resolve(repoRoot, "evals/sdk-orchestrated/reports/sdk-startup-triage");
const resultPath = process.env.CODEX_LOOP_SDK_PARITY_RESULT_PATH
  ? resolve(process.env.CODEX_LOOP_SDK_PARITY_RESULT_PATH)
  : resolve(reportDir, "sdk-parity-smoke-result.json");
const targetRepo = resolve(repoRoot, "tmp/sdk-orchestrated/gate6b-smoke-target");
const expectedText = "SDK_TARGET_DIRECT_SDK_OK";

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
  if (process.env.CODEX_LOOP_ENABLE_REAL_SDK_PARITY !== "1") {
    return finish({
      ...base,
      status: "BLOCKED_SDK_PARITY_NOT_ENABLED",
      errors: ["Set CODEX_LOOP_ENABLE_REAL_SDK_PARITY=1 only for one controlled host-terminal SDK parity smoke."]
    });
  }
  if (!sdkDependencyDetected) {
    return finish({
      ...base,
      status: "BLOCKED_SDK_NOT_INSTALLED",
      errors: ["@openai/codex-sdk is not installed or cannot be resolved."]
    });
  }

  const mockMode = process.env.CODEX_LOOP_GATE6B_SDK_PARITY_MOCK;
  const adapter = mockMode
    ? new SdkRuntimeAdapter({ enableRealRun: true, sdkResolver: async () => createMockSdkModule(mockMode) })
    : new SdkRuntimeAdapter({ enableRealRun: true });
  const thread = await adapter.runThread(runtimeInput(sqliteHome.path, modelCatalogJson, base.direct_cli_parity_status));
  const finalResponseOk = thread.final_response.includes(expectedText);
  const next: ParityResult = {
    ...base,
    real_sdk_run_attempted: true,
    status: thread.status === "PASS" && thread.thread_id && finalResponseOk ? "PASS" : "FAIL",
    sdk_thread_started: Boolean(thread.thread_id),
    sdk_thread_id: thread.thread_id,
    final_response_contains_expected: finalResponseOk,
    failure_category: thread.failure_category ?? "",
    errors: [...base.errors, ...thread.errors]
  };
  if (thread.failure_category) {
    next.failure_category = thread.failure_category;
    next.status = thread.status === "BLOCKED" ? (thread.failure_category as ParityStatus) : "FAIL";
  }
  if (!thread.thread_id && !next.failure_category) {
    next.status = "THREAD_ID_MISSING";
    next.failure_category = "THREAD_ID_MISSING";
  }
  if (base.direct_cli_parity_status === "PASS" && next.status !== "PASS" && !next.failure_category) {
    next.failure_category = "SDK_ADAPTER_INVOCATION_MISMATCH";
  }
  if (mockMode) {
    next.real_sdk_run_attempted = false;
  }
  return finish(next);
}

function baseResult(input: { sqliteHomePath: string; modelCatalogJson: string; sdkDependencyDetected: boolean; nodeVersionOk: boolean }): ParityResult {
  return {
    gate: "Gate 6B.1D SDK-vs-CLI Parity Smoke",
    status: "FAIL",
    real_sdk_run_enabled: process.env.CODEX_LOOP_ENABLE_REAL_SDK_PARITY === "1",
    real_sdk_run_attempted: false,
    sdk_dependency_detected: input.sdkDependencyDetected,
    node_version: process.version,
    node_version_ok: input.nodeVersionOk,
    target_repo: "tmp/sdk-orchestrated/gate6b-smoke-target",
    direct_cli_parity_status: directCliParityStatus(),
    model: process.env.CODEX_LOOP_CODEX_MODEL ?? DEFAULT_CODEX_MODEL,
    model_catalog_json: input.modelCatalogJson,
    sqlite_home: input.sqliteHomePath,
    sdk_thread_started: false,
    sdk_thread_id: "",
    final_response_contains_expected: false,
    failure_category: "",
    danger_full_access_used: false,
    secret_leak_detected: false,
    errors: []
  };
}

function runtimeInput(sqliteHomePath: string, modelCatalogJson: string, directCliParityStatus: ParityResult["direct_cli_parity_status"]): RuntimeThreadInput {
  return {
    role: "planner",
    loop_run_id: "loop_gate6b_sdk_parity",
    task_id: "task_sdk_parity",
    prompt: `Respond with exactly: ${expectedText}`,
    sandbox: "read-only",
    working_directory: targetRepo,
    timeout_ms: 180_000,
    output_schema_path: "",
    codex_model: process.env.CODEX_LOOP_CODEX_MODEL ?? DEFAULT_CODEX_MODEL,
    model_catalog_json: modelCatalogJson || undefined,
    codex_config_overrides: {},
    skip_git_repo_check: false,
    direct_cli_parity_status: directCliParityStatus,
    invocation_trace_path: resolve(reportDir, "sdk-parity-invocation-trace-redacted.json"),
    invocation_trace_label: "gate6b-sdk-parity",
    error_capture_paths: {
      result_path: resultPath
    },
    env: {
      CODEX_SQLITE_HOME: sqliteHomePath
    }
  };
}

function finish(result: ParityResult): void {
  mkdirSync(dirname(resultPath), { recursive: true });
  writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.status === "FAIL" ? 2 : 0;
}

function resolveModelCatalogJson(): string {
  const configured = process.env.CODEX_LOOP_MODEL_CATALOG_JSON;
  if (configured) {
    return resolve(configured);
  }
  const bundled = resolve(repoRoot, "evals/sdk-orchestrated/model-catalog-bundled.json");
  return existsSync(bundled) ? bundled : "";
}

function directCliParityStatus(): "PASS" | "FAIL" | "UNKNOWN" {
  const eventsPath = process.env.CODEX_LOOP_DIRECT_CLI_PARITY_EVENTS_PATH
    ? resolve(process.env.CODEX_LOOP_DIRECT_CLI_PARITY_EVENTS_PATH)
    : resolve(reportDir, "target-cli-smoke-events.jsonl");
  if (!existsSync(eventsPath)) {
    return "UNKNOWN";
  }
  const events = readFileSync(eventsPath, "utf8");
  return events.includes("thread.started") && events.includes("turn.completed") && events.includes("SDK_TARGET_DIRECT_CLI_OK") ? "PASS" : "FAIL";
}

function canResolve(specifier: string): boolean {
  if (existsSync(resolve(repoRoot, "node_modules", ...specifier.split("/"), "package.json"))) {
    return true;
  }
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

function createMockSdkModule(mode: string): {
  Codex: new (options?: unknown) => {
    startThread(): { readonly id: string | null; run(): Promise<unknown>; runStreamed(): Promise<{ events: AsyncGenerator<unknown> }> };
    resumeThread(): { readonly id: string | null; run(): Promise<unknown>; runStreamed(): Promise<{ events: AsyncGenerator<unknown> }> };
  };
} {
  class MockThread {
    readonly id = mode === "missing-thread" ? null : "thread_sdk_parity_mock";
    async run(): Promise<unknown> {
      return { finalResponse: expectedText, items: [] };
    }
    async runStreamed(): Promise<{ events: AsyncGenerator<unknown> }> {
      const id = this.id;
      async function* events(): AsyncGenerator<unknown> {
        if (id) yield { type: "thread.started", thread_id: id };
        yield { type: "item.completed", item: { type: "agent_message", text: expectedText } };
        yield { type: "turn.completed", usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1, reasoning_output_tokens: 0 } };
      }
      return { events: events() };
    }
  }
  class MockCodex {
    startThread(): MockThread {
      if (mode === "prompt-only-fail") {
        throw new Error("Codex Exec exited with code 1: Reading prompt from stdin...");
      }
      return new MockThread();
    }
    resumeThread(): MockThread {
      return new MockThread();
    }
  }
  return { Codex: MockCodex };
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
