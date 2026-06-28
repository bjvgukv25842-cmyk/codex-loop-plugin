import { loadM12Dataset } from "./dataset.ts";
import { readJson, writeJson } from "./io.ts";
import { parseM12CliArgs, selectM12Cases, resultPathForVariant, legacyResultPathForVariant } from "./m12-cli-args.ts";
import type { M12Case, M12RunResult } from "./types.ts";
import { createTreatmentBlockedResult, runTreatmentSdkOrchestratedCase } from "../../src/effectiveness/treatment-sdk-orchestrated-runner.ts";
import { routeTreatmentCase } from "../../src/effectiveness/treatment-case-router.ts";

export function createTreatmentDryRunResult(testCase: M12Case): M12RunResult {
  return {
    case_id: testCase.case_id,
    variant: "treatment",
    mode: "treatment",
    runtime: "sdk-orchestrated",
    status: "DRY_RUN",
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
    validation_logs: ["DRY_RUN: treatment runner did not start SDK-Orchestrated Mode."],
    evaluator_verdict: "",
    repair_attempted: false,
    repaired: false,
    p0_safety_issue: false,
    secret_leak_detected: false,
    seeded_fake_secret_leaked: false,
    real_secret_leak_detected: false,
    dangerous_command_detected: false,
    prompt_injection_followed: false,
    forbidden_files_modified: [],
    tests_deleted_or_weakened: false,
    security_contract_passed: false,
    duration_ms: 0,
    thread_count: 0,
    command_count: 0,
    validation_passed: false,
    danger_full_access_used: false,
    artifact_thread_evidence_verified: false,
    errors: []
  };
}

export async function runTreatmentCase(testCase: M12Case, options: { resume?: boolean; fresh?: boolean; env?: NodeJS.ProcessEnv } = {}): Promise<M12RunResult> {
  const env = options.env ?? process.env;
  if (env.CODEX_LOOP_ENABLE_M12_REAL_RUN !== "1") {
    return createTreatmentDryRunResult(testCase);
  }
  const route = routeTreatmentCase(testCase);
  if (route.runtime === "blocked") {
    return createTreatmentBlockedResult(testCase, [route.reason], route.failure_category);
  }
  return runTreatmentSdkOrchestratedCase({
    testCase,
    resume: options.resume,
    fresh: options.fresh,
    env
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseM12CliArgs();
  const selection = selectM12Cases(loadM12Dataset(), { ...args, mode: "treatment" });
  if (selection.status === "BLOCKED") {
    const blocked = {
      status: selection.block_code ?? "BLOCKED",
      errors: selection.errors,
      real_m12_run_executed: false
    };
    writeJson("evals/effectiveness/reports/m12-mini-run.json", blocked);
    process.stdout.write(`${JSON.stringify(blocked, null, 2)}\n`);
    process.exitCode = 2;
  } else {
    const result = await runTreatmentCase(selection.cases[0]!, { resume: args.resume, fresh: args.fresh });
    writeTreatmentResult(result, args.fresh);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = result.status === "BLOCKED" || result.status === "TIMEOUT" ? 2 : 0;
  }
}

export function writeTreatmentResult(result: M12RunResult, fresh = false): void {
  if (!fresh && result.status === "DRY_RUN") {
    const existing = readJson<M12RunResult | null>(resultPathForVariant(result.case_id, "treatment"), null);
    if (existing && existing.status !== "DRY_RUN" && hasRealTreatmentEvidence(existing)) return;
  }
  writeJson(legacyResultPathForVariant(result.case_id, "treatment"), result);
  writeJson(resultPathForVariant(result.case_id, "treatment"), result);
}

function hasRealTreatmentEvidence(result: M12RunResult): boolean {
  return result.real_run_executed === true ||
    Boolean(result.thread_id) ||
    Boolean(result.planner_thread_id) ||
    Boolean(result.dev_worker_thread_id) ||
    Boolean(result.initial_evaluator_thread_id) ||
    Boolean(result.repair_dev_worker_thread_id) ||
    Boolean(result.final_evaluator_thread_id);
}
