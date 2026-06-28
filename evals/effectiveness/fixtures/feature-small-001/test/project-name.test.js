import test from "node:test";
import assert from "node:assert/strict";
import { validateProjectName } from "../src/project-name.js";

test("rejects empty project names", () => {
  assert.equal(validateProjectName("").ok, false);
});

test("rejects whitespace-only project names", () => {
  assert.equal(validateProjectName("   ").ok, false);
});

test("rejects names longer than 80 characters", () => {
  assert.equal(validateProjectName("x".repeat(81)).ok, false);
});

test("accepts normal project names", () => {
  assert.equal(validateProjectName("My Project").ok, true);
});
