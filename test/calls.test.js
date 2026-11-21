import test from "node:test";
import assert from "node:assert/strict";
import { ObjectId } from "mongodb";
import { routeCalls } from "../server/calls.js";

process.env.SSIBUCHAT_SESSION_SECRET="test-session-pepper-for-calls";

function makeDb(){
  const userA=new ObjectId(),userB=new ObjectId(),threadId=new ObjectId(),thread={_id:threadId,tenantId:"tenant-1",participantIds:[userA,userB],type:"direct"};
  const calls=[],participants=[],signals=[],limits=new Map();
  const collections={
    threads:{findOne:async filter=>String(filter._id)===String(threadId)&&filter.tenantId==="tenant-1"&&thread.participantIds.some(id=>String(id)===String(filter.participantIds))?thread:null},
    calls:{
      insertOne:async row=>{row._id=new ObjectId();calls.push(row);return {insertedId:row._id};},
      find:filter=>cursor(calls.filter(row=>row.tenantId===filter.tenantId&&row.participantIds.some(id=>String(id)===String(filter.participantIds))&&filter.status.$in.includes(row.status)&&row.expiresAt>filter.expiresAt.$gt)),
      findOne:async filter=>calls.find(row=>String(row._id)===String(filter._id)&&row.tenantId===filter.tenantId&&row.participantIds.some(id=>String(id)===String(filter.participantIds)))||null,
      updateOne:async(filter,update)=>{const row=calls.find(item=>String(item._id)===String(filter._id)&&(!filter.status||item.status===filter.status));if(!row)return {modifiedCount:0};Object.assign(row,update.$set);return {modifiedCount:1};}
    },
    callParticipants:{
      updateOne:async(filter,update,options)=>{let row=participants.find(item=>String(item.callId)===String(filter.callId)&&String(item.userId)===String(filter.userId));if(!row&&options?.upsert){row={tenantId:filter.tenantId,callId:filter.callId,userId:filter.userId,...update.$setOnInsert};participants.push(row);}if(row&&update.$set)Object.assign(row,update.$set);return {matchedCount:row?1:0};},
      find:filter=>cursor(participants.filter(row=>row.tenantId===filter.tenantId&&String(row.callId)===String(filter.callId)&&row.status===filter.status))
    },
    callSignals:{
      insertOne:async row=>{row._id=new ObjectId();signals.push(row);return {insertedId:row._id};},
      find:filter=>cursor(signals.filter(row=>row.tenantId===filter.tenantId&&String(row.callId)===String(filter.callId)&&String(row.recipientId)===String(filter.recipientId)&&row.createdAt>filter.createdAt.$gt&&row.expiresAt>filter.expiresAt.$gt))
    },
    rateLimits:{findOneAndUpdate:async filter=>{const count=(limits.get(filter.key)||0)+1;limits.set(filter.key,count);return {count};}}
  };
  function cursor(rows){return {sort(){return this;},limit(){return this;},toArray:async()=>rows};}
  return {userA,userB,threadId,calls,participants,signals,collection:name=>collections[name]};
}
async function invoke(db,user,method,path,body={}){
  const res={statusCode:200,setHeader(){},end(value){this.body=value;}};
  await routeCalls({method,url:path,headers:{host:"localhost"},body},res,db,{_id:user,tenantId:"tenant-1"},new URL(path,"http://localhost").pathname);
  return {status:res.statusCode,body:JSON.parse(res.body)};
}

test("thread calls enforce participants and route short-lived offer/ICE signals",async()=>{
  const db=makeDb();
  const created=await invoke(db,db.userA,"POST","/api/calls",{threadId:String(db.threadId),mediaType:"video"});
  assert.equal(created.status,201);
  const callId=created.body.call.id;
  const listed=await invoke(db,db.userB,"GET","/api/calls");
  assert.equal(listed.body.calls.length,1);
  const joined=await invoke(db,db.userB,"POST","/api/calls/"+callId+"/join",{});
  assert.equal(joined.status,200);
  const sent=await invoke(db,db.userA,"POST","/api/calls/"+callId+"/signal",{type:"offer",targetUserId:String(db.userB),payload:{sdp:"offer-sdp"}});
  assert.equal(sent.status,202);
  const received=await invoke(db,db.userB,"GET","/api/calls/"+callId+"/signals?after=1970-01-01T00:00:00.000Z");
  assert.equal(received.status,200);assert.equal(received.body.signals[0].type,"offer");
  const tooLarge=await invoke(db,db.userA,"POST","/api/calls/"+callId+"/signal",{type:"ice",targetUserId:String(db.userB),payload:{candidate:"x".repeat(17000)}});
  assert.equal(tooLarge.status,413);
  const left=await invoke(db,db.userB,"POST","/api/calls/"+callId+"/leave",{});
  assert.equal(left.status,200);assert.equal(left.body.left,true);
  const ended=await invoke(db,db.userA,"POST","/api/calls/"+callId+"/end",{});
  assert.equal(ended.status,200);assert.equal(db.calls[0].status,"ended");
});
