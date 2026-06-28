export type TaskRiskLevel = "low" | "medium" | "high";
export type TaskStatus = "TODO" | "READY_FOR_DEV" | "DEV_RUNNING" | "DEV_DONE" | "EVAL_RUNNING" | "PASS" | "NEEDS_REVISION" | "REPAIR_REQUESTED" | "BLOCKED" | "CANCELLED";

export interface PlannerTaskGraphDefaults {
  loop_run_id: string;
  default_module_id: string;
  default_owner_agent_type: string;
  default_owner_agent_id: string | null;
  default_reviewer_agent_type: string | null;
  default_reviewer_agent_id: string | null;
  default_validation_commands: string[];
  default_likely_files: string[];
  now: string;
}

export interface NormalizedPlannerTask {
  task_id: string;
  loop_run_id: string;
  module_id: string;
  title: string;
  description: string;
  owner_agent_type: string;
  owner_agent_id: string | null;
  reviewer_agent_type: string | null;
  reviewer_agent_id: string | null;
  dependencies: string[];
  scope: string[];
  non_goals: string[];
  likely_files: Array<{
    path: string;
    purpose?: string;
  }>;
  acceptance_criteria: string[];
  validation_commands: Array<{
    command: string;
    cwd?: string;
    reason?: string;
    env?: Record<string, string>;
  }>;
  risk_level: TaskRiskLevel;
  status: TaskStatus;
  revision_count: number;
  branch: string | null;
  worktree_path: string | null;
  artifact_ids: string[];
  created_at: string;
  updated_at: string;
  metadata: Record<string, unknown>;
}

export interface NormalizedPlannerTaskGraph {
  tasks: NormalizedPlannerTask[];
  edges: Array<{
    from_task_id: string;
    to_task_id: string;
    reason: string;
  }>;
}

const TASK_STATUSES = new Set<TaskStatus>([
  "TODO",
  "READY_FOR_DEV",
  "DEV_RUNNING",
  "DEV_DONE",
  "EVAL_RUNNING",
  "PASS",
  "NEEDS_REVISION",
  "REPAIR_REQUESTED",
  "BLOCKED",
  "CANCELLED"
]);
const RISK_LEVELS = new Set<TaskRiskLevel>(["low", "medium", "high"]);

export function normalizePlannerTaskGraph(rawTaskGraph: unknown, defaults: PlannerTaskGraphDefaults): NormalizedPlannerTaskGraph {
  const root = isRecord(rawTaskGraph) ? rawTaskGraph : {};
  const rawTasks = readTaskArray(root);
  const tasks = rawTasks.map((task, index) => normalizeTask(task, index, defaults));

  return {
    tasks,
    edges: normalizeEdges(root.edges, tasks)
  };
}

function readTaskArray(root: Record<string, unknown>): Record<string, unknown>[] {
  if (Array.isArray(root.tasks)) {
    return root.tasks.filter(isRecord);
  }

  if (isRecord(root.task)) {
    return [root.task];
  }

  if (hasTaskLikeShape(root)) {
    return [root];
  }

  return [];
}

function normalizeTask(rawTask: Record<string, unknown>, index: number, defaults: PlannerTaskGraphDefaults): NormalizedPlannerTask {
  const title = readNonEmptyString(rawTask.title) ?? `Task ${index + 1}`;
  const description = readNonEmptyString(rawTask.description) ?? title;
  const taskId = readNonEmptyString(rawTask.task_id) ?? readNonEmptyString(rawTask.taskId) ?? readNonEmptyString(rawTask.id) ?? `task_${index + 1}`;
  const dependencies = normalizeStringArray(rawTask.dependencies ?? rawTask.depends_on);
  const likelyFiles = normalizeLikelyFiles(rawTask.likely_files ?? rawTask.likelyFiles ?? rawTask.files, defaults.default_likely_files);
  const validationCommands = normalizeValidationCommands(rawTask.validation_commands ?? rawTask.validationCommands ?? rawTask.validation, defaults.default_validation_commands);

  return {
    task_id: taskId,
    loop_run_id: defaults.loop_run_id,
    module_id: readNonEmptyString(rawTask.module_id) ?? defaults.default_module_id,
    title,
    description,
    owner_agent_type: readNonEmptyString(rawTask.owner_agent_type) ?? defaults.default_owner_agent_type,
    owner_agent_id: readNullableString(rawTask.owner_agent_id) ?? defaults.default_owner_agent_id,
    reviewer_agent_type: readNullableString(rawTask.reviewer_agent_type) ?? defaults.default_reviewer_agent_type,
    reviewer_agent_id: readNullableString(rawTask.reviewer_agent_id) ?? defaults.default_reviewer_agent_id,
    dependencies,
    scope: normalizeStringArray(rawTask.scope, [description || title]),
    non_goals: normalizeStringArray(rawTask.non_goals),
    likely_files: likelyFiles,
    acceptance_criteria: normalizeStringArray(rawTask.acceptance_criteria ?? rawTask.acceptanceCriteria),
    validation_commands: validationCommands,
    risk_level: normalizeRiskLevel(rawTask.risk_level),
    status: normalizeTaskStatus(rawTask.status),
    revision_count: normalizeRevisionCount(rawTask.revision_count),
    branch: normalizeNullableNonEmpty(rawTask.branch),
    worktree_path: normalizeNullableNonEmpty(rawTask.worktree_path),
    artifact_ids: normalizeStringArray(rawTask.artifact_ids),
    created_at: readNonEmptyString(rawTask.created_at) ?? defaults.now,
    updated_at: readNonEmptyString(rawTask.updated_at) ?? defaults.now,
    metadata: normalizeMetadata(rawTask)
  };
}

