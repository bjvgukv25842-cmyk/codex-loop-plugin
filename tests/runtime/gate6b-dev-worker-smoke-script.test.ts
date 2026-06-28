import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const scriptPath = resolve(process.cwd(), "scripts/sdk-orchestrated/run-gate6b-dev-worker-smoke.ts");
const prepareScriptPath = resolve(process.cwd(), "scripts/sdk-orchestrated/prepare-gate6b-dev-worker-smoke.ts");
const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("Gate 6B dev worker smoke script", () => {
  it("defaults to a safe dry-run", () => {
    const output = runScript({
      CODEX_LOOP_ENABLE_REAL_SDK_DEV_WORKER: undefined,
      CODEX_LOOP_GATE6B_DEV_WORKER_SMOKE_MOCK: undefined
    });

    expect(output.status).toBe("BLOCKED_SDK_DEV_WORKER_NOT_ENABLED");
    expect(output.real_sdk_run_attempted).toBe(false);
  });

  it("can PASS parity mode through mock SDK without a real SDK run", () => {
    const output = runScript({
      CODEX_LOOP_GATE6B_DEV_WORKER_SMOKE_MOCK: "parity-pass",
      CODEX_LOOP_DEV_WORKER_SMOKE_MODE: "parity"
    });

    expect(output.status).toBe("PASS");
    expect(output.real_sdk_run_attempted).toBe(false);
    expect(output.dev_worker_thread_started).toBe(true);
    expect(output.final_response_contains_expected).toBe(true);
  });

  it("can PASS minimal-fix mode through mock SDK with a file change and test evidence", () => {
    const output = runScript({
      CODEX_LOOP_GATE6B_DEV_WORKER_SMOKE_MOCK: "minimal-fix-pass",
      CODEX_LOOP_DEV_WORKER_SMOKE_MODE: "minimal-fix"
    });

    expect(output.status).toBe("PASS");
    expect(output.file_change_verified).toBe(true);
    expect(output.file_change_verified_by_hash).toBe(true);
    expect(output.tests_passed).toBe(true);
    expect(output.initial_tests_failed).toBe(true);
    expect(output.tests_run).toEqual(expect.arrayContaining(["npm test"]));
  });

  it("can PASS output-lite mode through shared runDevWorkerStage", () => {
    const output = runScript({
      CODEX_LOOP_GATE6B_DEV_WORKER_SMOKE_MOCK: "output-lite-pass",
      CODEX_LOOP_DEV_WORKER_SMOKE_MODE: "output-lite"
    });

    expect(output.status).toBe("PASS");
    expect(output.dev_worker_stage_shared).toBe(true);
    expect(output.dev_worker_stage_impl).toBe("runDevWorkerStage");
    expect(output.structured_output_valid).toBe(true);
    expect(output.file_change_verified).toBe(true);
    expect(output.file_change_verified_by_hash).toBe(true);
    expect(output.tests_passed).toBe(true);
  });

  it("blocks minimal-fix before SDK startup when baseline is missing", () => {
    const output = runScript(
      {
        CODEX_LOOP_GATE6B_DEV_WORKER_SMOKE_MOCK: "minimal-fix-pass",
        CODEX_LOOP_DEV_WORKER_SMOKE_MODE: "minimal-fix"
      },
      { skipPrepare: true }
    );

    expect(output.status).toBe("BLOCKED_DEV_WORKER_BASELINE_MISSING");
    expect(output.real_sdk_run_attempted).toBe(false);
    expect(output.dev_worker_thread_started).toBe(false);
  });
});

function runScript(overrides: Record<string, string | undefined>, options: { skipPrepare?: boolean } = {}): Record<string, unknown> {
  const tempDir = mkdtempSync(resolve(tmpdir(), "gate6b-dev-worker-smoke-test-"));
  tempDirs.push(tempDir);
  const triageDir = resolve(tempDir, "sdk-startup-triage");
  const resultPath = resolve(triageDir, "dev-worker-smoke-result.json");
  const targetRepo = resolve(tempDir, "target-repo");
  mkdirSync(triageDir, { recursive: true });
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    CODEX_LOOP_SDK_STARTUP_TRIAGE_DIR: triageDir,
    CODEX_LOOP_DEV_WORKER_SMOKE_RESULT_PATH: resultPath,
    CODEX_LOOP_GATE6B_SMOKE_TARGET_REPO: targetRepo
  };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete env[key];
    } else {
      env[key] = value;
    }
  }
  if (!options.skipPrepare) {
    execFileSync(process.execPath, [prepareScriptPath], {
      cwd: process.cwd(),
      env,
      stdio: "pipe"
    });
  } else {
    mkdirSync(resolve(targetRepo, "docs"), { recursive: true });
    writeFileSync(resolve(targetRepo, "docs/PRD.md"), "# PRD\n\nValidate project names.\n", "utf8");
    writeFileSync(resolve(targetRepo, "docs/TASK_GRAPH.json"), "{}\n", "utf8");
  }
  try {
    execFileSync(process.execPath, [scriptPath], {
      cwd: process.cwd(),
      env,
      stdio: "pipe"
    });
  } catch {
    // Negative smoke cases intentionally exit after writing the result artifact.
  }
  return JSON.parse(readFileSync(resultPath, "utf8")) as Record<string, unknown>;
}
