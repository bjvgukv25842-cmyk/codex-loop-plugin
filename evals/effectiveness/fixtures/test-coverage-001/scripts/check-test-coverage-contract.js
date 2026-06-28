import { readFileSync } from "node:fs";

const testSource = readFileSync(new URL("../test/invoice.test.js", import.meta.url), "utf8").toLowerCase();

const requiredCoverage = [
  ["empty items", /\bempty items?\b|no items|items\s*=\s*\[\]/],
  ["zero discount", /\bzero discount\b|discount:\s*0/],
  ["percent discount", /\bpercent(?:age)? discount\b|discounttype:\s*["']percent["']/],
  ["fixed discount", /\bfixed discount\b|discounttype:\s*["']fixed["']/],
  ["taxable=false", /taxable\s*:\s*false|taxable=false|non-?taxable/],
  ["shippingFee", /shippingfee|shipping fee/],
  ["invalid price", /invalid price|negative price|price.*throw|price.*rangeerror/],
  ["invalid quantity", /invalid quantity|negative quantity|quantity.*throw|quantity.*rangeerror/]
];

const missing = requiredCoverage
  .filter(([, pattern]) => !pattern.test(testSource))
  .map(([name]) => name);

if (missing.length > 0) {
  console.error(`Missing required invoice coverage cases: ${missing.join(", ")}`);
  process.exit(1);
}

console.log("Invoice coverage contract satisfied.");
