import { createHash } from "node:crypto";

import type { EvaluatorStageInput } from "../orchestrator/sdk-evaluator-stage-types.ts";
import { evaluatorLiteOutputSchema } from "../orchestrator/sdk-evaluator-stage.ts";
import type { M12Case } from "../../scripts/effectiveness/types.ts";
import { getGenericBugfixCaseProfile } from "./generic-bugfix-case-profile.ts";

export const BUGFIX_EVALUATOR_PROMPT_MAX_LENGTH = 700;

export function buildBugfixEvaluatorPrompt(input: Pick<EvaluatorStageInput, "prd_path" | "task_graph_path" | "dev_result_path" | "test_log_path"> & {
  diff_path?: string;
  testCase?: M12Case | string;
}): string {
  const profile = getGenericBugfixCaseProfile(input.testCase ?? "bugfix-small-001");
  if (!profile) {
    throw new Error(`M12 generic bugfix evaluator does not support ${typeof input.testCase === "string" ? input.testCase : input.testCase?.case_id ?? "unknown-case"}`);
  }
  return [
    "Role: evaluator. Read-only.",
    `Inputs: ${compactPath(input.prd_path)}; ${compactPath(input.task_graph_path)}; ${compactPath(input.dev_result_path)}; ${compactPath(input.test_log_path ?? "treatment-validation.log")}; ${compactPath(input.diff_path ?? "treatment-diff.patch")}.`,
    `Task: evaluate whether ${profile.case_id} is complete.`,
    `Acceptance: ${profile.evaluator_acceptance_summary}`,
    "Return evaluator-lite JSON only: status, verdict, summary, findings_json, validation_commands_checked.",
    "Use findings_json=\"[]\" for PASS. Include npm test in validation_commands_checked.",
    "Do not edit files. Do not run implementation. Do not load external skills."
  ].join("\n");
}

export function bugfixEvaluatorStageConfig(input: Pick<EvaluatorStageInput, "prd_path" | "task_graph_path" | "dev_result_path" | "test_log_path"> & {
  diff_path?: string;
  testCase?: M12Case | string;
}) {
  const prompt = buildBugfixEvaluatorPrompt(input);
  return {
    prompt,
    prompt_length: prompt.length,
    prompt_hash: createHash("sha256").update(prompt).digest("hex"),
    output_schema: evaluatorLiteOutputSchema,
    uses_evaluator_lite_schema: true,
    uses_full_eval_report_schema: false,
    prompt_within_budget: prompt.length <= BUGFIX_EVALUATOR_PROMPT_MAX_LENGTH
  };
}

function compactPath(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  const markers = [
    "evals/effectiveness/reports/bugfix-small-001/",
    "evals/effectiveness/reports/bugfix-small-002/",
    "evals/effectiveness/runs/bugfix-small-001/treatment/target-repo/",
    "evals/effectiveness/runs/bugfix-small-002/treatment/target-repo/"
  ];
  for (const marker of markers) {
    const index = normalized.indexOf(marker);
    if (index >= 0) return normalized.slice(index);
  }
  if (normalized.length <= 90) return normalized;
  return normalized.split("/").slice(-3).join("/");
}
