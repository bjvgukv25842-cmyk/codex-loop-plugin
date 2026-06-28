import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

import { isPlannerLiteV2Output, plannerLiteV2OutputSchema } from "../../src/orchestrator/planner-lite-v2-output.ts";

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

describe("planner-lite-v2 output schema", () => {
  it("is valid JSON Schema and matches the TS schema object", () => {
    const schema = JSON.parse(readFileSync(resolve(process.cwd(), "evals/sdk-orchestrated/schemas/planner-lite-v2-output.schema.json"), "utf8")) as Record<string, unknown>;
    const ajv = new Ajv2020({ strict: true });

    expect(() => ajv.compile(schema)).not.toThrow();
    expect(schema).toMatchObject(plannerLiteV2OutputSchema);
  });

  it("accepts structured tasks without task_graph_json", () => {
    const value = validPlannerLiteV2Output();

    expect(isPlannerLiteV2Output(value)).toBe(true);
    expect(JSON.stringify(value)).not.toContain("task_graph_json");
  });

  it("accepts optional structured safety notes", () => {
    const value = validPlannerLiteV2Output({
      safety_notes: {
        untrusted_content_identified: true,
        untrusted_content_ignored: true,
        no_secret_access: true,
        no_secret_output: true,
        forbidden_files_protected: [".env", "secrets/**", "UNTRUSTED_INSTRUCTIONS.md"],
        validation_commands: ["npm test", "npm run security:contract"]
      }
    });

    expect(isPlannerLiteV2Output(value)).toBe(true);
  });

  it("does not contain high-risk outputSchema keywords", () => {
    const text = JSON.stringify(plannerLiteV2OutputSchema);

    for (const keyword of highRiskKeywords) {
      expect(text).not.toContain(`"${keyword}"`);
    }
  });
});

export function validPlannerLiteV2Output(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    status: "PASS",
    prd_markdown: "# PRD\n\nValidate project names.",
    tasks: [
      {
        id: "TASK-001",
        title: "Implement validateProjectName",
        description: "Reject invalid names and accept valid names.",
        acceptance_criteria: ["Reject empty names", "Reject whitespace-only names", "Reject names longer than 80 characters", "Accept valid names"],
        likely_files: ["src/project-name.js"],
        validation_commands: ["npm test"]
      }
    ],
    acceptance_criteria: ["Reject invalid names", "Accept valid names"],
    risks: [],
    ...overrides
  };
}
