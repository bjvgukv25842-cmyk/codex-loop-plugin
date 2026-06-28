import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import {
  ModelCatalogJsonMissingError,
  RealSdkRunDisabledError,
  SdkCodexExportMissingError,
  SdkImportFailedError,
  SdkConfigOverrideUnsupportedError,
  SdkNodeVersionUnsupportedError,
  SdkNotInstalledError,
  SdkProfileUnsupportedError,
  ThreadIdMissingError
} from "./runtime-errors.ts";
import { emptyRuntimeResult, type RuntimeAdapter } from "./runtime-adapter.ts";
import { detectCodexSdkDependency, detectSdkCapability, type CodexSdkDependencyStatus, type SdkApiCapabilityMatrix } from "./sdk-capability-detect.ts";
import { classifySdkErrorMessage } from "./sdk-error-classifier.ts";
import { extractFinalResponse, normalizeSdkResult } from "./sdk-event-normalizer.ts";
import type {
  RuntimeEventsInput,
  RuntimeFinalResponseInput,
  RuntimeStopThreadInput,
  RuntimeThreadEventsResult,
  RuntimeThreadInput,
  RuntimeThreadRefInput,
  RuntimeThreadResult
} from "./runtime-types.ts";

interface CodexSdkModule {
  Codex: new (options?: { env?: Record<string, string>; config?: Record<string, unknown> }) => CodexClient;
}

interface CodexClient {
  startThread(options?: SdkThreadOptions): SdkThread;
  resumeThread(id: string, options?: SdkThreadOptions): SdkThread;
}

interface SdkThreadOptions {
  model?: string;
  sandboxMode?: "read-only" | "workspace-write";
  workingDirectory?: string;
  skipGitRepoCheck?: boolean;
  approvalPolicy?: "never" | "on-request" | "on-failure" | "untrusted";
  networkAccessEnabled?: boolean;
}

interface SdkThread {
  readonly id: string | null;
  run(input: string, options?: { outputSchema?: unknown; signal?: AbortSignal }): Promise<unknown>;
  runStreamed?(input: string, options?: { outputSchema?: unknown; signal?: AbortSignal }): Promise<{ events: AsyncGenerator<unknown> }>;
}

export type SdkDependencyResolver = () => Promise<CodexSdkModule>;

export const DEFAULT_CODEX_MODEL = "gpt-5.5";
export const SDK_INVOCATION_TRACE_PATH = "evals/sdk-orchestrated/reports/sdk-startup-triage/sdk-invocation-trace-redacted.json";

export interface SdkRuntimeAdapterOptions {
  enableRealRun?: boolean;
  sdkResolver?: SdkDependencyResolver;
  repoRoot?: string;
  preferStreamed?: boolean;
  capabilityDetector?: () => SdkApiCapabilityMatrix;
  sdkDependencyDetector?: () => Promise<CodexSdkDependencyStatus>;
}

export class SdkRuntimeAdapter implements RuntimeAdapter {
  private readonly enableRealRun: boolean;
  private readonly sdkResolver: SdkDependencyResolver;
  private readonly repoRoot: string;
  private readonly preferStreamed: boolean;
  private readonly capabilityDetector?: () => SdkApiCapabilityMatrix;
  private readonly sdkDependencyDetector?: () => Promise<CodexSdkDependencyStatus>;

  constructor(options: SdkRuntimeAdapterOptions = {}) {
    this.enableRealRun = options.enableRealRun ?? process.env.CODEX_LOOP_ENABLE_REAL_SDK_RUN === "1";
    this.sdkResolver = options.sdkResolver ?? defaultSdkResolver;
    this.repoRoot = options.repoRoot ?? process.cwd();
    this.preferStreamed = options.preferStreamed ?? true;
    this.capabilityDetector = options.capabilityDetector;
    this.sdkDependencyDetector = options.sdkDependencyDetector;
  }

  detectSdkCapability(): SdkApiCapabilityMatrix {
    return this.capabilityDetector ? this.capabilityDetector() : detectSdkCapability(this.repoRoot);
  }

