import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { writeJson, writeMarkdown } from "./io.ts";
import type { M12Case } from "./types.ts";
import { baselineCaseSupported } from "../../src/effectiveness/baseline-codex-exec-runner.ts";
import { treatmentCaseDryRunSupported } from "../../src/effectiveness/treatment-case-router.ts";

export type NextCaseReadinessStatus = "READY" | "BLOCKED_NEXT_CASE_TREATMENT_NOT_IMPLEMENTED" | "NEEDS_REVISION";

export interface NextCaseReadinessResult {
  case_id: string;
  status: NextCaseReadinessStatus;
  real_run_executed: false;
  dataset_case_present: boolean;
  baseline_dry_run_supported: boolean;
  treatment_dry_run_supported: boolean;
  fixture_repo: string;
  fixture_repo_exists: boolean;
  fixture_files_present: boolean;
  fixture_initial_tests_pass?: boolean;
  fixture_initial_tests_fail?: boolean;
  fixture_initial_coverage_contract_fails?: boolean;
  fixture_initial_docs_contract_fails?: boolean;
  fixture_initial_refactor_contract_pass?: boolean;
  fixture_initial_structure_lint_fails?: boolean;
  seeded_fake_secret_exists?: boolean;
  untrusted_instructions_exist?: boolean;
  acceptance_criteria_complete: boolean;
  validation_commands_complete: boolean;
  forbidden_files_complete: boolean;
  graders_declared: string[];
  graders_available: boolean;
  missing_graders: string[];
  baseline_real_runner_supports_case: boolean;
  treatment_real_runner_supports_case: boolean;
  no_real_run_required: true;
  blockers: string[];
  ready_for_one_next_case_canary: boolean;
  next_minimal_action: string;
}

const knownGraders = new Set([
  "task-success",
  "validation-pass",
  "diff-scope",
  "artifact-completeness",
  "evaluator-false-pass",
  "repair-convergence",
  "security",
  "prompt-injection",
  "forbidden-file",
  "dangerous-command",
  "cost-latency"
]);

const requiredFeatureGraders = [
  "task-success",
  "validation-pass",
  "diff-scope",
  "artifact-completeness",
  "security",
  "cost-latency"
];

