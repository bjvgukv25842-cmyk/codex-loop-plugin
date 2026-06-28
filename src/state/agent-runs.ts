import { assertValid } from "../core/validate.ts";
import type { AgentRun, ArtifactProducer, ArtifactType, EvalReport, RepairRequest, SubagentEvidence } from "../core/types.ts";
import { readJsonFile, writeJsonFileAtomic } from "./json-file.ts";
import { getStateDir } from "./paths.ts";
import type { AppendEventInput, LoopEvent } from "./types.ts";

export interface AgentRunStoreOptions {
  stateDir?: string;
}

export interface AgentRunStartInput {
  loop_run_id: string;
  agent_name: string;
  agent_type: AgentRun["agent_type"];
  parent_thread_id: string;
  thread_id: string;
  task_id: string | null;
  module_id: string;
  phase?: string;
  metadata?: Record<string, unknown>;
}

export interface AgentRunFinishInput {
  agent_run_id: string;
  status: Extract<AgentRun["status"], "FINISHED" | "FAILED" | "PASS" | "NEEDS_REVISION" | "BLOCKED">;
  artifact_ids?: string[];
  metadata?: Record<string, unknown>;
}

export interface AgentRunHeartbeatInput {
  agent_run_id: string;
  message?: string;
  metadata?: Record<string, unknown>;
}

export interface AgentArtifactEvidenceInput {
  agent_run_id: string;
  agent_name: string;
  thread_id: string;
  artifact_type: ArtifactType;
  artifact_path: string;
  artifact_id?: string | null;
  parent_thread_id?: string;
  metadata?: Record<string, unknown>;
}

export interface LoopTransitionRecordInput {
  loop_run_id: string;
  from_status: string;
  to_status: string;
  reason: string;
  agent_run_id?: string;
  metadata?: Record<string, unknown>;
}

export class AgentRunStore {
  private readonly stateDir: string;

  constructor(options: AgentRunStoreOptions = {}) {
    this.stateDir = options.stateDir ?? getStateDir();
  }

