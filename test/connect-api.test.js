import test from "node:test";
import assert from "node:assert/strict";
import { ObjectId } from "mongodb";
import { randomBytes } from "node:crypto";
import { route } from "../server/router.js";
import { hashToken } from "../server/security.js";

process.env.SSIBUCHAT_SESSION_SECRET = "test-session-pepper-for-connect-api-integration";

function makeDb() {
  const users = [
    { _id:new ObjectId(), username:"alice", usernameNormalized:"alice", displayName:"Alice", tenantId:"tenant-1", status:"active", role:"member" },
    { _id:new ObjectId(), username:"bob", usernameNormalized:"bob", displayName:"Bob", tenantId:"tenant-1", status:"active", role:"member" },
    { _id:new ObjectId(), username:"charlie", usernameNormalized:"charlie", displayName:"Charlie", tenantId:"tenant-1", status:"active", role:"member" }
  ];
  const senderToken = randomBytes(32).toString("base64url"), recipientToken = randomBytes(32).toString("base64url"), thirdToken = randomBytes(32).toString("base64url");
  const sessions = [
    { _id:new ObjectId(), tokenHash:hashToken(senderToken), userId:users[0]._id, tenantId:"tenant-1", expiresAt:new Date(Date.now()+3600000), createdAt:new Date() },
    { _id:new ObjectId(), tokenHash:hashToken(recipientToken), userId:users[1]._id, tenantId:"tenant-1", expiresAt:new Date(Date.now()+3600000), createdAt:new Date() },
    { _id:new ObjectId(), tokenHash:hashToken(thirdToken), userId:users[2]._id, tenantId:"tenant-1", expiresAt:new Date(Date.now()+3600000), createdAt:new Date() }
  ];
  const threadId = new ObjectId();
  const thread = { _id:threadId, tenantId:"tenant-1", type:"group", title:"Project team", participantIds:[users[0]._id,users[1]._id], createdBy:users[0]._id, adminIds:[users[0]._id], messageCount:0, createdAt:new Date(), updatedAt:new Date() };
  const messages=[], receipts=[], outbox=[], audits=[], invites=[], joinRequests=[], blocks=[], reports=[], limits=new Map();
  const collections = {
    users: {
      findOne: async filter => users.find(user =>
        (!filter._id || String(user._id)===String(filter._id)) &&
        (!filter.usernameNormalized || user.usernameNormalized===filter.usernameNormalized) &&
        (!filter.status || user.status===filter.status) &&
        (!filter.tenantId || user.tenantId===filter.tenantId)
      ) || null,
      find: filter => cursor(users.filter(user =>
        (!filter._id?.$in || filter._id.$in.some(id=>String(id)===String(user._id))) &&
        (!filter.usernameNormalized?.$in || filter.usernameNormalized.$in.includes(user.usernameNormalized)) &&
        (!filter.tenantId || user.tenantId===filter.tenantId) &&
        (!filter.status || user.status===filter.status)
      ))
    },
    sessions: {
      findOne: async filter => sessions.find(session=>session.tokenHash===filter.tokenHash&&session.expiresAt>filter.expiresAt.$gt)||null
    },
    threads: {
      findOne: async filter => String(filter._id)===String(thread._id)&&filter.tenantId===thread.tenantId&&(!filter.participantIds||thread.participantIds.some(id=>String(id)===String(filter.participantIds)))?thread:null,
      updateOne: async (filter,update) => {
        if(String(filter._id)!==String(thread._id))return {modifiedCount:0};
        if(update.$set)Object.assign(thread,update.$set);
        if(update.$inc)for(const [key,value] of Object.entries(update.$inc))thread[key]=(thread[key]||0)+value;
        if(update.$addToSet?.participantIds?.$each)for(const value of update.$addToSet.participantIds.$each)if(!thread.participantIds.some(id=>String(id)===String(value)))thread.participantIds.push(value);
        if(update.$addToSet?.participantIds&&!update.$addToSet.participantIds.$each){const value=update.$addToSet.participantIds;if(!thread.participantIds.some(id=>String(id)===String(value)))thread.participantIds.push(value);}
        if(update.$addToSet?.adminIds){const value=update.$addToSet.adminIds;if(!thread.adminIds.some(id=>String(id)===String(value)))thread.adminIds.push(value);}
        if(update.$pull?.participantIds)thread.participantIds=thread.participantIds.filter(id=>String(id)!==String(update.$pull.participantIds));
        if(update.$pull?.adminIds)thread.adminIds=thread.adminIds.filter(id=>String(id)!==String(update.$pull.adminIds));
        return {modifiedCount:1};
      }
    },
    messages: {
      insertOne: async message => { message._id=new ObjectId();messages.push(message);return {insertedId:message._id}; },
      findOne: async filter => messages.find(message=>String(message._id)===String(filter._id)&&message.tenantId===filter.tenantId&&String(message.senderId)===String(filter.senderId))||null,
      find: filter => cursor(messages.filter(message=>
        (!filter.tenantId||message.tenantId===filter.tenantId)&&
        (!filter.threadId||String(message.threadId)===String(filter.threadId))&&
        (!filter.senderId?.$ne||String(message.senderId)!==String(filter.senderId.$ne))&&
        (!filter._id?.$lte||String(message._id)<=String(filter._id.$lte))
      ))
    },
    blocks: {
      findOne: async filter => blocks.find(row=>row.tenantId===filter.tenantId&&(
        filter.$or?filter.$or.some(pair=>String(row.userId)===String(pair.userId)&&String(row.blockedUserId)===String(pair.blockedUserId)):
        String(row.userId)===String(filter.userId)&&String(row.blockedUserId)===String(filter.blockedUserId)
      ))||null,
      find: filter => cursor(blocks.filter(row=>row.tenantId===filter.tenantId&&String(row.userId)===String(filter.userId))),
      insertOne: async row => {row._id=new ObjectId();blocks.push(row);return {insertedId:row._id};},
      deleteOne: async filter => {const index=blocks.findIndex(row=>row.tenantId===filter.tenantId&&String(row.userId)===String(filter.userId)&&String(row.blockedUserId)===String(filter.blockedUserId));if(index<0)return {deletedCount:0};blocks.splice(index,1);return {deletedCount:1};}
    },
    reports: {
      insertOne: async row => {row._id=new ObjectId();reports.push(row);return {insertedId:row._id};},
      find: filter => cursor(reports.filter(row=>row.tenantId===filter.tenantId)),
      updateOne: async (filter,update) => {const row=reports.find(item=>String(item._id)===String(filter._id)&&item.tenantId===filter.tenantId);if(!row)return {matchedCount:0};Object.assign(row,update.$set);return {matchedCount:1};}
    },
    groupInvites: {
      insertOne: async invite => {invite._id=new ObjectId();invites.push(invite);return {insertedId:invite._id};},
      findOne: async filter => invites.find(invite=>
        (!filter._id||String(invite._id)===String(filter._id))&&
        (!filter.tokenHash||invite.tokenHash===filter.tokenHash)&&
        (!filter.tenantId||invite.tenantId===filter.tenantId)&&
        (!filter.threadId||String(invite.threadId)===String(filter.threadId))&&
        (!("revokedAt" in filter)||invite.revokedAt===filter.revokedAt)&&
        (!filter.expiresAt?.$gt||invite.expiresAt>filter.expiresAt.$gt)
      )||null,
      updateOne: async (filter,update) => {
        const invite=invites.find(item=>String(item._id)===String(filter._id)&&(!filter.uses?.$lt||item.uses<filter.uses.$lt)&&(!filter.revokedAt||item.revokedAt===filter.revokedAt));
        if(!invite)return {modifiedCount:0};
        if(update.$inc)for(const [key,value] of Object.entries(update.$inc))invite[key]=(invite[key]||0)+value;
        if(update.$set)Object.assign(invite,update.$set);
        return {modifiedCount:1};
      },
      find: filter => cursor(invites.filter(invite=>invite.tenantId===filter.tenantId&&String(invite.threadId)===String(filter.threadId)&&invite.revokedAt===null&&invite.expiresAt>filter.expiresAt.$gt))
    },
    groupJoinRequests: {
      insertOne: async request => {request._id=new ObjectId();joinRequests.push(request);return {insertedId:request._id};},
      findOne: async filter => joinRequests.find(item=>
        (!filter._id||String(item._id)===String(filter._id))&&
        (!filter.tenantId||item.tenantId===filter.tenantId)&&
        (!filter.threadId||String(item.threadId)===String(filter.threadId))&&
        (!filter.inviteId||String(item.inviteId)===String(filter.inviteId))&&
        (!filter.userId||String(item.userId)===String(filter.userId))&&
        (!filter.status||item.status===filter.status)
      )||null,
      find: filter => cursor(joinRequests.filter(item=>item.tenantId===filter.tenantId&&String(item.threadId)===String(filter.threadId)&&item.status===filter.status)),
      updateOne: async (filter,update) => {const item=joinRequests.find(row=>String(row._id)===String(filter._id)&&row.status===filter.status);if(!item)return {modifiedCount:0};Object.assign(item,update.$set);return {modifiedCount:1};}
    },
    messageReceipts: {
      updateOne: async (filter,update) => {
        let row=receipts.find(item=>item.tenantId===filter.tenantId&&String(item.messageId)===String(filter.messageId)&&String(item.userId)===String(filter.userId));
        if(!row&&update.$setOnInsert){row={...update.$setOnInsert};receipts.push(row);return {upsertedCount:1};}
        return {matchedCount:row?1:0};
      },
      updateMany: async (filter,update) => {
        let modifiedCount=0;
        for(const row of receipts){
          if(row.tenantId!==filter.tenantId||String(row.userId)!==String(filter.userId)||!filter.messageId.$in.some(id=>String(id)===String(row.messageId)))continue;
          if(typeof filter.status==="string"&&row.status!==filter.status)continue;
          if(filter.status?.$ne&&row.status===filter.status.$ne)continue;
          Object.assign(row,update.$set);modifiedCount++;
        }
        return {modifiedCount};
      },
      find: filter => cursor(receipts.filter(row=>row.tenantId===filter.tenantId&&String(row.messageId)===String(filter.messageId)))
    },
    outboxEvents: { updateOne: async (filter,update) => { outbox.push({filter,update});return {upsertedCount:1}; } },
    rateLimits: { findOneAndUpdate: async filter => {const count=(limits.get(filter.key)||0)+1;limits.set(filter.key,count);return {count};} },
    auditEvents: { insertOne: async event => {audits.push(event);return {insertedId:new ObjectId()};} }
  };
  function cursor(items){return {sort(){return this;},limit(){return this;},toArray:async()=>items};}
  return { users, sessions, thread, messages, receipts, invites, joinRequests, blocks, reports, senderToken, recipientToken, thirdToken, threadId, collection:name=>collections[name] };
}
async function invoke(db, token, method, url, body={}) {
  const headers={};
  const res={statusCode:200,setHeader(name,value){headers[name]=value;},end(value){this.body=value;}};
  const req={method,url,headers:{host:"localhost",origin:"http://localhost",cookie:"ssibu_session="+encodeURIComponent(token)},socket:{},body};
  await route(req,res,db);
  return {status:res.statusCode,body:JSON.parse(res.body),headers};
}

