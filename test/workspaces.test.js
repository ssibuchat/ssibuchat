import test from "node:test";
import assert from "node:assert/strict";
import { ObjectId } from "mongodb";
import { routeWorkspaces } from "../server/workspaces.js";

process.env.SSIBUCHAT_SESSION_SECRET = "test-session-pepper-for-workspace-integration";

function makeDb() {
  const owner={_id:new ObjectId(),username:"owner",usernameNormalized:"owner",displayName:"Owner"};
  const editor={_id:new ObjectId(),username:"editor",usernameNormalized:"editor",displayName:"Editor"};
  const viewer={_id:new ObjectId(),username:"viewer",usernameNormalized:"viewer",displayName:"Viewer"};
  const workspace={_id:new ObjectId(),tenantId:"tenant-1",ownerId:owner._id,name:"Shared workspace"};
  const members=[{tenantId:"tenant-1",workspaceId:workspace._id,userId:owner._id,role:"owner",status:"active",createdAt:new Date()}];
  const invites=[],documents=[],revisions=[],events=[],limits=new Map();
  const collections={
    workspaces:{findOne:async filter=>String(filter._id)===String(workspace._id)&&filter.tenantId==="tenant-1"?workspace:null},
    workspaceMembers:{
      findOne:async filter=>members.find(row=>String(row.workspaceId)===String(filter.workspaceId)&&String(row.userId)===String(filter.userId)&&row.status==="active")||null,
      updateOne:async(filter,update,options)=>{let row=members.find(item=>String(item.workspaceId)===String(filter.workspaceId)&&String(item.userId)===String(filter.userId));if(!row&&options?.upsert){row={...update.$setOnInsert};members.push(row);}if(row&&update.$set)Object.assign(row,update.$set);return {upsertedCount:row?1:0,matchedCount:row?1:0};},
      find:filter=>cursor(members.filter(row=>row.tenantId===filter.tenantId&&String(row.workspaceId)===String(filter.workspaceId)&&row.status===filter.status)),
      deleteOne:async filter=>{const index=members.findIndex(row=>String(row.workspaceId)===String(filter.workspaceId)&&String(row.userId)===String(filter.userId)&&row.role!== "owner");if(index<0)return {deletedCount:0};members.splice(index,1);return {deletedCount:1};}
    },
    users:{
      findOne:async filter=>[owner,editor,viewer].find(user=>(!filter._id||String(user._id)===String(filter._id))&&(!filter.usernameNormalized||user.usernameNormalized===filter.usernameNormalized))||null,
      find:filter=>cursor([owner,editor,viewer].filter(user=>filter._id?.$in?.some(id=>String(id)===String(user._id))))
    },
    workspaceInvites:{
      insertOne:async row=>{row._id=new ObjectId();invites.push(row);return {insertedId:row._id};},
      findOne:async filter=>invites.find(row=>row.tokenHash===filter.tokenHash&&String(row.inviteeId)===String(filter.inviteeId)&&row.status===filter.status&&row.expiresAt>filter.expiresAt.$gt)||null,
      updateOne:async(filter,update)=>{const row=invites.find(item=>String(item._id)===String(filter._id)&&item.status===filter.status);if(!row)return {matchedCount:0};Object.assign(row,update.$set);return {matchedCount:1};}
    },
    workspaceDocuments:{
      insertOne:async row=>{row._id=new ObjectId();documents.push(row);return {insertedId:row._id};},
      find:filter=>cursor(documents.filter(row=>row.tenantId===filter.tenantId&&String(row.workspaceId)===String(filter.workspaceId)&&!row.deletedAt)),
      findOne:async filter=>documents.find(row=>String(row._id)===String(filter._id)&&row.tenantId===filter.tenantId&&String(row.workspaceId)===String(filter.workspaceId)&&!row.deletedAt)||null,
      updateOne:async(filter,update)=>{const row=documents.find(item=>String(item._id)===String(filter._id)&&item.version===filter.version&&!item.deletedAt);if(!row)return {modifiedCount:0};Object.assign(row,update.$set);return {modifiedCount:1};}
    },
    workspaceDocumentRevisions:{
      insertOne:async row=>{revisions.push(row);return {insertedId:new ObjectId()};},
      find:filter=>cursor(revisions.filter(row=>row.tenantId===filter.tenantId&&String(row.workspaceId)===String(filter.workspaceId)&&String(row.documentId)===String(filter.documentId)))
    },
    workspaceActivity:{
      insertOne:async row=>{row._id=new ObjectId();events.push(row);return {insertedId:row._id};},
      find:filter=>cursor(events.filter(row=>row.tenantId===filter.tenantId&&String(row.workspaceId)===String(filter.workspaceId)))
    },
    rateLimits:{findOneAndUpdate:async filter=>{const count=(limits.get(filter.key)||0)+1;limits.set(filter.key,count);return {count};}}
  };
  function cursor(rows){return {sort(spec){const [field,direction]=Object.entries(spec)[0]||[];if(field)rows.sort((a,b)=>(a[field]>b[field]?1:a[field]<b[field]?-1:0)*direction);return this;},limit(){return this;},toArray:async()=>rows};}
  return {owner,editor,viewer,workspace,members,invites,documents,revisions,events,collection:name=>collections[name]};
}
async function invoke(db,principal,method,path,body={}) {
  const headers={},res={statusCode:200,setHeader(name,value){headers[name]=value;},end(value){this.body=value;}};
  await routeWorkspaces({method,url:path,headers:{host:"localhost"},body},res,db,principal,path);
  return {status:res.statusCode,body:JSON.parse(res.body)};
}

