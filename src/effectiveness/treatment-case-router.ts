import type { M12Case } from "../../scripts/effectiveness/types.ts";

import { ADVERSARIAL_CASE_ID } from "./adversarial-safety.ts";
import { featurePlannerExactPathMatchesTreatment } from "./feature-planner-stage.ts";
import { genericBugfixCaseSupported } from "./generic-bugfix-case-profile.ts";
import { genericTestCoverageCaseSupported } from "./generic-test-coverage-case-profile.ts";

export type TreatmentCaseRuntime = "repair-loop" | "generic-feature" | "generic-bugfix" | "generic-test-coverage" | "generic-docs" | "generic-refactor" | "adversarial-safety" | "blocked";

export interface TreatmentCaseRoute {
  runtime: TreatmentCaseRuntime;
  failure_category: string;
  reason: string;
}

export interface TreatmentCaseRouteOptions {
  featurePlannerPathMatchesTreatment?: boolean;
}

export function routeTreatmentCase(testCase: M12Case, options: TreatmentCaseRouteOptions = {}): TreatmentCaseRoute {
  if (testCase.case_id.startsWith("repair-loop-")) {
    return {
      runtime: "repair-loop",
      failure_category: "",
      reason: "Repair-loop cases use the seeded-gap repair-loop runtime."
    };
  }
  if (testCase.case_id.startsWith("feature-")) {
    if (!(options.featurePlannerPathMatchesTreatment ?? featurePlannerExactPathMatchesTreatment())) {
      return {
        runtime: "blocked",
        failure_category: "BLOCKED_FEATURE_PLANNER_PATH_MISMATCH",
        reason: "Feature treatment planner path does not match the verified exact feature planner smoke path."
      };
    }
    return {
      runtime: "generic-feature",
      failure_category: "",
      reason: "Feature cases use the generic SDK-Orchestrated feature runtime."
    };
  }
  if (testCase.case_id.startsWith("bugfix-")) {
    if (genericBugfixCaseSupported(testCase)) {
      return {
        runtime: "generic-bugfix",
        failure_category: "",
        reason: "Bugfix cases use the generic SDK-Orchestrated bugfix runtime."
      };
    }
    return {
      runtime: "blocked",
      failure_category: "BLOCKED_TREATMENT_CASE_NOT_IMPLEMENTED",
      reason: `${testCase.case_id} bugfix treatment runtime is not implemented yet.`
    };
  }
  if (testCase.case_id.startsWith("test-coverage-")) {
    if (genericTestCoverageCaseSupported(testCase)) {
      return {
        runtime: "generic-test-coverage",
        failure_category: "",
        reason: "Test coverage cases use the generic SDK-Orchestrated test coverage runtime."
      };
    }
    return {
      runtime: "blocked",
      failure_category: "BLOCKED_TREATMENT_CASE_NOT_IMPLEMENTED",
      reason: `${testCase.case_id} test coverage treatment runtime is not implemented yet.`
    };
  }
  if (testCase.case_id.startsWith("docs-")) {
    if (testCase.case_id === "docs-update-001") {
      return {
        runtime: "generic-docs",
        failure_category: "",
        reason: "Docs update cases use the generic SDK-Orchestrated docs runtime."
      };
    }
    return {
      runtime: "blocked",
      failure_category: "BLOCKED_TREATMENT_CASE_NOT_IMPLEMENTED",
      reason: `${testCase.case_id} docs treatment runtime is not implemented yet.`
    };
  }
  if (testCase.case_id.startsWith("refactor-")) {
    if (testCase.case_id === "refactor-small-001") {
      return {
        runtime: "generic-refactor",
        failure_category: "",
        reason: "Refactor cases use the generic SDK-Orchestrated refactor runtime."
      };
    }
    return {
      runtime: "blocked",
      failure_category: "BLOCKED_TREATMENT_CASE_NOT_IMPLEMENTED",
      reason: `${testCase.case_id} refactor treatment runtime is not implemented yet.`
    };
  }
  if (testCase.case_id.startsWith("adversarial-")) {
    if (testCase.case_id === ADVERSARIAL_CASE_ID) {
      return {
        runtime: "adversarial-safety",
        failure_category: "",
        reason: "Adversarial cases use the SDK-Orchestrated safety runtime."
      };
    }
    return {
      runtime: "blocked",
      failure_category: "BLOCKED_TREATMENT_CASE_NOT_IMPLEMENTED",
      reason: `${testCase.case_id} adversarial treatment runtime is not implemented yet.`
    };
  }
  return {
    runtime: "blocked",
    failure_category: "BLOCKED_TREATMENT_CASE_NOT_IMPLEMENTED",
    reason: `${testCase.category || testCase.case_id} treatment runtime is not implemented yet.`
  };
}

export function treatmentCaseDryRunSupported(testCase: M12Case): boolean {
  return routeTreatmentCase(testCase).runtime !== "blocked";
}
