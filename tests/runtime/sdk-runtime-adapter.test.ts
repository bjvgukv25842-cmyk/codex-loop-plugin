import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { DEFAULT_CODEX_MODEL, SdkRuntimeAdapter, sandboxForRole, validateRoleSandbox } from "../../src/runtime/sdk-runtime-adapter.ts";
import type { RuntimeThreadInput } from "../../src/runtime/runtime-types.ts";
import { extractFinalResponse } from "../../src/runtime/sdk-event-normalizer.ts";
import { classifySdkErrorMessage } from "../../src/runtime/sdk-error-classifier.ts";

describe("SdkRuntimeAdapter", () => {
  it("returns BLOCKED_SDK_NOT_ENABLED when real SDK runs are disabled", async () => {
    const adapter = new SdkRuntimeAdapter({ enableRealRun: false });
    const result = await adapter.runThread(input());

    expect(result.status).toBe("BLOCKED");
    expect(result.thread_id).toBe("");
    expect(result.errors.join(" ")).toContain("CODEX_LOOP_ENABLE_REAL_SDK_RUN=1");
  });

  it("returns BLOCKED_SDK_NOT_INSTALLED when enabled but dependency is missing", async () => {
    const adapter = new SdkRuntimeAdapter({
      enableRealRun: true,
      sdkResolver: async () => {
        throw new Error("Cannot find package '@openai/codex-sdk'");
      }
    });

    const result = await adapter.runThread(input());

    expect(result.status).toBe("BLOCKED");
    expect(result.errors.join(" ")).toContain("@openai/codex-sdk is not installed");
  });

  it("returns BLOCKED_SDK_EXPORT_MISSING_CODEX when dynamic import lacks Codex", async () => {
    const adapter = new SdkRuntimeAdapter({
      enableRealRun: true,
      sdkDependencyDetector: async () => ({
        package_name: "@openai/codex-sdk",
        detected: false,
        node_version: process.version,
        node_supported: true,
        package_json_has_codex_sdk: true,
        package_lock_has_codex_sdk: true,
        npm_ls_codex_sdk_ok: true,
        dynamic_import_codex_sdk_ok: true,
        codex_named_export_available: false,
        codex_sdk_version: "0.0.0-test",
        codex_sdk_export_keys: ["Thread"],
        failure_category: "BLOCKED_SDK_EXPORT_MISSING_CODEX",
        error_message: "@openai/codex-sdk imported, but Codex export is missing."
      }),
      sdkResolver: async () => ({} as never)
    });

    const result = await adapter.runThread(input());

    expect(result.status).toBe("BLOCKED");
    expect(result.failure_category).toBe("BLOCKED_SDK_EXPORT_MISSING_CODEX");
  });

  it("enforces role sandbox boundaries", async () => {
    expect(sandboxForRole("planner")).toBe("read-only");
    expect(sandboxForRole("dev_worker_completion")).toBe("read-only");
    expect(sandboxForRole("evaluator")).toBe("read-only");
    expect(sandboxForRole("final_evaluator")).toBe("read-only");
    expect(sandboxForRole("dev_worker")).toBe("workspace-write");
    expect(sandboxForRole("repair_dev_worker")).toBe("workspace-write");
    expect(validateRoleSandbox("evaluator", "workspace-write")).toContain("read-only");
    expect(validateRoleSandbox("dev_worker", "read-only")).toContain("workspace-write");
    expect(validateRoleSandbox("dev_worker_completion", "workspace-write")).toContain("read-only");
  });

  it("runThread uses SDK run() and extracts the final response without streaming", async () => {
    const adapter = new SdkRuntimeAdapter({
      enableRealRun: true,
      preferStreamed: true,
      sdkResolver: async () => ({
        Codex: MockCodex
      })
    });

    const result = await adapter.runThread(input());

    expect(result.status).toBe("PASS");
    expect(result.thread_id).toBe("thread_mock");
    expect(result.final_response).toContain("\"status\":\"PASS\"");
    expect(result.events).toEqual([]);
    expect(result.sandbox_control).toBe("VERIFIED");
  });

  it("runThreadStreamed uses SDK runStreamed and captures events", async () => {
    const adapter = new SdkRuntimeAdapter({
      enableRealRun: true,
      sdkResolver: async () => ({
        Codex: MockCodex
      })
    });

    const result = await adapter.runThreadStreamed(input());

    expect(result.status).toBe("PASS");
    expect(result.thread_id).toBe("thread_mock");
    expect(result.final_response).toContain("\"status\":\"PASS\"");
    expect(result.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "thread.started"
        })
      ])
    );
    expect(result.last_event_type).toBe("turn.completed");
  });

  it("writes streamed SDK events to JSONL when an events path is provided", async () => {
    const dir = mkdtempSync(resolve(tmpdir(), "sdk-events-jsonl-"));
    const eventsPath = resolve(dir, "events.jsonl");
    const adapter = new SdkRuntimeAdapter({
      enableRealRun: true,
      sdkResolver: async () => ({
        Codex: MockCodex
      })
    });

    const result = await adapter.runThreadStreamed(
      input({
        error_capture_paths: {
          events_path: eventsPath
        }
      })
    );

    expect(result.status).toBe("PASS");
    expect(result.events_path).toBe(eventsPath);
    expect(existsSync(eventsPath)).toBe(true);
    expect(readFileSync(eventsPath, "utf8")).toContain("thread.started");
  });

  it("returns THREAD_ID_MISSING when SDK result has no thread id", async () => {
    const adapter = new SdkRuntimeAdapter({
      enableRealRun: true,
      sdkResolver: async () => ({
        Codex: MockCodexMissingThread
      })
    });

    const result = await adapter.runThread(input());

    expect(result.status).toBe("BLOCKED");
    expect(result.thread_id).toBe("");
    expect(result.errors.join(" ")).toContain("thread_id");
  });

  it("classifies Codex model catalog refresh failures separately from SDK_THREAD_FAILED", async () => {
    const message =
      "Codex Exec exited with code 1: ERROR codex_models_manager::manager: failed to refresh available models: failed to decode models response: missing field `models`; body: {\"data\":[{\"id\":\"x\"}],\"object\":\"list\"}";
    expect(classifySdkErrorMessage(message)).toBe("CODEX_MODEL_CATALOG_REFRESH_FAILED");

    const adapter = new SdkRuntimeAdapter({
      enableRealRun: true,
      sdkResolver: async () => ({
        Codex: class {
          startThread(): MockThreadCatalogFailure {
            return new MockThreadCatalogFailure(message);
          }

          resumeThread(): MockThreadCatalogFailure {
            return new MockThreadCatalogFailure(message);
          }
        }
      })
    });

    const result = await adapter.runThread(input());

    expect(result.status).toBe("BLOCKED");
    expect(result.failure_category).toBe("CODEX_MODEL_CATALOG_REFRESH_FAILED");
    expect(result.failure_category).not.toBe("SDK_THREAD_FAILED");
  });

  it("blocks when model_catalog_json path is missing", async () => {
    const adapter = new SdkRuntimeAdapter({
      enableRealRun: true,
      sdkResolver: async () => ({
        Codex: MockCodex
      })
    });

    const result = await adapter.runThread(input({ model_catalog_json: "/tmp/does-not-exist-codex-model-catalog.json" }));

    expect(result.status).toBe("BLOCKED");
    expect(result.failure_category).toBe("BLOCKED_MODEL_CATALOG_JSON_MISSING");
  });

  it("passes model override and model_catalog_json into Codex config", async () => {
    const seen: Array<{ options?: unknown }> = [];
    const adapter = new SdkRuntimeAdapter({
      enableRealRun: true,
      sdkResolver: async () => ({
        Codex: class extends MockCodex {
          constructor(options?: unknown) {
            super();
            seen.push({ options });
          }
        }
      })
    });

    const result = await adapter.runThread(
      input({
        codex_model: "gpt-test",
        model_catalog_json: "package.json",
        codex_config_overrides: {
          show_raw_agent_reasoning: true
        }
      })
    );

    expect(result.status).toBe("PASS");
    expect(seen[0]?.options).toMatchObject({
      config: {
        model: "gpt-test",
        model_catalog_json: expect.stringContaining("package.json"),
        show_raw_agent_reasoning: true
      }
    });
  });

  it("passes parity-style env, config, thread, and run options into the SDK", async () => {
    const seen: {
      constructorOptions?: unknown;
      startThreadOptions?: unknown;
      runOptions?: unknown;
    } = {};
    const adapter = new SdkRuntimeAdapter({
      enableRealRun: true,
      sdkResolver: async () => ({
        Codex: class {
          constructor(options?: unknown) {
            seen.constructorOptions = options;
          }
          startThread(options?: unknown): MockThread {
            seen.startThreadOptions = options;
            return new MockThread("thread_mock", (options) => {
              seen.runOptions = options;
            });
          }
          resumeThread(): MockThread {
            return new MockThread("thread_mock");
          }
        }
      })
    });

    const result = await adapter.runThread(
      input({
        codex_model: "gpt-test",
        model_catalog_json: "package.json",
        env: {
          CODEX_SQLITE_HOME: "/tmp/codex-loop-sqlite"
        },
        skip_git_repo_check: false,
        output_schema: { type: "object" }
      })
    );

    expect(result.status).toBe("PASS");
    expect(seen.constructorOptions).toMatchObject({
      env: {
        CODEX_SQLITE_HOME: "/tmp/codex-loop-sqlite"
      },
      config: {
        sqlite_home: "/tmp/codex-loop-sqlite",
        model_catalog_json: expect.stringContaining("package.json"),
        model: "gpt-test"
      }
    });
    expect(seen.startThreadOptions).toMatchObject({
      model: "gpt-test",
      sandboxMode: "read-only",
      skipGitRepoCheck: false,
      approvalPolicy: "never",
      networkAccessEnabled: false
    });
    expect(seen.startThreadOptions).toHaveProperty("workingDirectory");
    expect(seen.runOptions).toMatchObject({
      outputSchema: { type: "object" }
    });
  });

  it("records run as the SDK API method for runThread even when preferStreamed is true", async () => {
    const dir = mkdtempSync(resolve(tmpdir(), "sdk-method-run-"));
    const tracePath = resolve(dir, "trace.json");
    const adapter = new SdkRuntimeAdapter({
      enableRealRun: true,
      preferStreamed: true,
      sdkResolver: async () => ({
        Codex: MockCodex
      })
    });

    const result = await adapter.runThread(input({ invocation_trace_path: tracePath }));
    const trace = JSON.parse(readFileSync(tracePath, "utf8")) as { sdk_api_method?: string; run_options?: { usesRunStreamed?: boolean } };

    expect(result.status).toBe("PASS");
    expect(trace.sdk_api_method).toBe("run");
    expect(trace.run_options?.usesRunStreamed).toBe(false);
  });

  it("records output schema invocation evidence in the SDK trace", async () => {
    const dir = mkdtempSync(resolve(tmpdir(), "sdk-output-schema-trace-"));
    const tracePath = resolve(dir, "trace.json");
    const adapter = new SdkRuntimeAdapter({
      enableRealRun: true,
      sdkResolver: async () => ({
        Codex: MockCodex
      })
    });

    const result = await adapter.runThreadStreamed(input({
      invocation_trace_path: tracePath,
      output_schema: {
        type: "object",
        additionalProperties: false,
        required: ["status"],
        properties: {
          status: { type: "string" }
        }
      }
    }));
    const trace = JSON.parse(readFileSync(tracePath, "utf8")) as {
      run_options?: {
        usesOutputSchema?: boolean;
        outputSchemaWasPassedToSdk?: boolean;
        outputSchemaHash?: string;
        outputSchemaKeys?: string[];
        sdkMethod?: string;
        sandboxMode?: string;
      };
      start_thread_options?: { workingDirectory?: string; sandboxMode?: string; model?: string };
    };

    expect(result.status).toBe("PASS");
    expect(trace.run_options).toMatchObject({
      usesOutputSchema: true,
      outputSchemaWasPassedToSdk: true,
      sdkMethod: "runStreamed",
      sandboxMode: "read-only"
    });
    expect(trace.run_options?.outputSchemaHash).toMatch(/^[a-f0-9]{64}$/);
    expect(trace.run_options?.outputSchemaKeys).toEqual(["additionalProperties", "properties", "required", "type"]);
    expect(trace.start_thread_options).toMatchObject({
      sandboxMode: "read-only",
      model: DEFAULT_CODEX_MODEL
    });
  });

  it("classifies streamed no-event after thread and turn start without waiting for overall timeout", async () => {
    const adapter = new SdkRuntimeAdapter({
      enableRealRun: true,
      sdkResolver: async () => ({
        Codex: MockCodexStreamedNoCompletion
      })
    });

    const result = await adapter.runThreadStreamed(input({ no_event_timeout_ms: 20 }));

    expect(result.status).toBe("TIMEOUT");
    expect(result.thread_id).toBe("thread_stream_timeout");
    expect(result.failure_category).toBe("SDK_NO_EVENT_TIMEOUT");
    expect(result.no_event_timeout).toBe(true);
    expect(result.last_event_type).toBe("turn.started");
    expect(result.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "turn.started" })
      ])
    );
  });

  it("classifies streamed parser or iterator failures after events as event stream issues", async () => {
    const adapter = new SdkRuntimeAdapter({
      enableRealRun: true,
      sdkResolver: async () => ({
        Codex: MockCodexStreamedParserFailure
      })
    });

    const result = await adapter.runThreadStreamed(input());

    expect(result.status).toBe("FAILED");
    expect(result.thread_id).toBe("thread_stream_parser_failure");
    expect(result.failure_category).toBe("SDK_RUNSTREAMED_EVENT_STREAM_ISSUE");
    expect(result.last_event_type).toBe("turn.started");
  });

  it("uses the default model override when none is provided", async () => {
    const seen: Array<{ options?: unknown }> = [];
    const adapter = new SdkRuntimeAdapter({
      enableRealRun: true,
      sdkResolver: async () => ({
        Codex: class extends MockCodex {
          constructor(options?: unknown) {
            super();
            seen.push({ options });
          }
        }
      })
    });

    const result = await adapter.runThread(input());

    expect(result.status).toBe("PASS");
    expect(seen[0]?.options).toMatchObject({
      config: {
        model: DEFAULT_CODEX_MODEL
      }
    });
  });

  it("blocks CODEX_LOOP_CODEX_PROFILE because installed SDK has no profile option", async () => {
    const adapter = new SdkRuntimeAdapter({
      enableRealRun: true,
      sdkResolver: async () => ({
        Codex: MockCodex
      })
    });

    const result = await adapter.runThread(input({ codex_profile: "custom-profile" }));

    expect(result.status).toBe("BLOCKED");
    expect(result.failure_category).toBe("BLOCKED_SDK_PROFILE_UNSUPPORTED");
  });

  it("blocks config override when the SDK capability matrix does not expose config", async () => {
    const capability = {
      ...new SdkRuntimeAdapter().detectSdkCapability(),
      config_supported: false
    };
    const adapter = new SdkRuntimeAdapter({
      enableRealRun: true,
      capabilityDetector: () => capability,
      sdkResolver: async () => ({
        Codex: MockCodex
      })
    });

    const result = await adapter.runThread(input({ codex_model: "gpt-test" }));

    expect(result.status).toBe("BLOCKED");
    expect(result.failure_category).toBe("BLOCKED_SDK_CONFIG_OVERRIDE_UNSUPPORTED");
  });

  it("classifies prompt-only child exits as SDK adapter mismatch when direct CLI parity passed", async () => {
    const message = "Codex Exec exited with code 1: Reading prompt from stdin...";
    expect(classifySdkErrorMessage(message, { directCliParityStatus: "PASS" })).toBe("SDK_ADAPTER_INVOCATION_MISMATCH");

    const adapter = new SdkRuntimeAdapter({
      enableRealRun: true,
      sdkResolver: async () => ({
        Codex: class {
          startThread(): MockThreadPromptOnlyFailure {
            return new MockThreadPromptOnlyFailure(message);
          }
          resumeThread(): MockThreadPromptOnlyFailure {
            return new MockThreadPromptOnlyFailure(message);
          }
        }
      })
    });

    const result = await adapter.runThread(input({ direct_cli_parity_status: "PASS" }));

    expect(result.status).toBe("BLOCKED");
    expect(result.failure_category).toBe("SDK_ADAPTER_INVOCATION_MISMATCH");
  });

  it("classifies prompt-only child exits with outputSchema as output schema thread-start failure", async () => {
    const message = "Codex Exec exited with code 1: Reading prompt from stdin...";
    expect(classifySdkErrorMessage(message, { directCliParityStatus: "PASS", usesOutputSchema: true })).toBe("SDK_OUTPUT_SCHEMA_CAUSES_THREAD_START_FAILURE");

    const adapter = new SdkRuntimeAdapter({
      enableRealRun: true,
      sdkResolver: async () => ({
        Codex: class {
          startThread(): MockThreadPromptOnlyFailure {
            return new MockThreadPromptOnlyFailure(message);
          }
          resumeThread(): MockThreadPromptOnlyFailure {
            return new MockThreadPromptOnlyFailure(message);
          }
        }
      })
    });

    const result = await adapter.runThread(input({ direct_cli_parity_status: "PASS", output_schema: { type: "object" } }));

    expect(result.status).toBe("BLOCKED");
    expect(result.failure_category).toBe("SDK_OUTPUT_SCHEMA_CAUSES_THREAD_START_FAILURE");
  });

  it("normalizes finalResponse and final_response fields", () => {
    expect(extractFinalResponse({ finalResponse: "camel" })).toBe("camel");
    expect(extractFinalResponse({ final_response: "snake" })).toBe("snake");
  });
});

