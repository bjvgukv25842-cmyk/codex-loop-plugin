import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface LoopAgentTemplate {
  fileName: string;
  name: string;
  description: string;
  model_reasoning_effort: "medium" | "high";
  sandbox_mode: "read-only" | "workspace-write";
  developer_instructions: string;
}

export interface BootstrapReport {
  status: "PASS" | "NEEDS_REVISION" | "BLOCKED";
  agents_dir: string;
  config_path: string;
  created_files: string[];
  existing_files: string[];
  missing_files: string[];
  custom_agents_materialized: string[];
  config_checked: boolean;
  config_updated: boolean;
  validation_errors: string[];
}

export interface BootstrapOptions {
  repoRoot?: string;
  dryRun?: boolean;
}

export const LOOP_AGENT_TEMPLATES: LoopAgentTemplate[] = [
  {
    fileName: "loop-planner.toml",
    name: "loop_planner",
    description: "Native Codex Loop planner subagent. Creates PRD, acceptance criteria, and TaskGraph through MCP/state evidence. Does not write production code.",
    model_reasoning_effort: "high",
    sandbox_mode: "read-only",
    developer_instructions: `You are loop_planner, the native planner subagent for codex-loop-plugin.

Responsibilities:
1. Read the user goal and source-of-truth files.
2. Produce PRD, acceptance criteria, and TaskGraph artifacts.
3. Write artifacts through MCP/state with your agent_run_id and thread_id.
4. Include dependencies, validation commands, owner_agent_type, scope, and acceptance criteria for each task.
5. Mark existing broken behavior as needing baseline evaluation before development when the target repo already has implementation/tests.

Non-goals:
1. Do not write production code.
2. Do not create EvalReport.
3. Do not role-play another subagent.
4. Do not proceed without agent_run_id/thread_id evidence.

Required output:
Bootstrap-compatible planner result with artifact paths, agent_run_id, thread_id, TaskGraph summary, and the next required subagent phase.`
  },
  {
    fileName: "loop-dev-worker.toml",
    name: "loop_dev_worker",
    description: "Native Codex Loop development subagent. Implements one TaskNode or RepairRequest and records DevResult with validation evidence.",
    model_reasoning_effort: "medium",
    sandbox_mode: "workspace-write",
    developer_instructions: `You are loop_dev_worker, the native development subagent for codex-loop-plugin.

Responsibilities:
1. Implement exactly one assigned TaskNode or RepairRequest.
2. Keep changes inside allowed scope.
3. Run validation commands.
4. Record DevResult through MCP/state with agent_run_id and thread_id.
5. Prefer RepairRequest input after a baseline evaluator NEEDS_REVISION verdict. If no TaskNode or RepairRequest is provided, stop as BLOCKED.

Non-goals:
1. Do not plan the whole project.
2. Do not write EvalReport.
3. Do not expand repair scope.
4. Do not proceed to the next module.

Required output:
DevResult with changed_files, validation_commands, validation_result, remaining_risks, agent_run_id, and thread_id.`
  },
  {
    fileName: "loop-evaluator.toml",
    name: "loop_evaluator",
    description: "Native Codex Loop read-only evaluator subagent. Evaluates artifacts, diffs, and tests and writes EvalReport evidence.",
    model_reasoning_effort: "high",
    sandbox_mode: "read-only",
    developer_instructions: `You are loop_evaluator, the native read-only evaluator subagent for codex-loop-plugin.

Responsibilities:
1. Read PRD, TaskGraph, artifacts, diffs, and validation logs.
2. Produce EvalReport with PASS or NEEDS_REVISION.
3. Include concrete findings and required_fixes when NEEDS_REVISION.
4. Write EvalReport through MCP/state with agent_run_id and thread_id.
5. When evaluating the baseline state before development, compare the current implementation to the PRD/tests and return NEEDS_REVISION if the implementation is intentionally broken or validation fails.

Non-goals:
1. Do not modify files.
2. Do not run destructive commands.
3. Do not approve without evidence.
4. Do not role-play dev_worker.

Required output:
EvalReport JSON with verdict, findings, required_fixes, validation_commands_checked, agent_run_id, and thread_id.`
  },
  {
    fileName: "loop-context-distiller.toml",
    name: "loop_context_distiller",
    description: "Native Codex Loop context distiller subagent. Creates ContextCapsule evidence for restart and compaction recovery.",
    model_reasoning_effort: "high",
    sandbox_mode: "read-only",
    developer_instructions: `You are loop_context_distiller, the native context distiller subagent for codex-loop-plugin.

Responsibilities:
1. Read source-of-truth files, recent events, artifacts, and evaluator findings.
2. Produce ContextCapsule with current module, current task, completed work, open issues, risks, and next_instruction.
3. Preserve agent_id, old_thread_id, agent_run_id, and thread_id evidence.

Non-goals:
1. Do not modify production code.
2. Do not invent completed work.
3. Do not hide evaluator findings.

Required output:
ContextCapsule JSON with restart facts, source files, validation status, agent_run_id, and thread_id.`
  },
  {
    fileName: "loop-integration-manager.toml",
    name: "loop_integration_manager",
    description: "Native Codex Loop integration subagent. Produces final delivery report only after evaluator PASS evidence exists.",
    model_reasoning_effort: "high",
    sandbox_mode: "workspace-write",
    developer_instructions: `You are loop_integration_manager, the native integration manager subagent for codex-loop-plugin.

Responsibilities:
1. Verify evaluator PASS evidence before final reporting.
2. Check cross-agent artifacts and state references.
3. Produce FinalDeliveryReport with agent_run_id, thread_id, artifact refs, validation commands, and risks.

Non-goals:
1. Do not bypass evaluator findings.
2. Do not hide validation failures.
3. Do not claim publication or unsupported runtime integration.

Required output:
FinalDeliveryReport and structured integration result with agent_run_id/thread_id references.`
  }
];

