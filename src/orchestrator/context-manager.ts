import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { AgentProfile, ContextCapsule, LoopRun, TaskNode } from "../core/types.ts";
import type { LoopStore } from "../state/types.ts";

export interface ContextCapsuleDraftInput {
  loop_run_id: string;
  agent_id: string;
  task_id?: string;
  restart_reason: string;
  next_instruction: string;
  artifact_dir?: string;
}

export interface ContextCapsuleDraftResult {
  capsule: ContextCapsule;
  artifact_path: string;
}

export class ContextManager {
  constructor(private readonly store: LoopStore) {}

  async createCapsuleDraft(input: ContextCapsuleDraftInput): Promise<ContextCapsuleDraftResult> {
    const loopRun = await requireLoopRun(this.store, input.loop_run_id);
    const agent = await requireAgent(this.store, input.agent_id);
    const task = input.task_id ? await this.store.getTask(input.task_id) : null;
    const timestamp = new Date().toISOString();
    const capsule: ContextCapsule = {
      capsule_id: `capsule_${agent.agent_id}_${Date.now()}`,
      loop_run_id: loopRun.loop_run_id,
      agent_id: agent.agent_id,
      agent_type: agent.agent_type,
      old_thread_id: agent.current_thread_id,
      new_thread_id: null,
      restart_reason: input.restart_reason,
      current_module: loopRun.current_module_id,
      current_task: task?.task_id ?? "",
      completed_modules: [],
      completed_work: [],
      open_issues: [],
      evaluator_findings: [],
      repair_requests: [],
      decisions: [],
      validation_status: {
        commands_run: [],
        passed: [],
        failed: [],
        not_run_reason: ""
      },
      files_changed_recently: task?.likely_files ?? [],
      source_of_truth_files: loopRun.source_of_truth_files,
      next_instruction: input.next_instruction,
      do_not_repeat: ["Do not rely on chat history as the only source of truth."],
      risks: [],
      created_at: timestamp,
      updated_at: timestamp
    };

    const written = await this.store.writeContextCapsule(capsule);
    const artifactPath = join(input.artifact_dir ?? "artifacts/context-capsules", `${written.capsule_id}.json`);
    await mkdir(dirname(artifactPath), { recursive: true });
    await writeFile(artifactPath, `${JSON.stringify(written, null, 2)}\n`, "utf8");

    return {
      capsule: written,
      artifact_path: artifactPath
    };
  }
}

async function requireLoopRun(store: LoopStore, loopRunId: string): Promise<LoopRun> {
  const loopRun = await store.getLoopRun(loopRunId);
  if (!loopRun) {
    throw new Error(`LoopRun not found: ${loopRunId}`);
  }
  return loopRun;
}

async function requireAgent(store: LoopStore, agentId: string): Promise<AgentProfile> {
  const agent = await store.getAgent(agentId);
  if (!agent) {
    throw new Error(`AgentProfile not found: ${agentId}`);
  }
  return agent;
}
