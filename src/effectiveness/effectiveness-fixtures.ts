import { execFileSync } from "node:child_process";
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import type { M12Case, M12Variant } from "../../scripts/effectiveness/types.ts";
import { hashFile } from "../orchestrator/dev-worker-mutation-evidence.ts";
import { getGenericFeatureCaseProfile, genericFeatureCaseSupported } from "./generic-feature-case-profile.ts";
import { getGenericBugfixCaseProfile, genericBugfixCaseSupported } from "./generic-bugfix-case-profile.ts";
import { getGenericTestCoverageCaseProfile, genericTestCoverageCaseSupported, type GenericTestCoverageCaseProfile } from "./generic-test-coverage-case-profile.ts";
import { ADVERSARIAL_CASE_ID } from "./adversarial-safety.ts";

export interface M12CasePaths {
  case_id: string;
  variant: M12Variant;
  run_dir: string;
  target_repo: string;
  reports_dir: string;
  result_path: string;
  events_path: string;
  stdout_path: string;
  stderr_path: string;
  diff_path: string;
  validation_log_path: string;
  archived_logs_dir?: string;
}

export interface M12ModeCheckpointStatus {
  result_exists: boolean;
  result_status: string;
  checkpoint_exists: boolean;
  checkpoint_stage: string;
  partial_exists: boolean;
  failed: boolean;
}

export interface PrepareM12FixtureOptions {
  testCase: M12Case;
  variant: M12Variant;
  repoRoot?: string;
  resume?: boolean;
  now?: () => Date;
}

export function m12CasePaths(testCase: M12Case, variant: M12Variant, repoRoot = process.cwd()): M12CasePaths {
  const runDir = resolve(repoRoot, `evals/effectiveness/runs/${testCase.case_id}/${variant}`);
  const reportsDir = resolve(repoRoot, `evals/effectiveness/reports/${testCase.case_id}`);
  return {
    case_id: testCase.case_id,
    variant,
    run_dir: runDir,
    target_repo: resolve(runDir, "target-repo"),
    reports_dir: reportsDir,
    result_path: resolve(reportsDir, `${variant}-result.json`),
    events_path: resolve(reportsDir, `${variant}-events.jsonl`),
    stdout_path: resolve(reportsDir, `${variant}-stdout.log`),
    stderr_path: resolve(reportsDir, `${variant}-stderr.log`),
    diff_path: resolve(reportsDir, `${variant}-diff.patch`),
    validation_log_path: resolve(reportsDir, `${variant}-validation.log`)
  };
}

export function prepareM12RepairLoopFixture(options: PrepareM12FixtureOptions): M12CasePaths {
  if (options.testCase.case_id !== "repair-loop-001") {
    throw new Error(`M12.1A real canary fixture only supports repair-loop-001, got ${options.testCase.case_id}`);
  }
  const paths = m12CasePaths(options.testCase, options.variant, options.repoRoot);
  mkdirSync(paths.reports_dir, { recursive: true });
  const archivedLogsDir = options.resume ? undefined : archivePreviousCaseOutputs(paths, options.now ?? (() => new Date()));
  if (!options.resume) {
    rmSync(paths.target_repo, { recursive: true, force: true });
  }
  writeRepairLoopTarget(paths.target_repo);
  return {
    ...paths,
    archived_logs_dir: archivedLogsDir
  };
}

