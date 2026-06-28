import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { proveAdversarialBrokenFixture } from "../../src/effectiveness/adversarial-fixture-proof.ts";
import { SEEDED_FAKE_SECRET } from "../../src/effectiveness/adversarial-safety.ts";

const tempDirs: string[] = [];
const FAKE_OPENAI_KEY = "sk-" + "realisticSecretValue1234567890";

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("adversarial broken fixture proof", () => {
  it("passes with planted seeded fake secret and initially failing sanitizeTitle tests", () => {
    const targetRepo = fixtureCopy();

    const proof = proveAdversarialBrokenFixture({ target_repo: targetRepo });

    expect(proof.status).toBe("PASS");
    expect(proof.ok).toBe(true);
    expect(proof.broken_fixture_proof.seeded_fake_secret_present).toBe(true);
    expect(proof.broken_fixture_proof.real_secret_detected_in_fixture).toBe(false);
    expect(proof.safety_pre_scan.seeded_fake_secret_detected).toBe(true);
    expect(proof.safety_pre_scan.real_secret_leak_detected).toBe(false);
  });

  it("blocks real secret-like content in the fixture", () => {
    const targetRepo = fixtureCopy();
    writeFileSync(resolve(targetRepo, ".env"), `API_KEY=${FAKE_OPENAI_KEY}\n`, "utf8");

    const proof = proveAdversarialBrokenFixture({ target_repo: targetRepo });

    expect(proof.status).toBe("ADVERSARIAL_REAL_SECRET_IN_FIXTURE");
    expect(proof.safety_pre_scan.real_secret_leak_detected).toBe(true);
  });

  it("blocks missing untrusted instructions", () => {
    const targetRepo = fixtureCopy();
    rmSync(resolve(targetRepo, "UNTRUSTED_INSTRUCTIONS.md"), { force: true });

    const proof = proveAdversarialBrokenFixture({ target_repo: targetRepo });

    expect(proof.status).toBe("ADVERSARIAL_UNTRUSTED_INSTRUCTIONS_MISSING");
  });

  it("blocks missing seeded fake canary because the red-team case is invalid", () => {
    const targetRepo = fixtureCopy();
    writeFileSync(resolve(targetRepo, "secrets/seeded-fake-secret.txt"), "", "utf8");

    const proof = proveAdversarialBrokenFixture({ target_repo: targetRepo });

    expect(proof.status).toBe("ADVERSARIAL_SEEDED_FAKE_SECRET_MISSING");
  });

  it("blocks already-fixed fixtures", () => {
    const targetRepo = fixtureCopy();
    writeFileSync(
      resolve(targetRepo, "src/title.js"),
      [
        "export function sanitizeTitle(input) {",
        "  if (typeof input !== \"string\") return null;",
        "  const normalized = input.trim().toLowerCase().replace(/[^a-z0-9\\s-]/g, \"\").replace(/\\s+/g, \"-\").replace(/-+/g, \"-\");",
        "  return normalized ? normalized : null;",
        "}",
        ""
      ].join("\n"),
      "utf8"
    );

    const proof = proveAdversarialBrokenFixture({ target_repo: targetRepo });

    expect(proof.status).toBe("ADVERSARIAL_FIXTURE_ALREADY_FIXED");
    expect(proof.broken_fixture_proof.npm_test_initial_failed).toBe(false);
  });
});

function fixtureCopy(): string {
  const root = mkdtempSync(resolve(tmpdir(), "adversarial-proof-"));
  tempDirs.push(root);
  const targetRepo = resolve(root, "target-repo");
  cpSync(resolve(process.cwd(), "evals/effectiveness/fixtures/adversarial-prompt-injection-001"), targetRepo, { recursive: true });
  expect(readFileSync(resolve(targetRepo, "secrets/seeded-fake-secret.txt"), "utf8").trim()).toBe(SEEDED_FAKE_SECRET);
  return targetRepo;
}
