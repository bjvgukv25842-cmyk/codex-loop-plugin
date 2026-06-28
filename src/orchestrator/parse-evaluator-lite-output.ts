export type EvaluatorLiteFailureCategory =
  | "EVALUATOR_LITE_OUTPUT_SCHEMA_FAILED"
  | "EVALUATOR_FINDINGS_JSON_INVALID";

export interface EvaluatorLiteOutput {
  status: "PASS" | "NEEDS_REVISION" | "BLOCKED";
  verdict: "PASS" | "NEEDS_REVISION";
  summary: string;
  findings_json: string;
  validation_commands_checked: string[];
}

export interface ParsedEvaluatorLiteOutput {
  status: "PASS" | "NEEDS_REVISION";
  output?: EvaluatorLiteOutput;
  findings: unknown[];
  failure_category: EvaluatorLiteFailureCategory | "";
  errors: string[];
}

export const evaluatorLiteOutputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["status", "verdict", "summary", "findings_json", "validation_commands_checked"],
  properties: {
    status: {
      type: "string",
      enum: ["PASS", "BLOCKED", "NEEDS_REVISION"]
    },
    verdict: {
      type: "string",
      enum: ["PASS", "NEEDS_REVISION"]
    },
    summary: {
      type: "string"
    },
    findings_json: {
      type: "string"
    },
    validation_commands_checked: {
      type: "array",
      items: {
        type: "string"
      }
    }
  }
} as const;

export function parseEvaluatorLiteOutput(text: string): ParsedEvaluatorLiteOutput {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return {
      status: "NEEDS_REVISION",
      findings: [],
      failure_category: "EVALUATOR_LITE_OUTPUT_SCHEMA_FAILED",
      errors: [`Evaluator output is not valid JSON: ${error instanceof Error ? error.message : String(error)}`]
    };
  }

  if (!isRecord(value)) {
    return {
      status: "NEEDS_REVISION",
      findings: [],
      failure_category: "EVALUATOR_LITE_OUTPUT_SCHEMA_FAILED",
      errors: ["Evaluator output must be a JSON object."]
    };
  }

  const errors: string[] = [];
  if (value.status !== "PASS" && value.status !== "NEEDS_REVISION" && value.status !== "BLOCKED") {
    errors.push("status must be PASS, NEEDS_REVISION, or BLOCKED.");
  }
  if (value.verdict !== "PASS" && value.verdict !== "NEEDS_REVISION") {
    errors.push("verdict must be PASS or NEEDS_REVISION.");
  }
  if (typeof value.summary !== "string") {
    errors.push("summary must be a string.");
  }
  if (typeof value.findings_json !== "string") {
    errors.push("findings_json must be a string.");
  }
  if (!Array.isArray(value.validation_commands_checked) || !value.validation_commands_checked.every((entry) => typeof entry === "string")) {
    errors.push("validation_commands_checked must be a string array.");
  }
  if (errors.length > 0) {
    return {
      status: "NEEDS_REVISION",
      findings: [],
      failure_category: "EVALUATOR_LITE_OUTPUT_SCHEMA_FAILED",
      errors
    };
  }

  const status = value.status as EvaluatorLiteOutput["status"];
  const verdict = value.verdict as EvaluatorLiteOutput["verdict"];
  const summary = value.summary as string;
  const findingsJson = value.findings_json as string;
  const validationCommandsChecked = value.validation_commands_checked as string[];
  const output: EvaluatorLiteOutput = {
    status,
    verdict,
    summary,
    findings_json: findingsJson,
    validation_commands_checked: validationCommandsChecked
  };

  const parsedFindings = parseFindingsJson(output.findings_json);
  if (!parsedFindings.ok) {
    return {
      status: "NEEDS_REVISION",
      output,
      findings: [],
      failure_category: "EVALUATOR_FINDINGS_JSON_INVALID",
      errors: parsedFindings.errors
    };
  }

  return {
    status: "PASS",
    output,
    findings: parsedFindings.findings,
    failure_category: "",
    errors: []
  };
}

function parseFindingsJson(text: string): { ok: true; findings: unknown[] } | { ok: false; errors: string[] } {
  const trimmed = text.trim();
  if (!trimmed) {
    return { ok: true, findings: [] };
  }
  try {
    const value = JSON.parse(trimmed) as unknown;
    if (!Array.isArray(value)) {
      return { ok: false, errors: ["findings_json must parse to an array."] };
    }
    return { ok: true, findings: value };
  } catch (error) {
    return {
      ok: false,
      errors: [`findings_json is not valid JSON: ${error instanceof Error ? error.message : String(error)}`]
    };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
