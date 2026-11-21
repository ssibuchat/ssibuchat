import test from "node:test";
import assert from "node:assert/strict";
import { route } from "../server/router.js";

function response() {
  return {
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    end(value) { this.body = value; },
    statusCode: 200
  };
}
function database() {
  return { collection(name) {
    if (name !== "outboxEvents") throw new Error("unexpected_collection_" + name);
    return { find: () => ({ sort() { return this; }, limit() { return this; }, toArray: async () => [] }) };
  }};
}

test("canonical cron outbox route authenticates with CRON_SECRET", async () => {
  process.env.CRON_SECRET = "test-cron-secret";
  process.env.SSIBUCHAT_SESSION_SECRET = "test-session-secret";
  const res = response();
  await route({ method:"POST", url:"/api/cron/outbox", headers:{ host:"ssibuchat.example.test", authorization:"Bearer test-cron-secret" }, body:{ limit:10 } }, res, database());
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), { ok:true, claimed:0, processed:0, retried:0, deadLettered:0, skipped:0, notificationsCreated:0 });
});

test("canonical cron outbox route rejects missing or incorrect CRON_SECRET", async () => {
  process.env.CRON_SECRET = "expected-secret";
  process.env.SSIBUCHAT_SESSION_SECRET = "test-session-secret";
  const res = response();
  await route({ method:"POST", url:"/api/cron/outbox", headers:{ host:"ssibuchat.example.test", authorization:"Bearer wrong-secret" }, body:{} }, res, database());
  assert.equal(res.statusCode, 401);
  assert.deepEqual(JSON.parse(res.body), { ok:false, error:"worker_not_authorized" });
});
