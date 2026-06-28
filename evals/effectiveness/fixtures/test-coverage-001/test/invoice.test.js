import test from "node:test";
import assert from "node:assert/strict";

import { calculateInvoiceTotal } from "../src/invoice.js";

test("calculates a happy path invoice total", () => {
  assert.equal(
    calculateInvoiceTotal([{ price: 10, quantity: 2 }], { taxRate: 0.1 }),
    22
  );
});

test("applies a basic fixed discount on the happy path", () => {
  assert.equal(
    calculateInvoiceTotal([{ price: 20, quantity: 1 }], { discount: 5, taxRate: 0 }),
    15
  );
});
