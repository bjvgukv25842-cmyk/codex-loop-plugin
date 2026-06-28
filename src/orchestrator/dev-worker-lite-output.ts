export interface DevWorkerLiteOutput {
  status: "PASS" | "BLOCKED" | "NEEDS_REVISION";
  changed_files: string[];
  tests_run: string[];
  tests_passed: boolean;
  summary: string;
}

export const devWorkerLiteOutputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["status", "changed_files", "tests_run", "tests_passed", "summary"],
  properties: {
    status: {
      type: "string",
      enum: ["PASS", "BLOCKED", "NEEDS_REVISION"]
    },
    changed_files: {
      type: "array",
      items: {
        type: "string"
      }
    },
    tests_run: {
      type: "array",
      items: {
        type: "string"
      }
    },
    tests_passed: {
      type: "boolean"
    },
    summary: {
      type: "string"
    }
  }
} as const;

export function isDevWorkerLiteOutput(value: unknown): value is DevWorkerLiteOutput {
  if (!isRecord(value)) {
    return false;
  }
  return (
    (value.status === "PASS" || value.status === "BLOCKED" || value.status === "NEEDS_REVISION") &&
    isStringArray(value.changed_files) &&
    isStringArray(value.tests_run) &&
    typeof value.tests_passed === "boolean" &&
    typeof value.summary === "string"
  );
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
