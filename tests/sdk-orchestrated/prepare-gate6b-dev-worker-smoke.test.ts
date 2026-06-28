import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const prepareScriptPath = resolve(process.cwd(), "scripts/sdk-orchestrated/prepare-gate6b-dev-worker-smoke.ts");
const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("prepare-gate6b-dev-worker-smoke", () => {
  it("resets the target repo to a known broken fixture and records baseline hashes", () => {
    const output = runPrepare();

    expect(output.status).toBe("PASS");
    expect(output.fixture_status).toBe("BROKEN_AS_EXPECTED");
    expect(output.initial_tests_run).toBe(true);
    expect(output.initial_tests_failed).toBe(true);
    expect(String(output.src_project_name_hash_before)).toHaveLength(64);
    expect(String(output.package_json_hash_before)).toHaveLength(64);
    expect(String(output.test_project_name_hash_before)).toHaveLength(64);
  });

  it("writes the intentionally broken validateProjectName implementation", () => {
    const { output, targetRepo } = runPrepareWithTarget();
    const source = readFileSync(resolve(targetRepo, "src/project-name.js"), "utf8");

    expect(output.status).toBe("PASS");
    expect(source).toContain("return { ok: true };");
  });
});

function runPrepare(): Record<string, unknown> {
  return runPrepareWithTarget().output;
}

function runPrepareWithTarget(): { output: Record<string, unknown>; targetRepo: string } {
  const tempDir = mkdtempSync(resolve(tmpdir(), "gate6b-dev-worker-prepare-test-"));
  tempDirs.push(tempDir);
  const targetRepo = resolve(tempDir, "target-repo");
  const reportDir = resolve(tempDir, "reports");
  const stdout = execFileSync(process.execPath, [prepareScriptPath], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      CODEX_LOOP_GATE6B_SMOKE_TARGET_REPO: targetRepo,
      CODEX_LOOP_SDK_STARTUP_TRIAGE_DIR: reportDir
    },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  return {
    output: JSON.parse(stdout) as Record<string, unknown>,
    targetRepo
  };
}
