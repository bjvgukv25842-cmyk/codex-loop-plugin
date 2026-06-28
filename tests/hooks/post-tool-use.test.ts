import { afterEach, describe, expect, it } from "vitest";

import { handlePostToolUse } from "../../src/hooks/hook-utils.ts";
import { cleanupHookTestWorkspaces, createHookTestWorkspace, seedLoop } from "./test-helpers.ts";

afterEach(async () => {
  await cleanupHookTestWorkspaces();
});

describe("PostToolUse hook", () => {
  it("records a failed validation event for npm test", async () => {
    const { repoRoot, stateDir, store } = await createHookTestWorkspace();
    await seedLoop(store);

    const result = await handlePostToolUse(
      {
        tool_name: "Bash",
        tool_input: {
          command: "npm test"
        },
        tool_result: {
          exit_code: 1,
          stderr: "one test failed"
        }
      },
      {
        repoRoot,
        stateDir
      }
    );

    expect(result).toMatchObject({
      ok: true,
      hook: "PostToolUse",
      status: "warning",
      loop_run_id: "loop_hooks_001"
    });
    const events = await store.listEvents("loop_hooks_001");
    expect(events.at(-1)).toMatchObject({
      type: "hook.validation",
      metadata: {
        validation: {
          command: "npm test",
          exit_code: 1,
          result: "failed",
          output_excerpt: "one test failed"
        }
      }
    });
  });

  it("skips non-validation commands", async () => {
    const { repoRoot, stateDir } = await createHookTestWorkspace();

    const result = await handlePostToolUse(
      {
        command: "git status --short",
        exit_code: 0
      },
      {
        repoRoot,
        stateDir
      }
    );

    expect(result).toMatchObject({
      status: "skipped"
    });
  });
});
