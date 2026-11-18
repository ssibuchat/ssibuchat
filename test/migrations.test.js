import test from "node:test";
import assert from "node:assert/strict";
import { runMigrations } from "../server/migrations.js";

function makeDb() {
  const users=[{_id:"u1",role:"admin",status:"active",createdAt:new Date(0)},{_id:"u2",role:"member",status:"active",tenantId:"tenant-2"}];
  const workspaces=[{_id:"w1",tenantId:"tenant-2",ownerId:"u2",createdAt:new Date(0)}];
  const memberships=[],workspaceMembers=[];
  let migration=null;
  const collections={
    schemaMigrations:{
      findOneAndUpdate:async(filter,update)=>{if(migration?.status==="completed"||(migration?.leaseUntil&&migration.leaseUntil>new Date())){const e=new Error("duplicate");e.code=11000;throw e;}migration={...(migration||{}),id:filter.id,...update.$set};return migration;},
      updateOne:async(filter,update)=>{if(!migration||migration.leaseToken!==filter.leaseToken)return {matchedCount:0};Object.assign(migration,update.$set);for(const key of Object.keys(update.$unset||{}))delete migration[key];return {matchedCount:1};}
    },
    users:{
      find:()=>({toArray:async()=>users}),
      updateOne:async(filter,update)=>{const user=users.find(row=>row._id===filter._id);if(user)Object.assign(user,update.$set);return {modifiedCount:user?1:0};}
    },
    workspaces:{find:()=>({toArray:async()=>workspaces})},
    memberships:{updateOne:async(filter,update)=>{if(!memberships.some(row=>row.tenantId===filter.tenantId&&row.userId===filter.userId))memberships.push(update.$setOnInsert);return {upsertedCount:1};}},
    workspaceMembers:{updateOne:async(filter,update)=>{if(!workspaceMembers.some(row=>row.workspaceId===filter.workspaceId&&row.userId===filter.userId))workspaceMembers.push(update.$setOnInsert);return {upsertedCount:1};}}
  };
  return {users,workspaces,memberships,workspaceMembers,get migration(){return migration;},collection:name=>collections[name]};
}

test("tenant membership migration backfills user tenants and workspace owners idempotently",async()=>{
  const db=makeDb();
  const first=await runMigrations(db);
  assert.equal(first.applied,true);
  assert.equal(db.users[0].tenantId,"global");
  assert.equal(db.users[0].schemaVersion,1);
  assert.equal(db.memberships.length,2);
  assert.equal(db.memberships.find(row=>row.userId==="u1").role,"admin");
  assert.equal(db.workspaceMembers.length,1);
  const second=await runMigrations(db);
  assert.equal(second.skipped,true);
  assert.equal(db.memberships.length,2);
  assert.equal(db.workspaceMembers.length,1);
});