export function evaluateNextCaseReadiness(testCase: M12Case | undefined, repoRoot = process.cwd()): NextCaseReadinessResult {
  const missingCase = !testCase;
  const caseId = testCase?.case_id ?? "unknown-case";
  const fixtureRepo = testCase?.fixture_repo ?? "";
  const fixtureRoot = fixtureRepo ? resolve(repoRoot, fixtureRepo) : "";
  const fixtureRepoExists = Boolean(fixtureRoot && existsSync(fixtureRoot));
  const expectedFixtureFiles = fixtureFilesForCase(caseId);
  const fixtureFilesPresent = Boolean(
    fixtureRoot &&
      expectedFixtureFiles.every((file) => existsSync(resolve(fixtureRoot, file)))
  );
  const fixtureContract = fixtureInitialContractForCase(caseId, fixtureRoot, fixtureRepoExists && fixtureFilesPresent);
  const gradersDeclared = testCase?.graders ?? [];
  const missingGraders = gradersDeclared.filter((grader) => !knownGraders.has(grader));
  const requiredGraders = requiredGradersForCase(caseId);
  const missingRequiredGraders = requiredGraders.filter((grader) => !gradersDeclared.includes(grader));
  const baselineSupported = testCase ? baselineCaseSupported(testCase) : false;
  const treatmentSupported = testCase ? treatmentCaseDryRunSupported(testCase) : false;

  const blockers = [
    ...(missingCase ? [`${caseId} is missing from evals/effectiveness/datasets/m12-mini.jsonl.`] : []),
    ...(!fixtureRepoExists ? [`${fixtureRepo || "fixture_repo"} is not materialized.`] : []),
    ...(fixtureRepoExists && !fixtureFilesPresent ? [`${caseId} fixture is missing required files: ${expectedFixtureFiles.join(", ")}.`] : []),
    ...(fixtureContract.testsPass === false ? [`${caseId} fixture initial npm test does not pass.`] : []),
    ...(fixtureContract.testsFail === false ? [`${caseId} fixture initial npm test does not fail as expected.`] : []),
    ...(fixtureContract.coverageContractFails === false ? [`${caseId} fixture initial coverage contract does not fail as expected.`] : []),
    ...(fixtureContract.docsContractFails === false ? [`${caseId} fixture initial docs contract does not fail as expected.`] : []),
    ...(fixtureContract.refactorContractPass === false ? [`${caseId} fixture initial refactor contract does not pass.`] : []),
    ...(fixtureContract.structureLintFails === false ? [`${caseId} fixture initial structure lint does not fail as expected.`] : []),
    ...(fixtureContract.seededFakeSecretExists === false ? [`${caseId} seeded fake secret is missing.`] : []),
    ...(fixtureContract.untrustedInstructionsExist === false ? [`${caseId} untrusted instructions fixture is missing.`] : []),
    ...(testCase && testCase.acceptance_criteria.length === 0 ? [`${caseId} acceptance_criteria is empty.`] : []),
    ...(testCase && testCase.validation_commands.length === 0 ? [`${caseId} validation_commands is empty.`] : []),
    ...(testCase && testCase.forbidden_files.length === 0 ? [`${caseId} forbidden_files is empty.`] : []),
    ...(missingGraders.length > 0 ? [`Unknown graders: ${missingGraders.join(", ")}`] : []),
    ...(missingRequiredGraders.length > 0 ? [`Missing required feature graders: ${missingRequiredGraders.join(", ")}`] : []),
    ...(!baselineSupported ? [`Baseline runner does not support ${caseId}.`] : []),
    ...(!treatmentSupported ? [`SDK-Orchestrated treatment runner does not support ${caseId}.`] : [])
  ];

  const status: NextCaseReadinessStatus = blockers.length === 0
    ? "READY"
    : blockers.some((blocker) => /runner|fixture|materialized/i.test(blocker))
      ? "BLOCKED_NEXT_CASE_TREATMENT_NOT_IMPLEMENTED"
      : "NEEDS_REVISION";

  return {
    case_id: caseId,
    status,
    real_run_executed: false,
    dataset_case_present: !missingCase,
    baseline_dry_run_supported: baselineSupported,
    treatment_dry_run_supported: treatmentSupported,
    fixture_repo: fixtureRepo,
    fixture_repo_exists: fixtureRepoExists,
    fixture_files_present: fixtureFilesPresent,
    fixture_initial_tests_pass: fixtureContract.testsPass,
    fixture_initial_tests_fail: fixtureContract.testsFail,
    fixture_initial_coverage_contract_fails: fixtureContract.coverageContractFails,
    fixture_initial_docs_contract_fails: fixtureContract.docsContractFails,
    fixture_initial_refactor_contract_pass: fixtureContract.refactorContractPass,
    fixture_initial_structure_lint_fails: fixtureContract.structureLintFails,
    seeded_fake_secret_exists: fixtureContract.seededFakeSecretExists,
    untrusted_instructions_exist: fixtureContract.untrustedInstructionsExist,
    acceptance_criteria_complete: Boolean(testCase && testCase.acceptance_criteria.length > 0),
    validation_commands_complete: Boolean(testCase && testCase.validation_commands.length > 0),
    forbidden_files_complete: Boolean(testCase && testCase.forbidden_files.length > 0),
    graders_declared: gradersDeclared,
    graders_available: missingGraders.length === 0 && missingRequiredGraders.length === 0,
    missing_graders: Array.from(new Set([...missingGraders, ...missingRequiredGraders])),
    baseline_real_runner_supports_case: baselineSupported,
    treatment_real_runner_supports_case: treatmentSupported,
    no_real_run_required: true,
    blockers,
    ready_for_one_next_case_canary: status === "READY",
    next_minimal_action: status === "READY"
      ? `Run exactly one ${caseId} canary. Do not run the full dataset yet.`
      : `Fix the listed readiness blockers before approving one ${caseId} canary.`
  };
}

function fixtureFilesForCase(caseId: string): string[] {
  if (caseId === "bugfix-small-001") {
    return ["package.json", "src/pagination.js", "test/pagination.test.js"];
  }
  if (caseId === "bugfix-small-002") {
    return ["package.json", "README.md", "src/date-range.js", "test/date-range.test.js"];
  }
  if (caseId === "test-coverage-001") {
    return ["package.json", "src/invoice.js", "test/invoice.test.js", "scripts/check-test-coverage-contract.js"];
  }
  if (caseId === "test-coverage-002") {
    return ["package.json", "README.md", "src/cache.js", "src/cache-storage.js", "test/cache.test.js", "scripts/check-test-coverage-contract.js"];
  }
  if (caseId === "docs-update-001") {
    return ["package.json", "README.md", "docs/API.md", "src/duration.js", "test/duration.test.js", "scripts/check-docs-contract.js"];
  }
  if (caseId === "refactor-small-001") {
    return ["package.json", "README.md", "src/report-builder.js", "test/report-builder.test.js", "scripts/check-refactor-contract.js", "scripts/check-structure.js"];
  }
  if (caseId === "feature-small-002") {
    return ["package.json", "README.md", "src/project-slug.js", "test/project-slug.test.js"];
  }
  if (caseId === "adversarial-prompt-injection-001") {
    return [
      "package.json",
      "src/title.js",
      "test/title.test.js",
      "README.md",
      "UNTRUSTED_INSTRUCTIONS.md",
      ".env.example",
      "secrets/seeded-fake-secret.txt",
      "scripts/check-security-contract.js"
    ];
  }
  return ["package.json", "src/project-name.js", "test/project-name.test.js"];
}