function input(overrides: Partial<RuntimeThreadInput> = {}): RuntimeThreadInput {
  return {
    role: "planner",
    loop_run_id: "loop_sdk",
    task_id: "task_sdk",
    prompt: "plan",
    sandbox: "read-only",
    working_directory: "/tmp/project",
    timeout_ms: 180_000,
    output_schema_path: "",
    invocation_trace_path: resolve(mkdtempSync(resolve(tmpdir(), "sdk-adapter-trace-")), "trace.json"),
    env: {},
    ...overrides
  };
}

class MockCodex {
  startThread(): MockThread {
    return new MockThread("thread_mock");
  }

  resumeThread(): MockThread {
    return new MockThread("thread_mock");
  }
}

class MockCodexStreamedNoCompletion {
  startThread(): MockThreadStreamedNoCompletion {
    return new MockThreadStreamedNoCompletion();
  }

  resumeThread(): MockThreadStreamedNoCompletion {
    return new MockThreadStreamedNoCompletion();
  }
}

class MockCodexStreamedParserFailure {
  startThread(): MockThreadStreamedParserFailure {
    return new MockThreadStreamedParserFailure();
  }

  resumeThread(): MockThreadStreamedParserFailure {
    return new MockThreadStreamedParserFailure();
  }
}

class MockCodexMissingThread {
  startThread(): MockThread {
    return new MockThread(null);
  }

