import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { prepareM12TestCoverageFixture } from "../../src/effectiveness/effectiveness-fixtures.ts";
import { loadM12Dataset } from "../../scripts/effectiveness/dataset.ts";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe.each([
  {
    caseId: "test-coverage-001",
    fixtureName: "test-coverage-001",
    expectedFiles: ["package.json", "src/invoice.js", "test/invoice.test.js", "scripts/check-test-coverage-contract.js"],
    targetSource: "src/invoice.js"
  },
  {
    caseId: "test-coverage-002",
    fixtureName: "test-coverage-002",
    expectedFiles: ["package.json", "README.md", "src/cache.js", "src/cache-storage.js", "test/cache.test.js", "scripts/check-test-coverage-contract.js"],
    targetSource: "src/cache.js"
  }
])("$caseId fixture", ({ caseId, fixtureName, expectedFiles, targetSource }) => {
  it("is materialized with the expected files", () => {
    const fixture = resolve(process.cwd(), `evals/effectiveness/fixtures/${fixtureName}`);

    for (const file of expectedFiles) {
      expect(existsSync(resolve(fixture, file))).toBe(true);
    }
  });

  it("starts with passing npm test and failing coverage contract", () => {
    const tempDir = mkdtempSync(resolve(tmpdir(), "test-coverage-fixture-"));
    tempDirs.push(tempDir);
    cpSync(resolve(process.cwd(), `evals/effectiveness/fixtures/${fixtureName}`), tempDir, { recursive: true });

    expect(() => execFileSync("npm", ["test"], { cwd: tempDir, stdio: "pipe" })).not.toThrow();
    expect(() => execFileSync("npm", ["run", "coverage:contract"], { cwd: tempDir, stdio: "pipe" })).toThrow();
  });

  it("prepareM12TestCoverageFixture resets the target repo and records coverage-gap evidence", () => {
    const repoRoot = mkdtempSync(resolve(tmpdir(), "test-coverage-prepare-"));
    tempDirs.push(repoRoot);
    cpSync(
      resolve(process.cwd(), `evals/effectiveness/fixtures/${fixtureName}`),
      resolve(repoRoot, `evals/effectiveness/fixtures/${fixtureName}`),
      { recursive: true }
    );
    const testCase = loadM12Dataset().find((entry) => entry.case_id === caseId)!;

    const paths = prepareM12TestCoverageFixture({ testCase, variant: "treatment", repoRoot });

    expect(existsSync(resolve(paths.target_repo, targetSource))).toBe(true);
    expect(existsSync(resolve(paths.target_repo, ".git"))).toBe(true);
    expect(JSON.parse(readFileSync(resolve(paths.reports_dir, "sdk-stage-logs/dev-worker-baseline.json"), "utf8"))).toMatchObject({
      target_source_file: targetSource,
      fixture_status: "COVERAGE_GAP_AS_EXPECTED",
      initial_tests_failed: false,
      initial_coverage_contract_failed: true,
      seeded_gap_fixture_created: false
    });
  });
});
