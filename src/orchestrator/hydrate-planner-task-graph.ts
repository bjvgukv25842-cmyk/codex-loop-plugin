import { validateWithSchema } from "../core/validate.ts";
import {
  normalizePlannerTaskGraph,
  type NormalizedPlannerTaskGraph,
  type PlannerTaskGraphDefaults
} from "./planner-task-graph-normalizer.ts";

export interface HydratePlannerTaskGraphInput {
  loop_run_id: string;
  prd_artifact_id: string;
  root_goal: string;
  planner_task_graph: unknown;
  default_module_id: string;
  default_owner_agent_type: string;
  default_owner_agent_id: string;
  default_reviewer_agent_type: string;
  default_reviewer_agent_id: string;
  default_validation_commands: string[];
  default_likely_files: string[];
  now: string;
  output_contract_version?: "v1" | "v2";
}

export interface CanonicalPlannerTaskGraph extends NormalizedPlannerTaskGraph {
  task_graph_id: string;
  loop_run_id: string;
  prd_artifact_id: string;
  root_goal: string;
  status: "TASK_GRAPH_READY";
  created_at: string;
  updated_at: string;
}

export interface HydratePlannerTaskGraphResult {
  status: "PASS" | "NEEDS_REVISION";
  task_graph: CanonicalPlannerTaskGraph | null;
  failure_category: "PLANNER_TASK_GRAPH_HYDRATION_FAILED" | "PLANNER_CANONICAL_HYDRATION_FAILED" | "PLANNER_TASK_GRAPH_SCHEMA_INVALID" | "";
  errors: string[];
}

export function hydratePlannerTaskGraph(input: HydratePlannerTaskGraphInput): HydratePlannerTaskGraphResult {
  const defaults = toDefaults(input);
  const normalized = normalizePlannerTaskGraph(input.planner_task_graph, defaults);

  if (normalized.tasks.length === 0) {
    return {
      status: "NEEDS_REVISION",
      task_graph: null,
      failure_category: input.output_contract_version === "v2" ? "PLANNER_CANONICAL_HYDRATION_FAILED" : "PLANNER_TASK_GRAPH_HYDRATION_FAILED",
      errors: ["planner_task_graph must contain at least one task."]
    };
  }

  const taskGraph: CanonicalPlannerTaskGraph = {
    task_graph_id: readGraphId(input.planner_task_graph) ?? `task_graph_${sanitizeId(input.loop_run_id)}`,
    loop_run_id: input.loop_run_id,
    prd_artifact_id: input.prd_artifact_id,
    root_goal: input.root_goal,
    tasks: normalized.tasks,
    edges: normalized.edges,
    status: "TASK_GRAPH_READY",
    created_at: readGraphTimestamp(input.planner_task_graph, "created_at") ?? input.now,
    updated_at: readGraphTimestamp(input.planner_task_graph, "updated_at") ?? input.now
  };

  const validation = validateWithSchema("task-graph", taskGraph);
  if (!validation.valid) {
    return {
      status: "NEEDS_REVISION",
      task_graph: null,
      failure_category: "PLANNER_TASK_GRAPH_SCHEMA_INVALID",
      errors: validation.errors.map((error) => `${error.path}: ${error.message}`)
    };
  }

  return {
    status: "PASS",
    task_graph: taskGraph,
    failure_category: "",
    errors: []
  };
}

function toDefaults(input: HydratePlannerTaskGraphInput): PlannerTaskGraphDefaults {
  return {
    loop_run_id: input.loop_run_id,
    default_module_id: input.default_module_id,
    default_owner_agent_type: input.default_owner_agent_type,
    default_owner_agent_id: input.default_owner_agent_id,
    default_reviewer_agent_type: input.default_reviewer_agent_type,
    default_reviewer_agent_id: input.default_reviewer_agent_id,
    default_validation_commands: input.default_validation_commands,
    default_likely_files: input.default_likely_files,
    now: input.now
  };
}

function readGraphId(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  return readNonEmptyString(value.task_graph_id) ?? readNonEmptyString(value.taskGraphId) ?? readNonEmptyString(value.id);
}

function readGraphTimestamp(value: unknown, key: "created_at" | "updated_at"): string | undefined {
  if (!isRecord(value)) return undefined;
  return readNonEmptyString(value[key]);
}

function readNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function sanitizeId(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9_-]+/g, "_") || "planner_lite";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
