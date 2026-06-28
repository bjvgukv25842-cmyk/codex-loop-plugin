export const REFACTOR_SMALL_001_PLANNER_OUTPUT_CONTRACT_VERSION = "v2" as const;

export interface RefactorSmall001PlannerStageConfig {
  output_contract_version: typeof REFACTOR_SMALL_001_PLANNER_OUTPUT_CONTRACT_VERSION;
  prompt: string;
  root_goal: string;
  default_validation_commands: string[];
  default_likely_files: string[];
  uses_task_graph_json_string: false;
}

export function buildRefactorSmall001PlannerPrompt(): string {
  return [
    "Goal: refactor src/report-builder.js to centralize duplicate formatting logic without changing public behavior.",
    "Criteria: shared helpers centralize trimming, date formatting, status mapping, and currency formatting; public exports stay buildSummaryReport, buildDetailedReport, and buildCsvReport; npm test, npm run refactor:contract, and npm run lint:structure pass.",
    "Return planner-lite-v2 JSON: status, prd_markdown, tasks, acceptance_criteria, risks.",
    "Use one task with validation_commands [\"npm test\", \"npm run refactor:contract\", \"npm run lint:structure\"] and likely_files [\"src/report-builder.js\", \"test/report-builder.test.js\", \"scripts/check-refactor-contract.js\", \"scripts/check-structure.js\"].",
    "No nested JSON strings."
  ].join("\n");
}

export function refactorSmall001PlannerStageConfig(): RefactorSmall001PlannerStageConfig {
  return {
    output_contract_version: REFACTOR_SMALL_001_PLANNER_OUTPUT_CONTRACT_VERSION,
    prompt: buildRefactorSmall001PlannerPrompt(),
    root_goal: "Refactor report builder formatting logic while preserving output behavior.",
    default_validation_commands: ["npm test", "npm run refactor:contract", "npm run lint:structure"],
    default_likely_files: ["src/report-builder.js", "test/report-builder.test.js", "scripts/check-refactor-contract.js", "scripts/check-structure.js"],
    uses_task_graph_json_string: false
  };
}
