import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import type { M12Case, M12RunResult } from "../../scripts/effectiveness/types.ts";
import { validateWithSchema } from "../core/validate.ts";
import type { EvalReport } from "../core/types.ts";
import { createRepairRequestFromEval } from "../orchestrator/create-repair-request-from-eval.ts";
import {
  emptyGenericFeatureCheckpointState,
  featureEvaluatorRetryEligibility,
  type GenericFeatureCheckpointState
} from "./generic-feature-checkpoint-state.ts";
import { runDevWorkerStage } from "../orchestrator/sdk-dev-worker-stage.ts";
import { runEvaluatorLiteStage } from "../orchestrator/sdk-evaluator-stage.ts";
import { runPlannerLiteStage } from "../orchestrator/sdk-planner-lite-stage.ts";
import type { RuntimeAdapter } from "../runtime/runtime-adapter.ts";
import { ensureEvalSqliteHome } from "../runtime/eval-sqlite-home.ts";
import { SdkRuntimeAdapter } from "../runtime/sdk-runtime-adapter.ts";
import { clearM12ModeOutputs, inspectM12ModeCheckpoint, m12CasePaths, prepareM12FeatureFixture, type M12CasePaths } from "./effectiveness-fixtures.ts";
import { buildFeatureSmall001PlannerPrompt, featureSmall001PlannerStageConfig } from "./feature-planner-stage.ts";
import { featureEvaluatorStageConfig } from "./feature-evaluator-stage.ts";
import { analyzeFeatureTreatmentTimeline } from "./feature-treatment-stage-timeline.ts";
import { getGenericFeatureCaseProfile, genericFeatureCaseSupported, type GenericFeatureCaseProfile } from "./generic-feature-case-profile.ts";

export interface GenericFeatureTreatmentOptions {
  testCase: M12Case;
  repoRoot?: string;
  resume?: boolean;
  fresh?: boolean;
  env?: NodeJS.ProcessEnv;
  runtime_adapter?: RuntimeAdapter;
  now?: () => number;
}

export interface GenericFeatureEvaluatorRetryOptions {
  testCase: M12Case;
  repoRoot?: string;
  env?: NodeJS.ProcessEnv;
  runtime_adapter: RuntimeAdapter;
}

interface GenericFeatureEvidence {
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
  errors: string[];
  planner_stage_attempted?: boolean;
  planner_stage_completed?: boolean;
  planner_output_contract_version?: "v1" | "v2" | "";
  planner_raw_output_path?: string;
  planner_redacted_output_path?: string;
  planner_events_path?: string;
  planner_stdout_path?: string;
  planner_stderr_path?: string;
  planner_last_event_type?: string;
  planner_elapsed_ms?: number;
  planner_event_count?: number;
  checkpoint_state_path?: string;
  initial_evaluator_events_path?: string;
  initial_evaluator_stdout_path?: string;
  initial_evaluator_stderr_path?: string;
  initial_evaluator_raw_output_path?: string;
  initial_evaluator_redacted_output_path?: string;
  initial_evaluator_last_event_type?: string;
  initial_evaluator_elapsed_ms?: number;
  initial_evaluator_event_count?: number;
  initial_evaluator_prompt_length?: number;
  initial_evaluator_prompt_hash?: string;
}

export { buildFeatureSmall001PlannerPrompt } from "./feature-planner-stage.ts";

