import test from "node:test";
import assert from "node:assert/strict";

import { createUserCache } from "../src/cache.js";
import { createMemoryUserStorage } from "../src/cache-storage.js";

test("returns a cached user on repeated reads", () => {
  const storage = createMemoryUserStorage({
    "user-1": { name: "Ada" }
  });
  const cache = createUserCache(storage);

  assert.deepEqual(cache.getUser("user-1"), { name: "Ada" });
  assert.deepEqual(cache.getUser("user-1"), { name: "Ada" });
  assert.deepEqual(storage.calls.loadUser, ["user-1"]);
});
