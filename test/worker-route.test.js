import test from "node:test";
import assert from "node:assert/strict";
import { route } from "../server/router.js";

function response(){return {headers:{},setHeader(k,v){this.headers[k]=v;},end(value){this.body=value;}};}
function db(){return {collection(name){if(name!=="outboxEvents")throw new Error("unexpected_collection_"+name);return {find(){return {sort(){return this;},limit(){return this;},toArray:async()=>[]};}};}};}
test("outbox worker endpoint requires the configured bearer secret",async()=>{
  process.env.SSIBUCHAT_WORKER_SECRET="worker-secret-test";
  const res=response();
  await route({method:"POST",url:"/api/internal/workers/outbox",headers:{host:"localhost"},body:{}},res,db());
  assert.equal(res.statusCode,401);assert.equal(JSON.parse(res.body).error,"worker_not_authorized");
});
test("outbox worker endpoint accepts authorized bounded batch requests",async()=>{
  process.env.SSIBUCHAT_WORKER_SECRET="worker-secret-test";
  const res=response();
  await route({method:"POST",url:"/api/internal/workers/outbox",headers:{host:"localhost",authorization:"Bearer worker-secret-test"},body:{limit:200}},res,db());
  assert.equal(res.statusCode,200);assert.equal(JSON.parse(res.body).ok,true);assert.equal(JSON.parse(res.body).claimed,0);
});
