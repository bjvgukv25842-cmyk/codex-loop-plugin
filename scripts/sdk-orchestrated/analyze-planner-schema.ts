import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { plannerLiteOutputSchema } from "../../src/orchestrator/planner-lite-output.ts";

type SchemaValue = Record<string, unknown> | unknown[];

interface SchemaMetrics {
  name: string;
  hash: string;
  schema_depth: number;
  property_count: number;
  required_count: number;
  enum_count: number;
  array_count: number;
  nested_object_count: number;
  ref_count: number;
  oneOf_count: number;
  anyOf_count: number;
  allOf_count: number;
  patternProperties_count: number;
  additionalProperties_usage: number;
  format_usage: number;
  default_usage: number;
  nullable_usage: number;
  description_total_chars: number;
  largest_property_path: string;
  suspected_unsupported_keywords: string[];
  high_risk_keywords_present: string[];
  complexity_score: number;
}

const repoRoot = process.cwd();
const reportDir = process.env.CODEX_LOOP_SDK_STARTUP_TRIAGE_DIR
  ? resolve(process.env.CODEX_LOOP_SDK_STARTUP_TRIAGE_DIR)
  : resolve(repoRoot, "evals/sdk-orchestrated/reports/sdk-startup-triage");
const analysisPath = resolve(reportDir, "planner-schema-analysis.json");
const reportPath = resolve(reportDir, "PlannerSchemaAnalysisReport.md");

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

function main(): void {
  const minimalSchema = readJson(resolve(reportDir, "planner-output-schema-cli-minimal.schema.json")) || minimalOutputSchema();
  const fullPlannerSchema = plannerSmokeSchema();
  const liteSchema = readJson(resolve(repoRoot, "evals/sdk-orchestrated/schemas/planner-lite-output.schema.json")) || plannerLiteOutputSchema;
  const schemas = [
    analyzeSchema("schema-output-minimal", minimalSchema),
    analyzeSchema("schema-output-planner", fullPlannerSchema),
    analyzeSchema("schema-output-lite", liteSchema)
  ];
  const analysis = {
    gate: "Gate 6B.1H Planner Schema Compatibility Repair",
    status: "PASS",
    generated_at: new Date().toISOString(),
    schemas,
    conclusion: conclude(schemas)
  };
  mkdirSync(dirname(analysisPath), { recursive: true });
  writeFileSync(analysisPath, `${JSON.stringify(analysis, null, 2)}\n`, "utf8");
  writeFileSync(reportPath, renderReport(analysis), "utf8");
  process.stdout.write(`${JSON.stringify(analysis, null, 2)}\n`);
}

export function analyzeSchema(name: string, schema: unknown): SchemaMetrics {
  const state = {
    maxDepth: 0,
    propertyCount: 0,
    requiredCount: 0,
    enumCount: 0,
    arrayCount: 0,
    nestedObjectCount: 0,
    refCount: 0,
    oneOfCount: 0,
    anyOfCount: 0,
    allOfCount: 0,
    patternPropertiesCount: 0,
    additionalPropertiesUsage: 0,
    formatUsage: 0,
    defaultUsage: 0,
    nullableUsage: 0,
    descriptionTotalChars: 0,
    largestPropertyPath: "",
    largestPropertyPathLength: 0,
    highRiskKeywordsPresent: new Set<string>()
  };
  walk(schema, "$", 0, state);
  const suspected = Array.from(state.highRiskKeywordsPresent).sort();
  const complexityScore =
    state.maxDepth * 5 +
    state.propertyCount +
    state.requiredCount +
    state.enumCount * 2 +
    state.arrayCount * 3 +
    state.nestedObjectCount * 3 +
    state.refCount * 8 +
    (state.oneOfCount + state.anyOfCount + state.allOfCount) * 10 +
    state.patternPropertiesCount * 10 +
    state.formatUsage * 4 +
    state.defaultUsage * 4 +
    state.nullableUsage * 4 +
    Math.ceil(state.descriptionTotalChars / 200);

  return {
    name,
    hash: stableHash(schema),
    schema_depth: state.maxDepth,
    property_count: state.propertyCount,
    required_count: state.requiredCount,
    enum_count: state.enumCount,
    array_count: state.arrayCount,
    nested_object_count: state.nestedObjectCount,
    ref_count: state.refCount,
    oneOf_count: state.oneOfCount,
    anyOf_count: state.anyOfCount,
    allOf_count: state.allOfCount,
    patternProperties_count: state.patternPropertiesCount,
    additionalProperties_usage: state.additionalPropertiesUsage,
    format_usage: state.formatUsage,
    default_usage: state.defaultUsage,
    nullable_usage: state.nullableUsage,
    description_total_chars: state.descriptionTotalChars,
    largest_property_path: state.largestPropertyPath,
    suspected_unsupported_keywords: suspected,
    high_risk_keywords_present: suspected,
    complexity_score: complexityScore
  };
}

