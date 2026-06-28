import { describe, expect, it } from "vitest";

import { parseDevWorkerLiteOutput } from "../../src/orchestrator/parse-dev-worker-lite-output.ts";
import { validateDevWorkerLiteResult } from "../../src/orchestrator/validate-dev-worker-result.ts";

describe("parseDevWorkerLiteOutput", () => {
  it("parses valid DevResult lite output", () => {
    const result = parseDevWorkerLiteOutput(JSON.stringify(validDevWorkerLiteOutput()));

    expect(result.status).toBe("PASS");
    expect(result.failure_category).toBe("");
    expect(result.output).toEqual(expect.objectContaining({ tests_passed: true }));
  });

  it("classifies invalid JSON as DEV_WORKER_OUTPUT_SCHEMA_FAILURE", () => {
    const result = parseDevWorkerLiteOutput("{not json");

    expect(result.status).toBe("NEEDS_REVISION");
    expect(result.failure_category).toBe("DEV_WORKER_OUTPUT_SCHEMA_FAILURE");
  });

  it("classifies missing fields as DEV_WORKER_RESULT_SCHEMA_INVALID", () => {
    const result = parseDevWorkerLiteOutput(JSON.stringify({ status: "PASS" }));

    expect(result.status).toBe("NEEDS_REVISION");
    expect(result.failure_category).toBe("DEV_WORKER_RESULT_SCHEMA_INVALID");
  });
});

describe("validateDevWorkerLiteResult", () => {
  it("requires npm test evidence", () => {
    const result = validateDevWorkerLiteResult(JSON.stringify(validDevWorkerLiteOutput({ tests_run: [] })));

    expect(result.status).toBe("NEEDS_REVISION");
    expect(result.failure_category).toBe("DEV_WORKER_NO_TEST");
  });

  it("requires passing tests", () => {
    const result = validateDevWorkerLiteResult(JSON.stringify(validDevWorkerLiteOutput({ tests_passed: false })));

    expect(result.status).toBe("NEEDS_REVISION");
    expect(result.failure_category).toBe("DEV_WORKER_TESTS_FAILED");
  });
});

export function validDevWorkerLiteOutput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    status: "PASS",
    changed_files: ["src/project-name.js"],
    tests_run: ["npm test"],
    tests_passed: true,
    summary: "Fixed validateProjectName and tests pass.",
    ...overrides
  };
}
