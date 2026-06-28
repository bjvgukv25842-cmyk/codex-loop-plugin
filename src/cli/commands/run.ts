import { LoopController } from "../../orchestrator/controller.ts";

export interface RunCommandOptions {
  loop_run_id?: string;
}

export async function runCommand(controller: LoopController, options: RunCommandOptions): Promise<unknown> {
  return controller.runOneStep(options.loop_run_id);
}
