import { LoopController } from "../../orchestrator/controller.ts";

export interface ReportCommandOptions {
  loop_run_id?: string;
  path?: string;
}

export async function reportCommand(controller: LoopController, options: ReportCommandOptions): Promise<unknown> {
  return controller.report(options.loop_run_id, options.path);
}
