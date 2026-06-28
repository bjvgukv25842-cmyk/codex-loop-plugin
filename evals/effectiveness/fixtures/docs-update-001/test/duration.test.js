import test from "node:test";
import assert from "node:assert/strict";

import { parseDuration } from "../src/duration.js";

test("parses seconds", () => {
  assert.equal(parseDuration("5s"), 5000);
});

test("parses minutes", () => {
  assert.equal(parseDuration("2m"), 120000);
});

test("parses hours", () => {
  assert.equal(parseDuration("1h"), 3600000);
});

test("returns null for invalid input", () => {
  assert.equal(parseDuration("wat"), null);
});
