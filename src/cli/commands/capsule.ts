import { LoopController } from "../../orchestrator/controller.ts";

export interface CapsuleCommandOptions {
  loop_run_id: string;
  agent_id: string;
  task_id?: string;
  restart_reason: string;
  next_instruction: string;
  artifact_dir?: string;
}

export async function capsuleCommand(controller: LoopController, options: CapsuleCommandOptions): Promise<unknown> {
  if (!options.loop_run_id) {
    throw new Error("loop capsule requires --loop-run-id");
  }
  if (!options.agent_id) {
    throw new Error("loop capsule requires --agent-id");
  }
  if (!options.restart_reason) {
    throw new Error("loop capsule requires --restart-reason");
  }
  if (!options.next_instruction) {
    throw new Error("loop capsule requires --next-instruction");
  }

  return controller.capsule(options);
}
