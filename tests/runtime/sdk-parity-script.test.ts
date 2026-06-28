import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const parityScriptPath = resolve(process.cwd(), "scripts/sdk-orchestrated/run-sdk-parity-smoke.ts");
const smokeScriptPath = resolve(process.cwd(), "scripts/sdk-orchestrated/run-gate6b-smoke.ts");
const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("SDK parity smoke script", () => {
  it("defaults to a safe dry-run", () => {
    const { result } = runParityScript({
      CODEX_LOOP_ENABLE_REAL_SDK_PARITY: undefined,
      CODEX_LOOP_GATE6B_SDK_PARITY_MOCK: undefined
    });

    expect(result.status).toBe("BLOCKED_SDK_PARITY_NOT_ENABLED");
    expect(result.real_sdk_run_attempted).toBe(false);
  });

  it("can pass through the mock SDK path without starting a real SDK run", () => {
    const { result } = runParityScript({
      CODEX_LOOP_ENABLE_REAL_SDK_PARITY: "1",
      CODEX_LOOP_GATE6B_SDK_PARITY_MOCK: "pass"
    });

    expect(result.status).toBe("PASS");
    expect(result.real_sdk_run_attempted).toBe(false);
    expect(result.sdk_thread_started).toBe(true);
    expect(result.final_response_contains_expected).toBe(true);
  });

  it("classifies prompt-only SDK failure as an invocation mismatch when direct CLI parity passed", () => {
    const { result } = runParityScript({
      CODEX_LOOP_ENABLE_REAL_SDK_PARITY: "1",
      CODEX_LOOP_GATE6B_SDK_PARITY_MOCK: "prompt-only-fail"
    });

    expect(result.status).toBe("SDK_ADAPTER_INVOCATION_MISMATCH");
    expect(result.failure_category).toBe("SDK_ADAPTER_INVOCATION_MISMATCH");
    expect(result.direct_cli_parity_status).toBe("PASS");
  });

  it("blocks the legacy three-thread smoke real path until SDK parity passes", () => {
    const tempDir = mkdtempSync(resolve(tmpdir(), "gate6b-smoke-parity-gate-"));
    tempDirs.push(tempDir);
    const resultPath = resolve(tempDir, "smoke-result.json");
    const parityResultPath = resolve(tempDir, "sdk-parity-smoke-result.json");
    const env = {
      ...process.env,
      CODEX_LOOP_ENABLE_LEGACY_GATE6B_SMOKE: "1",
      CODEX_LOOP_ENABLE_REAL_SDK_RUN: "1",
      CODEX_LOOP_GATE6B_SMOKE_RESULT_PATH: resultPath,
      CODEX_LOOP_SDK_PARITY_RESULT_PATH: parityResultPath
    };

    try {
      execFileSync(process.execPath, [smokeScriptPath], {
        cwd: process.cwd(),
        env,
        stdio: "pipe"
      });
    } catch {
      // The script is allowed to exit non-zero only for FAIL; blocked statuses write a result and exit 0.
    }

    const result = JSON.parse(readFileSync(resultPath, "utf8")) as Record<string, unknown>;
    expect(result.status).toBe("BLOCKED_SDK_PARITY_NOT_PASSED");
    expect(result.real_sdk_run_executed).toBe(false);
  });
});

function runParityScript(overrides: Record<string, string | undefined>): { result: Record<string, unknown>; dir: string } {
  const tempDir = mkdtempSync(resolve(tmpdir(), "sdk-parity-smoke-test-"));
  tempDirs.push(tempDir);
  const reportDir = resolve(tempDir, "evals/sdk-orchestrated/reports/sdk-startup-triage");
  const resultPath = resolve(reportDir, "sdk-parity-smoke-result.json");
  mkdirSync(reportDir, { recursive: true });
  writeFileSync(resolve(reportDir, "target-cli-smoke-events.jsonl"), "{\"type\":\"thread.started\",\"thread_id\":\"thread_cli\"}\n{\"type\":\"item.completed\",\"item\":{\"type\":\"agent_message\",\"text\":\"SDK_TARGET_DIRECT_CLI_OK\"}}\n{\"type\":\"turn.completed\"}\n", {
    encoding: "utf8",
    flag: "w"
  });
  const env = { ...process.env };
  env.CODEX_LOOP_SDK_STARTUP_TRIAGE_DIR = reportDir;
  env.CODEX_LOOP_MODEL_CATALOG_JSON = "package.json";
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete env[key];
    } else {
      env[key] = value;
    }
  }
  try {
    execFileSync(process.execPath, [parityScriptPath], {
      cwd: process.cwd(),
      env: {
        ...env,
        CODEX_LOOP_SDK_PARITY_RESULT_PATH: resultPath,
        CODEX_LOOP_DIRECT_CLI_PARITY_EVENTS_PATH: resolve(reportDir, "target-cli-smoke-events.jsonl")
      },
      stdio: "pipe"
    });
  } catch {
    // Negative cases can exit non-zero after writing the result artifact.
  }
  return {
    result: JSON.parse(readFileSync(resultPath, "utf8")) as Record<string, unknown>,
    dir: dirname(resultPath)
  };
}
