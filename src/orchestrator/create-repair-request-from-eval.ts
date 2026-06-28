import type { EvalReport, RepairRequest } from "../core/types.ts";
import { validateWithSchema } from "../core/validate.ts";

export interface CreateRepairRequestFromEvalInput {
  eval_report: EvalReport;
  repair_id?: string;
  assigned_agent_id?: string;
  allowed_scope?: string[];
  disallowed_scope?: string[];
  now?: string;
}

export interface CreateRepairRequestFromEvalResult {
  status: "PASS" | "NEEDS_REVISION";
  repair_request?: RepairRequest;
  failure_category: "REPAIR_REQUEST_NOT_CREATED" | "REPAIR_REQUEST_SCHEMA_INVALID" | "";
  errors: string[];
}

export function createRepairRequestFromEval(input: CreateRepairRequestFromEvalInput): CreateRepairRequestFromEvalResult {
  const report = input.eval_report;
  if (report.verdict !== "NEEDS_REVISION" || report.findings.length === 0 || report.required_fixes.length === 0) {
    return {
      status: "NEEDS_REVISION",
      failure_category: "REPAIR_REQUEST_NOT_CREATED",
      errors: ["RepairRequest requires a NEEDS_REVISION EvalReport with findings and required_fixes."]
    };
  }

  const timestamp = input.now ?? new Date().toISOString();
  const repairRequest: RepairRequest = {
    repair_id: input.repair_id ?? `repair_${report.eval_id}`,
    loop_run_id: report.loop_run_id,
    task_id: report.task_id,
    module_id: report.module_id,
    source_eval_id: report.eval_id,
    assigned_agent_id: input.assigned_agent_id ?? "sdk-repair-dev-worker",
    findings: report.findings,
    repair_instructions: report.required_fixes.map((fix) => fix.instruction).filter(Boolean),
    allowed_scope: input.allowed_scope ?? unique(report.required_fixes.flatMap((fix) => fix.expected_files.map((file) => file.path)).concat("src/project-name.js")),
    disallowed_scope: input.disallowed_scope ?? ["Do not implement UI.", "Do not add database changes.", "Do not modify unrelated files."],
    validation_commands: uniqueCommands(report.required_fixes.flatMap((fix) => fix.validation_commands).concat({ command: "npm test" })),
    status: "REPAIR_REQUESTED",
    created_at: timestamp,
    updated_at: timestamp
  };

  const validation = validateWithSchema("repair-request", repairRequest);
  if (!validation.valid) {
    return {
      status: "NEEDS_REVISION",
      failure_category: "REPAIR_REQUEST_SCHEMA_INVALID",
      errors: validation.errors.map((error) => `${error.path}: ${error.message}`)
    };
  }

  return {
    status: "PASS",
    repair_request: repairRequest,
    failure_category: "",
    errors: []
  };
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function uniqueCommands(commands: RepairRequest["validation_commands"]): RepairRequest["validation_commands"] {
  const seen = new Set<string>();
  return commands.filter((command) => {
    const key = JSON.stringify(command);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