export function createGenericFeatureBlockedResult(testCase: M12Case, errors: string[], failureCategory: string): M12RunResult {
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

export async function runGenericFeatureTreatment(options: GenericFeatureTreatmentOptions): Promise<M12RunResult> {
  const repoRoot = options.repoRoot ?? process.cwd();
  const env = options.env ?? process.env;
  if (!genericFeatureCaseSupported(options.testCase)) {
    return createGenericFeatureBlockedResult(options.testCase, [`Generic feature treatment does not support ${options.testCase.case_id}.`], "BLOCKED_TREATMENT_CASE_NOT_IMPLEMENTED");
  }
  const sqliteHome = ensureEvalSqliteHome(repoRoot, env);
  if (!sqliteHome.ok) {
    return createGenericFeatureBlockedResult(options.testCase, [sqliteHome.reason ?? "Eval sqlite home unavailable."], sqliteHome.reason ?? "BLOCKED_EVAL_SQLITE_HOME");
  }
  if (options.fresh) {
    clearM12ModeOutputs(options.testCase, "treatment", repoRoot);
  } else {
    const checkpoint = inspectM12ModeCheckpoint(options.testCase, "treatment", repoRoot);
    if (checkpoint.failed) {
      const category = options.resume ? "BLOCKED_M12_RESUME_FAILED_CHECKPOINT" : "BLOCKED_M12_STALE_FAILED_CHECKPOINT";
      return createGenericFeatureBlockedResult(options.testCase, [`${category}: existing treatment checkpoint/result is ${checkpoint.result_status || checkpoint.checkpoint_stage || "failed"}. Use --fresh for one approved rerun.`], category);
    }
  }

  const startedAt = options.now?.() ?? Date.now();
  const paths = prepareM12FeatureFixture({ testCase: options.testCase, variant: "treatment", repoRoot, resume: options.resume });
  const profile = getGenericFeatureCaseProfile(options.testCase)!;
  const adapter = options.runtime_adapter ?? new SdkRuntimeAdapter({ enableRealRun: true, repoRoot });
  const evidence = await runGenericFeatureStages({
    testCase: options.testCase,
    profile,
    paths,
    repoRoot,
    sqliteHome: sqliteHome.path,
    adapter,
    env
  });
  const diff = captureDiff(paths.target_repo, paths.diff_path);
  const validationLog = resolve(paths.reports_dir, "treatment-validation.log");
  writeFile(validationLog, JSON.stringify({ evidence, changed_files: diff.changed_files }, null, 2));
  const status: M12RunResult["status"] = evidence.failure_category ? "BLOCKED" : "PASS";
  const threadIds = [
    evidence.planner_thread_id,
    evidence.dev_worker_thread_id,
    evidence.initial_evaluator_thread_id,
    evidence.repair_dev_worker_thread_id,
    evidence.final_evaluator_thread_id
  ].filter(Boolean);
  const timelineAnalysis = analyzeFeatureTreatmentTimeline({
    case_id: options.testCase.case_id,
    variant: "treatment",
    failure_category: evidence.failure_category,
    planner_thread_id: evidence.planner_thread_id,
    planner_stage_attempted: evidence.planner_stage_attempted,
    planner_stage_completed: evidence.planner_stage_completed,
    planner_output_contract_version: evidence.planner_output_contract_version,
    planner_events_path: evidence.planner_events_path,
    planner_last_event_type: evidence.planner_last_event_type,
    planner_elapsed_ms: evidence.planner_elapsed_ms,
    checkpoint_state_path: evidence.checkpoint_state_path,
    dev_worker_thread_id: evidence.dev_worker_thread_id,
    initial_evaluator_thread_id: evidence.initial_evaluator_thread_id,
    initial_evaluator_events_path: evidence.initial_evaluator_events_path,
    initial_evaluator_stdout_path: evidence.initial_evaluator_stdout_path,
    initial_evaluator_stderr_path: evidence.initial_evaluator_stderr_path,
    initial_evaluator_raw_output_path: evidence.initial_evaluator_raw_output_path,
    initial_evaluator_redacted_output_path: evidence.initial_evaluator_redacted_output_path,
    initial_evaluator_last_event_type: evidence.initial_evaluator_last_event_type,
    initial_evaluator_elapsed_ms: evidence.initial_evaluator_elapsed_ms,
    initial_evaluator_event_count: evidence.initial_evaluator_event_count,
    initial_evaluator_prompt_length: evidence.initial_evaluator_prompt_length,
    initial_evaluator_prompt_hash: evidence.initial_evaluator_prompt_hash,
    repair_dev_worker_thread_id: evidence.repair_dev_worker_thread_id,
    final_evaluator_thread_id: evidence.final_evaluator_thread_id,
    initial_eval_verdict: evidence.initial_eval_verdict,
    final_eval_verdict: evidence.final_eval_verdict,
    final_report_path: evidence.final_report_path,
    initial_dev_worker: {
      thread_started: Boolean(evidence.dev_worker_thread_id),
      thread_id: evidence.dev_worker_thread_id,
      file_change_verified: diff.changed_files.includes(profile.target_source_file),
      baseline_tests_run: false,
      baseline_tests_passed: false,
      full_tests_run: true,
      full_tests_expected_to_fail: false,
      full_tests_failed: false,
      known_gap_seeded: false,
      dev_result_path: "artifacts/dev-result.json",
      events_path: resolve(paths.reports_dir, "sdk-stage-logs/generic-dev-worker-events.jsonl"),
      stdout_path: resolve(paths.reports_dir, "sdk-stage-logs/generic-dev-worker-stdout.log"),
      stderr_path: resolve(paths.reports_dir, "sdk-stage-logs/generic-dev-worker-stderr.log")
    },
    status
  });
  const failureCategory = status === "PASS" ? "" : timelineAnalysis.corrected_failure_category || evidence.failure_category;

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
    validation_logs: [validationLog],
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
    planner_stage_attempted: evidence.planner_stage_attempted,
    planner_stage_completed: evidence.planner_stage_completed,
    planner_output_contract_version: evidence.planner_output_contract_version,
    planner_raw_output_path: evidence.planner_raw_output_path,
    planner_redacted_output_path: evidence.planner_redacted_output_path,
    planner_events_path: evidence.planner_events_path,
    planner_stdout_path: evidence.planner_stdout_path,
    planner_stderr_path: evidence.planner_stderr_path,
    planner_last_event_type: evidence.planner_last_event_type,
    planner_elapsed_ms: evidence.planner_elapsed_ms,
    planner_event_count: evidence.planner_event_count,
    checkpoint_state_path: evidence.checkpoint_state_path,
    dev_worker_thread_id: evidence.dev_worker_thread_id,
    initial_evaluator_thread_id: evidence.initial_evaluator_thread_id,
    initial_evaluator_events_path: evidence.initial_evaluator_events_path,
    initial_evaluator_stdout_path: evidence.initial_evaluator_stdout_path,
    initial_evaluator_stderr_path: evidence.initial_evaluator_stderr_path,
    initial_evaluator_raw_output_path: evidence.initial_evaluator_raw_output_path,
    initial_evaluator_redacted_output_path: evidence.initial_evaluator_redacted_output_path,
    initial_evaluator_last_event_type: evidence.initial_evaluator_last_event_type,
    initial_evaluator_elapsed_ms: evidence.initial_evaluator_elapsed_ms,
    initial_evaluator_event_count: evidence.initial_evaluator_event_count,
    initial_evaluator_prompt_length: evidence.initial_evaluator_prompt_length,
    initial_evaluator_prompt_hash: evidence.initial_evaluator_prompt_hash,
    repair_dev_worker_thread_id: evidence.repair_dev_worker_thread_id,
    final_evaluator_thread_id: evidence.final_evaluator_thread_id,
    validation_passed: evidence.validation_passed,
    diff_path: paths.diff_path,
    final_report_path: evidence.final_report_path,
    artifact_thread_evidence_verified: evidence.artifacts.length > 0,
    danger_full_access_used: false,
    initial_dev_worker: {
      thread_started: Boolean(evidence.dev_worker_thread_id),
      thread_id: evidence.dev_worker_thread_id,
      file_change_verified: diff.changed_files.includes(profile.target_source_file),
      baseline_tests_run: false,
      baseline_tests_passed: false,
      full_tests_run: true,
      full_tests_expected_to_fail: false,
      full_tests_failed: false,
      known_gap_seeded: false,
      dev_result_path: "artifacts/dev-result.json",
      events_path: resolve(paths.reports_dir, "sdk-stage-logs/generic-dev-worker-events.jsonl"),
      stdout_path: resolve(paths.reports_dir, "sdk-stage-logs/generic-dev-worker-stdout.log"),
      stderr_path: resolve(paths.reports_dir, "sdk-stage-logs/generic-dev-worker-stderr.log")
    },
    current_stage: timelineAnalysis.current_stage,
    last_completed_stage: timelineAnalysis.last_completed_stage,
    first_failed_stage: timelineAnalysis.first_failed_stage,
    stage_timeline: timelineAnalysis.stage_timeline,
    failure_category_was_stale_or_inconsistent: timelineAnalysis.failure_category_was_stale_or_inconsistent,
    corrected_failure_category: timelineAnalysis.corrected_failure_category,
    failure_category: failureCategory,
    errors: failureCategory && evidence.errors.length === 0 ? [failureCategory] : evidence.errors
  };
}

