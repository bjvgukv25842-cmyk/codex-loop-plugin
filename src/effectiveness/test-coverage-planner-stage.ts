import type { M12Case } from "../../scripts/effectiveness/types.ts";
import { getGenericTestCoverageCaseProfile } from "./generic-test-coverage-case-profile.ts";

export const TEST_COVERAGE_001_PLANNER_OUTPUT_CONTRACT_VERSION = "v2" as const;

export interface TestCoverage001PlannerStageConfig {
  output_contract_version: typeof TEST_COVERAGE_001_PLANNER_OUTPUT_CONTRACT_VERSION;
  prompt: string;
  root_goal: string;
  default_validation_commands: string[];
  default_likely_files: string[];
  uses_task_graph_json_string: false;
}

export function buildTestCoverage001PlannerPrompt(): string {
  const profile = getGenericTestCoverageCaseProfile("test-coverage-001");
  return profile?.planner_prompt ?? "";
}

export function testCoveragePlannerStageConfig(testCaseOrId: M12Case | string = "test-coverage-001"): TestCoverage001PlannerStageConfig {
  const profile = getGenericTestCoverageCaseProfile(testCaseOrId);
  if (!profile) {
    throw new Error(`M12 generic test coverage planner does not support ${typeof testCaseOrId === "string" ? testCaseOrId : testCaseOrId.case_id}`);
  }
  return {
    output_contract_version: TEST_COVERAGE_001_PLANNER_OUTPUT_CONTRACT_VERSION,
    prompt: profile.planner_prompt,
    root_goal: profile.root_goal,
    default_validation_commands: profile.default_validation_commands,
    default_likely_files: profile.default_likely_files,
    uses_task_graph_json_string: false
  };
}

export function testCoverage001PlannerStageConfig(): TestCoverage001PlannerStageConfig {
  return testCoveragePlannerStageConfig("test-coverage-001");
}
