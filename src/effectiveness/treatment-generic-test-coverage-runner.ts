import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import type { EvalReport } from "../core/types.ts";
import { validateWithSchema } from "../core/validate.ts";
import { createRepairRequestFromEval } from "../orchestrator/create-repair-request-from-eval.ts";
import { devWorkerLiteOutputSchema } from "../orchestrator/dev-worker-lite-output.ts";
import { parseDevWorkerLiteOutput } from "../orchestrator/parse-dev-worker-lite-output.ts";
import { runEvaluatorLiteStage } from "../orchestrator/sdk-evaluator-stage.ts";
import { runPlannerLiteStage } from "../orchestrator/sdk-planner-lite-stage.ts";
import type { RuntimeAdapter } from "../runtime/runtime-adapter.ts";
import { ensureEvalSqliteHome } from "../runtime/eval-sqlite-home.ts";
import { SdkRuntimeAdapter } from "../runtime/sdk-runtime-adapter.ts";
import type { RuntimeThreadInput, RuntimeThreadResult } from "../runtime/runtime-types.ts";
import type { M12Case, M12RunResult } from "../../scripts/effectiveness/types.ts";
import { emptyGenericTestCoverageCheckpointState, type GenericTestCoverageCheckpointState } from "./generic-test-coverage-checkpoint-state.ts";
import { clearM12ModeOutputs, inspectM12ModeCheckpoint, prepareM12TestCoverageFixture, type M12CasePaths } from "./effectiveness-fixtures.ts";
import { getGenericTestCoverageCaseProfile, type GenericTestCoverageCaseProfile } from "./generic-test-coverage-case-profile.ts";
import { testCoveragePlannerStageConfig } from "./test-coverage-planner-stage.ts";
import { testCoverageEvaluatorStageConfig } from "./test-coverage-evaluator-stage.ts";
import { buildValidationCommandResults, coverageContractPassed } from "./validation-command-evidence.ts";

export const TEST_COVERAGE_002_DEV_WORKER_PROMPT_MAX_LENGTH = 520;

export interface GenericTestCoverageTreatmentOptions {
  testCase: M12Case;
  repoRoot?: string;
  resume?: boolean;
  fresh?: boolean;
  env?: NodeJS.ProcessEnv;
  runtime_adapter?: RuntimeAdapter;
  validation_runner?: ValidationRunner;
  now?: () => number;
}

export type ValidationRunner = (cwd: string, logPath: string, commands: string[]) => { passed: boolean; output: string };

interface TestCoverageDevWorkerStageResult {
  status: "PASS" | "NEEDS_REVISION" | "BLOCKED" | "TIMEOUT";
  failure_category: string;
  thread_id: string;
  file_change_verified: boolean;
  tests_run: string[];
  tests_passed: boolean;
  validation_command_results?: Array<{
    command: string;
    status: "PASS" | "FAIL" | "NOT_RUN";
    passed: boolean;
    log_path?: string;
    evidence?: string;
  }>;
  validation_log_paths?: string[];
  coverage_contract_passed?: boolean;
  dev_result_path: string;
  events_path: string;
  stdout_path: string;
  stderr_path: string;
  raw_output_path: string;
  redacted_output_path: string;
  last_event_type: string;
  elapsed_ms: number;
  event_count: number;
  prompt_length: number;
  prompt_hash: string;
  no_event_timeout: boolean;
  errors: string[];
}

interface GenericTestCoverageEvidence {
  planner_thread_id: string;
  dev_worker_thread_id: string;
  initial_evaluator_thread_id: string;
  repair_dev_worker_thread_id: string;
  final_evaluator_thread_id: string;
  initial_eval_verdict: "" | "PASS" | "NEEDS_REVISION";
  final_eval_verdict: "" | "PASS" | "NEEDS_REVISION";
  repair_request_created: boolean;
  validation_passed: boolean;
  artifacts: string[];
  final_report_path: string;
  stage_count: number;
  failure_category: string;
  dev_worker_events_path?: string;
  dev_worker_stdout_path?: string;
  dev_worker_stderr_path?: string;
  dev_worker_raw_output_path?: string;
  dev_worker_redacted_output_path?: string;
  dev_worker_last_event_type?: string;
  dev_worker_elapsed_ms?: number;
  dev_worker_event_count?: number;
  dev_worker_prompt_length?: number;
  dev_worker_prompt_hash?: string;
  dev_worker_no_event_timeout?: boolean;
  errors: string[];
}

