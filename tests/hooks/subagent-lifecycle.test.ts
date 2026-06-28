import { afterEach, describe, expect, it } from "vitest";

import { handleSubagentStart, handleSubagentStop } from "../../src/hooks/hook-utils.ts";
import { cleanupHookTestWorkspaces, createEvalReport, createHookTestWorkspace, seedLoop, seedTask } from "./test-helpers.ts";

afterEach(async () => {
  await cleanupHookTestWorkspaces();
});

describe("subagent lifecycle hooks", () => {
  it("records SubagentStart lifecycle evidence", async () => {
    const { repoRoot, stateDir, store } = await createHookTestWorkspace();
    await seedLoop(store);

    const result = await handleSubagentStart(
      {
        agent_name: "loop_evaluator",
        agent_type: "evaluator",
        agent_run_id: "agent_run_eval_001",
        parent_thread_id: "thread_parent",
        thread_id: "thread_eval",
        task_id: "task_hooks_001",
        module_id: "Gate6"
      },
      {
        repoRoot,
        stateDir
      }
    );

    expect(result).toMatchObject({
      hook: "SubagentStart",
      status: "ok",
      loop_run_id: "loop_hooks_001"
    });
    const events = await store.listEvents("loop_hooks_001");
    expect(events.at(-1)).toMatchObject({
      type: "hook.subagent.start",
      metadata: {
        agent_name: "loop_evaluator",
        agent_run_id: "agent_run_eval_001",
        thread_id: "thread_eval"
      }
    });
  });

  it("records SubagentStop output after lifecycle start", async () => {
    const { repoRoot, stateDir, store } = await createHookTestWorkspace();
    await seedLoop(store);
    await seedTask(store);
    await handleSubagentStart(
      {
        agent_name: "loop_evaluator",
        agent_type: "evaluator",
        agent_run_id: "agent_run_eval_001",
        parent_thread_id: "thread_parent",
        thread_id: "thread_eval",
        task_id: "task_hooks_001",
        module_id: "M8"
      },
      {
        repoRoot,
        stateDir
      }
    );

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
      status: "ok"
    });
    const events = await store.listEvents("loop_hooks_001");
    expect(events.map((event) => event.type)).toEqual(expect.arrayContaining(["hook.subagent.start", "eval_report.written"]));
  });
});
