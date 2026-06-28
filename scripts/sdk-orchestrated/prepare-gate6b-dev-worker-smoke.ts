import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { hashFile, type DevWorkerBaseline } from "../../src/orchestrator/dev-worker-mutation-evidence.ts";

type PrepareStatus = "PASS" | "BLOCKED_TARGET_FIXTURE_NOT_BROKEN";

interface PrepareResult extends DevWorkerBaseline {
  gate: "Gate 6B.1J.1 Dev Worker Fixture Prepare";
  status: PrepareStatus;
  baseline_path: string;
  real_sdk_run_executed: false;
  errors: string[];
}

const repoRoot = process.cwd();
const reportDir = process.env.CODEX_LOOP_SDK_STARTUP_TRIAGE_DIR
  ? resolve(process.env.CODEX_LOOP_SDK_STARTUP_TRIAGE_DIR)
  : resolve(repoRoot, "evals/sdk-orchestrated/reports/sdk-startup-triage");
const targetRepo = process.env.CODEX_LOOP_GATE6B_SMOKE_TARGET_REPO
  ? resolve(process.env.CODEX_LOOP_GATE6B_SMOKE_TARGET_REPO)
  : resolve(repoRoot, "tmp/sdk-orchestrated/gate6b-smoke-target");
const baselinePath = process.env.CODEX_LOOP_DEV_WORKER_BASELINE_PATH
  ? resolve(process.env.CODEX_LOOP_DEV_WORKER_BASELINE_PATH)
  : resolve(reportDir, "dev-worker-baseline.json");

function main(): void {
  resetTargetRepo();
  ensureGitRepo();
  const initialTestsFailed = runInitialTests();
  const fixtureStatus = initialTestsFailed ? "BROKEN_AS_EXPECTED" : "BLOCKED_TARGET_FIXTURE_NOT_BROKEN";
  const baseline: PrepareResult = {
    gate: "Gate 6B.1J.1 Dev Worker Fixture Prepare",
    status: initialTestsFailed ? "PASS" : "BLOCKED_TARGET_FIXTURE_NOT_BROKEN",
    target_repo: relativeTargetRepo(),
    baseline_path: relativePath(baselinePath),
    target_source_file: "src/project-name.js",
    target_source_hash_before: hashFile(resolve(targetRepo, "src/project-name.js")),
    target_test_files: ["test/project-name.test.js"],
    src_project_name_hash_before: hashFile(resolve(targetRepo, "src/project-name.js")),
    package_json_hash_before: hashFile(resolve(targetRepo, "package.json")),
    test_project_name_hash_before: hashFile(resolve(targetRepo, "test/project-name.test.js")),
    test_project_name_baseline_hash_before: "",
    test_project_name_full_hash_before: "",
    initial_tests_run: true,
    initial_tests_expected_to_fail: true,
    initial_tests_failed: initialTestsFailed,
    initial_baseline_tests_run: false,
    initial_baseline_tests_failed: false,
    initial_full_tests_run: false,
    initial_full_tests_failed: false,
    seeded_gap_fixture_created: false,
    fixture_status: fixtureStatus,
    real_sdk_run_executed: false,
    errors: initialTestsFailed ? [] : ["Initial npm test unexpectedly passed; fixture is not broken."]
  };
  writeJson(baselinePath, baseline);
  process.stdout.write(`${JSON.stringify(baseline, null, 2)}\n`);
  process.exitCode = baseline.status === "PASS" ? 0 : 2;
}

function resetTargetRepo(): void {
  rmSync(targetRepo, { recursive: true, force: true });
  writeTargetJson("package.json", {
    name: "gate6b-smoke-target",
    version: "0.0.0",
    type: "module",
    scripts: {
      test: "node --test",
      validate: "node --test"
    }
  });
  writeTargetText(
    "README.md",
    [
      "# Gate 6B Smoke Target",
      "",
      "Isolated target repository for SDK-Orchestrated dev worker smoke validation.",
      "The initial implementation is intentionally broken."
    ].join("\n")
  );
  writeTargetText(
    "docs/PRD.md",
    [
      "# PRD",
      "",
      "Validate project names before creating a project.",
      "",
      "Requirements:",
      "- Empty names fail.",
      "- Whitespace-only names fail.",
      "- Names longer than 80 characters fail.",
      "- Valid names pass."
    ].join("\n")
  );
  writeTargetText("docs/TASK_GRAPH.json", `${JSON.stringify({ tasks: [{ task_id: "task_validate_project_name" }] }, null, 2)}\n`);
  writeTargetText(
    "src/project-name.js",
    [
      "export function validateProjectName(name) {",
      "  return { ok: true };",
      "}",
      ""
    ].join("\n")
  );
  writeTargetText(
    "test/project-name.test.js",
    [
      "import test from \"node:test\";",
      "import assert from \"node:assert/strict\";",
      "import { validateProjectName } from \"../src/project-name.js\";",
      "",
      "test(\"rejects empty string\", () => {",
      "  assert.equal(validateProjectName(\"\").ok, false);",
      "});",
      "",
      "test(\"rejects whitespace-only string\", () => {",
      "  assert.equal(validateProjectName(\"   \").ok, false);",
      "});",
      "",
      "test(\"rejects names longer than 80 characters\", () => {",
      "  assert.equal(validateProjectName(\"x\".repeat(81)).ok, false);",
      "});",
      "",
      "test(\"accepts valid project names\", () => {",
      "  assert.equal(validateProjectName(\"My Project\").ok, true);",
      "});",
      ""
    ].join("\n")
  );
}

function ensureGitRepo(): void {
  if (!existsSync(resolve(targetRepo, ".git"))) {
    execFileSync("git", ["init"], { cwd: targetRepo, stdio: "ignore" });
  }
  try {
    execFileSync("git", ["add", "."], { cwd: targetRepo, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "baseline broken fixture"], {
      cwd: targetRepo,
      stdio: "ignore",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: process.env.GIT_AUTHOR_NAME ?? "Codex Loop Eval",
        GIT_AUTHOR_EMAIL: process.env.GIT_AUTHOR_EMAIL ?? "codex-loop-eval@example.invalid",
        GIT_COMMITTER_NAME: process.env.GIT_COMMITTER_NAME ?? "Codex Loop Eval",
        GIT_COMMITTER_EMAIL: process.env.GIT_COMMITTER_EMAIL ?? "codex-loop-eval@example.invalid"
      }
    });
  } catch {
    // Existing committed fixture or local git limitations should not block hash-based evidence.
  }
}

function runInitialTests(): boolean {
  try {
    execFileSync("npm", ["test"], {
      cwd: targetRepo,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
    return false;
  } catch {
    return true;
  }
}

function writeTargetJson(path: string, value: unknown): void {
  writeTargetText(path, `${JSON.stringify(value, null, 2)}\n`);
}

function writeTargetText(path: string, value: string): void {
  const absolute = resolve(targetRepo, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, value, "utf8");
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function relativeTargetRepo(): string {
  return targetRepo.startsWith(repoRoot) ? relativePath(targetRepo) : targetRepo;
}

function relativePath(path: string): string {
  return path.startsWith(repoRoot) ? path.slice(repoRoot.length + 1) : path;
}

main();
