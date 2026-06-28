import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const repoRoot = process.cwd();
const resultPath = resolve(repoRoot, "evals/sdk-orchestrated/reports/gate6b-smoke-result.json");
const verifyPath = resolve(repoRoot, "evals/sdk-orchestrated/reports/gate6b-smoke-verify.json");
const parityPath = resolve(repoRoot, "evals/sdk-orchestrated/reports/sdk-startup-triage/sdk-parity-smoke-result.json");
const startupTriageDir = resolve(repoRoot, "evals/sdk-orchestrated/reports/sdk-startup-triage");
const reportPath = resolve(repoRoot, "evals/sdk-orchestrated/reports/Gate6B_Smoke_Report.md");

function main(): void {
  const result = readJson(resultPath);
  const verify = readJson(verifyPath);
  const parity = readJson(parityPath);
  const sdkDependencyDetected = result.sdk_dependency_detected === true;
  const sdkParityPassed = parity.status === "PASS" && parity.sdk_thread_started === true && typeof parity.sdk_thread_id === "string" && parity.sdk_thread_id.length > 0;
  const plannerSmokeGatePassed = allPlannerModesPassed();
  const devWorkerSmokeGatePassed = allDevWorkerModesPassed();
  const lines = [
    "# Gate 6B.1 SDK-Orchestrated Smoke Report",
    "",
    "Date: 2026-06-20",
    "",
    `Run status: ${String(result.status ?? "NOT_RUN")}`,
    `Verify status: ${String(verify.status ?? "NOT_RUN")}`,
    `Real SDK run executed: ${String(result.real_sdk_run_executed === true)}`,
    `SDK dependency detected: ${String(sdkDependencyDetected)}`,
    `SDK sandbox control: ${String(result.sdk_sandbox_control ?? "UNVERIFIED")}`,
    `Failure category: ${String(result.failure_category ?? "")}`,
    `Planner smoke gate passed: ${String(plannerSmokeGatePassed)}`,
    `Dev worker smoke gate passed: ${String(devWorkerSmokeGatePassed)}`,
    `Planner lite stage shared: ${String(result.planner_stage_shared === true)}`,
    `Planner stage impl: ${String(result.planner_stage_impl ?? "")}`,
    `TaskGraph schema valid: ${String(result.task_graph_schema_valid === true)}`,
    `Dev worker stage shared: ${String(result.dev_worker_stage_shared === true)}`,
    `Dev worker stage impl: ${String(result.dev_worker_stage_impl ?? "")}`,
    `Schema-output-planner required: ${String(result.schema_output_planner_required === true)}`,
    `Sequential execution enforced: ${String(result.sequential_execution_enforced === true)}`,
    `Stage execution order: ${JSON.stringify(result.stage_execution_order ?? [])}`,
    `Target repo: ${String(result.target_repo ?? "tmp/sdk-orchestrated/gate6b-smoke-target")}`,
    `Thread budget: max 3 SDK threads, ${String(result.thread_timeout_ms ?? 180000)} ms each, zero retries`,
    `M12 blocked: true`,
    "",
    "Gate 6B.1 is a three-thread SDK smoke harness: planner, dev_worker, evaluator. It is not the full repair-loop E2E and cannot unblock M12.",
    "",
    "Default dry-run behavior is expected to return `BLOCKED_SDK_NOT_ENABLED` unless `CODEX_LOOP_ENABLE_REAL_SDK_RUN=1` is explicitly set in a controlled host terminal.",
    "",
    `SDK parity passed: ${String(sdkParityPassed)}`,
    "",
    "The three-thread SDK smoke must not start until SDK parity, planner smoke slices (`parity-as-planner`, `minimal`, `schema-text-only`, `schema-output-minimal`, `schema-output-lite`), and dev worker smoke slices (`parity`, `minimal-fix`, `output-lite`) have all produced PASS evidence. `schema-output-planner` is diagnostic-only and is not a Gate 6B.1 prerequisite.",
    "",
    "If a real SDK smoke fails before thread startup with Codex model catalog refresh errors, classify it as `CODEX_MODEL_CATALOG_REFRESH_FAILED` and run `npm run codex:model:catalog:diagnose` before retrying.",
    "",
    nextManualAction(sdkDependencyDetected, sdkParityPassed, plannerSmokeGatePassed, devWorkerSmokeGatePassed),
    ""
  ];
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${lines.join("\n")}\n`, "utf8");
}

function nextManualAction(sdkDependencyDetected: boolean, sdkParityPassed: boolean, plannerSmokeGatePassed: boolean, devWorkerSmokeGatePassed: boolean): string {
  const result = readJson(resultPath);
  if (result.status === "BLOCKED_USE_CHECKPOINTED_SMOKE") {
    return "Next manual action: use checkpointed Gate 6B.1: `npm run gate6b:checkpoint:prepare`, then planner, dev-worker, evaluator, verify, and report one stage at a time.";
  }
  if (!sdkDependencyDetected) {
    return "Next manual action: after explicit user approval, install or otherwise make `@openai/codex-sdk` resolvable, then run SDK parity smoke.";
  }
  if (!sdkParityPassed) {
    return "Next manual action: run exactly one SDK parity smoke with `CODEX_LOOP_ENABLE_REAL_SDK_PARITY=1 npm run gate6b:sdk-parity:run`, then verify/report. Do not run the three-thread smoke until parity passes.";
  }
  if (!plannerSmokeGatePassed) {
    return "Next manual action: run exactly one planner schema-output-lite SDK smoke. If it passes, run exactly one Gate 6B.1 three-thread smoke. schema-output-planner remains diagnostic only.";
  }
  if (!devWorkerSmokeGatePassed) {
    return "Next manual action: run dev-worker parity once. If it passes, run minimal-fix once, then output-lite once. Only after all pass, retry Gate 6B.1 three-thread smoke.";
  }
  return "Next manual action: run exactly one three-thread SDK smoke with `CODEX_LOOP_ENABLE_REAL_SDK_RUN=1 npm run gate6b:smoke:run`, then verify/report.";
}

function readJson(path: string): Record<string, unknown> {
  if (!existsSync(path)) {
    return {};
  }
  const text = readFileSync(path, "utf8").trim();
  if (!text) {
    return {};
  }
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return {};
  }
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
      result.planner_thread_id.length > 0
    );
  });
}

main();
