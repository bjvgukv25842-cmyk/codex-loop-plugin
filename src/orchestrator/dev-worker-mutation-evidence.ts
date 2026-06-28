import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export type DevWorkerFixtureStatus = "BROKEN_AS_EXPECTED" | "BLOCKED_TARGET_FIXTURE_NOT_BROKEN";

export interface DevWorkerBaseline {
  target_repo: string;
  target_source_file: string;
  target_source_hash_before: string;
  target_test_files: string[];
  src_project_name_hash_before: string;
  package_json_hash_before: string;
  test_project_name_hash_before: string;
  test_project_name_baseline_hash_before: string;
  test_project_name_full_hash_before: string;
  initial_tests_run: boolean;
  initial_tests_expected_to_fail: true;
  initial_tests_failed: boolean;
  initial_baseline_tests_run: boolean;
  initial_baseline_tests_failed: boolean;
  initial_full_tests_run: boolean;
  initial_full_tests_failed: boolean;
  seeded_gap_fixture_created: boolean;
  fixture_status: DevWorkerFixtureStatus;
}

export interface DevWorkerMutationEvidence {
  baseline_exists: boolean;
  baseline_path: string;
  baseline_fixture_status: DevWorkerFixtureStatus | "";
  target_source_file: string;
  target_source_hash_before: string;
  target_source_hash_after: string;
  initial_tests_failed: boolean;
  src_project_name_hash_before: string;
  src_project_name_hash_after: string;
  file_change_verified_by_hash: boolean;
  file_change_verified_by_git: boolean;
  file_change_verified_by_event: boolean;
  file_change_verified: boolean;
  src_project_name_exists: boolean;
  package_json_exists: boolean;
  test_project_name_test_exists: boolean;
  test_project_name_baseline_test_exists: boolean;
  test_project_name_full_test_exists: boolean;
  git_changed_files: string[];
  errors: string[];
}

export function readDevWorkerBaseline(path: string): DevWorkerBaseline | null {
  if (!existsSync(path)) {
    return null;
  }
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (!isRecord(value)) {
      return null;
    }
    return {
      target_repo: typeof value.target_repo === "string" ? value.target_repo : "",
      target_source_file: typeof value.target_source_file === "string" ? value.target_source_file : "src/project-name.js",
      target_source_hash_before: typeof value.target_source_hash_before === "string" ? value.target_source_hash_before : "",
      target_test_files: Array.isArray(value.target_test_files) && value.target_test_files.every((entry) => typeof entry === "string")
        ? value.target_test_files
        : ["test/project-name.test.js"],
      src_project_name_hash_before: typeof value.src_project_name_hash_before === "string" ? value.src_project_name_hash_before : "",
      package_json_hash_before: typeof value.package_json_hash_before === "string" ? value.package_json_hash_before : "",
      test_project_name_hash_before: typeof value.test_project_name_hash_before === "string" ? value.test_project_name_hash_before : "",
      test_project_name_baseline_hash_before: typeof value.test_project_name_baseline_hash_before === "string" ? value.test_project_name_baseline_hash_before : "",
      test_project_name_full_hash_before: typeof value.test_project_name_full_hash_before === "string" ? value.test_project_name_full_hash_before : "",
      initial_tests_run: value.initial_tests_run === true,
      initial_tests_expected_to_fail: true,
      initial_tests_failed: value.initial_tests_failed === true,
      initial_baseline_tests_run: value.initial_baseline_tests_run === true,
      initial_baseline_tests_failed: value.initial_baseline_tests_failed === true,
      initial_full_tests_run: value.initial_full_tests_run === true,
      initial_full_tests_failed: value.initial_full_tests_failed === true,
      seeded_gap_fixture_created: value.seeded_gap_fixture_created === true,
      fixture_status: value.fixture_status === "BROKEN_AS_EXPECTED" ? "BROKEN_AS_EXPECTED" : "BLOCKED_TARGET_FIXTURE_NOT_BROKEN"
    };
  } catch {
    return null;
  }
}

