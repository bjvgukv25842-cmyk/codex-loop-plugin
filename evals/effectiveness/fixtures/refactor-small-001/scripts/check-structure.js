import { readFileSync } from "node:fs";

const source = readFileSync("src/report-builder.js", "utf8");
const failures = [];

const trimCalls = source.match(/String\([^)]*\)\.trim\(\)/g) ?? [];
if (trimCalls.length > 3 && !/function\s+(formatText|normalizeText|cleanText)\b/.test(source)) {
  failures.push("Duplicate text trimming logic is not centralized.");
}

const dateFormatBlocks = source.match(/getUTCFullYear\(\)[\s\S]{0,180}getUTCMonth\(\)[\s\S]{0,180}getUTCDate\(\)/g) ?? [];
if (dateFormatBlocks.length > 1 && !/function\s+(formatDate|formatReportDate)\b/.test(source)) {
  failures.push("Duplicate date formatting logic is not centralized.");
}

const statusMaps = source.match(/status\s*===\s*"published"[\s\S]{0,120}status\s*===\s*"archived"/g) ?? [];
if (statusMaps.length > 1 && !/function\s+(formatStatus|statusLabel|mapStatus)\b/.test(source)) {
  failures.push("Duplicate status mapping logic is not centralized.");
}

if (!/function\s+(formatMoney|formatCurrency)\b/.test(source)) {
  failures.push("Currency formatting helper is missing.");
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log("Refactor structure contract satisfied.");
