import type { SchemaName } from "../core/schema-registry.ts";
import { assertValid } from "../core/validate.ts";
import type { AgentProfile, Artifact, ContextCapsule, EvalReport, LoopRun, TaskNode } from "../core/types.ts";
import { readJsonFile, writeJsonFileAtomic } from "./json-file.ts";
import { getStateDir, resolveStatePath, type StateFileName } from "./paths.ts";
import type {
  AppendEventInput,
  CreateLoopRunInput,
  CreateTaskInput,
  LoopEvent,
  LoopStore,
  RegisterAgentInput,
  UpdateAgentThreadInput,
  UpdateLoopRunInput,
  UpdateTaskStatusInput,
  WriteArtifactInput,
  WriteContextCapsuleInput,
  WriteEvalReportInput
} from "./types.ts";

export interface JsonLoopStoreOptions {
  stateDir?: string;
}

type StateCollection<T> = T[];

export class JsonLoopStore implements LoopStore {
  private readonly stateDir: string;

  constructor(options: JsonLoopStoreOptions = {}) {
    this.stateDir = options.stateDir ?? getStateDir();
  }

  async createLoopRun(input: CreateLoopRunInput): Promise<LoopRun> {
    assertValid("loop-run", input);
    await this.insertUnique("loop-runs.json", input, (loopRun) => loopRun.loop_run_id, input.loop_run_id);
    await this.appendEventForWrite(input.loop_run_id, "loop_run.created", `Created loop run ${input.loop_run_id}`);
    return input;
  }

  async getLoopRun(loopRunId: string): Promise<LoopRun | null> {
    return this.findById("loop-runs.json", (loopRun) => loopRun.loop_run_id, loopRunId);
  }

  async updateLoopRun(loopRunId: string, patch: UpdateLoopRunInput): Promise<LoopRun> {
    const updated = await this.updateById<LoopRun>("loop-runs.json", (loopRun) => loopRun.loop_run_id, loopRunId, (loopRun) => ({
      ...loopRun,
      ...patch,
      loop_run_id: loopRun.loop_run_id,
      updated_at: patch.updated_at ?? new Date().toISOString()
    }));
    assertValid("loop-run", updated);
    await this.appendEventForWrite(loopRunId, "loop_run.updated", `Updated loop run ${loopRunId}`);
    return updated;
  }

  async listLoopRuns(): Promise<LoopRun[]> {
    return this.readCollection("loop-runs.json");
  }

  async registerAgent(input: RegisterAgentInput): Promise<AgentProfile> {
    assertValid("agent-profile", input);
    await this.insertUnique("agents.json", input, (agent) => agent.agent_id, input.agent_id);
    await this.appendEventForWrite(null, "agent.registered", `Registered agent ${input.agent_id}`, {
      agent_id: input.agent_id
    });
    return input;
  }

  async getAgent(agentId: string): Promise<AgentProfile | null> {
    return this.findById("agents.json", (agent) => agent.agent_id, agentId);
  }

  async updateAgentThread(agentId: string, threadUpdate: UpdateAgentThreadInput): Promise<AgentProfile> {
    const updated = await this.updateById<AgentProfile>("agents.json", (agent) => agent.agent_id, agentId, (agent) => {
      const previousThreadIds =
        agent.current_thread_id === threadUpdate.current_thread_id
          ? agent.previous_thread_ids
          : [...agent.previous_thread_ids, agent.current_thread_id];

      return {
        ...agent,
        current_thread_id: threadUpdate.current_thread_id,
        previous_thread_ids: previousThreadIds,
        updated_at: new Date().toISOString()
      };
    });
    assertValid("agent-profile", updated);
    await this.appendEventForWrite(null, "agent.thread_updated", `Updated thread for agent ${agentId}`, {
      agent_id: agentId
    });
    return updated;
  }

  async listAgents(): Promise<AgentProfile[]> {
    return this.readCollection("agents.json");
  }

  async createTask(input: CreateTaskInput): Promise<TaskNode> {
    assertValid("task-node", input);
    await this.insertUnique("tasks.json", input, (task) => task.task_id, input.task_id);
    await this.appendEventForWrite(input.loop_run_id, "task.created", `Created task ${input.task_id}`, {
      task_id: input.task_id
    });
    return input;
  }

  async getTask(taskId: string): Promise<TaskNode | null> {
    return this.findById("tasks.json", (task) => task.task_id, taskId);
  }

  async updateTaskStatus(taskId: string, statusPatch: UpdateTaskStatusInput): Promise<TaskNode> {
    const updated = await this.updateById<TaskNode>("tasks.json", (task) => task.task_id, taskId, (task) => ({
      ...task,
      status: statusPatch.status,
      updated_at: new Date().toISOString()
    }));
    assertValid("task-node", updated);
    await this.appendEventForWrite(updated.loop_run_id, "task.status_updated", `Updated task ${taskId} status`, {
      task_id: taskId,
      status: statusPatch.status
    });
    return updated;
  }

  async listTasksByLoopRun(loopRunId: string): Promise<TaskNode[]> {
    const tasks = await this.readCollection<TaskNode>("tasks.json");
    return tasks.filter((task) => task.loop_run_id === loopRunId);
  }

  async writeArtifact(input: WriteArtifactInput): Promise<Artifact> {
    assertValid("artifact", input);
    await this.insertUnique("artifacts.json", input, (artifact) => artifact.artifact_id, input.artifact_id);
    await this.appendEventForWrite(input.loop_run_id, "artifact.written", `Wrote artifact ${input.artifact_id}`, {
      artifact_id: input.artifact_id,
      task_id: input.task_id
    });
    return input;
  }

