import { describe, expect, it } from "vitest";

import { featurePlannerExactPathMatchesTreatment } from "../../src/effectiveness/feature-planner-stage.ts";
import { routeTreatmentCase } from "../../src/effectiveness/treatment-case-router.ts";
import { loadM12Dataset } from "../../scripts/effectiveness/dataset.ts";

describe("M12 treatment case router", () => {
  it("maps feature-small-001 to the generic feature runtime", () => {
    const testCase = loadM12Dataset().find((entry) => entry.case_id === "feature-small-001")!;

    expect(routeTreatmentCase(testCase)).toMatchObject({
      runtime: "generic-feature",
      failure_category: ""
    });
  });

  it("maps feature-small-002 to the generic feature runtime", () => {
    const testCase = loadM12Dataset().find((entry) => entry.case_id === "feature-small-002")!;

    expect(routeTreatmentCase(testCase)).toMatchObject({
      runtime: "generic-feature",
      failure_category: ""
    });
  });

  it("keeps the generic feature route on the exact planner smoke path", () => {
    expect(featurePlannerExactPathMatchesTreatment()).toBe(true);
  });

  it("blocks feature treatment when the exact planner path mismatches", () => {
    const testCase = loadM12Dataset().find((entry) => entry.case_id === "feature-small-001")!;

    expect(routeTreatmentCase(testCase, { featurePlannerPathMatchesTreatment: false })).toMatchObject({
      runtime: "blocked",
      failure_category: "BLOCKED_FEATURE_PLANNER_PATH_MISMATCH"
    });
  });

  it("keeps repair-loop-001 on the seeded-gap repair-loop runtime", () => {
    const testCase = loadM12Dataset().find((entry) => entry.case_id === "repair-loop-001")!;

    expect(routeTreatmentCase(testCase)).toMatchObject({
      runtime: "repair-loop",
      failure_category: ""
    });
  });

  it("maps bugfix-small-001 to the generic bugfix runtime", () => {
    const testCase = loadM12Dataset().find((entry) => entry.case_id === "bugfix-small-001")!;

    expect(routeTreatmentCase(testCase)).toMatchObject({
      runtime: "generic-bugfix",
      failure_category: ""
    });
  });

  it("maps bugfix-small-002 to the generic bugfix runtime", () => {
    const testCase = loadM12Dataset().find((entry) => entry.case_id === "bugfix-small-002")!;

    expect(routeTreatmentCase(testCase)).toMatchObject({
      runtime: "generic-bugfix",
      failure_category: ""
    });
  });

  it("maps test-coverage-001 to the generic test coverage runtime", () => {
    const testCase = loadM12Dataset().find((entry) => entry.case_id === "test-coverage-001")!;

    expect(routeTreatmentCase(testCase)).toMatchObject({
      runtime: "generic-test-coverage",
      failure_category: ""
    });
  });

  it("maps test-coverage-002 to the generic test coverage runtime", () => {
    const testCase = loadM12Dataset().find((entry) => entry.case_id === "test-coverage-002")!;

    expect(routeTreatmentCase(testCase)).toMatchObject({
      runtime: "generic-test-coverage",
      failure_category: ""
    });
  });

  it("maps docs-update-001 to the generic docs runtime", () => {
    const testCase = loadM12Dataset().find((entry) => entry.case_id === "docs-update-001")!;

    expect(routeTreatmentCase(testCase)).toMatchObject({
      runtime: "generic-docs",
      failure_category: ""
    });
  });

  it("maps refactor-small-001 to the generic refactor runtime", () => {
    const testCase = loadM12Dataset().find((entry) => entry.case_id === "refactor-small-001")!;

    expect(routeTreatmentCase(testCase)).toMatchObject({
      runtime: "generic-refactor",
      failure_category: ""
    });
  });

  it("maps adversarial-prompt-injection-001 to the adversarial safety runtime", () => {
    const testCase = loadM12Dataset().find((entry) => entry.case_id === "adversarial-prompt-injection-001")!;

    expect(routeTreatmentCase(testCase)).toMatchObject({
      runtime: "adversarial-safety",
      failure_category: ""
    });
  });
});
