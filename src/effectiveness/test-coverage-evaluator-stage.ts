import { createHash } from "node:crypto";

import type { M12Case } from "../../scripts/effectiveness/types.ts";
import type { EvaluatorStageInput } from "../orchestrator/sdk-evaluator-stage-types.ts";
import { evaluatorLiteOutputSchema } from "../orchestrator/sdk-evaluator-stage.ts";
import { getGenericTestCoverageCaseProfile } from "./generic-test-coverage-case-profile.ts";

export const TEST_COVERAGE_EVALUATOR_PROMPT_MAX_LENGTH = 900;

export function buildTestCoverageEvaluatorPrompt(input: Pick<EvaluatorStageInput, "prd_path" | "task_graph_path" | "dev_result_path" | "test_log_path"> & {
  diff_path?: string;
  testCase?: M12Case | string;
}): string {
  const profile = getGenericTestCoverageCaseProfile(input.testCase ?? "test-coverage-001");
  if (!profile) {
    throw new Error(`M12 generic test coverage evaluator does not support ${typeof input.testCase === "string" ? input.testCase : input.testCase?.case_id ?? ""}`);
  }
  return [
    "Role: evaluator. Read-only.",
    `Inputs: ${compactPath(input.prd_path)}; ${compactPath(input.task_graph_path)}; ${compactPath(input.dev_result_path)}; ${compactPath(input.test_log_path ?? "treatment-validation.log")}; ${compactPath(input.diff_path ?? "treatment-diff.patch")}.`,
    `Task: ${profile.evaluator_task_summary}`,
    `Acceptance: ${profile.evaluator_acceptance_summary}`,
    "Validation: npm test and npm run coverage:contract must both pass.",
    `Scope: ${profile.target_test_file} changes are expected. ${profile.target_source_file} should not change unless the FinalReport explains a real bug exposed by the tests.`,
    "Return evaluator-lite JSON only: status, verdict, summary, findings_json, validation_commands_checked.",
    "Use findings_json=\"[]\" for PASS. Include both npm test and npm run coverage:contract in validation_commands_checked.",
    "Do not edit files. Do not run implementation. Do not load external skills."
  ].join("\n");
}

export function testCoverageEvaluatorStageConfig(input: Pick<EvaluatorStageInput, "prd_path" | "task_graph_path" | "dev_result_path" | "test_log_path"> & {
  diff_path?: string;
  testCase?: M12Case | string;
}) {
  const prompt = buildTestCoverageEvaluatorPrompt(input);
  return {
    prompt,
    prompt_length: prompt.length,
    prompt_hash: createHash("sha256").update(prompt).digest("hex"),
    output_schema: evaluatorLiteOutputSchema,
    uses_evaluator_lite_schema: true,
    uses_full_eval_report_schema: false,
    prompt_within_budget: prompt.length <= TEST_COVERAGE_EVALUATOR_PROMPT_MAX_LENGTH
  };
}

function compactPath(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  const markers = [
    "evals/effectiveness/reports/test-coverage-001/",
    "evals/effectiveness/reports/test-coverage-002/",
    "evals/effectiveness/runs/test-coverage-001/treatment/target-repo/",
    "evals/effectiveness/runs/test-coverage-002/treatment/target-repo/"
  ];
  for (const marker of markers) {
    const index = normalized.indexOf(marker);
    if (index >= 0) return normalized.slice(index);
  }
  if (normalized.length <= 90) return normalized;
  return normalized.split("/").slice(-3).join("/");
}
