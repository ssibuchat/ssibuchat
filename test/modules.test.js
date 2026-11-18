import test from "node:test";
import assert from "node:assert/strict";
import { projectInput } from "../server/modules.js";

test("module input drops unrecognized fields", () => {
  assert.deepEqual(projectInput("tasks", { title: "Ship", status: "todo", ownerId: "attacker", tenantId: "other" }), { title: "Ship", status: "todo" });
});

test("task status and priority are allowlisted", () => {
  assert.deepEqual(projectInput("tasks", { title: "Review", status: "in_progress", priority: "high" }), { title: "Review", status: "in_progress", priority: "high" });
  assert.throws(() => projectInput("tasks", { status: "admin" }), /invalid_status/);
  assert.throws(() => projectInput("tasks", { priority: "critical" }), /invalid_priority/);
});

test("commerce prices must be safe non-negative integer minor units", () => {
  assert.deepEqual(projectInput("products", { name: "Notebook", currency: "UGX", priceMinor: 12500, trackInventory: false, stockQuantity: 0 }), { name: "Notebook", currency: "UGX", priceMinor: 12500 });
  assert.throws(() => projectInput("products", { priceMinor: -1 }), /invalid_priceMinor/);
  assert.throws(() => projectInput("products", { priceMinor: 1.25 }), /invalid_priceMinor/);
  assert.throws(() => projectInput("products", { currency: "US" }), /invalid_currency/);
  assert.throws(() => projectInput("products", { name: "No price" }), /priceMinor_required/);
});

test("finance records require type, currency and integer minor-unit amount", () => {
  assert.deepEqual(projectInput("finance", { type: "income", currency: "UGX", amountMinor: 50000 }), { type: "income", currency: "UGX", amountMinor: 50000 });
  assert.throws(() => projectInput("finance", { type: "transfer", currency: "UGX", amountMinor: 50000 }), /invalid_type/);
  assert.throws(() => projectInput("finance", { type: "income", amountMinor: 50000 }), /finance_amount_currency_and_type_required/);
});

test("bounded text strips control characters", () => {
  assert.deepEqual(projectInput("workspaces", { name: "  Team\u0000 Space  ", description: "A".repeat(1200) }), { name: "Team Space", description: "A".repeat(1000) });
});
