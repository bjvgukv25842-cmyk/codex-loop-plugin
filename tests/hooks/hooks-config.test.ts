import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

interface HookCommand {
  type: string;
  command: string;
}

interface HookMatcher {
  matcher: string;
  hooks: HookCommand[];
}

interface HooksConfig {
  hooks: Record<string, HookMatcher[]>;
}

const requiredEvents = ["SessionStart", "PostToolUse", "PreCompact", "SubagentStart", "SubagentStop", "Stop"];

describe("hooks/hooks.json", () => {
  it("defines every required lifecycle hook with command handlers", async () => {
    const raw = await readFile(join(process.cwd(), "hooks/hooks.json"), "utf8");
    const config = JSON.parse(raw) as HooksConfig;

    expect(Object.keys(config.hooks).sort()).toEqual([...requiredEvents].sort());
    for (const event of requiredEvents) {
      expect(config.hooks[event]).toHaveLength(1);
      expect(config.hooks[event][0]?.matcher).toBeTypeOf("string");
      expect(config.hooks[event][0]?.hooks[0]).toMatchObject({
        type: "command"
      });
      expect(config.hooks[event][0]?.hooks[0]?.command).toContain("hooks/");
    }
  });

  it("keeps PostToolUse scoped to Bash commands", async () => {
    const raw = await readFile(join(process.cwd(), "hooks/hooks.json"), "utf8");
    const config = JSON.parse(raw) as HooksConfig;

    expect(config.hooks.PostToolUse?.[0]?.matcher).toBe("Bash");
  });
});
