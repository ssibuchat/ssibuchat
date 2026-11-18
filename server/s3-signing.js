import { createHash, createHmac } from "node:crypto";

const sha256=value=>createHash("sha256").update(value).digest("hex");
const hmac=(key,value)=>createHmac("sha256",key).update(value).digest();
const awsEncode=value=>encodeURIComponent(String(value)).replace(/[!'()*]/g,char=>"%"+char.charCodeAt(0).toString(16).toUpperCase());
function queryString(values){
  return Object.entries(values).map(([key,value])=>[awsEncode(key),awsEncode(value)]).sort((a,b)=>a[0].localeCompare(b[0])).map(([key,value])=>key+"="+value).join("&");
}
export function s3StorageConfigured(env=process.env){
  return Boolean(env.SSIBUCHAT_S3_ENDPOINT&&env.SSIBUCHAT_S3_BUCKET&&env.SSIBUCHAT_S3_ACCESS_KEY_ID&&env.SSIBUCHAT_S3_SECRET_ACCESS_KEY&&/^https:\/\//i.test(env.SSIBUCHAT_S3_ENDPOINT));
}
export function presignS3({method="GET",key,contentType,expires=600,env=process.env,clock=new Date()}){
  if(!s3StorageConfigured(env))throw new Error("s3_storage_not_configured");
  if(!["GET","PUT","HEAD","DELETE"].includes(method)||!key||!Number.isInteger(expires)||expires<1||expires>3600)throw new Error("invalid_presign_arguments");
  const endpoint=new URL(env.SSIBUCHAT_S3_ENDPOINT);
  if(endpoint.username||endpoint.password||endpoint.search||endpoint.hash)throw new Error("invalid_s3_endpoint");
  const region=env.SSIBUCHAT_S3_REGION||"auto",bucket=env.SSIBUCHAT_S3_BUCKET;
  const date=clock.toISOString().replace(/[:-]|\.\d{3}/g,""),day=date.slice(0,8),scope=day+"/"+region+"/s3/aws4_request";
  const pathParts=[...endpoint.pathname.split("/").filter(Boolean),bucket,...String(key).split("/")];
  const canonicalUri="/"+pathParts.map(awsEncode).join("/");
  const signedHeaders=method==="PUT"&&contentType?"content-type;host":"host";
  const params={"X-Amz-Algorithm":"AWS4-HMAC-SHA256","X-Amz-Credential":env.SSIBUCHAT_S3_ACCESS_KEY_ID+"/"+scope,"X-Amz-Date":date,"X-Amz-Expires":String(expires),"X-Amz-SignedHeaders":signedHeaders};
  if(env.SSIBUCHAT_S3_SESSION_TOKEN)params["X-Amz-Security-Token"]=env.SSIBUCHAT_S3_SESSION_TOKEN;
  const canonicalQuery=queryString(params);
  const canonicalHeaders=(method==="PUT"&&contentType?"content-type:"+contentType.trim()+"\n":"")+"host:"+endpoint.host+"\n";
  const canonicalRequest=[method,canonicalUri,canonicalQuery,canonicalHeaders,signedHeaders,"UNSIGNED-PAYLOAD"].join("\n");
  const stringToSign=["AWS4-HMAC-SHA256",date,scope,sha256(canonicalRequest)].join("\n");
  const dateKey=hmac("AWS4"+env.SSIBUCHAT_S3_SECRET_ACCESS_KEY,day);
  const regionKey=hmac(dateKey,region),serviceKey=hmac(regionKey,"s3"),signingKey=hmac(serviceKey,"aws4_request");
  const signature=createHmac("sha256",signingKey).update(stringToSign).digest("hex");
  return {url:endpoint.origin+canonicalUri+"?"+canonicalQuery+"&X-Amz-Signature="+signature,headers:method==="PUT"&&contentType?{"Content-Type":contentType}:{},expiresIn:expires};
}
