import test from "node:test";
import assert from "node:assert/strict";
import { ObjectId } from "mongodb";
import { presignS3 } from "../server/s3-signing.js";
import { routeMedia } from "../server/media.js";

process.env.SSIBUCHAT_SESSION_SECRET="test-session-pepper-for-media-integration";
const storageEnv={
  SSIBUCHAT_S3_ENDPOINT:"https://objects.example.test",
  SSIBUCHAT_S3_REGION:"auto",
  SSIBUCHAT_S3_BUCKET:"private-media",
  SSIBUCHAT_S3_ACCESS_KEY_ID:"test-access",
  SSIBUCHAT_S3_SECRET_ACCESS_KEY:"test-secret"
};

function makeDb(){
  const assets=[],limits=new Map();
  const collections={
    mediaAssets:{
      insertOne:async row=>{row._id=new ObjectId();assets.push(row);return {insertedId:row._id};},
      findOne:async filter=>assets.find(row=>(!filter._id||String(row._id)===String(filter._id))&&row.tenantId===filter.tenantId&&String(row.ownerId)===String(filter.ownerId)&&(!filter.status||row.status===filter.status)&&(!filter.scanStatus||row.scanStatus===filter.scanStatus))||null,
      updateOne:async(filter,update)=>{const row=assets.find(item=>String(item._id)===String(filter._id)&&(!filter.ownerId||String(item.ownerId)===String(filter.ownerId))&&(!filter.status||item.status===filter.status));if(!row)return {modifiedCount:0};Object.assign(row,update.$set);return {modifiedCount:1};},
      find:filter=>cursor(assets.filter(row=>row.tenantId===filter.tenantId&&String(row.ownerId)===String(filter.ownerId)&&filter.status.$in.includes(row.status)))
    },
    rateLimits:{findOneAndUpdate:async filter=>{const count=(limits.get(filter.key)||0)+1;limits.set(filter.key,count);return {count};}}
  };
  function cursor(rows){return {sort(){return this;},limit(){return this;},toArray:async()=>rows};}
  return {assets,collection:name=>collections[name]};
}
async function invoke(db,user,method,path,body={}){
  const res={statusCode:200,setHeader(){},end(value){this.body=value;}};
  await routeMedia({method,url:path,headers:{host:"localhost"},body},res,db,user,path);
  return {status:res.statusCode,body:JSON.parse(res.body)};
}

test("S3 SigV4 presigning signs method, object path, content type and expiry",()=>{
  const signed=presignS3({method:"PUT",key:"tenant/user/file.bin",contentType:"image/png",expires:600,env:storageEnv,clock:new Date("2026-11-18T12:34:56.000Z")});
  const url=new URL(signed.url);
  assert.equal(url.hostname,"objects.example.test");
  assert.ok(url.pathname.includes("/private-media/tenant/user/file.bin"));
  assert.equal(url.searchParams.get("X-Amz-Algorithm"),"AWS4-HMAC-SHA256");
  assert.equal(url.searchParams.get("X-Amz-Expires"),"600");
  assert.equal(url.searchParams.get("X-Amz-SignedHeaders"),"content-type;host");
  assert.equal(url.searchParams.get("X-Amz-Signature").length,64);
  assert.equal(signed.headers["Content-Type"],"image/png");
});

test("media uploads remain private until object verification and malware scan pass",async()=>{
  Object.assign(process.env,storageEnv);
  process.env.SSIBUCHAT_MEDIA_SCAN_URL="https://scanner.example.test/scan";
  process.env.SSIBUCHAT_MEDIA_SCAN_TOKEN="scanner-test-token";
  const db=makeDb(),user={_id:new ObjectId(),tenantId:"tenant-1"},originalFetch=globalThis.fetch;
  globalThis.fetch=async(url,options)=>{
    if(options.method==="HEAD")return {ok:true,headers:{get:name=>name==="content-length"?"1024":name==="content-type"?"image/png":null}};
    return {ok:true,json:async()=>({status:"clean"})};
  };
  try{
    const created=await invoke(db,user,"POST","/api/media/uploads",{name:"sample.png",mimeType:"image/png",sizeBytes:1024});
    assert.equal(created.status,201);assert.equal(created.body.asset.status,"pending_upload");
    assert.ok(created.body.uploadUrl.includes("X-Amz-Signature"));
    const id=created.body.asset.id;
    const completed=await invoke(db,user,"POST","/api/media/uploads/"+id+"/complete",{});
    assert.equal(completed.status,200);assert.equal(completed.body.asset.status,"available");
    const download=await invoke(db,user,"GET","/api/media/assets/"+id+"/download");
    assert.equal(download.status,200);assert.ok(download.body.url.includes("X-Amz-Signature"));
    const other=await invoke(db,{_id:new ObjectId(),tenantId:"tenant-1"},"GET","/api/media/assets/"+id+"/download");
    assert.equal(other.status,404);
  }finally{globalThis.fetch=originalFetch;}
});

test("media objects stay unavailable when no malware scanner is configured",async()=>{
  Object.assign(process.env,storageEnv);delete process.env.SSIBUCHAT_MEDIA_SCAN_URL;delete process.env.SSIBUCHAT_MEDIA_SCAN_TOKEN;
  const db=makeDb(),user={_id:new ObjectId(),tenantId:"tenant-1"},originalFetch=globalThis.fetch;
  globalThis.fetch=async()=>({ok:true,headers:{get:name=>name==="content-length"?"512":name==="content-type"?"application/pdf":null}});
  try{
    const created=await invoke(db,user,"POST","/api/media/uploads",{name:"document.pdf",mimeType:"application/pdf",sizeBytes:512});
    const id=created.body.asset.id;
    const completed=await invoke(db,user,"POST","/api/media/uploads/"+id+"/complete",{});
    assert.equal(completed.status,202);assert.equal(completed.body.asset.status,"pending_scan");
    const download=await invoke(db,user,"GET","/api/media/assets/"+id+"/download");
    assert.equal(download.status,404);
  }finally{globalThis.fetch=originalFetch;}
});
