import type { M12Case, M12RunResult } from "../../scripts/effectiveness/types.ts";

export type ThreadEvidencePolicyName = "direct-pass" | "repair-required" | "unsupported";
export type ThreadEvidenceRole = "planner" | "dev_worker" | "evaluator" | "initial_evaluator" | "repair_dev_worker" | "final_evaluator";

export interface ThreadEvidencePolicyResult {
  repair_path_required: boolean;
  required_thread_roles: ThreadEvidenceRole[];
  optional_thread_roles: ThreadEvidenceRole[];
  missing_required_roles: ThreadEvidenceRole[];
  policy: ThreadEvidencePolicyName;
}

type CaseLike = Pick<M12Case, "case_id" | "category"> | undefined;

export function evaluateThreadEvidence(testCase: CaseLike, treatmentResult: Partial<M12RunResult>): ThreadEvidencePolicyResult {
  const caseId = testCase?.case_id ?? treatmentResult.case_id ?? "";
  const category = testCase?.category ?? categoryFromCaseId(caseId);
  const policy = selectPolicy(caseId, category, treatmentResult);
  const required = requiredRolesForPolicy(policy);
  const optional = optionalRolesForPolicy(policy);

  return {
    repair_path_required: policy === "repair-required",
    required_thread_roles: required,
    optional_thread_roles: optional,
    missing_required_roles: required.filter((role) => !threadRolePresent(role, treatmentResult)),
    policy
  };
}

export function treatmentHasNeedsRevision(result: Partial<M12RunResult>): boolean {
  return result.evaluator_verdict === "NEEDS_REVISION" ||
    result.initial_eval_verdict === "NEEDS_REVISION" ||
    result.final_eval_verdict === "NEEDS_REVISION";
}

export function treatmentHasPassVerdict(result: Partial<M12RunResult>): boolean {
  return result.evaluator_verdict === "PASS" ||
    result.initial_eval_verdict === "PASS" ||
    result.final_eval_verdict === "PASS";
}

function selectPolicy(caseId: string, category: string, result: Partial<M12RunResult>): ThreadEvidencePolicyName {
  if (caseId.startsWith("repair-loop-") || category === "repair-loop") return "repair-required";
  if (treatmentHasNeedsRevision(result)) return "repair-required";
  if ((caseId.startsWith("bugfix-") ||
      caseId.startsWith("feature-") ||
      caseId.startsWith("test-coverage-") ||
      caseId.startsWith("docs-") ||
      caseId.startsWith("refactor-") ||
      caseId.startsWith("adversarial-") ||
      category.startsWith("bugfix") ||
      category.startsWith("feature") ||
      category.startsWith("test-coverage") ||
      category.startsWith("docs") ||
      category.startsWith("refactor") ||
      category.startsWith("adversarial")) &&
    treatmentHasPassVerdict(result)) {
    return "direct-pass";
  }
  return "unsupported";
}

function requiredRolesForPolicy(policy: ThreadEvidencePolicyName): ThreadEvidenceRole[] {
  if (policy === "direct-pass") return ["planner", "dev_worker", "evaluator"];
  if (policy === "repair-required") return ["planner", "dev_worker", "initial_evaluator", "repair_dev_worker", "final_evaluator"];
  return [];
}

function optionalRolesForPolicy(policy: ThreadEvidencePolicyName): ThreadEvidenceRole[] {
  if (policy === "direct-pass") return ["repair_dev_worker", "final_evaluator"];
  return [];
}

function threadRolePresent(role: ThreadEvidenceRole, result: Partial<M12RunResult>): boolean {
  switch (role) {
    case "planner":
      return Boolean(result.planner_thread_id);
    case "dev_worker":
      return Boolean(result.dev_worker_thread_id);
    case "evaluator":
      return Boolean(result.initial_evaluator_thread_id || result.final_evaluator_thread_id);
    case "initial_evaluator":
      return Boolean(result.initial_evaluator_thread_id);
    case "repair_dev_worker":
      return Boolean(result.repair_dev_worker_thread_id);
    case "final_evaluator":
      return Boolean(result.final_evaluator_thread_id);
  }
}

function categoryFromCaseId(caseId: string): string {
  if (caseId.startsWith("repair-loop-")) return "repair-loop";
  if (caseId.startsWith("bugfix-")) return "bugfix";
  if (caseId.startsWith("feature-")) return "feature";
  if (caseId.startsWith("test-coverage-")) return "test-coverage";
  if (caseId.startsWith("docs-")) return "docs";
  if (caseId.startsWith("refactor-")) return "refactor";
  if (caseId.startsWith("adversarial-")) return "adversarial";
  return "";
}
