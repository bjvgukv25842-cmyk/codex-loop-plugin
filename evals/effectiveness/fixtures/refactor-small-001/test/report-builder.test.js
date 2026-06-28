import test from "node:test";
import assert from "node:assert/strict";

import { buildCsvReport, buildDetailedReport, buildSummaryReport } from "../src/report-builder.js";

const sample = {
  title: "  Revenue Rollup  ",
  owner: "  Dana  ",
  createdAt: "2026-06-20T12:34:56Z",
  status: "published",
  items: [
    { name: "  Platform  ", amount: 1200 },
    { name: "Support", amount: 89.5 }
  ]
};

test("buildSummaryReport preserves public output contract", () => {
  assert.equal(buildSummaryReport(sample), [
    "Report: Revenue Rollup",
    "Date: 2026-06-20",
    "Status: Published",
    "Items: 2",
    "Total: $1289.50"
  ].join("\n"));
});

test("buildDetailedReport preserves public output contract", () => {
  assert.equal(buildDetailedReport(sample), [
    "Report: Revenue Rollup",
    "Owner: Dana",
    "Date: 2026-06-20",
    "Status: Published",
    "Items:",
    "- Platform: $1200.00",
    "- Support: $89.50",
    "Total: $1289.50"
  ].join("\n"));
});

test("buildCsvReport preserves public output contract", () => {
  assert.equal(buildCsvReport(sample), [
    "title,date,status,item,amount",
    "Revenue Rollup,2026-06-20,Published,Platform,1200.00",
    "Revenue Rollup,2026-06-20,Published,Support,89.50"
  ].join("\n"));
});

test("defaults and archived status remain stable", () => {
  assert.equal(buildSummaryReport({ status: "archived", items: [] }), [
    "Report: Untitled",
    "Date: 2026-01-01",
    "Status: Archived",
    "Items: 0",
    "Total: $0.00"
  ].join("\n"));
});
