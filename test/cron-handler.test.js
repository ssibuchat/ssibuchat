import test from "node:test";
import assert from "node:assert/strict";
import handler from "../api/cron/outbox.js";

function response() {
  return { headers:{}, setHeader(name,value){this.headers[name]=value;}, end(value){this.body=value;}, statusCode:200 };
}
function database() {
  return { collection(name) {
    if (name !== "outboxEvents") throw new Error("unexpected_collection_" + name);
    return { find: () => ({ sort(){return this;}, limit(value){this.batchLimit=value;return this;}, toArray:async()=>[] }) };
  }};
}

test("serverless cron endpoint accepts authenticated POST and returns batch result", async () => {
  process.env.CRON_SECRET = "serverless-cron-secret";
  const res = response();
  await handler({method:"POST",url:"/api/cron/outbox",headers:{authorization:"Bearer serverless-cron-secret"},body:{limit:12}},res,database());
  assert.equal(res.statusCode,200);
  assert.deepEqual(JSON.parse(res.body),{ok:true,claimed:0,processed:0,retried:0,deadLettered:0,skipped:0});
});

test("serverless cron endpoint rejects GET and incorrect bearer credentials", async () => {
  process.env.CRON_SECRET = "serverless-cron-secret";
  const getResponse = response();
  await handler({method:"GET",url:"/api/cron/outbox",headers:{}},getResponse,database());
  assert.equal(getResponse.statusCode,405);
  const unauthorized = response();
  await handler({method:"POST",url:"/api/cron/outbox",headers:{authorization:"Bearer incorrect"},body:{}},unauthorized,database());
  assert.equal(unauthorized.statusCode,401);
  assert.deepEqual(JSON.parse(unauthorized.body),{ok:false,error:"unauthorized"});
});