  async getArtifact(artifactId: string): Promise<Artifact | null> {
    return this.findById("artifacts.json", (artifact) => artifact.artifact_id, artifactId);
  }

  async listArtifactsByTask(taskId: string): Promise<Artifact[]> {
    const artifacts = await this.readCollection<Artifact>("artifacts.json");
    return artifacts.filter((artifact) => artifact.task_id === taskId);
  }

  async writeEvalReport(input: WriteEvalReportInput): Promise<EvalReport> {
    assertValid("eval-report", input);
    await this.insertUnique("eval-reports.json", input, (report) => report.eval_id, input.eval_id);
    await this.appendEventForWrite(input.loop_run_id, "eval_report.written", `Wrote eval report ${input.eval_id}`, {
      eval_id: input.eval_id,
      task_id: input.task_id,
      verdict: input.verdict
    });
    return input;
  }

  async getEvalReport(evalId: string): Promise<EvalReport | null> {
    return this.findById("eval-reports.json", (report) => report.eval_id, evalId);
  }

  async listEvalReportsByTask(taskId: string): Promise<EvalReport[]> {
    const reports = await this.readCollection<EvalReport>("eval-reports.json");
    return reports.filter((report) => report.task_id === taskId);
  }

  async writeContextCapsule(input: WriteContextCapsuleInput): Promise<ContextCapsule> {
    assertValid("context-capsule", input);
    await this.insertUnique("context-capsules.json", input, (capsule) => capsule.capsule_id, input.capsule_id);
    await this.appendEventForWrite(input.loop_run_id, "context_capsule.written", `Wrote context capsule ${input.capsule_id}`, {
      capsule_id: input.capsule_id,
      agent_id: input.agent_id
    });
    return input;
  }

  async getContextCapsule(capsuleId: string): Promise<ContextCapsule | null> {
    return this.findById("context-capsules.json", (capsule) => capsule.capsule_id, capsuleId);
  }

  async listContextCapsulesByAgent(agentId: string): Promise<ContextCapsule[]> {
    const capsules = await this.readCollection<ContextCapsule>("context-capsules.json");
    return capsules.filter((capsule) => capsule.agent_id === agentId);
  }

  async appendEvent(input: AppendEventInput): Promise<LoopEvent> {
    const timestamp = input.created_at ?? new Date().toISOString();
    const event: LoopEvent = {
      event_id: input.event_id,
      loop_run_id: input.loop_run_id,
      type: input.type,
      message: input.message,
      created_at: timestamp,
      updated_at: input.updated_at ?? timestamp,
      metadata: input.metadata ?? {}
    };
    validateEvent(event);
    await this.insertUnique("events.json", event, (candidate) => candidate.event_id, event.event_id);
    return event;
  }

  async listEvents(loopRunId: string): Promise<LoopEvent[]> {
    const events = await this.readCollection<LoopEvent>("events.json");
    return events.filter((event) => event.loop_run_id === loopRunId);
  }

  private async appendEventForWrite(
    loopRunId: string | null,
    type: string,
    message: string,
    metadata: Record<string, unknown> = {}
  ): Promise<void> {
    const eventLoopRunId = loopRunId ?? "loop_unassigned";
    await this.appendEvent({
      event_id: `${type}_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      loop_run_id: eventLoopRunId,
      type,
      message,
      metadata
    });
  }

  private async readCollection<T>(name: StateFileName): Promise<StateCollection<T>> {
    return readJsonFile<StateCollection<T>>(this.path(name), []);
  }

  private async writeCollection<T>(name: StateFileName, collection: StateCollection<T>): Promise<void> {
    await writeJsonFileAtomic(this.path(name), collection);
  }

  private async insertUnique<T>(
    name: StateFileName,
    item: T,
    getId: (item: T) => string,
    idValue: string
  ): Promise<void> {
    const collection = await this.readCollection<T>(name);
    if (collection.some((existing) => getId(existing) === idValue)) {
      throw new Error(`id already exists: ${idValue}`);
    }
    await this.writeCollection(name, [...collection, item]);
  }

  private async findById<T>(
    name: StateFileName,
    getId: (item: T) => string,
    idValue: string
  ): Promise<T | null> {
    const collection = await this.readCollection<T>(name);
    return collection.find((item) => getId(item) === idValue) ?? null;
  }

  private async updateById<T>(
    name: StateFileName,
    getId: (item: T) => string,
    idValue: string,
    update: (item: T) => T
  ): Promise<T> {
    const collection = await this.readCollection<T>(name);
    const index = collection.findIndex((item) => getId(item) === idValue);
    if (index === -1) {
      throw new Error(`id not found: ${idValue}`);
    }

    const updated = update(collection[index] as T);
    const nextCollection = [...collection];
    nextCollection[index] = updated;
    await this.writeCollection(name, nextCollection);
    return updated;
  }

  private path(name: StateFileName): string {
    return resolveStatePath(name, this.stateDir);
  }
}

function validateEvent(event: LoopEvent): void {
  for (const key of ["event_id", "loop_run_id", "type", "message", "created_at", "updated_at"] as const) {
    if (typeof event[key] !== "string" || event[key].length === 0) {
      throw new Error(`event.${key} must be a non-empty string`);
    }
  }

  if (typeof event.metadata !== "object" || event.metadata === null || Array.isArray(event.metadata)) {
    throw new Error("event.metadata must be an object");
  }
}

export function assertStateEntityValid(schemaName: SchemaName, data: unknown): void {
  assertValid(schemaName, data);
}