export function prepareM12FeatureFixture(options: PrepareM12FixtureOptions): M12CasePaths {
  const profile = getGenericFeatureCaseProfile(options.testCase);
  if (!profile) {
    throw new Error(`M12 generic feature fixture does not support ${options.testCase.case_id}`);
  }
  const paths = m12CasePaths(options.testCase, options.variant, options.repoRoot);
  mkdirSync(paths.reports_dir, { recursive: true });
  const archivedLogsDir = options.resume ? undefined : archivePreviousCaseOutputs(paths, options.now ?? (() => new Date()));
  if (!options.resume) {
    rmSync(paths.target_repo, { recursive: true, force: true });
    const sourceFixture = resolve(options.repoRoot ?? process.cwd(), options.testCase.fixture_repo);
    cpSync(sourceFixture, paths.target_repo, { recursive: true });
  }
  ensureGitRepo(paths.target_repo);
  const initialFullTestsFailed = commandFails(["npm", "test"], paths.target_repo);
  const initialBaselineTestsFailed = options.testCase.case_id === "feature-small-001" ? false : initialFullTestsFailed;
  writeDevWorkerBaseline(paths, {
    target_source_file: profile.target_source_file,
    target_test_files: profile.target_test_files,
    seeded_gap_fixture_created: false,
    initial_baseline_tests_failed: initialBaselineTestsFailed,
    initial_full_tests_failed: initialFullTestsFailed
  });
  if (!initialFullTestsFailed) {
    throw new Error("BLOCKED_FEATURE_FIXTURE_ALREADY_COMPLETE");
  }
  return {
    ...paths,
    archived_logs_dir: archivedLogsDir
  };
}

export function prepareM12BugfixFixture(options: PrepareM12FixtureOptions): M12CasePaths {
  const profile = getGenericBugfixCaseProfile(options.testCase);
  if (!profile) {
    throw new Error(`M12 generic bugfix fixture does not support ${options.testCase.case_id}`);
  }
  const paths = m12CasePaths(options.testCase, options.variant, options.repoRoot);
  mkdirSync(paths.reports_dir, { recursive: true });
  const archivedLogsDir = options.resume ? undefined : archivePreviousCaseOutputs(paths, options.now ?? (() => new Date()));
  if (!options.resume) {
    rmSync(paths.target_repo, { recursive: true, force: true });
    const sourceFixture = resolve(options.repoRoot ?? process.cwd(), options.testCase.fixture_repo);
    cpSync(sourceFixture, paths.target_repo, { recursive: true });
  }
  ensureGitRepo(paths.target_repo);
  const initialTestsFailed = commandFails(["npm", "test"], paths.target_repo);
  writeBugfixBaseline(paths, {
    target_source_file: profile.target_source_file,
    target_test_files: profile.target_test_files,
    initial_tests_failed: initialTestsFailed
  });
  if (!initialTestsFailed) {
    throw new Error("BLOCKED_BUGFIX_FIXTURE_ALREADY_COMPLETE");
  }
  return {
    ...paths,
    archived_logs_dir: archivedLogsDir
  };
}

export function prepareM12TestCoverageFixture(options: PrepareM12FixtureOptions): M12CasePaths {
  const profile = getGenericTestCoverageCaseProfile(options.testCase);
  if (!profile) {
    throw new Error(`M12 generic test coverage fixture does not support ${options.testCase.case_id}`);
  }
  const paths = m12CasePaths(options.testCase, options.variant, options.repoRoot);
  mkdirSync(paths.reports_dir, { recursive: true });
  const archivedLogsDir = options.resume ? undefined : archivePreviousCaseOutputs(paths, options.now ?? (() => new Date()));
  if (!options.resume) {
    rmSync(paths.target_repo, { recursive: true, force: true });
    const sourceFixture = resolve(options.repoRoot ?? process.cwd(), options.testCase.fixture_repo);
    cpSync(sourceFixture, paths.target_repo, { recursive: true });
  }
  ensureGitRepo(paths.target_repo);
  const initialTestsFailed = commandFails(["npm", "test"], paths.target_repo);
  const initialCoverageContractFailed = commandFails(["npm", "run", "coverage:contract"], paths.target_repo);
  writeTestCoverageBaseline(paths, profile, {
    initial_tests_failed: initialTestsFailed,
    initial_coverage_contract_failed: initialCoverageContractFailed
  });
  if (initialTestsFailed) {
    throw new Error("BLOCKED_TEST_COVERAGE_FIXTURE_TESTS_FAIL");
  }
  if (!initialCoverageContractFailed) {
    throw new Error("BLOCKED_TEST_COVERAGE_FIXTURE_ALREADY_COMPLETE");
  }
  return {
    ...paths,
    archived_logs_dir: archivedLogsDir
  };
}

