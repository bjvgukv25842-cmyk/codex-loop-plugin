import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { loadM12Dataset } from "./dataset.ts";
import { readJson, writeJson, writeMarkdown } from "./io.ts";
import { resultPathForVariant } from "./m12-cli-args.ts";
import type { M12RunResult } from "./types.ts";
import type { SdkRepairLoopCheckpointState } from "../../src/orchestrator/sdk-repair-loop-types.ts";

interface TreatmentFailureTriage {
  case_id: "repair-loop-001";
  treatment_real_run_executed: boolean;
  treatment_status: string;
  failure_category: string;
  initial_dev_worker: {
    thread_started: boolean;
    thread_id: string;
    file_change_verified: boolean;
    baseline_tests_run: boolean;
    baseline_tests_passed: boolean;
    full_tests_run: boolean;
    full_tests_expected_to_fail: boolean;
    full_tests_failed: boolean;
    known_gap_seeded: boolean;
    dev_result_path: string;
    events_path: string;
    stdout_path: string;
    stderr_path: string;
  };
  path_mapping: {
    m12_run_dir: string;
    target_repo: string;
    checkpoint_state_path: string;
    gate6b2_runtime_reused: boolean;
  };
  resume_state_detected: boolean;
  stale_failed_checkpoint_detected: boolean;
  recommended_fixes: string[];
}

export function triageM12TreatmentFailure(): TreatmentFailureTriage {
  const testCase = loadM12Dataset().find((entry) => entry.case_id === "repair-loop-001");
  if (!testCase) throw new Error("repair-loop-001 not found in M12 dataset.");
  const result = readJson<M12RunResult | null>(resultPathForVariant("repair-loop-001", "treatment"), null);
  const statePath = "evals/effectiveness/reports/repair-loop-001/treatment-gate6b2-state.json";
  const state = readJson<SdkRepairLoopCheckpointState | null>(statePath, null);
  const runDir = "evals/effectiveness/runs/repair-loop-001/treatment";
  const targetRepo = result?.fixture_repo || resolve(runDir, "target-repo");
  const initialDev = initialDevEvidence(result, state);
  const failureCategory = normalizeFailureCategory(result?.failure_category || "", state, initialDev);
  const triage: TreatmentFailureTriage = {
    case_id: "repair-loop-001",
    treatment_real_run_executed: result?.real_run_executed ?? false,
    treatment_status: result?.status ?? "",
    failure_category: failureCategory,
    initial_dev_worker: initialDev,
    path_mapping: {
      m12_run_dir: runDir,
      target_repo: targetRepo,
      checkpoint_state_path: statePath,
      gate6b2_runtime_reused: usesGate6B2Runtime(result, state)
    },
    resume_state_detected: Boolean(result || state),
    stale_failed_checkpoint_detected: result?.status === "FAIL" || result?.status === "BLOCKED" || result?.status === "TIMEOUT" || state?.current_stage === "FAILED",
    recommended_fixes: recommendedFixes(failureCategory)
  };
  writeJson("evals/effectiveness/reports/repair-loop-001/treatment-failure-triage.json", triage);
  writeMarkdown("evals/effectiveness/reports/repair-loop-001/TreatmentFailureTriageReport.md", renderReport(triage));
  return triage;
}

function initialDevEvidence(
  result: M12RunResult | null,
  state: SdkRepairLoopCheckpointState | null
): TreatmentFailureTriage["initial_dev_worker"] {
  const fromResult = result?.initial_dev_worker;
  const stageDir = "evals/effectiveness/reports/repair-loop-001/sdk-stage-logs";
  const threadId = state?.dev_worker.thread_id || fromResult?.thread_id || result?.dev_worker_thread_id || "";
  return {
    thread_started: Boolean(threadId),
    thread_id: threadId,
    file_change_verified: state?.dev_worker.file_change_verified ?? fromResult?.file_change_verified ?? false,
    baseline_tests_run: fromResult?.baseline_tests_run ?? state?.dev_worker.baseline_tests_passed === true,
    baseline_tests_passed: state?.dev_worker.baseline_tests_passed ?? fromResult?.baseline_tests_passed ?? false,
    full_tests_run: fromResult?.full_tests_run ?? state?.dev_worker.full_tests_failed === true,
    full_tests_expected_to_fail: state?.dev_worker.full_tests_expected_to_fail ?? fromResult?.full_tests_expected_to_fail ?? false,
    full_tests_failed: state?.dev_worker.full_tests_failed ?? fromResult?.full_tests_failed ?? false,
    known_gap_seeded: state?.dev_worker.known_gap_seeded ?? fromResult?.known_gap_seeded ?? false,
    dev_result_path: state?.dev_worker.dev_result_path ?? fromResult?.dev_result_path ?? "",
    events_path: fromResult?.events_path ?? resolve(stageDir, "gate6b2-dev-worker-events.jsonl"),
    stdout_path: fromResult?.stdout_path ?? resolve(stageDir, "initial_dev_worker.stdout.log"),
    stderr_path: fromResult?.stderr_path ?? resolve(stageDir, "initial_dev_worker.stderr.log")
  };
}

