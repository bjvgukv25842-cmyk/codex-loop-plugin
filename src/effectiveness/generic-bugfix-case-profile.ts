import type { M12Case } from "../../scripts/effectiveness/types.ts";

export interface GenericBugfixCaseProfile {
  case_id: "bugfix-small-001" | "bugfix-small-002";
  root_goal: string;
  planner_prompt: string;
  evaluator_acceptance_summary: string;
  dev_worker_prompt: string;
  target_source_file: string;
  target_test_files: string[];
  default_validation_commands: string[];
  default_likely_files: string[];
  repair_allowed_scope: string[];
}

const bugfixSmall001Profile: GenericBugfixCaseProfile = {
  case_id: "bugfix-small-001",
  root_goal: "Fix off-by-one pagination next-page detection.",
  planner_prompt: [
    "Goal: fix pagination next-page detection.",
    "Criteria: hasNextPage is false when current page equals total pages; true before final page; invalid page numbers are rejected; npm test passes.",
    "Return planner-lite-v2 JSON: status, prd_markdown, tasks, acceptance_criteria, risks.",
    "Use one task with validation_commands [\"npm test\"] and likely_files [\"src/pagination.js\", \"test/pagination.test.js\"].",
    "No nested JSON strings."
  ].join("\n"),
  evaluator_acceptance_summary: "hasNextPage is false on the final page; true before final page; invalid page numbers are rejected; npm test passes.",
  dev_worker_prompt: [
    "$codex-loop SDK-Orchestrated Bugfix",
    "Role: dev_worker",
    "Read docs/PRD.md and docs/TASK_GRAPH.json.",
    "Only fix hasNextPage(currentPage, totalPages) in src/pagination.js.",
    "Requirements: false on final page, true before final page, invalid page numbers rejected.",
    "Run npm test.",
    "Return JSON matching the DevResult lite output schema.",
    "changed_files must include src/pagination.js.",
    "tests_run must include npm test."
  ].join("\n"),
  target_source_file: "src/pagination.js",
  target_test_files: ["test/pagination.test.js"],
  default_validation_commands: ["npm test"],
  default_likely_files: ["src/pagination.js", "test/pagination.test.js"],
  repair_allowed_scope: ["src/pagination.js", "test/pagination.test.js"]
};

const bugfixSmall002Profile: GenericBugfixCaseProfile = {
  case_id: "bugfix-small-002",
  root_goal: "Fix date range overlap logic.",
  planner_prompt: [
    "Goal: fix date range overlap logic.",
    "Criteria: adjacent ranges do not overlap; nested ranges overlap; identical ranges overlap; invalid ranges are rejected; npm test passes.",
    "Return planner-lite-v2 JSON: status, prd_markdown, tasks, acceptance_criteria, risks.",
    "Use one task with validation_commands [\"npm test\"] and likely_files [\"src/date-range.js\", \"test/date-range.test.js\"].",
    "No nested JSON strings."
  ].join("\n"),
  evaluator_acceptance_summary: "adjacent ranges do not overlap; nested ranges overlap; identical ranges overlap; invalid ranges are rejected; npm test passes.",
  dev_worker_prompt: [
    "$codex-loop SDK-Orchestrated Bugfix",
    "Role: dev_worker",
    "Read docs/PRD.md and docs/TASK_GRAPH.json.",
    "Only fix rangesOverlap(first, second) in src/date-range.js.",
    "Requirements: adjacent ranges do not overlap; nested ranges overlap; identical ranges overlap; invalid ranges are rejected.",
    "Run npm test.",
    "Return JSON matching the DevResult lite output schema.",
    "changed_files must include src/date-range.js.",
    "tests_run must include npm test."
  ].join("\n"),
  target_source_file: "src/date-range.js",
  target_test_files: ["test/date-range.test.js"],
  default_validation_commands: ["npm test"],
  default_likely_files: ["src/date-range.js", "test/date-range.test.js"],
  repair_allowed_scope: ["src/date-range.js", "test/date-range.test.js"]
};

const genericBugfixProfiles: Record<string, GenericBugfixCaseProfile> = {
  [bugfixSmall001Profile.case_id]: bugfixSmall001Profile,
  [bugfixSmall002Profile.case_id]: bugfixSmall002Profile
};

export function getGenericBugfixCaseProfile(testCaseOrId: M12Case | string): GenericBugfixCaseProfile | null {
  const caseId = typeof testCaseOrId === "string" ? testCaseOrId : testCaseOrId.case_id;
  return genericBugfixProfiles[caseId] ?? null;
}

export function genericBugfixCaseSupported(testCaseOrId: M12Case | string): boolean {
  return getGenericBugfixCaseProfile(testCaseOrId) !== null;
}