async function runGenericFeatureStages(input: {
  testCase: M12Case;
  profile: GenericFeatureCaseProfile;
  paths: M12CasePaths;
  repoRoot: string;
  sqliteHome: string;
  adapter: RuntimeAdapter;
  env: NodeJS.ProcessEnv;
}): Promise<GenericFeatureEvidence> {
  const reportDir = resolve(input.paths.reports_dir, "sdk-stage-logs");
  const checkpointStatePath = resolve(input.paths.reports_dir, "treatment-generic-feature-state.json");
  const state = emptyGenericFeatureCheckpointState();
  writeCheckpoint(checkpointStatePath, state);
  const loopRunId = `loop_m12_${idSafe(input.testCase.case_id)}`;
  const taskId = `task_${idSafe(input.testCase.case_id)}`;
  const artifacts: string[] = [];
  let stageCount = 0;
  const plannerConfig = featureSmall001PlannerStageConfig(input.testCase);
  const evaluatorConfig = featureEvaluatorStageConfig({
    prd_path: "docs/PRD.md",
    task_graph_path: "docs/TASK_GRAPH.json",
    dev_result_path: "artifacts/dev-result.json",
    test_log_path: resolve(input.paths.reports_dir, "treatment-validation.log"),
    diff_path: input.paths.diff_path,
    case_id: input.testCase.case_id
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
    invocation_trace_label: "m12-feature-planner",
    invocation_trace_path: resolve(reportDir, "generic-planner-invocation-trace-redacted.json"),
    events_path: resolve(reportDir, "generic-planner-events.jsonl"),
    stdout_path: resolve(reportDir, "generic-planner-stdout.log"),
    stderr_path: resolve(reportDir, "generic-planner-stderr.log")
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
    stdout_path: resolve(reportDir, "generic-planner-stdout.log"),
    stderr_path: resolve(reportDir, "generic-planner-stderr.log"),
    last_event_type: planner.last_event_type,
    elapsed_ms: planner.elapsed_ms,
    event_count: planner.event_count,
    failure_category: planner.status === "PASS" ? "" : classifyFeaturePlannerFailureWithEvidence({
      category: planner.failure_category,
      status: planner.status,
      no_event_timeout: planner.no_event_timeout,
      planner_thread_id: planner.planner_thread_id,
      last_event_type: planner.last_event_type
    })
  };
  if (planner.status !== "PASS") {
    state.current_stage = "FAILED";
    state.errors = planner.errors;
    writeCheckpoint(checkpointStatePath, state);
    return failedEvidence({
      planner_thread_id: planner.planner_thread_id,
      artifacts,
      stage_count: stageCount,
      failure_category: state.planner.failure_category || "FEATURE_TREATMENT_PLANNER_POSTPROCESS_FAILED",
      errors: planner.errors,
      planner_stage_attempted: true,
      planner_stage_completed: false,
      planner_output_contract_version: planner.output_contract_version,
      planner_raw_output_path: planner.raw_output_path,
      planner_redacted_output_path: planner.redacted_output_path,
      planner_events_path: planner.events_path,
      planner_stdout_path: resolve(reportDir, "generic-planner-stdout.log"),
      planner_stderr_path: resolve(reportDir, "generic-planner-stderr.log"),
      planner_last_event_type: planner.last_event_type,
      planner_elapsed_ms: planner.elapsed_ms,
      planner_event_count: planner.event_count,
      checkpoint_state_path: checkpointStatePath
    });
  }
  state.current_stage = "PLANNER_DONE";
  writeCheckpoint(checkpointStatePath, state);
  artifacts.push(planner.prd_path, planner.task_graph_path, planner.planner_result_path);

  const devWorker = await runDevWorkerStage({
    loop_run_id: loopRunId,
    task_id: taskId,
    target_repo: input.paths.target_repo,
    prd_path: planner.prd_path,
    task_graph_path: planner.task_graph_path,
    model: input.env.CODEX_LOOP_CODEX_MODEL,
    model_catalog_json: input.env.CODEX_LOOP_MODEL_CATALOG_JSON,
    sqlite_home: input.sqliteHome,
    sandbox: "workspace-write",
    timeout_ms: 180_000,
    runtime_adapter: input.adapter,
    repo_root: input.paths.target_repo,
    report_dir: reportDir,
    artifact_path: "artifacts/dev-result.json",
    prompt_override: input.profile.dev_worker_prompt,
    target_source_file: input.profile.target_source_file,
    target_test_files: input.profile.target_test_files,
    invocation_trace_label: "m12-feature-dev-worker",
    invocation_trace_path: resolve(reportDir, "generic-dev-worker-invocation-trace-redacted.json"),
    events_path: resolve(reportDir, "generic-dev-worker-events.jsonl"),
    stdout_path: resolve(reportDir, "generic-dev-worker-stdout.log"),
    stderr_path: resolve(reportDir, "generic-dev-worker-stderr.log")
  });
  stageCount += 1;
  state.dev_worker = {
    status: devWorker.status,
    thread_id: devWorker.dev_worker_thread_id,
    file_change_verified: devWorker.file_change_verified,
    tests_passed: devWorker.tests_passed,
    dev_result_path: devWorker.dev_result_path
  };
  if (devWorker.status !== "PASS") {
    state.current_stage = "FAILED";
    state.errors = devWorker.errors;
    writeCheckpoint(checkpointStatePath, state);
    return failedEvidence(withPlannerEvidence(state, {
      dev_worker_thread_id: devWorker.dev_worker_thread_id,
      artifacts,
      stage_count: stageCount,
      failure_category: classifyFeatureDevWorkerFailure(devWorker.dev_worker_thread_id, devWorker.failure_category),
      errors: devWorker.errors,
      checkpoint_state_path: checkpointStatePath
    }));
  }
  state.current_stage = "DEV_WORKER_DONE";
  writeCheckpoint(checkpointStatePath, state);
  artifacts.push(devWorker.dev_result_path);

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
    test_log_path: resolve(input.paths.reports_dir, "treatment-validation.log"),
    diff_path: input.paths.diff_path,
    invocation_trace_label: "m12-feature-evaluator",
    invocation_trace_path: resolve(reportDir, "generic-evaluator-invocation-trace-redacted.json"),
    events_path: resolve(reportDir, "generic-evaluator-events.jsonl"),
    stdout_path: resolve(reportDir, "generic-evaluator-stdout.log"),
    stderr_path: resolve(reportDir, "generic-evaluator-stderr.log")
  });
  stageCount += 1;
  state.evaluator = {
    status: evaluator.status,
    thread_id: evaluator.evaluator_thread_id,
    eval_verdict: evaluator.eval_verdict,
    eval_report_path: evaluator.eval_report_path
  };
  if (evaluator.status === "PASS" && evaluator.eval_verdict === "PASS") {
    artifacts.push(evaluator.eval_report_path);
    const finalReportPath = writeGenericFinalReport({
      targetRepo: input.paths.target_repo,
      plannerThreadId: planner.planner_thread_id,
      devWorkerThreadId: devWorker.dev_worker_thread_id,
      initialEvaluatorThreadId: evaluator.evaluator_thread_id,
      repairDevWorkerThreadId: "",
      finalEvaluatorThreadId: evaluator.evaluator_thread_id,
      initialEvalVerdict: "PASS",
      finalEvalVerdict: "PASS",
      validationPassed: devWorker.tests_passed
    });
    artifacts.push(finalReportPath);
    state.current_stage = "FINAL_REPORT_DONE";
    state.final_report = { status: "PASS", path: finalReportPath };
    writeCheckpoint(checkpointStatePath, state);
    return {
      planner_thread_id: planner.planner_thread_id,
      dev_worker_thread_id: devWorker.dev_worker_thread_id,
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
      failure_category: devWorker.tests_passed ? "" : "TESTS_FAILED",
      errors: devWorker.tests_passed ? [] : ["Dev worker tests did not pass."],
      ...plannerEvidenceFromState(state),
      checkpoint_state_path: checkpointStatePath,
      ...evaluatorEvidence(evaluator, evaluatorConfig)
    };
  }
  if (evaluator.status !== "NEEDS_REVISION" || evaluator.eval_verdict !== "NEEDS_REVISION") {
    state.current_stage = "FAILED";
    state.errors = evaluator.errors;
    writeCheckpoint(checkpointStatePath, state);
    return failedEvidence(withPlannerEvidence(state, {
      dev_worker_thread_id: devWorker.dev_worker_thread_id,
      initial_evaluator_thread_id: evaluator.evaluator_thread_id,
      artifacts,
      stage_count: stageCount,
      failure_category: classifyFeatureEvaluatorFailure(evaluator.evaluator_thread_id, evaluator.failure_category, evaluator.status, evaluator.no_event_timeout),
      errors: evaluator.errors,
      checkpoint_state_path: checkpointStatePath,
      ...evaluatorEvidence(evaluator, evaluatorConfig)
    }));
  }
  state.current_stage = "EVALUATOR_DONE";
  writeCheckpoint(checkpointStatePath, state);
  artifacts.push(evaluator.eval_report_path);

  const repairCreated = createRepairRequest(input.paths.target_repo, evaluator.eval_report_path, input.testCase.case_id);
  if (repairCreated.status !== "PASS") {
    state.current_stage = "FAILED";
    state.errors = repairCreated.errors;
    writeCheckpoint(checkpointStatePath, state);
    return failedEvidence(withPlannerEvidence(state, { dev_worker_thread_id: devWorker.dev_worker_thread_id, initial_evaluator_thread_id: evaluator.evaluator_thread_id, artifacts, stage_count: stageCount, failure_category: repairCreated.failure_category, errors: repairCreated.errors, checkpoint_state_path: checkpointStatePath }));
  }
  state.current_stage = "REPAIR_REQUEST_CREATED";
  state.repair_request = { status: "PASS", repair_request_path: "artifacts/repair-request.json" };
  writeCheckpoint(checkpointStatePath, state);
  artifacts.push("artifacts/repair-request.json");

  const repairDevWorker = await runDevWorkerStage({
    loop_run_id: loopRunId,
    task_id: taskId,
    target_repo: input.paths.target_repo,
    prd_path: planner.prd_path,
    task_graph_path: "artifacts/repair-request.json",
    model: input.env.CODEX_LOOP_CODEX_MODEL,
    model_catalog_json: input.env.CODEX_LOOP_MODEL_CATALOG_JSON,
    sqlite_home: input.sqliteHome,
    sandbox: "workspace-write",
    timeout_ms: 180_000,
    runtime_adapter: input.adapter,
    repo_root: input.paths.target_repo,
    report_dir: reportDir,
    artifact_path: "artifacts/repair-result.json",
    prompt_override: input.profile.dev_worker_prompt,
    target_source_file: input.profile.target_source_file,
    target_test_files: input.profile.target_test_files,
    invocation_trace_label: "m12-feature-repair-dev-worker",
    invocation_trace_path: resolve(reportDir, "generic-repair-dev-worker-invocation-trace-redacted.json"),
    events_path: resolve(reportDir, "generic-repair-dev-worker-events.jsonl"),
    stdout_path: resolve(reportDir, "generic-repair-dev-worker-stdout.log"),
    stderr_path: resolve(reportDir, "generic-repair-dev-worker-stderr.log")
  });
  stageCount += 1;
  state.repair_dev_worker = {
    status: repairDevWorker.status,
    thread_id: repairDevWorker.dev_worker_thread_id,
    file_change_verified: repairDevWorker.file_change_verified,
    tests_passed: repairDevWorker.tests_passed,
    repair_result_path: repairDevWorker.dev_result_path
  };
  if (repairDevWorker.status !== "PASS") {
    state.current_stage = "FAILED";
    state.errors = repairDevWorker.errors;
    writeCheckpoint(checkpointStatePath, state);
    return failedEvidence(withPlannerEvidence(state, { dev_worker_thread_id: devWorker.dev_worker_thread_id, initial_evaluator_thread_id: evaluator.evaluator_thread_id, repair_dev_worker_thread_id: repairDevWorker.dev_worker_thread_id, artifacts, stage_count: stageCount, failure_category: repairDevWorker.failure_category || "REPAIR_DEV_WORKER_FAILED", errors: repairDevWorker.errors, checkpoint_state_path: checkpointStatePath }));
  }
  state.current_stage = "REPAIR_DONE";
  writeCheckpoint(checkpointStatePath, state);
  artifacts.push(repairDevWorker.dev_result_path);

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
    test_log_path: resolve(input.paths.reports_dir, "treatment-validation.log"),
    diff_path: input.paths.diff_path,
    invocation_trace_label: "m12-feature-final-evaluator",
    invocation_trace_path: resolve(reportDir, "generic-final-evaluator-invocation-trace-redacted.json"),
    events_path: resolve(reportDir, "generic-final-evaluator-events.jsonl"),
    stdout_path: resolve(reportDir, "generic-final-evaluator-stdout.log"),
    stderr_path: resolve(reportDir, "generic-final-evaluator-stderr.log")
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
    return failedEvidence(withPlannerEvidence(state, { dev_worker_thread_id: devWorker.dev_worker_thread_id, initial_evaluator_thread_id: evaluator.evaluator_thread_id, repair_dev_worker_thread_id: repairDevWorker.dev_worker_thread_id, final_evaluator_thread_id: finalEvaluator.evaluator_thread_id, artifacts, stage_count: stageCount, failure_category: finalEvaluator.failure_category || "FINAL_EVAL_NOT_PASS", errors: finalEvaluator.errors, checkpoint_state_path: checkpointStatePath }));
  }
  state.current_stage = "FINAL_EVAL_DONE";
  writeCheckpoint(checkpointStatePath, state);
  artifacts.push(finalEvaluator.eval_report_path);
  const finalReportPath = writeGenericFinalReport({
    targetRepo: input.paths.target_repo,
    plannerThreadId: planner.planner_thread_id,
    devWorkerThreadId: devWorker.dev_worker_thread_id,
    initialEvaluatorThreadId: evaluator.evaluator_thread_id,
    repairDevWorkerThreadId: repairDevWorker.dev_worker_thread_id,
    finalEvaluatorThreadId: finalEvaluator.evaluator_thread_id,
    initialEvalVerdict: "NEEDS_REVISION",
    finalEvalVerdict: "PASS",
    validationPassed: repairDevWorker.tests_passed
  });
  artifacts.push(finalReportPath);
  state.current_stage = "FINAL_REPORT_DONE";
  state.final_report = { status: "PASS", path: finalReportPath };
  writeCheckpoint(checkpointStatePath, state);
  return {
    planner_thread_id: planner.planner_thread_id,
    dev_worker_thread_id: devWorker.dev_worker_thread_id,
    initial_evaluator_thread_id: evaluator.evaluator_thread_id,
    repair_dev_worker_thread_id: repairDevWorker.dev_worker_thread_id,
    final_evaluator_thread_id: finalEvaluator.evaluator_thread_id,
    initial_eval_verdict: "NEEDS_REVISION",
    final_eval_verdict: "PASS",
    repair_request_created: true,
    validation_passed: repairDevWorker.tests_passed,
    artifacts,
    final_report_path: finalReportPath,
    stage_count: stageCount,
    failure_category: repairDevWorker.tests_passed ? "" : "TESTS_FAILED",
    errors: repairDevWorker.tests_passed ? [] : ["Repair dev worker tests did not pass."],
    ...plannerEvidenceFromState(state),
    checkpoint_state_path: checkpointStatePath,
    ...evaluatorEvidence(evaluator, evaluatorConfig)
  };
}