export async function runGenericTestCoverageTreatment(options: GenericTestCoverageTreatmentOptions): Promise<M12RunResult> {
  const repoRoot = options.repoRoot ?? process.cwd();
  const env = options.env ?? process.env;
  const profile = getGenericTestCoverageCaseProfile(options.testCase);
  if (!profile) {
    return createGenericTestCoverageBlockedResult(options.testCase, [`Generic test coverage treatment does not support ${options.testCase.case_id}.`], "BLOCKED_TREATMENT_CASE_NOT_IMPLEMENTED");
  }
  const sqliteHome = ensureEvalSqliteHome(repoRoot, env);
  if (!sqliteHome.ok) {
    return createGenericTestCoverageBlockedResult(options.testCase, [sqliteHome.reason ?? "Eval sqlite home unavailable."], sqliteHome.reason ?? "BLOCKED_EVAL_SQLITE_HOME");
  }
  if (options.fresh) {
    clearM12ModeOutputs(options.testCase, "treatment", repoRoot);
  } else {
    const checkpoint = inspectM12ModeCheckpoint(options.testCase, "treatment", repoRoot);
    if (checkpoint.failed) {
      const category = options.resume ? "BLOCKED_M12_RESUME_FAILED_CHECKPOINT" : "BLOCKED_M12_STALE_FAILED_CHECKPOINT";
      return createGenericTestCoverageBlockedResult(options.testCase, [`${category}: existing treatment checkpoint/result is ${checkpoint.result_status || checkpoint.checkpoint_stage || "failed"}. Use --fresh for one approved rerun.`], category);
    }
  }

  const startedAt = options.now?.() ?? Date.now();
  let paths: M12CasePaths;
  try {
    paths = prepareM12TestCoverageFixture({ testCase: options.testCase, variant: "treatment", repoRoot, resume: options.resume });
  } catch (error) {
    const category = error instanceof Error ? error.message : "BLOCKED_TEST_COVERAGE_FIXTURE_PREPARE_FAILED";
    return createGenericTestCoverageBlockedResult(options.testCase, [category], category);
  }
  const adapter = options.runtime_adapter ?? new SdkRuntimeAdapter({ enableRealRun: true, repoRoot, preferStreamed: false });
  const evidence = await runGenericTestCoverageStages({
    testCase: options.testCase,
    profile,
    paths,
    repoRoot,
    sqliteHome: sqliteHome.path,
    adapter,
    env,
    validation_runner: options.validation_runner
  });
  const diff = captureDiff(paths.target_repo, paths.diff_path);
  const validationLog = resolve(paths.reports_dir, "treatment-validation.log");
  const validationLogPaths = existsSync(validationLog) ? [validationLog] : [];
  const validationCommandResults = buildValidationCommandResults({
    commands: options.testCase.validation_commands,
    log_paths: validationLogPaths,
    validation_passed: evidence.validation_passed
  });
  const status: M12RunResult["status"] = evidence.failure_category ? "BLOCKED" : "PASS";
  const threadIds = [
    evidence.planner_thread_id,
    evidence.dev_worker_thread_id,
    evidence.initial_evaluator_thread_id,
    evidence.repair_dev_worker_thread_id,
    evidence.final_evaluator_thread_id
  ].filter(Boolean);

  return {
    case_id: options.testCase.case_id,
    variant: "treatment",
    mode: "treatment",
    runtime: "sdk-orchestrated",
    status,
    real_run_executed: threadIds.length > 0,
    prompt: `$codex-loop\n\n${options.testCase.treatment_goal}`,
    fixture_repo: paths.target_repo,
    acceptance_criteria: options.testCase.acceptance_criteria,
    validation_commands: options.testCase.validation_commands,
    expected_artifacts: options.testCase.expected_artifacts,
    baseline_expected_artifacts: options.testCase.baseline_expected_artifacts,
    treatment_expected_artifacts: options.testCase.treatment_expected_artifacts ?? options.testCase.expected_artifacts,
    forbidden_files: options.testCase.forbidden_files,
    changed_files: diff.changed_files,
    artifacts: evidence.artifacts,
    validation_logs: validationLogPaths,
    validation_log_paths: validationLogPaths,
    validation_command_results: validationCommandResults,
    coverage_contract_passed: coverageContractPassed(validationCommandResults),
    evaluator_verdict: evidence.final_eval_verdict,
    initial_eval_verdict: evidence.initial_eval_verdict,
    final_eval_verdict: evidence.final_eval_verdict,
    repair_attempted: evidence.repair_request_created,
    repaired: evidence.validation_passed,
    repair_request_created: evidence.repair_request_created,
    p0_safety_issue: false,
    secret_leak_detected: detectSecretLeak([diff.patch, JSON.stringify(evidence)]),
    dangerous_command_detected: false,
    prompt_injection_followed: false,
    duration_ms: Math.max(0, Date.now() - startedAt),
    thread_count: threadIds.length,
    command_count: evidence.stage_count,
    planner_thread_id: evidence.planner_thread_id,
    planner_stage_attempted: Boolean(evidence.planner_thread_id),
    planner_stage_completed: Boolean(evidence.planner_thread_id && evidence.artifacts.includes("docs/PRD.md")),
    planner_output_contract_version: "v2",
    dev_worker_thread_id: evidence.dev_worker_thread_id,
    dev_worker_events_path: evidence.dev_worker_events_path,
    dev_worker_stdout_path: evidence.dev_worker_stdout_path,
    dev_worker_stderr_path: evidence.dev_worker_stderr_path,
    dev_worker_raw_output_path: evidence.dev_worker_raw_output_path,
    dev_worker_redacted_output_path: evidence.dev_worker_redacted_output_path,
    dev_worker_last_event_type: evidence.dev_worker_last_event_type,
    dev_worker_elapsed_ms: evidence.dev_worker_elapsed_ms,
    dev_worker_event_count: evidence.dev_worker_event_count,
    dev_worker_prompt_length: evidence.dev_worker_prompt_length,
    dev_worker_prompt_hash: evidence.dev_worker_prompt_hash,
    dev_worker_no_event_timeout: evidence.dev_worker_no_event_timeout,
    initial_evaluator_thread_id: evidence.initial_evaluator_thread_id,
    repair_dev_worker_thread_id: evidence.repair_dev_worker_thread_id,
    final_evaluator_thread_id: evidence.final_evaluator_thread_id,
    validation_passed: evidence.validation_passed,
    diff_path: paths.diff_path,
    final_report_path: evidence.final_report_path,
    artifact_thread_evidence_verified: evidence.artifacts.length > 0,
    danger_full_access_used: false,
    current_stage: status === "PASS" ? "FINAL_REPORT_DONE" : stageForFailure(evidence),
    last_completed_stage: status === "PASS" ? "FINAL_REPORT_DONE" : lastCompletedStageForFailure(evidence),
    first_failed_stage: status === "PASS" ? "" : firstFailedStageForEvidence(evidence),
    stage_timeline: buildGenericTestCoverageStageTimeline(evidence),
    checkpoint_state_path: resolve(paths.reports_dir, "treatment-generic-test-coverage-state.json"),
    failure_category: evidence.failure_category,
    errors: evidence.errors
  };
}

export function createGenericTestCoverageBlockedResult(testCase: M12Case, errors: string[], failureCategory: string): M12RunResult {
  return {
    case_id: testCase.case_id,
    variant: "treatment",
    mode: "treatment",
    runtime: "sdk-orchestrated",
    status: "BLOCKED",
    real_run_executed: false,
    prompt: `$codex-loop\n\n${testCase.treatment_goal}`,
    fixture_repo: testCase.fixture_repo,
    acceptance_criteria: testCase.acceptance_criteria,
    validation_commands: testCase.validation_commands,
    expected_artifacts: testCase.expected_artifacts,
    baseline_expected_artifacts: testCase.baseline_expected_artifacts,
    treatment_expected_artifacts: testCase.treatment_expected_artifacts ?? testCase.expected_artifacts,
    forbidden_files: testCase.forbidden_files,
    changed_files: [],
    artifacts: [],
    validation_logs: [],
    evaluator_verdict: "",
    initial_eval_verdict: "",
    final_eval_verdict: "",
    repair_attempted: false,
    repaired: false,
    repair_request_created: false,
    p0_safety_issue: false,
    secret_leak_detected: false,
    dangerous_command_detected: false,
    prompt_injection_followed: false,
    duration_ms: 0,
    thread_count: 0,
    command_count: 0,
    validation_passed: false,
    danger_full_access_used: false,
    artifact_thread_evidence_verified: false,
    failure_category: failureCategory,
    errors
  };
}

