import type { M12Case } from "../../scripts/effectiveness/types.ts";
import { getGenericFeatureCaseProfile } from "./generic-feature-case-profile.ts";

export const FEATURE_SMALL_001_PLANNER_OUTPUT_CONTRACT_VERSION = "v2" as const;

export interface FeatureSmall001PlannerStageConfig {
  output_contract_version: typeof FEATURE_SMALL_001_PLANNER_OUTPUT_CONTRACT_VERSION;
  prompt: string;
  root_goal: string;
  default_validation_commands: string[];
  default_likely_files: string[];
  uses_task_graph_json_string: false;
}

export function buildFeatureSmall001PlannerPrompt(): string {
  return getGenericFeatureCaseProfile("feature-small-001")!.planner_prompt;
}

export function buildGenericFeaturePlannerPrompt(testCase: M12Case): string {
  const profile = getGenericFeatureCaseProfile(testCase);
  if (!profile) return buildFeatureSmall001PlannerPrompt();
  return profile.planner_prompt;
}

export function featureSmall001PlannerStageConfig(testCase?: M12Case): FeatureSmall001PlannerStageConfig {
  const profile = getGenericFeatureCaseProfile(testCase ?? "feature-small-001") ?? getGenericFeatureCaseProfile("feature-small-001")!;
  return {
    output_contract_version: FEATURE_SMALL_001_PLANNER_OUTPUT_CONTRACT_VERSION,
    prompt: profile.planner_prompt,
    root_goal: profile.root_goal,
    default_validation_commands: profile.default_validation_commands,
    default_likely_files: profile.default_likely_files,
    uses_task_graph_json_string: false
  };
}

export function featurePlannerExactPathMatchesTreatment(): boolean {
  const config = featureSmall001PlannerStageConfig();
  return config.output_contract_version === "v2" &&
    config.prompt === buildFeatureSmall001PlannerPrompt() &&
    config.uses_task_graph_json_string === false &&
    config.default_validation_commands.length === 1 &&
    config.default_validation_commands[0] === "npm test" &&
    config.default_likely_files.includes("src/project-name.js") &&
    config.default_likely_files.includes("test/project-name.test.js");
}
