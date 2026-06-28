import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import type { EvalReport } from "../core/types.ts";
import { validateWithSchema } from "../core/validate.ts";
import { createRepairRequestFromEval } from "../orchestrator/create-repair-request-from-eval.ts";
import { devWorkerLiteOutputSchema } from "../orchestrator/dev-worker-lite-output.ts";
import { hydrateEvalReport } from "../orchestrator/hydrate-eval-report.ts";
import { parseDevWorkerLiteOutput } from "../orchestrator/parse-dev-worker-lite-output.ts";
import { parseEvaluatorLiteOutput } from "../orchestrator/parse-evaluator-lite-output.ts";
import { runEvaluatorLiteStage } from "../orchestrator/sdk-evaluator-stage.ts";
import { runPlannerLiteStage } from "../orchestrator/sdk-planner-lite-stage.ts";
import type { RuntimeAdapter } from "../runtime/runtime-adapter.ts";
import { ensureEvalSqliteHome } from "../runtime/eval-sqlite-home.ts";
import { SdkRuntimeAdapter } from "../runtime/sdk-runtime-adapter.ts";
import type { RuntimeThreadInput, RuntimeThreadResult } from "../runtime/runtime-types.ts";
import type { M12Case, M12RunResult } from "../../scripts/effectiveness/types.ts";
import { bugfixEvaluatorStageConfig } from "./bugfix-evaluator-stage.ts";
import { bugfixPlannerStageConfig } from "./bugfix-planner-stage.ts";
import { emptyGenericBugfixCheckpointState, type GenericBugfixCheckpointState } from "./generic-bugfix-checkpoint-state.ts";
import { clearM12ModeOutputs, inspectM12ModeCheckpoint, prepareM12BugfixFixture, type M12CasePaths } from "./effectiveness-fixtures.ts";
import { getGenericBugfixCaseProfile, genericBugfixCaseSupported, type GenericBugfixCaseProfile } from "./generic-bugfix-case-profile.ts";

export interface GenericBugfixTreatmentOptions {
  testCase: M12Case;
  repoRoot?: string;
  resume?: boolean;
  fresh?: boolean;
  env?: NodeJS.ProcessEnv;
  runtime_adapter?: RuntimeAdapter;
  now?: () => number;
}

interface BugfixDevWorkerStageResult {
  status: "PASS" | "NEEDS_REVISION" | "BLOCKED" | "TIMEOUT";
  failure_category: string;
  thread_id: string;
  file_change_verified: boolean;
  tests_run: string[];
  tests_passed: boolean;
  dev_result_path: string;
  errors: string[];
}

interface GenericBugfixEvidence {
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
}

