import { LoopController } from "../../orchestrator/controller.ts";

export interface PlanCommandOptions {
  loop_run_id?: string;
}

export async function planCommand(controller: LoopController, options: PlanCommandOptions): Promise<unknown> {
  return controller.plan(options.loop_run_id);
}
