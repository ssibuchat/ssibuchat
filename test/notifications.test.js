import test from "node:test";
import assert from "node:assert/strict";
import { ObjectId } from "mongodb";
import { routeNotifications } from "../server/notifications.js";

function response(){return {statusCode:200,headers:{},setHeader(name,value){this.headers[name]=value;},end(body){this.body=body;}};}
function makeDb(rows){
  return {collection(name){
    if(name!=="notifications")throw new Error("unexpected_collection_"+name);
    return {
      find(filter){const selected=rows.filter(row=>String(row.tenantId)===String(filter.tenantId)&&String(row.userId)===String(filter.userId));let limited=selected;return {sort(){selected.sort((a,b)=>b.createdAt-a.createdAt);return this;},limit(n){limited=selected.slice(0,n);return this;},toArray:async()=>limited};},
      countDocuments:async filter=>rows.filter(row=>String(row.tenantId)===String(filter.tenantId)&&String(row.userId)===String(filter.userId)&&row.readAt===null).length,
      updateOne:async(filter,update)=>{const row=rows.find(item=>String(item._id)===String(filter._id)&&String(item.tenantId)===String(filter.tenantId)&&String(item.userId)===String(filter.userId)&&item.readAt===null);if(!row)return {matchedCount:0,modifiedCount:0};Object.assign(row,update.$set);return {matchedCount:1,modifiedCount:1};},
      findOne:async filter=>rows.find(item=>String(item._id)===String(filter._id)&&String(item.tenantId)===String(filter.tenantId)&&String(item.userId)===String(filter.userId))||null,
      updateMany:async(filter,update)=>{let modifiedCount=0;for(const row of rows){if(String(row.tenantId)===String(filter.tenantId)&&String(row.userId)===String(filter.userId)&&row.readAt===null){Object.assign(row,update.$set);modifiedCount++;}}return {modifiedCount};}
    };
  }};
}

test("notification inbox lists only the signed-in tenant and user's notifications",async()=>{
  const user=new ObjectId(),other=new ObjectId(),tenant="tenant-a",thread=new ObjectId(),message=new ObjectId();
  const rows=[{_id:new ObjectId(),tenantId:tenant,userId:user,type:"message",threadId:thread,messageId:message,actorId:other,preview:"Hello",readAt:null,createdAt:new Date()} ,{_id:new ObjectId(),tenantId:tenant,userId:other,type:"message",threadId:thread,messageId:message,actorId:user,preview:"Private",readAt:null,createdAt:new Date()}];
  const res=response();
  await routeNotifications({method:"GET",url:"/api/notifications?limit=20",headers:{host:"localhost"}},res,makeDb(rows),{_id:user,tenantId:tenant},"/api/notifications");
  const body=JSON.parse(res.body);
  assert.equal(res.statusCode,200);
  assert.equal(body.notifications.length,1);
  assert.equal(body.notifications[0].preview,"Hello");
  assert.equal(body.unreadCount,1);
});

test("notification read actions are scoped to owner and tenant",async()=>{
  const user=new ObjectId(),other=new ObjectId(),tenant="tenant-a",id=new ObjectId();
  const rows=[{_id:id,tenantId:tenant,userId:user,readAt:null},{_id:new ObjectId(),tenantId:tenant,userId:other,readAt:null}];
  const res=response();
  await routeNotifications({method:"PATCH",url:"/api/notifications/"+id+"/read",headers:{host:"localhost"}},res,makeDb(rows),{_id:user,tenantId:tenant},"/api/notifications/"+id+"/read");
  assert.equal(res.statusCode,200);
  assert.ok(rows[0].readAt instanceof Date);
  assert.equal(rows[1].readAt,null);
  const all=response();
  await routeNotifications({method:"PATCH",url:"/api/notifications/read-all",headers:{host:"localhost"}},all,makeDb(rows),{_id:user,tenantId:tenant},"/api/notifications/read-all");
  assert.equal(JSON.parse(all.body).updated,0);
});