function classifyFeaturePlannerFailure(category: string, status: string, noEventTimeout: boolean): string {
  if (noEventTimeout || category === "SDK_NO_EVENT_TIMEOUT") return "FEATURE_TREATMENT_PLANNER_STARTUP_NO_EVENT_TIMEOUT";
  if (category === "SDK_PLANNER_THREAD_STARTUP_TIMEOUT") return "FEATURE_TREATMENT_PLANNER_STARTUP_NO_EVENT_TIMEOUT";
  if (category === "SDK_PLANNER_TURN_TIMEOUT") return "FEATURE_TREATMENT_PLANNER_TURN_NO_EVENT_TIMEOUT";
  if (status === "TIMEOUT" || category === "SDK_THREAD_TIMEOUT" || category === "TIMEOUT") return "FEATURE_TREATMENT_PLANNER_TURN_NO_EVENT_TIMEOUT";
  if (/OUTPUT|SCHEMA|INVALID|POSTPROCESS|PLANNER_/i.test(category)) return "FEATURE_TREATMENT_PLANNER_POSTPROCESS_FAILED";
  return "FEATURE_TREATMENT_PLANNER_POSTPROCESS_FAILED";
}

function classifyFeaturePlannerFailureWithEvidence(input: {
  category: string;
  status: string;
  no_event_timeout: boolean;
  planner_thread_id: string;
  last_event_type: string;
}): string {
  if (input.no_event_timeout || input.category === "SDK_NO_EVENT_TIMEOUT") {
    return input.planner_thread_id || input.last_event_type ? "FEATURE_TREATMENT_PLANNER_TURN_NO_EVENT_TIMEOUT" : "FEATURE_TREATMENT_PLANNER_STARTUP_NO_EVENT_TIMEOUT";
  }
  return classifyFeaturePlannerFailure(input.category, input.status, input.no_event_timeout);
}

