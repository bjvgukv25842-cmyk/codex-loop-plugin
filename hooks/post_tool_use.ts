import { handlePostToolUse, runHookCli } from "../src/hooks/hook-utils.ts";
import type { PostToolUseInput } from "../src/hooks/input-types.ts";

await runHookCli<PostToolUseInput>("PostToolUse", handlePostToolUse);
