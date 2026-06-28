import { LoopController } from "../../orchestrator/controller.ts";

export interface InitCommandOptions {
  goal: string;
  project_id?: string;
  module_id?: string;
}

export async function initCommand(controller: LoopController, options: InitCommandOptions): Promise<unknown> {
  if (!options.goal) {
    throw new Error("loop init requires --goal");
  }

  return controller.initLoop(options);
}
