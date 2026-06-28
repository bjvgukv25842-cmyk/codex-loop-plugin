import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { prepareM12RefactorFixture } from "../../src/effectiveness/effectiveness-fixtures.ts";
import { loadM12Dataset } from "../../scripts/effectiveness/dataset.ts";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("refactor-small-001 fixture", () => {
  it("is materialized with the expected report builder files", () => {
    const fixture = resolve(process.cwd(), "evals/effectiveness/fixtures/refactor-small-001");

    expect(existsSync(resolve(fixture, "package.json"))).toBe(true);
    expect(existsSync(resolve(fixture, "README.md"))).toBe(true);
    expect(existsSync(resolve(fixture, "src/report-builder.js"))).toBe(true);
    expect(existsSync(resolve(fixture, "test/report-builder.test.js"))).toBe(true);
    expect(existsSync(resolve(fixture, "scripts/check-refactor-contract.js"))).toBe(true);
    expect(existsSync(resolve(fixture, "scripts/check-structure.js"))).toBe(true);
  });

  it("starts with passing behavior and contract checks but failing structure lint", () => {
    const tempDir = mkdtempSync(resolve(tmpdir(), "refactor-fixture-"));
    tempDirs.push(tempDir);
    cpSync(resolve(process.cwd(), "evals/effectiveness/fixtures/refactor-small-001"), tempDir, { recursive: true });

    expect(() => execFileSync("npm", ["test"], { cwd: tempDir, stdio: "pipe" })).not.toThrow();
    expect(() => execFileSync("npm", ["run", "refactor:contract"], { cwd: tempDir, stdio: "pipe" })).not.toThrow();
    expect(() => execFileSync("npm", ["run", "lint:structure"], { cwd: tempDir, stdio: "pipe" })).toThrow();
  });

  it("prepareM12RefactorFixture resets the target repo and records structure-gap evidence", () => {
    const repoRoot = mkdtempSync(resolve(tmpdir(), "refactor-prepare-"));
    tempDirs.push(repoRoot);
    cpSync(
      resolve(process.cwd(), "evals/effectiveness/fixtures/refactor-small-001"),
      resolve(repoRoot, "evals/effectiveness/fixtures/refactor-small-001"),
      { recursive: true }
    );
    const testCase = loadM12Dataset().find((entry) => entry.case_id === "refactor-small-001")!;

    const paths = prepareM12RefactorFixture({ testCase, variant: "treatment", repoRoot });

    expect(existsSync(resolve(paths.target_repo, "src/report-builder.js"))).toBe(true);
    expect(existsSync(resolve(paths.target_repo, ".git"))).toBe(true);
    expect(JSON.parse(readFileSync(resolve(paths.reports_dir, "sdk-stage-logs/dev-worker-baseline.json"), "utf8"))).toMatchObject({
      fixture_status: "REFACTOR_STRUCTURE_GAP_AS_EXPECTED",
      initial_tests_failed: false,
      initial_refactor_contract_failed: false,
      initial_structure_lint_failed: true,
      seeded_gap_fixture_created: false
    });
  });
});