async function runGenericTestCoverageStages(input: {
  testCase: M12Case;
  profile: GenericTestCoverageCaseProfile;
  paths: M12CasePaths;
  repoRoot: string;
  sqliteHome: string;
  adapter: RuntimeAdapter;
  env: NodeJS.ProcessEnv;
  validation_runner?: ValidationRunner;
}): Promise<GenericTestCoverageEvidence> {
  const reportDir = resolve(input.paths.reports_dir, "sdk-stage-logs");
  const checkpointStatePath = resolve(input.paths.reports_dir, "treatment-generic-test-coverage-state.json");
  const validationLog = resolve(input.paths.reports_dir, "treatment-validation.log");
  const state = emptyGenericTestCoverageCheckpointState(input.profile.case_id);
  writeCheckpoint(checkpointStatePath, state);
  const loopRunId = `loop_m12_${idSafe(input.testCase.case_id)}`;
  const taskId = `task_${idSafe(input.testCase.case_id)}`;
  const artifacts: string[] = [];
  let stageCount = 0;
  const plannerConfig = testCoveragePlannerStageConfig(input.testCase);
  const evaluatorConfig = testCoverageEvaluatorStageConfig({
    testCase: input.testCase,
    prd_path: "docs/PRD.md",
    task_graph_path: "docs/TASK_GRAPH.json",
    dev_result_path: "artifacts/dev-result.json",
    test_log_path: validationLog,
    diff_path: input.paths.diff_path
  });

  const planner = await runPlannerLiteStage({
    loop_run_id: loopRunId,
    task_id: taskId,
    target_repo: input.paths.target_repo,
    model: input.env.CODEX_LOOP_CODEX_MODEL,
    model_catalog_json: input.env.CODEX_LOOP_MODEL_CATALOG_JSON,
    sqlite_home: input.sqliteHome,
    sandbox: "read-only",
    timeout_ms: 180_000,
    runtime_adapter: input.adapter,
    repo_root: input.paths.target_repo,
    report_dir: reportDir,
    output_contract_version: plannerConfig.output_contract_version,
    prompt_override: plannerConfig.prompt,
    root_goal: plannerConfig.root_goal,
    default_validation_commands: plannerConfig.default_validation_commands,
    default_likely_files: plannerConfig.default_likely_files,
    invocation_trace_label: "m12-test-coverage-planner",
    invocation_trace_path: resolve(reportDir, "generic-test-coverage-planner-invocation-trace-redacted.json"),
    events_path: resolve(reportDir, "generic-test-coverage-planner-events.jsonl"),
    stdout_path: resolve(reportDir, "generic-test-coverage-planner-stdout.log"),
    stderr_path: resolve(reportDir, "generic-test-coverage-planner-stderr.log")
  });
  stageCount += 1;
  state.planner = {
    status: planner.status,
    thread_id: planner.planner_thread_id,
    prd_path: planner.prd_path,
    task_graph_path: planner.task_graph_path,
    planner_result_path: planner.planner_result_path,
    stage_attempted: true,
    stage_completed: planner.status === "PASS",
    output_contract_version: planner.output_contract_version,
    raw_output_path: planner.raw_output_path,
    redacted_output_path: planner.redacted_output_path,
    events_path: planner.events_path,
    stdout_path: resolve(reportDir, "generic-test-coverage-planner-stdout.log"),
    stderr_path: resolve(reportDir, "generic-test-coverage-planner-stderr.log"),
    last_event_type: planner.last_event_type,
    elapsed_ms: planner.elapsed_ms,
    event_count: planner.event_count,
    failure_category: planner.status === "PASS" ? "" : planner.failure_category || "TEST_COVERAGE_TREATMENT_PLANNER_FAILED"
  };
  if (planner.status !== "PASS") {
    state.current_stage = "FAILED";
    state.errors = planner.errors;
    writeCheckpoint(checkpointStatePath, state);
    return failedEvidence({
      planner_thread_id: planner.planner_thread_id,
      artifacts,
      stage_count: stageCount,
      failure_category: state.planner.failure_category || "TEST_COVERAGE_TREATMENT_PLANNER_FAILED",
      errors: planner.errors
    });
  }
  state.current_stage = "PLANNER_DONE";
  writeCheckpoint(checkpointStatePath, state);
  artifacts.push(planner.prd_path, planner.task_graph_path, planner.planner_result_path);

  const devWorker = await runTestCoverageDevWorkerStage({
    profile: input.profile,
    loop_run_id: loopRunId,
    task_id: taskId,
    target_repo: input.paths.target_repo,
    prd_path: planner.prd_path,
    task_graph_path: planner.task_graph_path,
    model: input.env.CODEX_LOOP_CODEX_MODEL,
    model_catalog_json: input.env.CODEX_LOOP_MODEL_CATALOG_JSON,
    sqlite_home: input.sqliteHome,
    adapter: input.adapter,
    report_dir: reportDir,
    validation_log_path: validationLog,
    validation_runner: input.validation_runner,
    artifact_path: "artifacts/dev-result.json"
  });
  stageCount += 1;
  state.current_stage = devWorker.status === "PASS" ? "DEV_WORKER_DONE" : devWorker.thread_id ? "DEV_WORKER_STARTED" : "DEV_WORKER_FAILED";
  state.dev_worker = {
    status: devWorker.status,
    thread_id: devWorker.thread_id,
    file_change_verified: devWorker.file_change_verified,
    tests_passed: devWorker.tests_passed,
    dev_result_path: devWorker.dev_result_path,
    events_path: devWorker.events_path,
    stdout_path: devWorker.stdout_path,
    stderr_path: devWorker.stderr_path,
    raw_output_path: devWorker.raw_output_path,
    redacted_output_path: devWorker.redacted_output_path,
    last_event_type: devWorker.last_event_type,
    elapsed_ms: devWorker.elapsed_ms,
    event_count: devWorker.event_count,
    prompt_length: devWorker.prompt_length,
    prompt_hash: devWorker.prompt_hash,
    no_event_timeout: devWorker.no_event_timeout,
    failure_category: devWorker.failure_category,
    validation_command_results: devWorker.validation_command_results,
    validation_log_paths: devWorker.validation_log_paths,
    coverage_contract_passed: devWorker.coverage_contract_passed
  };
  if (devWorker.status !== "PASS") {
    state.current_stage = devWorker.thread_id ? "DEV_WORKER_STARTED" : "DEV_WORKER_FAILED";
    state.errors = devWorker.errors;
    writeCheckpoint(checkpointStatePath, state);
    return failedEvidence({
      planner_thread_id: planner.planner_thread_id,
      dev_worker_thread_id: devWorker.thread_id,
      artifacts,
      stage_count: stageCount,
      failure_category: devWorker.failure_category || "TEST_COVERAGE_TREATMENT_DEV_WORKER_FAILED",
      dev_worker_events_path: devWorker.events_path,
      dev_worker_stdout_path: devWorker.stdout_path,
      dev_worker_stderr_path: devWorker.stderr_path,
      dev_worker_raw_output_path: devWorker.raw_output_path,
      dev_worker_redacted_output_path: devWorker.redacted_output_path,
      dev_worker_last_event_type: devWorker.last_event_type,
      dev_worker_elapsed_ms: devWorker.elapsed_ms,
      dev_worker_event_count: devWorker.event_count,
      dev_worker_prompt_length: devWorker.prompt_length,
      dev_worker_prompt_hash: devWorker.prompt_hash,
      dev_worker_no_event_timeout: devWorker.no_event_timeout,
      errors: devWorker.errors
    });
  }
  state.current_stage = "DEV_WORKER_DONE";
  writeCheckpoint(checkpointStatePath, state);
  artifacts.push(devWorker.dev_result_path);
  captureDiff(input.paths.target_repo, input.paths.diff_path);

  const evaluator = await runEvaluatorLiteStage({
    loop_run_id: loopRunId,
    task_id: taskId,
    target_repo: input.paths.target_repo,
    prd_path: planner.prd_path,
    task_graph_path: planner.task_graph_path,
    dev_result_path: devWorker.dev_result_path,
    model: input.env.CODEX_LOOP_CODEX_MODEL,
    model_catalog_json: input.env.CODEX_LOOP_MODEL_CATALOG_JSON,
    sqlite_home: input.sqliteHome,
    sandbox: "read-only",
    timeout_ms: 180_000,
    runtime_adapter: input.adapter,
    repo_root: input.paths.target_repo,
    report_dir: reportDir,
    artifact_path: "artifacts/eval-report.json",
    prompt_override: evaluatorConfig.prompt,
    sdk_method: "run",
    test_log_path: validationLog,
    diff_path: input.paths.diff_path,
    invocation_trace_label: "m12-test-coverage-evaluator",
    invocation_trace_path: resolve(reportDir, "generic-test-coverage-evaluator-invocation-trace-redacted.json"),
    events_path: resolve(reportDir, "generic-test-coverage-evaluator-events.jsonl"),
    stdout_path: resolve(reportDir, "generic-test-coverage-evaluator-stdout.log"),
    stderr_path: resolve(reportDir, "generic-test-coverage-evaluator-stderr.log")
  });
  stageCount += 1;
  state.evaluator = {
    status: evaluator.status,
    thread_id: evaluator.evaluator_thread_id,
    eval_verdict: evaluator.eval_verdict,
    eval_report_path: evaluator.eval_report_path
  };
  artifacts.push(evaluator.eval_report_path);
  if (evaluator.status === "PASS" && evaluator.eval_verdict === "PASS") {
    if (!evaluatorCheckedCoverageContract(input.paths.target_repo, evaluator.eval_report_path)) {
      state.current_stage = "FAILED";
      state.errors = ["Evaluator PASS did not include npm run coverage:contract in validation_commands_checked."];
      writeCheckpoint(checkpointStatePath, state);
      return failedEvidence({
        planner_thread_id: planner.planner_thread_id,
        dev_worker_thread_id: devWorker.thread_id,
        initial_evaluator_thread_id: evaluator.evaluator_thread_id,
        artifacts,
        stage_count: stageCount,
        failure_category: "TEST_COVERAGE_EVALUATOR_NO_COVERAGE_CONTRACT_EVIDENCE",
        errors: state.errors
      });
    }
    const finalReportPath = writeGenericTestCoverageFinalReport({
      targetRepo: input.paths.target_repo,
      profile: input.profile,
      plannerThreadId: planner.planner_thread_id,
      devWorkerThreadId: devWorker.thread_id,
      initialEvaluatorThreadId: evaluator.evaluator_thread_id,
      repairDevWorkerThreadId: "",
      finalEvaluatorThreadId: evaluator.evaluator_thread_id,
      initialEvalVerdict: "PASS",
      finalEvalVerdict: "PASS",
      validationPassed: devWorker.tests_passed,
      changedFiles: captureDiff(input.paths.target_repo, input.paths.diff_path).changed_files
    });
    artifacts.push(finalReportPath);
    state.current_stage = "FINAL_REPORT_DONE";
    state.final_report = { status: "PASS", path: finalReportPath };
    writeCheckpoint(checkpointStatePath, state);
    return {
      planner_thread_id: planner.planner_thread_id,
      dev_worker_thread_id: devWorker.thread_id,
      initial_evaluator_thread_id: evaluator.evaluator_thread_id,
      repair_dev_worker_thread_id: "",
      final_evaluator_thread_id: evaluator.evaluator_thread_id,
      initial_eval_verdict: "PASS",
      final_eval_verdict: "PASS",
      repair_request_created: false,
      validation_passed: devWorker.tests_passed,
      artifacts,
      final_report_path: finalReportPath,
      stage_count: stageCount,
      failure_category: devWorker.tests_passed ? "" : "TEST_COVERAGE_VALIDATION_FAILED",
      errors: devWorker.tests_passed ? [] : ["Dev worker validation did not pass."]
    };
  }
  if (evaluator.status !== "NEEDS_REVISION" || evaluator.eval_verdict !== "NEEDS_REVISION") {
    state.current_stage = "FAILED";
    state.errors = evaluator.errors;
    writeCheckpoint(checkpointStatePath, state);
    return failedEvidence({
      planner_thread_id: planner.planner_thread_id,
      dev_worker_thread_id: devWorker.thread_id,
      initial_evaluator_thread_id: evaluator.evaluator_thread_id,
      artifacts,
      stage_count: stageCount,
      failure_category: evaluator.failure_category || "TEST_COVERAGE_TREATMENT_EVALUATOR_FAILED",
      errors: evaluator.errors
    });
  }
  state.current_stage = "EVALUATOR_DONE";
  writeCheckpoint(checkpointStatePath, state);

  const repairCreated = createTestCoverageRepairRequest(input.paths.target_repo, evaluator.eval_report_path, input.testCase.case_id, input.profile);
  if (repairCreated.status !== "PASS") {
    state.current_stage = "FAILED";
    state.errors = repairCreated.errors;
    writeCheckpoint(checkpointStatePath, state);
    return failedEvidence({ planner_thread_id: planner.planner_thread_id, dev_worker_thread_id: devWorker.thread_id, initial_evaluator_thread_id: evaluator.evaluator_thread_id, artifacts, stage_count: stageCount, failure_category: repairCreated.failure_category, errors: repairCreated.errors });
  }
  state.current_stage = "REPAIR_REQUEST_CREATED";
  state.repair_request = { status: "PASS", repair_request_path: "artifacts/repair-request.json" };
  writeCheckpoint(checkpointStatePath, state);
  artifacts.push("artifacts/repair-request.json");

  const repairDevWorker = await runTestCoverageDevWorkerStage({
    profile: input.profile,
    loop_run_id: loopRunId,
    task_id: taskId,
    target_repo: input.paths.target_repo,
    prd_path: planner.prd_path,
    task_graph_path: "artifacts/repair-request.json",
    model: input.env.CODEX_LOOP_CODEX_MODEL,
    model_catalog_json: input.env.CODEX_LOOP_MODEL_CATALOG_JSON,
    sqlite_home: input.sqliteHome,
    adapter: input.adapter,
    report_dir: reportDir,
    validation_log_path: validationLog,
    validation_runner: input.validation_runner,
    artifact_path: "artifacts/repair-result.json"
  });
  stageCount += 1;
  state.repair_dev_worker = {
    status: repairDevWorker.status,
    thread_id: repairDevWorker.thread_id,
    file_change_verified: repairDevWorker.file_change_verified,
    tests_passed: repairDevWorker.tests_passed,
    repair_result_path: repairDevWorker.dev_result_path
  };
  if (repairDevWorker.status !== "PASS") {
    state.current_stage = "FAILED";
    state.errors = repairDevWorker.errors;
    writeCheckpoint(checkpointStatePath, state);
    return failedEvidence({ planner_thread_id: planner.planner_thread_id, dev_worker_thread_id: devWorker.thread_id, initial_evaluator_thread_id: evaluator.evaluator_thread_id, repair_dev_worker_thread_id: repairDevWorker.thread_id, artifacts, stage_count: stageCount, failure_category: repairDevWorker.failure_category || "TEST_COVERAGE_TREATMENT_REPAIR_DEV_WORKER_FAILED", errors: repairDevWorker.errors });
  }
  state.current_stage = "REPAIR_DONE";
  writeCheckpoint(checkpointStatePath, state);
  artifacts.push(repairDevWorker.dev_result_path);
  captureDiff(input.paths.target_repo, input.paths.diff_path);

  const finalEvaluator = await runEvaluatorLiteStage({
    loop_run_id: loopRunId,
    task_id: taskId,
    target_repo: input.paths.target_repo,
    prd_path: planner.prd_path,
    task_graph_path: planner.task_graph_path,
    dev_result_path: repairDevWorker.dev_result_path,
    model: input.env.CODEX_LOOP_CODEX_MODEL,
    model_catalog_json: input.env.CODEX_LOOP_MODEL_CATALOG_JSON,
    sqlite_home: input.sqliteHome,
    sandbox: "read-only",
    timeout_ms: 180_000,
    runtime_adapter: input.adapter,
    repo_root: input.paths.target_repo,
    report_dir: reportDir,
    artifact_path: "artifacts/final-eval-report.json",
    prompt_override: evaluatorConfig.prompt,
    sdk_method: "run",
    test_log_path: validationLog,
    diff_path: input.paths.diff_path,
    invocation_trace_label: "m12-test-coverage-final-evaluator",
    invocation_trace_path: resolve(reportDir, "generic-test-coverage-final-evaluator-invocation-trace-redacted.json"),
    events_path: resolve(reportDir, "generic-test-coverage-final-evaluator-events.jsonl"),
    stdout_path: resolve(reportDir, "generic-test-coverage-final-evaluator-stdout.log"),
    stderr_path: resolve(reportDir, "generic-test-coverage-final-evaluator-stderr.log")
  });
  stageCount += 1;
  state.final_evaluator = {
    status: finalEvaluator.status,
    thread_id: finalEvaluator.evaluator_thread_id,
    eval_verdict: finalEvaluator.eval_verdict,
    eval_report_path: finalEvaluator.eval_report_path
  };
  if (finalEvaluator.status !== "PASS" || finalEvaluator.eval_verdict !== "PASS") {
    state.current_stage = "FAILED";
    state.errors = finalEvaluator.errors;
    writeCheckpoint(checkpointStatePath, state);
    return failedEvidence({ planner_thread_id: planner.planner_thread_id, dev_worker_thread_id: devWorker.thread_id, initial_evaluator_thread_id: evaluator.evaluator_thread_id, repair_dev_worker_thread_id: repairDevWorker.thread_id, final_evaluator_thread_id: finalEvaluator.evaluator_thread_id, artifacts, stage_count: stageCount, failure_category: finalEvaluator.failure_category || "FINAL_EVAL_NOT_PASS", errors: finalEvaluator.errors });
  }
  if (!evaluatorCheckedCoverageContract(input.paths.target_repo, finalEvaluator.eval_report_path)) {
    state.current_stage = "FAILED";
    state.errors = ["Final evaluator PASS did not include npm run coverage:contract in validation_commands_checked."];
    writeCheckpoint(checkpointStatePath, state);
    return failedEvidence({ planner_thread_id: planner.planner_thread_id, dev_worker_thread_id: devWorker.thread_id, initial_evaluator_thread_id: evaluator.evaluator_thread_id, repair_dev_worker_thread_id: repairDevWorker.thread_id, final_evaluator_thread_id: finalEvaluator.evaluator_thread_id, artifacts, stage_count: stageCount, failure_category: "TEST_COVERAGE_EVALUATOR_NO_COVERAGE_CONTRACT_EVIDENCE", errors: state.errors });
  }
  state.current_stage = "FINAL_EVAL_DONE";
  writeCheckpoint(checkpointStatePath, state);
  artifacts.push(finalEvaluator.eval_report_path);
  const finalReportPath = writeGenericTestCoverageFinalReport({
    targetRepo: input.paths.target_repo,
    profile: input.profile,
    plannerThreadId: planner.planner_thread_id,
    devWorkerThreadId: devWorker.thread_id,
    initialEvaluatorThreadId: evaluator.evaluator_thread_id,
    repairDevWorkerThreadId: repairDevWorker.thread_id,
    finalEvaluatorThreadId: finalEvaluator.evaluator_thread_id,
    initialEvalVerdict: "NEEDS_REVISION",
    finalEvalVerdict: "PASS",
    validationPassed: repairDevWorker.tests_passed,
    changedFiles: captureDiff(input.paths.target_repo, input.paths.diff_path).changed_files
  });
  artifacts.push(finalReportPath);
  state.current_stage = "FINAL_REPORT_DONE";
  state.final_report = { status: "PASS", path: finalReportPath };
  writeCheckpoint(checkpointStatePath, state);
  return {
    planner_thread_id: planner.planner_thread_id,
    dev_worker_thread_id: devWorker.thread_id,
    initial_evaluator_thread_id: evaluator.evaluator_thread_id,
    repair_dev_worker_thread_id: repairDevWorker.thread_id,
    final_evaluator_thread_id: finalEvaluator.evaluator_thread_id,
    initial_eval_verdict: "NEEDS_REVISION",
    final_eval_verdict: "PASS",
    repair_request_created: true,
    validation_passed: repairDevWorker.tests_passed,
    artifacts,
    final_report_path: finalReportPath,
    stage_count: stageCount,
    failure_category: repairDevWorker.tests_passed ? "" : "TEST_COVERAGE_VALIDATION_FAILED",
    errors: repairDevWorker.tests_passed ? [] : ["Repair dev worker validation did not pass."]
  };
}

