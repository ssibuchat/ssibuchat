export async function sendTransactionalEmail({ to, subject, text }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.SSIBUCHAT_EMAIL_FROM;
  if (!apiKey || !from || !process.env.SSIBUCHAT_APP_URL) return { configured:false };
  const response = await fetch("https://api.resend.com/emails", {
    method:"POST",
    headers:{ "content-type":"application/json", authorization:"Bearer "+apiKey },
    body:JSON.stringify({ from, to:[to], subject, text }),
    signal:AbortSignal.timeout(12_000)
  });
  if (!response.ok) throw new Error("email_provider_error");
  const result = await response.json().catch(()=>({}));
  return { configured:true, id:result.id||null };
}
