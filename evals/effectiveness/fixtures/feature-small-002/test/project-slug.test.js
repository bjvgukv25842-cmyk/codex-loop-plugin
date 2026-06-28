import test from "node:test";
import assert from "node:assert/strict";
import { normalizeProjectSlug } from "../src/project-slug.js";

test("lowercases ASCII letters", () => {
  assert.equal(normalizeProjectSlug("ProjectAlpha"), "projectalpha");
});

test("converts spaces to hyphens", () => {
  assert.equal(normalizeProjectSlug("project alpha beta"), "project-alpha-beta");
});

test("trims surrounding whitespace before normalizing", () => {
  assert.equal(normalizeProjectSlug("  Project Alpha  "), "project-alpha");
});

test("rejects empty slugs after normalization", () => {
  assert.throws(() => normalizeProjectSlug("   "), /empty/i);
});
