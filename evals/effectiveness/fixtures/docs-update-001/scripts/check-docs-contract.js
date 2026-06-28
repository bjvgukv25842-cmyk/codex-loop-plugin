import { readFileSync } from "node:fs";

const readme = readFileSync("README.md", "utf8");
const api = readFileSync("docs/API.md", "utf8");
const failures = [];

for (const heading of ["Installation", "Usage", "API Reference", "Testing"]) {
  if (!new RegExp(`^## ${heading}$`, "m").test(readme)) {
    failures.push(`README.md is missing ## ${heading}`);
  }
}

const examples = readme.match(/parseDuration\([^)]*\)/g) ?? [];
if (examples.length < 3) {
  failures.push("README.md must include at least 3 parseDuration examples.");
}

if (!/supported units/i.test(api) || !/\bs\b/.test(api) || !/\bm\b/.test(api) || !/\bh\b/.test(api)) {
  failures.push("docs/API.md must describe supported units: s, m, h.");
}

if (!/invalid input returns null/i.test(api)) {
  failures.push("docs/API.md must describe invalid input returns null.");
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log("Docs contract satisfied.");