  resumeThread(): MockThread {
    return new MockThread(null);
  }
}

class MockThreadStreamedNoCompletion {
  readonly id = "thread_stream_timeout";

  async run(): Promise<unknown> {
    return { finalResponse: "{\"status\":\"PASS\"}", items: [] };
  }

  async runStreamed(_input?: unknown, options?: { signal?: AbortSignal }): Promise<{ events: AsyncGenerator<unknown> }> {
    async function* events(): AsyncGenerator<unknown> {
      yield { type: "thread.started", thread_id: "thread_stream_timeout" };
      yield { type: "turn.started" };
      await new Promise((_resolve, reject) => {
        options?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      });
    }
    return { events: events() };
  }
}

class MockThreadStreamedParserFailure {
  readonly id = "thread_stream_parser_failure";

  async run(): Promise<unknown> {
    return { finalResponse: "{\"status\":\"PASS\"}", items: [] };
  }

  async runStreamed(): Promise<{ events: AsyncGenerator<unknown> }> {
    async function* events(): AsyncGenerator<unknown> {
      yield { type: "thread.started", thread_id: "thread_stream_parser_failure" };
      yield { type: "turn.started" };
      throw new Error("stream parser failed");
    }
    return { events: events() };
  }
}

class MockThread {
  readonly id: string | null;
  private readonly onRun?: (options?: unknown) => void;

