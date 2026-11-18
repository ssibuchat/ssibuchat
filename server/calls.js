import { ObjectId } from "mongodb";
import { json, readBody, safeText } from "./security.js";
import { consumeRateLimit } from "./rate-limit.js";

const now=()=>new Date();
const callProjection=call=>({id:String(call._id),threadId:String(call.threadId),mediaType:call.mediaType,status:call.status,participantIds:call.participantIds.map(String),createdBy:String(call.createdBy),createdAt:call.createdAt,expiresAt:call.expiresAt});
export async function routeCalls(req,res,db,principal,path){
  if(!path.startsWith("/api/calls"))return null;
  if(path==="/api/calls"&&req.method==="GET"){
    const rows=await db.collection("calls").find({tenantId:principal.tenantId,participantIds:principal._id,status:{$in:["ringing","active"]},expiresAt:{$gt:now()}}).sort({createdAt:-1}).limit(20).toArray();
    return json(res,200,{ok:true,calls:rows.map(callProjection)});
  }
  if(path==="/api/calls"&&req.method==="POST"){
    const throttle=await consumeRateLimit(db,"call-create",String(principal._id),10,60*60*1000);
    if(!throttle.allowed){res.setHeader("Retry-After",String(throttle.retryAfterSeconds));return json(res,429,{ok:false,error:"rate_limit_exceeded"});}
    const b=await readBody(req),threadId=String(b.threadId||""),mediaType=b.mediaType;
    if(!ObjectId.isValid(threadId)||!["audio","video"].includes(mediaType))return json(res,400,{ok:false,error:"thread_id_and_audio_or_video_required"});
    const thread=await db.collection("threads").findOne({_id:new ObjectId(threadId),tenantId:principal.tenantId,participantIds:principal._id});
    if(!thread)return json(res,404,{ok:false,error:"thread_not_found"});
    const participantIds=[...new Map((thread.participantIds||[]).map(id=>[String(id),id])).values()];
    if(participantIds.length<2||participantIds.length>8)return json(res,400,{ok:false,error:"calls_require_two_to_eight_participants"});
    const call={tenantId:principal.tenantId,threadId:thread._id,mediaType,status:"ringing",participantIds,createdBy:principal._id,createdAt:now(),updatedAt:now(),expiresAt:new Date(Date.now()+60*60*1000)};
    const created=await db.collection("calls").insertOne(call);
    for(const userId of participantIds)await db.collection("callParticipants").updateOne({tenantId:principal.tenantId,callId:created.insertedId,userId},{$setOnInsert:{tenantId:principal.tenantId,callId:created.insertedId,userId,status:String(userId)===String(principal._id)?"joined":"invited",joinedAt:String(userId)===String(principal._id)?now():null,createdAt:now()}},{upsert:true});
    return json(res,201,{ok:true,call:callProjection({...call,_id:created.insertedId})});
  }
  const match=path.match(/^\/api\/calls\/([a-f0-9]{24})(?:\/(join|leave|end|signal|signals))?$/i);
  if(!match)return null;
  const callId=new ObjectId(match[1]),action=match[2]||"";
  const call=await db.collection("calls").findOne({_id:callId,tenantId:principal.tenantId,participantIds:principal._id});
  if(!call)return json(res,404,{ok:false,error:"call_not_found"});
  if(action==="join"&&req.method==="POST"){
    if(call.status==="ended"||call.expiresAt<=now())return json(res,409,{ok:false,error:"call_ended_or_expired"});
    await db.collection("callParticipants").updateOne({tenantId:principal.tenantId,callId,userId:principal._id},{$set:{status:"joined",joinedAt:now(),leftAt:null},$setOnInsert:{createdAt:now()}},{upsert:true});
    await db.collection("calls").updateOne({_id:callId,status:"ringing"},{$set:{status:"active",updatedAt:now()}});
    return json(res,200,{ok:true,joined:true,callId:String(callId)});
  }
  if(action==="signal"&&req.method==="POST"){
    if(call.status==="ended"||call.expiresAt<=now())return json(res,409,{ok:false,error:"call_ended_or_expired"});
    const throttle=await consumeRateLimit(db,"call-signal",String(principal._id),300,60*60*1000);
    if(!throttle.allowed){res.setHeader("Retry-After",String(throttle.retryAfterSeconds));return json(res,429,{ok:false,error:"rate_limit_exceeded"});}
    const b=await readBody(req),type=b.type,target=b.targetUserId?String(b.targetUserId):null;
    if(!["offer","answer","ice","candidate","hangup"].includes(type))return json(res,400,{ok:false,error:"invalid_signal_type"});
    let payloadText;try{payloadText=JSON.stringify(b.payload??{});}catch{return json(res,400,{ok:false,error:"invalid_signal_payload"});}
    if(payloadText.length>16000)return json(res,413,{ok:false,error:"signal_payload_too_large"});
    const recipients=target?[call.participantIds.find(id=>String(id)===target)]:call.participantIds.filter(id=>String(id)!==String(principal._id));
    if(recipients.some(id=>!id)||!recipients.length)return json(res,400,{ok:false,error:"valid_call_recipient_required"});
    for(const recipientId of recipients)await db.collection("callSignals").insertOne({tenantId:principal.tenantId,callId,senderId:principal._id,recipientId,type,payload:b.payload??{},createdAt:now(),expiresAt:new Date(Date.now()+10*60*1000)});
    return json(res,202,{ok:true,deliveredTo:recipients.length});
  }
  if(action==="signals"&&req.method==="GET"){
    const u=new URL(req.url||"/","http://"+(req.headers?.host||"localhost")),after=u.searchParams.get("after"),afterDate=after?new Date(after):new Date(0);
    if(Number.isNaN(afterDate.getTime()))return json(res,400,{ok:false,error:"invalid_signal_cursor"});
    const rows=await db.collection("callSignals").find({tenantId:principal.tenantId,callId,recipientId:principal._id,createdAt:{$gt:afterDate},expiresAt:{$gt:now()}}).sort({createdAt:1}).limit(100).toArray();
    return json(res,200,{ok:true,signals:rows.map(row=>({id:String(row._id),senderId:String(row.senderId),type:row.type,payload:row.payload,createdAt:row.createdAt}))});
  }
  if((action==="leave"||action==="end")&&req.method==="POST"){
    await db.collection("callParticipants").updateOne({tenantId:principal.tenantId,callId,userId:principal._id},{$set:{status:"left",leftAt:now()}});
    if(action==="end"||String(call.createdBy)===String(principal._id)){
      await db.collection("calls").updateOne({_id:callId,tenantId:principal.tenantId},{$set:{status:"ended",endedAt:now(),updatedAt:now()}});
      return json(res,200,{ok:true,ended:true});
    }
    const active=await db.collection("callParticipants").find({tenantId:principal.tenantId,callId,status:"joined"}).toArray();
    if(!active.length)await db.collection("calls").updateOne({_id:callId,tenantId:principal.tenantId},{$set:{status:"ended",endedAt:now(),updatedAt:now()}});
    return json(res,200,{ok:true,left:true,ended:active.length===0});
  }
  return json(res,405,{ok:false,error:"method_not_allowed"});
}
