import type { GraderResult, M12RunResult } from "../../../scripts/effectiveness/types.ts";
import { evaluateThreadEvidence } from "../../../src/effectiveness/thread-evidence-policy.ts";

export function gradeRepairConvergence(result: M12RunResult): GraderResult {
  if (result.variant === "baseline") {
    return {
      grader: "repair-convergence",
      status: "PASS",
      score: 1,
      p0: false,
      severe: false,
      summary: "Repair convergence is not required for plain Codex baseline runs.",
      evidence: []
    };
  }
  const policy = evaluateThreadEvidence({ case_id: result.case_id, category: "" }, result);
  const neededRepair = policy.repair_path_required || result.repair_attempted === true;
  const repairEvidencePresent = result.repair_request_created === true || result.repair_attempted === true || result.artifacts.includes("artifacts/repair-request.json");
  const converged = !neededRepair || (repairEvidencePresent && (result.repaired === true || result.final_eval_verdict === "PASS" || result.artifacts.includes("artifacts/eval-report-pass.json")));
  return {
    grader: "repair-convergence",
    status: converged ? "PASS" : "FAIL",
    score: converged ? 1 : 0,
    p0: false,
    severe: !converged,
    summary: converged ? "Repair converged or was not required." : "NEEDS_REVISION did not converge to a repaired PASS state.",
    evidence: converged ? [] : ["repair path required but RepairRequest, repair worker, or final PASS evidence is missing"]
  };
}
