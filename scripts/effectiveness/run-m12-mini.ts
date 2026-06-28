import { mkdirSync } from "node:fs";

import { loadM12Dataset } from "./dataset.ts";
import { writeJson } from "./io.ts";
import { parseM12CliArgs, selectM12Cases } from "./m12-cli-args.ts";
import { runBaselineCase, writeBaselineResult } from "./run-baseline-case.ts";
import { runTreatmentCase, writeTreatmentResult } from "./run-treatment-case.ts";
import { clearM12ModeOutputs } from "../../src/effectiveness/effectiveness-fixtures.ts";

export async function runM12Mini(): Promise<Record<string, unknown>> {
  const args = parseM12CliArgs();
  const selection = selectM12Cases(loadM12Dataset(), args);
  if (selection.status === "BLOCKED") {
    return {
      status: selection.block_code ?? "BLOCKED",
      mode: process.env.CODEX_LOOP_ENABLE_M12_REAL_RUN === "1" ? "real-run-requested" : "dry-run",
      selected_case: args.case_id ?? "",
      selected_mode: args.mode,
      case_count: 0,
      baseline_results: 0,
      treatment_results: 0,
      real_m12_run_executed: false,
      dry_run: process.env.CODEX_LOOP_ENABLE_M12_REAL_RUN !== "1",
      errors: selection.errors
    };
  }
  const cases = selection.cases;
  mkdirSync("evals/effectiveness/baseline", { recursive: true });
  mkdirSync("evals/effectiveness/treatment", { recursive: true });
  if (args.fresh) {
    for (const testCase of cases) {
      if (selection.modes.includes("baseline")) clearM12ModeOutputs(testCase, "baseline");
      if (selection.modes.includes("treatment")) clearM12ModeOutputs(testCase, "treatment");
    }
  }
  const baseline = selection.modes.includes("baseline")
    ? await Promise.all(cases.map((testCase) => runBaselineCase(testCase, { resume: args.resume, fresh: args.fresh })))
    : [];
  const treatment = selection.modes.includes("treatment")
    ? await Promise.all(cases.map((testCase) => runTreatmentCase(testCase, { resume: args.resume, fresh: args.fresh })))
    : [];
  for (const result of baseline) {
    writeBaselineResult(result, args.fresh);
  }
  for (const result of treatment) {
    writeTreatmentResult(result, args.fresh);
  }
  const realRunExecuted = [...baseline, ...treatment].some((result) => result.real_run_executed);
  const blocked = [...baseline, ...treatment].some((result) => result.status === "BLOCKED");
  return {
    status: blocked ? "BLOCKED" : "PASS",
    mode: process.env.CODEX_LOOP_ENABLE_M12_REAL_RUN === "1" ? "real-run-requested" : "dry-run",
    selected_case: args.case_id ?? "",
    selected_mode: args.mode,
    case_count: cases.length,
    baseline_results: baseline.length,
    treatment_results: treatment.length,
    real_m12_run_executed: realRunExecuted,
    dry_run: !realRunExecuted,
    errors: [...baseline, ...treatment].flatMap((result) => result.errors)
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await runM12Mini();
  writeJson("evals/effectiveness/reports/m12-mini-run.json", result);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.status === "PASS" ? 0 : 2;
}
