import type { M12Case } from "../../scripts/effectiveness/types.ts";

export interface GenericFeatureCaseProfile {
  case_id: "feature-small-001" | "feature-small-002";
  root_goal: string;
  planner_prompt: string;
  evaluator_acceptance_summary: string;
  dev_worker_prompt: string;
  target_source_file: string;
  target_test_files: string[];
  default_validation_commands: string[];
  default_likely_files: string[];
}

const featureSmall001Profile: GenericFeatureCaseProfile = {
  case_id: "feature-small-001",
  root_goal: "Add project name validation for create-project input.",
  planner_prompt: [
    "Goal: validate create-project names.",
    "Criteria: reject empty, whitespace-only, and >80 character names; accept normal names.",
    "Return planner-lite-v2 JSON: status, prd_markdown, tasks, acceptance_criteria, risks.",
    "Use one task with validation_commands [\"npm test\"] and likely_files [\"src/project-name.js\", \"test/project-name.test.js\"].",
    "No nested JSON strings."
  ].join("\n"),
  evaluator_acceptance_summary: "reject empty project names; reject whitespace-only names; reject names longer than 80 chars; accept normal names; npm test passes.",
  dev_worker_prompt: [
    "$codex-loop SDK-Orchestrated Smoke",
    "Role: dev_worker",
    "Read docs/PRD.md and docs/TASK_GRAPH.json.",
    "Only fix validateProjectName(name) in src/project-name.js.",
    "Requirements:",
    "- Empty string fails.",
    "- Whitespace-only string fails.",
    "- Names longer than 80 characters fail.",
    "- Valid project names pass.",
    "Run npm test.",
    "Return JSON matching the DevResult lite output schema.",
    "changed_files must include src/project-name.js.",
    "tests_run must include npm test."
  ].join("\n"),
  target_source_file: "src/project-name.js",
  target_test_files: ["test/project-name.test.js"],
  default_validation_commands: ["npm test"],
  default_likely_files: ["src/project-name.js", "test/project-name.test.js"]
};

const featureSmall002Profile: GenericFeatureCaseProfile = {
  case_id: "feature-small-002",
  root_goal: "Add slug normalization for project routes.",
  planner_prompt: [
    "Goal: normalize project route slugs.",
    "Criteria: lowercase ASCII letters; convert spaces to hyphens; trim surrounding whitespace; reject empty slugs after normalization.",
    "Return planner-lite-v2 JSON: status, prd_markdown, tasks, acceptance_criteria, risks.",
    "Use one task with validation_commands [\"npm test\"] and likely_files [\"src/project-slug.js\", \"test/project-slug.test.js\"].",
    "No nested JSON strings."
  ].join("\n"),
  evaluator_acceptance_summary: "lowercase ASCII letters; convert spaces to hyphens; trim surrounding whitespace; reject empty slugs after normalization; npm test passes.",
  dev_worker_prompt: [
    "$codex-loop SDK-Orchestrated Smoke",
    "Role: dev_worker",
    "Read docs/PRD.md and docs/TASK_GRAPH.json.",
    "Only fix normalizeProjectSlug(input) in src/project-slug.js.",
    "Requirements:",
    "- Lowercase ASCII letters.",
    "- Convert spaces to hyphens.",
    "- Trim surrounding whitespace before normalizing.",
    "- Reject empty slugs after normalization with a clear error.",
    "Run npm test.",
    "Return JSON matching the DevResult lite output schema.",
    "changed_files must include src/project-slug.js.",
    "tests_run must include npm test."
  ].join("\n"),
  target_source_file: "src/project-slug.js",
  target_test_files: ["test/project-slug.test.js"],
  default_validation_commands: ["npm test"],
  default_likely_files: ["src/project-slug.js", "test/project-slug.test.js"]
};

const genericFeatureProfiles: Record<string, GenericFeatureCaseProfile> = {
  [featureSmall001Profile.case_id]: featureSmall001Profile,
  [featureSmall002Profile.case_id]: featureSmall002Profile
};

export function getGenericFeatureCaseProfile(testCaseOrId: M12Case | string): GenericFeatureCaseProfile | null {
  const caseId = typeof testCaseOrId === "string" ? testCaseOrId : testCaseOrId.case_id;
  return genericFeatureProfiles[caseId] ?? null;
}

export function genericFeatureCaseSupported(testCaseOrId: M12Case | string): boolean {
  return getGenericFeatureCaseProfile(testCaseOrId) !== null;
}
