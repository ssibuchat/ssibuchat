import test from "node:test";
import assert from "node:assert/strict";
import { processOutboxBatch } from "../server/outbox-worker.js";

function makeDb({ message = { _id:"message-1", tenantId:"tenant-1", threadId:"thread-1", senderId:"sender-1" }, thread = { _id:"thread-1", participantIds:["sender-1","recipient-1","recipient-2"] }, event = {} } = {}) {
  const outbox = [{ _id:"event-1", tenantId:"tenant-1", aggregateId:"message-1", type:"message.accepted", processedAt:null, createdAt:new Date(0), ...event }];
  const jobs = [];
  const db = { collection(name) {
    if (name === "outboxEvents") return {
      find: () => ({ sort(){return this;}, limit(){return this;}, toArray:async()=>outbox.filter(row=>!row.processedAt&&!row.deadLetteredAt) }),
      findOneAndUpdate: async (filter,update) => {
        const row=outbox.find(item=>item._id===filter._id&&!item.processedAt&&!item.deadLetteredAt&&(!item.leaseUntil||item.leaseUntil<new Date(2_000_000_000_000)));
        if(!row)return null;
        Object.assign(row,update.$set);row.attempts=(row.attempts||0)+(update.$inc?.attempts||0);return row;
      },
      updateOne: async (filter,update) => {const row=outbox.find(item=>item._id===filter._id&&item.leaseToken===filter.leaseToken);if(!row)return {modifiedCount:0};Object.assign(row,update.$set);return {modifiedCount:1};}
    };
    if(name==="messages")return {findOne:async()=>message};
    if(name==="threads")return {findOne:async()=>thread};
    if(name==="deliveryJobs")return {updateOne:async(filter,update)=>{if(!jobs.some(job=>job.messageId===filter.messageId&&job.userId===filter.userId))jobs.push(update.$setOnInsert);return {upsertedCount:1};}};
    throw new Error("unexpected_collection_"+name);
  }};
  return {db,outbox,jobs};
}

test("outbox dispatch idempotently queues one job per recipient and marks event processed",async()=>{
  const f=makeDb();
  const result=await processOutboxBatch(f.db,{clock:()=>1_000_000});
  assert.equal(result.processed,1);
  assert.equal(f.jobs.length,2);
  assert.equal(f.outbox[0].processedAt.getTime(),1_000_000);
  assert.equal(f.jobs.every(job=>job.state==="queued"),true);
});

test("missing message is retried with backoff and eventually dead-lettered",async()=>{
  const f=makeDb({message:null});
  const first=await processOutboxBatch(f.db,{clock:()=>1_000_000});
  assert.equal(first.retried,1);
  assert.equal(f.outbox[0].attempts,1);
  assert.ok(f.outbox[0].nextAttemptAt instanceof Date);
  f.outbox[0].nextAttemptAt=new Date(0);
  f.outbox[0].attempts=9;
  f.outbox[0].leaseUntil=null;
  const last=await processOutboxBatch(f.db,{clock:()=>2_000_000});
  assert.equal(last.deadLettered,1);
  assert.ok(f.outbox[0].deadLetteredAt instanceof Date);
});
