import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

export interface SkillValidationIssue {
  path: string;
  message: string;
}

export interface SkillValidationResult {
  valid: boolean;
  errors: SkillValidationIssue[];
  warnings: SkillValidationIssue[];
  skillsChecked: string[];
}

export interface SkillDocument {
  filePath: string;
  name: string;
  description: string;
  body: string;
}

export const REQUIRED_SKILLS = [
  "codex-loop",
  "prd-planner",
  "task-decomposer",
  "dev-worker",
  "evaluator",
  "context-distiller",
  "integration-manager"
] as const;

const skillsRoot = "skills";

export function validateSkills(): SkillValidationResult {
  const errors: SkillValidationIssue[] = [];
  const warnings: SkillValidationIssue[] = [];
  const skills = loadSkillDocuments(errors);
  const skillsByName = new Map(skills.map((skill) => [skill.name, skill]));

  for (const requiredSkill of REQUIRED_SKILLS) {
    if (!skillsByName.has(requiredSkill)) {
      errors.push({
        path: join(skillsRoot, requiredSkill, "SKILL.md"),
        message: "required skill is missing"
      });
    }
  }

  const codexLoop = skillsByName.get("codex-loop");
  if (!codexLoop) {
    errors.push({ path: "skills/codex-loop/SKILL.md", message: "codex-loop skill must exist" });
  }

  const evaluator = skillsByName.get("evaluator");
  if (evaluator && !containsAny(evaluator.body, ["read-only", "只读"])) {
    errors.push({
      path: evaluator.filePath,
      message: "evaluator skill must include a read-only or 只读 constraint"
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    skillsChecked: skills.map((skill) => skill.name).sort()
  };
}

export function loadSkillDocuments(errors: SkillValidationIssue[] = []): SkillDocument[] {
  if (!existsSync(skillsRoot)) {
    errors.push({ path: skillsRoot, message: "skills directory is missing" });
    return [];
  }

  const documents: SkillDocument[] = [];

  for (const entry of readdirSync(skillsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }

    const filePath = join(skillsRoot, entry.name, "SKILL.md");
    if (!existsSync(filePath)) {
      continue;
    }

    const content = readFileSync(filePath, "utf8");
    const parsed = parseSkillDocument(filePath, content, errors);
    if (parsed) {
      if (parsed.name !== basename(join(skillsRoot, entry.name))) {
        errors.push({
          path: filePath,
          message: "frontmatter name must match skill directory"
        });
      }
      documents.push(parsed);
    }
  }

  return documents;
}

export function parseSkillDocument(
  filePath: string,
  content: string,
  errors: SkillValidationIssue[] = []
): SkillDocument | null {
  if (!content.startsWith("---\n")) {
    errors.push({ path: filePath, message: "YAML frontmatter is missing" });
    return null;
  }

  const end = content.indexOf("\n---", 4);
  if (end === -1) {
    errors.push({ path: filePath, message: "YAML frontmatter is not closed" });
    return null;
  }

  const frontmatter = content.slice(4, end).trim();
  const body = content.slice(end + 4).trim();
  const values = parseSimpleFrontmatter(frontmatter);
  const name = values.get("name");
  const description = values.get("description");

  if (!name) {
    errors.push({ path: filePath, message: "frontmatter name is missing" });
  }
  if (!description) {
    errors.push({ path: filePath, message: "frontmatter description is missing" });
  } else if (description.length < 30) {
    errors.push({ path: filePath, message: "frontmatter description must be at least 30 characters" });
  }

  if (!name || !description) {
    return null;
  }

  return {
    filePath,
    name,
    description,
    body
  };
}

function parseSimpleFrontmatter(frontmatter: string): Map<string, string> {
  const values = new Map<string, string>();

  for (const line of frontmatter.split("\n")) {
    const separator = line.indexOf(":");
    if (separator === -1) {
      continue;
    }

    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values.set(key, value);
  }

  return values;
}

function containsAny(value: string, needles: string[]): boolean {
  const normalized = value.toLowerCase();
  return needles.some((needle) => normalized.includes(needle.toLowerCase()));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = validateSkills();
  const output = JSON.stringify(result, null, 2);
  if (result.valid) {
    console.log(output);
  } else {
    console.error(output);
    process.exitCode = 1;
  }
}
