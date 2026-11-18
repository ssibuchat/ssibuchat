import { getDb, ensureIndexes } from "./db.js";
import { clearSessionCookie, createSession, currentPrincipal, hashPassword, isSameOrigin, json, readBody, safeText, setSessionCookie, verifyPassword } from "./security.js";
import { ObjectId } from "mongodb";
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
  if (!secret || !process.env.SSIBUCHAT_SESSION_SECRET || !body.secret || body.secret !== secret) return json(res, 403, { ok:false, error:"bootstrap_not_authorized" });
  if (await db.collection("users").countDocuments({ role:"admin" })) return json(res, 409, { ok:false, error:"admin_already_bootstrapped" });
  const email=emailNorm(body.email), password=String(body.password||""), username=usernameNorm(body.username || email.split("@")[0]);
  if (!email.includes("@") || password.length<12) return json(res,400,{ok:false,error:"valid_email_and_12_character_password_required"});
  const user={email,emailNormalized:email,username,usernameNormalized:username,displayName:safeText(body.displayName||"SsibuChat Admin",80),passwordHash:await hashPassword(password),role:"admin",accountType:"standard",status:"active",tenantId:"platform",createdAt:now(),updatedAt:now()};
  const result=await db.collection("users").insertOne(user); user._id=result.insertedId;
  const token=await createSession(db,user); setSessionCookie(res,token); await audit(db,user,"admin.bootstrap");
  return json(res,201,{ok:true,user:{id:String(user._id),email:user.email,role:user.role}});
}
export async function route(req,res) {
  res.setHeader("X-Content-Type-Options","nosniff"); res.setHeader("Referrer-Policy","strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy","camera=(self), microphone=(self), geolocation=()");
  const path=new URL(req.url||"/","http://"+(req.headers?.host||"localhost")).pathname.replace(/\/+$/,"")||"/";
  if(req.method==="OPTIONS"){res.setHeader("Allow","GET,POST,PATCH,DELETE,OPTIONS");res.statusCode=204;return res.end();}
  if(req.method!=="GET" && !isSameOrigin(req)) return json(res,403,{ok:false,error:"origin_not_allowed"});
  try {
    const db=await getDb(); await ensureIndexes(db);
    if(path==="/api/health" && req.method==="GET") return json(res,200,{ok:true,product:"ssibuchat",database:"connected",timestamp:now().toISOString()});
    if(path==="/api/auth/bootstrap" && req.method==="POST") return await bootstrap(req,res,db,await readBody(req));
    if(path==="/api/auth/register" && req.method==="POST"){
      const b=await readBody(req), email=emailNorm(b.email), username=usernameNorm(b.username), password=String(b.password||"");
      if(!email.includes("@")||!username||!/^[a-z0-9_.-]{3,32}$/.test(username)||password.length<12) return json(res,400,{ok:false,error:"valid_email_username_and_12_character_password_required"});
      const user={email,emailNormalized:email,username,usernameNormalized:username,displayName:safeText(b.displayName||username,80),passwordHash:await hashPassword(password),role:"member",accountType:"standard",status:"active",tenantId:"personal:"+new ObjectId().toString(),createdAt:now(),updatedAt:now()};
      try{const r=await db.collection("users").insertOne(user);user._id=r.insertedId;}catch{return json(res,409,{ok:false,error:"email_or_username_unavailable"});}
      const token=await createSession(db,user);setSessionCookie(res,token);await audit(db,user,"account.register");
      return json(res,201,{ok:true,user:{id:String(user._id),username,displayName:user.displayName}});
    }
    if(path==="/api/auth/login" && req.method==="POST"){
      const b=await readBody(req), login=safeText(b.login,254).toLowerCase();
      const user=await db.collection("users").findOne({$or:[{emailNormalized:login},{usernameNormalized:usernameNorm(login)}]});
      if(!user||user.status!=="active"||!(await verifyPassword(b.password||"",user.passwordHash))) return json(res,401,{ok:false,error:"invalid_credentials"});
      if(isTester(user)&&!(await policy(db)).enabled) return json(res,403,{ok:false,error:"tester_access_disabled"});
      const token=await createSession(db,user);setSessionCookie(res,token);await audit(db,user,"auth.login");
      return json(res,200,{ok:true,user:{id:String(user._id),username:user.username,displayName:user.displayName,role:user.role}});
    }
    if(path==="/api/auth/logout"&&req.method==="POST"){const p=await currentPrincipal(req,db);if(p)await db.collection("sessions").deleteMany({userId:p.user._id});clearSessionCookie(res);return json(res,200,{ok:true});}
    const p=await getPrincipal(req,db);
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
    if(path==="/api/threads"&&req.method==="GET"){
      if(!p)return json(res,401,{ok:false,error:"sign_in_required"});
      const rows=await db.collection("threads").find({tenantId:p.user.tenantId,participantIds:p.user._id}).sort({updatedAt:-1}).limit(50).toArray();
      return json(res,200,{ok:true,threads:rows.map(t=>({id:String(t._id),title:t.title,updatedAt:t.updatedAt,lastMessage:t.lastMessage||null}))});
    }
    if(path==="/api/messages"&&req.method==="POST"){
      if(!p)return json(res,401,{ok:false,error:"sign_in_required"});
      const b=await readBody(req),threadId=String(b.threadId||""),text=safeText(b.text,4000),key=safeText(b.idempotencyKey,100);
      if(!ObjectId.isValid(threadId)||!text||!key)return json(res,400,{ok:false,error:"thread_text_and_idempotency_key_required"});
      const thread=await db.collection("threads").findOne({_id:new ObjectId(threadId),tenantId:p.user.tenantId,participantIds:p.user._id});
      if(!thread)return json(res,404,{ok:false,error:"thread_not_found"});
      const msg={tenantId:p.user.tenantId,threadId:thread._id,senderId:p.user._id,text,idempotencyKey:key,status:"accepted",createdAt:now()};
      try{const r=await db.collection("messages").insertOne(msg);msg._id=r.insertedId;}catch{const old=await db.collection("messages").findOne({tenantId:p.user.tenantId,idempotencyKey:key});if(old)return json(res,200,{ok:true,message:{id:String(old._id),status:old.status},duplicate:true});throw new Error("message_write_failed");}
      await db.collection("threads").updateOne({_id:thread._id,tenantId:p.user.tenantId},{$set:{lastMessage:text.slice(0,160),updatedAt:msg.createdAt},$inc:{messageCount:1}});
      await db.collection("outboxEvents").insertOne({type:"message.accepted",tenantId:p.user.tenantId,aggregateId:msg._id,createdAt:now(),processedAt:null});
      return json(res,201,{ok:true,message:{id:String(msg._id),status:msg.status,createdAt:msg.createdAt}});
    }
    return json(res,404,{ok:false,error:"not_found"});
  } catch(error){const status=error?.message==="body_too_large"?413:error instanceof SyntaxError?400:503;return json(res,status,{ok:false,error:status===503?"service_unavailable":error.message});}
}