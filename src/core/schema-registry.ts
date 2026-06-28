import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface JsonSchemaDocument {
  $id: string;
  [key: string]: unknown;
}

export const SCHEMA_DEFINITIONS = [
  { name: "common", fileName: "common.schema.json" },
  { name: "loop-run", fileName: "loop-run.schema.json" },
  { name: "agent-profile", fileName: "agent-profile.schema.json" },
  { name: "task-node", fileName: "task-node.schema.json" },
  { name: "task-graph", fileName: "task-graph.schema.json" },
  { name: "artifact", fileName: "artifact.schema.json" },
  { name: "eval-report", fileName: "eval-report.schema.json" },
  { name: "repair-request", fileName: "repair-request.schema.json" },
  { name: "context-capsule", fileName: "context-capsule.schema.json" },
  { name: "module-progress", fileName: "module-progress.schema.json" },
  { name: "agent-run", fileName: "agent-run.schema.json" },
  { name: "subagent-evidence", fileName: "subagent-evidence.schema.json" },
  { name: "artifact-producer", fileName: "artifact-producer.schema.json" },
  { name: "sdk-thread-run", fileName: "sdk-thread-run.schema.json" }
] as const;

export type SchemaName = (typeof SCHEMA_DEFINITIONS)[number]["name"];

const schemaDirectory = join(dirname(fileURLToPath(import.meta.url)), "../../schemas");

export function listSchemas(): SchemaName[] {
  return SCHEMA_DEFINITIONS.map((definition) => definition.name);
}

export function getSchemaPath(schemaName: SchemaName): string {
  const definition = SCHEMA_DEFINITIONS.find((candidate) => candidate.name === schemaName);

  if (!definition) {
    throw new Error(`Unknown schema: ${schemaName}`);
  }

  return join(schemaDirectory, definition.fileName);
}

export function loadSchema(schemaName: SchemaName): JsonSchemaDocument {
  const schemaPath = getSchemaPath(schemaName);

  if (!existsSync(schemaPath)) {
    throw new Error(`Schema file not found: ${schemaPath}`);
  }

  const schema = JSON.parse(readFileSync(schemaPath, "utf8")) as unknown;

  if (!isJsonSchemaDocument(schema)) {
    throw new Error(`Schema file does not contain a string $id: ${schemaPath}`);
  }

  return schema;
}

function isJsonSchemaDocument(schema: unknown): schema is JsonSchemaDocument {
  if (typeof schema !== "object" || schema === null || Array.isArray(schema)) {
    return false;
  }

  const candidate = schema as Record<string, unknown>;
  return typeof candidate.$id === "string";
}
