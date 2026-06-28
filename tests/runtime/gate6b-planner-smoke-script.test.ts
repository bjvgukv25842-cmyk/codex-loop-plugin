import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const scriptPath = resolve(process.cwd(), "scripts/sdk-orchestrated/run-gate6b-planner-smoke.ts");
const cliPrintScriptPath = resolve(process.cwd(), "scripts/sdk-orchestrated/print-planner-output-schema-cli-parity.ts");
const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("Gate 6B planner smoke script", () => {
  it("defaults to a safe dry-run", () => {
    const output = runScript({
      CODEX_LOOP_ENABLE_REAL_SDK_PLANNER: undefined,
      CODEX_LOOP_GATE6B_PLANNER_SMOKE_MOCK: undefined
    });

    expect(output.status).toBe("BLOCKED_SDK_PLANNER_NOT_ENABLED");
    expect(output.real_sdk_run_attempted).toBe(false);
  });

  it("can PASS minimal mode through the mock SDK path without a real SDK run", () => {
    const output = runScript({
      CODEX_LOOP_GATE6B_PLANNER_SMOKE_MOCK: "minimal-pass",
      CODEX_LOOP_PLANNER_SMOKE_MODE: "minimal"
    });

    expect(output.status).toBe("PASS");
    expect(output.real_sdk_run_attempted).toBe(false);
    expect(output.planner_thread_started).toBe(true);
    expect(output.final_response_contains_expected).toBe(true);
  });

  it("runs schema-text-only without outputSchema", () => {
    const output = runScript({
      CODEX_LOOP_GATE6B_PLANNER_SMOKE_MOCK: "schema-text-only-pass",
      CODEX_LOOP_PLANNER_SMOKE_MODE: "schema-text-only"
    });

    expect(output.status).toBe("PASS");
    expect(output.mode).toBe("schema-text-only");
    const trace = readTrace(output);
    expect(trace.uses_output_schema).toBe(false);
    expect(trace.output_schema_kind).toBe("none");
  });

  it("runs schema-output-minimal with the minimal outputSchema", () => {
    const output = runScript({
      CODEX_LOOP_GATE6B_PLANNER_SMOKE_MOCK: "schema-output-minimal-pass",
      CODEX_LOOP_PLANNER_SMOKE_MODE: "schema-output-minimal"
    });

    expect(output.status).toBe("PASS");
    const trace = readTrace(output);
    expect(trace.uses_output_schema).toBe(true);
    expect(trace.output_schema_kind).toBe("minimal");
    expect(trace.output_schema_keys).toEqual(["additionalProperties", "properties", "required", "type"]);
  });

  it("runs schema-output-planner with the planner outputSchema", () => {
    const output = runScript({
      CODEX_LOOP_GATE6B_PLANNER_SMOKE_MOCK: "pass",
      CODEX_LOOP_PLANNER_SMOKE_MODE: "schema-output-planner"
    });

    expect(output.status).toBe("PASS");
    const trace = readTrace(output);
    expect(trace.uses_output_schema).toBe(true);
    expect(trace.output_schema_kind).toBe("planner");
  });

  it("runs schema-output-lite with planner-lite outputSchema and postprocess validation", () => {
    const output = runScript({
      CODEX_LOOP_GATE6B_PLANNER_SMOKE_MOCK: "schema-output-lite-pass",
      CODEX_LOOP_PLANNER_SMOKE_MODE: "schema-output-lite"
    });

    expect(output.status).toBe("PASS");
    expect(output.mode).toBe("schema-output-lite");
    expect(output.structured_output_valid).toBe(true);
    expect(output.prd_artifact_created).toBe(true);
    expect(output.task_graph_artifact_created).toBe(true);
    expect(output.artifact_thread_evidence_verified).toBe(true);
    const trace = readTrace(output);
    expect(trace.uses_output_schema).toBe(true);
    expect(trace.output_schema_kind).toBe("lite");
  });

  it("maps schema mode alias to schema-output-planner", () => {
    const output = runScript({
      CODEX_LOOP_GATE6B_PLANNER_SMOKE_MOCK: "pass",
      CODEX_LOOP_PLANNER_SMOKE_MODE: "schema"
    });

    expect(output.status).toBe("PASS");
    expect(output.requested_mode).toBe("schema");
    expect(output.mode).toBe("schema-output-planner");
  });

  it("classifies schema-text-only mock failure as PLANNER_SCHEMA_TEXT_ONLY_FAILED", () => {
    const output = runScript({
      CODEX_LOOP_GATE6B_PLANNER_SMOKE_MOCK: "schema-text-only-fail",
      CODEX_LOOP_PLANNER_SMOKE_MODE: "schema-text-only"
    });

    expect(output.status).toBe("PLANNER_SCHEMA_TEXT_ONLY_FAILED");
    expect(output.failure_category).toBe("PLANNER_SCHEMA_TEXT_ONLY_FAILED");
  });

  it("classifies minimal output schema failure as SDK_OUTPUT_SCHEMA_INVOCATION_FAILED", () => {
    const output = runScript({
      CODEX_LOOP_GATE6B_PLANNER_SMOKE_MOCK: "schema-output-minimal-fail",
      CODEX_LOOP_PLANNER_SMOKE_MODE: "schema-output-minimal"
    });

    expect(output.status).toBe("SDK_OUTPUT_SCHEMA_INVOCATION_FAILED");
    expect(output.failure_category).toBe("SDK_OUTPUT_SCHEMA_INVOCATION_FAILED");
  });

  it("classifies planner schema failure as PLANNER_SCHEMA_TOO_COMPLEX_FOR_OUTPUT_SCHEMA", () => {
    const output = runScript({
      CODEX_LOOP_GATE6B_PLANNER_SMOKE_MOCK: "schema-output-planner-fail",
      CODEX_LOOP_PLANNER_SMOKE_MODE: "schema-output-planner"
    });

    expect(output.status).toBe("PLANNER_SCHEMA_TOO_COMPLEX_FOR_OUTPUT_SCHEMA");
    expect(output.failure_category).toBe("PLANNER_SCHEMA_TOO_COMPLEX_FOR_OUTPUT_SCHEMA");
  });

  it("classifies planner-lite invalid task_graph_json through postprocess", () => {
    const output = runScript({
      CODEX_LOOP_GATE6B_PLANNER_SMOKE_MOCK: "schema-output-lite-invalid-task-json",
      CODEX_LOOP_PLANNER_SMOKE_MODE: "schema-output-lite"
    });

    expect(output.status).toBe("PLANNER_TASK_GRAPH_JSON_INVALID");
    expect(output.failure_category).toBe("PLANNER_TASK_GRAPH_JSON_INVALID");
  });

  it("classifies exact mode mock failure as PLANNER_PROMPT_OR_ARTIFACT_FAILURE", () => {
    const output = runScript({
      CODEX_LOOP_GATE6B_PLANNER_SMOKE_MOCK: "exact-fail",
      CODEX_LOOP_PLANNER_SMOKE_MODE: "exact"
    });

    expect(output.status).toBe("PLANNER_PROMPT_OR_ARTIFACT_FAILURE");
    expect(output.failure_category).toBe("PLANNER_PROMPT_OR_ARTIFACT_FAILURE");
  });

  it("supports parity-as-planner mode through the mock SDK path", () => {
    const output = runScript({
      CODEX_LOOP_GATE6B_PLANNER_SMOKE_MOCK: "parity-as-planner-pass",
      CODEX_LOOP_PLANNER_SMOKE_MODE: "parity-as-planner"
    });

    expect(output.status).toBe("PASS");
    expect(output.mode).toBe("parity-as-planner");
    expect(output.final_response_contains_expected).toBe(true);
  });

  it("classifies parity-as-planner mock failure as PLANNER_ROLE_INVOCATION_MISMATCH", () => {
    const output = runScript({
      CODEX_LOOP_GATE6B_PLANNER_SMOKE_MOCK: "parity-as-planner-fail",
      CODEX_LOOP_PLANNER_SMOKE_MODE: "parity-as-planner"
    });

    expect(output.status).toBe("PLANNER_ROLE_INVOCATION_MISMATCH");
    expect(output.failure_category).toBe("PLANNER_ROLE_INVOCATION_MISMATCH");
  });

  it("classifies timeout without thread.started as SDK_NO_EVENT_TIMEOUT", () => {
    const output = runScript({
      CODEX_LOOP_GATE6B_PLANNER_SMOKE_MOCK: "timeout-no-thread",
      CODEX_LOOP_PLANNER_SMOKE_MODE: "minimal",
      CODEX_LOOP_SDK_NO_EVENT_TIMEOUT_MS: "10"
    });

    expect(output.status).toBe("SDK_NO_EVENT_TIMEOUT");
    expect(output.no_event_timeout).toBe(true);
    expect(output.event_count).toBe(0);
  });

  it("classifies timeout after thread.started as SDK_PLANNER_TURN_TIMEOUT", () => {
    const output = runScript({
      CODEX_LOOP_GATE6B_PLANNER_SMOKE_MOCK: "timeout-with-thread",
      CODEX_LOOP_PLANNER_SMOKE_MODE: "minimal",
      CODEX_LOOP_PLANNER_SMOKE_TIMEOUT_MS: "10",
      CODEX_LOOP_SDK_NO_EVENT_TIMEOUT_MS: "1000"
    });

    expect(output.status).toBe("SDK_PLANNER_TURN_TIMEOUT");
    expect(output.planner_thread_started).toBe(true);
    expect(output.event_count).toBe(1);
  });

  it("classifies no thread.started plus outputSchema as SDK_OUTPUT_SCHEMA_CAUSES_THREAD_START_FAILURE", () => {
    const output = runScript({
      CODEX_LOOP_GATE6B_PLANNER_SMOKE_MOCK: "prompt-only-failure",
      CODEX_LOOP_PLANNER_SMOKE_MODE: "schema-output-minimal"
    });

    expect(output.status).toBe("SDK_OUTPUT_SCHEMA_CAUSES_THREAD_START_FAILURE");
    expect(output.failure_category).toBe("SDK_OUTPUT_SCHEMA_CAUSES_THREAD_START_FAILURE");
    expect(output.planner_thread_started).toBe(false);
  });

  it("classifies full planner outputSchema thread-start failure as too complex", () => {
    const output = runScript({
      CODEX_LOOP_GATE6B_PLANNER_SMOKE_MOCK: "prompt-only-failure",
      CODEX_LOOP_PLANNER_SMOKE_MODE: "schema-output-planner"
    });

    expect(output.status).toBe("PLANNER_SCHEMA_TOO_COMPLEX_FOR_OUTPUT_SCHEMA");
    expect(output.failure_category).toBe("PLANNER_SCHEMA_TOO_COMPLEX_FOR_OUTPUT_SCHEMA");
  });

  it("classifies no thread.started without outputSchema as PLANNER_SCHEMA_TEXT_ONLY_FAILED", () => {
    const output = runScript({
      CODEX_LOOP_GATE6B_PLANNER_SMOKE_MOCK: "prompt-only-failure",
      CODEX_LOOP_PLANNER_SMOKE_MODE: "schema-text-only"
    });

    expect(output.status).toBe("PLANNER_SCHEMA_TEXT_ONLY_FAILED");
    expect(output.failure_category).toBe("PLANNER_SCHEMA_TEXT_ONLY_FAILED");
  });

  it("prints direct CLI output-schema parity commands without executing them", () => {
    const tempDir = mkdtempSync(resolve(tmpdir(), "gate6b-planner-cli-print-test-"));
    tempDirs.push(tempDir);
    const output = execFileSync(process.execPath, [cliPrintScriptPath], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        CODEX_LOOP_SDK_STARTUP_TRIAGE_DIR: tempDir
      },
      stdio: "pipe"
    }).toString("utf8");
    const parsed = JSON.parse(output) as Record<string, unknown>;

    expect(parsed.status).toBe("PRINT_ONLY");
    expect(parsed.executed).toBe(false);
    expect(JSON.stringify(parsed.commands)).toContain("codex exec");
    const commands = JSON.stringify(parsed.commands);
    expect(commands).toContain("--output-schema");
    expect(commands).toContain("output-schema-cli-lite");
    expect(commands).toContain("output-schema-cli-planner");
  });
});

