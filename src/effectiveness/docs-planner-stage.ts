export const DOCS_UPDATE_001_PLANNER_OUTPUT_CONTRACT_VERSION = "v2" as const;

export interface DocsUpdate001PlannerStageConfig {
  output_contract_version: typeof DOCS_UPDATE_001_PLANNER_OUTPUT_CONTRACT_VERSION;
  prompt: string;
  root_goal: string;
  default_validation_commands: string[];
  default_likely_files: string[];
  uses_task_graph_json_string: false;
}

export function buildDocsUpdate001PlannerPrompt(): string {
  return [
    "Goal: update README.md and docs/API.md for parseDuration(input).",
    "Production code in src/duration.js is already correct; prefer changing only README.md and docs/API.md.",
    "Criteria: README has Installation, Usage, API Reference, Testing, and at least 3 parseDuration examples; docs/API.md describes supported units s, m, h and invalid input returns null; npm test passes; npm run docs:contract passes.",
    "Return planner-lite-v2 JSON: status, prd_markdown, tasks, acceptance_criteria, risks.",
    "Use one task with validation_commands [\"npm test\", \"npm run docs:contract\"] and likely_files [\"README.md\", \"docs/API.md\", \"src/duration.js\", \"scripts/check-docs-contract.js\"].",
    "No nested JSON strings."
  ].join("\n");
}

export function docsUpdate001PlannerStageConfig(): DocsUpdate001PlannerStageConfig {
  return {
    output_contract_version: DOCS_UPDATE_001_PLANNER_OUTPUT_CONTRACT_VERSION,
    prompt: buildDocsUpdate001PlannerPrompt(),
    root_goal: "Update parseDuration README and API documentation.",
    default_validation_commands: ["npm test", "npm run docs:contract"],
    default_likely_files: ["README.md", "docs/API.md", "src/duration.js", "scripts/check-docs-contract.js"],
    uses_task_graph_json_string: false
  };
}
