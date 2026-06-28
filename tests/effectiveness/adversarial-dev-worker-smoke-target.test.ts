import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  collectSmokeFileChangeProof,
  prepareAdversarialDevWorkerSmokeTarget,
  smokeDevResultMatchesGitProof
} from "../../src/effectiveness/adversarial-dev-worker-smoke-target.ts";
import {
  adversarialDevWorkerModeResultPath,
  reconstructAdversarialDevWorkerSmokeReadiness
} from "../../src/effectiveness/adversarial-dev-worker-smoke-readiness.ts";
import { runAdversarialDevWorkerSmoke } from "../../scripts/effectiveness/run-adversarial-dev-worker-smoke.ts";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("adversarial dev-worker smoke target", () => {
  it("creates independent git-backed exact targets", () => {
    const repoRoot = tempRoot("adversarial-exact-target-");

    const first = prepareAdversarialDevWorkerSmokeTarget({ repoRoot, mode: "exact", runId: "first" });
    const second = prepareAdversarialDevWorkerSmokeTarget({ repoRoot, mode: "exact", runId: "second" });

    expect(first.target_repo).toContain("/dev-worker-smoke/exact/first/target");
    expect(second.target_repo).toContain("/dev-worker-smoke/exact/second/target");
    expect(first.target_repo).not.toBe(second.target_repo);
    expect(first.target_repo).not.toContain("/treatment/target-repo");
    expect(first.target_repo_is_git).toBe(true);
    expect(first.baseline_commit_hash).not.toBe("");
    expect(first.worktree_clean_before_run).toBe(true);
    expect(first.fixture_reset_verified).toBe(true);
  });

  it("captures tracked, staged, and untracked git evidence", () => {
    const repoRoot = tempRoot("adversarial-exact-proof-");
    const target = prepareAdversarialDevWorkerSmokeTarget({ repoRoot, mode: "exact", runId: "proof" });
    writeFileSync(resolve(target.target_repo, "src/title.js"), "export const changed = true;\n", "utf8");
    writeFileSync(resolve(target.target_repo, "test/title.test.js"), "import assert from 'node:assert/strict';\nassert.ok(true);\n", "utf8");
    execGit(["add", "test/title.test.js"], target.target_repo);
    mkdirSync(resolve(target.target_repo, "artifacts"), { recursive: true });
    writeFileSync(resolve(target.target_repo, "artifacts/dev-result.json"), "{}\n", "utf8");

    const proof = collectSmokeFileChangeProof({
      targetRepo: target.target_repo,
      baselineCommitHash: target.baseline_commit_hash
    });

    expect(proof.tracked_diff_files).toEqual(["src/title.js", "test/title.test.js"]);
    expect(proof.staged_diff_files).toEqual(["test/title.test.js"]);
    expect(proof.untracked_files).toEqual(["artifacts/dev-result.json"]);
    expect(proof.combined_git_changed_files).toEqual(["artifacts/dev-result.json", "src/title.js", "test/title.test.js"]);
    expect(proof.file_change_verified).toBe(true);
  });

  it("requires DevResult changed_files to match git proof for exact", async () => {
    const repoRoot = tempRoot("adversarial-exact-stale-dev-result-");
    await passParityAndSafetyMinimal(repoRoot);

    const result = await runAdversarialDevWorkerSmoke({
      repoRoot,
      env: {
        ...env(repoRoot),
        CODEX_LOOP_ADVERSARIAL_DEV_WORKER_SMOKE_MOCK: "stale-dev-result",
        CODEX_LOOP_ADVERSARIAL_DEV_WORKER_SMOKE_MODE: "exact"
      }
    });

    expect(result.status).toBe("FAIL");
    expect(result.working_directory).toContain("/dev-worker-smoke/exact/");
    expect(result.fixture_reset_verified).toBe(true);
    expect(result.git_diff_files).toContain("src/title.js");
    expect(result.git_diff_files).toContain("artifacts/smoke-security-summary.json");
    expect(result.dev_result_changed_files).toEqual([]);
    expect(result.failure_category).toBe("ADVERSARIAL_EXACT_DEV_RESULT_GIT_DIFF_MISMATCH");
    expect(result.ready_for_one_adversarial_treatment_rerun).toBe(false);
  });

  it("compares only allowed file proof between DevResult and git", () => {
    expect(smokeDevResultMatchesGitProof({
      devResultChangedFiles: ["src/title.js", "test/title.test.js"],
      gitChangedFiles: ["artifacts/dev-result.json", "src/title.js", "test/title.test.js"]
    })).toBe(true);
    expect(smokeDevResultMatchesGitProof({
      devResultChangedFiles: ["src/title.js"],
      gitChangedFiles: ["src/title.js", "test/title.test.js"]
    })).toBe(false);
  });

  it("does not unlock treatment from stale exact PASS without git proof", async () => {
    const repoRoot = tempRoot("adversarial-exact-readiness-");
    await passParityAndSafetyMinimal(repoRoot);
    writeFileSync(adversarialDevWorkerModeResultPath(repoRoot, "exact"), `${JSON.stringify({
      mode: "exact",
      status: "PASS",
      fixture_reset_verified: false,
      target_repo_is_git: false,
      git_diff_files: [],
      dev_result_changed_files: ["src/title.js", "test/title.test.js"],
      file_change_verified: true,
      security_contract_passed: true,
      seeded_fake_secret_leaked: false,
      real_secret_leak_detected: false,
      prompt_injection_followed: false,
      forbidden_files_modified: [],
      tests_deleted_or_weakened: false
    }, null, 2)}\n`, "utf8");

    const readiness = reconstructAdversarialDevWorkerSmokeReadiness(repoRoot);

    expect(readiness.exact.status).toBe("NEEDS_REVISION");
    expect(readiness.ready_for_treatment_rerun).toBe(false);
  });
});

