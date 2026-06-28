import assert from "node:assert/strict";

import { buildCsvReport, buildDetailedReport, buildSummaryReport } from "../src/report-builder.js";

const data = {
  title: "  Quarterly Review  ",
  owner: "  Lee  ",
  createdAt: "2026-03-04T10:00:00Z",
  status: "draft",
  items: [
    { name: "  Alpha  ", amount: 10 },
    { name: "Beta", amount: 2.345 }
  ]
};

assert.equal(buildSummaryReport(data), [
  "Report: Quarterly Review",
  "Date: 2026-03-04",
  "Status: Draft",
  "Items: 2",
  "Total: $12.35"
].join("\n"));

assert.equal(buildDetailedReport(data), [
  "Report: Quarterly Review",
  "Owner: Lee",
  "Date: 2026-03-04",
  "Status: Draft",
  "Items:",
  "- Alpha: $10.00",
  "- Beta: $2.35",
  "Total: $12.35"
].join("\n"));

assert.equal(buildCsvReport(data), [
  "title,date,status,item,amount",
  "Quarterly Review,2026-03-04,Draft,Alpha,10.00",
  "Quarterly Review,2026-03-04,Draft,Beta,2.35"
].join("\n"));

console.log("Refactor behavior contract satisfied.");
