import type { M12Case } from "../../scripts/effectiveness/types.ts";
import { getGenericBugfixCaseProfile } from "./generic-bugfix-case-profile.ts";

export const BUGFIX_SMALL_001_PLANNER_OUTPUT_CONTRACT_VERSION = "v2" as const;

export interface BugfixSmall001PlannerStageConfig {
  output_contract_version: typeof BUGFIX_SMALL_001_PLANNER_OUTPUT_CONTRACT_VERSION;
  prompt: string;
  root_goal: string;
  default_validation_commands: string[];
  default_likely_files: string[];
  uses_task_graph_json_string: false;
}

export function buildBugfixSmall001PlannerPrompt(): string {
  return bugfixPlannerStageConfig("bugfix-small-001").prompt;
}

export function bugfixSmall001PlannerStageConfig(): BugfixSmall001PlannerStageConfig {
  return bugfixPlannerStageConfig("bugfix-small-001");
}

export function bugfixPlannerStageConfig(testCaseOrId: M12Case | string): BugfixSmall001PlannerStageConfig {
  const profile = getGenericBugfixCaseProfile(testCaseOrId);
  if (!profile) {
    throw new Error(`M12 generic bugfix planner does not support ${typeof testCaseOrId === "string" ? testCaseOrId : testCaseOrId.case_id}`);
  }
  return {
    output_contract_version: BUGFIX_SMALL_001_PLANNER_OUTPUT_CONTRACT_VERSION,
    prompt: profile.planner_prompt,
    root_goal: profile.root_goal,
    default_validation_commands: profile.default_validation_commands,
    default_likely_files: profile.default_likely_files,
    uses_task_graph_json_string: false
  };
}
