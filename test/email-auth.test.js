import test from "node:test";
import assert from "node:assert/strict";
import { ObjectId } from "mongodb";
import { randomBytes } from "node:crypto";
import { route } from "../server/router.js";
import { hashPassword, hashToken, verifyPassword } from "../server/security.js";

process.env.SSIBUCHAT_SESSION_SECRET="test-session-pepper-for-email-auth";
process.env.RESEND_API_KEY="test-resend-key";
process.env.SSIBUCHAT_EMAIL_FROM="SsibuChat <security@example.test>";
process.env.SSIBUCHAT_APP_URL="https://chat.example.test";

function makeDb(){
  const user={_id:new ObjectId(),tenantId:"tenant-1",username:"tester",usernameNormalized:"tester",email:"tester@example.test",emailNormalized:"tester@example.test",emailVerified:false,status:"active",role:"member",passwordHash:"old-password-hash"};
  const sessionToken=randomBytes(32).toString("base64url");
  const sessions=[{_id:new ObjectId(),tokenHash:hashToken(sessionToken),userId:user._id,tenantId:user.tenantId,expiresAt:new Date(Date.now()+3600000)}];
  const tokens=[],audits=[],counters=new Map();
  const collections={
    sessions:{
      findOne:async filter=>sessions.find(row=>row.tokenHash===filter.tokenHash&&row.expiresAt>filter.expiresAt.$gt)||null,
      deleteMany:async filter=>{const before=sessions.length;for(let i=sessions.length-1;i>=0;i--)if(String(sessions[i].userId)===String(filter.userId))sessions.splice(i,1);return {deletedCount:before-sessions.length};}
    },
    users:{
      findOne:async filter=>(!filter._id||String(filter._id)===String(user._id))&&(!filter.emailNormalized||filter.emailNormalized===user.emailNormalized)&&(!filter.status||filter.status===user.status)?user:null,
      updateOne:async(filter,update)=>{if(String(filter._id)!==String(user._id))return {matchedCount:0};Object.assign(user,update.$set);return {matchedCount:1};}
    },
    authTokens:{
      insertOne:async row=>{row._id=new ObjectId();tokens.push(row);return {insertedId:row._id};},
      findOne:async filter=>tokens.find(row=>row.tokenHash===filter.tokenHash&&row.purpose===filter.purpose&&row.usedAt===null&&row.expiresAt>filter.expiresAt.$gt)||null,
      updateOne:async(filter,update)=>{const row=tokens.find(item=>String(item._id)===String(filter._id)&&item.usedAt===null&&item.expiresAt>filter.expiresAt.$gt);if(!row)return {modifiedCount:0};Object.assign(row,update.$set);return {modifiedCount:1};},
      deleteOne:async filter=>{const index=tokens.findIndex(row=>String(row._id)===String(filter._id));if(index<0)return {deletedCount:0};tokens.splice(index,1);return {deletedCount:1};}
    },
    rateLimits:{findOneAndUpdate:async filter=>{const count=(counters.get(filter.key)||0)+1;counters.set(filter.key,count);return {count};}},
    auditEvents:{insertOne:async row=>{audits.push(row);return {insertedId:new ObjectId()};}}
  };
  return {user,sessionToken,sessions,tokens,audits,collection:name=>collections[name]};
}
async function invoke(db,token,method,path,body={}){
  const res={statusCode:200,headers:{},setHeader(name,value){this.headers[name]=value;},end(value){this.body=value;}};
  const headers={host:"localhost",origin:"http://localhost"};
  if(token)headers.cookie="ssibu_session="+encodeURIComponent(token);
  await route({method,url:path,headers,socket:{},body},res,db);
  return {status:res.statusCode,body:JSON.parse(res.body)};
}

test("email verification and password recovery tokens are emailed, single-use and revoke sessions",async()=>{
  const db=makeDb(),originalFetch=globalThis.fetch,emails=[];
  globalThis.fetch=async(url,options)=>{emails.push(JSON.parse(options.body));return {ok:true,json:async()=>({id:"email-test"})};};
  try{
    const requestVerification=await invoke(db,db.sessionToken,"POST","/api/account/email/verification/request",{});
    assert.equal(requestVerification.status,202);
    assert.equal(emails.length,1);
    const verifyUrl=emails[0].text.match(/verifyEmail=([^\s]+)/)?.[1];
    const verifyToken=decodeURIComponent(verifyUrl);
    const verified=await invoke(db,null,"POST","/api/auth/email/verification/confirm",{token:verifyToken});
    assert.equal(verified.status,200);
    assert.equal(db.user.emailVerified,true);
    const replay=await invoke(db,null,"POST","/api/auth/email/verification/confirm",{token:verifyToken});
    assert.equal(replay.status,400);

    const resetRequest=await invoke(db,null,"POST","/api/auth/password-reset/request",{email:db.user.email});
    assert.equal(resetRequest.status,202);
    assert.equal(emails.length,2);
    const resetUrl=emails[1].text.match(/resetPassword=([^\s]+)/)?.[1];
    const resetToken=decodeURIComponent(resetUrl);
    const reset=await invoke(db,null,"POST","/api/auth/password-reset/confirm",{token:resetToken,password:"A-new-strong-password-2026"});
    assert.equal(reset.status,200);
    assert.equal(reset.body.signedOutEverywhere,true);
    assert.equal(reset.body.securityNoticeSent,true);
    assert.equal(emails.length,3);
    assert.match(emails[2].subject,/password was reset/i);
    assert.equal(db.sessions.length,0);
    assert.equal(await verifyPassword("A-new-strong-password-2026",db.user.passwordHash),true);
    const resetReplay=await invoke(db,null,"POST","/api/auth/password-reset/confirm",{token:resetToken,password:"Another-new-password-2026"});
    assert.equal(resetReplay.status,400);
  }finally{globalThis.fetch=originalFetch;}
});


