import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { route } from "../server/router.js";
import { hashToken } from "../server/security.js";

process.env.SSIBUCHAT_SESSION_SECRET="test-admin-audit-session-secret";

function fixture(role="admin"){
  const user={_id:"admin-user",tenantId:"tenant-a",role,status:"active",accountType:"standard"};
  const token=randomBytes(32).toString("base64url");
  const sessions=[{_id:"session-a",tokenHash:hashToken(token),userId:user._id,tenantId:user.tenantId,expiresAt:new Date(Date.now()+60000)}];
  const events=[
    {_id:"event-1",tenantId:"tenant-a",actorId:user._id,action:"account.login",target:null,createdAt:new Date("2026-11-18T00:00:00Z"),passwordHash:"must-not-leak"},
    {_id:"event-2",tenantId:"tenant-b",actorId:"other",action:"secret.other_tenant",target:"x",createdAt:new Date("2026-11-18T00:00:01Z")}
  ];
  let query=null,limit=null;
  const collections={
    sessions:{findOne:async filter=>sessions.find(row=>row.tokenHash===filter.tokenHash&&row.expiresAt>filter.expiresAt.$gt)||null},
    users:{findOne:async filter=>String(filter._id)===String(user._id)?user:null},
    appSettings:{findOne:async()=>null},
    auditEvents:{find(filter){query=filter;return {sort(spec){assert.deepEqual(spec,{createdAt:-1,_id:-1});return this;},limit(value){limit=value;return this;},async toArray(){return events.filter(row=>row.tenantId===filter.tenantId).slice(0,limit);}};}}
  };
  return {user,token,events,collection:name=>collections[name],get query(){return query;},get limit(){return limit;}};
}
async function invoke(db,token,limit="50"){
  const res={statusCode:200,setHeader(){},end(body){this.body=body;}};
  await route({method:"GET",url:"/api/admin/audit?limit="+limit,headers:{host:"localhost",cookie:"ssibu_session="+encodeURIComponent(token)},socket:{}},res,db);
  return {status:res.statusCode,body:JSON.parse(res.body)};
}

test("admin audit API is tenant-scoped, bounded and omits unapproved document fields",async()=>{
  const db=fixture();
  const result=await invoke(db,db.token,"500");
  assert.equal(result.status,200);
  assert.equal(db.query.tenantId,"tenant-a");
  assert.equal(db.limit,100);
  assert.equal(result.body.events.length,1);
  assert.equal(result.body.events[0].action,"account.login");
  assert.equal(result.body.events[0].passwordHash,undefined);
  assert.equal(result.body.events[0].id,"event-1");
});

test("non-admin accounts cannot read the administrative audit log",async()=>{
  const db=fixture("member");
  const result=await invoke(db,db.token,"10");
  assert.equal(result.status,403);
});
