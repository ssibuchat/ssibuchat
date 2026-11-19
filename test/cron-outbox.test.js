import test from "node:test";
import assert from "node:assert/strict";
import handler from "../api/cron/outbox.js";

function response(){return {headers:{},setHeader(k,v){this.headers[k]=v;},end(value){this.body=value;}};}
function db(){return {collection(name){if(name!=="outboxEvents")throw new Error("unexpected_collection_"+name);return {find(){return {sort(){return this;},limit(value){this.batch=value;return this;},toArray:async()=>[]};}};}};}

test("cron outbox rejects non-POST requests",async()=>{
  process.env.CRON_SECRET="cron-secret-test";
  const res=response();
  await handler({method:"GET",url:"/api/cron/outbox",headers:{}},res,db());
  assert.equal(res.statusCode,405);
});
test("cron outbox requires Vercel's bearer secret",async()=>{
  process.env.CRON_SECRET="cron-secret-test";
  const res=response();
  await handler({method:"POST",url:"/api/cron/outbox",headers:{}},res,db());
  assert.equal(res.statusCode,401);
});
test("cron outbox accepts authenticated POST requests and clamps batch size",async()=>{
  process.env.CRON_SECRET="cron-secret-test";
  const res=response();
  await handler({method:"POST",url:"/api/cron/outbox",headers:{authorization:"Bearer cron-secret-test"},body:{limit:500}},res,db());
  assert.equal(res.statusCode,200);
  assert.equal(JSON.parse(res.body).ok,true);
  assert.equal(JSON.parse(res.body).claimed,0);
});
