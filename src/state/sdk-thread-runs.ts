import { assertValid } from "../core/validate.ts";
import type { SdkThreadRun } from "../core/types.ts";
import { readJsonFile, writeJsonFileAtomic } from "./json-file.ts";
import { getStateDir } from "./paths.ts";
import type { LoopEvent } from "./types.ts";

export interface SdkThreadRunStoreOptions {
  stateDir?: string;
}

export interface SdkThreadRunWriteResult {
  threadRun: SdkThreadRun;
  event: LoopEvent;
}

export class SdkThreadRunStore {
  private readonly stateDir: string;

  constructor(options: SdkThreadRunStoreOptions = {}) {
    this.stateDir = options.stateDir ?? getStateDir();
  }

  async writeThreadRun(input: SdkThreadRun): Promise<SdkThreadRunWriteResult> {
    assertValid("sdk-thread-run", input);
    await insertUnique(this.path("sdk-thread-runs.json"), input, (run) => run.thread_run_id, input.thread_run_id);
    const event = await this.appendEvent(input.loop_run_id, "sdk_thread_run.written", `Recorded SDK thread run ${input.thread_run_id}`, {
      thread_run_id: input.thread_run_id,
      role: input.role,
      thread_id: input.thread_id,
      status: input.status
    });
    return { threadRun: input, event };
  }

  async getThreadRun(threadRunId: string): Promise<SdkThreadRun | null> {
    const runs = await readJsonFile<SdkThreadRun[]>(this.path("sdk-thread-runs.json"), []);
    return runs.find((run) => run.thread_run_id === threadRunId) ?? null;
  }

  async listThreadRuns(loopRunId: string): Promise<SdkThreadRun[]> {
    const runs = await readJsonFile<SdkThreadRun[]>(this.path("sdk-thread-runs.json"), []);
    return runs.filter((run) => run.loop_run_id === loopRunId);
  }

  private async appendEvent(loopRunId: string, type: string, message: string, metadata: Record<string, unknown>): Promise<LoopEvent> {
    const timestamp = new Date().toISOString();
    const event: LoopEvent = {
      event_id: `${type}_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      loop_run_id: loopRunId,
      type,
      message,
      created_at: timestamp,
      updated_at: timestamp,
      metadata
    };
    await insertUnique(this.path("events.json"), event, (item) => item.event_id, event.event_id);
    return event;
  }

  private path(name: "sdk-thread-runs.json" | "events.json"): string {
    return `${this.stateDir}/${name}`;
  }
}

async function insertUnique<T>(path: string, item: T, getId: (item: T) => string, id: string): Promise<void> {
  const collection = await readJsonFile<T[]>(path, []);
  if (collection.some((existing) => getId(existing) === id)) {
    throw new Error(`id already exists: ${id}`);
  }
  await writeJsonFileAtomic(path, [...collection, item]);
}