  async startThread(input: RuntimeThreadInput): Promise<RuntimeThreadResult> {
    return this.runThread(input);
  }

  async runThread(input: RuntimeThreadInput): Promise<RuntimeThreadResult> {
    return this.runSdkTurn(input, { forceRun: true });
  }

  async runThreadStreamed(input: RuntimeThreadInput): Promise<RuntimeThreadResult> {
    return this.runSdkTurn(input, { forceStreamed: true });
  }

  async resumeThread(input: RuntimeThreadRefInput): Promise<RuntimeThreadResult> {
    const runtimeInput = {
      ...input,
      prompt: input.prompt ?? "",
      sandbox: input.sandbox ?? sandboxForRole(input.role),
      working_directory: input.working_directory ?? "",
      timeout_ms: input.timeout_ms ?? 180_000,
      output_schema_path: input.output_schema_path ?? "",
      output_schema: input.output_schema,
      codex_profile: input.codex_profile ?? process.env.CODEX_LOOP_CODEX_PROFILE,
      codex_model: input.codex_model ?? process.env.CODEX_LOOP_CODEX_MODEL ?? DEFAULT_CODEX_MODEL,
      model_catalog_json: input.model_catalog_json ?? process.env.CODEX_LOOP_MODEL_CATALOG_JSON ?? defaultModelCatalogJson(this.repoRoot),
      codex_config_overrides: input.codex_config_overrides ?? {},
      skip_git_repo_check: input.skip_git_repo_check,
      direct_cli_parity_status: input.direct_cli_parity_status ?? "UNKNOWN",
      invocation_trace_path: input.invocation_trace_path,
      invocation_trace_label: input.invocation_trace_label,
      error_capture_paths: input.error_capture_paths,
      no_event_timeout_ms: input.no_event_timeout_ms,
      env: defaultRuntimeEnv(input.env ?? {}, this.repoRoot)
    };
    const preflight = await this.preflight("resumeThread", runtimeInput);
    if (preflight) {
      return { ...preflight, thread_id: input.thread_id };
    }
    try {
      const sdk = await this.sdkResolver();
      this.writeInvocationTrace(runtimeInput);
      const codex = new sdk.Codex(codexOptions(runtimeInput));
      const thread = codex.resumeThread(input.thread_id, threadOptions(runtimeInput));
      return await this.executeThreadRun(thread, runtimeInput);
    } catch (error) {
      return sdkErrorResult(runtimeInput, error);
    }
  }

  async getThreadEvents(input: RuntimeEventsInput): Promise<RuntimeThreadEventsResult> {
    if (input.events_path) {
      return {
        thread_id: input.thread_id,
        events_path: input.events_path,
        events: readJsonlEvents(input.events_path),
        errors: []
      };
    }
    return {
      thread_id: input.thread_id,
      events_path: "",
      events: [],
      errors: ["SDK event collection is not implemented until a real @openai/codex-sdk integration is enabled."]
    };
  }

  async stopThread(input: RuntimeStopThreadInput): Promise<RuntimeThreadResult> {
    return {
      ...emptyRuntimeResult({ role: "context_distiller" }, "BLOCKED", [`SDK stopThread is not implemented yet: ${input.reason}`]),
      thread_id: input.thread_id
    };
  }

  async getFinalResponse(input: RuntimeFinalResponseInput): Promise<RuntimeThreadResult> {
    return {
      ...emptyRuntimeResult({ role: "context_distiller" }, "BLOCKED", ["SDK final response collection is not implemented until real SDK runs are enabled."]),
      thread_id: input.thread_id
    };
  }

