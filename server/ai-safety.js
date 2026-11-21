import { safeText } from "./security.js";

export async function moderateAiText(text, purpose="input") {
  const endpoint=process.env.SSIBUCHAT_AI_MODERATION_URL,token=process.env.SSIBUCHAT_AI_MODERATION_TOKEN;
  if(!endpoint||!token)return {allowed:process.env.SSIBUCHAT_AI_REQUIRE_MODERATION!=="true",status:"not_configured",categories:[]};
  const response=await fetch(endpoint,{method:"POST",headers:{"content-type":"application/json",authorization:"Bearer "+token},body:JSON.stringify({text:safeText(text,16000),purpose}),signal:AbortSignal.timeout(12_000)});
  if(!response.ok)throw new Error("ai_moderation_unavailable");
  const result=await response.json();
  if(typeof result.allowed!=="boolean")throw new Error("ai_moderation_invalid_response");
  return {allowed:result.allowed,status:result.allowed?"passed":"blocked",categories:Array.isArray(result.categories)?result.categories.slice(0,20).map(value=>safeText(value,64)):[]};
}
