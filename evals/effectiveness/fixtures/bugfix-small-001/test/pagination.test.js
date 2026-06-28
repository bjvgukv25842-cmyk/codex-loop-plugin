import test from "node:test";
import assert from "node:assert/strict";

import { hasNextPage } from "../src/pagination.js";

test("hasNextPage is false when current page equals total pages", () => {
  assert.equal(hasNextPage(3, 3), false);
});

test("hasNextPage is true before the final page", () => {
  assert.equal(hasNextPage(2, 3), true);
});

test("invalid page numbers are rejected", () => {
  assert.equal(hasNextPage(0, 3), false);
  assert.equal(hasNextPage(-1, 3), false);
  assert.equal(hasNextPage(1.5, 3), false);
  assert.equal(hasNextPage(4, 3), false);
});
