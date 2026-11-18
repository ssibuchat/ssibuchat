import { getDb, ensureIndexes } from "./db.js";
import { clearSessionCookie, constantTimeEqual, createSession, currentPrincipal, hashPassword, isSameOrigin, json, readBody, safeText, setSessionCookie, verifyPassword } from "./security.js";
import { ObjectId } from "mongodb";
import { randomBytes } from "node:crypto";
import { hashToken } from "./security.js";
import { decryptMfaSecret, encryptMfaSecret, generateTotpSecret, hashRecoveryCode, provisioningUri, verifyTotp, matchTotpStep, createRecoveryCodes } from "./mfa.js";
import { routeModules } from "./modules.js";
import { consumeRateLimit } from "./rate-limit.js";
const now = () => new Date();
const emailNorm = (v) => safeText(v, 254).toLowerCase();
const usernameNorm = (v) => safeText(v, 32).replace(/^@/, "").toLowerCase();
const isTester = (u) => u && u.accountType === "tester";
async function policy(db) { const d = await db.collection("appSettings").findOne({ _id: "tester-access" }); return { enabled: d?.enabled === true, updatedAt: d?.updatedAt || null }; }
async function audit(db, actor, action, target = null) { await db.collection("auditEvents").insertOne({ tenantId: actor?.tenantId || "platform", actorId: actor?._id || null, action, target, createdAt: now() }); }
async function getPrincipal(req, db) {
  const p = await currentPrincipal(req, db);
  if (p && isTester(p.user) && !(await policy(db)).enabled) { await db.collection("sessions").deleteMany({ userId: p.user._id }); return null; }
  return p;
}
async function bootstrap(req, res, db, body) {
  const secret = process.env.SSIBUCHAT_BOOTSTRAP_SECRET;
  const ip = String(req.headers?.["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").split(",")[0].trim();
  const throttle = await consumeRateLimit(db, "bootstrap", ip, 3, 60 * 60 * 1000);
  if (!throttle.allowed) { res.setHeader("Retry-After", String(throttle.retryAfterSeconds)); return json(res, 429, { ok:false, error:"rate_limit_exceeded" }); }
  if (!secret || !process.env.SSIBUCHAT_SESSION_SECRET || !body.secret || !constantTimeEqual(body.secret, secret)) return json(res, 403, { ok:false, error:"bootstrap_not_authorized" });
  if (await db.collection("users").countDocuments({ role:"admin" })) return json(res, 409, { ok:false, error:"admin_already_bootstrapped" });
  const email=emailNorm(body.email), password=String(body.password||""), username=usernameNorm(body.username || email.split("@")[0]);
  if (!email.includes("@") || password.length<12) return json(res,400,{ok:false,error:"valid_email_and_12_character_password_required"});
  const user={email,emailNormalized:email,username,usernameNormalized:username,displayName:safeText(body.displayName||"SsibuChat Admin",80),passwordHash:await hashPassword(password),role:"admin",accountType:"standard",status:"active",tenantId:"global",createdAt:now(),updatedAt:now()};
  const result=await db.collection("users").insertOne(user); user._id=result.insertedId;
  const token=await createSession(db,user); setSessionCookie(res,token); await audit(db,user,"admin.bootstrap");
  return json(res,201,{ok:true,user:{id:String(user._id),email:user.email,role:user.role}});
}
export async function route(req,res,database = null) {
  res.setHeader("X-Content-Type-Options","nosniff"); res.setHeader("Referrer-Policy","strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy","camera=(self), microphone=(self), geolocation=()");
  const path=new URL(req.url||"/","http://"+(req.headers?.host||"localhost")).pathname.replace(/\/+$/,"")||"/";
  if(req.method==="OPTIONS"){res.setHeader("Allow","GET,POST,PATCH,DELETE,OPTIONS");res.statusCode=204;return res.end();}
  if(req.method!=="GET" && !isSameOrigin(req)) return json(res,403,{ok:false,error:"origin_not_allowed"});
  if((process.env.VERCEL || process.env.NODE_ENV === "production") && !process.env.SSIBUCHAT_SESSION_SECRET) return json(res,503,{ok:false,error:"session_secret_not_configured"});
  try {
    const db=database || await getDb(); if (!database) await ensureIndexes(db);
    if(path==="/api/health" && req.method==="GET") return json(res,200,{ok:true,product:"ssibuchat",database:"connected",timestamp:now().toISOString()});
    if(path==="/api/auth/bootstrap" && req.method==="POST") return await bootstrap(req,res,db,await readBody(req));
    if(path==="/api/auth/register" && req.method==="POST"){
      const b=await readBody(req), email=emailNorm(b.email), username=usernameNorm(b.username), password=String(b.password||"");
      const ip = String(req.headers?.["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").split(",")[0].trim();
      const throttle = await consumeRateLimit(db, "register", ip, 8, 60 * 60 * 1000);
      if (!throttle.allowed) { res.setHeader("Retry-After", String(throttle.retryAfterSeconds)); return json(res, 429, { ok:false, error:"rate_limit_exceeded" }); }
      if(!email.includes("@")||!username||!/^[a-z0-9_.-]{3,32}$/.test(username)||password.length<12) return json(res,400,{ok:false,error:"valid_email_username_and_12_character_password_required"});
      const user={email,emailNormalized:email,username,usernameNormalized:username,displayName:safeText(b.displayName||username,80),passwordHash:await hashPassword(password),role:"member",accountType:"standard",status:"active",tenantId:"global",createdAt:now(),updatedAt:now()};
      try{const r=await db.collection("users").insertOne(user);user._id=r.insertedId;}catch{return json(res,409,{ok:false,error:"email_or_username_unavailable"});}
      const token=await createSession(db,user);setSessionCookie(res,token);await audit(db,user,"account.register");
      return json(res,201,{ok:true,user:{id:String(user._id),username,displayName:user.displayName}});
    }
    if(path==="/api/auth/login" && req.method==="POST"){
      const b=await readBody(req), login=safeText(b.login,254).toLowerCase();
      const ip = String(req.headers?.["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").split(",")[0].trim();
      const throttle = await consumeRateLimit(db, "login", login + "|" + ip, 10, 15 * 60 * 1000);
      if (!throttle.allowed) { res.setHeader("Retry-After", String(throttle.retryAfterSeconds)); return json(res, 429, { ok:false, error:"rate_limit_exceeded" }); }
      const user=await db.collection("users").findOne({$or:[{emailNormalized:login},{usernameNormalized:usernameNorm(login)}]});
      if(!user||user.status!=="active"||!(await verifyPassword(b.password||"",user.passwordHash))) return json(res,401,{ok:false,error:"invalid_credentials"});
      if(isTester(user)&&!(await policy(db)).enabled) return json(res,403,{ok:false,error:"tester_access_disabled"});
      if (user.mfaEnabled === true) {
        const challengeToken = randomBytes(32).toString("base64url");
        await db.collection("mfaChallenges").insertOne({ tokenHash: hashToken(challengeToken), userId: user._id, createdAt: now(), expiresAt: new Date(Date.now() + 5 * 60 * 1000), usedAt: null });
        await audit(db, user, "auth.mfa.challenge");
        return json(res, 202, { ok: true, mfaRequired: true, challengeToken, expiresInSeconds: 300 });
      }
      const token=await createSession(db,user);setSessionCookie(res,token);await audit(db,user,"auth.login");
      return json(res,200,{ok:true,user:{id:String(user._id),username:user.username,displayName:user.displayName,role:user.role}});
    }
    if(path==="/api/auth/logout"&&req.method==="POST"){const p=await currentPrincipal(req,db);if(p)await db.collection("sessions").deleteOne({_id:p.session._id});clearSessionCookie(res);return json(res,200,{ok:true});}
    if (path === "/api/auth/mfa/verify" && req.method === "POST") {
      const b = await readBody(req);
      const challengeToken = String(b.challengeToken || "");
      const code = String(b.code || "").trim();
      if (!challengeToken || !code) return json(res, 400, { ok:false, error:"challenge_and_code_required" });
      const challenge = await db.collection("mfaChallenges").findOne({ tokenHash:hashToken(challengeToken), expiresAt:{$gt:now()}, usedAt:null });
      if (!challenge) return json(res, 401, { ok:false, error:"invalid_or_expired_mfa_challenge" });
      const throttle = await consumeRateLimit(db, "mfa-verify", String(challenge.userId), 5, 5 * 60 * 1000);
      if (!throttle.allowed) { res.setHeader("Retry-After", String(throttle.retryAfterSeconds)); return json(res, 429, { ok:false, error:"rate_limit_exceeded" }); }
      const user = await db.collection("users").findOne({ _id:challenge.userId, status:"active", mfaEnabled:true });
      if (!user) return json(res, 401, { ok:false, error:"invalid_or_expired_mfa_challenge" });
      let valid = false, recoveryHash = null, matchedStep = null;
      try { matchedStep = matchTotpStep(decryptMfaSecret(user.mfaSecretEncrypted), code); valid = matchedStep !== null; } catch { valid = false; }
      if (!valid) {
        recoveryHash = hashRecoveryCode(code);
        valid = Array.isArray(user.recoveryCodeHashes) && user.recoveryCodeHashes.includes(recoveryHash);
      }
      if (!valid) return json(res, 401, { ok:false, error:"invalid_mfa_code" });
      const claimed = await db.collection("mfaChallenges").updateOne({ _id:challenge._id, usedAt:null, expiresAt:{$gt:now()} }, { $set:{ usedAt:now() } });
      if (claimed.modifiedCount !== 1) return json(res, 409, { ok:false, error:"mfa_challenge_already_used" });
      if (matchedStep !== null) {
        const advanced = await db.collection("users").updateOne({ _id:user._id, $or:[{lastMfaTotpStep:{$exists:false}},{lastMfaTotpStep:{$lt:matchedStep}}] }, { $set:{ lastMfaTotpStep:matchedStep } });
        if (advanced.modifiedCount !== 1) return json(res, 401, { ok:false, error:"mfa_code_already_used" });
      }
      if (recoveryHash) {
        const consumed = await db.collection("users").updateOne({ _id:user._id, recoveryCodeHashes:recoveryHash }, { $pull:{ recoveryCodeHashes:recoveryHash } });
        if (consumed.modifiedCount !== 1) return json(res, 401, { ok:false, error:"invalid_mfa_code" });
      }
      const token = await createSession(db,user); setSessionCookie(res,token); await audit(db,user,"auth.mfa.success");
      return json(res,200,{ok:true,user:{id:String(user._id),username:user.username,displayName:user.displayName,role:user.role}});
    }
    const p=await getPrincipal(req,db);
    if (path === "/api/account/mfa" && req.method === "GET") {
      if (!p) return json(res,401,{ok:false,error:"sign_in_required"});
      return json(res,200,{ok:true,enabled:p.user.mfaEnabled===true,recoveryCodesRemaining:Array.isArray(p.user.recoveryCodeHashes)?p.user.recoveryCodeHashes.length:0});
    }
    if (path === "/api/account/mfa/setup" && req.method === "POST") {
      if (!p) return json(res,401,{ok:false,error:"sign_in_required"});
      if (p.user.mfaEnabled) return json(res,409,{ok:false,error:"mfa_already_enabled"});
      const secret = generateTotpSecret();
      const encrypted = encryptMfaSecret(secret);
      const expiresAt = new Date(Date.now()+10*60*1000);
      await db.collection("users").updateOne({_id:p.user._id},{$set:{mfaPendingSecretEncrypted:encrypted,mfaPendingExpiresAt:expiresAt}});
      await audit(db,p.user,"account.mfa.setup.started");
      return json(res,200,{ok:true,secret,otpauthUrl:provisioningUri(secret,p.user.email||p.user.username),expiresAt});
    }
    if (path === "/api/account/mfa/confirm" && req.method === "POST") {
      if (!p) return json(res,401,{ok:false,error:"sign_in_required"});
      if (p.user.mfaEnabled) return json(res,409,{ok:false,error:"mfa_already_enabled"});
      const b = await readBody(req);
      if (!p.user.mfaPendingSecretEncrypted || !p.user.mfaPendingExpiresAt || p.user.mfaPendingExpiresAt <= now()) return json(res,409,{ok:false,error:"mfa_setup_expired"});
      let secret;
      try { secret = decryptMfaSecret(p.user.mfaPendingSecretEncrypted); } catch { return json(res,503,{ok:false,error:"mfa_configuration_unavailable"}); }
      const matchedStep = matchTotpStep(secret,b.code);
      if (matchedStep === null) return json(res,400,{ok:false,error:"invalid_mfa_code"});
      const recoveryCodes = createRecoveryCodes();
      const enabled = await db.collection("users").updateOne({_id:p.user._id,mfaEnabled:{$ne:true}},{$set:{mfaEnabled:true,mfaSecretEncrypted:p.user.mfaPendingSecretEncrypted,recoveryCodeHashes:recoveryCodes.map(hashRecoveryCode),mfaEnabledAt:now(),lastMfaTotpStep:matchedStep},$unset:{mfaPendingSecretEncrypted:"",mfaPendingExpiresAt:""}});
      if (enabled.modifiedCount !== 1) return json(res,409,{ok:false,error:"mfa_state_changed"});
      await audit(db,p.user,"account.mfa.enabled");
      return json(res,200,{ok:true,enabled:true,recoveryCodes});
    }
    if (path === "/api/account/mfa/disable" && req.method === "POST") {
      if (!p) return json(res,401,{ok:false,error:"sign_in_required"});
      const b = await readBody(req);
      let valid = false;
      try { valid = verifyTotp(decryptMfaSecret(p.user.mfaSecretEncrypted),b.code); } catch { valid = false; }
      if (!valid) return json(res,401,{ok:false,error:"invalid_mfa_code"});
      const credentialUser = await db.collection("users").findOne({_id:p.user._id},{projection:{passwordHash:1}});
      if (!credentialUser || !(await verifyPassword(b.password||"",credentialUser.passwordHash))) return json(res,401,{ok:false,error:"invalid_credentials"});
      await db.collection("users").updateOne({_id:p.user._id},{$unset:{mfaEnabled:"",mfaSecretEncrypted:"",recoveryCodeHashes:"",mfaEnabledAt:"",mfaPendingSecretEncrypted:"",mfaPendingExpiresAt:""}});
      await db.collection("sessions").deleteMany({userId:p.user._id});
      clearSessionCookie(res);
      await audit(db,p.user,"account.mfa.disabled");
      return json(res,200,{ok:true,enabled:false});
    }
    if (path === "/api/workspace/preferences" || path === "/api/ai/consent" || path === "/api/ai/chat" || path.startsWith("/api/modules/")) {
      if (!p) return json(res, 401, { ok: false, error: "sign_in_required" });
      await routeModules(req, res, db, p.user, path);
      return;
    }
    if(path==="/api/auth/me"&&req.method==="GET") return json(res,200,{ok:true,user:p?{id:String(p.user._id),username:p.user.username,displayName:p.user.displayName,role:p.user.role,accountType:p.user.accountType}:null});
    if(path.startsWith("/api/admin/")){
      if(!p||p.user.role!=="admin")return json(res,403,{ok:false,error:"admin_required"});
      if(path==="/api/admin/testers"&&req.method==="GET"){const rows=await db.collection("users").find({accountType:"tester"},{projection:{passwordHash:0}}).toArray();return json(res,200,{ok:true,policy:await policy(db),testers:rows.map(u=>({id:String(u._id),username:u.username,displayName:u.displayName,status:u.status}))});}
      if(path==="/api/admin/testers"&&req.method==="POST"){
        const b=await readBody(req),username=usernameNorm(b.username),password=String(b.password||"");
        if(!/^[a-z0-9_.-]{3,32}$/.test(username)||password.length<12)return json(res,400,{ok:false,error:"valid_username_and_12_character_password_required"});
        const user={username,usernameNormalized:username,displayName:safeText(b.displayName||username,80),passwordHash:await hashPassword(password),role:"member",accountType:"tester",status:"active",tenantId:"testers",createdAt:now(),updatedAt:now()};
        try{const r=await db.collection("users").insertOne(user);await audit(db,p.user,"tester.create",String(r.insertedId));return json(res,201,{ok:true,id:String(r.insertedId)});}catch{return json(res,409,{ok:false,error:"username_unavailable"});}
      }
      if(path==="/api/admin/testers/access"&&req.method==="PATCH"){
        const b=await readBody(req);if(typeof b.enabled!=="boolean")return json(res,400,{ok:false,error:"enabled_boolean_required"});
        await db.collection("appSettings").updateOne({_id:"tester-access"},{$set:{enabled:b.enabled,updatedAt:now(),updatedBy:p.user._id}},{upsert:true});
        if(!b.enabled)await db.collection("sessions").deleteMany({tenantId:"testers"});
        await audit(db,p.user,b.enabled?"tester-access.enable":"tester-access.disable");return json(res,200,{ok:true,policy:await policy(db)});
      }
    }
    if(path==="/api/people"&&req.method==="GET"){
      if(!p)return json(res,401,{ok:false,error:"sign_in_required"});
      const u=new URL(req.url||"/","http://"+(req.headers?.host||"localhost"));
      const q=safeText(u.searchParams.get("q")||"",32).toLowerCase().replace(/[^a-z0-9]/g,"");
      if(q.length<2)return json(res,200,{ok:true,people:[]});
      const rows=await db.collection("users").find({tenantId:p.user.tenantId,status:"active",discoverable:{$ne:false},_id:{$ne:p.user._id},usernameNormalized:{$regex:"^"+q}},{projection:{passwordHash:0,email:0,emailNormalized:0}}).limit(12).toArray();
      return json(res,200,{ok:true,people:rows.map(u=>({id:String(u._id),username:u.username,displayName:u.displayName}))});
    }
    if(path==="/api/threads"&&req.method==="POST"){
      if(!p)return json(res,401,{ok:false,error:"sign_in_required"});
      const throttle=await consumeRateLimit(db,"thread-create",String(p.user._id),10,60*60*1000);
      if(!throttle.allowed){res.setHeader("Retry-After",String(throttle.retryAfterSeconds));return json(res,429,{ok:false,error:"rate_limit_exceeded"});}
      const b=await readBody(req),names=Array.isArray(b.participants)?b.participants.map(usernameNorm).filter(Boolean):[];
      const normalized=[...new Set(names)].filter(n=>n!==p.user.usernameNormalized);
      if(!normalized.length||normalized.length>19)return json(res,400,{ok:false,error:"one_to_nineteen_other_participants_required"});
      const users=await db.collection("users").find({tenantId:p.user.tenantId,status:"active",usernameNormalized:{$in:normalized}}).toArray();
      if(users.length!==normalized.length)return json(res,404,{ok:false,error:"one_or_more_people_not_found"});
      const participantIds=[p.user._id,...users.map(u=>u._id)];
      const type=participantIds.length===2?"direct":"group";
      if(type==="direct"){
        const existing=await db.collection("threads").findOne({tenantId:p.user.tenantId,type:"direct",participantIds:{$all:participantIds,$size:2}});
        if(existing)return json(res,200,{ok:true,thread:{id:String(existing._id),title:existing.title,type:existing.type},existing:true});
      }
      const title=safeText(b.title||users.map(u=>u.displayName||u.username).join(", "),120);
      const thread={tenantId:p.user.tenantId,type,title,participantIds,createdBy:p.user._id,createdAt:now(),updatedAt:now(),messageCount:0};
      const result=await db.collection("threads").insertOne(thread);
      await audit(db,p.user,"thread.create",String(result.insertedId));
      return json(res,201,{ok:true,thread:{id:String(result.insertedId),title,type}});
    }
    const threadMessagesMatch=path.match(/^\/api\/threads\/([a-f0-9]{24})\/messages$/i);
    if(threadMessagesMatch&&req.method==="GET"){
      if(!p)return json(res,401,{ok:false,error:"sign_in_required"});
      const thread=await db.collection("threads").findOne({_id:new ObjectId(threadMessagesMatch[1]),tenantId:p.user.tenantId,participantIds:p.user._id});
      if(!thread)return json(res,404,{ok:false,error:"thread_not_found"});
      const rows=await db.collection("messages").find({tenantId:p.user.tenantId,threadId:thread._id}).sort({createdAt:-1}).limit(50).toArray();
      rows.reverse();
      return json(res,200,{ok:true,messages:rows.map(m=>({id:String(m._id),senderId:String(m.senderId),text:m.text,status:m.status,createdAt:m.createdAt}))});
    }
    if(path==="/api/threads"&&req.method==="GET"){
      if(!p)return json(res,401,{ok:false,error:"sign_in_required"});
      const rows=await db.collection("threads").find({tenantId:p.user.tenantId,participantIds:p.user._id}).sort({updatedAt:-1}).limit(50).toArray();
      return json(res,200,{ok:true,threads:rows.map(t=>({id:String(t._id),title:t.title,updatedAt:t.updatedAt,lastMessage:t.lastMessage||null}))});
    }
    if(path==="/api/messages"&&req.method==="POST"){
      if(!p)return json(res,401,{ok:false,error:"sign_in_required"});
      const throttle=await consumeRateLimit(db,"message-send",String(p.user._id),60,60*1000);
      if(!throttle.allowed){res.setHeader("Retry-After",String(throttle.retryAfterSeconds));return json(res,429,{ok:false,error:"rate_limit_exceeded"});}
      const b=await readBody(req),threadId=String(b.threadId||""),text=safeText(b.text,4000),key=safeText(b.idempotencyKey,100);
      if(!ObjectId.isValid(threadId)||!text||!key)return json(res,400,{ok:false,error:"thread_text_and_idempotency_key_required"});
      const thread=await db.collection("threads").findOne({_id:new ObjectId(threadId),tenantId:p.user.tenantId,participantIds:p.user._id});
      if(!thread)return json(res,404,{ok:false,error:"thread_not_found"});
      let created = true;
      const msg={tenantId:p.user.tenantId,threadId:thread._id,senderId:p.user._id,text,idempotencyKey:key,status:"accepted",createdAt:now()};
      try {
        const inserted = await db.collection("messages").insertOne(msg);
        msg._id = inserted.insertedId;
      } catch (error) {
        if (error?.code !== 11000) throw error;
        const existing = await db.collection("messages").findOne({ tenantId:p.user.tenantId, senderId:p.user._id, idempotencyKey:key });
        if (!existing) throw error;
        if (!existing.threadId.equals(thread._id) || existing.text !== text) return json(res,409,{ok:false,error:"idempotency_key_conflict"});
        Object.assign(msg, existing);
        created = false;
      }
      const threadUpdate = { $set: { lastMessage: msg.text.slice(0,160), updatedAt: msg.createdAt } };
      if (created) threadUpdate.$inc = { messageCount: 1 };
      else threadUpdate.$set.messageCount = await db.collection("messages").countDocuments({ tenantId:p.user.tenantId, threadId:thread._id });
      await db.collection("threads").updateOne({ _id:thread._id, tenantId:p.user.tenantId, participantIds:p.user._id }, threadUpdate);
      await db.collection("outboxEvents").updateOne(
        { tenantId:p.user.tenantId, type:"message.accepted", aggregateId:msg._id },
        { $setOnInsert: { type:"message.accepted", tenantId:p.user.tenantId, aggregateId:msg._id, createdAt:msg.createdAt, processedAt:null } },
        { upsert:true }
      );
      return json(res,created?201:200,{ok:true,message:{id:String(msg._id),status:msg.status,createdAt:msg.createdAt},duplicate:!created});
    }
    return json(res,404,{ok:false,error:"not_found"});
  } catch(error){const status=error?.message==="body_too_large"?413:error instanceof SyntaxError?400:503;return json(res,status,{ok:false,error:status===503?"service_unavailable":error.message});}
}