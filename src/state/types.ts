import type {
  AgentProfile,
  ContextCapsule,
  EvalReport,
  LoopRun,
  TaskNode,
  TaskStatus,
  Artifact,
  Metadata
} from "../core/types.ts";

export type CreateLoopRunInput = LoopRun;
export type UpdateLoopRunInput = Partial<Omit<LoopRun, "loop_run_id" | "created_at">>;
export type RegisterAgentInput = AgentProfile;
export type CreateTaskInput = TaskNode;
export type WriteArtifactInput = Artifact;
export type WriteEvalReportInput = EvalReport;
export type WriteContextCapsuleInput = ContextCapsule;

export interface UpdateAgentThreadInput {
  current_thread_id: string;
}

export interface UpdateTaskStatusInput {
  status: TaskStatus;
}

export interface AppendEventInput {
  event_id: string;
  loop_run_id: string;
  type: string;
  message: string;
  created_at?: string;
  updated_at?: string;
  metadata?: Metadata;
}

export interface LoopEvent {
  event_id: string;
  loop_run_id: string;
  type: string;
  message: string;
  created_at: string;
  updated_at: string;
  metadata: Metadata;
}

export interface LoopStore {
  createLoopRun(input: CreateLoopRunInput): Promise<LoopRun>;
  getLoopRun(loopRunId: string): Promise<LoopRun | null>;
  updateLoopRun(loopRunId: string, patch: UpdateLoopRunInput): Promise<LoopRun>;
  listLoopRuns(): Promise<LoopRun[]>;
  registerAgent(input: RegisterAgentInput): Promise<AgentProfile>;
  getAgent(agentId: string): Promise<AgentProfile | null>;
  updateAgentThread(agentId: string, threadUpdate: UpdateAgentThreadInput): Promise<AgentProfile>;
  listAgents(): Promise<AgentProfile[]>;
  createTask(input: CreateTaskInput): Promise<TaskNode>;
  getTask(taskId: string): Promise<TaskNode | null>;
  updateTaskStatus(taskId: string, statusPatch: UpdateTaskStatusInput): Promise<TaskNode>;
  listTasksByLoopRun(loopRunId: string): Promise<TaskNode[]>;
  writeArtifact(input: WriteArtifactInput): Promise<Artifact>;
  getArtifact(artifactId: string): Promise<Artifact | null>;
  listArtifactsByTask(taskId: string): Promise<Artifact[]>;
  writeEvalReport(input: WriteEvalReportInput): Promise<EvalReport>;
  getEvalReport(evalId: string): Promise<EvalReport | null>;
  listEvalReportsByTask(taskId: string): Promise<EvalReport[]>;
  writeContextCapsule(input: WriteContextCapsuleInput): Promise<ContextCapsule>;
  getContextCapsule(capsuleId: string): Promise<ContextCapsule | null>;
  listContextCapsulesByAgent(agentId: string): Promise<ContextCapsule[]>;
  appendEvent(input: AppendEventInput): Promise<LoopEvent>;
  listEvents(loopRunId: string): Promise<LoopEvent[]>;
}