function fixtureInitialContractForCase(caseId: string, fixtureRoot: string, canCheck: boolean): {
  testsPass?: boolean;
  testsFail?: boolean;
  coverageContractFails?: boolean;
  docsContractFails?: boolean;
  refactorContractPass?: boolean;
  structureLintFails?: boolean;
  seededFakeSecretExists?: boolean;
  untrustedInstructionsExist?: boolean;
} {
  if (!canCheck) return {};
  if (caseId === "test-coverage-001" || caseId === "test-coverage-002") {
    return {
      testsPass: commandPasses(["npm", "test"], fixtureRoot),
      coverageContractFails: !commandPasses(["npm", "run", "coverage:contract"], fixtureRoot)
    };
  }
  if (caseId === "docs-update-001") {
    return {
      testsPass: commandPasses(["npm", "test"], fixtureRoot),
      docsContractFails: !commandPasses(["npm", "run", "docs:contract"], fixtureRoot)
    };
  }
  if (caseId === "refactor-small-001") {
    return {
      testsPass: commandPasses(["npm", "test"], fixtureRoot),
      refactorContractPass: commandPasses(["npm", "run", "refactor:contract"], fixtureRoot),
      structureLintFails: !commandPasses(["npm", "run", "lint:structure"], fixtureRoot)
    };
  }
  if (caseId === "feature-small-002") {
    return {
      testsFail: !commandPasses(["npm", "test"], fixtureRoot)
    };
  }
  if (caseId === "adversarial-prompt-injection-001") {
    return {
      testsFail: !commandPasses(["npm", "test"], fixtureRoot),
      seededFakeSecretExists: existsSync(resolve(fixtureRoot, "secrets/seeded-fake-secret.txt")),
      untrustedInstructionsExist: existsSync(resolve(fixtureRoot, "UNTRUSTED_INSTRUCTIONS.md"))
    };
  }
  if (caseId === "bugfix-small-001" || caseId === "bugfix-small-002") {
    return {
      testsFail: !commandPasses(["npm", "test"], fixtureRoot)
    };
  }
  return {
    testsPass: undefined
  };
}

function requiredGradersForCase(caseId: string): string[] {
  if (caseId === "adversarial-prompt-injection-001") {
    return [
      ...requiredFeatureGraders,
      "prompt-injection",
      "forbidden-file",
      "dangerous-command"
    ];
  }
  return requiredFeatureGraders;
}

function commandPasses(command: string[], cwd: string): boolean {
  try {
    execFileSync(command[0]!, command.slice(1), {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
    return true;
  } catch {
    return false;
  }
}

export function writeNextCaseReadinessReport(result: NextCaseReadinessResult): void {
  const reportDir = `evals/effectiveness/reports/${result.case_id}`;
  writeJson(`${reportDir}/next-case-readiness.json`, result);
  const lines = [
    `# M12 ${result.case_id} Next Case Readiness`,
    "",
    `Status: ${result.status}`,
    "",
    "No real Codex or SDK run was executed.",
    "",
    "## Static Checks",
    "",
    `- Dataset case present: ${result.dataset_case_present}`,
    `- Baseline dry-run supported: ${result.baseline_dry_run_supported}`,
    `- Treatment dry-run supported: ${result.treatment_dry_run_supported}`,
    `- Acceptance criteria complete: ${result.acceptance_criteria_complete}`,
    `- Validation commands complete: ${result.validation_commands_complete}`,
    `- Forbidden files complete: ${result.forbidden_files_complete}`,
    `- Grader coverage complete: ${result.graders_available}`,
    `- Fixture repo exists: ${result.fixture_repo_exists}`,
    `- Fixture files present: ${result.fixture_files_present}`,
    ...(result.fixture_initial_tests_pass === undefined ? [] : [`- Fixture initial npm test passes: ${result.fixture_initial_tests_pass}`]),
    ...(result.fixture_initial_tests_fail === undefined ? [] : [`- Fixture initial npm test fails as expected: ${result.fixture_initial_tests_fail}`]),
    ...(result.fixture_initial_coverage_contract_fails === undefined ? [] : [`- Fixture initial coverage contract fails as expected: ${result.fixture_initial_coverage_contract_fails}`]),
    ...(result.fixture_initial_docs_contract_fails === undefined ? [] : [`- Fixture initial docs contract fails as expected: ${result.fixture_initial_docs_contract_fails}`]),
    ...(result.fixture_initial_refactor_contract_pass === undefined ? [] : [`- Fixture initial refactor contract passes: ${result.fixture_initial_refactor_contract_pass}`]),
    ...(result.fixture_initial_structure_lint_fails === undefined ? [] : [`- Fixture initial structure lint fails as expected: ${result.fixture_initial_structure_lint_fails}`]),
    ...(result.seeded_fake_secret_exists === undefined ? [] : [`- Seeded fake secret exists: ${result.seeded_fake_secret_exists}`]),
    ...(result.untrusted_instructions_exist === undefined ? [] : [`- Untrusted instructions exist: ${result.untrusted_instructions_exist}`]),
    `- Baseline real runner supports this case: ${result.baseline_real_runner_supports_case}`,
    `- Treatment runner supports this case: ${result.treatment_real_runner_supports_case}`,
    "",
    "## Blockers",
    ...(result.blockers.length > 0 ? result.blockers.map((blocker) => `- ${blocker}`) : ["- None"]),
    "",
    "## Next Minimal Action",
    "",
    result.next_minimal_action,
    ""
  ];
  writeMarkdown(`${reportDir}/NextCaseReadinessReport.md`, `${lines.join("\n")}\n`);
}
