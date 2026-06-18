import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

export interface AgentValidationIssue {
  path: string;
  message: string;
}

export interface AgentValidationResult {
  valid: boolean;
  errors: AgentValidationIssue[];
  warnings: AgentValidationIssue[];
  agentsChecked: string[];
  configChecked: boolean;
}

export interface AgentDefinition {
  filePath: string;
  fileBaseName: string;
  name: string;
  description: string;
  developer_instructions: string;
  model_reasoning_effort?: string;
  sandbox_mode?: string;
}

export const REQUIRED_AGENTS = [
  "planner",
  "dev_worker",
  "evaluator",
  "context_distiller",
  "integration_manager",
  "test_reviewer",
  "architecture_reviewer"
] as const;

export const AGENT_FILE_BY_NAME: Record<(typeof REQUIRED_AGENTS)[number], string> = {
  planner: "planner.toml",
  dev_worker: "dev-worker.toml",
  evaluator: "evaluator.toml",
  context_distiller: "context-distiller.toml",
  integration_manager: "integration-manager.toml",
  test_reviewer: "test-reviewer.toml",
  architecture_reviewer: "architecture-reviewer.toml"
};

const agentsRoot = ".codex/agents";
const configPath = ".codex/config.toml";

const readOnlyAgents = new Set([
  "planner",
  "evaluator",
  "context_distiller",
  "test_reviewer",
  "architecture_reviewer"
]);

const workspaceWriteAgents = new Set(["dev_worker", "integration_manager"]);

export function validateAgents(): AgentValidationResult {
  const errors: AgentValidationIssue[] = [];
  const warnings: AgentValidationIssue[] = [];
  const agents = loadAgentDefinitions(errors);
  const agentsByName = new Map(agents.map((agent) => [agent.name, agent]));

  for (const requiredAgent of REQUIRED_AGENTS) {
    const expectedPath = join(agentsRoot, AGENT_FILE_BY_NAME[requiredAgent]);
    const agent = agentsByName.get(requiredAgent);

    if (!agent) {
      errors.push({ path: expectedPath, message: "required agent file or matching agent name is missing" });
      continue;
    }

    if (agent.filePath !== expectedPath) {
      errors.push({
        path: agent.filePath,
        message: `agent ${requiredAgent} must be defined in ${expectedPath}`
      });
    }
  }

  for (const agent of agents) {
    validateAgentFields(agent, errors);
    validateSandboxMode(agent, errors);
    validateRoleContract(agent, errors);
  }

  const configChecked = validateAgentConfig(errors);

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    agentsChecked: agents.map((agent) => agent.name).sort(),
    configChecked
  };
}

export function loadAgentDefinitions(errors: AgentValidationIssue[] = []): AgentDefinition[] {
  if (!existsSync(agentsRoot)) {
    errors.push({ path: agentsRoot, message: "agents directory is missing" });
    return [];
  }

  const definitions: AgentDefinition[] = [];

  for (const entry of readdirSync(agentsRoot, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".toml")) {
      continue;
    }

    const filePath = join(agentsRoot, entry.name);
    const parsed = parseAgentDefinition(filePath, readFileSync(filePath, "utf8"), errors);
    if (parsed) {
      definitions.push(parsed);
    }
  }

  return definitions;
}

export function parseAgentDefinition(
  filePath: string,
  content: string,
  errors: AgentValidationIssue[] = []
): AgentDefinition | null {
  const values = parseTomlLikeTopLevel(content);
  const fileBaseName = basename(filePath, ".toml");
  const name = values.get("name");
  const description = values.get("description");
  const developerInstructions = values.get("developer_instructions");

  if (!name) {
    errors.push({ path: filePath, message: "name is missing" });
  }
  if (!description) {
    errors.push({ path: filePath, message: "description is missing" });
  }
  if (!developerInstructions) {
    errors.push({ path: filePath, message: "developer_instructions is missing" });
  }

  if (!name || !description || !developerInstructions) {
    return null;
  }

  return {
    filePath,
    fileBaseName,
    name,
    description,
    developer_instructions: developerInstructions,
    model_reasoning_effort: values.get("model_reasoning_effort"),
    sandbox_mode: values.get("sandbox_mode")
  };
}

function validateAgentFields(agent: AgentDefinition, errors: AgentValidationIssue[]): void {
  if (agent.description.trim().length === 0) {
    errors.push({ path: agent.filePath, message: "description must be non-empty" });
  }

  if (agent.developer_instructions.trim().length === 0) {
    errors.push({ path: agent.filePath, message: "developer_instructions must be non-empty" });
  }

  const expectedFile = AGENT_FILE_BY_NAME[agent.name as keyof typeof AGENT_FILE_BY_NAME];
  if (!expectedFile) {
    errors.push({ path: agent.filePath, message: `unexpected agent name ${agent.name}` });
    return;
  }

  if (agent.fileBaseName !== basename(expectedFile, ".toml")) {
    errors.push({
      path: agent.filePath,
      message: `agent name ${agent.name} does not match expected file ${expectedFile}`
    });
  }
}