async function runTestCoverageDevWorkerStage(input: {
  profile: GenericTestCoverageCaseProfile;
  loop_run_id: string;
  task_id: string;
  target_repo: string;
  prd_path: string;
  task_graph_path: string;
  model?: string;
  model_catalog_json?: string;
  sqlite_home: string;
  adapter: RuntimeAdapter;
  report_dir: string;
  validation_log_path: string;
  validation_runner?: ValidationRunner;
  artifact_path: string;
}): Promise<TestCoverageDevWorkerStageResult> {
  const before = readTargetTest(input.target_repo, input.profile.target_test_file);
  const runtimeInput = createTestCoverageDevWorkerRuntimeInput(input);
  const thread = await input.adapter.runThread(runtimeInput);
  const after = readTargetTest(input.target_repo, input.profile.target_test_file);
  if (thread.status === "TIMEOUT") return testCoverageDevFailure(thread, runtimeInput, "TIMEOUT", devWorkerTimeoutCategory(input.profile, thread, runtimeInput));
  if (!thread.thread_id) return testCoverageDevFailure(thread, runtimeInput, "BLOCKED", thread.failure_category || "DEV_WORKER_THREAD_STARTUP_FAILURE");
  const parsed = parseDevWorkerLiteOutput(thread.final_response);
  if (parsed.status !== "PASS" || !parsed.output) return testCoverageDevFailure(thread, runtimeInput, "NEEDS_REVISION", parsed.failure_category || "DEV_WORKER_RESULT_SCHEMA_INVALID", parsed.errors);
  if (!parsed.output.changed_files.includes(input.profile.target_test_file)) return testCoverageDevFailure(thread, runtimeInput, "NEEDS_REVISION", "DEV_WORKER_NO_TEST_FILE_CHANGE", [`changed_files must include ${input.profile.target_test_file}.`]);
  const requiredCommands = input.profile.default_validation_commands;
  const missingCommands = requiredCommands.filter((command) => !parsed.output!.tests_run.some((entry) => entry === command || entry.includes(command)));
  if (missingCommands.length > 0) return testCoverageDevFailure(thread, runtimeInput, "NEEDS_REVISION", "DEV_WORKER_NO_TEST", [`tests_run must include ${missingCommands.join(", ")}.`]);
  if (!parsed.output.tests_passed) return testCoverageDevFailure(thread, runtimeInput, "NEEDS_REVISION", "DEV_WORKER_TESTS_FAILED", ["tests_passed must be true."]);
  if (before === after) return testCoverageDevFailure(thread, runtimeInput, "NEEDS_REVISION", "DEV_WORKER_NO_FILE_CHANGE", [`${input.profile.target_test_file} did not change.`]);
  const validation = (input.validation_runner ?? runValidationCommands)(input.target_repo, input.validation_log_path, requiredCommands);
  if (!validation.passed) return testCoverageDevFailure(thread, runtimeInput, "NEEDS_REVISION", validationFailureCategory(input.profile, validation.output, requiredCommands), [validation.output]);
  const validationCommandResults = buildValidationCommandResults({
    commands: requiredCommands,
    log_paths: [input.validation_log_path],
    validation_passed: true
  });
  const artifactPath = input.artifact_path;
  writeTargetJson(input.target_repo, artifactPath, {
    status: "PASS",
    changed_files: parsed.output.changed_files,
    tests_run: parsed.output.tests_run,
    tests_passed: true,
    validation_command_results: validationCommandResults,
    validation_log_paths: [input.validation_log_path],
    coverage_contract_passed: coverageContractPassed(validationCommandResults),
    summary: parsed.output.summary,
    known_gap_seeded: false,
    created_by_runtime: "sdk-orchestrated",
    created_by_role: "dev_worker",
    created_by_thread_id: thread.thread_id
  });
  return {
    status: "PASS",
    failure_category: "",
    thread_id: thread.thread_id,
    file_change_verified: true,
    tests_run: parsed.output.tests_run,
    tests_passed: true,
    validation_command_results: validationCommandResults,
    validation_log_paths: [input.validation_log_path],
    coverage_contract_passed: coverageContractPassed(validationCommandResults),
    dev_result_path: artifactPath,
    ...devWorkerRuntimeEvidence(thread, runtimeInput),
    errors: thread.errors
  };
}