function classifyFeatureDevWorkerFailure(threadId: string, category: string): string {
  if (!threadId) return "FEATURE_TREATMENT_DEV_WORKER_NOT_STARTED_AFTER_PLANNER";
  return category || "DEV_WORKER_FAILED";
}

function createRepairRequest(targetRepo: string, evalReportPath: string, caseId: string): { status: "PASS" | "NEEDS_REVISION"; failure_category: string; errors: string[] } {
  const evalReport = JSON.parse(readFileSync(resolve(targetRepo, evalReportPath), "utf8")) as EvalReport;
  const profile = getGenericFeatureCaseProfile(caseId);
  const allowedScope = profile ? [profile.target_source_file, ...profile.target_test_files] : ["src/project-name.js", "test/project-name.test.js"];
  const repair = createRepairRequestFromEval({
    eval_report: evalReport,
    repair_id: `repair_${idSafe(caseId)}`,
    allowed_scope: allowedScope,
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

function failedEvidence(input: Partial<GenericFeatureEvidence> & { artifacts: string[]; stage_count: number; failure_category: string; errors: string[] }): GenericFeatureEvidence {
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
    errors: input.errors,
    planner_stage_attempted: input.planner_stage_attempted,
    planner_stage_completed: input.planner_stage_completed,
    planner_output_contract_version: input.planner_output_contract_version,
    planner_raw_output_path: input.planner_raw_output_path,
    planner_redacted_output_path: input.planner_redacted_output_path,
    planner_events_path: input.planner_events_path,
    planner_stdout_path: input.planner_stdout_path,
    planner_stderr_path: input.planner_stderr_path,
    planner_last_event_type: input.planner_last_event_type,
    planner_elapsed_ms: input.planner_elapsed_ms,
    planner_event_count: input.planner_event_count,
    checkpoint_state_path: input.checkpoint_state_path,
    initial_evaluator_events_path: input.initial_evaluator_events_path,
    initial_evaluator_stdout_path: input.initial_evaluator_stdout_path,
    initial_evaluator_stderr_path: input.initial_evaluator_stderr_path,
    initial_evaluator_raw_output_path: input.initial_evaluator_raw_output_path,
    initial_evaluator_redacted_output_path: input.initial_evaluator_redacted_output_path,
    initial_evaluator_last_event_type: input.initial_evaluator_last_event_type,
    initial_evaluator_elapsed_ms: input.initial_evaluator_elapsed_ms,
    initial_evaluator_event_count: input.initial_evaluator_event_count,
    initial_evaluator_prompt_length: input.initial_evaluator_prompt_length,
    initial_evaluator_prompt_hash: input.initial_evaluator_prompt_hash
  };
}

export async function runGenericFeatureEvaluatorRetry(options: GenericFeatureEvaluatorRetryOptions): Promise<{
  status: "PASS" | "BLOCKED";
  evaluator_thread_started: boolean;
  evaluator_thread_id: string;
  eval_verdict: "" | "PASS" | "NEEDS_REVISION";
  planner_rerun: false;
  dev_worker_rerun: false;
  failure_category: string;
  errors: string[];
}> {
  const repoRoot = options.repoRoot ?? process.cwd();
  const env = options.env ?? process.env;
  if (options.testCase.case_id !== "feature-small-001") {
    return {
      status: "BLOCKED",
      evaluator_thread_started: false,
      evaluator_thread_id: "",
      eval_verdict: "",
      planner_rerun: false,
      dev_worker_rerun: false,
      failure_category: "BLOCKED_TREATMENT_CASE_NOT_IMPLEMENTED",
      errors: [`Generic feature evaluator retry does not support ${options.testCase.case_id}.`]
    };
  }
  const sqliteHome = ensureEvalSqliteHome(repoRoot, env);
  if (!sqliteHome.ok) {
    return {
      status: "BLOCKED",
      evaluator_thread_started: false,
      evaluator_thread_id: "",
      eval_verdict: "",
      planner_rerun: false,
      dev_worker_rerun: false,
      failure_category: sqliteHome.reason ?? "BLOCKED_EVAL_SQLITE_HOME",
      errors: [sqliteHome.reason ?? "Eval sqlite home unavailable."]
    };
  }
  const paths = m12CasePaths(options.testCase, "treatment", repoRoot);
  const checkpointPath = resolve(paths.reports_dir, "treatment-generic-feature-state.json");
  const state = readCheckpoint(checkpointPath);
  if (!state) {
    return {
      status: "BLOCKED",
      evaluator_thread_started: false,
      evaluator_thread_id: "",
      eval_verdict: "",
      planner_rerun: false,
      dev_worker_rerun: false,
      failure_category: "FEATURE_TREATMENT_CHECKPOINT_STATE_INVALID",
      errors: ["Generic feature checkpoint state is missing or invalid."]
    };
  }
  const eligibility = featureEvaluatorRetryEligibility(state);
  if (!eligibility.eligible) {
    return {
      status: "BLOCKED",
      evaluator_thread_started: false,
      evaluator_thread_id: "",
      eval_verdict: "",
      planner_rerun: false,
      dev_worker_rerun: false,
      failure_category: eligibility.reason,
      errors: [`Evaluator retry is not eligible: ${eligibility.reason}.`]
    };
  }
  const reportDir = resolve(paths.reports_dir, "sdk-stage-logs");
  const evaluatorConfig = featureEvaluatorStageConfig({
    prd_path: state.planner.prd_path,
    task_graph_path: state.planner.task_graph_path,
    dev_result_path: state.dev_worker.dev_result_path,
    test_log_path: resolve(paths.reports_dir, "treatment-validation.log"),
    diff_path: paths.diff_path
  });
  const evaluator = await runEvaluatorLiteStage({
    loop_run_id: `loop_m12_${idSafe(options.testCase.case_id)}`,
    task_id: `task_${idSafe(options.testCase.case_id)}`,
    target_repo: paths.target_repo,
    prd_path: state.planner.prd_path,
    task_graph_path: state.planner.task_graph_path,
    dev_result_path: state.dev_worker.dev_result_path,
    model: env.CODEX_LOOP_CODEX_MODEL,
    model_catalog_json: env.CODEX_LOOP_MODEL_CATALOG_JSON,
    sqlite_home: sqliteHome.path,
    sandbox: "read-only",
    timeout_ms: 180_000,
    runtime_adapter: options.runtime_adapter,
    repo_root: paths.target_repo,
    report_dir: reportDir,
    artifact_path: "artifacts/eval-report.json",
    prompt_override: evaluatorConfig.prompt,
    test_log_path: resolve(paths.reports_dir, "treatment-validation.log"),
    diff_path: paths.diff_path,
    invocation_trace_label: "m12-feature-evaluator-retry",
    invocation_trace_path: resolve(reportDir, "generic-evaluator-retry-invocation-trace-redacted.json"),
    events_path: resolve(reportDir, "generic-evaluator-retry-events.jsonl"),
    stdout_path: resolve(reportDir, "generic-evaluator-retry-stdout.log"),
    stderr_path: resolve(reportDir, "generic-evaluator-retry-stderr.log")
  });
  state.evaluator = {
    status: evaluator.status,
    thread_id: evaluator.evaluator_thread_id,
    eval_verdict: evaluator.eval_verdict,
    eval_report_path: evaluator.eval_report_path
  };
  state.current_stage = evaluator.status === "PASS" || evaluator.status === "NEEDS_REVISION" ? "EVALUATOR_DONE" : "FAILED";
  state.errors = evaluator.errors;
  writeCheckpoint(checkpointPath, state);
  return {
    status: evaluator.status === "PASS" || evaluator.status === "NEEDS_REVISION" ? "PASS" : "BLOCKED",
    evaluator_thread_started: evaluator.evaluator_thread_started,
    evaluator_thread_id: evaluator.evaluator_thread_id,
    eval_verdict: evaluator.eval_verdict,
    planner_rerun: false,
    dev_worker_rerun: false,
    failure_category: evaluator.status === "PASS" || evaluator.status === "NEEDS_REVISION" ? "" : classifyFeatureEvaluatorFailure(
      evaluator.evaluator_thread_id,
      evaluator.failure_category,
      evaluator.status,
      evaluator.no_event_timeout
    ),
    errors: evaluator.errors
  };
}

function readCheckpoint(path: string): GenericFeatureCheckpointState | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as GenericFeatureCheckpointState;
  } catch {
    return null;
  }
}

