import { handlePreCompact, runHookCli } from "../src/hooks/hook-utils.ts";
import type { PreCompactInput } from "../src/hooks/input-types.ts";

await runHookCli<PreCompactInput>("PreCompact", handlePreCompact);
