import { getActiveRuntimeConfig } from "./config-vault.js";

// Read the database-backed config for each send. This makes explicitly activated
// runtime values take effect without a redeployment; environment variables remain
// the bootstrap/fallback source for installations that have not enabled the vault.
export async function getEmailRuntimeConfig(db) {
  const fallback = {
    RESEND_API_KEY: process.env.RESEND_API_KEY || "",
    SSIBUCHAT_EMAIL_FROM: process.env.SSIBUCHAT_EMAIL_FROM || "",
    SSIBUCHAT_APP_URL: process.env.SSIBUCHAT_APP_URL || ""
  };
  if (!db || !process.env.SSIBUCHAT_CONFIG_ENCRYPTION_KEY) return Object.freeze(fallback);
  const active = await getActiveRuntimeConfig(db, process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production" ? "production" : process.env.VERCEL_ENV === "preview" ? "preview" : "development");
  return Object.freeze({ ...fallback, ...active });
}

export async function sendTransactionalEmail({ db, to, subject, text }) {
  const config = await getEmailRuntimeConfig(db);
  const apiKey = config.RESEND_API_KEY;
  const from = config.SSIBUCHAT_EMAIL_FROM;
  if (!apiKey || !from || !config.SSIBUCHAT_APP_URL) return { configured:false };
  const response = await fetch("https://api.resend.com/emails", {
    method:"POST",
    headers:{ "content-type":"application/json", authorization:"Bearer "+apiKey },
    body:JSON.stringify({ from, to:[to], subject, text }),
    signal:AbortSignal.timeout(12_000)
  });
  if (!response.ok) throw new Error("email_provider_error");
  const result = await response.json().catch(()=>({}));
  return { configured:true, id:result.id||null, appUrl:config.SSIBUCHAT_APP_URL };
}
