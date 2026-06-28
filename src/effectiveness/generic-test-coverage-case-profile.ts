import type { M12Case } from "../../scripts/effectiveness/types.ts";

export interface GenericTestCoverageCaseProfile {
  case_id: "test-coverage-001" | "test-coverage-002";
  root_goal: string;
  planner_prompt: string;
  evaluator_task_summary: string;
  evaluator_acceptance_summary: string;
  dev_worker_prompt_lines: string[];
  target_source_file: string;
  target_test_file: string;
  coverage_contract_file: string;
  default_validation_commands: string[];
  default_likely_files: string[];
  repair_allowed_scope: string[];
  source_change_explanation_pattern: RegExp;
  final_report_scope_line: string;
}

const testCoverage001Profile: GenericTestCoverageCaseProfile = {
  case_id: "test-coverage-001",
  root_goal: "Add missing calculateInvoiceTotal invoice coverage tests.",
  planner_prompt: [
    "Goal: add missing tests for calculateInvoiceTotal(items, options).",
    "Production code in src/invoice.js is already basically correct; prefer changing only test/invoice.test.js.",
    "Criteria: cover empty items; discount 0; percent discount; fixed discount; taxable=false; shippingFee; invalid price and quantity; npm test passes; npm run coverage:contract passes.",
    "Return planner-lite-v2 JSON: status, prd_markdown, tasks, acceptance_criteria, risks.",
    "Use one task with validation_commands [\"npm test\", \"npm run coverage:contract\"] and likely_files [\"test/invoice.test.js\", \"src/invoice.js\", \"scripts/check-test-coverage-contract.js\"].",
    "No nested JSON strings."
  ].join("\n"),
  evaluator_task_summary: "evaluate whether test-coverage-001 is complete.",
  evaluator_acceptance_summary: "invoice tests cover empty items, discount 0, percent discount, fixed discount, taxable=false, shippingFee, invalid price and invalid quantity.",
  dev_worker_prompt_lines: [
    "Add missing calculateInvoiceTotal tests in test/invoice.test.js.",
    "Cover empty items, discount 0, percent discount, fixed discount, taxable=false, shippingFee, invalid price, and invalid quantity.",
    "Do not modify src/invoice.js unless a new test exposes a real implementation bug.",
    "changed_files must include test/invoice.test.js."
  ],
  target_source_file: "src/invoice.js",
  target_test_file: "test/invoice.test.js",
  coverage_contract_file: "scripts/check-test-coverage-contract.js",
  default_validation_commands: ["npm test", "npm run coverage:contract"],
  default_likely_files: ["test/invoice.test.js", "src/invoice.js", "scripts/check-test-coverage-contract.js"],
  repair_allowed_scope: ["test/invoice.test.js", "src/invoice.js"],
  source_change_explanation_pattern: /real (implementation )?bug|necessary production code change|src\/invoice\.js change explained|required source change/,
  final_report_scope_line: "- Test coverage target: test/invoice.test.js"
};

const testCoverage002Profile: GenericTestCoverageCaseProfile = {
  case_id: "test-coverage-002",
  root_goal: "Add cache invalidation regression tests.",
  planner_prompt: [
    "Goal: add regression tests for cache invalidation.",
    "Production code in src/cache.js and src/cache-storage.js is already basically correct; prefer changing only test/cache.test.js.",
    "Criteria: tests cover stale cache after update; tests cover cache miss path; no unrelated cache API changes; npm test passes; npm run coverage:contract passes.",
    "Return planner-lite-v2 JSON: status, prd_markdown, tasks, acceptance_criteria, risks.",
    "Use one task with validation_commands [\"npm test\", \"npm run coverage:contract\"] and likely_files [\"test/cache.test.js\", \"src/cache.js\", \"src/cache-storage.js\", \"scripts/check-test-coverage-contract.js\"].",
    "No nested JSON strings."
  ].join("\n"),
  evaluator_task_summary: "evaluate whether test-coverage-002 is complete.",
  evaluator_acceptance_summary: "cache tests cover stale cache after update, cache miss path, and avoid unrelated cache API changes.",
  dev_worker_prompt_lines: [
    "Add missing cache invalidation regression tests in test/cache.test.js.",
    "Cover stale cache after update and cache miss path.",
    "Do not modify src/cache.js or src/cache-storage.js unless a new test exposes a real implementation bug.",
    "changed_files must include test/cache.test.js."
  ],
  target_source_file: "src/cache.js",
  target_test_file: "test/cache.test.js",
  coverage_contract_file: "scripts/check-test-coverage-contract.js",
  default_validation_commands: ["npm test", "npm run coverage:contract"],
  default_likely_files: ["test/cache.test.js", "src/cache.js", "src/cache-storage.js", "scripts/check-test-coverage-contract.js"],
  repair_allowed_scope: ["test/cache.test.js", "src/cache.js", "src/cache-storage.js"],
  source_change_explanation_pattern: /real (implementation )?bug|necessary production code change|src\/cache(?:-storage)?\.js change explained|required source change/,
  final_report_scope_line: "- Test coverage target: test/cache.test.js"
};

const genericTestCoverageProfiles: Record<string, GenericTestCoverageCaseProfile> = {
  [testCoverage001Profile.case_id]: testCoverage001Profile,
  [testCoverage002Profile.case_id]: testCoverage002Profile
};

export function getGenericTestCoverageCaseProfile(testCaseOrId: M12Case | string): GenericTestCoverageCaseProfile | null {
  const caseId = typeof testCaseOrId === "string" ? testCaseOrId : testCaseOrId.case_id;
  return genericTestCoverageProfiles[caseId] ?? null;
}

export function genericTestCoverageCaseSupported(testCaseOrId: M12Case | string): boolean {
  return getGenericTestCoverageCaseProfile(testCaseOrId) !== null;
}