export function prepareM12DocsUpdateFixture(options: PrepareM12FixtureOptions): M12CasePaths {
  if (options.testCase.case_id !== "docs-update-001") {
    throw new Error(`M12.5A docs update fixture only supports docs-update-001, got ${options.testCase.case_id}`);
  }
  const paths = m12CasePaths(options.testCase, options.variant, options.repoRoot);
  mkdirSync(paths.reports_dir, { recursive: true });
  const archivedLogsDir = options.resume ? undefined : archivePreviousCaseOutputs(paths, options.now ?? (() => new Date()));
  if (!options.resume) {
    rmSync(paths.target_repo, { recursive: true, force: true });
    const sourceFixture = resolve(options.repoRoot ?? process.cwd(), options.testCase.fixture_repo);
    cpSync(sourceFixture, paths.target_repo, { recursive: true });
  }
  ensureGitRepo(paths.target_repo);
  const initialTestsFailed = commandFails(["npm", "test"], paths.target_repo);
  const initialDocsContractFailed = commandFails(["npm", "run", "docs:contract"], paths.target_repo);
  writeDocsUpdateBaseline(paths, {
    initial_tests_failed: initialTestsFailed,
    initial_docs_contract_failed: initialDocsContractFailed
  });
  if (initialTestsFailed) {
    throw new Error("BLOCKED_DOCS_FIXTURE_TESTS_FAIL");
  }
  if (!initialDocsContractFailed) {
    throw new Error("BLOCKED_DOCS_FIXTURE_ALREADY_COMPLETE");
  }
  return {
    ...paths,
    archived_logs_dir: archivedLogsDir
  };
}

export function prepareM12RefactorFixture(options: PrepareM12FixtureOptions): M12CasePaths {
  if (options.testCase.case_id !== "refactor-small-001") {
    throw new Error(`M12.6A refactor fixture only supports refactor-small-001, got ${options.testCase.case_id}`);
  }
  const paths = m12CasePaths(options.testCase, options.variant, options.repoRoot);
  mkdirSync(paths.reports_dir, { recursive: true });
  const archivedLogsDir = options.resume ? undefined : archivePreviousCaseOutputs(paths, options.now ?? (() => new Date()));
  if (!options.resume) {
    rmSync(paths.target_repo, { recursive: true, force: true });
    const sourceFixture = resolve(options.repoRoot ?? process.cwd(), options.testCase.fixture_repo);
    cpSync(sourceFixture, paths.target_repo, { recursive: true });
  }
  ensureGitRepo(paths.target_repo);
  const initialTestsFailed = commandFails(["npm", "test"], paths.target_repo);
  const initialRefactorContractFailed = commandFails(["npm", "run", "refactor:contract"], paths.target_repo);
  const initialStructureLintFailed = commandFails(["npm", "run", "lint:structure"], paths.target_repo);
  writeRefactorBaseline(paths, {
    initial_tests_failed: initialTestsFailed,
    initial_refactor_contract_failed: initialRefactorContractFailed,
    initial_structure_lint_failed: initialStructureLintFailed
  });
  if (initialTestsFailed || initialRefactorContractFailed) {
    throw new Error("BLOCKED_REFACTOR_FIXTURE_BEHAVIOR_BROKEN");
  }
  if (!initialStructureLintFailed) {
    throw new Error("BLOCKED_REFACTOR_FIXTURE_ALREADY_COMPLETE");
  }
  return {
    ...paths,
    archived_logs_dir: archivedLogsDir
  };
}

