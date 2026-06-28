import type { EvalReport, RepairRequest } from "../core/types.ts";
import type { LoopStore } from "../state/types.ts";

export interface RepairDispatchResult {
  repair_request: RepairRequest;
  prompt_path: string;
}

export class RepairDispatcher {
  constructor(private readonly store: LoopStore) {}

  async createRepairRequestFromEval(evalReport: EvalReport): Promise<RepairDispatchResult> {
    const timestamp = new Date().toISOString();
    const repairRequest: RepairRequest = {
      repair_id: `repair_${evalReport.eval_id}_${Date.now()}`,
      loop_run_id: evalReport.loop_run_id,
      task_id: evalReport.task_id,
      module_id: evalReport.module_id,
      source_eval_id: evalReport.eval_id,
      assigned_agent_id: "agent_dev_worker",
      findings: evalReport.findings,
      repair_instructions: evalReport.required_fixes.map((fix) => fix.instruction),
      allowed_scope: uniqueStrings(evalReport.required_fixes.flatMap((fix) => fix.expected_files.map((file) => file.path))),
      disallowed_scope: ["Do not modify files outside expected_files unless explicitly approved."],
      validation_commands: uniqueValidationCommands(evalReport.required_fixes.flatMap((fix) => fix.validation_commands)),
      status: "REPAIR_REQUESTED",
      created_at: timestamp,
      updated_at: timestamp
    };

    const written = await this.store.createRepairRequest(repairRequest);
    return {
      repair_request: written,
      prompt_path: `artifacts/task-results/${written.repair_id}.prompt.md`
    };
  }
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}

function uniqueValidationCommands(commands: RepairRequest["validation_commands"]): RepairRequest["validation_commands"] {
  const seen = new Set<string>();
  return commands.filter((command) => {
    const key = JSON.stringify(command);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