function runScript(overrides: Record<string, string | undefined>): Record<string, unknown> {
  const tempDir = mkdtempSync(resolve(tmpdir(), "gate6b-planner-smoke-test-"));
  tempDirs.push(tempDir);
  const triageDir = resolve(tempDir, "sdk-startup-triage");
  const resultPath = resolve(triageDir, "planner-smoke-result.json");
  mkdirSync(triageDir, { recursive: true });
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    CODEX_LOOP_SDK_STARTUP_TRIAGE_DIR: triageDir,
    CODEX_LOOP_PLANNER_SMOKE_RESULT_PATH: resultPath
  };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete env[key];
    } else {
      env[key] = value;
    }
  }
  try {
    execFileSync(process.execPath, [scriptPath], {
      cwd: process.cwd(),
      env,
      stdio: "pipe"
    });
  } catch {
    // Negative cases can exit non-zero after writing the result artifact.
  }
  return JSON.parse(readFileSync(resultPath, "utf8")) as Record<string, unknown>;
}

function readTrace(output: Record<string, unknown>): Record<string, unknown> {
  const eventsPath = String(output.events_path ?? "");
  const triageDir = resolve(eventsPath, "..");
  return JSON.parse(readFileSync(resolve(triageDir, "planner-schema-invocation-trace-redacted.json"), "utf8")) as Record<string, unknown>;
}