test("message receipts advance accepted to delivered to read and are visible to sender",async()=>{
  const db=makeDb();
  const sent=await invoke(db,db.senderToken,"POST","/api/messages",{threadId:String(db.threadId),text:"Hello team",idempotencyKey:"message-key-1"});
  assert.equal(sent.status,201);
  assert.equal(db.receipts.length,1);
  assert.equal(db.receipts[0].status,"accepted");
  const messageId=sent.body.message.id;
  const history=await invoke(db,db.recipientToken,"GET","/api/threads/"+db.threadId+"/messages");
  assert.equal(history.status,200);
  assert.equal(db.receipts[0].status,"delivered");
  const read=await invoke(db,db.recipientToken,"POST","/api/threads/"+db.threadId+"/read",{upToMessageId:messageId});
  assert.equal(read.status,200);
  assert.equal(db.receipts[0].status,"read");
  const senderView=await invoke(db,db.senderToken,"GET","/api/messages/"+messageId+"/receipts");
  assert.equal(senderView.status,200);
  assert.equal(senderView.body.receipts[0].status,"read");
});

test("group administration authorizes member changes and admin promotion",async()=>{
  const db=makeDb();
  const denied=await invoke(db,db.recipientToken,"POST","/api/threads/"+db.threadId+"/members",{usernames:["charlie"]});
  assert.equal(denied.status,403);
  const added=await invoke(db,db.senderToken,"POST","/api/threads/"+db.threadId+"/members",{usernames:["charlie"]});
  assert.equal(added.status,200);
  assert.equal(added.body.added,1);
  const promoted=await invoke(db,db.senderToken,"POST","/api/threads/"+db.threadId+"/admins",{username:"bob"});
  assert.equal(promoted.status,200);
  assert.ok(db.thread.adminIds.some(id=>String(id)===String(db.users[1]._id)));
  const removed=await invoke(db,db.recipientToken,"DELETE","/api/threads/"+db.threadId+"/members/"+db.users[2]._id);
  assert.equal(removed.status,200);
  assert.ok(!db.thread.participantIds.some(id=>String(id)===String(db.users[2]._id)));
});

