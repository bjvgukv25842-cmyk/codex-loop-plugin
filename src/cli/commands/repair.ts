import { LoopController } from "../../orchestrator/controller.ts";

export interface RepairCommandOptions {
  repair_id: string;
  output_dir?: string;
}

export async function repairCommand(controller: LoopController, options: RepairCommandOptions): Promise<unknown> {
  if (!options.repair_id) {
    throw new Error("loop repair requires --repair-id");
  }

  return controller.repair(options.repair_id, options.output_dir);
}
