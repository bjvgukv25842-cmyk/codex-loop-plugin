import { createHash } from "node:crypto";

import type { EvaluatorStageInput } from "../orchestrator/sdk-evaluator-stage-types.ts";
import { evaluatorLiteOutputSchema } from "../orchestrator/sdk-evaluator-stage.ts";

export const DOCS_EVALUATOR_PROMPT_MAX_LENGTH = 900;

export function buildDocsEvaluatorPrompt(input: Pick<EvaluatorStageInput, "prd_path" | "task_graph_path" | "dev_result_path" | "test_log_path"> & {
  diff_path?: string;
}): string {
  return [
    "Role: evaluator. Read-only.",
    `Inputs: ${compactPath(input.prd_path)}; ${compactPath(input.task_graph_path)}; ${compactPath(input.dev_result_path)}; ${compactPath(input.test_log_path ?? "treatment-validation.log")}; ${compactPath(input.diff_path ?? "treatment-diff.patch")}.`,
    "Evaluate docs-update-001.",
    "Acceptance: README has Installation, Usage, API Reference, Testing, and 3+ parseDuration examples. docs/API.md lists units s, m, h and says invalid input returns null.",
    "Validation: npm test and npm run docs:contract pass.",
    "Scope: README.md and docs/** expected; src/** requires a real bug or API mismatch explanation.",
    "Return evaluator-lite JSON only: status, verdict, summary, findings_json, validation_commands_checked.",
    "For PASS use findings_json=\"[]\" and include npm test plus npm run docs:contract in validation_commands_checked.",
    "Do not edit files or implement."
  ].join("\n");
}

export function docsEvaluatorStageConfig(input: Pick<EvaluatorStageInput, "prd_path" | "task_graph_path" | "dev_result_path" | "test_log_path"> & {
  diff_path?: string;
}) {
  const prompt = buildDocsEvaluatorPrompt(input);
  return {
    prompt,
    prompt_length: prompt.length,
    prompt_hash: createHash("sha256").update(prompt).digest("hex"),
    output_schema: evaluatorLiteOutputSchema,
    uses_evaluator_lite_schema: true,
    uses_full_eval_report_schema: false,
    prompt_within_budget: prompt.length <= DOCS_EVALUATOR_PROMPT_MAX_LENGTH
  };
}

function compactPath(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  const markers = [
    "evals/effectiveness/reports/docs-update-001/",
    "evals/effectiveness/runs/docs-update-001/treatment/target-repo/"
  ];
  for (const marker of markers) {
    const index = normalized.indexOf(marker);
    if (index >= 0) return normalized.slice(index);
  }
  if (normalized.length <= 90) return normalized;
  return normalized.split("/").slice(-3).join("/");
}
