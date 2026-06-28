import type { EvalFinding, EvalReport, EvalRequiredFix, EvidenceRef, FindingCategory, FindingSeverity, ValidationCommand } from "../core/types.ts";
import type { EvaluatorLiteOutput } from "./parse-evaluator-lite-output.ts";

export interface HydrateEvalReportInput {
  loop_run_id: string;
  task_id: string;
  module_id?: string;
  evaluator_agent_id?: string;
  evaluator_thread_id: string;
  output: EvaluatorLiteOutput;
  findings: unknown[];
  now?: string;
}

export interface HydrateEvalReportResult {
  status: "PASS" | "NEEDS_REVISION";
  eval_report?: EvalReport;
  failure_category: "EVALUATOR_LITE_POSTPROCESS_FAILED" | "";
  errors: string[];
}

export function hydrateEvalReport(input: HydrateEvalReportInput): HydrateEvalReportResult {
  const findings = input.findings.map((finding, index) => normalizeFinding(finding, index));
  const errors: string[] = [];

  if (input.output.verdict === "NEEDS_REVISION" && findings.length === 0) {
    errors.push("NEEDS_REVISION evaluator-lite output must include at least one finding.");
  }

  if (errors.length > 0) {
    return {
      status: "NEEDS_REVISION",
      failure_category: "EVALUATOR_LITE_POSTPROCESS_FAILED",
      errors
    };
  }

  const timestamp = input.now ?? new Date().toISOString();
  const evalId = stableEvalId(input);
  const report: EvalReport = {
    eval_id: evalId,
    loop_run_id: input.loop_run_id,
    task_id: input.task_id,
    module_id: input.module_id ?? "Gate6B",
    evaluator_agent_id: input.evaluator_agent_id ?? "sdk-evaluator",
    verdict: input.output.verdict,
    confidence: input.output.verdict === "PASS" ? 0.95 : 0.85,
    findings,
    required_fixes: findings.map((finding, index) => requiredFixForFinding(finding, index)),
    validation_commands_checked: normalizeValidationCommands(input.output.validation_commands_checked),
    created_at: timestamp,
    updated_at: timestamp,
    metadata: {
      summary: input.output.summary,
      created_by_runtime: "sdk-orchestrated",
      created_by_role: "evaluator",
      created_by_thread_id: input.evaluator_thread_id
    }
  };

  return {
    status: "PASS",
    eval_report: report,
    failure_category: "",
    errors: []
  };
}

function normalizeFinding(value: unknown, index: number): EvalFinding {
  const record = isRecord(value) ? value : {};
  const requiredFix = stringValue(record.required_fix) || stringValue(record.requiredFix) || "Address evaluator finding.";
  return {
    finding_id: stringValue(record.finding_id) || stringValue(record.id) || `finding_evaluator_lite_${index + 1}`,
    severity: normalizeSeverity(record.severity),
    category: normalizeCategory(record.category),
    description: stringValue(record.description) || stringValue(record.summary) || "Evaluator reported an issue.",
    evidence: normalizeEvidence(record.evidence),
    required_fix: requiredFix
  };
}

function requiredFixForFinding(finding: EvalFinding, index: number): EvalRequiredFix {
  return {
    fix_id: `fix_${finding.finding_id || index + 1}`,
    finding_ids: [finding.finding_id],
    instruction: finding.required_fix,
    expected_files: [],
    validation_commands: [{ command: "npm test" }]
  };
}

function normalizeValidationCommands(commands: string[]): ValidationCommand[] {
  const normalized = commands.map((command) => command.trim()).filter(Boolean);
  const unique = [...new Set(normalized.length > 0 ? normalized : ["npm test"])];
  return unique.map((command) => ({ command }));
}

function normalizeSeverity(value: unknown): FindingSeverity {
  return value === "low" || value === "medium" || value === "high" ? value : "medium";
}

function normalizeCategory(value: unknown): FindingCategory {
  const categories: FindingCategory[] = [
    "correctness",
    "test_gap",
    "schema_gap",
    "docs_gap",
    "scope_creep",
    "safety",
    "maintainability",
    "integration_risk"
  ];
  return typeof value === "string" && categories.includes(value as FindingCategory) ? (value as FindingCategory) : "correctness";
}

function normalizeEvidence(value: unknown): EvalFinding["evidence"] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry, index) => {
    if (!isRecord(entry)) return [];
    const type = entry.type === "file" || entry.type === "command" || entry.type === "artifact" || entry.type === "url" || entry.type === "text" ? entry.type : "text";
    const ref = stringValue(entry.ref) || `evaluator evidence ${index + 1}`;
    const evidence: EvidenceRef = {
      type,
      ref,
      summary: stringValue(entry.summary) || undefined,
      line: typeof entry.line === "number" ? entry.line : undefined
    };
    return [evidence];
  });
}

function stableEvalId(input: HydrateEvalReportInput): string {
  const verdict = input.output.verdict.toLowerCase();
  return `eval_${input.task_id}_${verdict}`;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
