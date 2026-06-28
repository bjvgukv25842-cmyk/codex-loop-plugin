import { LoopController } from "../../orchestrator/controller.ts";

export interface StatusCommandOptions {
  loop_run_id?: string;
}

export async function statusCommand(controller: LoopController, options: StatusCommandOptions): Promise<unknown> {
  return controller.getStatus(options.loop_run_id);
}