test("group invite token requires approval and admin approval joins the member",async()=>{
  const db=makeDb();
  const created=await invoke(db,db.senderToken,"POST","/api/threads/"+db.threadId+"/invites",{expiresInHours:24,maxUses:2,requiresApproval:true});
  assert.equal(created.status,201);
  assert.ok(created.body.invite.token);
  const joined=await invoke(db,db.thirdToken,"POST","/api/group-invites/"+created.body.invite.token+"/join");
  assert.equal(joined.status,202);
  assert.equal(joined.body.status,"pending");
  assert.equal(db.thread.participantIds.some(id=>String(id)===String(db.users[2]._id)),false);
  const listed=await invoke(db,db.senderToken,"GET","/api/threads/"+db.threadId+"/join-requests");
  assert.equal(listed.status,200);
  const requestId=listed.body.requests[0].id;
  const approved=await invoke(db,db.senderToken,"PATCH","/api/threads/"+db.threadId+"/join-requests/"+requestId,{decision:"approve"});
  assert.equal(approved.status,200);
  assert.equal(db.thread.participantIds.some(id=>String(id)===String(db.users[2]._id)),true);
  assert.equal(db.invites[0].uses,1);
});

test("block controls prevent direct conversations and reports enter admin review",async()=>{
  const db=makeDb();
  const blocked=await invoke(db,db.senderToken,"POST","/api/people/blocked",{username:"bob"});
  assert.equal(blocked.status,200);
  assert.equal(db.blocks.length,1);
  const direct=await invoke(db,db.senderToken,"POST","/api/threads",{participants:["bob"]});
  assert.equal(direct.status,403);
  assert.equal(direct.body.error,"conversation_blocked");
  const list=await invoke(db,db.senderToken,"GET","/api/people/blocked");
  assert.equal(list.status,200);
  assert.equal(list.body.blocked[0].username,"bob");
  const unblocked=await invoke(db,db.senderToken,"DELETE","/api/people/blocked/"+db.users[1]._id);
  assert.equal(unblocked.status,200);
  assert.equal(db.blocks.length,0);
  const report=await invoke(db,db.senderToken,"POST","/api/reports",{targetType:"user",targetId:String(db.users[1]._id),reason:"Harassment"});
  assert.equal(report.status,201);
  db.users[0].role="admin";
  const queue=await invoke(db,db.senderToken,"GET","/api/admin/reports");
  assert.equal(queue.status,200);
  assert.equal(queue.body.reports.length,1);
  const reviewed=await invoke(db,db.senderToken,"PATCH","/api/admin/reports/"+report.body.reportId,{status:"resolved"});
  assert.equal(reviewed.status,200);
  assert.equal(db.reports[0].status,"resolved");
});
