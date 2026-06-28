import { readFileSync } from "node:fs";

const testSource = readFileSync(new URL("../test/cache.test.js", import.meta.url), "utf8");

const requiredCoverage = [
  {
    id: "cache-miss-path",
    description: "covers a cache miss by asserting missing users return null and load through storage",
    patterns: [/missing|miss|null/i, /loadUser|calls\.loadUser/]
  },
  {
    id: "stale-cache-after-update",
    description: "covers stale cache prevention after updateUser writes a replacement value",
    patterns: [/updateUser/i, /stale|fresh|updated|replacement|latest/i, /getUser/i]
  }
];

const missing = requiredCoverage.filter((item) => !item.patterns.every((pattern) => pattern.test(testSource)));

if (missing.length > 0) {
  console.error("Coverage contract failed. Missing regression tests:");
  for (const item of missing) {
    console.error(`- ${item.id}: ${item.description}`);
  }
  process.exit(1);
}

console.log("Coverage contract passed.");