test("authenticated password change verifies the current password, revokes sessions and sends a security notice",async()=>{
  const db=makeDb(),originalFetch=globalThis.fetch,emails=[];
  db.user.emailVerified=true;
  db.user.passwordHash=await hashPassword("old-current-password");
  globalThis.fetch=async(url,options)=>{emails.push(JSON.parse(options.body));return {ok:true,json:async()=>({id:"security-notice-test"})};};
  try{
    const rejected=await invoke(db,db.sessionToken,"POST","/api/account/password/change",{currentPassword:"wrong-password",newPassword:"a-new-secure-password"});
    assert.equal(rejected.status,401);
    assert.equal(rejected.body.error,"current_password_incorrect");
    assert.equal(db.sessions.length,1);
    const changed=await invoke(db,db.sessionToken,"POST","/api/account/password/change",{currentPassword:"old-current-password",newPassword:"a-new-secure-password"});
    assert.equal(changed.status,200);
    assert.equal(changed.body.passwordChanged,true);
    assert.equal(changed.body.signedOutEverywhere,true);
    assert.equal(changed.body.securityNoticeSent,true);
    assert.equal(db.sessions.length,0);
    assert.equal(await verifyPassword("a-new-secure-password",db.user.passwordHash),true);
    assert.equal(await verifyPassword("old-current-password",db.user.passwordHash),false);
    assert.equal(emails.length,1);
    assert.match(emails[0].subject,/password was changed/i);
    assert.ok(db.audits.some(event=>event.action==="account.password.change"));
  }finally{globalThis.fetch=originalFetch;}
});

test("password change rejects short and unchanged passwords without revoking the session",async()=>{
  const db=makeDb();
  db.user.passwordHash=await hashPassword("old-current-password");
  const short=await invoke(db,db.sessionToken,"POST","/api/account/password/change",{currentPassword:"old-current-password",newPassword:"short"});
  assert.equal(short.status,400);
  const same=await invoke(db,db.sessionToken,"POST","/api/account/password/change",{currentPassword:"old-current-password",newPassword:"old-current-password"});
  assert.equal(same.status,400);
  assert.equal(db.sessions.length,1);
});


test("email change requires the current password, verifies the new address and alerts the old address",async()=>{
  const db=makeDb(),originalFetch=globalThis.fetch,emails=[];
  db.user.emailVerified=true;
  db.user.passwordHash=await hashPassword("old-current-password");
  globalThis.fetch=async(url,options)=>{emails.push(JSON.parse(options.body));return {ok:true,json:async()=>({id:"email-change-test"})};};
  try{
    const rejected=await invoke(db,db.sessionToken,"POST","/api/account/email/change/request",{newEmail:"new-address@example.test",currentPassword:"wrong-password"});
    assert.equal(rejected.status,401);
    const requested=await invoke(db,db.sessionToken,"POST","/api/account/email/change/request",{newEmail:"new-address@example.test",currentPassword:"old-current-password"});
    assert.equal(requested.status,202);
    assert.equal(emails.length,1);
    assert.equal(emails[0].to[0],"new-address@example.test");
    const tokenText=emails[0].text.match(/confirmEmailChange=([^\s]+)/)?.[1];
    const token=decodeURIComponent(tokenText);
    const confirmed=await invoke(db,null,"POST","/api/auth/email/change/confirm",{token});
    assert.equal(confirmed.status,200,JSON.stringify(confirmed.body));
    assert.equal(confirmed.body.emailChanged,true);
    assert.equal(confirmed.body.email,"new-address@example.test");
    assert.equal(confirmed.body.previousEmailNoticeSent,true);
    assert.equal(db.user.email,"new-address@example.test");
    assert.equal(db.user.emailVerified,true);
    assert.equal(emails.length,2);
    assert.equal(emails[1].to[0],"tester@example.test");
    assert.ok(db.audits.some(event=>event.action==="account.email.change"));
    const replay=await invoke(db,null,"POST","/api/auth/email/change/confirm",{token});
    assert.equal(replay.status,400);
  }finally{globalThis.fetch=originalFetch;}
});