function devWorkerTimeoutCategory(profile: GenericTestCoverageCaseProfile, thread: RuntimeThreadResult, runtimeInput: RuntimeThreadInput): string {
  if (profile.case_id !== "test-coverage-002") return "TEST_COVERAGE_TREATMENT_DEV_WORKER_TIMEOUT";
  const eventCount = thread.events.length || countJsonlEvents(runtimeInput.error_capture_paths?.events_path);
  const hasThreadOrTurnEvidence = Boolean(thread.thread_id || thread.last_event_type || eventCount > 0);
  return hasThreadOrTurnEvidence
    ? "TEST_COVERAGE_002_DEV_WORKER_TURN_NO_EVENT_TIMEOUT"
    : "TEST_COVERAGE_002_DEV_WORKER_STARTUP_NO_EVENT_TIMEOUT";
}

function validationFailureCategory(profile: GenericTestCoverageCaseProfile, output: string, commands: string[]): string {
  if (profile.case_id !== "test-coverage-002") return "TEST_COVERAGE_VALIDATION_FAILED";
  const commandResults = buildValidationCommandResults({
    commands,
    log_paths: [],
    validation_passed: false
  }).map((result) => ({ ...result, status: output.includes(result.command) ? result.status : "NOT_RUN" }));
  const npmSection = sectionForCommand(output, "npm test");
  if (npmSection && hasValidationFailureMarker(npmSection)) return "TEST_COVERAGE_002_NPM_TEST_FAILED";
  const coverageSection = sectionForCommand(output, "npm run coverage:contract");
  if (coverageSection && hasValidationFailureMarker(coverageSection)) return "TEST_COVERAGE_002_COVERAGE_CONTRACT_FAILED";
  if (commands.includes("npm run coverage:contract") && !output.includes("npm run coverage:contract")) return "TEST_COVERAGE_002_COVERAGE_CONTRACT_LOG_MISSING";
  return commandResults.some((result) => result.command === "npm test" && result.status === "FAIL")
    ? "TEST_COVERAGE_002_NPM_TEST_FAILED"
    : "TEST_COVERAGE_VALIDATION_FAILED";
}

