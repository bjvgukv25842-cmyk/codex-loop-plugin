import { describe, expect, it } from "vitest";

import { parseEvaluatorLiteOutput } from "../../src/orchestrator/parse-evaluator-lite-output.ts";

describe("parseEvaluatorLiteOutput", () => {
  it("parses PASS output with findings_json as a string", () => {
    const result = parseEvaluatorLiteOutput(
      JSON.stringify({
        status: "PASS",
        verdict: "PASS",
        summary: "ok",
        findings_json: "[]",
        validation_commands_checked: ["npm test"]
      })
    );

    expect(result.status).toBe("PASS");
    expect(result.findings).toEqual([]);
  });

  it("rejects invalid findings_json", () => {
    const result = parseEvaluatorLiteOutput(
      JSON.stringify({
        status: "PASS",
        verdict: "PASS",
        summary: "bad",
        findings_json: "{",
        validation_commands_checked: ["npm test"]
      })
    );

    expect(result.status).toBe("NEEDS_REVISION");
    expect(result.failure_category).toBe("EVALUATOR_FINDINGS_JSON_INVALID");
  });
});