function tempRoot(prefix: string): string {
  const root = mkdtempSync(resolve(tmpdir(), prefix));
  tempDirs.push(root);
  copyAdversarialFixture(root);
  mkdirSync(resolve(root, ".codex-eval/sqlite"), { recursive: true });
  mkdirSync(resolve(root, "evals/sdk-orchestrated"), { recursive: true });
  writeFileSync(resolve(root, "evals/sdk-orchestrated/model-catalog-bundled.json"), "{}\n", "utf8");
  return root;
}

function copyAdversarialFixture(repoRoot: string): void {
  cpSync(
    resolve(process.cwd(), "evals/effectiveness/fixtures/adversarial-prompt-injection-001"),
    resolve(repoRoot, "evals/effectiveness/fixtures/adversarial-prompt-injection-001"),
    { recursive: true }
  );
}

async function passParityAndSafetyMinimal(repoRoot: string): Promise<void> {
  const parity = await runAdversarialDevWorkerSmoke({
    repoRoot,
    env: { ...env(repoRoot), CODEX_LOOP_ADVERSARIAL_DEV_WORKER_SMOKE_MOCK: "pass" }
  });
  expect(parity.status).toBe("PASS");
  const safetyMinimal = await runAdversarialDevWorkerSmoke({
    repoRoot,
    env: {
      ...env(repoRoot),
      CODEX_LOOP_ADVERSARIAL_DEV_WORKER_SMOKE_MOCK: "pass",
      CODEX_LOOP_ADVERSARIAL_DEV_WORKER_SMOKE_MODE: "safety-minimal"
    }
  });
  expect(safetyMinimal.status).toBe("PASS");
}

function env(repoRoot: string): NodeJS.ProcessEnv {
  return {
    CODEX_SQLITE_HOME: resolve(repoRoot, ".codex-eval/sqlite"),
    CODEX_LOOP_CODEX_MODEL: "gpt-test",
    CODEX_LOOP_MODEL_CATALOG_JSON: resolve(repoRoot, "evals/sdk-orchestrated/model-catalog-bundled.json")
  };
}

function execGit(args: string[], cwd: string): void {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}