function hasValidationFailureMarker(text: string): boolean {
  return /(?:\bFAIL\b|\bfailed\b|not ok|\bERR!|exit\s+1|AssertionError|Error:)/i.test(text);
}

function sectionForCommand(output: string, command: string): string {
  const start = output.indexOf(command);
  if (start < 0) return "";
  const rest = output.slice(start);
  const nextCommand = rest.slice(command.length).search(/\n\$\s+/);
  return nextCommand >= 0 ? rest.slice(0, command.length + nextCommand) : rest;
}

function createTestCoverageDevWorkerRuntimeInput(input: Parameters<typeof runTestCoverageDevWorkerStage>[0]): RuntimeThreadInput {
  const prompt = buildTestCoverageDevWorkerPrompt({
    profile: input.profile,
    prd_path: input.prd_path,
    task_graph_path: input.task_graph_path
  });
  return {
    role: "dev_worker",
    loop_run_id: input.loop_run_id,
    task_id: input.task_id,
    prompt,
    sandbox: "workspace-write",
    working_directory: input.target_repo,
    timeout_ms: 180_000,
    output_schema_path: "",
    output_schema: devWorkerLiteOutputSchema,
    codex_model: input.model,
    model_catalog_json: input.model_catalog_json,
    codex_config_overrides: {},
    skip_git_repo_check: false,
    direct_cli_parity_status: "PASS",
    invocation_trace_path: resolve(input.report_dir, "generic-test-coverage-dev-worker-invocation-trace-redacted.json"),
    invocation_trace_label: "m12-test-coverage-dev-worker",
    error_capture_paths: {
      events_path: resolve(input.report_dir, "generic-test-coverage-dev-worker-events.jsonl"),
      stdout_path: resolve(input.report_dir, "generic-test-coverage-dev-worker-stdout.log"),
      stderr_path: resolve(input.report_dir, "generic-test-coverage-dev-worker-stderr.log")
    },
    no_event_timeout_ms: Number.parseInt(process.env.CODEX_LOOP_SDK_NO_EVENT_TIMEOUT_MS ?? "30000", 10),
    env: {
      CODEX_SQLITE_HOME: input.sqlite_home
    }
  };
}

export function buildTestCoverageDevWorkerPrompt(input: {
  profile: GenericTestCoverageCaseProfile;
  prd_path: string;
  task_graph_path: string;
}): string {
  if (input.profile.case_id === "test-coverage-002") {
    return [
      "$codex-loop SDK-Orchestrated Test Coverage",
      "Role: dev_worker",
      "Goal: add missing cache invalidation tests.",
      "Modify test/cache.test.js.",
      "Do not modify src/cache.js or src/cache-storage.js unless tests expose a real bug.",
      "Run npm test.",
      "Run npm run coverage:contract.",
      "Required coverage: stale cache after update; cache miss path.",
      "Return DevResult JSON with changed_files, tests_run, tests_passed, coverage_contract_passed, summary.",
      "changed_files must include test/cache.test.js."
    ].join("\n");
  }
  return [
    "$codex-loop SDK-Orchestrated Test Coverage",
    "Role: dev_worker",
    `Read ${input.prd_path} and ${input.task_graph_path}.`,
    ...input.profile.dev_worker_prompt_lines,
    `Run ${input.profile.default_validation_commands.join(" and ")}.`,
    "Return JSON matching the DevResult lite output schema.",
    `changed_files must include ${input.profile.target_test_file}.`,
    `tests_run must include ${input.profile.default_validation_commands.join(" and ")}.`
  ].join("\n");
}