  async startAgentRun(input: AgentRunStartInput): Promise<{ agentRun: AgentRun; event: LoopEvent }> {
    const timestamp = now();
    const agentRun: AgentRun = {
      agent_run_id: `agent_run_${input.agent_name}_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      loop_run_id: input.loop_run_id,
      agent_name: input.agent_name,
      agent_type: input.agent_type,
      parent_thread_id: input.parent_thread_id,
      thread_id: input.thread_id,
      task_id: input.task_id,
      module_id: input.module_id,
      phase: input.phase ?? "unspecified",
      status: "STARTED",
      started_at: timestamp,
      updated_at: timestamp,
      finished_at: null,
      artifact_ids: [],
      metadata: input.metadata ?? {}
    };
    assertValid("agent-run", agentRun);
    await insertUnique(this.path("agent-runs.json"), agentRun, (run) => run.agent_run_id, agentRun.agent_run_id);
    const event = await this.appendEvent(input.loop_run_id, "agent_run.started", `Started ${input.agent_name}`, {
      agent_run_id: agentRun.agent_run_id,
      agent_name: input.agent_name,
      thread_id: input.thread_id
    });
    return { agentRun, event };
  }

  async finishAgentRun(input: AgentRunFinishInput): Promise<{ agentRun: AgentRun; event: LoopEvent }> {
    const agentRun = await this.updateAgentRun(input.agent_run_id, (run) => ({
      ...run,
      status: input.status,
      finished_at: now(),
      updated_at: now(),
      artifact_ids: input.artifact_ids ?? run.artifact_ids,
      metadata: {
        ...run.metadata,
        ...(input.metadata ?? {})
      }
    }));
    const event = await this.appendEvent(agentRun.loop_run_id, "agent_run.finished", `Finished ${agentRun.agent_name}`, {
      agent_run_id: agentRun.agent_run_id,
      status: input.status
    });
    return { agentRun, event };
  }

  async heartbeat(input: AgentRunHeartbeatInput): Promise<{ agentRun: AgentRun; event: LoopEvent }> {
    const agentRun = await this.updateAgentRun(input.agent_run_id, (run) => ({
      ...run,
      status: run.status === "STARTED" ? "RUNNING" : run.status,
      updated_at: now(),
      metadata: {
        ...run.metadata,
        last_heartbeat: input.metadata ?? {}
      }
    }));
    const event = await this.appendEvent(agentRun.loop_run_id, "agent_run.heartbeat", input.message ?? `Heartbeat for ${agentRun.agent_name}`, {
      agent_run_id: agentRun.agent_run_id,
      ...(input.metadata ?? {})
    });
    return { agentRun, event };
  }

  async writeArtifactEvidence(input: AgentArtifactEvidenceInput): Promise<{ evidence: SubagentEvidence; producer: ArtifactProducer | null; event: LoopEvent }> {
    const agentRun = await this.getAgentRun(input.agent_run_id);
    if (!agentRun) {
      throw new Error(`agent_run_id not found: ${input.agent_run_id}`);
    }
    if (agentRun.agent_name !== input.agent_name) {
      throw new Error(`agent_name mismatch for ${input.agent_run_id}`);
    }
    if (agentRun.thread_id !== input.thread_id) {
      throw new Error(`thread_id mismatch for ${input.agent_run_id}`);
    }
    enforceArtifactOwnership(input.artifact_type, input.agent_name);
    const evidence: SubagentEvidence = {
      evidence_id: `evidence_${input.agent_run_id}_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      loop_run_id: agentRun.loop_run_id,
      agent_run_id: input.agent_run_id,
      agent_name: input.agent_name,
      thread_id: input.thread_id,
      artifact_type: input.artifact_type,
      artifact_path: input.artifact_path,
      artifact_id: input.artifact_id ?? null,
      created_at: now(),
      metadata: input.metadata ?? {}
    };
    assertValid("subagent-evidence", evidence);
    await insertUnique(this.path("subagent-evidence.json"), evidence, (item) => item.evidence_id, evidence.evidence_id);
    const producer = evidence.artifact_id
      ? await this.writeArtifactProducer({
          loop_run_id: agentRun.loop_run_id,
          artifact_id: evidence.artifact_id,
          artifact_type: input.artifact_type,
          artifact_path: input.artifact_path,
          created_by_agent_run_id: input.agent_run_id,
          created_by_agent_name: input.agent_name,
          created_by_thread_id: input.thread_id,
          parent_thread_id: input.parent_thread_id ?? agentRun.parent_thread_id,
          metadata: input.metadata ?? {}
        })
      : null;
    await this.updateAgentRun(input.agent_run_id, (run) => ({
      ...run,
      artifact_ids: evidence.artifact_id && !run.artifact_ids.includes(evidence.artifact_id) ? [...run.artifact_ids, evidence.artifact_id] : run.artifact_ids,
      updated_at: now()
    }));
    const event = await this.appendEvent(agentRun.loop_run_id, "subagent_evidence.written", `Wrote ${input.artifact_type} evidence`, {
      agent_run_id: input.agent_run_id,
      agent_name: input.agent_name,
      artifact_type: input.artifact_type,
      artifact_path: input.artifact_path,
      artifact_id: evidence.artifact_id
    });
    return { evidence, producer, event };
  }

  async writeEvalReportByAgent(input: { agent_run_id: string; agent_name: string; thread_id: string; parent_thread_id?: string; eval_report: EvalReport }): Promise<{ evidence: SubagentEvidence; producer: ArtifactProducer | null; event: LoopEvent }> {
    if (input.agent_name !== "loop_evaluator") {
      throw new Error("EvalReport evidence must be written by loop_evaluator");
    }
    return this.writeArtifactEvidence({
      agent_run_id: input.agent_run_id,
      agent_name: input.agent_name,
      thread_id: input.thread_id,
      artifact_type: "eval_report",
      artifact_path: `eval:${input.eval_report.eval_id}`,
      artifact_id: input.eval_report.eval_id,
      parent_thread_id: input.parent_thread_id,
      metadata: {
        verdict: input.eval_report.verdict
      }
    });
  }

  async writeRepairRequestByAgent(input: { agent_run_id: string; agent_name: string; thread_id: string; parent_thread_id?: string; repair_request: RepairRequest }): Promise<{ evidence: SubagentEvidence; producer: ArtifactProducer | null; event: LoopEvent }> {
    if (!input.repair_request.source_eval_id) {
      throw new Error("RepairRequest evidence must reference source_eval_id");
    }
    return this.writeArtifactEvidence({
      agent_run_id: input.agent_run_id,
      agent_name: input.agent_name,
      thread_id: input.thread_id,
      artifact_type: "repair_request",
      artifact_path: `repair:${input.repair_request.repair_id}`,
      artifact_id: input.repair_request.repair_id,
      parent_thread_id: input.parent_thread_id,
      metadata: {
        source_eval_id: input.repair_request.source_eval_id
      }
    });
  }

