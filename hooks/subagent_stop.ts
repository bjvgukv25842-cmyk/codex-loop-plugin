import { handleSubagentStop, runHookCli } from "../src/hooks/hook-utils.ts";
import type { SubagentStopInput } from "../src/hooks/input-types.ts";

await runHookCli<SubagentStopInput>("SubagentStop", handleSubagentStop);
