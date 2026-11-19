import test from "node:test";
import assert from "node:assert/strict";
import handler from "../api/cron/outbox.js";

async function invoke(authorization, method="POST") {
  const res={statusCode:200,headers:{},setHeader(name,value){this.headers[name]=value;},end(body){this.body=body;}};
  await handler({method,headers:{authorization}},res);
  return {status:res.statusCode,body:JSON.parse(res.body)};
}

test("outbox cron endpoint rejects missing and incorrect bearer secrets",async()=>{
  delete process.env.CRON_SECRET;
  const missing=await invoke("");
  assert.equal(missing.status,401);
  process.env.CRON_SECRET="test-cron-secret-with-adequate-entropy";
  const wrong=await invoke("Bearer wrong");
  assert.equal(wrong.status,401);
  const method=await invoke("Bearer test-cron-secret-with-adequate-entropy","GET");
  assert.equal(method.status,405);
});
