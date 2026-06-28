import { describe, expect, it } from "vitest";

import type { EvalReport } from "../../src/core/types.ts";
import { hydrateEvalReport } from "../../src/orchestrator/hydrate-eval-report.ts";
import { validateEvalReportArtifact } from "../../src/orchestrator/validate-eval-report-artifacts.ts";

describe("validateEvalReportArtifact", () => {
  it("validates hydrated PASS EvalReport artifacts", () => {
    const hydrated = hydrateEvalReport({
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

    expect(hydrated.eval_report).toBeDefined();
    expect(validateEvalReportArtifact(hydrated.eval_report as EvalReport)).toEqual({
      status: "PASS",
      failure_category: "",
      errors: []
    });
  });
});
