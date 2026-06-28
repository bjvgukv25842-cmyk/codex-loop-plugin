import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

import { plannerLiteOutputSchema } from "../../src/orchestrator/planner-lite-output.ts";

const highRiskKeywords = [
  "$ref",
  "oneOf",
  "anyOf",
  "allOf",
  "patternProperties",
  "dependencies",
  "dependentSchemas",
  "if",
  "then",
  "else",
  "unevaluatedProperties",
  "not",
  "default",
  "format",
  "nullable"
];

describe("planner-lite output schema", () => {
  it("is valid JSON Schema", () => {
    const schema = JSON.parse(readFileSync(resolve(process.cwd(), "evals/sdk-orchestrated/schemas/planner-lite-output.schema.json"), "utf8")) as Record<string, unknown>;
    const ajv = new Ajv2020({ strict: true });

    expect(() => ajv.compile(schema)).not.toThrow();
    expect(schema).toMatchObject(plannerLiteOutputSchema);
  });

  it("does not contain high-risk outputSchema keywords", () => {
    const text = JSON.stringify(plannerLiteOutputSchema);

    for (const keyword of highRiskKeywords) {
      expect(text).not.toContain(`"${keyword}"`);
    }
  });
});
