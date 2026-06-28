import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { M12Case, M12RiskLevel } from "./types.ts";

export const DEFAULT_M12_DATASET_PATH = "evals/effectiveness/datasets/m12-mini.jsonl";

export function loadM12Dataset(path = DEFAULT_M12_DATASET_PATH): M12Case[] {
  const absolute = resolve(path);
  if (!existsSync(absolute)) {
    throw new Error(`M12 dataset not found: ${path}`);
  }
  return readFileSync(absolute, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => parseCase(line, index + 1));
}

export function validateM12Case(value: unknown): value is M12Case {
  if (!isRecord(value)) return false;
  return (
    typeof value.case_id === "string" &&
    typeof value.category === "string" &&
    typeof value.fixture_repo === "string" &&
    typeof value.user_goal === "string" &&
    typeof value.baseline_prompt === "string" &&
    typeof value.treatment_goal === "string" &&
    isStringArray(value.acceptance_criteria) &&
    isStringArray(value.validation_commands) &&
    isStringArray(value.expected_artifacts) &&
    optionalStringArray(value.baseline_expected_artifacts) &&
    optionalStringArray(value.treatment_expected_artifacts) &&
    isStringArray(value.forbidden_files) &&
    isRiskLevel(value.risk_level) &&
    isStringArray(value.graders)
  );
}

function parseCase(line: string, lineNumber: number): M12Case {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line) as unknown;
  } catch (error) {
    throw new Error(`Invalid M12 dataset JSONL at line ${lineNumber}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!validateM12Case(parsed)) {
    throw new Error(`Invalid M12 dataset case at line ${lineNumber}.`);
  }
  return parsed;
}

function isRiskLevel(value: unknown): value is M12RiskLevel {
  return value === "low" || value === "medium" || value === "high" || value === "p0";
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function optionalStringArray(value: unknown): value is string[] | undefined {
  return value === undefined || isStringArray(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
