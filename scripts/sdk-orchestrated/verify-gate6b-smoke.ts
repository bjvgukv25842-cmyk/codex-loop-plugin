import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const repoRoot = process.cwd();
const resultPath = resolve(repoRoot, "evals/sdk-orchestrated/reports/gate6b-smoke-result.json");
const verifyPath = resolve(repoRoot, "evals/sdk-orchestrated/reports/gate6b-smoke-verify.json");
const parityPath = resolve(repoRoot, "evals/sdk-orchestrated/reports/sdk-startup-triage/sdk-parity-smoke-result.json");
const startupTriageDir = resolve(repoRoot, "evals/sdk-orchestrated/reports/sdk-startup-triage");

interface VerifyResult {
  status: "PASS" | "NEEDS_REVISION";
  dry_run_status: string;
  real_sdk_run_executed: boolean;
  sdk_dependency_detected: boolean;
  ready_for_one_real_sdk_smoke: boolean;
  planner_smoke_gate_passed: boolean;
  dev_worker_smoke_gate_passed: boolean;
  gate6b_smoke_uses_shared_planner_stage: boolean;
  gate6b_smoke_uses_shared_dev_worker_stage: boolean;
  task_graph_schema_valid_when_planner_passes: boolean;
  schema_output_planner_removed_from_gate6b_requirements: boolean;
  gate6b_smoke_sequential_execution_enforced: boolean;
  prerequisites_missing: string[];
  failure_category: string;
  errors: string[];
}

function main(): void {
  const result = readJson(resultPath);
  const parity = readJson(parityPath);
  const sdkParityPassed =
    parity.status === "PASS" &&
    parity.sdk_thread_started === true &&
    typeof parity.sdk_thread_id === "string" &&
    parity.sdk_thread_id.length > 0 &&
    parity.final_response_contains_expected === true;
  const plannerSmokeGatePassed = allPlannerModesPassed();
  const devWorkerSmokeGatePassed = allDevWorkerModesPassed();
  const safeBlockedStatus =
    result.status === "BLOCKED_USE_CHECKPOINTED_SMOKE" ||
    result.status === "BLOCKED_SDK_NOT_ENABLED" ||
    result.status === "BLOCKED_PLANNER_SMOKE_NOT_PASSED" ||
    result.status === "BLOCKED_PLANNER_SCHEMA_SMOKE_NOT_PASSED" ||
    result.status === "BLOCKED_PLANNER_LITE_SMOKE_NOT_PASSED" ||
    result.status === "BLOCKED_DEV_WORKER_SMOKE_NOT_PASSED";
  const dryRunOk =
    safeBlockedStatus &&
    result.real_sdk_run_executed === false &&
    result.max_sdk_threads === 3 &&
    result.thread_timeout_ms === 180000 &&
    result.max_retries === 0 &&
    result.planner_sandbox === "read-only" &&
    result.dev_worker_sandbox === "workspace-write" &&
    result.evaluator_sandbox === "read-only" &&
    result.danger_full_access_used === false &&
    result.secret_leak_detected === false &&
    result.planner_stage_shared === true &&
    result.planner_stage_impl === "runPlannerLiteStage" &&
    result.dev_worker_stage_shared === true &&
    result.dev_worker_stage_impl === "runDevWorkerStage" &&
    result.schema_output_planner_required === false &&
    result.sequential_execution_enforced === true;

  const verify: VerifyResult = {
    status: dryRunOk ? "PASS" : "NEEDS_REVISION",
    dry_run_status: typeof result.status === "string" ? result.status : "NOT_RUN",
    real_sdk_run_executed: result.real_sdk_run_executed === true,
    sdk_dependency_detected: result.sdk_dependency_detected === true,
    ready_for_one_real_sdk_smoke: result.status === "BLOCKED_USE_CHECKPOINTED_SMOKE" ? false : dryRunOk && result.sdk_dependency_detected === true && sdkParityPassed && plannerSmokeGatePassed && devWorkerSmokeGatePassed,
    planner_smoke_gate_passed: plannerSmokeGatePassed,
    dev_worker_smoke_gate_passed: devWorkerSmokeGatePassed,
    gate6b_smoke_uses_shared_planner_stage: result.planner_stage_shared === true && result.planner_stage_impl === "runPlannerLiteStage",
    gate6b_smoke_uses_shared_dev_worker_stage: result.dev_worker_stage_shared === true && result.dev_worker_stage_impl === "runDevWorkerStage",
    task_graph_schema_valid_when_planner_passes: result.planner_thread_started === true ? result.task_graph_schema_valid === true : true,
    schema_output_planner_removed_from_gate6b_requirements: result.schema_output_planner_required === false,
    gate6b_smoke_sequential_execution_enforced: result.sequential_execution_enforced === true,
    prerequisites_missing: result.sdk_dependency_detected === true ? [] : ["@openai/codex-sdk"],
    failure_category: typeof result.failure_category === "string" ? result.failure_category : "",
    errors: dryRunOk ? [] : ["gate6b smoke must default to a safe blocked dry-run without starting real SDK threads."]
  };

  writeJson(verifyPath, verify);
  process.stdout.write(`${JSON.stringify(verify, null, 2)}\n`);
  process.exitCode = verify.status === "PASS" ? 0 : 2;
}

function allDevWorkerModesPassed(): boolean {
  return ["parity", "minimal-fix", "output-lite"].every((mode) => {
    const result = readJson(resolve(startupTriageDir, `dev-worker-smoke-${mode}-result.json`));
    const basePass =
      result.status === "PASS" &&
      result.dev_worker_thread_started === true &&
      typeof result.dev_worker_thread_id === "string" &&
      result.dev_worker_thread_id.length > 0;
    if (!basePass) return false;
    if (mode === "parity") return result.final_response_contains_expected === true;
    if (mode === "minimal-fix") return result.file_change_verified === true && result.tests_passed === true;
    return (
      result.structured_output_valid === true &&
      result.file_change_verified === true &&
      result.tests_passed === true &&
      result.dev_worker_stage_shared === true &&
      result.dev_worker_stage_impl === "runDevWorkerStage"
    );
  });
}

function allPlannerModesPassed(): boolean {
  return ["parity-as-planner", "minimal", "schema-text-only", "schema-output-minimal", "schema-output-lite"].every((mode) => {
    const result = readJson(resolve(startupTriageDir, `planner-smoke-${mode}-result.json`));
    return (
      result.status === "PASS" &&
      result.planner_thread_started === true &&
      typeof result.planner_thread_id === "string" &&
      result.planner_thread_id.length > 0 &&
      (mode === "schema-output-lite" ? plannerLiteTaskGraphSchemaValid(result) : true)
    );
  });
}

function plannerLiteTaskGraphSchemaValid(result: Record<string, unknown>): boolean {
  return (
    result.task_graph_schema_valid === true ||
    (result.structured_output_valid === true &&
      result.prd_artifact_created === true &&
      result.task_graph_artifact_created === true &&
      result.artifact_thread_evidence_verified === true)
  );
}

function readJson(path: string): Record<string, unknown> {
  if (!existsSync(path)) {
    return {};
  }
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

main();