export async function runGenericBugfixTreatment(options: GenericBugfixTreatmentOptions): Promise<M12RunResult> {
  const repoRoot = options.repoRoot ?? process.cwd();
  const env = options.env ?? process.env;
  if (!genericBugfixCaseSupported(options.testCase)) {
    return createGenericBugfixBlockedResult(options.testCase, [`Generic bugfix treatment does not support ${options.testCase.case_id}.`], "BLOCKED_TREATMENT_CASE_NOT_IMPLEMENTED");
  }
  const sqliteHome = ensureEvalSqliteHome(repoRoot, env);
  if (!sqliteHome.ok) {
    return createGenericBugfixBlockedResult(options.testCase, [sqliteHome.reason ?? "Eval sqlite home unavailable."], sqliteHome.reason ?? "BLOCKED_EVAL_SQLITE_HOME");
  }
  if (options.fresh) {
    clearM12ModeOutputs(options.testCase, "treatment", repoRoot);
  } else {
    const checkpoint = inspectM12ModeCheckpoint(options.testCase, "treatment", repoRoot);
    if (checkpoint.failed) {
      const category = options.resume ? "BLOCKED_M12_RESUME_FAILED_CHECKPOINT" : "BLOCKED_M12_STALE_FAILED_CHECKPOINT";
      return createGenericBugfixBlockedResult(options.testCase, [`${category}: existing treatment checkpoint/result is ${checkpoint.result_status || checkpoint.checkpoint_stage || "failed"}. Use --fresh for one approved rerun.`], category);
    }
  }

  const startedAt = options.now?.() ?? Date.now();
  const paths = prepareM12BugfixFixture({ testCase: options.testCase, variant: "treatment", repoRoot, resume: options.resume });
  const adapter = options.runtime_adapter ?? new SdkRuntimeAdapter({ enableRealRun: true, repoRoot, preferStreamed: false });
  const evidence = await runGenericBugfixStages({
    testCase: options.testCase,
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
    planner_stage_attempted: Boolean(evidence.planner_thread_id),
    planner_stage_completed: Boolean(evidence.planner_thread_id && evidence.artifacts.includes("docs/PRD.md")),
    planner_output_contract_version: "v2",
    dev_worker_thread_id: evidence.dev_worker_thread_id,
    initial_evaluator_thread_id: evidence.initial_evaluator_thread_id,
    repair_dev_worker_thread_id: evidence.repair_dev_worker_thread_id,
    final_evaluator_thread_id: evidence.final_evaluator_thread_id,
    validation_passed: evidence.validation_passed,
    diff_path: paths.diff_path,
    final_report_path: evidence.final_report_path,
    artifact_thread_evidence_verified: evidence.artifacts.length > 0,
    danger_full_access_used: false,
    current_stage: status === "PASS" ? "FINAL_REPORT_DONE" : "FAILED",
    failure_category: evidence.failure_category,
    errors: evidence.errors
  };
}

export function createGenericBugfixBlockedResult(testCase: M12Case, errors: string[], failureCategory: string): M12RunResult {
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

async function runGenericBugfixStages(input: {
  testCase: M12Case;
  paths: M12CasePaths;
  repoRoot: string;
  sqliteHome: string;
  adapter: RuntimeAdapter;
  env: NodeJS.ProcessEnv;
}): Promise<GenericBugfixEvidence> {
  const profile = getGenericBugfixCaseProfile(input.testCase);
  if (!profile) {
    return failedEvidence({ artifacts: [], stage_count: 0, failure_category: "BLOCKED_TREATMENT_CASE_NOT_IMPLEMENTED", errors: [`Generic bugfix treatment does not support ${input.testCase.case_id}.`] });
  }
  const reportDir = resolve(input.paths.reports_dir, "sdk-stage-logs");
  const checkpointStatePath = resolve(input.paths.reports_dir, "treatment-generic-bugfix-state.json");
  const state = emptyGenericBugfixCheckpointState();
  writeCheckpoint(checkpointStatePath, state);
  const loopRunId = `loop_m12_${idSafe(input.testCase.case_id)}`;
  const taskId = `task_${idSafe(input.testCase.case_id)}`;
  const artifacts: string[] = [];
  let stageCount = 0;
  const plannerConfig = bugfixPlannerStageConfig(input.testCase);
  const evaluatorConfig = bugfixEvaluatorStageConfig({
    testCase: input.testCase,
    prd_path: "docs/PRD.md",
    task_graph_path: "docs/TASK_GRAPH.json",
    dev_result_path: "artifacts/dev-result.json",
    test_log_path: resolve(input.paths.reports_dir, "treatment-validation.log"),
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
    invocation_trace_label: "m12-bugfix-planner",
    invocation_trace_path: resolve(reportDir, "generic-bugfix-planner-invocation-trace-redacted.json"),
    events_path: resolve(reportDir, "generic-bugfix-planner-events.jsonl"),
    stdout_path: resolve(reportDir, "generic-bugfix-planner-stdout.log"),
    stderr_path: resolve(reportDir, "generic-bugfix-planner-stderr.log")
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
    stdout_path: resolve(reportDir, "generic-bugfix-planner-stdout.log"),
    stderr_path: resolve(reportDir, "generic-bugfix-planner-stderr.log"),
    last_event_type: planner.last_event_type,
    elapsed_ms: planner.elapsed_ms,
    event_count: planner.event_count,
    failure_category: planner.status === "PASS" ? "" : planner.failure_category || "BUGFIX_TREATMENT_PLANNER_FAILED"
  };
  if (planner.status !== "PASS") {
    state.current_stage = "FAILED";
    state.errors = planner.errors;
    writeCheckpoint(checkpointStatePath, state);
    return failedEvidence({
      planner_thread_id: planner.planner_thread_id,
      artifacts,
      stage_count: stageCount,
      failure_category: state.planner.failure_category || "BUGFIX_TREATMENT_PLANNER_FAILED",
      errors: planner.errors
    });
  }
  state.current_stage = "PLANNER_DONE";
  writeCheckpoint(checkpointStatePath, state);
  artifacts.push(planner.prd_path, planner.task_graph_path, planner.planner_result_path);

  const devWorker = await runBugfixDevWorkerStage({
    profile,
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
    artifact_path: "artifacts/dev-result.json"
  });
  stageCount += 1;
  state.dev_worker = {
    status: devWorker.status,
    thread_id: devWorker.thread_id,
    file_change_verified: devWorker.file_change_verified,
    tests_passed: devWorker.tests_passed,
    dev_result_path: devWorker.dev_result_path
  };
  if (devWorker.status !== "PASS") {
    state.current_stage = "FAILED";
    state.errors = devWorker.errors;
    writeCheckpoint(checkpointStatePath, state);
    return failedEvidence({
      planner_thread_id: planner.planner_thread_id,
      dev_worker_thread_id: devWorker.thread_id,
      artifacts,
      stage_count: stageCount,
      failure_category: devWorker.failure_category || "BUGFIX_TREATMENT_DEV_WORKER_FAILED",
      errors: devWorker.errors
    });
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
    sdk_method: "run",
    test_log_path: resolve(input.paths.reports_dir, "treatment-validation.log"),
    diff_path: input.paths.diff_path,
    invocation_trace_label: "m12-bugfix-evaluator",
    invocation_trace_path: resolve(reportDir, "generic-bugfix-evaluator-invocation-trace-redacted.json"),
    events_path: resolve(reportDir, "generic-bugfix-evaluator-events.jsonl"),
    stdout_path: resolve(reportDir, "generic-bugfix-evaluator-stdout.log"),
    stderr_path: resolve(reportDir, "generic-bugfix-evaluator-stderr.log")
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
    const finalReportPath = writeGenericBugfixFinalReport({
      targetRepo: input.paths.target_repo,
      plannerThreadId: planner.planner_thread_id,
      devWorkerThreadId: devWorker.thread_id,
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
      failure_category: devWorker.tests_passed ? "" : "TESTS_FAILED",
      errors: devWorker.tests_passed ? [] : ["Dev worker tests did not pass."]
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
      failure_category: evaluator.failure_category || "BUGFIX_TREATMENT_EVALUATOR_FAILED",
      errors: evaluator.errors
    });
  }
  state.current_stage = "EVALUATOR_DONE";
  writeCheckpoint(checkpointStatePath, state);

  const repairCreated = createBugfixRepairRequest(input.paths.target_repo, evaluator.eval_report_path, input.testCase.case_id);
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

  const repairDevWorker = await runBugfixDevWorkerStage({
    profile,
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
    return failedEvidence({ planner_thread_id: planner.planner_thread_id, dev_worker_thread_id: devWorker.thread_id, initial_evaluator_thread_id: evaluator.evaluator_thread_id, repair_dev_worker_thread_id: repairDevWorker.thread_id, artifacts, stage_count: stageCount, failure_category: repairDevWorker.failure_category || "BUGFIX_TREATMENT_REPAIR_DEV_WORKER_FAILED", errors: repairDevWorker.errors });
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
    sdk_method: "run",
    test_log_path: resolve(input.paths.reports_dir, "treatment-validation.log"),
    diff_path: input.paths.diff_path,
    invocation_trace_label: "m12-bugfix-final-evaluator",
    invocation_trace_path: resolve(reportDir, "generic-bugfix-final-evaluator-invocation-trace-redacted.json"),
    events_path: resolve(reportDir, "generic-bugfix-final-evaluator-events.jsonl"),
    stdout_path: resolve(reportDir, "generic-bugfix-final-evaluator-stdout.log"),
    stderr_path: resolve(reportDir, "generic-bugfix-final-evaluator-stderr.log")
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
  state.current_stage = "FINAL_EVAL_DONE";
  writeCheckpoint(checkpointStatePath, state);
  artifacts.push(finalEvaluator.eval_report_path);
  const finalReportPath = writeGenericBugfixFinalReport({
    targetRepo: input.paths.target_repo,
    plannerThreadId: planner.planner_thread_id,
    devWorkerThreadId: devWorker.thread_id,
    initialEvaluatorThreadId: evaluator.evaluator_thread_id,
    repairDevWorkerThreadId: repairDevWorker.thread_id,
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
    failure_category: repairDevWorker.tests_passed ? "" : "TESTS_FAILED",
    errors: repairDevWorker.tests_passed ? [] : ["Repair dev worker tests did not pass."]
  };
}

async function runBugfixDevWorkerStage(input: {
  profile: GenericBugfixCaseProfile;
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
  artifact_path: string;
}): Promise<BugfixDevWorkerStageResult> {
  const before = readTargetSource(input.target_repo, input.profile.target_source_file);
  const runtimeInput = createBugfixDevWorkerRuntimeInput(input);
  const thread = await input.adapter.runThread(runtimeInput);
  const after = readTargetSource(input.target_repo, input.profile.target_source_file);
  if (thread.status === "TIMEOUT") return bugfixDevFailure(thread, "TIMEOUT", "SDK_THREAD_TIMEOUT");
  if (!thread.thread_id) return bugfixDevFailure(thread, "BLOCKED", thread.failure_category || "DEV_WORKER_THREAD_STARTUP_FAILURE");
  const parsed = parseDevWorkerLiteOutput(thread.final_response);
  if (parsed.status !== "PASS" || !parsed.output) return bugfixDevFailure(thread, "NEEDS_REVISION", parsed.failure_category || "DEV_WORKER_RESULT_SCHEMA_INVALID", parsed.errors);
  if (!parsed.output.changed_files.includes(input.profile.target_source_file)) {
    return bugfixDevFailure(thread, "NEEDS_REVISION", "DEV_WORKER_NO_FILE_CHANGE", [`changed_files must include ${input.profile.target_source_file}.`]);
  }
  if (!parsed.output.tests_run.some((command) => command === "npm test" || command.includes("npm test"))) return bugfixDevFailure(thread, "NEEDS_REVISION", "DEV_WORKER_NO_TEST", ["tests_run must include npm test."]);
  if (!parsed.output.tests_passed) return bugfixDevFailure(thread, "NEEDS_REVISION", "DEV_WORKER_TESTS_FAILED", ["tests_passed must be true."]);
  if (before === after) return bugfixDevFailure(thread, "NEEDS_REVISION", "DEV_WORKER_NO_FILE_CHANGE", [`${input.profile.target_source_file} did not change.`]);
  const artifactPath = input.artifact_path;
  writeTargetJson(input.target_repo, artifactPath, {
    status: "PASS",
    changed_files: parsed.output.changed_files,
    tests_run: parsed.output.tests_run,
    tests_passed: parsed.output.tests_passed,
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
    tests_passed: parsed.output.tests_passed,
    dev_result_path: artifactPath,
    errors: thread.errors
  };
}

function createBugfixDevWorkerRuntimeInput(input: Parameters<typeof runBugfixDevWorkerStage>[0]): RuntimeThreadInput {
  return {
    role: "dev_worker",
    loop_run_id: input.loop_run_id,
    task_id: input.task_id,
    prompt: input.profile.dev_worker_prompt.replace("Read docs/PRD.md and docs/TASK_GRAPH.json.", `Read ${input.prd_path} and ${input.task_graph_path}.`),
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
    invocation_trace_path: resolve(input.report_dir, "generic-bugfix-dev-worker-invocation-trace-redacted.json"),
    invocation_trace_label: "m12-bugfix-dev-worker",
    error_capture_paths: {
      events_path: resolve(input.report_dir, "generic-bugfix-dev-worker-events.jsonl"),
      stdout_path: resolve(input.report_dir, "generic-bugfix-dev-worker-stdout.log"),
      stderr_path: resolve(input.report_dir, "generic-bugfix-dev-worker-stderr.log")
    },
    no_event_timeout_ms: Number.parseInt(process.env.CODEX_LOOP_SDK_NO_EVENT_TIMEOUT_MS ?? "30000", 10),
    env: {
      CODEX_SQLITE_HOME: input.sqlite_home
    }
  };
}

function bugfixDevFailure(thread: RuntimeThreadResult, status: BugfixDevWorkerStageResult["status"], failureCategory: string, extraErrors: string[] = []): BugfixDevWorkerStageResult {
  return {
    status,
    failure_category: failureCategory,
    thread_id: thread.thread_id,
    file_change_verified: false,
    tests_run: [],
    tests_passed: false,
    dev_result_path: "",
    errors: [...thread.errors, ...extraErrors]
  };
}

function createBugfixRepairRequest(targetRepo: string, evalReportPath: string, caseId: string): { status: "PASS" | "NEEDS_REVISION"; failure_category: string; errors: string[] } {
  const profile = getGenericBugfixCaseProfile(caseId);
  if (!profile) {
    return { status: "NEEDS_REVISION", failure_category: "BLOCKED_TREATMENT_CASE_NOT_IMPLEMENTED", errors: [`Generic bugfix treatment does not support ${caseId}.`] };
  }
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

function writeGenericBugfixFinalReport(input: {
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
    "M12 generic bugfix treatment completed through SDK-Orchestrated planner, dev worker, evaluator, and final report stages.",
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

function failedEvidence(input: Partial<GenericBugfixEvidence> & { artifacts: string[]; stage_count: number; failure_category: string; errors: string[] }): GenericBugfixEvidence {
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
    errors: input.errors
  };
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

function readTargetSource(targetRepo: string, targetSourceFile: string): string {
  try {
    return readFileSync(resolve(targetRepo, targetSourceFile), "utf8");
  } catch {
    return "";
  }
}

function writeCheckpoint(path: string, state: GenericBugfixCheckpointState): void {
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
