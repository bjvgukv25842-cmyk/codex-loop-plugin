import { validateWithSchema } from "../core/validate.ts";
import type { AdversarialPlannerSafetyNotes } from "../effectiveness/adversarial-planner-safety-notes.ts";
import { hydratePlannerTaskGraph, type CanonicalPlannerTaskGraph } from "./hydrate-planner-task-graph.ts";
import { parsePlannerLiteOutput, type ParsedPlannerLiteOutput, type PlannerLiteFailureCategory } from "./parse-planner-lite-output.ts";

export interface PlannerArtifactValidationOptions {
  loop_run_id?: string;
  prd_artifact_id?: string;
  root_goal?: string;
  default_module_id?: string;
  default_owner_agent_type?: string;
  default_owner_agent_id?: string;
  default_reviewer_agent_type?: string;
  default_reviewer_agent_id?: string;
  default_validation_commands?: string[];
  default_likely_files?: string[];
  now?: string;
  preferred_contract_version?: "v1" | "v2";
}

export interface PlannerArtifactValidationResult {
  status: "PASS" | "NEEDS_REVISION";
  prd_markdown: string;
  task_graph: CanonicalPlannerTaskGraph | Record<string, never>;
  acceptance_criteria: string[];
  risks: string[];
  safety_notes?: AdversarialPlannerSafetyNotes;
  output_contract_version: "v1" | "v2" | "";
  failure_category: PlannerLiteFailureCategory | "";
  errors: string[];
}

export function validatePlannerLiteArtifacts(finalResponse: string, options: PlannerArtifactValidationOptions = {}): PlannerArtifactValidationResult {
  const parsed = parsePlannerLiteOutput(finalResponse, {
    preferred_contract_version: options.preferred_contract_version
  });
  if (parsed.status !== "PASS") {
    return fromParsedFailure(parsed);
  }

  const output = parsed.output;
  if (!output) {
    return failure("PLANNER_LITE_POSTPROCESS_FAILED", ["Planner lite parser returned PASS without output."]);
  }

  if (output.prd_markdown.trim().length === 0) {
    return failure("PLANNER_PRD_EMPTY", ["prd_markdown must not be empty."]);
  }

  if (output.acceptance_criteria.length === 0 || output.acceptance_criteria.every((criterion) => criterion.trim().length === 0)) {
    return failure("PLANNER_ACCEPTANCE_CRITERIA_EMPTY", ["acceptance_criteria must include at least one non-empty criterion."]);
  }

  const hydrated = hydratePlannerTaskGraph({
    loop_run_id: options.loop_run_id ?? readStringField(parsed.task_graph, "loop_run_id") ?? "loop_gate6b_planner_lite",
    prd_artifact_id: options.prd_artifact_id ?? readStringField(parsed.task_graph, "prd_artifact_id") ?? "artifact_prd_gate6b_planner_lite",
    root_goal: options.root_goal ?? readStringField(parsed.task_graph, "root_goal") ?? deriveRootGoal(output.prd_markdown),
    planner_task_graph: parsed.task_graph,
    default_module_id: options.default_module_id ?? "M1",
    default_owner_agent_type: options.default_owner_agent_type ?? "dev_worker",
    default_owner_agent_id: options.default_owner_agent_id ?? "sdk-dev-worker",
    default_reviewer_agent_type: options.default_reviewer_agent_type ?? "evaluator",
    default_reviewer_agent_id: options.default_reviewer_agent_id ?? "sdk-evaluator",
    default_validation_commands: options.default_validation_commands ?? ["npm test"],
    default_likely_files: options.default_likely_files ?? ["src/project-name.js"],
    now: options.now ?? new Date().toISOString(),
    output_contract_version: parsed.output_contract_version || options.preferred_contract_version
  });
  if (hydrated.status !== "PASS" || !hydrated.task_graph) {
    return failure(hydrated.failure_category || "PLANNER_TASK_GRAPH_HYDRATION_FAILED", hydrated.errors, parsed.output_contract_version);
  }

  const taskGraphResult = validateWithSchema("task-graph", hydrated.task_graph);
  if (!taskGraphResult.valid) {
    return failure(
      "PLANNER_TASK_GRAPH_SCHEMA_INVALID",
      taskGraphResult.errors.map((error) => `${error.path}: ${error.message}`),
      parsed.output_contract_version
    );
  }

  return {
    status: "PASS",
    prd_markdown: output.prd_markdown,
    task_graph: hydrated.task_graph,
    acceptance_criteria: output.acceptance_criteria,
    risks: output.risks,
    safety_notes: "safety_notes" in output ? output.safety_notes : undefined,
    output_contract_version: parsed.output_contract_version,
    failure_category: "",
    errors: []
  };
}

function fromParsedFailure(parsed: ParsedPlannerLiteOutput): PlannerArtifactValidationResult {
  return failure(parsed.failure_category || "PLANNER_LITE_POSTPROCESS_FAILED", parsed.errors, parsed.output_contract_version);
}

function failure(
  failureCategory: PlannerLiteFailureCategory,
  errors: string[],
  outputContractVersion: PlannerArtifactValidationResult["output_contract_version"] = ""
): PlannerArtifactValidationResult {
  return {
    status: "NEEDS_REVISION",
    prd_markdown: "",
    task_graph: {},
    acceptance_criteria: [],
    risks: [],
    safety_notes: undefined,
    output_contract_version: outputContractVersion,
    failure_category: failureCategory,
    errors
  };
}

function readStringField(value: unknown, key: string): string | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const field = (value as Record<string, unknown>)[key];
  return typeof field === "string" && field.trim().length > 0 ? field.trim() : undefined;
}

function deriveRootGoal(prdMarkdown: string): string {
  const heading = prdMarkdown.split(/\r?\n/).find((line) => line.trim().startsWith("#"));
  if (heading) {
    const value = heading.replace(/^#+\s*/, "").trim();
    if (value.length > 0) return value;
  }
  return "Validate project names";
}
