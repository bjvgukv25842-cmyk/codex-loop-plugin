import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  clearM12ModeOutputs,
  inspectM12ModeCheckpoint,
  m12CasePaths,
  prepareM12RepairLoopFixture
} from "../../src/effectiveness/effectiveness-fixtures.ts";
import { runTreatmentSdkOrchestratedCanary, treatmentStageEnv } from "../../src/effectiveness/treatment-sdk-orchestrated-runner.ts";
import { loadM12Dataset } from "../../scripts/effectiveness/dataset.ts";
import { writeJson } from "../../scripts/effectiveness/io.ts";
import type { M12RunResult } from "../../scripts/effectiveness/types.ts";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("M12 treatment SDK-Orchestrated runner", () => {
  it("uses an isolated M12 case run dir and Gate 6B.2 env mapping", () => {
    const tempDir = tempRoot("m12-treatment-isolated-");
    const testCase = repairLoopCase();
    const paths = prepareM12RepairLoopFixture({ testCase, variant: "treatment", repoRoot: tempDir });
    const env = treatmentStageEnv(paths, tempDir, resolve(tempDir, ".codex-eval/sqlite"), {});

    expect(paths.target_repo).toBe(resolve(tempDir, "evals/effectiveness/runs/repair-loop-001/treatment/target-repo"));
    expect(env.CODEX_LOOP_GATE6B2_TARGET_REPO).toBe(paths.target_repo);
    expect(env.CODEX_LOOP_GATE6B2_STATE_PATH).toBe(resolve(paths.reports_dir, "treatment-gate6b2-state.json"));
    expect(env.CODEX_LOOP_PLANNER_OUTPUT_CONTRACT_VERSION).toBe("v2");
    expect(readFileSync(resolve(paths.target_repo, "package.json"), "utf8")).toContain("test:baseline");
    expect(existsSync(resolve(paths.target_repo, "test/project-name.baseline.test.js"))).toBe(true);
    expect(existsSync(resolve(paths.target_repo, "test/project-name.full.test.js"))).toBe(true);
  });

  it("maps a Gate 6B.2 PASS checkpoint into treatment-result.json fields", () => {
    const tempDir = tempRoot("m12-treatment-pass-");
    const testCase = repairLoopCase();
    const result = runTreatmentSdkOrchestratedCanary({
      testCase,
      repoRoot: tempDir,
      fresh: true,
      env: { CODEX_LOOP_ENABLE_M12_REAL_RUN: "1" },
      stageExecutor: (command) => {
        if (command.stage === "verify") {
          writeJson(command.env.CODEX_LOOP_GATE6B2_STATE_PATH!, mockGate6B2State("FINAL_REPORT_DONE"));
        }
        return { stage: command.stage, exit_code: 0, stdout: "{}", stderr: "" };
      }
    });

    expect(result.status).toBe("PASS");
    expect(result.dev_worker_thread_id).toBe("thread_dev_initial");
    expect(result.initial_dev_worker?.known_gap_seeded).toBe(true);
    expect(result.initial_dev_worker?.baseline_tests_passed).toBe(true);
    expect(result.initial_dev_worker?.full_tests_failed).toBe(true);
    expect(result.validation_passed).toBe(true);
  });

  it("returns a specific category when initial dev worker has no file change", () => {
    const tempDir = tempRoot("m12-treatment-no-change-");
    const testCase = repairLoopCase();
    const result = runTreatmentSdkOrchestratedCanary({
      testCase,
      repoRoot: tempDir,
      fresh: true,
      env: { CODEX_LOOP_ENABLE_M12_REAL_RUN: "1" },
      stageExecutor: (command) => {
        if (command.stage === "initial_dev_worker") {
          writeJson(command.env.CODEX_LOOP_GATE6B2_STATE_PATH!, mockGate6B2State("DEV_DONE", {
            dev_worker: {
              status: "PASS",
              thread_id: "thread_dev_initial",
              dev_result_path: "artifacts/dev-result.json",
              file_change_verified: false,
              baseline_tests_passed: true,
              full_tests_expected_to_fail: true,
              full_tests_failed: true,
              known_gap_seeded: true
            }
          }));
          return { stage: command.stage, exit_code: 2, stdout: "{\"dev_worker_thread_id\":\"thread_dev_initial\"}", stderr: "" };
        }
        return { stage: command.stage, exit_code: 0, stdout: "{}", stderr: "" };
      }
    });

    expect(result.status).toBe("BLOCKED");
    expect(result.failure_category).toBe("M12_TREATMENT_INITIAL_DEV_RESULT_MISSING");
    expect(result.initial_dev_worker?.thread_id).toBe("thread_dev_initial");
  });

  it("persists planner thread evidence when planner postprocess fails", () => {
    const tempDir = tempRoot("m12-treatment-planner-fail-");
    const testCase = repairLoopCase();
    const result = runTreatmentSdkOrchestratedCanary({
      testCase,
      repoRoot: tempDir,
      fresh: true,
      env: { CODEX_LOOP_ENABLE_M12_REAL_RUN: "1" },
      stageExecutor: (command) => {
        if (command.stage === "planner") {
          writeJson(command.env.CODEX_LOOP_GATE6B2_STATE_PATH!, mockGate6B2State("FAILED", {
            planner: {
              status: "NEEDS_REVISION",
              thread_id: "thread_planner_partial",
              prd_path: "",
              task_graph_path: "",
              planner_result_path: "",
              artifact_thread_evidence_verified: false,
              output_contract_version: "v2",
              raw_output_path: "reports/gate6b2-planner-stdout.log",
              redacted_output_path: "reports/gate6b2-planner-stdout-redacted.log",
              events_path: "reports/gate6b2-planner-events.jsonl",
              failure_category: "PLANNER_V2_TASKS_EMPTY",
              stage_completed: false
            },
            dev_worker: emptyDevWorkerCheckpoint(),
            initial_evaluator: emptyEvaluatorCheckpoint(),
            repair_request: emptyRepairRequestCheckpoint(),
            repair_dev_worker: emptyRepairDevWorkerCheckpoint(),
            final_evaluator: emptyEvaluatorCheckpoint(),
            final_report: { status: "", path: "" }
          }));
          return {
            stage: command.stage,
            exit_code: 2,
            stdout: JSON.stringify({
              planner_thread_id: "thread_planner_partial",
              failure_category: "PLANNER_V2_TASKS_EMPTY",
              planner_output_contract_version: "v2"
            }),
            stderr: ""
          };
        }
        return { stage: command.stage, exit_code: 0, stdout: "{}", stderr: "" };
      }
    });

    expect(result.status).toBe("BLOCKED");
    expect(result.failure_category).toBe("PLANNER_V2_TASKS_EMPTY");
    expect(result.real_run_executed).toBe(true);
    expect(result.planner_thread_id).toBe("thread_planner_partial");
    expect(result.planner_stage_attempted).toBe(true);
    expect(result.planner_stage_completed).toBe(false);
    expect(result.planner_output_contract_version).toBe("v2");
    expect(result.dev_worker_thread_id).toBe("");
  });

  it("blocks stale failed checkpoint unless --fresh is used", () => {
    const tempDir = tempRoot("m12-treatment-stale-");
    const testCase = repairLoopCase();
    const paths = m12CasePaths(testCase, "treatment", tempDir);
    writeJson(paths.result_path, {
      case_id: testCase.case_id,
      variant: "treatment",
      status: "BLOCKED",
      real_run_executed: true,
      errors: ["INITIAL_DEV_WORKER_FAILED"]
    });

    const blocked = runTreatmentSdkOrchestratedCanary({
      testCase,
      repoRoot: tempDir,
      env: { CODEX_LOOP_ENABLE_M12_REAL_RUN: "1" },
      stageExecutor: () => {
        throw new Error("stage should not run");
      }
    });

    expect(blocked.status).toBe("BLOCKED");
    expect(blocked.failure_category).toBe("BLOCKED_M12_STALE_FAILED_CHECKPOINT");
  });

  it("fresh clears only treatment mode outputs and leaves baseline result intact", () => {
    const tempDir = tempRoot("m12-treatment-fresh-");
    const testCase = repairLoopCase();
    const baseline = m12CasePaths(testCase, "baseline", tempDir);
    const treatment = m12CasePaths(testCase, "treatment", tempDir);
    writeJson(baseline.result_path, { status: "PASS", real_run_executed: true });
    writeJson(treatment.result_path, { status: "BLOCKED", real_run_executed: true });
    writeJson(resolve(treatment.reports_dir, "treatment-gate6b2-state.json"), { current_stage: "FAILED" });

    clearM12ModeOutputs(testCase, "treatment", tempDir);

    expect(existsSync(baseline.result_path)).toBe(true);
    expect(existsSync(treatment.result_path)).toBe(false);
    expect(inspectM12ModeCheckpoint(testCase, "treatment", tempDir).failed).toBe(false);
  });
});

