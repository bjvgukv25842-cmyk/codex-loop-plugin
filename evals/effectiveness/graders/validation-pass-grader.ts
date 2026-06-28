import type { GraderResult, M12RunResult, M12ValidationCommandResult } from "../../../scripts/effectiveness/types.ts";
import { buildValidationCommandResults } from "../../../src/effectiveness/validation-command-evidence.ts";
import { collectEvidenceSources } from "./evidence-utils.ts";

export function gradeValidationPass(result: M12RunResult): GraderResult {
  const required = result.validation_commands;
  if (required.length === 0) {
    return {
      grader: "validation-pass",
      status: "FAIL",
      score: 0,
      p0: false,
      severe: true,
      summary: "Validation command evidence is missing because no validation commands were declared.",
      evidence: ["missing:validation_commands"]
    };
  }
  if (result.validation_command_results && result.validation_command_results.length > 0) {
    const commandResults = normalizeCommandResults(result);
    const missing = required.filter((command) => !commandResults.some((entry) => entry.command === command));
    const failed = commandResults.filter((entry) => required.includes(entry.command) && entry.passed !== true);
    const pass = missing.length === 0 && failed.length === 0;
    const mismatch = commandResults.some((entry) => entry.failure_category === "VALIDATION_COMMAND_RESULT_MAPPING_MISMATCH");
    return {
      grader: "validation-pass",
      status: pass ? "PASS" : "FAIL",
      score: pass ? 1 : 0,
      p0: false,
      severe: !pass,
      summary: pass
        ? mismatch
          ? "All validation commands passed after reconciling command-level result/log mapping mismatch."
          : "All validation commands passed according to result.validation_command_results."
        : `Validation command evidence failed or is missing: ${[...missing, ...failed.map((entry) => `${entry.command}=${entry.status}`)].join(", ")}.`,
      evidence: [
        mismatch ? "failure_category:VALIDATION_COMMAND_RESULT_MAPPING_MISMATCH" : "source:result.validation_command_results",
        ...commandResults.map((entry) => compactCommandEvidence(entry)),
        ...missing.map((command) => `missing:${command}`)
      ]
    };
  }
  if (result.validation_passed === true) {
    return {
      grader: "validation-pass",
      status: "PASS",
      score: 1,
      p0: false,
      severe: false,
      summary: "Validation passed according to result.validation_passed.",
      evidence: ["source:result.validation_passed"]
    };
  }
  if (result.validation_passed === false && result.real_run_executed === true) {
    return {
      grader: "validation-pass",
      status: "FAIL",
      score: 0,
      p0: false,
      severe: true,
      summary: "Validation failed according to result.validation_passed.",
      evidence: ["source:result.validation_passed=false"]
    };
  }
  const validationSources = collectEvidenceSources(result).filter((source) => source.label.startsWith("validation_log"));
  const logPaths = validationSources.map((source) => source.path).filter((path): path is string => Boolean(path));
  const commandResults = buildValidationCommandResults({
    commands: required,
    log_paths: logPaths,
    validation_passed: result.validation_passed
  });
  const missing = commandResults.filter((entry) => entry.status === "NOT_RUN").map((entry) => entry.command);
  const failed = commandResults.filter((entry) => entry.status === "FAIL");
  const pass = validationSources.length > 0 && missing.length === 0 && failed.length === 0;
  return {
    grader: "validation-pass",
    status: pass ? "PASS" : "FAIL",
    score: pass ? 1 : 0,
    p0: false,
    severe: !pass,
    summary: pass ? "Validation commands are present and have no failure markers." : "Validation command evidence is missing or failed.",
    evidence: [
      ...validationSources.map((source) => `source:${source.path ?? source.label}`),
      ...commandResults.map((entry) => compactCommandEvidence(entry)),
      ...missing.map((command) => `missing:${command}`),
      ...failed.map((entry) => `failure:${entry.command}:${entry.evidence ?? entry.status}`),
      ...(validationSources.length === 0 ? ["missing:validation_log_file"] : [])
    ]
  };
}

function normalizeCommandResults(result: M12RunResult): M12ValidationCommandResult[] {
  const commandResults = result.validation_command_results ?? [];
  if (result.validation_passed !== true) return commandResults;
  const failed = commandResults.filter((entry) => result.validation_commands.includes(entry.command) && entry.passed !== true);
  if (failed.length === 0) return commandResults;
  const logPaths = Array.from(new Set([
    ...(result.validation_log_paths ?? []),
    ...result.validation_logs,
    ...commandResults.map((entry) => entry.log_path ?? "").filter(Boolean)
  ]));
  if (logPaths.length === 0) return commandResults;
  const reparsed = buildValidationCommandResults({
    commands: result.validation_commands,
    log_paths: logPaths,
    validation_passed: result.validation_passed
  });
  const reparsedFromLogs = reparsed.every((entry) => Boolean(entry.log_path));
  const reparsedPass = reparsedFromLogs && result.validation_commands.every((command) => reparsed.find((entry) => entry.command === command)?.passed === true);
  if (!reparsedPass) return commandResults;
  return reparsed.map((entry) => ({
    ...entry,
    failure_category: "VALIDATION_COMMAND_RESULT_MAPPING_MISMATCH",
    reason: `Reparsed log evidence superseded stale command-level mapping: ${entry.reason ?? ""}`.trim()
  }));
}

function compactCommandEvidence(entry: M12ValidationCommandResult): string {
  return JSON.stringify({
    command: entry.command,
    evidence_source: entry.evidence_source ?? entry.log_path ?? "result.validation_command_results",
    evidence_mtime: entry.evidence_mtime ?? "",
    result: entry.result ?? entry.status,
    reason: entry.reason ?? entry.evidence ?? "",
    failure_category: entry.failure_category ?? ""
  });
}
