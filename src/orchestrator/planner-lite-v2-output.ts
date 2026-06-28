import type { AdversarialPlannerSafetyNotes } from "../effectiveness/adversarial-planner-safety-notes.ts";

export interface PlannerLiteV2Task {
  id: string;
  title: string;
  description: string;
  acceptance_criteria: string[];
  likely_files: string[];
  validation_commands: string[];
}

export interface PlannerLiteV2Output {
  status: "PASS" | "BLOCKED";
  prd_markdown: string;
  tasks: PlannerLiteV2Task[];
  acceptance_criteria: string[];
  risks: string[];
  safety_notes?: AdversarialPlannerSafetyNotes;
}

export const plannerLiteV2OutputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["status", "prd_markdown", "tasks", "acceptance_criteria", "risks"],
  properties: {
    status: {
      type: "string",
      enum: ["PASS", "BLOCKED"]
    },
    prd_markdown: {
      type: "string"
    },
    tasks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "title", "description", "acceptance_criteria", "likely_files", "validation_commands"],
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          description: { type: "string" },
          acceptance_criteria: {
            type: "array",
            items: { type: "string" }
          },
          likely_files: {
            type: "array",
            items: { type: "string" }
          },
          validation_commands: {
            type: "array",
            items: { type: "string" }
          }
        }
      }
    },
    acceptance_criteria: {
      type: "array",
      items: { type: "string" }
    },
    risks: {
      type: "array",
      items: { type: "string" }
    },
    safety_notes: {
      type: "object",
      additionalProperties: false,
      required: [
        "untrusted_content_identified",
        "untrusted_content_ignored",
        "no_secret_access",
        "no_secret_output",
        "forbidden_files_protected",
        "validation_commands"
      ],
      properties: {
        untrusted_content_identified: { type: "boolean" },
        untrusted_content_ignored: { type: "boolean" },
        no_secret_access: { type: "boolean" },
        no_secret_output: { type: "boolean" },
        forbidden_files_protected: {
          type: "array",
          items: { type: "string" }
        },
        validation_commands: {
          type: "array",
          items: { type: "string" }
        }
      }
    }
  }
} as const;

export function isPlannerLiteV2Output(value: unknown): value is PlannerLiteV2Output {
  if (!isRecord(value)) return false;
  return (
    (value.status === "PASS" || value.status === "BLOCKED") &&
    typeof value.prd_markdown === "string" &&
    Array.isArray(value.tasks) &&
    value.tasks.every(isPlannerLiteV2Task) &&
    isStringArray(value.acceptance_criteria) &&
    isStringArray(value.risks) &&
    (value.safety_notes === undefined || isPlannerLiteV2SafetyNotes(value.safety_notes))
  );
}

export function hasPlannerLiteV2TaskShape(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return Array.isArray(value.tasks);
}

function isPlannerLiteV2Task(value: unknown): value is PlannerLiteV2Task {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    typeof value.description === "string" &&
    isStringArray(value.acceptance_criteria) &&
    isStringArray(value.likely_files) &&
    isStringArray(value.validation_commands)
  );
}

function isPlannerLiteV2SafetyNotes(value: unknown): value is AdversarialPlannerSafetyNotes {
  if (!isRecord(value)) return false;
  return (
    typeof value.untrusted_content_identified === "boolean" &&
    typeof value.untrusted_content_ignored === "boolean" &&
    typeof value.no_secret_access === "boolean" &&
    typeof value.no_secret_output === "boolean" &&
    isStringArray(value.forbidden_files_protected) &&
    isStringArray(value.validation_commands)
  );
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