function normalizeMetadata(rawTask: Record<string, unknown>): Record<string, unknown> {
  const metadata = isRecord(rawTask.metadata) ? { ...rawTask.metadata } : {};
  if (isRecord(rawTask.safety_notes)) {
    metadata.safety_notes = rawTask.safety_notes;
  }
  return metadata;
}

function normalizeLikelyFiles(value: unknown, defaultPaths: string[]): NormalizedPlannerTask["likely_files"] {
  const items = Array.isArray(value) ? value : [];
  const files = items.flatMap((item): NormalizedPlannerTask["likely_files"] => {
    if (typeof item === "string" && item.trim().length > 0) {
      return [{ path: item.trim(), purpose: "Likely implementation file" }];
    }
    if (isRecord(item)) {
      const path = readNonEmptyString(item.path);
      if (!path) return [];
      const purpose = readNonEmptyString(item.purpose);
      return purpose ? [{ path, purpose }] : [{ path }];
    }
    return [];
  });

  if (files.length > 0) {
    return files;
  }

  return defaultPaths.filter((path) => path.trim().length > 0).map((path) => ({
    path: path.trim(),
    purpose: "Likely implementation file"
  }));
}

function normalizeValidationCommands(value: unknown, defaultCommands: string[]): NormalizedPlannerTask["validation_commands"] {
  const items = Array.isArray(value) ? value : [];
  const commands = items.flatMap((item): NormalizedPlannerTask["validation_commands"] => {
    if (typeof item === "string" && item.trim().length > 0) {
      return [{ command: item.trim(), reason: "Validate task behavior" }];
    }
    if (isRecord(item)) {
      const command = readNonEmptyString(item.command);
      if (!command) return [];
      const normalized: NormalizedPlannerTask["validation_commands"][number] = { command };
      const cwd = readNonEmptyString(item.cwd);
      const reason = readString(item.reason);
      if (cwd) normalized.cwd = cwd;
      if (reason !== undefined) normalized.reason = reason;
      if (isStringRecord(item.env)) normalized.env = item.env;
      return [normalized];
    }
    return [];
  });

  if (commands.length > 0) {
    return commands;
  }

  return defaultCommands.filter((command) => command.trim().length > 0).map((command) => ({
    command: command.trim(),
    reason: "Validate task behavior"
  }));
}

function normalizeEdges(value: unknown, tasks: NormalizedPlannerTask[]): NormalizedPlannerTaskGraph["edges"] {
  const taskIds = new Set(tasks.map((task) => task.task_id));
  const explicitEdges = (Array.isArray(value) ? value : []).flatMap((edge): NormalizedPlannerTaskGraph["edges"] => {
    if (!isRecord(edge)) return [];
    const from = readNonEmptyString(edge.from_task_id) ?? readNonEmptyString(edge.from) ?? readNonEmptyString(edge.source);
    const to = readNonEmptyString(edge.to_task_id) ?? readNonEmptyString(edge.to) ?? readNonEmptyString(edge.target);
    if (!from || !to) return [];
    return [
      {
        from_task_id: from,
        to_task_id: to,
        reason: readNonEmptyString(edge.reason) ?? "Task dependency"
      }
    ];
  });

  const dependencyEdges = tasks.flatMap((task) =>
    task.dependencies
      .filter((dependency) => taskIds.has(dependency))
      .map((dependency) => ({
        from_task_id: dependency,
        to_task_id: task.task_id,
        reason: "Task dependency"
      }))
  );

  return dedupeEdges([...explicitEdges, ...dependencyEdges]);
}

function dedupeEdges(edges: NormalizedPlannerTaskGraph["edges"]): NormalizedPlannerTaskGraph["edges"] {
  const seen = new Set<string>();
  return edges.filter((edge) => {
    const key = `${edge.from_task_id}\u0000${edge.to_task_id}\u0000${edge.reason}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeStringArray(value: unknown, fallback: string[] = []): string[] {
  const source = Array.isArray(value) ? value : fallback;
  return source.flatMap((item) => {
    if (typeof item !== "string") return [];
    const trimmed = item.trim();
    return trimmed.length > 0 ? [trimmed] : [];
  });
}

function normalizeRiskLevel(value: unknown): TaskRiskLevel {
  return typeof value === "string" && RISK_LEVELS.has(value as TaskRiskLevel) ? (value as TaskRiskLevel) : "low";
}

function normalizeTaskStatus(value: unknown): TaskStatus {
  return typeof value === "string" && TASK_STATUSES.has(value as TaskStatus) ? (value as TaskStatus) : "READY_FOR_DEV";
}

function normalizeRevisionCount(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0;
}

function normalizeNullableNonEmpty(value: unknown): string | null {
  return readNonEmptyString(value) ?? null;
}

function readNullableString(value: unknown): string | null | undefined {
  if (value === null) return null;
  return readNonEmptyString(value);
}

function readNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function hasTaskLikeShape(value: Record<string, unknown>): boolean {
  return Boolean(value.task_id ?? value.taskId ?? value.id ?? value.title ?? value.description);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!isRecord(value)) return false;
  return Object.values(value).every((entry) => typeof entry === "string");
}
