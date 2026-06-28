import { describe, expect, it } from "vitest";

import { hydrateEvalReport } from "../../src/orchestrator/hydrate-eval-report.ts";

describe("hydrateEvalReport", () => {
  it("allows PASS reports with empty findings", () => {
    const result = hydrateEvalReport({
      loop_run_id: "loop_eval",
      task_id: "task_eval",
      evaluator_thread_id: "thread_eval",
      now: "2026-06-21T00:00:00.000Z",
      output: {
        status: "PASS",
        verdict: "PASS",
        summary: "ok",
        findings_json: "[]",
        validation_commands_checked: ["npm test"]
      },
      findings: []
    });

    expect(result.status).toBe("PASS");
    expect(result.eval_report?.verdict).toBe("PASS");
    expect(result.eval_report?.findings).toEqual([]);
    expect(result.eval_report?.validation_commands_checked).toEqual([{ command: "npm test" }]);
  });

  it("requires findings for NEEDS_REVISION reports", () => {
    const result = hydrateEvalReport({
      loop_run_id: "loop_eval",
      task_id: "task_eval",
      evaluator_thread_id: "thread_eval",
      output: {
        status: "NEEDS_REVISION",
        verdict: "NEEDS_REVISION",
        summary: "needs work",
        findings_json: "[]",
        validation_commands_checked: ["npm test"]
      },
      findings: []
    });

    expect(result.status).toBe("NEEDS_REVISION");
    expect(result.failure_category).toBe("EVALUATOR_LITE_POSTPROCESS_FAILED");
  });

  it("normalizes lightweight findings into canonical EvalFinding objects", () => {
    const result = hydrateEvalReport({
      loop_run_id: "loop_eval",
      task_id: "task_eval",
      evaluator_thread_id: "thread_eval",
      now: "2026-06-21T00:00:00.000Z",
      output: {
        status: "NEEDS_REVISION",
        verdict: "NEEDS_REVISION",
        summary: "needs work",
        findings_json: "[]",
        validation_commands_checked: ["npm test"]
      },
      findings: [
        {
          id: "finding_whitespace",
          severity: "high",
          category: "correctness",
          description: "Whitespace-only names still pass.",
          required_fix: "Reject whitespace-only names."
        }
      ]
    });

    expect(result.status).toBe("PASS");
    expect(result.eval_report?.findings[0]).toMatchObject({
      finding_id: "finding_whitespace",
      severity: "high",
      category: "correctness",
      required_fix: "Reject whitespace-only names."
    });
    expect(result.eval_report?.required_fixes[0]?.finding_ids).toEqual(["finding_whitespace"]);
  });
});
