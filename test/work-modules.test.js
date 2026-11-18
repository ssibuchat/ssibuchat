import test from "node:test";
import assert from "node:assert/strict";
import { ObjectId } from "mongodb";
import { routeModules } from "../server/modules.js";

process.env.SSIBUCHAT_SESSION_SECRET="test-session-pepper-for-work-module-integration";

function makeDb(){
  const ownerId=new ObjectId(),editorId=new ObjectId(),viewerId=new ObjectId(),workspaceId=new ObjectId();
  const workspace={_id:workspaceId,tenantId:"tenant-1",ownerId,name:"Shared"};
  const memberships=[
    {tenantId:"tenant-1",workspaceId,userId:ownerId,role:"owner",status:"active"},
    {tenantId:"tenant-1",workspaceId,userId:editorId,role:"editor",status:"active"},
    {tenantId:"tenant-1",workspaceId,userId:viewerId,role:"viewer",status:"active"}
  ];
  const projects=[],events=[],limits=new Map();
  const collections={
    workspaces:{findOne:async filter=>String(filter._id)===String(workspaceId)&&filter.tenantId==="tenant-1"?workspace:null},
    workspaceMembers:{
      findOne:async filter=>memberships.find(row=>String(row.workspaceId)===String(filter.workspaceId)&&String(row.userId)===String(filter.userId)&&row.status==="active")||null,
      find:filter=>cursor(memberships.filter(row=>row.tenantId===filter.tenantId&&String(row.userId)===String(filter.userId)&&row.status==="active"))
    },
    projects:{
      find:filter=>cursor(projects.filter(row=>row.tenantId===filter.tenantId&&filter.$or.some(cond=>cond.ownerId?String(row.ownerId)===String(cond.ownerId):cond.workspaceId.$in.some(id=>String(id)===String(row.workspaceId))))),
      insertOne:async row=>{row._id=new ObjectId();projects.push(row);return {insertedId:row._id};},
      findOne:async filter=>projects.find(row=>String(row._id)===String(filter._id)&&row.tenantId===filter.tenantId)||null,
      findOneAndUpdate:async(filter,update)=>{const row=projects.find(item=>String(item._id)===String(filter._id)&&item.tenantId===filter.tenantId);if(!row)return null;Object.assign(row,update.$set);return row;},
      deleteOne:async()=>({deletedCount:0})
    },
    workspaceActivity:{insertOne:async row=>{events.push(row);return {insertedId:new ObjectId()};}},
    rateLimits:{findOneAndUpdate:async filter=>{const count=(limits.get(filter.key)||0)+1;limits.set(filter.key,count);return {count};}}
  };
  function cursor(rows){return {sort(){return this;},limit(){return this;},toArray:async()=>rows};}
  return {ownerId,editorId,viewerId,workspaceId,projects,events,collection:name=>collections[name]};
}
async function invoke(db,user,method,path,body={}){
  const res={statusCode:200,setHeader(){},end(value){this.body=value;}};
  await routeModules({method,url:path,body},res,db,{_id:user,tenantId:"tenant-1"},path);
  return {status:res.statusCode,body:JSON.parse(res.body)};
}

test("workspace editors can create and update shared projects; viewers can only read",async()=>{
  const db=makeDb();
  const created=await invoke(db,db.editorId,"POST","/api/modules/projects",{workspaceId:String(db.workspaceId),name:"Launch",status:"active"});
  assert.equal(created.status,201);
  const projectId=created.body.item.id;
  assert.equal(db.events[0].type,"work.project.create");
  const listed=await invoke(db,db.viewerId,"GET","/api/modules/projects");
  assert.equal(listed.status,200);
  assert.equal(listed.body.items.length,1);
  const denied=await invoke(db,db.viewerId,"PATCH","/api/modules/projects/"+projectId,{name:"Blocked"});
  assert.equal(denied.status,403);
  const updated=await invoke(db,db.editorId,"PATCH","/api/modules/projects/"+projectId,{name:"Launch v2"});
  assert.equal(updated.status,200);
  assert.equal(updated.body.item.name,"Launch v2");
  assert.equal(db.events.some(event=>event.type==="work.project.update"),true);
});