function classifyFailure(
  state: SdkRepairLoopCheckpointState | null,
  initialDev: TreatmentFailureTriage["initial_dev_worker"]
): string {
  if (!state) return "CHECKPOINT_STATE_INVALID";
  if (!initialDev.thread_started) return "M12_TREATMENT_INITIAL_DEV_THREAD_MISSING";
  if (!initialDev.file_change_verified) return "M12_TREATMENT_INITIAL_DEV_NO_FILE_CHANGE";
  if (!initialDev.baseline_tests_passed) return "M12_TREATMENT_INITIAL_DEV_BASELINE_TESTS_FAILED";
  if (!initialDev.full_tests_expected_to_fail || !initialDev.full_tests_failed) return "M12_TREATMENT_INITIAL_DEV_FULL_TESTS_NOT_FAILED";
  if (!initialDev.dev_result_path) return "M12_TREATMENT_INITIAL_DEV_RESULT_MISSING";
  if (!initialDev.known_gap_seeded) return "M12_TREATMENT_INITIAL_DEV_ARTIFACT_MAPPING_MISSING";
  return state.current_stage === "FAILED" ? "M12_TREATMENT_STAGE_FAILED" : "M12_TREATMENT_PARTIAL_RESULT";
}

function normalizeFailureCategory(
  resultCategory: string,
  state: SdkRepairLoopCheckpointState | null,
  initialDev: TreatmentFailureTriage["initial_dev_worker"]
): string {
  if (!resultCategory || resultCategory === "INITIAL_DEV_WORKER_FAILED") {
    return classifyFailure(state, initialDev);
  }
  return resultCategory;
}

function usesGate6B2Runtime(result: M12RunResult | null, state: SdkRepairLoopCheckpointState | null): boolean {
  return Boolean(
    result?.runtime === "sdk-orchestrated" &&
    state?.gate === "Gate 6B.2 SDK-Orchestrated Repair Loop E2E" &&
    statePathLooksM12Scoped(state.target_repo)
  );
}

function statePathLooksM12Scoped(targetRepo: string): boolean {
  return targetRepo.includes("evals/effectiveness/runs/repair-loop-001/treatment") || existsSync(resolve(targetRepo));
}

function recommendedFixes(category: string): string[] {
  const fixes = ["Rerun treatment-only repair-loop-001 with --fresh after review; do not run additional cases."];
  if (category.startsWith("M12_TREATMENT_INITIAL_DEV")) {
    fixes.unshift("Keep M12 treatment fixture aligned with Gate 6B.2 baseline/full seeded-gap contract.");
  }
  if (category === "BLOCKED_M12_STALE_FAILED_CHECKPOINT" || category === "BLOCKED_M12_RESUME_FAILED_CHECKPOINT") {
    fixes.unshift("Clear the failed selected treatment checkpoint with --fresh before any approved rerun.");
  }
  return fixes;
}

function renderReport(triage: TreatmentFailureTriage): string {
  return [
    "# M12 repair-loop-001 Treatment Failure Triage",
    "",
    `Treatment real run executed: ${triage.treatment_real_run_executed}`,
    `Treatment status: ${triage.treatment_status}`,
    `Failure category: ${triage.failure_category}`,
    `Initial Dev Worker thread started: ${triage.initial_dev_worker.thread_started}`,
    `Initial Dev Worker thread id: ${triage.initial_dev_worker.thread_id}`,
    `Known gap seeded: ${triage.initial_dev_worker.known_gap_seeded}`,
    `Baseline tests passed: ${triage.initial_dev_worker.baseline_tests_passed}`,
    `Full tests failed as expected: ${triage.initial_dev_worker.full_tests_expected_to_fail && triage.initial_dev_worker.full_tests_failed}`,
    "",
    "## Paths",
    `Run dir: ${triage.path_mapping.m12_run_dir}`,
    `Target repo: ${triage.path_mapping.target_repo}`,
    `Checkpoint state: ${triage.path_mapping.checkpoint_state_path}`,
    `Gate 6B.2 runtime reused: ${triage.path_mapping.gate6b2_runtime_reused}`,
    "",
    "## Recommended Fixes",
    ...triage.recommended_fixes.map((entry) => `- ${entry}`),
    ""
  ].join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = triageM12TreatmentFailure();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
