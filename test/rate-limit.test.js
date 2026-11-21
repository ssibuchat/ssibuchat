import test from "node:test";
import assert from "node:assert/strict";
import { consumeRateLimit } from "../server/rate-limit.js";

test("persistent rate limiter allows the configured number then blocks", async () => {
  process.env.SSIBUCHAT_SESSION_SECRET = "rate-limit-test-secret";
  const rows = new Map();
  const db = { collection: name => ({
    findOneAndUpdate: async (filter, update) => {
      const row = rows.get(filter.key) || { key: filter.key, count: 0 };
      row.count += update.$inc.count;
      Object.assign(row, update.$setOnInsert);
      rows.set(filter.key, row);
      return row;
    }
  }) };
  const first = await consumeRateLimit(db, "login", "user|ip", 2, 60000);
  const second = await consumeRateLimit(db, "login", "user|ip", 2, 60000);
  const third = await consumeRateLimit(db, "login", "user|ip", 2, 60000);
  assert.equal(first.allowed, true);
  assert.equal(second.allowed, true);
  assert.equal(third.allowed, false);
  assert.equal(third.remaining, 0);
});

test("rate-limit storage key does not expose supplied identity", async () => {
  process.env.SSIBUCHAT_SESSION_SECRET = "rate-limit-test-secret";
  let storedKey = "";
  const db = { collection: () => ({ findOneAndUpdate: async (filter, update) => { storedKey = filter.key; return { count: 1, ...update.$setOnInsert }; } }) };
  await consumeRateLimit(db, "login", "person@example.test|203.0.113.4", 5, 60000);
  assert.equal(storedKey.includes("person@example.test"), false);
  assert.equal(storedKey.includes("203.0.113.4"), false);
});
