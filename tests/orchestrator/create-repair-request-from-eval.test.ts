import { describe, expect, it } from "vitest";

import { createRepairRequestFromEval } from "../../src/orchestrator/create-repair-request-from-eval.ts";
import type { EvalReport } from "../../src/core/types.ts";

describe("createRepairRequestFromEval", () => {
  it("creates schema-valid RepairRequest from NEEDS_REVISION EvalReport", () => {
    const result = createRepairRequestFromEval({
      eval_report: evalReport("NEEDS_REVISION"),
      now: "2026-06-21T00:00:00.000Z"
    });

    expect(result.status).toBe("PASS");
    expect(result.repair_request?.source_eval_id).toBe("eval_gate6b2_initial");
    expect(result.repair_request?.repair_instructions).toContain("Reject whitespace-only names.");
    expect(result.repair_request?.validation_commands).toContainEqual({ command: "npm test" });
  });

  it("rejects PASS EvalReport", () => {
    const result = createRepairRequestFromEval({ eval_report: evalReport("PASS") });

    expect(result.status).toBe("NEEDS_REVISION");
    expect(result.failure_category).toBe("REPAIR_REQUEST_NOT_CREATED");
  });
});

function evalReport(verdict: "PASS" | "NEEDS_REVISION"): EvalReport {
  const findings = verdict === "PASS" ? [] : [
    {
      finding_id: "finding_whitespace",
      severity: "high" as const,
      category: "correctness" as const,
      description: "Whitespace-only names are accepted.",
      evidence: [{ type: "file" as const, ref: "src/project-name.js" }],
      required_fix: "Reject whitespace-only names."
    }
  ];
  return {
    eval_id: "eval_gate6b2_initial",
    loop_run_id: "loop_gate6b2",
    task_id: "task_validate_project_name",
    module_id: "Gate6B2",
    evaluator_agent_id: "sdk-evaluator",
    verdict,
    confidence: 0.9,
    findings,
    required_fixes: findings.map((finding) => ({
      fix_id: "fix_whitespace",
      finding_ids: [finding.finding_id],
      instruction: "Reject whitespace-only names.",
      expected_files: [{ path: "src/project-name.js" }],
      validation_commands: [{ command: "npm test" }]
    })),
    validation_commands_checked: [{ command: "npm test" }],
    created_at: "2026-06-21T00:00:00.000Z",
    updated_at: "2026-06-21T00:00:00.000Z",
    metadata: {}
  };
}
