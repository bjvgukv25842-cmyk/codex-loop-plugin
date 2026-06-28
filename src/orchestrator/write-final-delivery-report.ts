import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import type { SdkRepairLoopCheckpointState } from "./sdk-repair-loop-types.ts";

export interface WriteFinalDeliveryReportInput {
  state: SdkRepairLoopCheckpointState;
  target_repo?: string;
  output_path?: string;
  changed_files?: string[];
  risks?: string[];
}

export interface WriteFinalDeliveryReportResult {
  status: "PASS" | "NEEDS_REVISION";
  path: string;
  errors: string[];
}

export function writeFinalDeliveryReport(input: WriteFinalDeliveryReportInput): WriteFinalDeliveryReportResult {
  const state = input.state;
  const errors = requiredThreadErrors(state);
  if (state.final_evaluator.eval_verdict !== "PASS") {
    errors.push("Final evaluator verdict must be PASS before FinalDeliveryReport.");
  }
  if (state.repair_dev_worker.tests_passed !== true) {
    errors.push("Repair dev worker tests_passed must be true before FinalDeliveryReport.");
  }
  if (errors.length > 0) {
    return {
      status: "NEEDS_REVISION",
      path: "",
      errors
    };
  }

  const targetRepo = resolve(input.target_repo ?? state.target_repo);
  const outputPath = input.output_path ?? resolve(targetRepo, "artifacts/FinalDeliveryReport.md");
  const lines = [
    "# FinalDeliveryReport",
    "",
    "## Summary",
    "",
    "Gate 6B.2 SDK-Orchestrated Repair Loop completed through checkpointed planner, dev worker, initial evaluator, repair request, repair dev worker, final evaluator, and final report stages.",
    "",
    "## Thread Evidence",
    "",
    `- Planner thread_id: ${state.planner.thread_id}`,
    `- Dev Worker thread_id: ${state.dev_worker.thread_id}`,
    `- Initial Evaluator thread_id: ${state.initial_evaluator.thread_id}`,
    `- Repair Dev Worker thread_id: ${state.repair_dev_worker.thread_id}`,
    `- Final Evaluator thread_id: ${state.final_evaluator.thread_id}`,
    "",
    "## Evaluator Verdicts",
    "",
    `- Initial EvalReport: ${state.initial_evaluator.eval_verdict}`,
    `- Initial EvalReport path: ${state.initial_evaluator.eval_report_path}`,
    `- Final EvalReport: ${state.final_evaluator.eval_verdict}`,
    `- Final EvalReport path: ${state.final_evaluator.eval_report_path}`,
    "",
    "## Repair Summary",
    "",
    `- RepairRequest path: ${state.repair_request.repair_request_path}`,
    `- Required fixes count: ${state.repair_request.required_fixes_count}`,
    `- Repair result path: ${state.repair_dev_worker.repair_result_path}`,
    "",
    "## Validation Commands",
    "",
    "- npm test",
    "",
    "## Changed Files",
    "",
    ...((input.changed_files ?? ["src/project-name.js"]).map((file) => `- ${file}`)),
    "",
    "## Risks",
    "",
    ...((input.risks ?? ["Gate 6B.2 validates a small fixture; broader product effectiveness still requires M12 after Gate 6B.2 PASS."]).map((risk) => `- ${risk}`)),
    ""
  ];

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, lines.join("\n"), "utf8");
  return {
    status: "PASS",
    path: relativeToRepo(outputPath),
    errors: []
  };
}

function requiredThreadErrors(state: SdkRepairLoopCheckpointState): string[] {
  const required = [
    ["planner", state.planner.thread_id],
    ["dev_worker", state.dev_worker.thread_id],
    ["initial_evaluator", state.initial_evaluator.thread_id],
    ["repair_dev_worker", state.repair_dev_worker.thread_id],
    ["final_evaluator", state.final_evaluator.thread_id]
  ];
  return required.flatMap(([name, threadId]) => (threadId ? [] : [`Missing ${name} thread_id.`]));
}

function relativeToRepo(path: string): string {
  const cwd = process.cwd();
  return path.startsWith(cwd) ? path.slice(cwd.length + 1) : path;
}