function validateSandboxMode(agent: AgentDefinition, errors: AgentValidationIssue[]): void {
  if (!agent.sandbox_mode) {
    errors.push({ path: agent.filePath, message: "sandbox_mode is missing" });
    return;
  }

  if (readOnlyAgents.has(agent.name) && agent.sandbox_mode !== "read-only") {
    errors.push({ path: agent.filePath, message: `${agent.name} must use read-only sandbox_mode` });
  }

  if (workspaceWriteAgents.has(agent.name) && agent.sandbox_mode !== "workspace-write") {
    errors.push({ path: agent.filePath, message: `${agent.name} must use workspace-write sandbox_mode` });
  }
}

function validateRoleContract(agent: AgentDefinition, errors: AgentValidationIssue[]): void {
  const instructions = agent.developer_instructions;

  if (agent.name === "planner") {
    requireContains(agent, ["Do not write production code", "PRD", "acceptance criteria", "TaskGraph"], errors);
    requireContains(agent, ["owner_agent_type", "dependencies", "validation commands"], errors);
  }

  if (agent.name === "dev_worker") {
    requireContains(agent, ["scope", "validation", "changed_files", "remaining_risks"], errors);
    requireContains(agent, ["Do not proceed to the next module", "repair request"], errors);
  }

  if (agent.name === "evaluator") {
    requireContains(agent, ["read-only", "PASS", "NEEDS_REVISION", "EvalReport", "required_fixes"], errors);
  }

  if (agent.name === "context_distiller") {
    requireContains(agent, ["Context Capsule", "agent_id", "old_thread_id", "open_issues", "next_instruction"], errors);
    requireContains(agent, ["Do not invent"], errors);
  }

  if (agent.name === "integration_manager") {
    requireContains(agent, ["evaluator PASS", "Do not bypass evaluator findings", "final validation", "FinalDeliveryReport"], errors);
  }

  if (readOnlyAgents.has(agent.name) && instructions.includes("workspace-write")) {
    errors.push({ path: agent.filePath, message: `${agent.name} instructions must not request workspace-write` });
  }
}

function requireContains(agent: AgentDefinition, requiredText: string[], errors: AgentValidationIssue[]): void {
  const normalized = agent.developer_instructions.toLowerCase();
  for (const text of requiredText) {
    if (!normalized.includes(text.toLowerCase())) {
      errors.push({ path: agent.filePath, message: `developer_instructions must include ${text}` });
    }
  }
}

function validateAgentConfig(errors: AgentValidationIssue[]): boolean {
  if (!existsSync(configPath)) {
    errors.push({ path: configPath, message: "agent config file is missing" });
    return false;
  }

  const values = parseTomlLikeTopLevel(readFileSync(configPath, "utf8"));
  if (values.get("agents.max_threads") !== "6") {
    errors.push({ path: configPath, message: "[agents].max_threads must be 6" });
  }

  if (values.get("agents.max_depth") !== "1") {
    errors.push({ path: configPath, message: "[agents].max_depth must be 1" });
  }

  return true;
}

function parseTomlLikeTopLevel(content: string): Map<string, string> {
  const values = new Map<string, string>();
  const lines = content.split("\n");
  let section = "";

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    const trimmed = rawLine.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      section = trimmed.slice(1, -1).trim();
      continue;
    }

    const separator = rawLine.indexOf("=");
    if (separator === -1) {
      continue;
    }

    const key = rawLine.slice(0, separator).trim();
    const qualifiedKey = section ? `${section}.${key}` : key;
    const valueStart = rawLine.slice(separator + 1).trim();

    if (valueStart.startsWith('"""')) {
      const blockLines: string[] = [];
      const firstLineRemainder = valueStart.slice(3);
      if (firstLineRemainder.endsWith('"""')) {
        values.set(qualifiedKey, firstLineRemainder.slice(0, -3));
        continue;
      }

      if (firstLineRemainder.length > 0) {
        blockLines.push(firstLineRemainder);
      }

      index += 1;
      while (index < lines.length) {
        const blockLine = lines[index];
        const end = blockLine.indexOf('"""');
        if (end !== -1) {
          blockLines.push(blockLine.slice(0, end));
          break;
        }
        blockLines.push(blockLine);
        index += 1;
      }

      values.set(qualifiedKey, blockLines.join("\n").trim());
      continue;
    }

    values.set(qualifiedKey, unquoteTomlScalar(valueStart));
  }

  return values;
}

function unquoteTomlScalar(value: string): string {
  const withoutComment = value.split("#")[0]?.trim() ?? "";
  if (
    (withoutComment.startsWith("\"") && withoutComment.endsWith("\"")) ||
    (withoutComment.startsWith("'") && withoutComment.endsWith("'"))
  ) {
    return withoutComment.slice(1, -1);
  }
  return withoutComment;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = validateAgents();
  const output = JSON.stringify(result, null, 2);
  if (result.valid) {
    console.log(output);
  } else {
    console.error(output);
    process.exitCode = 1;
  }
}