export function materializeLoopAgents(options: BootstrapOptions = {}): BootstrapReport {
  const repoRoot = options.repoRoot ?? process.cwd();
  const agentsDir = join(repoRoot, ".codex", "agents");
  const configPath = join(repoRoot, ".codex", "config.toml");
  const createdFiles: string[] = [];
  const existingFiles: string[] = [];
  const validationErrors: string[] = [];

  try {
    if (!options.dryRun) {
      mkdirSync(agentsDir, { recursive: true });
      mkdirSync(dirname(configPath), { recursive: true });
    }

    for (const template of LOOP_AGENT_TEMPLATES) {
      const targetPath = join(agentsDir, template.fileName);
      if (existsSync(targetPath)) {
        existingFiles.push(relative(repoRoot, targetPath));
        continue;
      }
      if (!options.dryRun) {
        writeFileSync(targetPath, renderAgentToml(template), "utf8");
      }
      createdFiles.push(relative(repoRoot, targetPath));
    }

    let configUpdated = false;
    const currentConfig = existsSync(configPath) ? readFileSync(configPath, "utf8") : "";
    if (!hasRequiredAgentConfig(currentConfig)) {
      configUpdated = true;
      if (!options.dryRun) {
        writeFileSync(configPath, renderAgentConfig(currentConfig), "utf8");
      }
    }

    const verification = verifyLoopAgentMaterialization(repoRoot);
    validationErrors.push(...verification.errors);

    return {
      status: validationErrors.length === 0 ? "PASS" : "NEEDS_REVISION",
      agents_dir: relative(repoRoot, agentsDir),
      config_path: relative(repoRoot, configPath),
      created_files: createdFiles,
      existing_files: existingFiles,
      missing_files: verification.missing_files,
      custom_agents_materialized: LOOP_AGENT_TEMPLATES.map((template) => template.name),
      config_checked: verification.config_checked,
      config_updated: configUpdated,
      validation_errors: validationErrors
    };
  } catch (error) {
    return {
      status: "BLOCKED",
      agents_dir: relative(repoRoot, agentsDir),
      config_path: relative(repoRoot, configPath),
      created_files: createdFiles,
      existing_files: existingFiles,
      missing_files: [],
      custom_agents_materialized: [],
      config_checked: false,
      config_updated: false,
      validation_errors: [error instanceof Error ? error.message : String(error)]
    };
  }
}

export function verifyLoopAgentMaterialization(repoRoot = process.cwd()): {
  valid: boolean;
  missing_files: string[];
  config_checked: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  const missingFiles: string[] = [];
  const agentsDir = join(repoRoot, ".codex", "agents");
  const configPath = join(repoRoot, ".codex", "config.toml");

  for (const template of LOOP_AGENT_TEMPLATES) {
    const targetPath = join(agentsDir, template.fileName);
    if (!existsSync(targetPath)) {
      const file = relative(repoRoot, targetPath);
      missingFiles.push(file);
      errors.push(`Missing native loop agent: ${file}`);
      continue;
    }
    const content = readFileSync(targetPath, "utf8");
    for (const required of [
      `name = "${template.name}"`,
      "description = ",
      "developer_instructions = ",
      `sandbox_mode = "${template.sandbox_mode}"`,
      "model_reasoning_effort = "
    ]) {
      if (!content.includes(required)) {
        errors.push(`${relative(repoRoot, targetPath)} missing ${required}`);
      }
    }
  }

  const config = existsSync(configPath) ? readFileSync(configPath, "utf8") : "";
  const configChecked = hasRequiredAgentConfig(config);
  if (!configChecked) {
    errors.push(".codex/config.toml missing [agents] max_threads = 6 and max_depth = 1");
  }

  return {
    valid: errors.length === 0,
    missing_files: missingFiles,
    config_checked: configChecked,
    errors
  };
}

export function renderAgentToml(template: LoopAgentTemplate): string {
  return `name = "${template.name}"
description = "${escapeTomlString(template.description)}"
model_reasoning_effort = "${template.model_reasoning_effort}"
sandbox_mode = "${template.sandbox_mode}"

developer_instructions = """
${template.developer_instructions}
"""
`;
}

function hasRequiredAgentConfig(config: string): boolean {
  return /\[agents\]/.test(config) && /\bmax_threads\s*=\s*6\b/.test(config) && /\bmax_depth\s*=\s*1\b/.test(config);
}

function renderAgentConfig(currentConfig: string): string {
  const trimmed = currentConfig.trimEnd();
  const block = "[agents]\nmax_threads = 6\nmax_depth = 1\n";
  if (!trimmed) {
    return block;
  }
  if (/\[agents\]/.test(trimmed)) {
    return `${trimmed}\n`;
  }
  return `${trimmed}\n\n${block}`;
}

function relative(root: string, path: string): string {
  return path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
}

function escapeTomlString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const report = materializeLoopAgents();
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.status === "PASS" ? 0 : 1;
}
