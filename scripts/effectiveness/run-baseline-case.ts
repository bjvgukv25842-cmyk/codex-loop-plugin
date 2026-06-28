import { loadM12Dataset } from "./dataset.ts";
import { readJson, writeJson } from "./io.ts";
import { parseM12CliArgs, selectM12Cases, resultPathForVariant, legacyResultPathForVariant } from "./m12-cli-args.ts";
import type { M12Case, M12RunResult } from "./types.ts";
import { createBaselineBlockedResult, runBaselineCodexExecCanary } from "../../src/effectiveness/baseline-codex-exec-runner.ts";
import { clearM12ModeOutputs, inspectM12ModeCheckpoint } from "../../src/effectiveness/effectiveness-fixtures.ts";

export function createBaselineDryRunResult(testCase: M12Case): M12RunResult {
  return {
    case_id: testCase.case_id,
    variant: "baseline",
    mode: "baseline",
    runtime: "codex-exec",
    status: "DRY_RUN",
    real_run_executed: false,
    prompt: testCase.baseline_prompt,
    fixture_repo: testCase.fixture_repo,
    acceptance_criteria: testCase.acceptance_criteria,
    validation_commands: testCase.validation_commands,
    expected_artifacts: testCase.expected_artifacts,
    baseline_expected_artifacts: testCase.baseline_expected_artifacts ?? [],
    treatment_expected_artifacts: testCase.treatment_expected_artifacts,
    forbidden_files: testCase.forbidden_files,
    changed_files: [],
    artifacts: [],
    validation_logs: ["DRY_RUN: baseline runner did not start Codex."],
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
    errors: []
  };
}

export async function runBaselineCase(testCase: M12Case, options: { resume?: boolean; fresh?: boolean; env?: NodeJS.ProcessEnv } = {}): Promise<M12RunResult> {
  const env = options.env ?? process.env;
  if (options.fresh) {
    clearM12ModeOutputs(testCase, "baseline");
  }
  if (env.CODEX_LOOP_ENABLE_M12_REAL_RUN !== "1") {
    return createBaselineDryRunResult(testCase);
  }
  if (!options.fresh) {
    const checkpoint = inspectM12ModeCheckpoint(testCase, "baseline");
    if (checkpoint.partial_exists && !checkpoint.result_exists) {
      return createBaselineBlockedResult(
        testCase,
        ["Stale baseline partial files exist without baseline-result.json. Rerun with --fresh to clear selected baseline outputs."],
        "BLOCKED_M12_STALE_BASELINE_PARTIAL_RUN"
      );
    }
  }
  return runBaselineCodexExecCanary({
    testCase,
    resume: options.resume,
    env
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseM12CliArgs();
  const selection = selectM12Cases(loadM12Dataset(), { ...args, mode: "baseline" });
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
    const result = await runBaselineCase(selection.cases[0]!, { resume: args.resume, fresh: args.fresh });
    writeBaselineResult(result, args.fresh);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = result.status === "BLOCKED" || result.status === "TIMEOUT" ? 2 : 0;
  }
}

export function writeBaselineResult(result: M12RunResult, fresh = false): void {
  if (!fresh && result.status === "DRY_RUN") {
    const existing = readJson<M12RunResult | null>(resultPathForVariant(result.case_id, "baseline"), null);
    if (existing && existing.status !== "DRY_RUN") return;
  }
  writeJson(legacyResultPathForVariant(result.case_id, "baseline"), result);
  writeJson(resultPathForVariant(result.case_id, "baseline"), result);
}
