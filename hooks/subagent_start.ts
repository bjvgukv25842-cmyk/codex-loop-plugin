import { handleSubagentStart, runHookCli } from "../src/hooks/hook-utils.ts";
import type { SubagentStartInput } from "../src/hooks/input-types.ts";

await runHookCli<SubagentStartInput>("SubagentStart", handleSubagentStart);
