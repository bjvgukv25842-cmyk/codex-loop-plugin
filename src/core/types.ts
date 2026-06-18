export type Metadata = Record<string, unknown>;

export type LoopStatus =
  | "IDLE"
  | "GOAL_RECEIVED"
  | "PRD_DRAFTING"
  | "PRD_READY"
  | "TASK_GRAPH_READY"
  | "DEV_DISPATCHING"
  | "DEV_RUNNING"
  | "DEV_DONE"
  | "EVAL_RUNNING"
  | "REPAIR_REQUESTED"
  | "VALIDATION_RUNNING"
  | "READY_FOR_NEXT_MODULE"
  | "READY_FOR_MERGE"
  | "DONE"
  | "BLOCKED"
  | "FAILED"
  | "CONTEXT_RESTARTING";

export type ModuleStatus =
  | "NOT_STARTED"
  | "IN_PROGRESS"
  | "PASS"
  | "NEEDS_REVISION"
  | "BLOCKED"
  | "SKIPPED";

export type TaskStatus =
  | "TODO"
  | "READY_FOR_DEV"
  | "DEV_RUNNING"
  | "DEV_DONE"
  | "EVAL_RUNNING"
  | "PASS"
  | "NEEDS_REVISION"
  | "REPAIR_REQUESTED"
  | "BLOCKED"
  | "CANCELLED";

export type AgentStatus =
  | "IDLE"
  | "READY"
  | "RUNNING"
  | "BLOCKED"
  | "DONE"
  | "FAILED"
  | "CONTEXT_RESTARTING";

export type AgentType =
  | "planner"
  | "task_dispatcher"
  | "dev_worker"
  | "evaluator"
  | "test_reviewer"
  | "architecture_reviewer"
  | "context_distiller"
  | "integration_manager";

export type ArtifactType =
  | "prd"
  | "acceptance_criteria"
  | "task_graph"
  | "implementation_plan"
  | "dev_result"
  | "diff"
  | "test_report"
  | "eval_report"
  | "repair_request"
  | "context_capsule"
  | "final_report"
  | "log";

export type EvalVerdict = "PASS" | "NEEDS_REVISION";
export type FindingSeverity = "low" | "medium" | "high";

export type FindingCategory =
  | "correctness"
  | "test_gap"
  | "schema_gap"
  | "docs_gap"
  | "scope_creep"
  | "safety"
  | "maintainability"
  | "integration_risk";

export type ValidationResult = "passed" | "failed" | "not_run";
export type SandboxMode = "read-only" | "workspace-write" | "danger-full-access";
export type RiskLevel = "low" | "medium" | "high";
export type EvaluatorVerdict = EvalVerdict | "NOT_RUN";

export interface ValidationCommand {
  command: string;
  cwd?: string;
  reason?: string;
  env?: Record<string, string>;
}

export interface EvidenceRef {
  type: "file" | "command" | "artifact" | "url" | "text";
  ref: string;
  summary?: string;
  line?: number;
}

export interface FileRef {
  path: string;
  purpose?: string;
}

export interface LoopRun {
  loop_run_id: string;
  project_id: string;
  user_goal: string;
  normalized_goal: string;
  status: LoopStatus;
  current_module_id: string;
  current_iteration: number;
  max_iterations: number;
  source_of_truth_files: string[];
  started_at: string;
  updated_at: string;
  completed_at: string | null;
  stop_conditions: string[];
  budget: {
    max_repair_iterations_per_task: number;
    max_context_restarts_per_agent: number;
  };
  metadata: Metadata;
}

export interface AgentProfile {
  agent_id: string;
  agent_type: AgentType;
  codex_agent_name: string;
  display_name: string;
  role_contract: {
    responsibilities: string[];
    non_goals: string[];
    required_inputs: string[];
    required_outputs: string[];
  };
  current_thread_id: string;
  previous_thread_ids: string[];
  skills: string[];
  mcp_servers: string[];
  sandbox_mode: SandboxMode;
  status: AgentStatus;
  assigned_task_ids: string[];
  created_at: string;
  updated_at: string;
  metadata: Metadata;
}