export function prepareM12AdversarialFixture(options: PrepareM12FixtureOptions): M12CasePaths {
  if (options.testCase.case_id !== ADVERSARIAL_CASE_ID) {
    throw new Error(`M12 adversarial fixture only supports ${ADVERSARIAL_CASE_ID}, got ${options.testCase.case_id}`);
  }
  const paths = m12CasePaths(options.testCase, options.variant, options.repoRoot);
  mkdirSync(paths.reports_dir, { recursive: true });
  const archivedLogsDir = options.resume ? undefined : archivePreviousCaseOutputs(paths, options.now ?? (() => new Date()));
  if (!options.resume) {
    rmSync(paths.target_repo, { recursive: true, force: true });
    const sourceFixture = resolve(options.repoRoot ?? process.cwd(), options.testCase.fixture_repo);
    cpSync(sourceFixture, paths.target_repo, { recursive: true });
  }
  ensureGitRepo(paths.target_repo);
  const initialTestsFailed = commandFails(["npm", "test"], paths.target_repo);
  const seededFakeSecretExists = existsSync(resolve(paths.target_repo, "secrets/seeded-fake-secret.txt"));
  const untrustedInstructionsExist = existsSync(resolve(paths.target_repo, "UNTRUSTED_INSTRUCTIONS.md"));
  writeAdversarialBaseline(paths, {
    initial_tests_failed: initialTestsFailed,
    seeded_fake_secret_exists: seededFakeSecretExists,
    untrusted_instructions_exist: untrustedInstructionsExist
  });
  if (!seededFakeSecretExists) {
    throw new Error("BLOCKED_ADVERSARIAL_SEEDED_FAKE_SECRET_MISSING");
  }
  if (!untrustedInstructionsExist) {
    throw new Error("BLOCKED_ADVERSARIAL_UNTRUSTED_INSTRUCTIONS_MISSING");
  }
  if (!initialTestsFailed) {
    throw new Error("BLOCKED_ADVERSARIAL_FIXTURE_ALREADY_COMPLETE");
  }
  return {
    ...paths,
    archived_logs_dir: archivedLogsDir
  };
}

export function prepareM12CaseFixture(options: PrepareM12FixtureOptions): M12CasePaths {
  if (options.testCase.case_id === "repair-loop-001") {
    return prepareM12RepairLoopFixture(options);
  }
  if (genericFeatureCaseSupported(options.testCase)) {
    return prepareM12FeatureFixture(options);
  }
  if (genericBugfixCaseSupported(options.testCase)) {
    return prepareM12BugfixFixture(options);
  }
  if (genericTestCoverageCaseSupported(options.testCase)) {
    return prepareM12TestCoverageFixture(options);
  }
  if (options.testCase.case_id === "docs-update-001") {
    return prepareM12DocsUpdateFixture(options);
  }
  if (options.testCase.case_id === "refactor-small-001") {
    return prepareM12RefactorFixture(options);
  }
  if (options.testCase.case_id === ADVERSARIAL_CASE_ID) {
    return prepareM12AdversarialFixture(options);
  }
  throw new Error(`M12 real canary fixture is not implemented for ${options.testCase.case_id}`);
}

export function clearM12ModeOutputs(testCase: M12Case, variant: M12Variant, repoRoot = process.cwd()): M12CasePaths {
  const paths = m12CasePaths(testCase, variant, repoRoot);
  rmSync(paths.run_dir, { recursive: true, force: true });
  const files = [
    paths.result_path,
    paths.events_path,
    paths.stdout_path,
    paths.stderr_path,
    paths.diff_path,
    paths.validation_log_path,
    resolve(paths.reports_dir, `${variant}-invocation-trace-redacted.json`),
    resolve(paths.reports_dir, `${variant}-codex-exec-timeout-triage.json`),
    resolve(paths.reports_dir, `${capitalizeVariant(variant)}CodexExecTimeoutTriageReport.md`)
  ];
  if (variant === "treatment") {
    files.push(resolve(paths.reports_dir, `${variant}-gate6b2-state.json`));
  }
  for (const file of files) {
    rmSync(file, { force: true });
  }
  if (variant === "treatment") {
    rmSync(resolve(paths.reports_dir, "sdk-stage-logs"), { recursive: true, force: true });
  }
  return paths;
}

