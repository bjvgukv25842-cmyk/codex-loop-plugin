import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { gradeValidationPass } from "../../evals/effectiveness/graders/validation-pass-grader.ts";
import { buildValidationCommandResults } from "../../src/effectiveness/validation-command-evidence.ts";
import type { M12RunResult } from "../../scripts/effectiveness/types.ts";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("validation pass grader", () => {
  it("uses validation_passed as primary evidence", () => {
    const grade = gradeValidationPass(sampleRun({
      validation_commands: ["npm test"],
      validation_passed: true,
      validation_logs: []
    }));

    expect(grade.status).toBe("PASS");
    expect(grade.evidence).toContain("source:result.validation_passed");
  });

  it("reads validation log paths before judging command evidence", () => {
    const dir = mkdtempSync(resolve(tmpdir(), "validation-grader-"));
    tempDirs.push(dir);
    const log = resolve(dir, "validation.log");
    mkdirSync(dir, { recursive: true });
    writeFileSync(log, "npm test\nok 1\n", "utf8");

    const grade = gradeValidationPass(sampleRun({
      validation_commands: ["npm test"],
      validation_logs: [log]
    }));

    expect(grade.status).toBe("PASS");
    expect(grade.evidence.join("\n")).toContain(log);
  });

  it("requires all validation commands to be present for multi-command cases", () => {
    const dir = mkdtempSync(resolve(tmpdir(), "validation-grader-multi-"));
    tempDirs.push(dir);
    const log = resolve(dir, "validation.log");
    mkdirSync(dir, { recursive: true });
    writeFileSync(log, "$ npm test\nok 1\n$ npm run coverage:contract\nInvoice coverage contract satisfied.\n", "utf8");

    const grade = gradeValidationPass(sampleRun({
      validation_commands: ["npm test", "npm run coverage:contract"],
      validation_logs: [log]
    }));

    expect(grade.status).toBe("PASS");
  });

  it("uses per-command validation results before aggregate validation_passed", () => {
    const grade = gradeValidationPass(sampleRun({
      validation_commands: ["npm test", "npm run coverage:contract"],
      validation_passed: true,
      validation_command_results: [
        { command: "npm test", status: "PASS", passed: true },
        { command: "npm run coverage:contract", status: "FAIL", passed: false }
      ]
    }));

    expect(grade.status).toBe("FAIL");
    expect(grade.summary).toContain("npm run coverage:contract=FAIL");
  });

  it("passes when every per-command validation result passes", () => {
    const grade = gradeValidationPass(sampleRun({
      validation_commands: ["npm test", "npm run coverage:contract"],
      validation_command_results: [
        { command: "npm test", status: "PASS", passed: true },
        { command: "npm run coverage:contract", status: "PASS", passed: true }
      ]
    }));

    expect(grade.status).toBe("PASS");
    expect(grade.evidence.join("\n")).toContain('"command":"npm run coverage:contract"');
    expect(grade.evidence.join("\n")).toContain('"result":"PASS"');
  });

  it("parses node --test TAP summaries with fail 0 as PASS", () => {
    const dir = mkdtempSync(resolve(tmpdir(), "validation-grader-tap-"));
    tempDirs.push(dir);
    const log = resolve(dir, "validation.log");
    mkdirSync(dir, { recursive: true });
    writeFileSync(log, "$ npm test\n✔ works\nℹ tests 1\nℹ pass 1\nℹ fail 0\n$ npm run coverage:contract\nCoverage contract passed.\n", "utf8");

    const grade = gradeValidationPass(sampleRun({
      validation_commands: ["npm test", "npm run coverage:contract"],
      validation_logs: [log]
    }));

    expect(grade.status).toBe("PASS");
    expect(grade.evidence.join("\n")).toContain("npm test");
    expect(grade.evidence.join("\n")).not.toContain("failure marker detected");
  });

  it("parses coverage:contract pass independently from npm test", () => {
    const dir = mkdtempSync(resolve(tmpdir(), "validation-grader-coverage-"));
    tempDirs.push(dir);
    const log = resolve(dir, "validation.log");
    mkdirSync(dir, { recursive: true });
    writeFileSync(log, "$ npm test\nok 1\n$ npm run coverage:contract\nCoverage contract passed.\n", "utf8");

    const results = buildValidationCommandResults({
      commands: ["npm test", "npm run coverage:contract"],
      log_paths: [log]
    });

    expect(results).toEqual([
      expect.objectContaining({ command: "npm test", status: "PASS", passed: true }),
      expect.objectContaining({ command: "npm run coverage:contract", status: "PASS", passed: true })
    ]);
  });

  it("chooses the latest log by mtime when several logs contain the same command", async () => {
    const dir = mkdtempSync(resolve(tmpdir(), "validation-grader-mtime-"));
    tempDirs.push(dir);
    const oldLog = resolve(dir, "old-validation.log");
    const newLog = resolve(dir, "new-validation.log");
    mkdirSync(dir, { recursive: true });
    writeFileSync(oldLog, "$ npm test\nnot ok 1\n", "utf8");
    await new Promise((resolveTimer) => setTimeout(resolveTimer, 10));
    writeFileSync(newLog, "$ npm test\nok 1\n", "utf8");

    const results = buildValidationCommandResults({
      commands: ["npm test"],
      log_paths: [oldLog, newLog]
    });

    expect(results[0]).toEqual(expect.objectContaining({ status: "PASS", log_path: newLog }));
  });

  it("does not let a stale failed command result override current passing logs", () => {
    const dir = mkdtempSync(resolve(tmpdir(), "validation-grader-stale-result-"));
    tempDirs.push(dir);
    const log = resolve(dir, "validation.log");
    mkdirSync(dir, { recursive: true });
    writeFileSync(log, "$ npm test\n✔ works\nℹ fail 0\n$ npm run coverage:contract\nCoverage contract passed.\n", "utf8");

    const grade = gradeValidationPass(sampleRun({
      validation_commands: ["npm test", "npm run coverage:contract"],
      validation_passed: true,
      validation_logs: [log],
      validation_log_paths: [log],
      validation_command_results: [
        { command: "npm test", status: "FAIL", passed: false, log_path: log, evidence: "failure marker detected" },
        { command: "npm run coverage:contract", status: "PASS", passed: true, log_path: log }
      ]
    }));

    expect(grade.status).toBe("PASS");
    expect(grade.evidence.join("\n")).toContain("VALIDATION_COMMAND_RESULT_MAPPING_MISMATCH");
  });

  it("reports command-level mismatch when aggregate pass conflicts with command result", () => {
    const dir = mkdtempSync(resolve(tmpdir(), "validation-grader-mismatch-"));
    tempDirs.push(dir);
    const log = resolve(dir, "validation.log");
    mkdirSync(dir, { recursive: true });
    writeFileSync(log, "$ npm test\nok 1\n$ npm run coverage:contract\nCoverage contract passed.\n", "utf8");

    const grade = gradeValidationPass(sampleRun({
      validation_commands: ["npm test", "npm run coverage:contract"],
      validation_passed: true,
      validation_logs: [log],
      validation_command_results: [
        { command: "npm test", status: "FAIL", passed: false, log_path: log },
        { command: "npm run coverage:contract", status: "PASS", passed: true, log_path: log }
      ]
    }));

    expect(grade.evidence.join("\n")).toContain("VALIDATION_COMMAND_RESULT_MAPPING_MISMATCH");
  });

  it("supports docs:contract validation evidence", () => {
    const dir = mkdtempSync(resolve(tmpdir(), "validation-grader-docs-"));
    tempDirs.push(dir);
    const log = resolve(dir, "validation.log");
    mkdirSync(dir, { recursive: true });
    writeFileSync(log, "$ npm test\nok 1\n$ npm run docs:contract\nDocs contract satisfied.\n", "utf8");

    const grade = gradeValidationPass(sampleRun({
      validation_commands: ["npm test", "npm run docs:contract"],
      validation_logs: [log]
    }));

    expect(grade.status).toBe("PASS");
  });

  it("supports refactor multi-command validation evidence", () => {
    const dir = mkdtempSync(resolve(tmpdir(), "validation-grader-refactor-"));
    tempDirs.push(dir);
    const log = resolve(dir, "validation.log");
    mkdirSync(dir, { recursive: true });
    writeFileSync(log, "$ npm test\nok 1\n$ npm run refactor:contract\nRefactor behavior contract satisfied.\n$ npm run lint:structure\nRefactor structure contract satisfied.\n", "utf8");

    const grade = gradeValidationPass(sampleRun({
      validation_commands: ["npm test", "npm run refactor:contract", "npm run lint:structure"],
      validation_logs: [log]
    }));

    expect(grade.status).toBe("PASS");
  });

  it("supports feature-small-002 npm test validation evidence", () => {
    const dir = mkdtempSync(resolve(tmpdir(), "validation-grader-feature-002-"));
    tempDirs.push(dir);
    const log = resolve(dir, "validation.log");
    mkdirSync(dir, { recursive: true });
    writeFileSync(log, "$ npm test\nok 1 - slug normalization\n", "utf8");

    const grade = gradeValidationPass(sampleRun({
      case_id: "feature-small-002",
      validation_commands: ["npm test"],
      validation_logs: [log]
    }));

    expect(grade.status).toBe("PASS");
  });

  it("supports bugfix-small-002 npm test validation evidence", () => {
    const dir = mkdtempSync(resolve(tmpdir(), "validation-grader-bugfix-002-"));
    tempDirs.push(dir);
    const log = resolve(dir, "validation.log");
    mkdirSync(dir, { recursive: true });
    writeFileSync(log, "$ npm test\nok 1 - date range overlap\n", "utf8");

    const grade = gradeValidationPass(sampleRun({
      case_id: "bugfix-small-002",
      validation_commands: ["npm test"],
      validation_logs: [log]
    }));

    expect(grade.status).toBe("PASS");
  });

  it("fails when one required validation command is missing", () => {
    const dir = mkdtempSync(resolve(tmpdir(), "validation-grader-missing-"));
    tempDirs.push(dir);
    const log = resolve(dir, "validation.log");
    mkdirSync(dir, { recursive: true });
    writeFileSync(log, "$ npm test\nok 1\n", "utf8");

    const grade = gradeValidationPass(sampleRun({
      validation_commands: ["npm test", "npm run coverage:contract"],
      validation_logs: [log]
    }));

    expect(grade.status).toBe("FAIL");
    expect(grade.evidence).toContain("missing:npm run coverage:contract");
  });
});

function sampleRun(overrides: Partial<M12RunResult>): M12RunResult {
  return {
    case_id: "case",
    variant: "baseline",
    status: "PASS",
    real_run_executed: true,
    prompt: "",
    fixture_repo: "",
    acceptance_criteria: [],
    validation_commands: [],
    expected_artifacts: [],
    forbidden_files: [],
    changed_files: [],
    artifacts: [],
    validation_logs: [],
    duration_ms: 0,
    thread_count: 0,
    command_count: 0,
    errors: [],
    ...overrides
  };
}