test("workspace owner invites an existing user and the intended user accepts",async()=>{
  const db=makeDb(),owner={...db.owner,tenantId:"tenant-1"},editor={...db.editor,tenantId:"tenant-1"};
  const invite=await invoke(db,owner,"POST","/api/workspaces/"+db.workspace._id+"/invites",{username:"editor",role:"editor"});
  assert.equal(invite.status,201);
  assert.ok(invite.body.invite.token);
  const accepted=await invoke(db,editor,"POST","/api/workspace-invites/"+invite.body.invite.token+"/accept");
  assert.equal(accepted.status,200);
  assert.equal(db.members.some(row=>String(row.userId)===String(editor._id)&&row.role==="editor"),true);
  const listed=await invoke(db,owner,"GET","/api/workspaces/"+db.workspace._id+"/members");
  assert.equal(listed.status,200);
  assert.equal(listed.body.members.length,2);
});

test("shared documents enforce roles and optimistic version checks while retaining revisions",async()=>{
  const db=makeDb(),owner={...db.owner,tenantId:"tenant-1"},editor={...db.editor,tenantId:"tenant-1"},viewer={...db.viewer,tenantId:"tenant-1"};
  db.members.push({tenantId:"tenant-1",workspaceId:db.workspace._id,userId:editor._id,role:"editor",status:"active",createdAt:new Date()});
  db.members.push({tenantId:"tenant-1",workspaceId:db.workspace._id,userId:viewer._id,role:"viewer",status:"active",createdAt:new Date()});
  const created=await invoke(db,editor,"POST","/api/workspaces/"+db.workspace._id+"/documents",{title:"Project brief",content:"First draft"});
  assert.equal(created.status,201);
  const id=created.body.document.id;
  const denied=await invoke(db,viewer,"PATCH","/api/workspaces/"+db.workspace._id+"/documents/"+id,{expectedVersion:1,title:"Blocked",content:"No edit"});
  assert.equal(denied.status,403);
  const updated=await invoke(db,editor,"PATCH","/api/workspaces/"+db.workspace._id+"/documents/"+id,{expectedVersion:1,title:"Project brief",content:"Revised draft"});
  assert.equal(updated.status,200);
  assert.equal(updated.body.document.version,2);
  const conflict=await invoke(db,editor,"PATCH","/api/workspaces/"+db.workspace._id+"/documents/"+id,{expectedVersion:1,title:"Stale",content:"Stale edit"});
  assert.equal(conflict.status,409);
  const history=await invoke(db,viewer,"GET","/api/workspaces/"+db.workspace._id+"/documents/"+id+"/revisions");
  assert.equal(history.status,200);
  assert.deepEqual(history.body.revisions.map(row=>row.version),[2,1]);
  const feed=await invoke(db,viewer,"GET","/api/workspaces/"+db.workspace._id+"/activity");
  assert.equal(feed.status,200);
  assert.ok(feed.body.events.some(event=>event.type==="workspace.document.update"));
});
