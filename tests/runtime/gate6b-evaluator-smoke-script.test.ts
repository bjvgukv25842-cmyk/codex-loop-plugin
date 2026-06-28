import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const runScript = resolve(process.cwd(), "scripts/sdk-orchestrated/run-gate6b-evaluator-smoke.ts");
const verifyScript = resolve(process.cwd(), "scripts/sdk-orchestrated/verify-gate6b-evaluator-smoke.ts");
const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("Gate 6B evaluator smoke script", () => {
  it("defaults to dry-run blocked without evaluator SDK env flag", () => {
    const context = createContext();
    const result = runJson(runScript, context.env, context.resultPath);

    expect(result.status).toBe("BLOCKED_SDK_EVALUATOR_NOT_ENABLED");
    expect(result.real_sdk_run_attempted).toBe(false);
  });

  it("passes parity mock mode", () => {
    const context = createContext();
    const result = runJson(runScript, {
      ...context.env,
      CODEX_LOOP_EVALUATOR_SMOKE_MODE: "parity",
      CODEX_LOOP_ENABLE_REAL_SDK_EVALUATOR: "1",
      CODEX_LOOP_GATE6B_EVALUATOR_SMOKE_MOCK: "parity-pass"
    }, context.resultPath);

    expect(result.status).toBe("PASS");
    expect(result.evaluator_thread_started).toBe(true);
    expect(result.final_response_contains_expected).toBe(true);
  });

  it("passes text-only mock mode", () => {
    const context = createContext();
    const result = runJson(runScript, {
      ...context.env,
      CODEX_LOOP_EVALUATOR_SMOKE_MODE: "text-only",
      CODEX_LOOP_ENABLE_REAL_SDK_EVALUATOR: "1",
      CODEX_LOOP_GATE6B_EVALUATOR_SMOKE_MOCK: "text-only-pass"
    }, context.resultPath);

    expect(result.status).toBe("PASS");
    expect(result.eval_verdict).toBe("PASS");
  });

  it("passes output-minimal mock mode", () => {
    const context = createContext();
    const result = runJson(runScript, {
      ...context.env,
      CODEX_LOOP_EVALUATOR_SMOKE_MODE: "output-minimal",
      CODEX_LOOP_ENABLE_REAL_SDK_EVALUATOR: "1",
      CODEX_LOOP_GATE6B_EVALUATOR_SMOKE_MOCK: "output-minimal-pass"
    }, context.resultPath);

    expect(result.status).toBe("PASS");
    expect(result.structured_output_valid).toBe(true);
  });

  it("passes output-lite mock mode through shared evaluator stage", () => {
    const context = createContext();
    const result = runJson(runScript, {
      ...context.env,
      CODEX_LOOP_EVALUATOR_SMOKE_MODE: "output-lite",
      CODEX_LOOP_ENABLE_REAL_SDK_EVALUATOR: "1",
      CODEX_LOOP_GATE6B_EVALUATOR_SMOKE_MOCK: "output-lite-pass"
    }, context.resultPath);

    expect(result.status).toBe("PASS");
    expect(result.evaluator_stage_shared).toBe(true);
    expect(result.eval_report_created).toBe(true);
    expect(result.eval_verdict).toBe("PASS");
  });

  it("verify reports readiness only after all evaluator slices pass", () => {
    const context = createContext();
    for (const [mode, mock] of [
      ["parity", "parity-pass"],
      ["text-only", "text-only-pass"],
      ["output-minimal", "output-minimal-pass"],
      ["output-lite", "output-lite-pass"]
    ] as const) {
      runJson(runScript, {
        ...context.env,
        CODEX_LOOP_EVALUATOR_SMOKE_MODE: mode,
        CODEX_LOOP_ENABLE_REAL_SDK_EVALUATOR: "1",
        CODEX_LOOP_GATE6B_EVALUATOR_SMOKE_MOCK: mock
      }, context.resultPath);
    }

    const verify = runJson(verifyScript, context.env, context.verifyPath);
    expect(verify.status).toBe("PASS");
    expect(verify.ready_for_checkpoint_evaluator_retry).toBe(true);
  });
});

function createContext(): { tempDir: string; reportDir: string; resultPath: string; verifyPath: string; env: NodeJS.ProcessEnv } {
  const tempDir = mkdtempSync(resolve(tmpdir(), "gate6b-evaluator-smoke-test-"));
  tempDirs.push(tempDir);
  const reportDir = resolve(tempDir, "reports");
  const targetRepo = resolve(tempDir, "target");
  mkdirSync(reportDir, { recursive: true });
  writeTarget(targetRepo);
  return {
    tempDir,
    reportDir,
    resultPath: resolve(reportDir, "evaluator-smoke-result.json"),
    verifyPath: resolve(reportDir, "evaluator-smoke-verify.json"),
    env: {
      ...process.env,
      CODEX_LOOP_SDK_STARTUP_TRIAGE_DIR: reportDir,
      CODEX_LOOP_GATE6B_SMOKE_TARGET_REPO: targetRepo,
      CODEX_LOOP_EVALUATOR_SMOKE_RESULT_PATH: resolve(reportDir, "evaluator-smoke-result.json")
    }
  };
}

function runJson(script: string, env: NodeJS.ProcessEnv, artifactPath: string): Record<string, unknown> {
  try {
    execFileSync(process.execPath, [script], { cwd: process.cwd(), env, stdio: "pipe" });
  } catch {
    // Negative cases still write their result artifact.
  }
  return JSON.parse(readFileSync(artifactPath, "utf8")) as Record<string, unknown>;
}

function writeTarget(targetRepo: string): void {
  mkdirSync(resolve(targetRepo, "docs"), { recursive: true });
  mkdirSync(resolve(targetRepo, "artifacts"), { recursive: true });
  mkdirSync(resolve(targetRepo, "src"), { recursive: true });
  mkdirSync(resolve(targetRepo, "test"), { recursive: true });
  writeFileSync(resolve(targetRepo, "docs/PRD.md"), "# PRD\n", "utf8");
  writeFileSync(resolve(targetRepo, "docs/TASK_GRAPH.json"), "{}\n", "utf8");
  writeFileSync(resolve(targetRepo, "artifacts/dev-result.json"), "{}\n", "utf8");
  writeFileSync(resolve(targetRepo, "src/project-name.js"), "export function validateProjectName(name) { return { ok: Boolean(name) }; }\n", "utf8");
  writeFileSync(resolve(targetRepo, "test/project-name.test.js"), "\n", "utf8");
}
