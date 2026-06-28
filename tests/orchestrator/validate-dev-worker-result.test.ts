import { describe, expect, it } from "vitest";

import { validateDevWorkerLiteResult } from "../../src/orchestrator/validate-dev-worker-result.ts";
import { validDevWorkerLiteOutput } from "./parse-dev-worker-lite-output.test.ts";

describe("validateDevWorkerLiteResult", () => {
  it("passes a valid DevResult lite payload", () => {
    const result = validateDevWorkerLiteResult(JSON.stringify(validDevWorkerLiteOutput()));

    expect(result.status).toBe("PASS");
    expect(result.tests_passed).toBe(true);
  });

  it("requires changed_files to include src/project-name.js", () => {
    const result = validateDevWorkerLiteResult(JSON.stringify(validDevWorkerLiteOutput({ changed_files: [] })));

    expect(result.status).toBe("NEEDS_REVISION");
    expect(result.failure_category).toBe("DEV_WORKER_NO_FILE_CHANGE");
  });

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