function repairLoopCase() {
  return loadM12Dataset().find((entry) => entry.case_id === "repair-loop-001")!;
}

function tempRoot(prefix: string): string {
  const dir = mkdtempSync(resolve(tmpdir(), prefix));
  tempDirs.push(dir);
  mkdirSync(resolve(dir, "evals/effectiveness/datasets"), { recursive: true });
  writeFileSync(
    resolve(dir, "evals/effectiveness/datasets/m12-mini.jsonl"),
    readFileSync(resolve("/Users/litmus/Downloads/codex-loop-plugin/evals/effectiveness/datasets/m12-mini.jsonl"), "utf8"),
    "utf8"
  );
  return dir;
}

function mockGate6B2State(stage: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    gate: "Gate 6B.2 SDK-Orchestrated Repair Loop E2E",
    target_repo: "evals/effectiveness/runs/repair-loop-001/treatment/target-repo",
    current_stage: stage,
    planner: {
      status: "PASS",
      thread_id: "thread_planner",
      prd_path: "docs/PRD.md",
      task_graph_path: "docs/TASK_GRAPH.json",
      planner_result_path: "artifacts/planner-result.json",
      artifact_thread_evidence_verified: true
    },
    dev_worker: {
      status: "PASS",
      thread_id: "thread_dev_initial",
      dev_result_path: "artifacts/dev-result.json",
      file_change_verified: true,
      baseline_tests_passed: true,
      full_tests_expected_to_fail: true,
      full_tests_failed: true,
      known_gap_seeded: true
    },
    initial_evaluator: {
      status: "PASS",
      thread_id: "thread_eval_initial",
      eval_report_path: "artifacts/eval-report-needs-revision.json",
      eval_verdict: "NEEDS_REVISION"
    },
    repair_request: {
      status: "PASS",
      repair_request_path: "artifacts/repair-request.json",
      source_eval_report_path: "artifacts/eval-report-needs-revision.json",
      required_fixes_count: 1
    },
    repair_dev_worker: {
      status: "PASS",
      thread_id: "thread_dev_repair",
      repair_result_path: "artifacts/dev-repair-result.json",
      file_change_verified: true,
      tests_passed: true
    },
    final_evaluator: {
      status: "PASS",
      thread_id: "thread_eval_final",
      eval_report_path: "artifacts/eval-report-pass.json",
      eval_verdict: "PASS"
    },
    final_report: {
      status: "PASS",
      path: "artifacts/FinalDeliveryReport.md"
    },
    errors: [],
    ...overrides
  };
}

function emptyDevWorkerCheckpoint(): Record<string, unknown> {
  return {
    status: "",
    thread_id: "",
    dev_result_path: "",
    file_change_verified: false,
    baseline_tests_passed: false,
    full_tests_expected_to_fail: false,
    full_tests_failed: false,
    known_gap_seeded: false
  };
}

function emptyEvaluatorCheckpoint(): Record<string, unknown> {
  return {
    status: "",
    thread_id: "",
    eval_report_path: "",
    eval_verdict: ""
  };
}

function emptyRepairRequestCheckpoint(): Record<string, unknown> {
  return {
    status: "",
    repair_request_path: "",
    source_eval_report_path: "",
    required_fixes_count: 0
  };
}

function emptyRepairDevWorkerCheckpoint(): Record<string, unknown> {
  return {
    status: "",
    thread_id: "",
    repair_result_path: "",
    file_change_verified: false,
    tests_passed: false
  };
}
