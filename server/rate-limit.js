import { createHmac } from "node:crypto";

export async function consumeRateLimit(db, scope, identity, limit, windowMs) {
  const secret = process.env.SSIBUCHAT_SESSION_SECRET;
  if (!secret) throw new Error("session_secret_not_configured");
  const window = Math.floor(Date.now() / windowMs);
  const digest = createHmac("sha256", secret).update(String(identity)).digest("hex");
  const key = scope + ":" + digest + ":" + window;
  const now = new Date();
  const expiresAt = new Date((window + 2) * windowMs);
  const result = await db.collection("rateLimits").findOneAndUpdate(
    { key },
    { $inc: { count: 1 }, $setOnInsert: { key, scope, createdAt: now, expiresAt } },
    { upsert: true, returnDocument: "after" }
  );
  const count = result?.count ?? result?.value?.count ?? limit + 1;
  return { allowed: count <= limit, remaining: Math.max(0, limit - count), retryAfterSeconds: Math.max(1, Math.ceil((expiresAt.getTime() - now.getTime()) / 1000)) };
}
