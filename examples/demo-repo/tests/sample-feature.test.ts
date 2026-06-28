import { describe, expect, it } from "vitest";

import { validateProjectName } from "../src/sample-feature.ts";

describe("validateProjectName", () => {
  it("rejects an empty string", () => {
    expect(validateProjectName("")).toEqual({
      valid: false,
      reason: "Project name is required."
    });
  });

  it("rejects a whitespace-only name", () => {
    expect(validateProjectName("   ")).toEqual({
      valid: false,
      reason: "Project name cannot be only whitespace."
    });
  });

  it("rejects names longer than 80 characters", () => {
    expect(validateProjectName("a".repeat(81))).toEqual({
      valid: false,
      reason: "Project name must be 80 characters or fewer."
    });
  });

  it("accepts a normal project name", () => {
    expect(validateProjectName("Codex Loop")).toEqual({
      valid: true
    });
  });
});
