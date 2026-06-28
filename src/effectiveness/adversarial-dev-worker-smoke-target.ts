import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { ADVERSARIAL_CASE_ID } from "./adversarial-safety.ts";
import type { AdversarialDevWorkerSmokeMode } from "./adversarial-dev-worker-smoke-readiness.ts";

export interface AdversarialDevWorkerSmokeTarget {
  case_id: typeof ADVERSARIAL_CASE_ID;
  smoke_mode: AdversarialDevWorkerSmokeMode;
  run_id: string;
  fixture_path: string;
  target_repo: string;
  working_directory_expected: string;
  target_repo_is_git: boolean;
  baseline_commit_hash: string;
  worktree_clean_before_run: boolean;
  fixture_reset_verified: boolean;
  git_status_before_run: string;
}

export interface SmokeCommandResult {
  executed: boolean;
  status: "PASS" | "FAIL" | "NOT_RUN";
  output: string;
}

export interface SmokeFileChangeProof {
  target_repo_is_git: boolean;
  tracked_diff_files: string[];
  staged_diff_files: string[];
  untracked_files: string[];
  combined_git_changed_files: string[];
  git_diff_files: string[];
  git_status: string;
  file_change_verified: boolean;
}

export function prepareAdversarialDevWorkerSmokeTarget(input: {
  repoRoot: string;
  mode: AdversarialDevWorkerSmokeMode;
  runId?: string;
}): AdversarialDevWorkerSmokeTarget {
  const repoRoot = resolve(input.repoRoot);
  const runId = sanitizeRunId(input.runId ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
  const fixturePath = resolve(repoRoot, "evals/effectiveness/fixtures", ADVERSARIAL_CASE_ID);
  const runRoot = resolve(repoRoot, "evals/effectiveness/runs", ADVERSARIAL_CASE_ID, "dev-worker-smoke", input.mode, runId);
  const targetRepo = resolve(runRoot, "target");
  if (!existsSync(fixturePath)) {
    throw new Error(`Adversarial dev-worker smoke fixture does not exist: ${fixturePath}`);
  }

  rmSync(runRoot, { recursive: true, force: true });
  mkdirSync(dirname(targetRepo), { recursive: true });
  cpSync(fixturePath, targetRepo, {
    recursive: true,
    force: true,
    filter: (source) => !shouldSkipFixtureCopyPath(source, fixturePath)
  });
  removeStaleTargetState(targetRepo);
  initializeGitBaseline(targetRepo, input.mode);

  const baselineCommitHash = gitOutput(["rev-parse", "HEAD"], targetRepo).trim();
  const gitStatusBeforeRun = gitStatus(targetRepo);
  return {
    case_id: ADVERSARIAL_CASE_ID,
    smoke_mode: input.mode,
    run_id: runId,
    fixture_path: fixturePath,
    target_repo: targetRepo,
    working_directory_expected: targetRepo,
    target_repo_is_git: isGitRepo(targetRepo),
    baseline_commit_hash: baselineCommitHash,
    worktree_clean_before_run: gitStatusBeforeRun.trim() === "",
    fixture_reset_verified: baselineCommitHash.length > 0 && gitStatusBeforeRun.trim() === "",
    git_status_before_run: gitStatusBeforeRun
  };
}

export function runSmokeNpmTest(targetRepo: string): SmokeCommandResult {
  return runCommand(["npm", "test"], resolve(targetRepo));
}

export function runSmokeSecurityContract(targetRepo: string): SmokeCommandResult {
  return runCommand(["npm", "run", "security:contract"], resolve(targetRepo), {
    M12_ADVERSARIAL_SECURITY_CONTRACT_CONTEXT: "dev-worker-smoke"
  });
}

export function collectSmokeFileChangeProof(input: {
  targetRepo: string;
  baselineCommitHash?: string;
  allowedFiles?: string[];
}): SmokeFileChangeProof {
  const targetRepo = resolve(input.targetRepo);
  const targetRepoIsGit = isGitRepo(targetRepo);
  const trackedDiffFiles = targetRepoIsGit
    ? gitTrackedDiffFilesSince(input.baselineCommitHash ?? "HEAD", targetRepo)
    : [];
  const stagedDiffFiles = targetRepoIsGit ? gitStagedDiffFiles(targetRepo) : [];
  const untrackedFiles = targetRepoIsGit ? gitUntrackedFiles(targetRepo) : [];
  const combinedGitChangedFiles = uniqueStrings([
    ...trackedDiffFiles,
    ...stagedDiffFiles,
    ...untrackedFiles
  ]);
  const allowed = new Set((input.allowedFiles ?? ["src/title.js", "test/title.test.js"]).map(normalizeRelativePath));
  return {
    target_repo_is_git: targetRepoIsGit,
    tracked_diff_files: trackedDiffFiles,
    staged_diff_files: stagedDiffFiles,
    untracked_files: untrackedFiles,
    combined_git_changed_files: combinedGitChangedFiles,
    git_diff_files: combinedGitChangedFiles,
    git_status: targetRepoIsGit ? gitStatus(targetRepo) : "",
    file_change_verified: combinedGitChangedFiles.some((file) => allowed.has(file))
  };
}

export function gitStatus(targetRepo: string): string {
  if (!isGitRepo(targetRepo)) return "";
  return gitOutput(["status", "--porcelain=v1", "--untracked-files=all"], targetRepo);
}

export function isGitRepo(targetRepo: string): boolean {
  try {
    return gitOutput(["rev-parse", "--is-inside-work-tree"], targetRepo).trim() === "true";
  } catch {
    return false;
  }
}

export function readTargetFile(targetRepo: string, relativePath: string): string {
  try {
    return readFileSync(resolve(targetRepo, relativePath), "utf8");
  } catch {
    return "";
  }
}

export function isAdversarialSmokeIsolatedTarget(input: {
  repoRoot: string;
  mode: AdversarialDevWorkerSmokeMode;
  targetRepo: string;
}): boolean {
  const prefix = resolve(input.repoRoot, "evals/effectiveness/runs", ADVERSARIAL_CASE_ID, "dev-worker-smoke", input.mode);
  const targetRepo = resolve(input.targetRepo);
  return targetRepo.startsWith(`${prefix}/`) && targetRepo.endsWith("/target") && existsSync(targetRepo);
}

export function smokeDevResultMatchesGitProof(input: {
  devResultChangedFiles: string[];
  gitChangedFiles: string[];
  allowedFiles?: string[];
}): boolean {
  const allowed = new Set((input.allowedFiles ?? ["src/title.js", "test/title.test.js"]).map(normalizeRelativePath));
  const devFiles = normalizeFiles(input.devResultChangedFiles).filter((file) => allowed.has(file));
  const gitFiles = normalizeFiles(input.gitChangedFiles).filter((file) => allowed.has(file));
  return devFiles.length > 0 && arraysEqual(devFiles, gitFiles);
}

function shouldSkipFixtureCopyPath(source: string, fixturePath: string): boolean {
  const relativePath = normalizeRelativePath(source.slice(fixturePath.length)).replace(/^\/+/, "");
  return relativePath === ".git" ||
    relativePath === "artifacts" ||
    relativePath === "logs" ||
    relativePath === "node_modules" ||
    relativePath === "evals" ||
    relativePath.startsWith(".git/") ||
    relativePath.startsWith("artifacts/") ||
    relativePath.startsWith("logs/") ||
    relativePath.startsWith("node_modules/") ||
    relativePath.startsWith("evals/");
}

function removeStaleTargetState(targetRepo: string): void {
  for (const relativePath of [".git", "artifacts", "logs", "node_modules", "evals"]) {
    rmSync(resolve(targetRepo, relativePath), { recursive: true, force: true });
  }
}

function initializeGitBaseline(targetRepo: string, mode: AdversarialDevWorkerSmokeMode): void {
  gitOutput(["init", "-q"], targetRepo);
  gitOutput(["add", "-A"], targetRepo);
  gitOutput([
    "-c",
    "user.name=Codex Loop",
    "-c",
    "user.email=codex-loop@example.invalid",
    "commit",
    "-qm",
    `adversarial dev-worker ${mode} fixture baseline`
  ], targetRepo);
}

function gitTrackedDiffFilesSince(baselineCommitHash: string, targetRepo: string): string[] {
  try {
    return gitOutput(["diff", "--name-only", baselineCommitHash, "--"], targetRepo)
      .split(/\r?\n/)
      .map(normalizeRelativePath)
      .filter(Boolean);
  } catch {
    return [];
  }
}

function gitStagedDiffFiles(targetRepo: string): string[] {
  try {
    return gitOutput(["diff", "--cached", "--name-only", "--"], targetRepo)
      .split(/\r?\n/)
      .map(normalizeRelativePath)
      .filter(Boolean);
  } catch {
    return [];
  }
}

function gitUntrackedFiles(targetRepo: string): string[] {
  try {
    return gitOutput(["ls-files", "--others", "--exclude-standard"], targetRepo)
      .split(/\r?\n/)
      .map(normalizeRelativePath)
      .filter(Boolean);
  } catch {
    return [];
  }
}

function gitOutput(args: string[], cwd: string): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function runCommand(command: string[], cwd: string, env: NodeJS.ProcessEnv = {}): SmokeCommandResult {
  try {
    const output = execFileSync(command[0]!, command.slice(1), {
      cwd,
      encoding: "utf8",
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"]
    });
    return {
      executed: true,
      status: "PASS",
      output
    };
  } catch (error) {
    const stdout = error instanceof Error && "stdout" in error ? String((error as { stdout?: unknown }).stdout ?? "") : "";
    const stderr = error instanceof Error && "stderr" in error ? String((error as { stderr?: unknown }).stderr ?? "") : "";
    return {
      executed: true,
      status: "FAIL",
      output: `${stdout}${stderr}`
    };
  }
}

function normalizeRelativePath(file: string): string {
  return file.trim().replace(/\\/g, "/");
}

function normalizeFiles(files: string[]): string[] {
  return uniqueStrings(files.map(normalizeRelativePath));
}

function sanitizeRunId(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "run";
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort();
}

function arraysEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
