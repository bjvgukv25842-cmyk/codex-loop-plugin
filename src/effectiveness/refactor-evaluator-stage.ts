import { createHash } from "node:crypto";

import type { EvaluatorStageInput } from "../orchestrator/sdk-evaluator-stage-types.ts";
import { evaluatorLiteOutputSchema } from "../orchestrator/sdk-evaluator-stage.ts";

export const REFACTOR_EVALUATOR_PROMPT_MAX_LENGTH = 900;

export function buildRefactorEvaluatorPrompt(input: Pick<EvaluatorStageInput, "prd_path" | "task_graph_path" | "dev_result_path" | "test_log_path"> & {
  diff_path?: string;
}): string {
  return [
    "Role: evaluator. Read-only.",
    `Inputs: ${compactPath(input.prd_path)}; ${compactPath(input.task_graph_path)}; ${compactPath(input.dev_result_path)}; ${compactPath(input.test_log_path ?? "treatment-validation.log")}; ${compactPath(input.diff_path ?? "treatment-diff.patch")}.`,
    "Evaluate refactor-small-001.",
    "Acceptance: src/report-builder.js centralizes duplicate trim, date, status, and currency formatting helpers while preserving buildSummaryReport, buildDetailedReport, and buildCsvReport outputs and exports.",
    "Validation: npm test, npm run refactor:contract, and npm run lint:structure pass.",
    "Scope: src/report-builder.js is expected; test or script changes require explicit behavior-preservation justification; README.md, package.json, package-lock.json, .env, and secrets are not allowed.",
    "Return evaluator-lite JSON only: status, verdict, summary, findings_json, validation_commands_checked.",
    "For PASS use findings_json=\"[]\" and include all three validation commands in validation_commands_checked.",
    "Do not edit files or implement."
  ].join("\n");
}

export function refactorEvaluatorStageConfig(input: Pick<EvaluatorStageInput, "prd_path" | "task_graph_path" | "dev_result_path" | "test_log_path"> & {
  diff_path?: string;
}) {
  const prompt = buildRefactorEvaluatorPrompt(input);
  return {
    prompt,
    prompt_length: prompt.length,
    prompt_hash: createHash("sha256").update(prompt).digest("hex"),
    output_schema: evaluatorLiteOutputSchema,
    uses_evaluator_lite_schema: true,
    uses_full_eval_report_schema: false,
    prompt_within_budget: prompt.length <= REFACTOR_EVALUATOR_PROMPT_MAX_LENGTH
  };
}

function compactPath(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  const markers = [
    "evals/effectiveness/reports/refactor-small-001/",
    "evals/effectiveness/runs/refactor-small-001/treatment/target-repo/"
  ];
  for (const marker of markers) {
    const index = normalized.indexOf(marker);
    if (index >= 0) return normalized.slice(index);
  }
  if (normalized.length <= 90) return normalized;
  return normalized.split("/").slice(-3).join("/");
}
