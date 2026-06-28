import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { handleStop, handleSubagentStop } from "../../src/hooks/hook-utils.ts";
import {
  cleanupHookTestWorkspaces,
  createEvalReport,
  createHookTestWorkspace,
  seedLoop,
  seedTask
} from "./test-helpers.ts";

afterEach(async () => {
  await cleanupHookTestWorkspaces();
});

describe("Stop hook", () => {
  it("warns when current module progress is not recorded", async () => {
    const { repoRoot, stateDir, store } = await createHookTestWorkspace();
    await mkdir(join(repoRoot, "docs"), { recursive: true });
    await writeFile(join(repoRoot, "docs/LOOP_PROGRESS.md"), "# Loop Progress\n\nM7 complete.\n", "utf8");
    await seedLoop(store);

    const result = await handleStop(
      {},
      {
        repoRoot,
        stateDir
      }
    );

    expect(result).toMatchObject({
      hook: "Stop",
      status: "warning",
      loop_run_id: "loop_hooks_001"
    });
    expect(result.warnings.join("\n")).toContain("docs/LOOP_PROGRESS.md");
    const events = await store.listEvents("loop_hooks_001");
    expect(events.at(-1)).toMatchObject({
      type: "hook.stop.warning"
    });
  });
});

describe("SubagentStop hook", () => {
  it("saves EvalReport-like output to state and artifacts", async () => {
    const { repoRoot, stateDir, store } = await createHookTestWorkspace();
    await seedLoop(store);
    await seedTask(store);

    const result = await handleSubagentStop(
      {
        agent_id: "agent_evaluator",
        output: JSON.stringify(createEvalReport())
      },
      {
        repoRoot,
        stateDir
      }
    );

    expect(result).toMatchObject({
      hook: "SubagentStop",
      status: "ok",
      artifact_path: expect.stringContaining("artifacts/eval-reports/eval_hooks_001.json")
    });
    expect(await store.getEvalReport("eval_hooks_001")).toMatchObject({
      verdict: "PASS"
    });
  });

  it("records a warning instead of fabricating an EvalReport when verdict is missing", async () => {
    const { repoRoot, stateDir, store } = await createHookTestWorkspace();
    await seedLoop(store);

    const result = await handleSubagentStop(
      {
        output: JSON.stringify({
          agent: "evaluator",
          summary: "Looks good but no verdict."
        })
      },
      {
        repoRoot,
        stateDir
      }
    );

    expect(result).toMatchObject({
      status: "warning"
    });
    expect(result.warnings.join("\n")).toContain("Missing verdict");
    const events = await store.listEvents("loop_hooks_001");
    expect(events.at(-1)).toMatchObject({
      type: "hook.subagent.warning"
    });
  });
});
