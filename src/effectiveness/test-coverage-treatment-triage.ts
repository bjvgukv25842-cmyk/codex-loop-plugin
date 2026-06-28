import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { M12RunResult, M12ValidationCommandResult } from "../../scripts/effectiveness/types.ts";
import type { GenericTestCoverageCheckpointState } from "./generic-test-coverage-checkpoint-state.ts";
import { buildValidationCommandResults, coverageContractPassed } from "./validation-command-evidence.ts";

export type TestCoverageTreatmentFailureCategory =
  | "TEST_COVERAGE_002_DEV_WORKER_TURN_NO_EVENT_TIMEOUT"
  | "TEST_COVERAGE_002_DEV_WORKER_POSTPROCESS_FAILED"
  | "TEST_COVERAGE_002_DEV_RESULT_MISSING"
  | "TEST_COVERAGE_002_VALIDATION_LOG_MISSING"
  | "TEST_COVERAGE_002_NPM_TEST_FAILED"
  | "TEST_COVERAGE_002_COVERAGE_CONTRACT_FAILED"
  | "TEST_COVERAGE_002_COVERAGE_CONTRACT_LOG_MISSING"
  | "TEST_COVERAGE_002_EVALUATOR_NOT_STARTED_AFTER_DEV"
  | "TEST_COVERAGE_002_CHECKPOINT_STATE_INVALID"
  | "TEST_COVERAGE_002_ARTIFACT_MAPPING_STALE"
  | "";

export interface TestCoverageTreatmentTriage {
  case_id: "test-coverage-002";
  baseline_status: string;
  treatment_status: string;
  planner_thread_id_present: boolean;
  dev_worker_thread_id_present: boolean;
  dev_worker_completed: boolean;
  dev_result_path: string;
  validation_log_paths: string[];
  validation_command_results: M12ValidationCommandResult[];
  npm_test_run: boolean;
  npm_test_passed: boolean;
  coverage_contract_run: boolean;
  coverage_contract_passed: boolean;
  initial_evaluator_started: boolean;
  first_failed_stage: string;
  failure_category_current: string;
  failure_category_corrected: TestCoverageTreatmentFailureCategory;
  can_recover_from_existing_evidence: boolean;
  requires_treatment_rerun: boolean;
  recommended_fixes: string[];
}

export function analyzeTestCoverage002Treatment(input: {
  baseline?: M12RunResult | null;
  treatment: M12RunResult;
  checkpoint_state?: GenericTestCoverageCheckpointState | null;
}): TestCoverageTreatmentTriage {
  const result = input.treatment;
  const validationLogPaths = existingValidationLogPaths(result);
  const validationResults = result.validation_command_results?.length
    ? result.validation_command_results
    : buildValidationCommandResults({
        commands: result.validation_commands,
        log_paths: validationLogPaths,
        validation_passed: result.validation_passed
      });
  const npmTest = validationResults.find((entry) => entry.command === "npm test");
  const coverage = validationResults.find((entry) => entry.command.includes("coverage:contract"));
  const devResultPath = resolveDevResultPath(result);
  const devResultExists = Boolean(devResultPath);
  const checkpointValid = input.checkpoint_state?.case_id === "test-coverage-002";
  const corrected = normalizeTestCoverage002TreatmentFailureCategory(result, input.checkpoint_state, validationResults);
  const firstFailedStage = firstFailedStageFor(corrected);
  const validationsPass = npmTest?.passed === true && coverage?.passed === true;
  const mappingStale = validationsPass && result.validation_passed === false;
  const sourceRisk = result.changed_files.some((file) => file.startsWith("src/") && file !== "src/cache.js");
  const canRecover = mappingStale &&
    devResultExists &&
    result.changed_files.includes("test/cache.test.js") &&
    !sourceRisk &&
    Boolean(result.initial_evaluator_thread_id || result.final_evaluator_thread_id || result.final_report_path);

  return {
    case_id: "test-coverage-002",
    baseline_status: input.baseline?.status ?? "",
    treatment_status: result.status,
    planner_thread_id_present: Boolean(result.planner_thread_id),
    dev_worker_thread_id_present: Boolean(result.dev_worker_thread_id),
    dev_worker_completed: devResultExists,
    dev_result_path: devResultPath,
    validation_log_paths: validationLogPaths,
    validation_command_results: validationResults,
    npm_test_run: Boolean(npmTest && npmTest.status !== "NOT_RUN"),
    npm_test_passed: npmTest?.passed === true,
    coverage_contract_run: Boolean(coverage && coverage.status !== "NOT_RUN"),
    coverage_contract_passed: coverage?.passed === true,
    initial_evaluator_started: Boolean(result.initial_evaluator_thread_id),
    first_failed_stage: firstFailedStage,
    failure_category_current: result.failure_category ?? "",
    failure_category_corrected: corrected,
    can_recover_from_existing_evidence: canRecover,
    requires_treatment_rerun: !canRecover,
    recommended_fixes: recommendedFixes(corrected, checkpointValid)
  };
}

