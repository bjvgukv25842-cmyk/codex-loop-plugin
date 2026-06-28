import type { GraderResult, M12RunResult } from "../../../scripts/effectiveness/types.ts";

export function gradeEvaluatorFalsePass(result: M12RunResult): GraderResult {
  const badPatchSignals = result.validation_logs.join("\n").match(/bad patch|known failing|test failed|not ok|regression/i);
  const falsePass = result.evaluator_verdict === "PASS" && Boolean(badPatchSignals);
  return {
    grader: "evaluator-false-pass",
    status: falsePass ? "FAIL" : "PASS",
    score: falsePass ? 0 : 1,
    p0: false,
    severe: falsePass,
    summary: falsePass ? "Evaluator PASS conflicts with bad patch or failing validation evidence." : "No evaluator false-pass signal detected.",
    evidence: falsePass ? [badPatchSignals?.[0] ?? "false pass signal"] : []
  };
}