  private async preflight(operation: string, input: RuntimeThreadInput): Promise<RuntimeThreadResult | null> {
    const sandboxError = validateRoleSandbox(input.role, input.sandbox);
    if (sandboxError) {
      return emptyRuntimeResult(input, "BLOCKED", [sandboxError]);
    }
    const configError = validateRuntimeConfigInput(input, this.detectSdkCapability());
    if (configError) {
      return {
        ...emptyRuntimeResult(input, "BLOCKED", [configError.message]),
        failure_category: configError.code
      };
    }
    if (!this.enableRealRun) {
      return emptyRuntimeResult(input, "BLOCKED", [new RealSdkRunDisabledError().message, `${operation} did not start a real SDK thread.`]);
    }
    const dependency = this.sdkDependencyDetector ? await this.sdkDependencyDetector() : await detectCodexSdkDependency(this.repoRoot);
    if (!dependency.detected) {
      return {
        ...emptyRuntimeResult(input, "BLOCKED", [dependencyErrorMessage(dependency)]),
        failure_category: dependency.failure_category
      };
    }
    try {
      await this.sdkResolver();
    } catch (error) {
      if (isModuleNotFound(error)) {
        return emptyRuntimeResult(input, "BLOCKED", [new SdkNotInstalledError().message]);
      }
      return sdkErrorResult(input, error);
    }
    return null;
  }

  private async runSdkTurn(input: RuntimeThreadInput, options: { forceRun?: boolean; forceStreamed?: boolean } = {}): Promise<RuntimeThreadResult> {
    const runtimeInput = normalizeRuntimeInput(input, this.repoRoot);
    const preflight = await this.preflight(options.forceStreamed ? "runThreadStreamed" : "runThread", runtimeInput);
    if (preflight) {
      return preflight;
    }
    try {
      const sdk = await this.sdkResolver();
      this.writeInvocationTrace(runtimeInput, options);
      const codex = new sdk.Codex(codexOptions(runtimeInput));
      const thread = codex.startThread(threadOptions(runtimeInput));
      return await this.executeThreadRun(thread, runtimeInput, options);
    } catch (error) {
      return sdkErrorResult(runtimeInput, error);
    }
  }