function classifyFeatureEvaluatorFailure(threadId: string, category: string, status: string, noEventTimeout: boolean): string {
  if (noEventTimeout || category === "SDK_NO_EVENT_TIMEOUT") {
    return threadId ? "FEATURE_TREATMENT_EVALUATOR_TURN_NO_EVENT_TIMEOUT" : "FEATURE_TREATMENT_EVALUATOR_STARTUP_NO_EVENT_TIMEOUT";
  }
  if (status === "TIMEOUT" || category === "SDK_THREAD_TIMEOUT" || category === "TIMEOUT") {
    return threadId ? "FEATURE_TREATMENT_EVALUATOR_TURN_NO_EVENT_TIMEOUT" : "FEATURE_TREATMENT_EVALUATOR_STARTUP_NO_EVENT_TIMEOUT";
  }
  if (/PROMPT_TOO_LARGE|PROMPT/i.test(category)) return "FEATURE_TREATMENT_EVALUATOR_PROMPT_TOO_LARGE";
  if (/OUTPUT|SCHEMA|INVALID|POSTPROCESS|EVAL_REPORT/i.test(category)) return "FEATURE_TREATMENT_EVALUATOR_POSTPROCESS_FAILED";
  return category || "FEATURE_TREATMENT_EVALUATOR_FAILED";
}

