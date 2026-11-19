import { ObjectId } from "mongodb";
import { randomBytes } from "node:crypto";
import { json, readBody, safeText } from "./security.js";
import { consumeRateLimit } from "./rate-limit.js";
import { presignS3, s3StorageConfigured } from "./s3-signing.js";

const now=()=>new Date();
const allowedTypes=new Set(["image/jpeg","image/png","image/webp","image/gif","video/mp4","video/webm","audio/mpeg","audio/ogg","audio/wav","application/pdf"]);
function maxBytes(type){if(type.startsWith("image/"))return 10*1024*1024;if(type.startsWith("video/"))return 100*1024*1024;if(type.startsWith("audio/"))return 50*1024*1024;return 20*1024*1024;}
export async function routeMedia(req,res,db,principal,path){
  if(!path.startsWith("/api/media"))return null;
  if(path==="/api/media/uploads"&&req.method==="POST"){
    if(!s3StorageConfigured())return json(res,503,{ok:false,error:"object_storage_not_configured"});
    const throttle=await consumeRateLimit(db,"media-upload",String(principal._id),20,60*60*1000);
    if(!throttle.allowed){res.setHeader("Retry-After",String(throttle.retryAfterSeconds));return json(res,429,{ok:false,error:"rate_limit_exceeded"});}
    const b=await readBody(req),name=safeText(b.name,160),mimeType=String(b.mimeType||"").toLowerCase(),sizeBytes=Number(b.sizeBytes);
    if(!name||!allowedTypes.has(mimeType)||!Number.isSafeInteger(sizeBytes)||sizeBytes<1||sizeBytes>maxBytes(mimeType))return json(res,400,{ok:false,error:"file_name_type_or_size_invalid"});
    const key=principal.tenantId+"/"+String(principal._id)+"/"+now().toISOString().slice(0,10)+"/"+randomBytes(24).toString("hex");
    const signed=presignS3({method:"PUT",key,contentType:mimeType,expires:600});
    const row={tenantId:principal.tenantId,ownerId:principal._id,name,mimeType,sizeBytes,storageKey:key,visibility:"private",status:"pending_upload",scanStatus:"pending",createdAt:now(),updatedAt:now()};
    const created=await db.collection("mediaAssets").insertOne(row);
    return json(res,201,{ok:true,asset:{id:String(created.insertedId),name,mimeType,sizeBytes,status:row.status},uploadUrl:signed.url,requiredHeaders:signed.headers,expiresIn:signed.expiresIn});
  }
  const complete=path.match(/^\/api\/media\/uploads\/([a-f0-9]{24})\/complete$/i);
  if(complete&&req.method==="POST"){
    const asset=await db.collection("mediaAssets").findOne({_id:new ObjectId(complete[1]),tenantId:principal.tenantId,ownerId:principal._id,status:"pending_upload"});
    if(!asset)return json(res,404,{ok:false,error:"pending_upload_not_found"});
    const head=presignS3({method:"HEAD",key:asset.storageKey,expires:120});
    let response;
    try{response=await fetch(head.url,{method:"HEAD",signal:AbortSignal.timeout(12_000)});}catch{return json(res,502,{ok:false,error:"object_storage_verification_failed"});}
    if(!response.ok)return json(res,409,{ok:false,error:"uploaded_object_not_found"});
    const actualSize=Number(response.headers.get("content-length")||0),actualType=String(response.headers.get("content-type")||"").split(";")[0].toLowerCase();
    if(actualSize!==asset.sizeBytes||actualType!==asset.mimeType){
      await db.collection("mediaAssets").updateOne({_id:asset._id},{$set:{status:"rejected",scanStatus:"rejected",rejectionReason:"object_metadata_mismatch",updatedAt:now()}});
      return json(res,400,{ok:false,error:"uploaded_object_metadata_mismatch"});
    }
    let scanStatus="pending",status="pending_scan";
    if(process.env.SSIBUCHAT_MEDIA_SCAN_URL&&process.env.SSIBUCHAT_MEDIA_SCAN_TOKEN){
      try{
        const scan=await fetch(process.env.SSIBUCHAT_MEDIA_SCAN_URL,{method:"POST",headers:{"content-type":"application/json",authorization:"Bearer "+process.env.SSIBUCHAT_MEDIA_SCAN_TOKEN},body:JSON.stringify({assetId:String(asset._id),storageKey:asset.storageKey,mimeType:asset.mimeType,sizeBytes:asset.sizeBytes}),signal:AbortSignal.timeout(20_000)});
        if(scan.ok){const result=await scan.json();if(result.status==="clean"){scanStatus="clean";status="available";}else if(result.status==="infected"){scanStatus="infected";status="rejected";}else{scanStatus="pending";status="pending_scan";}}
      }catch{}
    }
    await db.collection("mediaAssets").updateOne({_id:asset._id,ownerId:principal._id},{$set:{status,scanStatus,uploadedAt:now(),updatedAt:now()}});
    return json(res,status==="available"?200:202,{ok:true,asset:{id:String(asset._id),status,scanStatus}});
  }
  if(path==="/api/media/assets"&&req.method==="GET"){
    const rows=await db.collection("mediaAssets").find({tenantId:principal.tenantId,ownerId:principal._id,status:{$in:["pending_upload","pending_scan","available","rejected"]}}).sort({createdAt:-1}).limit(100).toArray();
    return json(res,200,{ok:true,assets:rows.map(row=>({id:String(row._id),name:row.name,mimeType:row.mimeType,sizeBytes:row.sizeBytes,status:row.status,scanStatus:row.scanStatus,createdAt:row.createdAt}))});
  }
  const download=path.match(/^\/api\/media\/assets\/([a-f0-9]{24})\/download$/i);
  if(download&&req.method==="GET"){
    const asset=await db.collection("mediaAssets").findOne({_id:new ObjectId(download[1]),tenantId:principal.tenantId,ownerId:principal._id,status:"available",scanStatus:"clean"});
    if(!asset)return json(res,404,{ok:false,error:"media_asset_not_available"});
    const signed=presignS3({method:"GET",key:asset.storageKey,expires:300});
    return json(res,200,{ok:true,url:signed.url,expiresIn:signed.expiresIn});
  }
  const remove=path.match(/^\\/api\\/media\\/assets\\/([a-f0-9]{24})$/i);
  if(remove&&req.method==="DELETE"){
    const asset=await db.collection("mediaAssets").findOne({_id:new ObjectId(remove[1]),tenantId:principal.tenantId,ownerId:principal._id,status:{$ne:"deleted"}});
    if(!asset)return json(res,404,{ok:false,error:"media_asset_not_found"});
    let deleted;
    try{
      const signed=presignS3({method:"DELETE",key:asset.storageKey,expires:300});
      deleted=await fetch(signed.url,{method:"DELETE",signal:AbortSignal.timeout(12_000)});
    }catch{return json(res,502,{ok:false,error:"media_storage_delete_failed"});}
    if(!deleted.ok&&deleted.status!==404)return json(res,502,{ok:false,error:"media_storage_delete_failed"});
    const result=await db.collection("mediaAssets").updateOne({_id:asset._id,tenantId:principal.tenantId,ownerId:principal._id,status:asset.status},{$set:{status:"deleted",deletedAt:now(),updatedAt:now()}});
    if(result.modifiedCount!==1)return json(res,409,{ok:false,error:"media_asset_changed_retry"});
    return json(res,200,{ok:true,deleted:true,assetId:String(asset._id)});
  }
  return json(res,405,{ok:false,error:"method_not_allowed"});
}