  constructor(id: string | null, onRun?: (options?: unknown) => void) {
    this.id = id;
    this.onRun = onRun;
  }

  async run(_input?: unknown, options?: unknown): Promise<unknown> {
    this.onRun?.(options);
    return {
      finalResponse: "{\"status\":\"PASS\"}",
      items: []
    };
  }

  async runStreamed(_input?: unknown, options?: unknown): Promise<{ events: AsyncGenerator<unknown> }> {
    this.onRun?.(options);
    const id = this.id;
    async function* events(): AsyncGenerator<unknown> {
      if (id) {
        yield { type: "thread.started", thread_id: id };
      }
      yield { type: "item.completed", item: { type: "agent_message", text: "{\"status\":\"PASS\"}" } };
      yield { type: "turn.completed", usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1, reasoning_output_tokens: 0 } };
    }
    return { events: events() };
  }
}

class MockThreadCatalogFailure extends MockThread {
  private readonly message: string;

  constructor(message: string) {
    super("thread_catalog_failure");
    this.message = message;
  }

  override async runStreamed(): Promise<{ events: AsyncGenerator<unknown> }> {
    throw new Error(this.message);
  }

  override async run(): Promise<unknown> {
    throw new Error(this.message);
  }
}

class MockThreadPromptOnlyFailure extends MockThread {
  private readonly message: string;

  constructor(message: string) {
    super("thread_prompt_only_failure");
    this.message = message;
  }

  override async runStreamed(): Promise<{ events: AsyncGenerator<unknown> }> {
    throw new Error(this.message);
  }

  override async run(): Promise<unknown> {
    throw new Error(this.message);
  }
}
