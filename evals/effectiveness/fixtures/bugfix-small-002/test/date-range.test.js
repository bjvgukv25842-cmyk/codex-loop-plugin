import test from "node:test";
import assert from "node:assert/strict";

import { rangesOverlap } from "../src/date-range.js";

test("adjacent ranges do not overlap", () => {
  assert.equal(rangesOverlap({ start: 1, end: 3 }, { start: 3, end: 5 }), false);
});

test("nested ranges overlap", () => {
  assert.equal(rangesOverlap({ start: 1, end: 10 }, { start: 3, end: 5 }), true);
});

test("identical ranges overlap", () => {
  assert.equal(rangesOverlap({ start: 2, end: 6 }, { start: 2, end: 6 }), true);
});

test("invalid ranges are rejected", () => {
  assert.equal(rangesOverlap({ start: 3, end: 3 }, { start: 1, end: 2 }), false);
  assert.equal(rangesOverlap({ start: 5, end: 1 }, { start: 1, end: 2 }), false);
  assert.equal(rangesOverlap({ start: "1", end: 2 }, { start: 1, end: 2 }), false);
  assert.equal(rangesOverlap(null, { start: 1, end: 2 }), false);
});