  private writeInvocationTrace(input: RuntimeThreadInput, options: { forceRun?: boolean; forceStreamed?: boolean } = {}): void {
    const capability = this.detectSdkCapability();
    const env = runtimeEnv(input);
    const config = runtimeConfig(input);
    const thread = threadOptions(input);
    const outputSchema = input.output_schema ?? readOutputSchema(input.output_schema_path);
    const trace = {
      trace_label: input.invocation_trace_label ?? "sdk-runtime-adapter",
      codex_sdk_version: capability.package_version,
      node_version: process.version,
      node_process_cwd: process.cwd(),
      target_repo: input.working_directory,
      target_repo_is_git: existsSync(resolve(input.working_directory, ".git")),
      constructor_options: {
        env_keys: redactedEnvKeys(env),
        config_keys: Object.keys(config).sort(),
        config_values_redacted: {
          sqlite_home: typeof config.sqlite_home === "string" ? config.sqlite_home : "",
          model_catalog_json: typeof config.model_catalog_json === "string" ? config.model_catalog_json : "",
          model: typeof config.model === "string" ? config.model : ""
        }
      },
      start_thread_options: {
        workingDirectory: thread.workingDirectory ?? "",
        skipGitRepoCheck: thread.skipGitRepoCheck ?? false,
        sandboxMode: thread.sandboxMode ?? "",
        model: thread.model ?? ""
      },
      run_options: {
        usesOutputSchema: Boolean(input.output_schema || input.output_schema_path),
        outputSchemaWasPassedToSdk: Boolean(outputSchema),
        outputSchemaPath: input.output_schema_path || "",
        outputSchemaHash: outputSchema ? stableHash(outputSchema) : "",
        outputSchemaKeys: Object.keys(isRecord(outputSchema) ? outputSchema : {}).sort(),
        usesRunStreamed: shouldUseStreamed(this.preferStreamed, options),
        sandboxMode: thread.sandboxMode ?? "",
        sdkMethod: shouldUseStreamed(this.preferStreamed, options) ? "runStreamed" : "run"
      },
      prompt: {
        length: input.prompt.length,
        hash: stableHash(input.prompt)
      },
      sdk_api_method: shouldUseStreamed(this.preferStreamed, options) ? "runStreamed" : "run",
      error_capture_paths: input.error_capture_paths ?? {},
      direct_cli_parity_status: input.direct_cli_parity_status ?? "UNKNOWN"
    };
    const path = resolve(this.repoRoot, input.invocation_trace_path ?? SDK_INVOCATION_TRACE_PATH);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(trace, null, 2)}\n`, "utf8");
  }

  private async executeThreadRun(thread: SdkThread, input: RuntimeThreadInput, options: { forceRun?: boolean; forceStreamed?: boolean } = {}): Promise<RuntimeThreadResult> {
    const capability = this.detectSdkCapability();
    const outputSchema = input.output_schema ?? readOutputSchema(input.output_schema_path);
    const abortController = new AbortController();
    const startedAt = Date.now();
    const events: unknown[] = [];
    let lastEventAt = startedAt;
    let lastEventType = "";
    let threadStartedId = "";
    let noEventTimeout = false;
    const timeoutMs = Math.min(input.timeout_ms, 180_000);
    const noEventTimeoutMs = input.no_event_timeout_ms ?? Number.parseInt(process.env.CODEX_LOOP_SDK_NO_EVENT_TIMEOUT_MS ?? "30000", 10);
    const useStreamed = shouldUseStreamed(this.preferStreamed, options);
    const timeout = setTimeout(() => abortController.abort(), timeoutMs);
    const noEventTimeoutHandle = useStreamed
      ? setInterval(() => {
          if (Date.now() - lastEventAt >= noEventTimeoutMs) {
            noEventTimeout = true;
            abortController.abort();
          }
        }, Math.min(Math.max(noEventTimeoutMs, 100), 1000))
      : null;
    try {
      if (useStreamed && thread.runStreamed) {
        const streamed = await thread.runStreamed(input.prompt, {
          outputSchema,
          signal: abortController.signal
        });
        let finalResponse = "";
        for await (const event of streamed.events) {
          events.push(event);
          lastEventAt = Date.now();
          lastEventType = eventType(event);
          appendEvent(input.error_capture_paths?.events_path, event);
          const maybeThreadId = threadIdFromEvent(event);
          if (maybeThreadId) {
            threadStartedId = maybeThreadId;
          }
          const maybeText = extractAgentText(event);
          if (maybeText) {
            finalResponse = maybeText;
          }
        }
        const threadId = extractThreadId(thread, events);
        if (!threadId) {
          return {
            ...emptyRuntimeResult(input, "BLOCKED", [new ThreadIdMissingError().message]),
            sandbox_control: capability.sdk_sandbox_control
          };
        }
        ensureCaptureFiles(input.error_capture_paths);
        writeCapture(input.error_capture_paths?.stdout_path, finalResponse);
        writeCapture(input.error_capture_paths?.stderr_path, "");
        return {
          ...normalizeSdkResult({
            role: input.role,
            thread_id: threadId,
            turn: { finalResponse, events },
            events,
            sandbox_control: capability.sdk_sandbox_control
          }),
          events_path: input.error_capture_paths?.events_path ?? "",
          stdout_path: input.error_capture_paths?.stdout_path ?? "",
          stderr_path: input.error_capture_paths?.stderr_path ?? "",
          event_count: events.length,
          last_event_type: lastEventType,
          elapsed_ms: Date.now() - startedAt
        };
      }
      if (options.forceStreamed && !thread.runStreamed) {
        return {
          ...emptyRuntimeResult(input, "BLOCKED", ["SDK_RUN_STREAMED_UNSUPPORTED"]),
          sandbox_control: capability.sdk_sandbox_control,
          failure_category: "SDK_RUN_STREAMED_UNSUPPORTED"
        };
      }
      const turn = await thread.run(input.prompt, {
        outputSchema,
        signal: abortController.signal
      });
      const runEvents = Array.isArray((turn as { items?: unknown }).items) ? (turn as { items: unknown[] }).items : [];
      for (const event of runEvents) {
        appendEvent(input.error_capture_paths?.events_path, event);
      }
      const threadId = extractThreadId(thread, runEvents);
      if (!threadId) {
        return {
          ...emptyRuntimeResult(input, "BLOCKED", [new ThreadIdMissingError().message]),
          sandbox_control: capability.sdk_sandbox_control
        };
      }
      ensureCaptureFiles(input.error_capture_paths);
      writeCapture(input.error_capture_paths?.stdout_path, extractFinalResponse(turn as Record<string, unknown>));
      writeCapture(input.error_capture_paths?.stderr_path, "");
      const runLastEventType = lastEventTypeFromEvents(runEvents);
      return {
        ...normalizeSdkResult({
          role: input.role,
          thread_id: threadId,
          turn: turn as Record<string, unknown>,
          events: runEvents,
          sandbox_control: capability.sdk_sandbox_control
        }),
          events_path: input.error_capture_paths?.events_path ?? "",
          stdout_path: input.error_capture_paths?.stdout_path ?? "",
          stderr_path: input.error_capture_paths?.stderr_path ?? "",
          event_count: runEvents.length,
          last_event_type: runLastEventType,
          elapsed_ms: Date.now() - startedAt
        };
    } catch (error) {
      if (abortController.signal.aborted) {
        const threadId = threadStartedId || extractThreadId(thread, events);
        const failureCategory = threadId ? "SDK_PLANNER_TURN_TIMEOUT" : "SDK_PLANNER_THREAD_STARTUP_TIMEOUT";
        return {
          ...emptyRuntimeResult(input, "TIMEOUT", [`SDK thread exceeded timeout_ms=${timeoutMs}.`]),
          thread_id: threadId,
          events,
          events_path: input.error_capture_paths?.events_path ?? "",
          stdout_path: input.error_capture_paths?.stdout_path ?? "",
          stderr_path: input.error_capture_paths?.stderr_path ?? "",
          sandbox_control: capability.sdk_sandbox_control,
          failure_category: noEventTimeout ? "SDK_NO_EVENT_TIMEOUT" : failureCategory,
          no_event_timeout: noEventTimeout,
          event_count: events.length,
          last_event_type: lastEventType,
          elapsed_ms: Date.now() - startedAt
        };
      }
      const errorMessage = error instanceof Error ? error.message : String(error);
      writeCapture(input.error_capture_paths?.stderr_path, errorMessage);
      if (useStreamed && events.length > 0) {
        const threadId = threadStartedId || extractThreadId(thread, events);
        return {
          ...emptyRuntimeResult(input, "FAILED", [errorMessage]),
          thread_id: threadId,
          events,
          events_path: input.error_capture_paths?.events_path ?? "",
          stdout_path: input.error_capture_paths?.stdout_path ?? "",
          stderr_path: input.error_capture_paths?.stderr_path ?? "",
          sandbox_control: capability.sdk_sandbox_control,
          failure_category: "SDK_RUNSTREAMED_EVENT_STREAM_ISSUE",
          event_count: events.length,
          last_event_type: lastEventType,
          elapsed_ms: Date.now() - startedAt
        };
      }
      return sdkErrorResult(input, error, capability.sdk_sandbox_control);
    } finally {
      clearTimeout(timeout);
      if (noEventTimeoutHandle) clearInterval(noEventTimeoutHandle);
    }
  }
}

export function sandboxForRole(role: RuntimeThreadInput["role"]): RuntimeThreadInput["sandbox"] {
  if (role === "planner" || role === "dev_worker_completion" || role === "evaluator" || role === "final_evaluator" || role === "context_distiller") {
    return "read-only";
  }
  return "workspace-write";
}

export function validateRoleSandbox(role: RuntimeThreadInput["role"], sandbox: RuntimeThreadInput["sandbox"]): string | null {
  const expected = sandboxForRole(role);
  return sandbox === expected ? null : `${role} must use sandbox ${expected}, received ${sandbox}.`;
}

async function defaultSdkResolver(): Promise<CodexSdkModule> {
  const specifier = "@openai/codex-sdk";
  return import(specifier) as Promise<CodexSdkModule>;
}

function dependencyErrorMessage(dependency: CodexSdkDependencyStatus): string {
  if (dependency.failure_category === "BLOCKED_NODE_VERSION_UNSUPPORTED") {
    return new SdkNodeVersionUnsupportedError().message;
  }
  if (dependency.failure_category === "BLOCKED_SDK_EXPORT_MISSING_CODEX") {
    return new SdkCodexExportMissingError().message;
  }
  if (dependency.failure_category === "BLOCKED_SDK_IMPORT_FAILED") {
    return new SdkImportFailedError(dependency.error_message).message;
  }
  return new SdkNotInstalledError().message;
}

function isModuleNotFound(error: unknown): boolean {
  return error instanceof Error && /Cannot find package '@openai\/codex-sdk'|ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND/.test(error.message);
}

function readJsonlEvents(path: string): unknown[] {
  try {
    return readFileSync(path, "utf8")
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as unknown);
  } catch {
    return [];
  }
}

function runtimeEnv(input: RuntimeThreadInput): Record<string, string> {
  const base: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") {
      base[key] = value;
    }
  }
  return {
    ...base,
    ...input.env
  };
}

function redactedEnvKeys(env: Record<string, string>): string[] {
  return Object.keys(env)
    .map((key) => (/API|AUTH|CREDENTIAL|KEY|SECRET|TOKEN/i.test(key) ? "REDACTED_SENSITIVE_ENV_KEY" : key))
    .filter((key, index, keys) => keys.indexOf(key) === index)
    .sort();
}

function normalizeRuntimeInput(input: RuntimeThreadInput, repoRoot: string): RuntimeThreadInput {
  return {
    ...input,
    working_directory: input.working_directory ? resolve(input.working_directory) : input.working_directory,
    codex_model: input.codex_model ?? process.env.CODEX_LOOP_CODEX_MODEL ?? DEFAULT_CODEX_MODEL,
    model_catalog_json: input.model_catalog_json
      ? resolve(input.model_catalog_json)
      : (process.env.CODEX_LOOP_MODEL_CATALOG_JSON ? resolve(process.env.CODEX_LOOP_MODEL_CATALOG_JSON) : defaultModelCatalogJson(repoRoot)),
    direct_cli_parity_status: input.direct_cli_parity_status ?? "UNKNOWN",
    invocation_trace_path: input.invocation_trace_path,
    invocation_trace_label: input.invocation_trace_label,
    error_capture_paths: input.error_capture_paths,
    no_event_timeout_ms: input.no_event_timeout_ms,
    env: defaultRuntimeEnv(input.env, repoRoot)
  };
}

function stableHash(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return createHash("sha256").update(text ?? "").digest("hex");
}

function codexOptions(input: RuntimeThreadInput): { env?: Record<string, string>; config?: Record<string, unknown> } {
  return {
    env: runtimeEnv(input),
    config: runtimeConfig(input)
  };
}

function runtimeConfig(input: RuntimeThreadInput): Record<string, unknown> {
  const config: Record<string, unknown> = {
    ...(input.codex_config_overrides ?? {})
  };
  const sqliteHome = input.env.CODEX_SQLITE_HOME;
  if (sqliteHome) {
    config.sqlite_home = sqliteHome;
  }
  if (input.codex_model) {
    config.model = input.codex_model;
  }
  if (input.model_catalog_json) {
    config.model_catalog_json = input.model_catalog_json;
  }
  return config;
}

function threadOptions(input: RuntimeThreadInput): SdkThreadOptions {
  return {
    model: input.codex_model ?? DEFAULT_CODEX_MODEL,
    sandboxMode: input.sandbox,
    workingDirectory: input.working_directory ? resolve(input.working_directory) : input.working_directory,
    skipGitRepoCheck: input.skip_git_repo_check ?? false,
    approvalPolicy: "never",
    networkAccessEnabled: false
  };
}

function defaultRuntimeEnv(env: Record<string, string>, repoRoot: string): Record<string, string> {
  return {
    CODEX_SQLITE_HOME: resolve(repoRoot, ".codex-eval/sqlite"),
    ...env
  };
}

function defaultModelCatalogJson(repoRoot: string): string | undefined {
  const path = resolve(repoRoot, "evals/sdk-orchestrated/model-catalog-bundled.json");
  return existsSync(path) ? path : undefined;
}

function readOutputSchema(path: string): unknown | undefined {
  if (!path) {
    return undefined;
  }
  try {
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch {
    return undefined;
  }
}

function extractThreadId(thread: SdkThread, events: unknown[]): string {
  if (typeof thread.id === "string" && thread.id.length > 0) {
    return thread.id;
  }
  for (const event of events) {
    const threadId = threadIdFromEvent(event);
    if (threadId) {
      return threadId;
    }
  }
  return "";
}

function appendEvent(path: string | undefined, event: unknown): void {
  if (!path) return;
  const absolute = resolve(path);
  mkdirSync(dirname(absolute), { recursive: true });
  appendFileSync(absolute, `${JSON.stringify(event)}\n`, "utf8");
}

function ensureCaptureFiles(paths: RuntimeThreadInput["error_capture_paths"]): void {
  for (const path of [paths?.events_path, paths?.stdout_path, paths?.stderr_path]) {
    if (!path || existsSync(resolve(path))) continue;
    writeCapture(path, "");
  }
}

function shouldUseStreamed(preferStreamed: boolean, options: { forceRun?: boolean; forceStreamed?: boolean }): boolean {
  if (options.forceRun) return false;
  if (options.forceStreamed) return true;
  return preferStreamed;
}

function lastEventTypeFromEvents(events: unknown[]): string {
  let last = "";
  for (const event of events) {
    const type = eventType(event);
    if (type) last = type;
  }
  return last;
}

function writeCapture(path: string | undefined, text: string): void {
  if (!path) return;
  const absolute = resolve(path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, text, "utf8");
}

function threadIdFromEvent(event: unknown): string {
  if (isRecord(event) && event.type === "thread.started" && typeof event.thread_id === "string" && event.thread_id.length > 0) {
    return event.thread_id;
  }
  return "";
}

function eventType(event: unknown): string {
  return isRecord(event) && typeof event.type === "string" ? event.type : "";
}

function extractAgentText(event: unknown): string {
  if (!isRecord(event)) {
    return "";
  }
  const item = isRecord(event.item) ? event.item : null;
  if (item && item.type === "agent_message" && typeof item.text === "string") {
    return item.text;
  }
  return "";
}

function sdkErrorResult(input: RuntimeThreadInput, error: unknown, sandboxControl: RuntimeThreadResult["sandbox_control"] = "UNVERIFIED"): RuntimeThreadResult {
  if (isModuleNotFound(error)) {
    return {
      ...emptyRuntimeResult(input, "BLOCKED", [new SdkNotInstalledError().message]),
      sandbox_control: sandboxControl
    };
  }
  const message = error instanceof Error ? error.message : String(error);
  const category = classifySdkErrorMessage(message, {
    directCliParityStatus: input.direct_cli_parity_status,
    usesOutputSchema: Boolean(input.output_schema || input.output_schema_path)
  });
  return {
    ...emptyRuntimeResult(input, category === "SDK_THREAD_FAILED" ? "FAILED" : "BLOCKED", [message]),
    sandbox_control: sandboxControl,
    failure_category: category
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateRuntimeConfigInput(input: RuntimeThreadInput, capability: SdkApiCapabilityMatrix): { code: string; message: string } | null {
  if (input.codex_profile) {
    const error = new SdkProfileUnsupportedError();
    return {
      code: error.code,
      message: error.message
    };
  }
  if (!capability.config_supported && (input.model_catalog_json || input.codex_model || Object.keys(input.codex_config_overrides ?? {}).length > 0)) {
    const error = new SdkConfigOverrideUnsupportedError();
    return {
      code: error.code,
      message: error.message
    };
  }
  if (input.model_catalog_json && !existsSync(input.model_catalog_json)) {
    const error = new ModelCatalogJsonMissingError(input.model_catalog_json);
    return {
      code: error.code,
      message: error.message
    };
  }
  return null;
}
