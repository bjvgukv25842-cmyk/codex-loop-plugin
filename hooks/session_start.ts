import { handleSessionStart, runHookCli } from "../src/hooks/hook-utils.ts";
import type { SessionStartInput } from "../src/hooks/input-types.ts";

await runHookCli<SessionStartInput>("SessionStart", handleSessionStart);
