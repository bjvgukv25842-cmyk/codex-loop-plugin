import { LoopController } from "../../orchestrator/controller.ts";

export interface EvalCommandOptions {
  eval_id: string;
}

export async function evalCommand(controller: LoopController, options: EvalCommandOptions): Promise<unknown> {
  if (!options.eval_id) {
    throw new Error("loop eval requires --eval-id");
  }

  return controller.evaluate(options.eval_id);
}
