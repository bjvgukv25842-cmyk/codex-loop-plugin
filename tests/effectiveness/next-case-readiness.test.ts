import { describe, expect, it } from "vitest";

import { evaluateNextCaseReadiness } from "../../scripts/effectiveness/next-case-readiness.ts";
import { loadM12Dataset } from "../../scripts/effectiveness/dataset.ts";

describe("M12 next case readiness", () => {
  it("returns READY for feature-small-001 after fixture and generic treatment support are present", () => {
    const testCase = loadM12Dataset().find((entry) => entry.case_id === "feature-small-001")!;

    const readiness = evaluateNextCaseReadiness(testCase);

    expect(readiness.status).toBe("READY");
    expect(readiness.fixture_repo_exists).toBe(true);
    expect(readiness.fixture_files_present).toBe(true);
    expect(readiness.baseline_real_runner_supports_case).toBe(true);
    expect(readiness.treatment_real_runner_supports_case).toBe(true);
    expect(readiness.ready_for_one_next_case_canary).toBe(true);
  });

  it("returns READY for bugfix-small-001 after fixture and generic bugfix support are present", () => {
    const testCase = loadM12Dataset().find((entry) => entry.case_id === "bugfix-small-001")!;

    const readiness = evaluateNextCaseReadiness(testCase);

    expect(readiness.status).toBe("READY");
    expect(readiness.fixture_repo_exists).toBe(true);
    expect(readiness.fixture_files_present).toBe(true);
    expect(readiness.baseline_real_runner_supports_case).toBe(true);
    expect(readiness.treatment_real_runner_supports_case).toBe(true);
    expect(readiness.blockers).toEqual([]);
    expect(readiness.ready_for_one_next_case_canary).toBe(true);
  });

  it("returns READY for bugfix-small-002 after fixture and generic bugfix support are present", () => {
    const testCase = loadM12Dataset().find((entry) => entry.case_id === "bugfix-small-002")!;

    const readiness = evaluateNextCaseReadiness(testCase);

    expect(readiness.status).toBe("READY");
    expect(readiness.fixture_repo_exists).toBe(true);
    expect(readiness.fixture_files_present).toBe(true);
    expect(readiness.fixture_initial_tests_fail).toBe(true);
    expect(readiness.baseline_real_runner_supports_case).toBe(true);
    expect(readiness.treatment_real_runner_supports_case).toBe(true);
    expect(readiness.blockers).toEqual([]);
    expect(readiness.ready_for_one_next_case_canary).toBe(true);
  });

  it("returns READY for test-coverage-001 after fixture and generic test coverage support are present", () => {
    const testCase = loadM12Dataset().find((entry) => entry.case_id === "test-coverage-001")!;

    const readiness = evaluateNextCaseReadiness(testCase);

    expect(readiness.status).toBe("READY");
    expect(readiness.fixture_repo_exists).toBe(true);
    expect(readiness.fixture_files_present).toBe(true);
    expect(readiness.fixture_initial_tests_pass).toBe(true);
    expect(readiness.fixture_initial_coverage_contract_fails).toBe(true);
    expect(readiness.baseline_real_runner_supports_case).toBe(true);
    expect(readiness.treatment_real_runner_supports_case).toBe(true);
    expect(readiness.blockers).toEqual([]);
    expect(readiness.ready_for_one_next_case_canary).toBe(true);
  });

  it("returns READY for test-coverage-002 after fixture and generic test coverage support are present", () => {
    const testCase = loadM12Dataset().find((entry) => entry.case_id === "test-coverage-002")!;

    const readiness = evaluateNextCaseReadiness(testCase);

    expect(readiness.status).toBe("READY");
    expect(readiness.fixture_repo_exists).toBe(true);
    expect(readiness.fixture_files_present).toBe(true);
    expect(readiness.fixture_initial_tests_pass).toBe(true);
    expect(readiness.fixture_initial_coverage_contract_fails).toBe(true);
    expect(readiness.baseline_real_runner_supports_case).toBe(true);
    expect(readiness.treatment_real_runner_supports_case).toBe(true);
    expect(readiness.blockers).toEqual([]);
    expect(readiness.ready_for_one_next_case_canary).toBe(true);
  });

  it("returns READY for docs-update-001 after fixture and generic docs support are present", () => {
    const testCase = loadM12Dataset().find((entry) => entry.case_id === "docs-update-001")!;

    const readiness = evaluateNextCaseReadiness(testCase);

    expect(readiness.status).toBe("READY");
    expect(readiness.fixture_repo_exists).toBe(true);
    expect(readiness.fixture_files_present).toBe(true);
    expect(readiness.fixture_initial_tests_pass).toBe(true);
    expect(readiness.fixture_initial_docs_contract_fails).toBe(true);
    expect(readiness.baseline_real_runner_supports_case).toBe(true);
    expect(readiness.treatment_real_runner_supports_case).toBe(true);
    expect(readiness.blockers).toEqual([]);
    expect(readiness.ready_for_one_next_case_canary).toBe(true);
  });

  it("returns READY for refactor-small-001 after fixture and generic refactor support are present", () => {
    const testCase = loadM12Dataset().find((entry) => entry.case_id === "refactor-small-001")!;

    const readiness = evaluateNextCaseReadiness(testCase);

    expect(readiness.status).toBe("READY");
    expect(readiness.fixture_repo_exists).toBe(true);
    expect(readiness.fixture_files_present).toBe(true);
    expect(readiness.fixture_initial_tests_pass).toBe(true);
    expect(readiness.fixture_initial_refactor_contract_pass).toBe(true);
    expect(readiness.fixture_initial_structure_lint_fails).toBe(true);
    expect(readiness.baseline_real_runner_supports_case).toBe(true);
    expect(readiness.treatment_real_runner_supports_case).toBe(true);
    expect(readiness.blockers).toEqual([]);
    expect(readiness.ready_for_one_next_case_canary).toBe(true);
  });

  it("returns READY for feature-small-002 after fixture and generic feature support are present", () => {
    const testCase = loadM12Dataset().find((entry) => entry.case_id === "feature-small-002")!;

    const readiness = evaluateNextCaseReadiness(testCase);

    expect(readiness.status).toBe("READY");
    expect(readiness.fixture_repo_exists).toBe(true);
    expect(readiness.fixture_files_present).toBe(true);
    expect(readiness.fixture_initial_tests_fail).toBe(true);
    expect(readiness.baseline_real_runner_supports_case).toBe(true);
    expect(readiness.treatment_real_runner_supports_case).toBe(true);
    expect(readiness.blockers).toEqual([]);
    expect(readiness.ready_for_one_next_case_canary).toBe(true);
  });

  it("returns READY for adversarial-prompt-injection-001 after fixture and safety runtime support are present", () => {
    const testCase = loadM12Dataset().find((entry) => entry.case_id === "adversarial-prompt-injection-001")!;

    const readiness = evaluateNextCaseReadiness(testCase);

    expect(readiness.status).toBe("READY");
    expect(readiness.fixture_repo_exists).toBe(true);
    expect(readiness.fixture_files_present).toBe(true);
    expect(readiness.fixture_initial_tests_fail).toBe(true);
    expect(readiness.seeded_fake_secret_exists).toBe(true);
    expect(readiness.untrusted_instructions_exist).toBe(true);
    expect(readiness.baseline_real_runner_supports_case).toBe(true);
    expect(readiness.treatment_real_runner_supports_case).toBe(true);
    expect(readiness.missing_graders).toEqual([]);
    expect(readiness.blockers).toEqual([]);
    expect(readiness.ready_for_one_next_case_canary).toBe(true);
  });
});
