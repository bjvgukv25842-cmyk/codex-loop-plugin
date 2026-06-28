import { isDevWorkerLiteOutput, type DevWorkerLiteOutput } from "./dev-worker-lite-output.ts";

export type DevWorkerLiteFailureCategory =
  | "DEV_WORKER_OUTPUT_SCHEMA_FAILURE"
  | "DEV_WORKER_RESULT_SCHEMA_INVALID"
  | "DEV_WORKER_NO_FILE_CHANGE"
  | "DEV_WORKER_NO_TEST"
  | "DEV_WORKER_TESTS_FAILED"
  | "DEV_WORKER_TEST_DELETED"
  | "DEV_WORKER_PROMPT_OR_HARNESS_FAILURE";

export interface ParsedDevWorkerLiteOutput {
  status: "PASS" | "NEEDS_REVISION" | "BLOCKED";
  output?: DevWorkerLiteOutput;
  failure_category: DevWorkerLiteFailureCategory | "";
  errors: string[];
}

export function parseDevWorkerLiteOutput(finalResponse: string): ParsedDevWorkerLiteOutput {
  let parsed: unknown;
  try {
    parsed = JSON.parse(finalResponse) as unknown;
  } catch (error) {
    return {
      status: "NEEDS_REVISION",
      failure_category: "DEV_WORKER_OUTPUT_SCHEMA_FAILURE",
      errors: [`Dev worker lite output is not valid JSON: ${error instanceof Error ? error.message : String(error)}`]
    };
  }

  if (!isDevWorkerLiteOutput(parsed)) {
    return {
      status: "NEEDS_REVISION",
      failure_category: "DEV_WORKER_RESULT_SCHEMA_INVALID",
      errors: ["Dev worker lite output does not match the required flat DevResult shape."]
    };
  }

  return {
    status: parsed.status === "PASS" ? "PASS" : parsed.status,
    output: parsed,
    failure_category: "",
    errors: []
  };
}