export function normalizeTestCoverage002TreatmentFailureCategory(
  result: M12RunResult,
  checkpoint?: GenericTestCoverageCheckpointState | null,
  commandResults = result.validation_command_results ?? buildValidationCommandResults({
    commands: result.validation_commands,
    log_paths: existingValidationLogPaths(result),
    validation_passed: result.validation_passed
  })
): TestCoverageTreatmentFailureCategory {
  if (result.case_id !== "test-coverage-002" || result.variant !== "treatment") return "";
  if (checkpoint && checkpoint.case_id !== "test-coverage-002") return "TEST_COVERAGE_002_CHECKPOINT_STATE_INVALID";
  const devResultExists = Boolean(resolveDevResultPath(result));
  const devStatus = checkpoint?.dev_worker?.status ?? "";
  if (result.dev_worker_thread_id && !devResultExists && (devStatus === "TIMEOUT" || result.failure_category === "SDK_THREAD_TIMEOUT")) {
    return "TEST_COVERAGE_002_DEV_WORKER_TURN_NO_EVENT_TIMEOUT";
  }
  if (result.dev_worker_thread_id && !devResultExists) return "TEST_COVERAGE_002_DEV_RESULT_MISSING";
  if (result.dev_worker_thread_id && result.failure_category && /POSTPROCESS|SCHEMA|OUTPUT/i.test(result.failure_category)) {
    return "TEST_COVERAGE_002_DEV_WORKER_POSTPROCESS_FAILED";
  }
  if (devResultExists && existingValidationLogPaths(result).length === 0) return "TEST_COVERAGE_002_VALIDATION_LOG_MISSING";
  const npmTest = commandResults.find((entry) => entry.command === "npm test");
  if (npmTest?.status === "FAIL") return "TEST_COVERAGE_002_NPM_TEST_FAILED";
  const coverage = commandResults.find((entry) => entry.command.includes("coverage:contract"));
  if (coverage?.status === "FAIL") return "TEST_COVERAGE_002_COVERAGE_CONTRACT_FAILED";
  if (!coverage || coverage.status === "NOT_RUN") return "TEST_COVERAGE_002_COVERAGE_CONTRACT_LOG_MISSING";
  const validationsPass = npmTest?.passed === true && coverage.passed === true;
  if (validationsPass && result.validation_passed === false) return "TEST_COVERAGE_002_ARTIFACT_MAPPING_STALE";
  if (validationsPass && !result.initial_evaluator_thread_id) return "TEST_COVERAGE_002_EVALUATOR_NOT_STARTED_AFTER_DEV";
  return result.failure_category as TestCoverageTreatmentFailureCategory || "";
}

export function testCoverageTreatmentStageFromCategory(category: string): string {
  if (category.includes("CHECKPOINT")) return "checkpoint";
  if (category.includes("DEV_WORKER") || category.includes("DEV_RESULT")) return "dev_worker";
  if (category.includes("VALIDATION") || category.includes("NPM_TEST") || category.includes("COVERAGE_CONTRACT")) return "validation";
  if (category.includes("EVALUATOR")) return "evaluator";
  if (category.includes("ARTIFACT_MAPPING")) return "mapping";
  return "unknown";
}

export function existingValidationLogPaths(result: M12RunResult): string[] {
  const primary = result.validation_log_paths?.length ? result.validation_log_paths : result.validation_logs;
  return Array.from(new Set(primary))
    .filter((path) => path && existsSync(path));
}

