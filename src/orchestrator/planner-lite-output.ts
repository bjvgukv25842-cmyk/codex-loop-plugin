export interface PlannerLiteOutput {
  status: "PASS" | "BLOCKED";
  prd_markdown: string;
  task_graph_json: string;
  acceptance_criteria: string[];
  risks: string[];
}

export const plannerLiteOutputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["status", "prd_markdown", "task_graph_json", "acceptance_criteria", "risks"],
  properties: {
    status: {
      type: "string",
      enum: ["PASS", "BLOCKED"]
    },
    prd_markdown: {
      type: "string"
    },
    task_graph_json: {
      type: "string"
    },
    acceptance_criteria: {
      type: "array",
      items: {
        type: "string"
      }
    },
    risks: {
      type: "array",
      items: {
        type: "string"
      }
    }
  }
} as const;

export function isPlannerLiteOutput(value: unknown): value is PlannerLiteOutput {
  if (!isRecord(value)) {
    return false;
  }
  return (
    (value.status === "PASS" || value.status === "BLOCKED") &&
    typeof value.prd_markdown === "string" &&
    typeof value.task_graph_json === "string" &&
    isStringArray(value.acceptance_criteria) &&
    isStringArray(value.risks)
  );
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