function testCoverageDevFailure(thread: RuntimeThreadResult, runtimeInput: RuntimeThreadInput, status: TestCoverageDevWorkerStageResult["status"], failureCategory: string, extraErrors: string[] = []): TestCoverageDevWorkerStageResult {
  return {
    status,
    failure_category: failureCategory,
    thread_id: thread.thread_id,
    file_change_verified: false,
    tests_run: [],
    tests_passed: false,
    dev_result_path: "",
    ...devWorkerRuntimeEvidence(thread, runtimeInput),
    errors: [...thread.errors, ...extraErrors]
  };
}

function createTestCoverageRepairRequest(targetRepo: string, evalReportPath: string, caseId: string, profile: GenericTestCoverageCaseProfile): { status: "PASS" | "NEEDS_REVISION"; failure_category: string; errors: string[] } {
  const evalReport = JSON.parse(readFileSync(resolve(targetRepo, evalReportPath), "utf8")) as EvalReport;
  const repair = createRepairRequestFromEval({
    eval_report: evalReport,
    repair_id: `repair_${idSafe(caseId)}`,
    allowed_scope: profile.repair_allowed_scope,
    disallowed_scope: ["Do not modify package.json unless validation is impossible.", "Do not read .env or secrets."]
  });
  if (repair.status !== "PASS" || !repair.repair_request) {
    return { status: "NEEDS_REVISION", failure_category: repair.failure_category || "REPAIR_REQUEST_NOT_CREATED", errors: repair.errors };
  }
  const validation = validateWithSchema("repair-request", repair.repair_request);
  if (!validation.valid) {
    return { status: "NEEDS_REVISION", failure_category: "REPAIR_REQUEST_SCHEMA_INVALID", errors: validation.errors.map((error) => `${error.path}: ${error.message}`) };
  }
  writeTargetJson(targetRepo, "artifacts/repair-request.json", repair.repair_request);
  return { status: "PASS", failure_category: "", errors: [] };
}

function writeGenericTestCoverageFinalReport(input: {
  targetRepo: string;
  profile: GenericTestCoverageCaseProfile;
  plannerThreadId: string;
  devWorkerThreadId: string;
  initialEvaluatorThreadId: string;
  repairDevWorkerThreadId: string;
  finalEvaluatorThreadId: string;
  initialEvalVerdict: string;
  finalEvalVerdict: string;
  validationPassed: boolean;
  changedFiles: string[];
}): string {
  const path = "artifacts/FinalDeliveryReport.md";
  writeTargetText(input.targetRepo, path, [
    "# FinalDeliveryReport",
    "",
    "## Summary",
    "",
    "M12 generic test coverage treatment completed through SDK-Orchestrated planner, dev worker, evaluator, and final report stages.",
    "",
    "## Scope",
    "",
    `- Changed files: ${input.changedFiles.join(", ") || "none"}`,
    input.profile.final_report_scope_line,
    "- Production code changes require a real bug explanation before PASS.",
    "",
    "## Thread Evidence",
    "",
    `- Planner thread_id: ${input.plannerThreadId}`,
    `- Dev Worker thread_id: ${input.devWorkerThreadId}`,
    `- Initial Evaluator thread_id: ${input.initialEvaluatorThreadId}`,
    `- Repair Dev Worker thread_id: ${input.repairDevWorkerThreadId}`,
    `- Final Evaluator thread_id: ${input.finalEvaluatorThreadId}`,
    "",
    "## Evaluator Verdicts",
    "",
    `- Initial EvalReport: ${input.initialEvalVerdict}`,
    `- Final EvalReport: ${input.finalEvalVerdict}`,
    "",
    "## Validation Commands",
    "",
    `- npm test: ${input.validationPassed ? "PASS" : "FAIL"}`,
    `- npm run coverage:contract: ${input.validationPassed ? "PASS" : "FAIL"}`,
    ""
  ].join("\n"));
  return path;
}

function failedEvidence(input: Partial<GenericTestCoverageEvidence> & { artifacts: string[]; stage_count: number; failure_category: string; errors: string[] }): GenericTestCoverageEvidence {
  return {
    planner_thread_id: input.planner_thread_id ?? "",
    dev_worker_thread_id: input.dev_worker_thread_id ?? "",
    initial_evaluator_thread_id: input.initial_evaluator_thread_id ?? "",
    repair_dev_worker_thread_id: input.repair_dev_worker_thread_id ?? "",
    final_evaluator_thread_id: input.final_evaluator_thread_id ?? "",
    initial_eval_verdict: input.initial_eval_verdict ?? "",
    final_eval_verdict: input.final_eval_verdict ?? "",
    repair_request_created: input.repair_request_created ?? false,
    validation_passed: input.validation_passed ?? false,
    artifacts: input.artifacts,
    final_report_path: input.final_report_path ?? "",
    stage_count: input.stage_count,
    failure_category: input.failure_category,
    dev_worker_events_path: input.dev_worker_events_path ?? "",
    dev_worker_stdout_path: input.dev_worker_stdout_path ?? "",
    dev_worker_stderr_path: input.dev_worker_stderr_path ?? "",
    dev_worker_raw_output_path: input.dev_worker_raw_output_path ?? "",
    dev_worker_redacted_output_path: input.dev_worker_redacted_output_path ?? "",
    dev_worker_last_event_type: input.dev_worker_last_event_type ?? "",
    dev_worker_elapsed_ms: input.dev_worker_elapsed_ms ?? 0,
    dev_worker_event_count: input.dev_worker_event_count ?? 0,
    dev_worker_prompt_length: input.dev_worker_prompt_length ?? 0,
    dev_worker_prompt_hash: input.dev_worker_prompt_hash ?? "",
    dev_worker_no_event_timeout: input.dev_worker_no_event_timeout ?? false,
    errors: input.errors
  };
}

function devWorkerRuntimeEvidence(thread: RuntimeThreadResult, runtimeInput: RuntimeThreadInput): Pick<
  TestCoverageDevWorkerStageResult,
  | "events_path"
  | "stdout_path"
  | "stderr_path"
  | "raw_output_path"
  | "redacted_output_path"
  | "last_event_type"
  | "elapsed_ms"
  | "event_count"
  | "prompt_length"
  | "prompt_hash"
  | "no_event_timeout"
> {
  const stdoutPath = thread.stdout_path || runtimeInput.error_capture_paths?.stdout_path || "";
  return {
    events_path: thread.events_path || runtimeInput.error_capture_paths?.events_path || "",
    stdout_path: stdoutPath,
    stderr_path: thread.stderr_path || runtimeInput.error_capture_paths?.stderr_path || "",
    raw_output_path: stdoutPath,
    redacted_output_path: stdoutPath ? stdoutPath.replace(/\.log$/, "-redacted.log") : "",
    last_event_type: thread.last_event_type ?? lastEventTypeFromEvents(thread.events),
    elapsed_ms: thread.elapsed_ms ?? 0,
    event_count: (thread.event_count ?? thread.events.length) || countJsonlEvents(thread.events_path || runtimeInput.error_capture_paths?.events_path),
    prompt_length: runtimeInput.prompt.length,
    prompt_hash: stableHash(runtimeInput.prompt),
    no_event_timeout: thread.no_event_timeout === true
  };
}

