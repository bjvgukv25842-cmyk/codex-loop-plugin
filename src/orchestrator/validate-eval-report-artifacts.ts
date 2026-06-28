import type { EvalReport } from "../core/types.ts";
import { validateWithSchema } from "../core/validate.ts";

export interface EvalReportArtifactValidationResult {
  status: "PASS" | "NEEDS_REVISION";
  failure_category: "EVALUATOR_LITE_POSTPROCESS_FAILED" | "";
  errors: string[];
}

export function validateEvalReportArtifact(report: EvalReport): EvalReportArtifactValidationResult {
  const validation = validateWithSchema("eval-report", report);
  if (validation.valid) {
    return {
      status: "PASS",
      failure_category: "",
      errors: []
    };
  }

  return {
    status: "NEEDS_REVISION",
    failure_category: "EVALUATOR_LITE_POSTPROCESS_FAILED",
    errors: validation.errors.map((error) => `${error.path}: ${error.message}`)
  };
}