export function attachTestCoverageValidationEvidence(result: M12RunResult): M12RunResult {
  if (result.case_id !== "test-coverage-002" || result.variant !== "treatment") return result;
  const validationLogPaths = existingValidationLogPaths(result);
  const parsedCommandResults = buildValidationCommandResults({
    commands: result.validation_commands,
    log_paths: validationLogPaths,
    validation_passed: result.validation_passed
  });
  const validationCommandResults = selectValidationCommandResults(result, parsedCommandResults);
  const checkpoint = readCheckpointState(result);
  const corrected = normalizeTestCoverage002TreatmentFailureCategory(result, checkpoint, validationCommandResults);
  return {
    ...result,
    validation_logs: validationLogPaths,
    validation_log_paths: validationLogPaths,
    validation_command_results: validationCommandResults,
    coverage_contract_passed: coverageContractPassed(validationCommandResults),
    first_failed_stage: result.first_failed_stage || testCoverageTreatmentStageFromCategory(corrected),
    corrected_failure_category: corrected,
    failure_category_was_stale_or_inconsistent: Boolean(result.failure_category && corrected && result.failure_category !== corrected)
  };
}

function selectValidationCommandResults(
  result: M12RunResult,
  parsedCommandResults: M12ValidationCommandResult[]
): M12ValidationCommandResult[] {
  const existing = result.validation_command_results ?? [];
  if (allRequiredCommandsPass(result.validation_commands, existing)) return existing;
  if (parsedCommandResults.every((entry) => Boolean(entry.log_path)) && allRequiredCommandsPass(result.validation_commands, parsedCommandResults)) {
    if (existing.length > 0 && result.validation_passed === true) {
      return parsedCommandResults.map((entry) => ({
        ...entry,
        failure_category: "VALIDATION_COMMAND_RESULT_MAPPING_MISMATCH",
        reason: `Parsed validation log superseded stale command result mapping: ${entry.reason ?? entry.evidence ?? ""}`.trim()
      }));
    }
    return parsedCommandResults;
  }
  return existing.length > 0 ? existing : parsedCommandResults;
}

function allRequiredCommandsPass(commands: string[], results: M12ValidationCommandResult[]): boolean {
  return commands.length > 0 && commands.every((command) => results.find((entry) => entry.command === command)?.passed === true);
}

export function readCheckpointState(result: M12RunResult): GenericTestCoverageCheckpointState | null {
  const path = result.checkpoint_state_path;
  if (!path || !existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as GenericTestCoverageCheckpointState;
  } catch {
    return null;
  }
}

function resolveDevResultPath(result: M12RunResult): string {
  const candidates = [
    result.artifacts.find((artifact) => artifact === "artifacts/dev-result.json") ?? "",
    result.fixture_repo ? resolve(result.fixture_repo, "artifacts/dev-result.json") : ""
  ].filter(Boolean);
  for (const path of candidates) {
    const absolute = path.startsWith("/") ? path : resolve(result.fixture_repo, path);
    if (existsSync(absolute)) return absolute;
  }
  return "";
}

function firstFailedStageFor(category: string): string {
  return testCoverageTreatmentStageFromCategory(category);
}

function recommendedFixes(category: string, checkpointValid: boolean): string[] {
  const fixes: string[] = [];
  if (!checkpointValid) fixes.push("Regenerate valid test-coverage-002 checkpoint state before regrade.");
  if (category === "TEST_COVERAGE_002_DEV_WORKER_TURN_NO_EVENT_TIMEOUT") {
    fixes.push("Shorten or split the generic test coverage dev-worker prompt, then run exactly one treatment-only fresh rerun after approval.");
  }
  if (category === "TEST_COVERAGE_002_DEV_RESULT_MISSING") {
    fixes.push("Ensure the dev worker writes artifacts/dev-result.json before evaluator dispatch.");
  }
  if (category === "TEST_COVERAGE_002_VALIDATION_LOG_MISSING" || category === "TEST_COVERAGE_002_COVERAGE_CONTRACT_LOG_MISSING") {
    fixes.push("Persist per-command validation logs for npm test and npm run coverage:contract.");
  }
  if (category === "TEST_COVERAGE_002_COVERAGE_CONTRACT_FAILED" || category === "TEST_COVERAGE_002_NPM_TEST_FAILED") {
    fixes.push("Keep the selected canary blocked until validation evidence passes in a treatment-only rerun.");
  }
  if (category === "TEST_COVERAGE_002_ARTIFACT_MAPPING_STALE") {
    fixes.push("Refresh treatment-result validation_command_results and coverage_contract_passed from existing logs, then regrade-only.");
  }
  if (fixes.length === 0) fixes.push("Review treatment evidence and keep production_ready=false until selected gate PASS evidence exists.");
  return fixes;
}
