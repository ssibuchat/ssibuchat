import { getDb, ensureIndexes } from "../../server/db.js";
import { constantTimeEqual, json } from "../../server/security.js";
import { processOutboxBatch } from "../../server/outbox-worker.js";

export default async function handler(req, res, database = null) {
  if (req.method !== "GET") return json(res, 405, { ok:false, error:"method_not_allowed" });
  const secret = process.env.CRON_SECRET;
  if (!secret || !constantTimeEqual(req.headers?.authorization || "", "Bearer " + secret)) {
    return json(res, 401, { ok:false, error:"unauthorized" });
  }
  try {
    const query = new URL(req.url || "/", "http://" + (req.headers?.host || "localhost")).searchParams;
    const rawLimit = query.get("limit");
    const requestedLimit = rawLimit !== null && /^\\d+$/.test(rawLimit) ? Number(rawLimit) : 50;
    const limit = Math.max(1, Math.min(100, requestedLimit));
    const db = database || await getDb();
    if (!database) await ensureIndexes(db);
    const result = await processOutboxBatch(db, { limit });
    return json(res, 200, { ok:true, ...result });
  } catch {
    return json(res, 503, { ok:false, error:"worker_unavailable" });
  }
}
