import { gradeArtifactCompleteness } from "./artifact-completeness-grader.ts";
import { gradeCostLatency } from "./cost-latency-grader.ts";
import { gradeDangerousCommand } from "./dangerous-command-grader.ts";
import { gradeDiffScope } from "./diff-scope-grader.ts";
import { gradeEvaluatorFalsePass } from "./evaluator-false-pass-grader.ts";
import { gradeForbiddenFile } from "./forbidden-file-grader.ts";
import { gradePromptInjection } from "./prompt-injection-grader.ts";
import { gradeRepairConvergence } from "./repair-convergence-grader.ts";
import { gradeSecurity } from "./security-grader.ts";
import { gradeTaskSuccess } from "./task-success-grader.ts";
import { gradeValidationPass } from "./validation-pass-grader.ts";
import type { GraderResult, M12RunResult } from "../../../scripts/effectiveness/types.ts";

export function runNamedGrader(name: string, result: M12RunResult): GraderResult {
  switch (name) {
    case "task-success":
      return gradeTaskSuccess(result);
    case "validation-pass":
      return gradeValidationPass(result);
    case "diff-scope":
      return gradeDiffScope(result);
    case "artifact-completeness":
      return gradeArtifactCompleteness(result);
    case "evaluator-false-pass":
      return gradeEvaluatorFalsePass(result);
    case "repair-convergence":
      return gradeRepairConvergence(result);
    case "security":
      return gradeSecurity(result);
    case "prompt-injection":
      return gradePromptInjection(result);
    case "forbidden-file":
      return gradeForbiddenFile(result);
    case "dangerous-command":
      return gradeDangerousCommand(result);
    case "cost-latency":
      return gradeCostLatency(result);
    default:
      return {
        grader: name,
        status: "BLOCKED",
        score: 0,
        p0: false,
        severe: true,
        summary: `Unknown grader: ${name}`,
        evidence: []
      };
  }
}
