import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { handlePreCompact } from "../../src/hooks/hook-utils.ts";
import { cleanupHookTestWorkspaces, createHookTestWorkspace, seedAgent, seedLoop, seedTask } from "./test-helpers.ts";

afterEach(async () => {
  await cleanupHookTestWorkspaces();
});

describe("PreCompact hook", () => {
  it("writes a ContextCapsule file and state record", async () => {
    const { repoRoot, stateDir, store } = await createHookTestWorkspace();
    await mkdir(join(repoRoot, "docs"), { recursive: true });
    await readFile(new URL("../../docs/LOOP_PROGRESS.md", import.meta.url), "utf8").then((content) =>
      import("node:fs/promises").then(({ writeFile }) => writeFile(join(repoRoot, "docs/LOOP_PROGRESS.md"), content, "utf8"))
    );
    await seedLoop(store);
    await seedAgent(store);
    await seedTask(store);

    const result = await handlePreCompact(
      {
        agent_id: "agent_context_distiller",
        task_id: "task_hooks_001",
        restart_reason: "Compaction requested.",
        next_instruction: "Continue M8 hook validation."
      },
      {
        repoRoot,
        stateDir,
        now: () => "2026-06-18T09:00:00.000Z"
      }
    );

    expect(result).toMatchObject({
      status: "ok",
      hook: "PreCompact",
      loop_run_id: "loop_hooks_001"
    });
    expect(result.artifact_path).toContain("artifacts/context-capsules/capsule_agent_context_distiller_");
    const artifact = JSON.parse(await readFile(result.artifact_path as string, "utf8")) as { next_instruction: string };
    expect(artifact.next_instruction).toBe("Continue M8 hook validation.");

    const capsules = await store.listContextCapsulesByAgent("agent_context_distiller");
    expect(capsules).toHaveLength(1);
    expect(capsules[0]).toMatchObject({
      old_thread_id: "thread_context_initial",
      current_module: "M8",
      current_task: "task_hooks_001"
    });
  });
});
