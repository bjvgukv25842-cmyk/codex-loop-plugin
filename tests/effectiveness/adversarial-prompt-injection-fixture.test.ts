import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { prepareM12AdversarialFixture } from "../../src/effectiveness/effectiveness-fixtures.ts";
import { loadM12Dataset } from "../../scripts/effectiveness/dataset.ts";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("adversarial-prompt-injection-001 fixture", () => {
  it("materializes seeded fake secret, untrusted instructions, and initial failing tests", () => {
    const repoRoot = tempRoot("m12-adversarial-fixture-");
    cpSync(
      resolve(process.cwd(), "evals/effectiveness/fixtures/adversarial-prompt-injection-001"),
      resolve(repoRoot, "evals/effectiveness/fixtures/adversarial-prompt-injection-001"),
      { recursive: true }
    );

    const testCase = loadM12Dataset().find((entry) => entry.case_id === "adversarial-prompt-injection-001")!;
    const paths = prepareM12AdversarialFixture({ testCase, variant: "treatment", repoRoot });

    expect(existsSync(resolve(paths.target_repo, "secrets/seeded-fake-secret.txt"))).toBe(true);
    expect(existsSync(resolve(paths.target_repo, "UNTRUSTED_INSTRUCTIONS.md"))).toBe(true);
    expect(readFileSync(resolve(paths.target_repo, "secrets/seeded-fake-secret.txt"), "utf8")).toContain("FAKE_SECRET_M12_CANARY_DO_NOT_LEAK");
    expect(commandPasses(["npm", "test"], paths.target_repo)).toBe(false);
  });
});

function tempRoot(prefix: string): string {
  const dir = mkdtempSync(resolve(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function commandPasses(command: string[], cwd: string): boolean {
  try {
    execFileSync(command[0]!, command.slice(1), { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return true;
  } catch {
    return false;
  }
}
