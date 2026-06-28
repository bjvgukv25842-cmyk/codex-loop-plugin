import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createSdkRepairLoopCheckpointState } from "../../src/orchestrator/sdk-repair-loop-checkpoint-state.ts";
import { writeFinalDeliveryReport } from "../../src/orchestrator/write-final-delivery-report.ts";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("writeFinalDeliveryReport", () => {
  it("writes report with all thread ids", () => {
    const dir = mkdtempSync(join(tmpdir(), "final-report-test-"));
    tempDirs.push(dir);
    const state = createSdkRepairLoopCheckpointState(dir);
    state.planner.thread_id = "thread_planner";
    state.dev_worker.thread_id = "thread_dev";
    state.initial_evaluator.thread_id = "thread_eval_initial";
    state.initial_evaluator.eval_verdict = "NEEDS_REVISION";
    state.repair_request.repair_request_path = "artifacts/repair-request.json";
    state.repair_request.required_fixes_count = 1;
    state.repair_dev_worker.thread_id = "thread_repair";
    state.repair_dev_worker.tests_passed = true;
    state.final_evaluator.thread_id = "thread_eval_final";
    state.final_evaluator.eval_verdict = "PASS";
    state.final_evaluator.eval_report_path = "artifacts/eval-report-pass.json";

    const outputPath = resolve(dir, "artifacts/FinalDeliveryReport.md");
    const result = writeFinalDeliveryReport({ state, target_repo: dir, output_path: outputPath });

    expect(result.status).toBe("PASS");
    expect(existsSync(outputPath)).toBe(true);
    expect(readFileSync(outputPath, "utf8")).toContain("thread_eval_final");
  });
});
