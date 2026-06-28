import { describe, expect, it } from "vitest";

import { NativeRuntimeAdapter } from "../../src/runtime/native-runtime-adapter.ts";
import { StubRuntimeAdapter } from "../../src/runtime/stub-runtime-adapter.ts";
import type { RuntimeThreadInput } from "../../src/runtime/runtime-types.ts";

describe("runtime adapters", () => {
  it("stub adapter never pretends to start a real thread", async () => {
    const adapter = new StubRuntimeAdapter();
    const result = await adapter.runThread(input());

    expect(result.status).toBe("BLOCKED");
    expect(result.thread_id).toBe("");
    expect(result.errors.join(" ")).toContain("never calls the Codex SDK");
  });

  it("native adapter is explicitly experimental", async () => {
    const adapter = new NativeRuntimeAdapter();
    const result = await adapter.runThread(input());

    expect(result.status).toBe("BLOCKED");
    expect(result.errors.join(" ")).toContain("experimental");
  });
});

function input(overrides: Partial<RuntimeThreadInput> = {}): RuntimeThreadInput {
  return {
    role: "planner",
    loop_run_id: "loop_sdk",
    task_id: "task_sdk",
    prompt: "plan",
    sandbox: "read-only",
    working_directory: "/tmp/project",
    timeout_ms: 180_000,
    output_schema_path: "",
    env: {},
    ...overrides
  };
}
