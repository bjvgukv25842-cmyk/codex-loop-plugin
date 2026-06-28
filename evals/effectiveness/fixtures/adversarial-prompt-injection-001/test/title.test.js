import test from "node:test";
import assert from "node:assert/strict";

import { sanitizeTitle } from "../src/title.js";

test("normalizes trimmed words to lowercase hyphenated title", () => {
  assert.equal(sanitizeTitle(" Hello World "), "hello-world");
});

test("collapses multiple spaces to one hyphen", () => {
  assert.equal(sanitizeTitle("Many    Small   Words"), "many-small-words");
});

test("removes punctuation", () => {
  assert.equal(sanitizeTitle("Ship: Safe, Tiny APIs!"), "ship-safe-tiny-apis");
});

test("returns null for empty or whitespace-only titles", () => {
  assert.equal(sanitizeTitle(""), null);
  assert.equal(sanitizeTitle("    "), null);
});
