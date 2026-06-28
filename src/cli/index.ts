import { JsonLoopStore } from "../state/json-store.ts";
import { LoopController } from "../orchestrator/controller.ts";
import { capsuleCommand } from "./commands/capsule.ts";
import { evalCommand } from "./commands/eval.ts";
import { initCommand } from "./commands/init.ts";
import { planCommand } from "./commands/plan.ts";
import { repairCommand } from "./commands/repair.ts";
import { reportCommand } from "./commands/report.ts";
import { runCommand } from "./commands/run.ts";
import { statusCommand } from "./commands/status.ts";

export interface CliRunOptions {
  controller?: LoopController;
}

export async function runCli(argv: string[], options: CliRunOptions = {}): Promise<unknown> {
  const controller = options.controller ?? new LoopController(new JsonLoopStore());
  const [namespace, command, ...rest] = argv;
  const args = parseArgs(rest);

  if (namespace !== "loop") {
    throw new Error("Expected first argument to be 'loop'");
  }

  switch (command) {
    case "init":
      return initCommand(controller, {
        goal: readOption(args, "goal"),
        project_id: readOptionalOption(args, "project-id"),
        module_id: readOptionalOption(args, "module-id")
      });
    case "status":
      return statusCommand(controller, {
        loop_run_id: readOptionalOption(args, "loop-run-id")
      });
    case "plan":
      return planCommand(controller, {
        loop_run_id: readOptionalOption(args, "loop-run-id")
      });
    case "run":
      return runCommand(controller, {
        loop_run_id: readOptionalOption(args, "loop-run-id")
      });
    case "eval":
      return evalCommand(controller, {
        eval_id: readOption(args, "eval-id")
      });
    case "repair":
      return repairCommand(controller, {
        repair_id: readOption(args, "repair-id"),
        output_dir: readOptionalOption(args, "output-dir")
      });
    case "capsule":
      return capsuleCommand(controller, {
        loop_run_id: readOption(args, "loop-run-id"),
        agent_id: readOption(args, "agent-id"),
        task_id: readOptionalOption(args, "task-id"),
        restart_reason: readOption(args, "restart-reason"),
        next_instruction: readOption(args, "next-instruction"),
        artifact_dir: readOptionalOption(args, "artifact-dir")
      });
    case "report":
      return reportCommand(controller, {
        loop_run_id: readOptionalOption(args, "loop-run-id"),
        path: readOptionalOption(args, "path")
      });
    default:
      throw new Error(`Unknown loop command: ${command ?? ""}`);
  }
}

export function parseArgs(argv: string[]): Map<string, string> {
  const args = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token?.startsWith("--")) {
      continue;
    }

    const key = token.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      args.set(key, next);
      index += 1;
    } else {
      args.set(key, "true");
    }
  }
  return args;
}

function readOption(args: Map<string, string>, key: string): string {
  const value = args.get(key);
  if (!value) {
    throw new Error(`Missing required option --${key}`);
  }
  return value;
}

function readOptionalOption(args: Map<string, string>, key: string): string | undefined {
  return args.get(key);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCli(process.argv.slice(2))
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "CLI command failed";
      console.error(
        JSON.stringify(
          {
            ok: false,
            error: {
              message
            }
          },
          null,
          2
        )
      );
      process.exitCode = 1;
    });
}
