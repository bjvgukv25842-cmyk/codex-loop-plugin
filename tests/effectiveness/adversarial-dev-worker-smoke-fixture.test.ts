import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  collectSmokeFileChangeProof,
  prepareAdversarialSafetyMinimalTarget,
  runSmokeNpmTest
} from "../../src/effectiveness/adversarial-dev-worker-smoke-fixture.ts";
import { reconstructAdversarialDevWorkerSmokeReadiness } from "../../src/effectiveness/adversarial-dev-worker-smoke-readiness.ts";
import { runAdversarialDevWorkerSmoke } from "../../scripts/effectiveness/run-adversarial-dev-worker-smoke.ts";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("adversarial safety-minimal smoke fixture", () => {
  it("creates a clean isolated broken target with baseline git evidence", () => {
    const repoRoot = tempRoot("adversarial-safety-minimal-fixture-");

    const target = prepareAdversarialSafetyMinimalTarget({ repoRoot, runId: "fixture-proof" });
    const preRunTest = runSmokeNpmTest(target.target_repo);
    const proof = collectSmokeFileChangeProof({
      targetRepo: target.target_repo,
      baselineCommitHash: target.baseline_commit_hash
    });

    expect(target.target_repo).toContain("/dev-worker-smoke/safety-minimal/fixture-proof/target");
    expect(target.target_repo_is_git).toBe(true);
    expect(target.baseline_commit_hash).not.toBe("");
    expect(target.worktree_clean_before_run).toBe(true);
    expect(target.fixture_reset_verified).toBe(true);
    expect(preRunTest.executed).toBe(true);
    expect(preRunTest.status).toBe("FAIL");
    expect(proof.git_diff_files).toEqual([]);
    expect(proof.file_change_verified).toBe(false);
  });

  it("passes safety-minimal only with pre-fail, post-pass, and git diff proof", async () => {
    const repoRoot = tempRoot("adversarial-safety-minimal-pass-");
    await passParity(repoRoot);

    const result = await runAdversarialDevWorkerSmoke({
      repoRoot,
      env: {
        ...env(repoRoot),
        CODEX_LOOP_ADVERSARIAL_DEV_WORKER_SMOKE_MOCK: "pass",
        CODEX_LOOP_ADVERSARIAL_DEV_WORKER_SMOKE_MODE: "safety-minimal"
      }
    });

    expect(result.status).toBe("PASS");
    expect(result.working_directory).toContain("/dev-worker-smoke/safety-minimal/");
    expect(result.working_directory).toContain("/target");
    expect(result.working_directory_matches).toBe(true);
    expect(result.fixture_reset_verified).toBe(true);
    expect(result.pre_run_test_failed).toBe(true);
    expect(result.post_run_test_passed).toBe(true);
    expect(result.git_diff_files).toEqual(["src/title.js"]);
    expect(result.dev_result_changed_files).toEqual(["src/title.js"]);
    expect(result.file_change_verified).toBe(true);
    expect(reconstructAdversarialDevWorkerSmokeReadiness(repoRoot).ready_for_exact).toBe(true);
  });

  it("fails safety-minimal when npm test passes but no file changed", async () => {
    const repoRoot = tempRoot("adversarial-safety-minimal-no-change-");
    await passParity(repoRoot);

    const result = await runAdversarialDevWorkerSmoke({
      repoRoot,
      env: {
        ...env(repoRoot),
        CODEX_LOOP_ADVERSARIAL_DEV_WORKER_SMOKE_MOCK: "no-change-pass",
        CODEX_LOOP_ADVERSARIAL_DEV_WORKER_SMOKE_MODE: "safety-minimal"
      }
    });

    expect(result.status).toBe("FAIL");
    expect(result.post_run_test_passed).toBe(false);
    expect(result.git_diff_files).toEqual([]);
    expect(result.file_change_verified).toBe(false);
    expect(result.failure_category).toBe("ADVERSARIAL_DEV_SAFETY_MINIMAL_FAILED");
    expect(reconstructAdversarialDevWorkerSmokeReadiness(repoRoot).ready_for_exact).toBe(false);
  });

  it("uses git diff evidence when DevResult changed_files is stale", async () => {
    const repoRoot = tempRoot("adversarial-safety-minimal-stale-dev-result-");
    await passParity(repoRoot);

    const result = await runAdversarialDevWorkerSmoke({
      repoRoot,
      env: {
        ...env(repoRoot),
        CODEX_LOOP_ADVERSARIAL_DEV_WORKER_SMOKE_MOCK: "stale-dev-result",
        CODEX_LOOP_ADVERSARIAL_DEV_WORKER_SMOKE_MODE: "safety-minimal"
      }
    });

    expect(result.status).toBe("PASS");
    expect(result.git_diff_files).toEqual(["src/title.js"]);
    expect(result.dev_result_changed_files).toEqual([]);
    expect(result.changed_files).toEqual(["src/title.js"]);
    expect(result.file_change_verified).toBe(true);
  });
});

async function passParity(repoRoot: string): Promise<void> {
  const result = await runAdversarialDevWorkerSmoke({
    repoRoot,
    env: { ...env(repoRoot), CODEX_LOOP_ADVERSARIAL_DEV_WORKER_SMOKE_MOCK: "pass" }
  });
  expect(result.status).toBe("PASS");
}

function tempRoot(prefix: string): string {
  const root = mkdtempSync(resolve(tmpdir(), prefix));
  tempDirs.push(root);
  cpSync(
    resolve(process.cwd(), "evals/effectiveness/fixtures/adversarial-prompt-injection-001"),
    resolve(root, "evals/effectiveness/fixtures/adversarial-prompt-injection-001"),
    { recursive: true }
  );
  mkdirSync(resolve(root, ".codex-eval/sqlite"), { recursive: true });
  mkdirSync(resolve(root, "evals/sdk-orchestrated"), { recursive: true });
  writeFileSync(resolve(root, "evals/sdk-orchestrated/model-catalog-bundled.json"), "{}\n", "utf8");
  return root;
}

function env(repoRoot: string): NodeJS.ProcessEnv {
  return {
    CODEX_SQLITE_HOME: resolve(repoRoot, ".codex-eval/sqlite"),
    CODEX_LOOP_CODEX_MODEL: "gpt-test",
    CODEX_LOOP_MODEL_CATALOG_JSON: resolve(repoRoot, "evals/sdk-orchestrated/model-catalog-bundled.json")
  };
}
