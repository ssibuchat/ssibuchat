import { getDb, ensureIndexes } from "./db.js";
import { clearSessionCookie, constantTimeEqual, createSession, currentPrincipal, hashPassword, isSameOrigin, json, readBody, safeText, setSessionCookie, verifyPassword } from "./security.js";
import { ObjectId } from "mongodb";
import { randomBytes } from "node:crypto";
import { hashToken } from "./security.js";
import { decryptMfaSecret, encryptMfaSecret, generateTotpSecret, hashRecoveryCode, provisioningUri, verifyTotp, matchTotpStep, createRecoveryCodes } from "./mfa.js";
import { routeModules } from "./modules.js";
import { routeWorkspaces } from "./workspaces.js";
import { sendTransactionalEmail } from "./email.js";
import { routeLedger } from "./ledger.js";
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
  const user={email,emailNormalized:email,emailVerified:false,username,usernameNormalized:username,displayName:safeText(body.displayName||"SsibuChat Admin",80),passwordHash:await hashPassword(password),role:"admin",accountType:"standard",status:"active",tenantId:"global",schemaVersion:1,createdAt:now(),updatedAt:now()};
  const result=await db.collection("users").insertOne(user); user._id=result.insertedId;
  await db.collection("memberships").updateOne({tenantId:user.tenantId,userId:user._id},{$setOnInsert:{tenantId:user.tenantId,userId:user._id,role:"admin",status:"active",createdAt:now()}},{upsert:true});
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
      const user={email,emailNormalized:email,emailVerified:false,username,usernameNormalized:username,displayName:safeText(b.displayName||username,80),passwordHash:await hashPassword(password),role:"member",accountType:"standard",status:"active",tenantId:"global",schemaVersion:1,createdAt:now(),updatedAt:now()};
      try{const r=await db.collection("users").insertOne(user);user._id=r.insertedId;}catch{return json(res,409,{ok:false,error:"email_or_username_unavailable"});}
      await db.collection("memberships").updateOne({tenantId:user.tenantId,userId:user._id},{$setOnInsert:{tenantId:user.tenantId,userId:user._id,role:"member",status:"active",createdAt:now()}},{upsert:true});
      const token=await createSession(db,user);setSessionCookie(res,token);await audit(db,user,"account.register");
      return json(res,201,{ok:true,user:{id:String(user._id),username,displayName:user.displayName,email:user.email,emailVerified:user.emailVerified===true}});
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
      return json(res,200,{ok:true,user:{id:String(user._id),username:user.username,displayName:user.displayName,email:user.email,emailVerified:user.emailVerified===true,role:user.role}});
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
      return json(res,200,{ok:true,user:{id:String(user._id),username:user.username,displayName:user.displayName,email:user.email,emailVerified:user.emailVerified===true,role:user.role}});
    }
    const p=await getPrincipal(req,db);
    if (path.startsWith("/api/finance/ledger")) {
      if (!p) return json(res,401,{ok:false,error:"sign_in_required"});
      return await routeLedger(req,res,db,p.user,path);
    }
    if (path.startsWith("/api/workspaces/") || path.startsWith("/api/workspace-invites/")) {
      if (!p) return json(res,401,{ok:false,error:"sign_in_required"});
      return await routeWorkspaces(req,res,db,p,path);
    }
    if(path==="/api/account/email/verification/request"&&req.method==="POST"){
      if(!p)return json(res,401,{ok:false,error:"sign_in_required"});
      if(p.user.emailVerified===true)return json(res,200,{ok:true,verified:true});
      if(!p.user.email)return json(res,400,{ok:false,error:"account_email_missing"});
      const throttle=await consumeRateLimit(db,"email-verification",String(p.user._id),3,60*60*1000);
      if(!throttle.allowed){res.setHeader("Retry-After",String(throttle.retryAfterSeconds));return json(res,429,{ok:false,error:"rate_limit_exceeded"});}
      const token=randomBytes(32).toString("base64url"),expiresAt=new Date(Date.now()+24*60*60*1000);
      const created=await db.collection("authTokens").insertOne({tenantId:p.user.tenantId,userId:p.user._id,purpose:"email_verification",tokenHash:hashToken(token),createdAt:now(),expiresAt,usedAt:null});
      const appUrl=process.env.SSIBUCHAT_APP_URL;
      try{
        const sent=await sendTransactionalEmail({to:p.user.email,subject:"Verify your SsibuChat email",text:"Verify your email using this link: "+appUrl+"/?verifyEmail="+encodeURIComponent(token)+"\nThis link expires in 24 hours. If you did not request this, ignore this message."});
        if(!sent.configured){await db.collection("authTokens").deleteOne({_id:created.insertedId});return json(res,503,{ok:false,error:"email_provider_not_configured"});}
      }catch{await db.collection("authTokens").deleteOne({_id:created.insertedId});return json(res,502,{ok:false,error:"email_delivery_failed"});}
      return json(res,202,{ok:true,verificationSent:true});
    }
    if(path==="/api/auth/email/verification/confirm"&&req.method==="POST"){
      const b=await readBody(req),token=String(b.token||"");
      if(token.length<32||token.length>128)return json(res,400,{ok:false,error:"invalid_verification_token"});
      const record=await db.collection("authTokens").findOne({tokenHash:hashToken(token),purpose:"email_verification",usedAt:null,expiresAt:{$gt:now()}});
      if(!record)return json(res,400,{ok:false,error:"invalid_or_expired_verification_token"});
      const claimed=await db.collection("authTokens").updateOne({_id:record._id,usedAt:null,expiresAt:{$gt:now()}},{$set:{usedAt:now()}});
      if(claimed.modifiedCount!==1)return json(res,409,{ok:false,error:"verification_token_already_used"});
      await db.collection("users").updateOne({_id:record.userId,tenantId:record.tenantId},{$set:{emailVerified:true,emailVerifiedAt:now()}});
      await audit(db,{_id:record.userId,tenantId:record.tenantId},"account.email.verify");
      return json(res,200,{ok:true,verified:true});
    }
    if(path==="/api/auth/password-reset/request"&&req.method==="POST"){
      const b=await readBody(req),email=String(b.email||"").trim().toLowerCase();
      const throttle=await consumeRateLimit(db,"password-reset-request",email||String(req.socket?.remoteAddress||"unknown"),3,60*60*1000);
      if(!throttle.allowed){res.setHeader("Retry-After",String(throttle.retryAfterSeconds));return json(res,202,{ok:true,message:"If an eligible account exists, a reset message will be sent."});}
      const user=email?await db.collection("users").findOne({emailNormalized:email,status:"active",emailVerified:true}):null;
      if(user){
        const token=randomBytes(32).toString("base64url"),expiresAt=new Date(Date.now()+30*60*1000);
        const created=await db.collection("authTokens").insertOne({tenantId:user.tenantId,userId:user._id,purpose:"password_reset",tokenHash:hashToken(token),createdAt:now(),expiresAt,usedAt:null});
        try{
          const sent=await sendTransactionalEmail({to:user.email,subject:"Reset your SsibuChat password",text:"Reset your password using this link: "+process.env.SSIBUCHAT_APP_URL+"/?resetPassword="+encodeURIComponent(token)+"\nThis link expires in 30 minutes. If you did not request this, ignore this message."});
          if(!sent.configured)await db.collection("authTokens").deleteOne({_id:created.insertedId});
        }catch{await db.collection("authTokens").deleteOne({_id:created.insertedId});}
      }
      return json(res,202,{ok:true,message:"If an eligible account exists, a reset message will be sent."});
    }
    if(path==="/api/auth/password-reset/confirm"&&req.method==="POST"){
      const b=await readBody(req),token=String(b.token||""),password=String(b.password||"");
      if(token.length<32||token.length>128||password.length<12||password.length>128)return json(res,400,{ok:false,error:"valid_token_and_12_to_128_character_password_required"});
      const record=await db.collection("authTokens").findOne({tokenHash:hashToken(token),purpose:"password_reset",usedAt:null,expiresAt:{$gt:now()}});
      if(!record)return json(res,400,{ok:false,error:"invalid_or_expired_reset_token"});
      const claimed=await db.collection("authTokens").updateOne({_id:record._id,usedAt:null,expiresAt:{$gt:now()}},{$set:{usedAt:now()}});
      if(claimed.modifiedCount!==1)return json(res,409,{ok:false,error:"reset_token_already_used"});
      const passwordHash=await hashPassword(password);
      await db.collection("users").updateOne({_id:record.userId,tenantId:record.tenantId,status:"active"},{$set:{passwordHash,passwordChangedAt:now()}});
      await db.collection("sessions").deleteMany({userId:record.userId});
      await audit(db,{_id:record.userId,tenantId:record.tenantId},"account.password.reset");
      return json(res,200,{ok:true,passwordReset:true,signedOutEverywhere:true});
    }
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
    if (path === "/api/account/sessions" && req.method === "GET") {
      if (!p) return json(res,401,{ok:false,error:"sign_in_required"});
      const rows = await db.collection("sessions").find({userId:p.user._id,expiresAt:{$gt:now()}},{projection:{tokenHash:0}}).sort({createdAt:-1}).limit(20).toArray();
      return json(res,200,{ok:true,sessions:rows.map(session=>({id:String(session._id),createdAt:session.createdAt,expiresAt:session.expiresAt,current:String(session._id)===String(p.session._id)}))});
    }
    if (path === "/api/account/sessions/revoke-others" && req.method === "POST") {
      if (!p) return json(res,401,{ok:false,error:"sign_in_required"});
      const result = await db.collection("sessions").deleteMany({userId:p.user._id,_id:{$ne:p.session._id}});
      await audit(db,p.user,"account.sessions.revoke_others");
      return json(res,200,{ok:true,revoked:result.deletedCount||0});
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
        const user={username,usernameNormalized:username,displayName:safeText(b.displayName||username,80),passwordHash:await hashPassword(password),role:"member",accountType:"tester",status:"active",tenantId:"testers",schemaVersion:1,createdAt:now(),updatedAt:now()};
        try{const r=await db.collection("users").insertOne(user);await db.collection("memberships").updateOne({tenantId:user.tenantId,userId:r.insertedId},{$setOnInsert:{tenantId:user.tenantId,userId:r.insertedId,role:"member",status:"active",createdAt:now()}},{upsert:true});await audit(db,p.user,"tester.create",String(r.insertedId));return json(res,201,{ok:true,id:String(r.insertedId)});}catch{return json(res,409,{ok:false,error:"username_unavailable"});}
      }
      if(path==="/api/admin/testers/access"&&req.method==="PATCH"){
        const b=await readBody(req);if(typeof b.enabled!=="boolean")return json(res,400,{ok:false,error:"enabled_boolean_required"});
        await db.collection("appSettings").updateOne({_id:"tester-access"},{$set:{enabled:b.enabled,updatedAt:now(),updatedBy:p.user._id}},{upsert:true});
        if(!b.enabled)await db.collection("sessions").deleteMany({tenantId:"testers"});
        await audit(db,p.user,b.enabled?"tester-access.enable":"tester-access.disable");return json(res,200,{ok:true,policy:await policy(db)});
      }
    }
    if(path==="/api/search/messages"&&req.method==="GET"){
      if(!p)return json(res,401,{ok:false,error:"sign_in_required"});
      const u=new URL(req.url||"/","http://"+(req.headers?.host||"localhost"));
      const query=safeText(u.searchParams.get("q")||"",80);
      if(query.length<2)return json(res,200,{ok:true,messages:[]});
      const escaped=query.split("").map(char=>[46,42,43,63,94,36,123,125,40,41,124,91,93,92].includes(char.charCodeAt(0))?"\\"+char:char).join("");
      const threads=await db.collection("threads").find({tenantId:p.user.tenantId,participantIds:p.user._id}).project({_id:1}).limit(100).toArray();
      const threadIds=threads.map(thread=>thread._id);
      if(!threadIds.length)return json(res,200,{ok:true,messages:[]});
      const rows=await db.collection("messages").find({tenantId:p.user.tenantId,threadId:{$in:threadIds},text:{$regex:escaped,$options:"i"},deletedAt:{$exists:false}}).sort({createdAt:-1}).limit(30).toArray();
      return json(res,200,{ok:true,messages:rows.map(message=>({id:String(message._id),threadId:String(message.threadId),senderId:String(message.senderId),text:message.text,createdAt:message.createdAt,editedAt:message.editedAt||null}))});
    }
    if(path==="/api/people/blocked"&&req.method==="GET"){
      if(!p)return json(res,401,{ok:false,error:"sign_in_required"});
      const rows=await db.collection("blocks").find({tenantId:p.user.tenantId,userId:p.user._id}).sort({createdAt:-1}).limit(100).toArray();
      const ids=rows.map(row=>row.blockedUserId);
      const users=ids.length?await db.collection("users").find({_id:{$in:ids}},{projection:{passwordHash:0,email:0,emailNormalized:0}}).toArray():[];
      return json(res,200,{ok:true,blocked:rows.map(row=>{const user=users.find(item=>String(item._id)===String(row.blockedUserId));return {userId:String(row.blockedUserId),username:user?.username||null,displayName:user?.displayName||null,createdAt:row.createdAt};})});
    }
    if(path==="/api/people/blocked"&&req.method==="POST"){
      if(!p)return json(res,401,{ok:false,error:"sign_in_required"});
      const b=await readBody(req),username=usernameNorm(b.username);
      const target=await db.collection("users").findOne({tenantId:p.user.tenantId,status:"active",usernameNormalized:username});
      if(!target)return json(res,404,{ok:false,error:"person_not_found"});
      if(String(target._id)===String(p.user._id))return json(res,400,{ok:false,error:"cannot_block_self"});
      try{await db.collection("blocks").insertOne({tenantId:p.user.tenantId,userId:p.user._id,blockedUserId:target._id,createdAt:now()});}
      catch(error){if(error?.code!==11000)throw error;}
      await audit(db,p.user,"people.block",String(target._id));
      return json(res,200,{ok:true,blocked:true});
    }
    const unblockMatch=path.match(/^\/api\/people\/blocked\/([a-f0-9]{24})$/i);
    if(unblockMatch&&req.method==="DELETE"){
      if(!p)return json(res,401,{ok:false,error:"sign_in_required"});
      const result=await db.collection("blocks").deleteOne({tenantId:p.user.tenantId,userId:p.user._id,blockedUserId:new ObjectId(unblockMatch[1])});
      await audit(db,p.user,"people.unblock",unblockMatch[1]);
      return json(res,200,{ok:true,unblocked:(result.deletedCount||0)>0});
    }
    if(path==="/api/reports"&&req.method==="POST"){
      if(!p)return json(res,401,{ok:false,error:"sign_in_required"});
      const throttle=await consumeRateLimit(db,"content-report",String(p.user._id),5,60*60*1000);
      if(!throttle.allowed){res.setHeader("Retry-After",String(throttle.retryAfterSeconds));return json(res,429,{ok:false,error:"rate_limit_exceeded"});}
      const b=await readBody(req),targetType=String(b.targetType||""),targetId=String(b.targetId||""),reason=safeText(b.reason,500),details=safeText(b.details,1000);
      if(!["user","message","group"].includes(targetType)||!ObjectId.isValid(targetId)||!reason)return json(res,400,{ok:false,error:"valid_target_and_reason_required"});
      let target=null;
      if(targetType==="user")target=await db.collection("users").findOne({_id:new ObjectId(targetId),tenantId:p.user.tenantId,status:"active"});
      if(targetType==="message"){
        target=await db.collection("messages").findOne({_id:new ObjectId(targetId),tenantId:p.user.tenantId});
        if(target){const thread=await db.collection("threads").findOne({_id:target.threadId,tenantId:p.user.tenantId,participantIds:p.user._id});if(!thread)target=null;}
      }
      if(targetType==="group")target=await db.collection("threads").findOne({_id:new ObjectId(targetId),tenantId:p.user.tenantId,type:"group",participantIds:p.user._id});
      if(!target)return json(res,404,{ok:false,error:"report_target_not_found"});
      if(targetType==="user"&&String(target._id)===String(p.user._id))return json(res,400,{ok:false,error:"cannot_report_self"});
      const report={tenantId:p.user.tenantId,reporterId:p.user._id,targetType,targetId:new ObjectId(targetId),reason,details,status:"pending",createdAt:now(),updatedAt:now()};
      const created=await db.collection("reports").insertOne(report);
      await audit(db,p.user,"content.report",String(created.insertedId));
      return json(res,201,{ok:true,reportId:String(created.insertedId),status:"pending"});
    }
    if(path==="/api/admin/reports"&&req.method==="GET"){
      if(!p||p.user.role!=="admin")return json(res,403,{ok:false,error:"admin_required"});
      const rows=await db.collection("reports").find({tenantId:p.user.tenantId}).sort({createdAt:-1}).limit(100).toArray();
      return json(res,200,{ok:true,reports:rows.map(row=>({id:String(row._id),reporterId:String(row.reporterId),targetType:row.targetType,targetId:String(row.targetId),reason:row.reason,details:row.details,status:row.status,createdAt:row.createdAt}))});
    }
    const reportReviewMatch=path.match(/^\/api\/admin\/reports\/([a-f0-9]{24})$/i);
    if(reportReviewMatch&&req.method==="PATCH"){
      if(!p||p.user.role!=="admin")return json(res,403,{ok:false,error:"admin_required"});
      const b=await readBody(req),status=b.status;
      if(!["reviewing","resolved","dismissed"].includes(status))return json(res,400,{ok:false,error:"invalid_report_status"});
      const result=await db.collection("reports").updateOne({_id:new ObjectId(reportReviewMatch[1]),tenantId:p.user.tenantId},{$set:{status,reviewedBy:p.user._id,reviewedAt:now(),updatedAt:now()}});
      if(result.matchedCount!==1)return json(res,404,{ok:false,error:"report_not_found"});
      await audit(db,p.user,"content.report.review",reportReviewMatch[1]);
      return json(res,200,{ok:true,status});
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
        const otherId=users[0]._id;
        const blocked=await db.collection("blocks").findOne({tenantId:p.user.tenantId,$or:[{userId:p.user._id,blockedUserId:otherId},{userId:otherId,blockedUserId:p.user._id}]});
        if(blocked)return json(res,403,{ok:false,error:"conversation_blocked"});
      }
      if(type==="direct"){
        const existing=await db.collection("threads").findOne({tenantId:p.user.tenantId,type:"direct",participantIds:{$all:participantIds,$size:2}});
        if(existing)return json(res,200,{ok:true,thread:{id:String(existing._id),title:existing.title,type:existing.type},existing:true});
      }
      const title=safeText(b.title||users.map(u=>u.displayName||u.username).join(", "),120);
      const thread={tenantId:p.user.tenantId,type,title,participantIds,createdBy:p.user._id,adminIds:type==="group"?[p.user._id]:[],createdAt:now(),updatedAt:now(),messageCount:0};
      const result=await db.collection("threads").insertOne(thread);
      await audit(db,p.user,"thread.create",String(result.insertedId));
      return json(res,201,{ok:true,thread:{id:String(result.insertedId),title,type}});
    }
    const groupInvitesMatch=path.match(/^\/api\/threads\/([a-f0-9]{24})\/invites$/i);
    if(groupInvitesMatch){
      if(!p)return json(res,401,{ok:false,error:"sign_in_required"});
      const group=await db.collection("threads").findOne({_id:new ObjectId(groupInvitesMatch[1]),tenantId:p.user.tenantId,participantIds:p.user._id});
      if(!group||group.type!=="group")return json(res,404,{ok:false,error:"group_not_found"});
      const admins=Array.isArray(group.adminIds)&&group.adminIds.length?group.adminIds:[group.createdBy];
      if(!admins.some(id=>String(id)===String(p.user._id)))return json(res,403,{ok:false,error:"group_admin_required"});
      if(req.method==="GET"){
        const invites=await db.collection("groupInvites").find({tenantId:p.user.tenantId,threadId:group._id,revokedAt:null,expiresAt:{$gt:now()}}).sort({createdAt:-1}).limit(50).toArray();
        return json(res,200,{ok:true,invites:invites.map(invite=>({id:String(invite._id),expiresAt:invite.expiresAt,maxUses:invite.maxUses,uses:invite.uses,requiresApproval:invite.requiresApproval,createdAt:invite.createdAt}))});
      }
      if(req.method==="POST"){
        const b=await readBody(req),expiresInHours=Number(b.expiresInHours??24),maxUses=Number(b.maxUses??10);
        if(!Number.isInteger(expiresInHours)||expiresInHours<1||expiresInHours>168||!Number.isInteger(maxUses)||maxUses<1||maxUses>100)return json(res,400,{ok:false,error:"invite_expiry_or_use_limit_invalid"});
        const token=randomBytes(32).toString("base64url");
        const invite={tenantId:p.user.tenantId,threadId:group._id,tokenHash:hashToken(token),createdBy:p.user._id,createdAt:now(),expiresAt:new Date(Date.now()+expiresInHours*3600000),maxUses,uses:0,requiresApproval:b.requiresApproval!==false,revokedAt:null};
        const created=await db.collection("groupInvites").insertOne(invite);
        await audit(db,p.user,"group.invite.create",String(created.insertedId));
        return json(res,201,{ok:true,invite:{id:String(created.insertedId),token,expiresAt:invite.expiresAt,maxUses,requiresApproval:invite.requiresApproval}});
      }
      return json(res,405,{ok:false,error:"method_not_allowed"});
    }
    const groupInviteRevokeMatch=path.match(/^\/api\/threads\/([a-f0-9]{24})\/invites\/([a-f0-9]{24})$/i);
    if(groupInviteRevokeMatch&&req.method==="DELETE"){
      if(!p)return json(res,401,{ok:false,error:"sign_in_required"});
      const group=await db.collection("threads").findOne({_id:new ObjectId(groupInviteRevokeMatch[1]),tenantId:p.user.tenantId,participantIds:p.user._id});
      if(!group||group.type!=="group")return json(res,404,{ok:false,error:"group_not_found"});
      const admins=Array.isArray(group.adminIds)&&group.adminIds.length?group.adminIds:[group.createdBy];
      if(!admins.some(id=>String(id)===String(p.user._id)))return json(res,403,{ok:false,error:"group_admin_required"});
      await db.collection("groupInvites").updateOne({_id:new ObjectId(groupInviteRevokeMatch[2]),tenantId:p.user.tenantId,threadId:group._id,revokedAt:null},{$set:{revokedAt:now(),revokedBy:p.user._id}});
      await audit(db,p.user,"group.invite.revoke",groupInviteRevokeMatch[2]);
      return json(res,200,{ok:true,revoked:true});
    }
    const groupJoinRequestsMatch=path.match(/^\/api\/threads\/([a-f0-9]{24})\/join-requests$/i);
    if(groupJoinRequestsMatch&&req.method==="GET"){
      if(!p)return json(res,401,{ok:false,error:"sign_in_required"});
      const group=await db.collection("threads").findOne({_id:new ObjectId(groupJoinRequestsMatch[1]),tenantId:p.user.tenantId,participantIds:p.user._id});
      if(!group||group.type!=="group")return json(res,404,{ok:false,error:"group_not_found"});
      const admins=Array.isArray(group.adminIds)&&group.adminIds.length?group.adminIds:[group.createdBy];
      if(!admins.some(id=>String(id)===String(p.user._id)))return json(res,403,{ok:false,error:"group_admin_required"});
      const requests=await db.collection("groupJoinRequests").find({tenantId:p.user.tenantId,threadId:group._id,status:"pending"}).sort({createdAt:1}).limit(100).toArray();
      const ids=requests.map(item=>item.userId);
      const users=ids.length?await db.collection("users").find({_id:{$in:ids}},{projection:{passwordHash:0,email:0,emailNormalized:0}}).toArray():[];
      return json(res,200,{ok:true,requests:requests.map(item=>{const user=users.find(row=>String(row._id)===String(item.userId));return {id:String(item._id),userId:String(item.userId),username:user?.username||null,displayName:user?.displayName||null,createdAt:item.createdAt};})});
    }
    const groupJoinDecisionMatch=path.match(/^\/api\/threads\/([a-f0-9]{24})\/join-requests\/([a-f0-9]{24})$/i);
    if(groupJoinDecisionMatch&&req.method==="PATCH"){
      if(!p)return json(res,401,{ok:false,error:"sign_in_required"});
      const group=await db.collection("threads").findOne({_id:new ObjectId(groupJoinDecisionMatch[1]),tenantId:p.user.tenantId,participantIds:p.user._id});
      if(!group||group.type!=="group")return json(res,404,{ok:false,error:"group_not_found"});
      const admins=Array.isArray(group.adminIds)&&group.adminIds.length?group.adminIds:[group.createdBy];
      if(!admins.some(id=>String(id)===String(p.user._id)))return json(res,403,{ok:false,error:"group_admin_required"});
      const b=await readBody(req),decision=b.decision;
      if(!["approve","deny"].includes(decision))return json(res,400,{ok:false,error:"decision_must_be_approve_or_deny"});
      const joinRequest=await db.collection("groupJoinRequests").findOne({_id:new ObjectId(groupJoinDecisionMatch[2]),tenantId:p.user.tenantId,threadId:group._id,status:"pending"});
      if(!joinRequest)return json(res,404,{ok:false,error:"join_request_not_found"});
      if(decision==="approve"){
        const invite=await db.collection("groupInvites").findOne({_id:joinRequest.inviteId,tenantId:p.user.tenantId,threadId:group._id,revokedAt:null,expiresAt:{$gt:now()}});
        if(!invite)return json(res,409,{ok:false,error:"invite_expired_or_revoked"});
        const used=await db.collection("groupInvites").updateOne({_id:invite._id,uses:{$lt:invite.maxUses},revokedAt:null,expiresAt:{$gt:now()}},{$inc:{uses:1}});
        if(used.modifiedCount!==1)return json(res,409,{ok:false,error:"invite_use_limit_reached"});
        await db.collection("threads").updateOne({_id:group._id,tenantId:p.user.tenantId},{$addToSet:{participantIds:joinRequest.userId},$set:{updatedAt:now()}});
      }
      await db.collection("groupJoinRequests").updateOne({_id:joinRequest._id,status:"pending"},{$set:{status:decision==="approve"?"approved":"denied",reviewedAt:now(),reviewedBy:p.user._id}});
      await audit(db,p.user,"group.join_request."+decision,String(joinRequest._id));
      return json(res,200,{ok:true,status:decision==="approve"?"approved":"denied"});
    }
    const groupJoinMatch=path.match(/^\/api\/group-invites\/([A-Za-z0-9_-]{32,})\/join$/);
    if(groupJoinMatch&&req.method==="POST"){
      if(!p)return json(res,401,{ok:false,error:"sign_in_required"});
      const invite=await db.collection("groupInvites").findOne({tokenHash:hashToken(groupJoinMatch[1]),tenantId:p.user.tenantId,revokedAt:null,expiresAt:{$gt:now()}});
      if(!invite)return json(res,404,{ok:false,error:"invite_not_found_or_expired"});
      const group=await db.collection("threads").findOne({_id:invite.threadId,tenantId:p.user.tenantId,type:"group"});
      if(!group)return json(res,404,{ok:false,error:"group_not_found"});
      if(group.participantIds.some(id=>String(id)===String(p.user._id)))return json(res,200,{ok:true,status:"already_member"});
      if(invite.requiresApproval){
        const existing=await db.collection("groupJoinRequests").findOne({tenantId:p.user.tenantId,inviteId:invite._id,userId:p.user._id,status:"pending"});
        if(existing)return json(res,202,{ok:true,status:"pending",requestId:String(existing._id)});
        const request=await db.collection("groupJoinRequests").insertOne({tenantId:p.user.tenantId,threadId:group._id,inviteId:invite._id,userId:p.user._id,status:"pending",createdAt:now()});
        return json(res,202,{ok:true,status:"pending",requestId:String(request.insertedId)});
      }
      const used=await db.collection("groupInvites").updateOne({_id:invite._id,uses:{$lt:invite.maxUses},revokedAt:null,expiresAt:{$gt:now()}},{$inc:{uses:1}});
      if(used.modifiedCount!==1)return json(res,409,{ok:false,error:"invite_use_limit_reached"});
      await db.collection("threads").updateOne({_id:group._id,tenantId:p.user.tenantId},{$addToSet:{participantIds:p.user._id},$set:{updatedAt:now()}});
      await audit(db,p.user,"group.invite.join",String(group._id));
      return json(res,200,{ok:true,status:"joined"});
    }
    const groupMembersMatch=path.match(/^\/api\/threads\/([a-f0-9]{24})\/members$/i);
    if(groupMembersMatch){
      if(!p)return json(res,401,{ok:false,error:"sign_in_required"});
      const group=await db.collection("threads").findOne({_id:new ObjectId(groupMembersMatch[1]),tenantId:p.user.tenantId,participantIds:p.user._id});
      if(!group||group.type!=="group")return json(res,404,{ok:false,error:"group_not_found"});
      const admins=Array.isArray(group.adminIds)&&group.adminIds.length?group.adminIds:[group.createdBy];
      const isAdmin=admins.some(id=>String(id)===String(p.user._id));
      if(req.method==="GET"){
        const members=await db.collection("users").find({_id:{$in:group.participantIds}},{projection:{passwordHash:0,email:0,emailNormalized:0}}).toArray();
        return json(res,200,{ok:true,members:members.map(member=>({id:String(member._id),username:member.username,displayName:member.displayName,admin:admins.some(id=>String(id)===String(member._id))}))});
      }
      if(req.method==="POST"){
        if(!isAdmin)return json(res,403,{ok:false,error:"group_admin_required"});
        const b=await readBody(req),names=Array.isArray(b.usernames)?[...new Set(b.usernames.map(usernameNorm).filter(Boolean))]:[];
        if(!names.length||names.length>20)return json(res,400,{ok:false,error:"one_to_twenty_usernames_required"});
        const candidates=await db.collection("users").find({tenantId:p.user.tenantId,status:"active",usernameNormalized:{$in:names}}).toArray();
        if(candidates.length!==names.length)return json(res,404,{ok:false,error:"one_or_more_people_not_found"});
        const additions=candidates.filter(member=>!group.participantIds.some(id=>String(id)===String(member._id)));
        if(!additions.length)return json(res,200,{ok:true,added:0});
        if(group.participantIds.length+additions.length>50)return json(res,409,{ok:false,error:"group_member_limit_reached"});
        await db.collection("threads").updateOne({_id:group._id,tenantId:p.user.tenantId,type:"group"},{$addToSet:{participantIds:{$each:additions.map(member=>member._id)}},$set:{updatedAt:now()}});
        await audit(db,p.user,"group.members.add",String(group._id));
        return json(res,200,{ok:true,added:additions.length});
      }
      return json(res,405,{ok:false,error:"method_not_allowed"});
    }
    const groupMemberRemoveMatch=path.match(/^\/api\/threads\/([a-f0-9]{24})\/members\/([a-f0-9]{24})$/i);
    if(groupMemberRemoveMatch&&req.method==="DELETE"){
      if(!p)return json(res,401,{ok:false,error:"sign_in_required"});
      const group=await db.collection("threads").findOne({_id:new ObjectId(groupMemberRemoveMatch[1]),tenantId:p.user.tenantId,participantIds:p.user._id});
      if(!group||group.type!=="group")return json(res,404,{ok:false,error:"group_not_found"});
      const targetId=new ObjectId(groupMemberRemoveMatch[2]);
      const admins=Array.isArray(group.adminIds)&&group.adminIds.length?group.adminIds:[group.createdBy];
      const isAdmin=admins.some(id=>String(id)===String(p.user._id));
      const isSelf=String(targetId)===String(p.user._id);
      if(!isSelf&&!isAdmin)return json(res,403,{ok:false,error:"group_admin_required"});
      if(!group.participantIds.some(id=>String(id)===String(targetId)))return json(res,404,{ok:false,error:"group_member_not_found"});
      if(admins.some(id=>String(id)===String(targetId))&&admins.length<=1)return json(res,409,{ok:false,error:"last_group_admin_cannot_leave"});
      await db.collection("threads").updateOne({_id:group._id,tenantId:p.user.tenantId},{$pull:{participantIds:targetId,adminIds:targetId},$set:{updatedAt:now()}});
      await audit(db,p.user,isSelf?"group.leave":"group.member.remove",String(group._id));
      return json(res,200,{ok:true,removed:true});
    }
    const groupAdminPromoteMatch=path.match(/^\/api\/threads\/([a-f0-9]{24})\/admins$/i);
    if(groupAdminPromoteMatch&&req.method==="POST"){
      if(!p)return json(res,401,{ok:false,error:"sign_in_required"});
      const group=await db.collection("threads").findOne({_id:new ObjectId(groupAdminPromoteMatch[1]),tenantId:p.user.tenantId,participantIds:p.user._id});
      if(!group||group.type!=="group")return json(res,404,{ok:false,error:"group_not_found"});
      const admins=Array.isArray(group.adminIds)&&group.adminIds.length?group.adminIds:[group.createdBy];
      if(!admins.some(id=>String(id)===String(p.user._id)))return json(res,403,{ok:false,error:"group_admin_required"});
      const b=await readBody(req),username=usernameNorm(b.username);
      const member=await db.collection("users").findOne({tenantId:p.user.tenantId,status:"active",usernameNormalized:username});
      if(!member||!group.participantIds.some(id=>String(id)===String(member._id)))return json(res,404,{ok:false,error:"group_member_not_found"});
      await db.collection("threads").updateOne({_id:group._id,tenantId:p.user.tenantId},{$addToSet:{adminIds:member._id},$set:{updatedAt:now()}});
      await audit(db,p.user,"group.admin.promote",String(member._id));
      return json(res,200,{ok:true,promoted:true});
    }
    const groupTitleMatch=path.match(/^\/api\/threads\/([a-f0-9]{24})$/i);
    if(groupTitleMatch&&req.method==="PATCH"){
      if(!p)return json(res,401,{ok:false,error:"sign_in_required"});
      const group=await db.collection("threads").findOne({_id:new ObjectId(groupTitleMatch[1]),tenantId:p.user.tenantId,participantIds:p.user._id});
      if(!group||group.type!=="group")return json(res,404,{ok:false,error:"group_not_found"});
      const admins=Array.isArray(group.adminIds)&&group.adminIds.length?group.adminIds:[group.createdBy];
      if(!admins.some(id=>String(id)===String(p.user._id)))return json(res,403,{ok:false,error:"group_admin_required"});
      const b=await readBody(req),title=safeText(b.title,120);
      if(!title)return json(res,400,{ok:false,error:"group_title_required"});
      await db.collection("threads").updateOne({_id:group._id,tenantId:p.user.tenantId},{$set:{title,updatedAt:now()}});
      await audit(db,p.user,"group.title.update",String(group._id));
      return json(res,200,{ok:true,title});
    }
    const threadMessagesMatch=path.match(/^\/api\/threads\/([a-f0-9]{24})\/messages$/i);
    if(threadMessagesMatch&&req.method==="GET"){
      if(!p)return json(res,401,{ok:false,error:"sign_in_required"});
      const thread=await db.collection("threads").findOne({_id:new ObjectId(threadMessagesMatch[1]),tenantId:p.user.tenantId,participantIds:p.user._id});
      if(!thread)return json(res,404,{ok:false,error:"thread_not_found"});
      const rows=await db.collection("messages").find({tenantId:p.user.tenantId,threadId:thread._id}).sort({createdAt:-1}).limit(50).toArray();
      rows.reverse();
      const incomingIds=rows.filter(message=>String(message.senderId)!==String(p.user._id)).map(message=>message._id);
      if(incomingIds.length)await db.collection("messageReceipts").updateMany({tenantId:p.user.tenantId,userId:p.user._id,messageId:{$in:incomingIds},status:"accepted"},{$set:{status:"delivered",deliveredAt:now(),updatedAt:now()}});
      return json(res,200,{ok:true,messages:rows.map(m=>({id:String(m._id),senderId:String(m.senderId),text:m.text,status:m.status,createdAt:m.createdAt}))});
    }
    const threadReadMatch=path.match(/^\/api\/threads\/([a-f0-9]{24})\/read$/i);
    if(threadReadMatch&&req.method==="POST"){
      if(!p)return json(res,401,{ok:false,error:"sign_in_required"});
      const thread=await db.collection("threads").findOne({_id:new ObjectId(threadReadMatch[1]),tenantId:p.user.tenantId,participantIds:p.user._id});
      if(!thread)return json(res,404,{ok:false,error:"thread_not_found"});
      const b=await readBody(req),filter={tenantId:p.user.tenantId,threadId:thread._id,senderId:{$ne:p.user._id}};
      if(b.upToMessageId){if(!ObjectId.isValid(String(b.upToMessageId)))return json(res,400,{ok:false,error:"invalid_message_id"});filter._id={$lte:new ObjectId(String(b.upToMessageId))};}
      const messages=await db.collection("messages").find(filter).sort({createdAt:1}).limit(200).toArray();
      const ids=messages.map(message=>message._id);
      if(!ids.length)return json(res,200,{ok:true,read:0});
      const result=await db.collection("messageReceipts").updateMany({tenantId:p.user.tenantId,userId:p.user._id,messageId:{$in:ids},status:{$ne:"read"}},{$set:{status:"read",readAt:now(),updatedAt:now()}});
      return json(res,200,{ok:true,read:result.modifiedCount||0});
    }
    if(path==="/api/threads"&&req.method==="GET"){
      if(!p)return json(res,401,{ok:false,error:"sign_in_required"});
      const rows=await db.collection("threads").find({tenantId:p.user.tenantId,participantIds:p.user._id}).sort({updatedAt:-1}).limit(50).toArray();
      return json(res,200,{ok:true,threads:rows.map(t=>({id:String(t._id),title:t.title,updatedAt:t.updatedAt,lastMessage:t.lastMessage||null}))});
    }
    const messageMutationMatch=path.match(/^\/api\/messages\/([a-f0-9]{24})$/i);
    if(messageMutationMatch&&(req.method==="PATCH"||req.method==="DELETE")){
      if(!p)return json(res,401,{ok:false,error:"sign_in_required"});
      const message=await db.collection("messages").findOne({_id:new ObjectId(messageMutationMatch[1]),tenantId:p.user.tenantId});
      if(!message||message.deletedAt)return json(res,404,{ok:false,error:"message_not_found"});
      const thread=await db.collection("threads").findOne({_id:message.threadId,tenantId:p.user.tenantId,participantIds:p.user._id});
      if(!thread)return json(res,404,{ok:false,error:"message_not_found"});
      const isSender=String(message.senderId)===String(p.user._id);
      const admins=Array.isArray(thread.adminIds)&&thread.adminIds.length?thread.adminIds:[thread.createdBy];
      const isGroupAdmin=thread.type==="group"&&admins.some(id=>String(id)===String(p.user._id));
      if(req.method==="PATCH"){
        if(!isSender)return json(res,403,{ok:false,error:"message_sender_required"});
        const b=await readBody(req),text=safeText(b.text,4000);
        if(!text)return json(res,400,{ok:false,error:"message_text_required"});
        await db.collection("messages").updateOne({_id:message._id,tenantId:p.user.tenantId,senderId:p.user._id,deletedAt:{$exists:false}},{$set:{text,editedAt:now(),updatedAt:now()}});
        if(String(thread.updatedAt)===String(message.createdAt))await db.collection("threads").updateOne({_id:thread._id,tenantId:p.user.tenantId},{$set:{lastMessage:text.slice(0,160)}});
        await audit(db,p.user,"message.edit",String(message._id));
        return json(res,200,{ok:true,edited:true});
      }
      if(!isSender&&!isGroupAdmin)return json(res,403,{ok:false,error:"message_delete_forbidden"});
      await db.collection("messages").updateOne({_id:message._id,tenantId:p.user.tenantId,deletedAt:{$exists:false}},{$set:{text:"",deletedAt:now(),deletedBy:p.user._id,updatedAt:now()}});
      const latest=await db.collection("messages").find({tenantId:p.user.tenantId,threadId:thread._id,deletedAt:{$exists:false}}).sort({createdAt:-1}).limit(1).toArray();
      await db.collection("threads").updateOne({_id:thread._id,tenantId:p.user.tenantId},{$set:{lastMessage:latest[0]?.text?.slice(0,160)||"Message deleted",updatedAt:now()}});
      await audit(db,p.user,"message.delete",String(message._id));
      return json(res,200,{ok:true,deleted:true});
    }
    const messageReactionMatch=path.match(/^\/api\/messages\/([a-f0-9]{24})\/reactions$/i);
    if(messageReactionMatch){
      if(!p)return json(res,401,{ok:false,error:"sign_in_required"});
      const message=await db.collection("messages").findOne({_id:new ObjectId(messageReactionMatch[1]),tenantId:p.user.tenantId});
      if(!message||message.deletedAt)return json(res,404,{ok:false,error:"message_not_found"});
      const thread=await db.collection("threads").findOne({_id:message.threadId,tenantId:p.user.tenantId,participantIds:p.user._id});
      if(!thread)return json(res,404,{ok:false,error:"message_not_found"});
      if(req.method==="GET"){
        const rows=await db.collection("messageReactions").find({tenantId:p.user.tenantId,messageId:message._id}).toArray();
        return json(res,200,{ok:true,reactions:rows.map(row=>({userId:String(row.userId),emoji:row.emoji}))});
      }
      if(req.method==="POST"){
        const b=await readBody(req),emoji=String(b.emoji||"");
        if(!["👍","❤️","😂","😮","😢","🙏","🔥","🎉"].includes(emoji))return json(res,400,{ok:false,error:"unsupported_reaction"});
        await db.collection("messageReactions").updateOne({tenantId:p.user.tenantId,messageId:message._id,userId:p.user._id,emoji},{$setOnInsert:{tenantId:p.user.tenantId,threadId:thread._id,messageId:message._id,userId:p.user._id,emoji,createdAt:now()}},{upsert:true});
        return json(res,200,{ok:true,reacted:true});
      }
      return json(res,405,{ok:false,error:"method_not_allowed"});
    }
    const messageReactionDeleteMatch=path.match(/^\/api\/messages\/([a-f0-9]{24})\/reactions\/([^/]+)$/i);
    if(messageReactionDeleteMatch&&req.method==="DELETE"){
      if(!p)return json(res,401,{ok:false,error:"sign_in_required"});
      let emoji;try{emoji=decodeURIComponent(messageReactionDeleteMatch[2]);}catch{return json(res,400,{ok:false,error:"invalid_reaction"});}
      const message=await db.collection("messages").findOne({_id:new ObjectId(messageReactionDeleteMatch[1]),tenantId:p.user.tenantId});
      if(!message)return json(res,404,{ok:false,error:"message_not_found"});
      const thread=await db.collection("threads").findOne({_id:message.threadId,tenantId:p.user.tenantId,participantIds:p.user._id});
      if(!thread)return json(res,404,{ok:false,error:"message_not_found"});
      await db.collection("messageReactions").deleteOne({tenantId:p.user.tenantId,messageId:message._id,userId:p.user._id,emoji});
      return json(res,200,{ok:true,removed:true});
    }
    const messageReceiptsMatch=path.match(/^\/api\/messages\/([a-f0-9]{24})\/receipts$/i);
    if(messageReceiptsMatch&&req.method==="GET"){
      if(!p)return json(res,401,{ok:false,error:"sign_in_required"});
      const message=await db.collection("messages").findOne({_id:new ObjectId(messageReceiptsMatch[1]),tenantId:p.user.tenantId,senderId:p.user._id});
      if(!message)return json(res,404,{ok:false,error:"message_not_found"});
      const rows=await db.collection("messageReceipts").find({tenantId:p.user.tenantId,messageId:message._id}).toArray();
      return json(res,200,{ok:true,receipts:rows.map(receipt=>({userId:String(receipt.userId),status:receipt.status,createdAt:receipt.createdAt,deliveredAt:receipt.deliveredAt||null,readAt:receipt.readAt||null}))});
    }
    if(path==="/api/messages"&&req.method==="POST"){
      if(!p)return json(res,401,{ok:false,error:"sign_in_required"});
      const throttle=await consumeRateLimit(db,"message-send",String(p.user._id),60,60*1000);
      if(!throttle.allowed){res.setHeader("Retry-After",String(throttle.retryAfterSeconds));return json(res,429,{ok:false,error:"rate_limit_exceeded"});}
      const b=await readBody(req),threadId=String(b.threadId||""),text=safeText(b.text,4000),key=safeText(b.idempotencyKey,100);
      if(!ObjectId.isValid(threadId)||!text||!key)return json(res,400,{ok:false,error:"thread_text_and_idempotency_key_required"});
      const thread=await db.collection("threads").findOne({_id:new ObjectId(threadId),tenantId:p.user.tenantId,participantIds:p.user._id});
      if(!thread)return json(res,404,{ok:false,error:"thread_not_found"});
      if(thread.type==="direct"){
        const otherId=thread.participantIds.find(id=>String(id)!==String(p.user._id));
        const blocked=await db.collection("blocks").findOne({tenantId:p.user.tenantId,$or:[{userId:p.user._id,blockedUserId:otherId},{userId:otherId,blockedUserId:p.user._id}]});
        if(blocked)return json(res,403,{ok:false,error:"conversation_blocked"});
      }
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
      const recipientIds=thread.participantIds.filter(id=>String(id)!==String(p.user._id));
      for(const recipientId of recipientIds){
        await db.collection("messageReceipts").updateOne(
          {tenantId:p.user.tenantId,messageId:msg._id,userId:recipientId},
          {$setOnInsert:{tenantId:p.user.tenantId,threadId:thread._id,messageId:msg._id,userId:recipientId,status:"accepted",createdAt:msg.createdAt,updatedAt:msg.createdAt}},
          {upsert:true}
        );
      }
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