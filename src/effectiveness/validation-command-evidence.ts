import { existsSync, readFileSync, statSync } from "node:fs";

import type { M12ValidationCommandResult } from "../../scripts/effectiveness/types.ts";

export function buildValidationCommandResults(input: {
  commands: string[];
  log_paths?: string[];
  validation_passed?: boolean;
}): M12ValidationCommandResult[] {
  const logs = (input.log_paths ?? [])
    .filter((path) => path && existsSync(path))
    .map((path) => ({ path, text: readFileSync(path, "utf8"), mtime: statSync(path).mtime.toISOString(), mtimeMs: statSync(path).mtimeMs }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  return input.commands.map((command) => {
    const hit = logs.find((log) => log.text.includes(command));
    if (!hit) {
      if (input.validation_passed === true) {
        return {
          command,
          status: "PASS",
          passed: true,
          evidence: "result.validation_passed=true",
          evidence_source: "result.validation_passed",
          result: "PASS",
          reason: "Aggregate validation_passed=true and no command-specific log was available."
        };
      }
      return {
        command,
        status: "NOT_RUN",
        passed: false,
        evidence: "validation command log missing",
        evidence_source: "validation_log_paths",
        result: "MISSING",
        reason: "No validation log containing this command was found.",
        failure_category: "VALIDATION_EVIDENCE_MISSING"
      };
    }

    const section = commandSection(hit.text, command);
    const parsed = parseValidationCommandSection(section);
    return {
      command,
      status: parsed.status,
      passed: parsed.status === "PASS",
      log_path: hit.path,
      evidence: parsed.evidence,
      evidence_source: hit.path,
      evidence_mtime: hit.mtime,
      result: parsed.status,
      reason: parsed.reason,
      ...(parsed.failure_category ? { failure_category: parsed.failure_category } : {})
    };
  });
}

export function coverageContractPassed(results: M12ValidationCommandResult[]): boolean {
  return results.some((result) => result.command.includes("coverage:contract") && result.passed === true);
}

function commandSection(text: string, command: string): string {
  const start = text.indexOf(command);
  if (start < 0) return "";
  const rest = text.slice(start);
  const nextCommand = rest.slice(command.length).search(/\n\$\s+/);
  return nextCommand >= 0 ? rest.slice(0, command.length + nextCommand) : rest;
}

function parseValidationCommandSection(text: string): {
  status: "PASS" | "FAIL";
  evidence: string;
  reason: string;
  failure_category?: string;
} {
  const positiveFailCount = positiveSummaryCount(text, /\bfail\s+(\d+)\b/i) ??
    positiveSummaryCount(text, /\bfailures?\s*[:=]\s*(\d+)\b/i);
  if (positiveFailCount !== null && positiveFailCount > 0) {
    return {
      status: "FAIL",
      evidence: `failure summary count=${positiveFailCount}`,
      reason: "Validation section reported one or more failed tests.",
      failure_category: "VALIDATION_MULTI_COMMAND_PARSE_ERROR"
    };
  }
  if (hasHardFailureMarker(text)) {
    return {
      status: "FAIL",
      evidence: "failure marker detected",
      reason: "Validation section contained an explicit failure marker.",
      failure_category: "VALIDATION_MULTI_COMMAND_PARSE_ERROR"
    };
  }
  if (hasPassMarker(text)) {
    return {
      status: "PASS",
      evidence: "pass marker detected",
      reason: "Validation section contained a command-specific pass marker."
    };
  }
  return {
    status: "PASS",
    evidence: "command completed without failure marker",
    reason: "Validation command appeared in the log and no command-specific failure marker was found."
  };
}

function hasHardFailureMarker(text: string): boolean {
  return /\bFAIL\b/.test(text) ||
    /\bfailed\b/i.test(text) ||
    /not ok/i.test(text) ||
    /\bERR!\b/.test(text) ||
    /\bAssertionError\b/.test(text) ||
    /(?:^|\n)\s*Error:/i.test(text) ||
    /\bexit(?:ed| code)?\s*(?:=|:)?\s*[1-9]\d*\b/i.test(text) ||
    /(?:^|\n)\s*[✖x]\s+/i.test(text);
}

function hasPassMarker(text: string): boolean {
  return /\bPASS\b/.test(text) ||
    /\bok\b/i.test(text) ||
    /\bpass\s+[1-9]\d*\b/i.test(text) ||
    /\bfail\s+0\b/i.test(text) ||
    /coverage contract passed/i.test(text) ||
    /contract satisfied/i.test(text) ||
    /status\s*[:=]\s*PASS/i.test(text) ||
    /exit(?:_code| code)?\s*[:=]\s*0/i.test(text);
}

function positiveSummaryCount(text: string, pattern: RegExp): number | null {
  const match = text.match(pattern);
  if (!match?.[1]) return null;
  return Number.parseInt(match[1], 10);
}