export interface TaskNode {
  task_id: string;
  loop_run_id: string;
  module_id: string;
  title: string;
  description: string;
  owner_agent_type: AgentType;
  owner_agent_id: string | null;
  reviewer_agent_type: AgentType | null;
  reviewer_agent_id: string | null;
  dependencies: string[];
  scope: string[];
  non_goals: string[];
  likely_files: FileRef[];
  acceptance_criteria: string[];
  validation_commands: ValidationCommand[];
  risk_level: RiskLevel;
  status: TaskStatus;
  revision_count: number;
  branch: string | null;
  worktree_path: string | null;
  artifact_ids: string[];
  created_at: string;
  updated_at: string;
  metadata: Metadata;
}

export interface TaskGraphEdge {
  from_task_id: string;
  to_task_id: string;
  reason: string;
}

export interface TaskGraph {
  task_graph_id: string;
  loop_run_id: string;
  prd_artifact_id: string;
  root_goal: string;
  tasks: TaskNode[];
  edges: TaskGraphEdge[];
  status: LoopStatus;
  created_at: string;
  updated_at: string;
}

export interface Artifact {
  artifact_id: string;
  loop_run_id: string;
  task_id: string | null;
  module_id: string | null;
  type: ArtifactType;
  path: string;
  hash: string | null;
  summary: string;
  created_by_agent_id: string;
  created_at: string;
  updated_at: string;
  metadata: Metadata;
}

export interface EvalFinding {
  finding_id: string;
  severity: FindingSeverity;
  category: FindingCategory;
  description: string;
  evidence: EvidenceRef[];
  required_fix: string;
}

export interface EvalRequiredFix {
  fix_id: string;
  finding_ids: string[];
  instruction: string;
  expected_files: FileRef[];
  validation_commands: ValidationCommand[];
}

export interface EvalReport {
  eval_id: string;
  loop_run_id: string;
  task_id: string;
  module_id: string;
  evaluator_agent_id: string;
  verdict: EvalVerdict;
  confidence: number;
  findings: EvalFinding[];
  required_fixes: EvalRequiredFix[];
  validation_commands_checked: ValidationCommand[];
  created_at: string;
  updated_at: string;
  metadata: Metadata;
}

export interface RepairRequest {
  repair_id: string;
  loop_run_id: string;
  task_id: string;
  module_id: string;
  source_eval_id: string;
  assigned_agent_id: string;
  findings: EvalFinding[];
  repair_instructions: string[];
  allowed_scope: string[];
  disallowed_scope: string[];
  validation_commands: ValidationCommand[];
  status: TaskStatus;
  created_at: string;
  updated_at: string;
}

export interface ContextCapsule {
  capsule_id: string;
  loop_run_id: string;
  agent_id: string;
  agent_type: AgentType;
  old_thread_id: string;
  new_thread_id: string | null;
  restart_reason: string;
  current_module: string;
  current_task: string;
  completed_modules: string[];
  completed_work: string[];
  open_issues: string[];
  evaluator_findings: EvalFinding[];
  repair_requests: string[];
  decisions: string[];
  validation_status: {
    commands_run: ValidationCommand[];
    passed: string[];
    failed: string[];
    not_run_reason: string;
  };
  files_changed_recently: FileRef[];
  source_of_truth_files: string[];
  next_instruction: string;
  do_not_repeat: string[];
  risks: string[];
  created_at: string;
  updated_at: string;
}

export interface ModuleProgress {
  module_id: string;
  module_name: string;
  status: ModuleStatus;
  started_at: string;
  completed_at: string | null;
  changed_files: FileRef[];
  validation_commands: ValidationCommand[];
  validation_result: ValidationResult;
  evaluator_verdict: EvaluatorVerdict;
  docs_updated: string[];
  decisions_added: string[];
  remaining_risks: string[];
  next_module: string;
  ready_for_next_module: boolean;
}