function evaluatorEvidence(
  evaluator: Awaited<ReturnType<typeof runEvaluatorLiteStage>>,
  config: ReturnType<typeof featureEvaluatorStageConfig>
): Partial<GenericFeatureEvidence> {
  return {
    initial_evaluator_events_path: evaluator.runtime_input.error_capture_paths?.events_path ?? "",
    initial_evaluator_stdout_path: evaluator.runtime_input.error_capture_paths?.stdout_path ?? "",
    initial_evaluator_stderr_path: evaluator.runtime_input.error_capture_paths?.stderr_path ?? "",
    initial_evaluator_raw_output_path: evaluator.runtime_input.error_capture_paths?.stdout_path ?? "",
    initial_evaluator_redacted_output_path: "",
    initial_evaluator_last_event_type: evaluator.last_event_type,
    initial_evaluator_elapsed_ms: evaluator.elapsed_ms,
    initial_evaluator_event_count: evaluator.event_count,
    initial_evaluator_prompt_length: config.prompt_length,
    initial_evaluator_prompt_hash: config.prompt_hash
  };
}

function writeCheckpoint(path: string, state: GenericFeatureCheckpointState): void {
  writeFile(path, `${JSON.stringify(state, null, 2)}\n`);
}

function plannerEvidenceFromState(state: GenericFeatureCheckpointState): Partial<GenericFeatureEvidence> {
  return {
    planner_stage_attempted: state.planner.stage_attempted === true,
    planner_stage_completed: state.planner.stage_completed === true,
    planner_output_contract_version: state.planner.output_contract_version ?? "",
    planner_raw_output_path: state.planner.raw_output_path ?? "",
    planner_redacted_output_path: state.planner.redacted_output_path ?? "",
    planner_events_path: state.planner.events_path ?? "",
    planner_stdout_path: state.planner.stdout_path ?? "",
    planner_stderr_path: state.planner.stderr_path ?? "",
    planner_last_event_type: state.planner.last_event_type ?? "",
    planner_elapsed_ms: state.planner.elapsed_ms ?? 0,
    planner_event_count: state.planner.event_count ?? 0
  };
}

function withPlannerEvidence<T extends Partial<GenericFeatureEvidence>>(state: GenericFeatureCheckpointState, input: T): T & Partial<GenericFeatureEvidence> {
  return {
    ...input,
    planner_thread_id: input.planner_thread_id ?? state.planner.thread_id,
    ...plannerEvidenceFromState(state)
  };
}

function writeGenericFinalReport(input: {
  targetRepo: string;
  plannerThreadId: string;
  devWorkerThreadId: string;
  initialEvaluatorThreadId: string;
  repairDevWorkerThreadId: string;
  finalEvaluatorThreadId: string;
  initialEvalVerdict: string;
  finalEvalVerdict: string;
  validationPassed: boolean;
}): string {
  const path = "artifacts/FinalDeliveryReport.md";
  writeTargetText(input.targetRepo, path, [
    "# FinalDeliveryReport",
    "",
    "## Summary",
    "",
    "M12 generic feature treatment completed through SDK-Orchestrated planner, dev worker, evaluator, and final report stages.",
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
    ""
  ].join("\n"));
  return path;
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
