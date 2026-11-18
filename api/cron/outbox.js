import { getDb, ensureIndexes } from "../../server/db.js";
import { constantTimeEqual, json } from "../../server/security.js";
import { processOutboxBatch } from "../../server/outbox-worker.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return json(res, 405, { ok:false, error:"method_not_allowed" });
  const secret = process.env.CRON_SECRET;
  if (!secret || !constantTimeEqual(req.headers?.authorization || "", "Bearer " + secret)) {
    return json(res, 401, { ok:false, error:"unauthorized" });
  }
  try {
    const db = await getDb();
    await ensureIndexes(db);
    const result = await processOutboxBatch(db, { limit: 50 });
    return json(res, 200, { ok:true, ...result });
  } catch {
    return json(res, 503, { ok:false, error:"worker_unavailable" });
  }
}