export function inspectM12ModeCheckpoint(testCase: M12Case, variant: M12Variant, repoRoot = process.cwd()): M12ModeCheckpointStatus {
  const paths = m12CasePaths(testCase, variant, repoRoot);
  const result = readJsonRecord(paths.result_path);
  const checkpoint = readJsonRecord(resolve(paths.reports_dir, `${variant}-gate6b2-state.json`));
  const partialExists = [
    paths.events_path,
    paths.stdout_path,
    paths.stderr_path,
    paths.diff_path,
    paths.validation_log_path,
    resolve(paths.reports_dir, `${variant}-invocation-trace-redacted.json`)
  ].some((path) => existsSync(path));
  const resultStatus = typeof result?.status === "string" ? result.status : "";
  const checkpointStage = typeof checkpoint?.current_stage === "string" ? checkpoint.current_stage : "";
  const failed = resultStatus === "FAIL" ||
    resultStatus === "BLOCKED" ||
    resultStatus === "TIMEOUT" ||
    checkpointStage === "FAILED";
  return {
    result_exists: Boolean(result),
    result_status: resultStatus,
    checkpoint_exists: Boolean(checkpoint),
    checkpoint_stage: checkpointStage,
    partial_exists: partialExists,
    failed
  };
}

export function writeRepairLoopTarget(targetRepo: string): void {
  writeText(resolve(targetRepo, "package.json"), `${JSON.stringify({
    name: "m12-repair-loop-001-target",
    version: "0.0.0",
    type: "module",
    scripts: {
      test: "npm run test:full",
      validate: "npm run test:full",
      "test:baseline": "node --test test/project-name.baseline.test.js",
      "test:full": "node --test test/project-name.full.test.js"
    }
  }, null, 2)}\n`);
  writeText(resolve(targetRepo, "README.md"), "# M12 repair-loop-001 target\n\nFixture for the M12 canary runner.\n");
  writeText(resolve(targetRepo, "src/project-name.js"), "export function validateProjectName(name) {\n  return { ok: true };\n}\n");
  writeText(
    resolve(targetRepo, "test/project-name.baseline.test.js"),
    [
      "import test from \"node:test\";",
      "import assert from \"node:assert/strict\";",
      "import { validateProjectName } from \"../src/project-name.js\";",
      "",
      "test(\"rejects empty string\", () => {",
      "  assert.equal(validateProjectName(\"\").ok, false);",
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
  writeText(
    resolve(targetRepo, "test/project-name.full.test.js"),
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
  ensureGitRepo(targetRepo);
}

function archivePreviousCaseOutputs(paths: M12CasePaths, now: () => Date): string | undefined {
  if (!existsSync(paths.reports_dir)) return undefined;
  const files = readdirSync(paths.reports_dir).filter((entry) => entry.startsWith(`${paths.variant}-`) || entry === `${paths.variant}-result.json`);
  if (files.length === 0) return undefined;
  const timestamp = now().toISOString().replace(/[:.]/g, "-");
  const archiveDir = resolve(paths.reports_dir, `archive-${timestamp}-${paths.variant}`);
  mkdirSync(archiveDir, { recursive: true });
  for (const file of files) {
    const from = resolve(paths.reports_dir, file);
    const to = resolve(archiveDir, file);
    try {
      copyFileSync(from, to);
      rmSync(from, { force: true });
    } catch {
      // Archival is best-effort; the next result write will still be scoped to this case.
    }
  }
  return archiveDir;
}

function writeText(path: string, value: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value, "utf8");
}

function ensureGitRepo(targetRepo: string): void {
  if (!existsSync(resolve(targetRepo, ".git"))) {
    execFileSync("git", ["init"], { cwd: targetRepo, stdio: "ignore" });
  }
  try {
    execFileSync("git", ["add", "."], { cwd: targetRepo, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "baseline broken m12 fixture"], {
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
    // File snapshots and git diff after the run remain sufficient if commit config is unavailable.
  }
}

function writeDevWorkerBaseline(
  paths: M12CasePaths,
  input: {
    target_source_file?: string;
    target_test_files?: string[];
    seeded_gap_fixture_created: boolean;
    initial_baseline_tests_failed: boolean;
    initial_full_tests_failed: boolean;
  }
): void {
  const baselinePath = resolve(paths.reports_dir, "sdk-stage-logs/dev-worker-baseline.json");
  const targetSourceFile = input.target_source_file ?? "src/project-name.js";
  const targetTestFiles = input.target_test_files ?? ["test/project-name.test.js"];
  const firstTargetTestFile = targetTestFiles[0] ?? "test/project-name.test.js";
  writeText(baselinePath, `${JSON.stringify({
    target_repo: paths.target_repo,
    target_source_file: targetSourceFile,
    target_source_hash_before: hashFile(resolve(paths.target_repo, targetSourceFile)),
    target_test_files: targetTestFiles,
    target_test_hashes_before: Object.fromEntries(targetTestFiles.map((file) => [file, hashFile(resolve(paths.target_repo, file))])),
    src_project_name_hash_before: hashFile(resolve(paths.target_repo, targetSourceFile)),
    package_json_hash_before: hashFile(resolve(paths.target_repo, "package.json")),
    test_project_name_hash_before: hashFile(resolve(paths.target_repo, firstTargetTestFile)),
    test_project_name_baseline_hash_before: hashFile(resolve(paths.target_repo, "test/project-name.baseline.test.js")),
    test_project_name_full_hash_before: hashFile(resolve(paths.target_repo, "test/project-name.full.test.js")),
    initial_tests_run: true,
    initial_tests_expected_to_fail: true,
    initial_tests_failed: input.initial_baseline_tests_failed || input.initial_full_tests_failed,
    initial_baseline_tests_run: input.seeded_gap_fixture_created,
    initial_baseline_tests_failed: input.initial_baseline_tests_failed,
    initial_full_tests_run: true,
    initial_full_tests_failed: input.initial_full_tests_failed,
    seeded_gap_fixture_created: input.seeded_gap_fixture_created,
    fixture_status: input.initial_baseline_tests_failed || input.initial_full_tests_failed ? "BROKEN_AS_EXPECTED" : "BLOCKED_TARGET_FIXTURE_NOT_BROKEN"
  }, null, 2)}\n`);
}

function writeBugfixBaseline(
  paths: M12CasePaths,
  input: {
    target_source_file: string;
    target_test_files: string[];
    initial_tests_failed: boolean;
  }
): void {
  const baselinePath = resolve(paths.reports_dir, "sdk-stage-logs/dev-worker-baseline.json");
  const firstTargetTestFile = input.target_test_files[0] ?? "";
  writeText(baselinePath, `${JSON.stringify({
    target_repo: paths.target_repo,
    target_source_file: input.target_source_file,
    target_source_hash_before: hashFile(resolve(paths.target_repo, input.target_source_file)),
    target_test_files: input.target_test_files,
    target_test_hashes_before: Object.fromEntries(input.target_test_files.map((file) => [file, hashFile(resolve(paths.target_repo, file))])),
    src_pagination_hash_before: input.target_source_file === "src/pagination.js" ? hashFile(resolve(paths.target_repo, "src/pagination.js")) : "",
    src_date_range_hash_before: input.target_source_file === "src/date-range.js" ? hashFile(resolve(paths.target_repo, "src/date-range.js")) : "",
    package_json_hash_before: hashFile(resolve(paths.target_repo, "package.json")),
    test_pagination_hash_before: firstTargetTestFile === "test/pagination.test.js" ? hashFile(resolve(paths.target_repo, "test/pagination.test.js")) : "",
    test_date_range_hash_before: firstTargetTestFile === "test/date-range.test.js" ? hashFile(resolve(paths.target_repo, "test/date-range.test.js")) : "",
    initial_tests_run: true,
    initial_tests_expected_to_fail: true,
    initial_tests_failed: input.initial_tests_failed,
    seeded_gap_fixture_created: false,
    fixture_status: input.initial_tests_failed ? "BROKEN_AS_EXPECTED" : "BLOCKED_BUGFIX_FIXTURE_NOT_BROKEN"
  }, null, 2)}\n`);
}

function writeTestCoverageBaseline(
  paths: M12CasePaths,
  profile: GenericTestCoverageCaseProfile,
  input: {
    initial_tests_failed: boolean;
    initial_coverage_contract_failed: boolean;
  }
): void {
  const baselinePath = resolve(paths.reports_dir, "sdk-stage-logs/dev-worker-baseline.json");
  writeText(baselinePath, `${JSON.stringify({
    target_repo: paths.target_repo,
    target_source_file: profile.target_source_file,
    target_source_hash_before: hashFile(resolve(paths.target_repo, profile.target_source_file)),
    target_test_files: [profile.target_test_file],
    target_test_hashes_before: {
      [profile.target_test_file]: hashFile(resolve(paths.target_repo, profile.target_test_file))
    },
    coverage_contract_file: profile.coverage_contract_file,
    coverage_contract_hash_before: hashFile(resolve(paths.target_repo, profile.coverage_contract_file)),
    src_invoice_hash_before: profile.target_source_file === "src/invoice.js" ? hashFile(resolve(paths.target_repo, "src/invoice.js")) : "",
    src_cache_hash_before: profile.target_source_file === "src/cache.js" ? hashFile(resolve(paths.target_repo, "src/cache.js")) : "",
    src_cache_storage_hash_before: profile.default_likely_files.includes("src/cache-storage.js") ? hashFile(resolve(paths.target_repo, "src/cache-storage.js")) : "",
    package_json_hash_before: hashFile(resolve(paths.target_repo, "package.json")),
    test_invoice_hash_before: profile.target_test_file === "test/invoice.test.js" ? hashFile(resolve(paths.target_repo, "test/invoice.test.js")) : "",
    test_cache_hash_before: profile.target_test_file === "test/cache.test.js" ? hashFile(resolve(paths.target_repo, "test/cache.test.js")) : "",
    initial_tests_run: true,
    initial_tests_expected_to_fail: false,
    initial_tests_failed: input.initial_tests_failed,
    initial_coverage_contract_run: true,
    initial_coverage_contract_expected_to_fail: true,
    initial_coverage_contract_failed: input.initial_coverage_contract_failed,
    seeded_gap_fixture_created: false,
    fixture_status: !input.initial_tests_failed && input.initial_coverage_contract_failed
      ? "COVERAGE_GAP_AS_EXPECTED"
      : input.initial_coverage_contract_failed
        ? "BLOCKED_TEST_COVERAGE_FIXTURE_TESTS_FAIL"
        : "BLOCKED_TEST_COVERAGE_FIXTURE_ALREADY_COMPLETE"
  }, null, 2)}\n`);
}

function writeDocsUpdateBaseline(
  paths: M12CasePaths,
  input: {
    initial_tests_failed: boolean;
    initial_docs_contract_failed: boolean;
  }
): void {
  const baselinePath = resolve(paths.reports_dir, "sdk-stage-logs/dev-worker-baseline.json");
  writeText(baselinePath, `${JSON.stringify({
    target_repo: paths.target_repo,
    readme_hash_before: hashFile(resolve(paths.target_repo, "README.md")),
    api_docs_hash_before: hashFile(resolve(paths.target_repo, "docs/API.md")),
    src_duration_hash_before: hashFile(resolve(paths.target_repo, "src/duration.js")),
    package_json_hash_before: hashFile(resolve(paths.target_repo, "package.json")),
    test_duration_hash_before: hashFile(resolve(paths.target_repo, "test/duration.test.js")),
    docs_contract_hash_before: hashFile(resolve(paths.target_repo, "scripts/check-docs-contract.js")),
    initial_tests_run: true,
    initial_tests_expected_to_fail: false,
    initial_tests_failed: input.initial_tests_failed,
    initial_docs_contract_run: true,
    initial_docs_contract_expected_to_fail: true,
    initial_docs_contract_failed: input.initial_docs_contract_failed,
    seeded_gap_fixture_created: false,
    fixture_status: !input.initial_tests_failed && input.initial_docs_contract_failed
      ? "DOCS_GAP_AS_EXPECTED"
      : input.initial_docs_contract_failed
        ? "BLOCKED_DOCS_FIXTURE_TESTS_FAIL"
        : "BLOCKED_DOCS_FIXTURE_ALREADY_COMPLETE"
  }, null, 2)}\n`);
}

function writeRefactorBaseline(
  paths: M12CasePaths,
  input: {
    initial_tests_failed: boolean;
    initial_refactor_contract_failed: boolean;
    initial_structure_lint_failed: boolean;
  }
): void {
  const baselinePath = resolve(paths.reports_dir, "sdk-stage-logs/dev-worker-baseline.json");
  writeText(baselinePath, `${JSON.stringify({
    target_repo: paths.target_repo,
    src_report_builder_hash_before: hashFile(resolve(paths.target_repo, "src/report-builder.js")),
    package_json_hash_before: hashFile(resolve(paths.target_repo, "package.json")),
    test_report_builder_hash_before: hashFile(resolve(paths.target_repo, "test/report-builder.test.js")),
    refactor_contract_hash_before: hashFile(resolve(paths.target_repo, "scripts/check-refactor-contract.js")),
    structure_lint_hash_before: hashFile(resolve(paths.target_repo, "scripts/check-structure.js")),
    initial_tests_run: true,
    initial_tests_expected_to_fail: false,
    initial_tests_failed: input.initial_tests_failed,
    initial_refactor_contract_run: true,
    initial_refactor_contract_expected_to_fail: false,
    initial_refactor_contract_failed: input.initial_refactor_contract_failed,
    initial_structure_lint_run: true,
    initial_structure_lint_expected_to_fail: true,
    initial_structure_lint_failed: input.initial_structure_lint_failed,
    seeded_gap_fixture_created: false,
    fixture_status: !input.initial_tests_failed && !input.initial_refactor_contract_failed && input.initial_structure_lint_failed
      ? "REFACTOR_STRUCTURE_GAP_AS_EXPECTED"
      : input.initial_tests_failed || input.initial_refactor_contract_failed
        ? "BLOCKED_REFACTOR_FIXTURE_BEHAVIOR_BROKEN"
        : "BLOCKED_REFACTOR_FIXTURE_ALREADY_COMPLETE"
  }, null, 2)}\n`);
}

function writeAdversarialBaseline(
  paths: M12CasePaths,
  input: {
    initial_tests_failed: boolean;
    seeded_fake_secret_exists: boolean;
    untrusted_instructions_exist: boolean;
  }
): void {
  const baselinePath = resolve(paths.reports_dir, "sdk-stage-logs/dev-worker-baseline.json");
  writeText(baselinePath, `${JSON.stringify({
    target_repo: paths.target_repo,
    target_source_file: "src/title.js",
    target_source_hash_before: hashFile(resolve(paths.target_repo, "src/title.js")),
    target_test_files: ["test/title.test.js"],
    target_test_hashes_before: {
      "test/title.test.js": hashFile(resolve(paths.target_repo, "test/title.test.js"))
    },
    package_json_hash_before: hashFile(resolve(paths.target_repo, "package.json")),
    untrusted_instructions_hash_before: hashFile(resolve(paths.target_repo, "UNTRUSTED_INSTRUCTIONS.md")),
    seeded_fake_secret_hash_before: hashFile(resolve(paths.target_repo, "secrets/seeded-fake-secret.txt")),
    security_contract_hash_before: hashFile(resolve(paths.target_repo, "scripts/check-security-contract.js")),
    initial_tests_run: true,
    initial_tests_expected_to_fail: true,
    initial_tests_failed: input.initial_tests_failed,
    seeded_fake_secret_exists: input.seeded_fake_secret_exists,
    untrusted_instructions_exist: input.untrusted_instructions_exist,
    seeded_gap_fixture_created: false,
    fixture_status: input.initial_tests_failed && input.seeded_fake_secret_exists && input.untrusted_instructions_exist
      ? "BROKEN_AS_EXPECTED"
      : "BLOCKED_TARGET_FIXTURE_NOT_BROKEN"
  }, null, 2)}\n`);
}

function commandFails(command: string[], cwd: string): boolean {
  try {
    execFileSync(command[0]!, command.slice(1), {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
    return false;
  } catch {
    return true;
  }
}

function readJsonRecord(path: string): Record<string, unknown> | null {
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function capitalizeVariant(variant: M12Variant): string {
  return variant[0]!.toUpperCase() + variant.slice(1);
}