export function verifyDevWorkerMutationEvidence(input: {
  target_repo: string;
  baseline_path: string;
  events_path?: string;
  target_source_file?: string;
  target_test_files?: string[];
}): DevWorkerMutationEvidence {
  const baseline = readDevWorkerBaseline(input.baseline_path);
  const targetSourceFile = input.target_source_file ?? baseline?.target_source_file ?? "src/project-name.js";
  const targetTestFiles = input.target_test_files ?? baseline?.target_test_files ?? ["test/project-name.test.js"];
  const srcPath = resolve(input.target_repo, targetSourceFile);
  const packagePath = resolve(input.target_repo, "package.json");
  const testPath = resolve(input.target_repo, targetTestFiles[0] ?? "test/project-name.test.js");
  const baselineTestPath = resolve(input.target_repo, "test/project-name.baseline.test.js");
  const fullTestPath = resolve(input.target_repo, "test/project-name.full.test.js");
  const srcHashAfter = hashFile(srcPath);
  const gitChangedFiles = gitDiffNameOnly(input.target_repo);
  const eventFileChange = eventMentionsFileChange(input.events_path, targetSourceFile);
  const errors: string[] = [];
  const legacyTestExists = targetTestFiles.every((file) => existsSync(resolve(input.target_repo, file))) || existsSync(testPath);
  const splitTestsExist = existsSync(baselineTestPath) && existsSync(fullTestPath);

  if (!baseline) {
    errors.push("Dev worker baseline is missing or invalid.");
  }
  if (!legacyTestExists && !splitTestsExist) {
    errors.push(`${targetTestFiles.join(", ")} test files were deleted or are missing.`);
  }
  if (!existsSync(packagePath)) {
    errors.push("package.json was deleted or is missing.");
  }
  if (!existsSync(srcPath)) {
    errors.push(`${targetSourceFile} was deleted or is missing.`);
  }

  const hashBefore = baseline?.target_source_hash_before || baseline?.src_project_name_hash_before || "";
  const fileChangeByHash = Boolean(hashBefore) && Boolean(srcHashAfter) && hashBefore !== srcHashAfter;
  const fileChangeByGit = gitChangedFiles.includes(targetSourceFile);
  const fileChangeVerified = fileChangeByHash || fileChangeByGit || eventFileChange;

  return {
    baseline_exists: Boolean(baseline),
    baseline_path: input.baseline_path,
    baseline_fixture_status: baseline?.fixture_status ?? "",
    target_source_file: targetSourceFile,
    target_source_hash_before: hashBefore,
    target_source_hash_after: srcHashAfter,
    initial_tests_failed: baseline?.initial_tests_failed === true,
    src_project_name_hash_before: hashBefore,
    src_project_name_hash_after: srcHashAfter,
    file_change_verified_by_hash: fileChangeByHash,
    file_change_verified_by_git: fileChangeByGit,
    file_change_verified_by_event: eventFileChange,
    file_change_verified: fileChangeVerified,
    src_project_name_exists: existsSync(srcPath),
    package_json_exists: existsSync(packagePath),
    test_project_name_test_exists: legacyTestExists || splitTestsExist,
    test_project_name_baseline_test_exists: existsSync(baselineTestPath),
    test_project_name_full_test_exists: existsSync(fullTestPath),
    git_changed_files: gitChangedFiles,
    errors
  };
}

export function hashFile(path: string): string {
  if (!existsSync(path)) {
    return "";
  }
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function gitDiffNameOnly(targetRepo: string): string[] {
  try {
    return execFileSync("git", ["-C", targetRepo, "diff", "--name-only"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    })
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function eventMentionsFileChange(path: string | undefined, targetSourceFile = "src/project-name.js"): boolean {
  if (!path || !existsSync(path)) {
    return false;
  }
  const text = readFileSync(path, "utf8");
  return text.includes(targetSourceFile) && /(file[_-]?change|patch|edit|write|diff|modified)/i.test(text);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
