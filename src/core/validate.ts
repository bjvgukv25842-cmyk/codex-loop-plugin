import { Ajv2020, type AnySchemaObject, type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import { createRequire } from "node:module";

import { SchemaValidationError, type ValidationErrorDetail } from "./errors.ts";
import { listSchemas, loadSchema, type SchemaName } from "./schema-registry.ts";

export interface SchemaValidationResult {
  valid: boolean;
  errors: ValidationErrorDetail[];
}

const compiledValidators = new Map<SchemaName, ValidateFunction>();
let ajvInstance: Ajv2020 | undefined;
const require = createRequire(import.meta.url);
const addFormats = require("ajv-formats") as (ajv: Ajv2020) => Ajv2020;

function createAjv(): Ajv2020 {
  const ajv = new Ajv2020({
    allErrors: true,
    strict: true
  });

  addFormats(ajv);

  for (const schemaName of listSchemas()) {
    ajv.addSchema(loadSchema(schemaName) as AnySchemaObject);
  }

  return ajv;
}

function getAjv(): Ajv2020 {
  ajvInstance ??= createAjv();
  return ajvInstance;
}

function getValidator(schemaName: SchemaName): ValidateFunction {
  const cached = compiledValidators.get(schemaName);
  if (cached) {
    return cached;
  }

  const ajv = getAjv();
  const schema = loadSchema(schemaName);
  const validator = ajv.getSchema(schema.$id);

  if (!validator) {
    throw new Error(`Schema validator not found: ${schemaName}`);
  }

  compiledValidators.set(schemaName, validator);
  return validator;
}

function errorPath(error: ErrorObject): string {
  const basePath = error.instancePath || "/";
  const missingProperty = readStringParam(error.params, "missingProperty");

  if (error.keyword === "required" && missingProperty) {
    return basePath === "/" ? `/${missingProperty}` : `${basePath}/${missingProperty}`;
  }

  return basePath;
}

function readStringParam(params: Record<string, unknown>, key: string): string | undefined {
  const value = params[key];
  return typeof value === "string" ? value : undefined;
}

function normalizeErrors(schemaName: SchemaName, errors: ErrorObject[] | null | undefined): ValidationErrorDetail[] {
  return (errors ?? []).map((error) => ({
    schemaName,
    path: errorPath(error),
    message: error.message ?? "schema validation failed",
    keyword: error.keyword
  }));
}

function hasObjectShape(data: unknown): data is Record<string, unknown> {
  return typeof data === "object" && data !== null && !Array.isArray(data);
}

function hasNonEmptyString(data: Record<string, unknown>, key: string): boolean {
  return typeof data[key] === "string" && data[key].length > 0;
}

export function validateWithSchema(schemaName: SchemaName, data: unknown): SchemaValidationResult {
  const validator = getValidator(schemaName);
  const valid = validator(data);

  if (!valid) {
    return {
      valid: false,
      errors: normalizeErrors(schemaName, validator.errors)
    };
  }

  const businessResult = validateBusinessRules(schemaName, data);

  if (businessResult.valid) {
    return {
      valid: true,
      errors: []
    };
  }

  return {
    valid: false,
    errors: businessResult.errors
  };
}

export function assertValid(schemaName: SchemaName, data: unknown): void {
  const result = validateWithSchema(schemaName, data);

  if (!result.valid) {
    throw new SchemaValidationError(schemaName, result.errors);
  }
}

export function validateEvalReportBusinessRules(data: unknown): SchemaValidationResult {
  const errors: ValidationErrorDetail[] = [];

  if (!hasObjectShape(data)) {
    return {
      valid: false,
      errors: [
        {
          schemaName: "eval-report",
          path: "/",
          message: "EvalReport must be an object",
          keyword: "type"
        }
      ]
    };
  }

  if (data.verdict === "NEEDS_REVISION" && (!Array.isArray(data.findings) || data.findings.length === 0)) {
    errors.push({
      schemaName: "eval-report",
      path: "/findings",
      message: "NEEDS_REVISION eval reports must include at least one finding",
      keyword: "businessRule"
    });
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

export function validateContextCapsuleBusinessRules(data: unknown): SchemaValidationResult {
  const errors: ValidationErrorDetail[] = [];

  if (!hasObjectShape(data)) {
    return {
      valid: false,
      errors: [
        {
          schemaName: "context-capsule",
          path: "/",
          message: "ContextCapsule must be an object",
          keyword: "type"
        }
      ]
    };
  }

  for (const key of ["agent_id", "old_thread_id", "next_instruction"]) {
    if (!hasNonEmptyString(data, key)) {
      errors.push({
        schemaName: "context-capsule",
        path: `/${key}`,
        message: `${key} is required by ContextCapsule business rules`,
        keyword: "businessRule"
      });
    }
  }

  for (const key of ["open_issues", "completed_work"]) {
    if (!Array.isArray(data[key])) {
      errors.push({
        schemaName: "context-capsule",
        path: `/${key}`,
        message: `${key} must be present as an array`,
        keyword: "businessRule"
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

function validateBusinessRules(schemaName: SchemaName, data: unknown): SchemaValidationResult {
  if (schemaName === "eval-report") {
    return validateEvalReportBusinessRules(data);
  }

  if (schemaName === "context-capsule") {
    return validateContextCapsuleBusinessRules(data);
  }

  return {
    valid: true,
    errors: []
  };
}
