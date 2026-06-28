import { isPlannerLiteOutput, type PlannerLiteOutput } from "./planner-lite-output.ts";
import {
  hasPlannerLiteV2TaskShape,
  isPlannerLiteV2Output,
  type PlannerLiteV2Output
} from "./planner-lite-v2-output.ts";

export type PlannerLiteFailureCategory =
  | "PLANNER_LITE_OUTPUT_SCHEMA_FAILED"
  | "PLANNER_TASK_GRAPH_JSON_INVALID"
  | "PLANNER_TASK_GRAPH_HYDRATION_FAILED"
  | "PLANNER_TASK_GRAPH_SCHEMA_INVALID"
  | "PLANNER_V2_TASKS_EMPTY"
  | "PLANNER_V2_TASKS_SCHEMA_INVALID"
  | "PLANNER_CANONICAL_HYDRATION_FAILED"
  | "PLANNER_PRD_EMPTY"
  | "PLANNER_ACCEPTANCE_CRITERIA_EMPTY"
  | "PLANNER_LITE_POSTPROCESS_FAILED"
  | "ADVERSARIAL_PLANNER_OUTPUT_TRUNCATED"
  | "ADVERSARIAL_PLANNER_JSON_INVALID"
  | "ADVERSARIAL_PLANNER_OUTPUT_SCHEMA_TOO_LARGE"
  | "ADVERSARIAL_PLANNER_TREATMENT_PATH_MISMATCH"
  | "ADVERSARIAL_PLANNER_COMPACT_HYDRATION_FAILED"
  | "ADVERSARIAL_PLANNER_ARTIFACT_WRITE_FAILED"
  | "ADVERSARIAL_COMPACT_PLANNER_NO_FINAL_OUTPUT"
  | "ADVERSARIAL_COMPACT_PLANNER_OUTPUT_SCHEMA_NOT_PASSED"
  | "ADVERSARIAL_COMPACT_PLANNER_OUTPUT_SCHEMA_TOO_COMPLEX"
  | "ADVERSARIAL_COMPACT_PLANNER_STRUCTURED_OUTPUT_INVALID"
  | "ADVERSARIAL_COMPACT_PLANNER_RAW_JSON_RECOVERABLE"
  | "ADVERSARIAL_COMPACT_PLANNER_PARSER_FIELD_MISMATCH"
  | "ADVERSARIAL_COMPACT_PLANNER_HYDRATOR_NOT_TRIGGERED"
  | "ADVERSARIAL_COMPACT_PLANNER_HYDRATION_FAILED"
  | "ADVERSARIAL_COMPACT_PLANNER_PATH_ALIGNMENT_FAILED";

export type PlannerOutputContractVersion = "v1" | "v2";

export interface ParsedPlannerLiteOutput {
  status: "PASS" | "NEEDS_REVISION";
  output?: PlannerLiteOutput | PlannerLiteV2Output;
  output_contract_version: PlannerOutputContractVersion | "";
  task_graph?: unknown;
  failure_category: PlannerLiteFailureCategory | "";
  errors: string[];
}

export function parsePlannerLiteOutput(
  finalResponse: string,
  options: { preferred_contract_version?: PlannerOutputContractVersion } = {}
): ParsedPlannerLiteOutput {
  let parsed: unknown;
  try {
    parsed = JSON.parse(finalResponse) as unknown;
  } catch (error) {
    return {
      status: "NEEDS_REVISION",
      output_contract_version: "",
      failure_category: "PLANNER_LITE_OUTPUT_SCHEMA_FAILED",
      errors: [`Planner lite output is not valid JSON: ${error instanceof Error ? error.message : String(error)}`]
    };
  }

  if (options.preferred_contract_version !== "v1" && hasPlannerLiteV2TaskShape(parsed)) {
    return parsePlannerLiteV2(parsed);
  }

  if (!isPlannerLiteOutput(parsed)) {
    return {
      status: "NEEDS_REVISION",
      output_contract_version: hasPlannerLiteV2TaskShape(parsed) ? "v2" : "",
      failure_category: "PLANNER_LITE_OUTPUT_SCHEMA_FAILED",
      errors: ["Planner lite output does not match the required flat output shape."]
    };
  }

  let taskGraph: unknown;
  try {
    taskGraph = JSON.parse(parsed.task_graph_json) as unknown;
  } catch (error) {
    return {
      status: "NEEDS_REVISION",
      output: parsed,
      output_contract_version: "v1",
      failure_category: "PLANNER_TASK_GRAPH_JSON_INVALID",
      errors: [`task_graph_json is not valid JSON: ${error instanceof Error ? error.message : String(error)}`]
    };
  }

  return {
    status: "PASS",
    output: parsed,
    output_contract_version: "v1",
    task_graph: taskGraph,
    failure_category: "",
    errors: []
  };
}

function parsePlannerLiteV2(parsed: unknown): ParsedPlannerLiteOutput {
  if (!isPlannerLiteV2Output(parsed)) {
    return {
      status: "NEEDS_REVISION",
      output_contract_version: "v2",
      failure_category: "PLANNER_V2_TASKS_SCHEMA_INVALID",
      errors: ["Planner lite v2 output does not match the required structured tasks shape."]
    };
  }

  if (parsed.tasks.length === 0) {
    return {
      status: "NEEDS_REVISION",
      output: parsed,
      output_contract_version: "v2",
      failure_category: "PLANNER_V2_TASKS_EMPTY",
      errors: ["Planner lite v2 output must include at least one task."]
    };
  }

  return {
    status: "PASS",
    output: parsed,
    output_contract_version: "v2",
    task_graph: {
      version: "planner-lite-v2",
      tasks: parsed.safety_notes
        ? parsed.tasks.map((task) => ({ ...task, safety_notes: parsed.safety_notes }))
        : parsed.tasks,
      safety_notes: parsed.safety_notes
    },
    failure_category: "",
    errors: []
  };
}
