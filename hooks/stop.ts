import { handleStop, runHookCli } from "../src/hooks/hook-utils.ts";
import type { StopInput } from "../src/hooks/input-types.ts";

await runHookCli<StopInput>("Stop", handleStop);