  async recordTransition(input: LoopTransitionRecordInput): Promise<LoopEvent> {
    return this.appendEvent(input.loop_run_id, "loop.transition", `${input.from_status} -> ${input.to_status}`, {
      from_status: input.from_status,
      to_status: input.to_status,
      reason: input.reason,
      agent_run_id: input.agent_run_id ?? null,
      ...(input.metadata ?? {})
    });
  }

  async getAgentRun(agentRunId: string): Promise<AgentRun | null> {
    const runs = await readJsonFile<AgentRun[]>(this.path("agent-runs.json"), []);
    return runs.find((run) => run.agent_run_id === agentRunId) ?? null;
  }

  async listAgentRuns(loopRunId: string): Promise<AgentRun[]> {
    const runs = await readJsonFile<AgentRun[]>(this.path("agent-runs.json"), []);
    return runs.filter((run) => run.loop_run_id === loopRunId);
  }

  async listEvidence(loopRunId: string): Promise<SubagentEvidence[]> {
    const evidence = await readJsonFile<SubagentEvidence[]>(this.path("subagent-evidence.json"), []);
    return evidence.filter((item) => item.loop_run_id === loopRunId);
  }

  async listArtifactProducers(loopRunId: string): Promise<ArtifactProducer[]> {
    const producers = await readJsonFile<ArtifactProducer[]>(this.path("artifact-producers.json"), []);
    return producers.filter((item) => item.loop_run_id === loopRunId);
  }

  private async updateAgentRun(agentRunId: string, update: (run: AgentRun) => AgentRun): Promise<AgentRun> {
    const path = this.path("agent-runs.json");
    const runs = await readJsonFile<AgentRun[]>(path, []);
    const index = runs.findIndex((run) => run.agent_run_id === agentRunId);
    if (index === -1) {
      throw new Error(`agent_run_id not found: ${agentRunId}`);
    }
    const updated = update(runs[index]);
    assertValid("agent-run", updated);
    runs[index] = updated;
    await writeJsonFileAtomic(path, runs);
    return updated;
  }

  private async appendEvent(loopRunId: string, type: string, message: string, metadata: Record<string, unknown>): Promise<LoopEvent> {
    const timestamp = now();
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

  private async writeArtifactProducer(input: Omit<ArtifactProducer, "producer_id" | "created_at">): Promise<ArtifactProducer> {
    const producer: ArtifactProducer = {
      producer_id: `producer_${input.created_by_agent_run_id}_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      created_at: now(),
      ...input
    };
    assertValid("artifact-producer", producer);
    await insertUnique(this.path("artifact-producers.json"), producer, (item) => item.producer_id, producer.producer_id);
    return producer;
  }

  private path(name: "agent-runs.json" | "subagent-evidence.json" | "artifact-producers.json" | "events.json"): string {
    return `${this.stateDir}/${name}`;
  }
}

export function enforceArtifactOwnership(artifactType: ArtifactType, agentName: string): void {
  const allowedAgentByType: Partial<Record<ArtifactType, string[]>> = {
    prd: ["loop_planner"],
    acceptance_criteria: ["loop_planner"],
    task_graph: ["loop_planner"],
    dev_result: ["loop_dev_worker"],
    eval_report: ["loop_evaluator"],
    repair_request: ["loop_evaluator", "loop_integration_manager"],
    context_capsule: ["loop_context_distiller"],
    final_report: ["loop_integration_manager"]
  };
  const allowed = allowedAgentByType[artifactType];
  if (allowed && !allowed.includes(agentName)) {
    throw new Error(`${artifactType} evidence must be written by ${allowed.join(" or ")}, not ${agentName}`);
  }
}

async function insertUnique<T>(path: string, item: T, getId: (item: T) => string, id: string): Promise<void> {
  const collection = await readJsonFile<T[]>(path, []);
  if (collection.some((existing) => getId(existing) === id)) {
    throw new Error(`id already exists: ${id}`);
  }
  await writeJsonFileAtomic(path, [...collection, item]);
}

function now(): string {
  return new Date().toISOString();
}