function walk(value: unknown, path: string, depth: number, state: ReturnType<typeof createState>): void {
  state.maxDepth = Math.max(state.maxDepth, depth);
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      walk(item, `${path}[${index}]`, depth + 1, state);
    }
    return;
  }
  if (!isRecord(value)) {
    return;
  }
  if (value.type === "array") state.arrayCount += 1;
  if (value.type === "object" && depth > 0) state.nestedObjectCount += 1;
  for (const keyword of highRiskKeywords) {
    if (Object.prototype.hasOwnProperty.call(value, keyword)) {
      state.highRiskKeywordsPresent.add(keyword);
    }
  }
  if (isRecord(value.properties)) {
    const propertyKeys = Object.keys(value.properties);
    state.propertyCount += propertyKeys.length;
    for (const key of propertyKeys) {
      const propertyPath = `${path}.properties.${key}`;
      if (propertyPath.length > state.largestPropertyPathLength) {
        state.largestPropertyPathLength = propertyPath.length;
        state.largestPropertyPath = propertyPath;
      }
    }
  }
  if (Array.isArray(value.required)) state.requiredCount += value.required.length;
  if (Array.isArray(value.enum)) state.enumCount += 1;
  if (Object.prototype.hasOwnProperty.call(value, "$ref")) state.refCount += 1;
  if (Array.isArray(value.oneOf)) state.oneOfCount += 1;
  if (Array.isArray(value.anyOf)) state.anyOfCount += 1;
  if (Array.isArray(value.allOf)) state.allOfCount += 1;
  if (Object.prototype.hasOwnProperty.call(value, "patternProperties")) state.patternPropertiesCount += 1;
  if (Object.prototype.hasOwnProperty.call(value, "additionalProperties")) state.additionalPropertiesUsage += 1;
  if (Object.prototype.hasOwnProperty.call(value, "format")) state.formatUsage += 1;
  if (Object.prototype.hasOwnProperty.call(value, "default")) state.defaultUsage += 1;
  if (Object.prototype.hasOwnProperty.call(value, "nullable")) state.nullableUsage += 1;
  if (typeof value.description === "string") state.descriptionTotalChars += value.description.length;

  for (const [key, child] of Object.entries(value)) {
    walk(child, `${path}.${key}`, depth + 1, state);
  }
}

function createState() {
  return {
    maxDepth: 0,
    propertyCount: 0,
    requiredCount: 0,
    enumCount: 0,
    arrayCount: 0,
    nestedObjectCount: 0,
    refCount: 0,
    oneOfCount: 0,
    anyOfCount: 0,
    allOfCount: 0,
    patternPropertiesCount: 0,
    additionalPropertiesUsage: 0,
    formatUsage: 0,
    defaultUsage: 0,
    nullableUsage: 0,
    descriptionTotalChars: 0,
    largestPropertyPath: "",
    largestPropertyPathLength: 0,
    highRiskKeywordsPresent: new Set<string>()
  };
}

function minimalOutputSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      status: { type: "string", enum: ["PASS"] },
      message: { type: "string" }
    },
    required: ["status", "message"],
    additionalProperties: false
  };
}

function plannerSmokeSchema(): Record<string, unknown> {
  const taskGraphSchema = readJson(resolve(repoRoot, "schemas/task-graph.schema.json")) ?? { type: "object" };
  return {
    type: "object",
    properties: {
      status: { const: "PASS" },
      role: { const: "planner" },
      prd: {
        type: "object",
        description: "Full PRD object with nested product requirements, acceptance criteria, non-goals, risks, and metadata.",
        properties: {
          title: { type: "string", description: "Human-readable PRD title." },
          goal: { type: "string", description: "User goal normalized by the planner." },
          acceptance_criteria: { type: "array", items: { type: "string" } },
          non_goals: { type: "array", items: { type: "string" } },
          metadata: {
            type: "object",
            additionalProperties: true,
            description: "Planner metadata."
          }
        },
        required: ["title", "goal"],
        additionalProperties: true
      },
      task_graph: taskGraphSchema,
      acceptance_criteria: { type: "array", items: { type: "string" } },
      risks: { type: "array", items: { type: "string" } }
    },
    required: ["status", "role", "prd", "task_graph", "acceptance_criteria", "risks"],
    additionalProperties: true
  };
}

function conclude(schemas: SchemaMetrics[]): string {
  const planner = schemas.find((schema) => schema.name === "schema-output-planner");
  const lite = schemas.find((schema) => schema.name === "schema-output-lite");
  if (planner && lite && planner.complexity_score > lite.complexity_score) {
    return "planner-lite is lower complexity and should be used as SDK outputSchema; full TaskGraph validation remains in orchestrator post-processing.";
  }
  return "planner schema analysis completed; use post-processing validation before any Gate 6B smoke PASS claim.";
}

function renderReport(analysis: { schemas: SchemaMetrics[]; conclusion: string }): string {
  const lines = [
    "# Planner Schema Analysis",
    "",
    "Date: 2026-06-20",
    "",
    analysis.conclusion,
    ""
  ];
  for (const schema of analysis.schemas) {
    lines.push(
      `## ${schema.name}`,
      "",
      `Schema depth: ${schema.schema_depth}`,
      `Property count: ${schema.property_count}`,
      `Required count: ${schema.required_count}`,
      `Enum count: ${schema.enum_count}`,
      `Array count: ${schema.array_count}`,
      `Nested object count: ${schema.nested_object_count}`,
      `$ref count: ${schema.ref_count}`,
      `oneOf count: ${schema.oneOf_count}`,
      `anyOf count: ${schema.anyOf_count}`,
      `allOf count: ${schema.allOf_count}`,
      `patternProperties count: ${schema.patternProperties_count}`,
      `additionalProperties usage: ${schema.additionalProperties_usage}`,
      `format usage: ${schema.format_usage}`,
      `default usage: ${schema.default_usage}`,
      `nullable usage: ${schema.nullable_usage}`,
      `Description total chars: ${schema.description_total_chars}`,
      `Largest property path: ${schema.largest_property_path}`,
      `High risk keywords: ${schema.high_risk_keywords_present.join(", ") || "none"}`,
      `Complexity score: ${schema.complexity_score}`,
      ""
    );
  }
  return `${lines.join("\n")}\n`;
}

function readJson(path: string): unknown | null {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

function stableHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

main();
