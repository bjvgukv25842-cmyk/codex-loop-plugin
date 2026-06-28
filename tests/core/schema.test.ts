import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  listSchemas,
  loadSchema,
  validateContextCapsuleBusinessRules,
  validateEvalReportBusinessRules,
  validateWithSchema,
  assertValid,
  type SchemaName
} from "../../src/core/index.ts";

const fixtureRoot = join(process.cwd(), "tests", "fixtures");

function readJsonFixture(path: string): unknown {
  return JSON.parse(readFileSync(join(fixtureRoot, path), "utf8")) as unknown;
}

function readObjectFixture(path: string): Record<string, unknown> {
  const fixture = readJsonFixture(path);

  if (typeof fixture !== "object" || fixture === null || Array.isArray(fixture)) {
    throw new Error(`Expected object fixture: ${path}`);
  }

  return fixture as Record<string, unknown>;
}

describe("schema registry", () => {
  it("loads every core schema", () => {
    for (const schemaName of listSchemas()) {
      const schema = loadSchema(schemaName);
      expect(schema).toEqual(
        expect.objectContaining({
          $id: expect.any(String),
          title: expect.any(String),
          type: "object"
        })
      );
    }
  });

  it("lists every M1 schema", () => {
    expect(listSchemas()).toEqual<SchemaName[]>([
      "common",
      "loop-run",
      "agent-profile",
      "task-node",
      "task-graph",
      "artifact",
      "eval-report",
      "repair-request",
      "context-capsule",
      "module-progress",
      "agent-run",
      "subagent-evidence",
      "artifact-producer",
      "sdk-thread-run"
    ]);
  });
});

describe("schema validation", () => {
  it.each([
    ["loop-run", "valid/loop-run.json"],
    ["agent-profile", "valid/agent-profile.json"],
    ["task-graph", "valid/task-graph.json"],
    ["eval-report", "valid/eval-report-pass.json"],
    ["eval-report", "valid/eval-report-needs-revision.json"],
    ["context-capsule", "valid/context-capsule.json"]
  ] satisfies Array<[SchemaName, string]>)("accepts %s fixture %s", (schemaName, fixturePath) => {
    const fixture = readJsonFixture(fixturePath);
    expect(validateWithSchema(schemaName, fixture)).toEqual({
      valid: true,
      errors: []
    });
  });

  it("rejects an EvalReport missing verdict", () => {
    const fixture = readJsonFixture("invalid/eval-report-missing-verdict.json");
    const result = validateWithSchema("eval-report", fixture);

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "/verdict"
        })
      ])
    );
  });

  it("rejects a ContextCapsule missing next_instruction", () => {
    const fixture = readJsonFixture("invalid/context-capsule-missing-next-instruction.json");
    const result = validateWithSchema("context-capsule", fixture);

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "/next_instruction"
        })
      ])
    );
  });

  it("rejects NEEDS_REVISION EvalReport without findings through business validation", () => {
    const fixture = {
      ...readObjectFixture("valid/eval-report-pass.json"),
      verdict: "NEEDS_REVISION",
      findings: []
    };

    const result = validateEvalReportBusinessRules(fixture);

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual([
      expect.objectContaining({
        path: "/findings"
      })
    ]);
    expect(() => assertValid("eval-report", fixture)).toThrow(/eval-report validation failed/);
  });

  it("rejects ContextCapsule missing next_instruction through business validation", () => {
    const fixture = readJsonFixture("invalid/context-capsule-missing-next-instruction.json");
    const result = validateContextCapsuleBusinessRules(fixture);

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "/next_instruction"
        })
      ])
    );
    expect(() => assertValid("context-capsule", fixture)).toThrow(/context-capsule validation failed/);
  });
});