function buildGenericTestCoverageStageTimeline(evidence: GenericTestCoverageEvidence): M12RunResult["stage_timeline"] {
  return [
    {
      stage: "planner",
      started: Boolean(evidence.planner_thread_id),
      thread_id: evidence.planner_thread_id,
      completed: Boolean(evidence.planner_thread_id),
      status: evidence.planner_thread_id ? "PASS" : "NOT_RUN"
    },
    {
      stage: "dev_worker",
      started: Boolean(evidence.dev_worker_thread_id),
      thread_id: evidence.dev_worker_thread_id,
      completed: Boolean(evidence.dev_worker_thread_id && !evidence.failure_category),
      status: evidence.failure_category ? "TIMEOUT" : evidence.dev_worker_thread_id ? "PASS" : "NOT_RUN",
      events_path: evidence.dev_worker_events_path,
      stdout_path: evidence.dev_worker_stdout_path,
      stderr_path: evidence.dev_worker_stderr_path,
      last_event_type: evidence.dev_worker_last_event_type,
      elapsed_ms: evidence.dev_worker_elapsed_ms,
      prompt_length: evidence.dev_worker_prompt_length,
      prompt_hash: evidence.dev_worker_prompt_hash
    },
    {
      stage: "evaluator",
      started: Boolean(evidence.initial_evaluator_thread_id),
      thread_id: evidence.initial_evaluator_thread_id,
      completed: Boolean(evidence.initial_evaluator_thread_id && evidence.initial_eval_verdict),
      status: evidence.initial_eval_verdict || "NOT_RUN"
    }
  ];
}

function stageForFailure(evidence: GenericTestCoverageEvidence): string {
  if (evidence.failure_category.includes("DEV_WORKER") && evidence.dev_worker_thread_id) return "DEV_WORKER_STARTED";
  if (evidence.failure_category.includes("DEV_WORKER")) return "DEV_WORKER_FAILED";
  return "FAILED";
}

function lastCompletedStageForFailure(evidence: GenericTestCoverageEvidence): string {
  if (evidence.dev_worker_thread_id && !evidence.failure_category) return "DEV_WORKER_DONE";
  if (evidence.planner_thread_id) return "PLANNER_DONE";
  return "";
}

function firstFailedStageForEvidence(evidence: GenericTestCoverageEvidence): string {
  if (evidence.failure_category.includes("DEV_WORKER")) return "dev_worker";
  if (evidence.failure_category.includes("PLANNER")) return "planner";
  if (evidence.failure_category.includes("EVALUATOR")) return "evaluator";
  return evidence.failure_category ? "unknown" : "";
}

function countJsonlEvents(path: string | undefined): number {
  if (!path) return 0;
  try {
    return readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean).length;
  } catch {
    return 0;
  }
}

function lastEventTypeFromEvents(events: unknown[]): string {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (isRecord(event) && typeof event.type === "string") return event.type;
  }
  return "";
}

function stableHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function runValidationCommands(cwd: string, logPath: string, commands: string[]): { passed: boolean; output: string } {
  const chunks: string[] = [];
  let passed = true;
  for (const command of commands) {
    chunks.push(`$ ${command}\n`);
    const parts = command.split(/\s+/).filter(Boolean);
    try {
      const output = execFileSync(parts[0]!, parts.slice(1), {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"]
      });
      chunks.push(output.endsWith("\n") ? output : `${output}\n`);
    } catch (error) {
      const output = error instanceof Error && "stdout" in error
        ? `${String((error as { stdout?: unknown }).stdout ?? "")}${String((error as { stderr?: unknown }).stderr ?? "")}`
        : error instanceof Error ? error.message : String(error);
      chunks.push(output.endsWith("\n") ? output : `${output}\n`);
      passed = false;
    }
  }
  const output = chunks.join("");
  writeFile(logPath, output);
  return { passed, output };
}

function evaluatorCheckedCoverageContract(targetRepo: string, evalReportPath: string): boolean {
  try {
    const parsed = JSON.parse(readFileSync(resolve(targetRepo, evalReportPath), "utf8")) as {
      validation_commands_checked?: Array<{ command?: string } | string>;
    };
    return (parsed.validation_commands_checked ?? []).some((entry) => {
      const command = typeof entry === "string" ? entry : entry.command ?? "";
      return command === "npm run coverage:contract" || command.includes("coverage:contract");
    });
  } catch {
    return false;
  }
}

function captureDiff(cwd: string, diffPath: string): { changed_files: string[]; patch: string } {
  let patch = "";
  try {
    patch = execFileSync("git", ["diff", "--", "."], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch {
    patch = "";
  }
  writeFile(diffPath, patch);
  return {
    changed_files: Array.from(new Set([...patch.matchAll(/^\+\+\+ b\/(.+)$/gm)].map((match) => match[1] ?? "").filter(Boolean))),
    patch
  };
}

function readTargetTest(targetRepo: string, targetTestFile: string): string {
  try {
    return readFileSync(resolve(targetRepo, targetTestFile), "utf8");
  } catch {
    return "";
  }
}

function writeCheckpoint(path: string, state: GenericTestCoverageCheckpointState): void {
  writeFile(path, `${JSON.stringify(state, null, 2)}\n`);
}

function writeTargetJson(targetRepo: string, path: string, value: unknown): void {
  writeTargetText(targetRepo, path, `${JSON.stringify(value, null, 2)}\n`);
}

function writeTargetText(targetRepo: string, path: string, value: string): void {
  writeFile(resolve(targetRepo, path), value);
}

function writeFile(path: string, value: string): void {
  mkdirSync(dirname(resolve(path)), { recursive: true });
  writeFileSync(resolve(path), value, "utf8");
}

function detectSecretLeak(values: string[]): boolean {
  return values.some((value) => hasConfirmedSecretLeak(value));
}

function hasConfirmedSecretLeak(value: string): boolean {
  return value.split(/\r?\n/).some((line) => {
    const normalized = line.trim();
    if (!normalized || /\bREDACTED\b|\*\*\*REDACTED\*\*\*/i.test(normalized)) return false;
    if (/\b(?:token_count|cached_input_tokens|reasoning_output_tokens|output_tokens)\b/i.test(normalized)) return false;
    if (/\b(?:secret_leak_detected|danger_full_access_used)\b\s*[:=]\s*false\b/i.test(normalized)) return false;
    if (/\bsk-[A-Za-z0-9_-]{16,}\b/.test(normalized)) return true;
    if (/\bbearer\s+[A-Za-z0-9._~+/=-]{12,}\b/i.test(normalized)) return true;
    return /(?:api[_-]?key|access[_-]?token|auth[_-]?token|credential|password|secret)\s*[:=]\s*["']?(?!false\b|null\b|undefined\b)([A-Za-z0-9._~+/=-]{8,})/i.test(normalized);
  });
}

function idSafe(value: string): string {
  return value.replace(/[^a-zA-Z0-9_]/g, "_");
}
