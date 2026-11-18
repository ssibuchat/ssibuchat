import { randomBytes } from "node:crypto";
import { safeText } from "./security.js";

const LEASE_MS = 30_000;
const MAX_ATTEMPTS = 10;
const MAX_BACKOFF_MS = 15 * 60_000;

function unwrapFindOneAndUpdate(result) {
  return result?.value ?? result ?? null;
}
export async function processOutboxBatch(db, { limit = 50, clock = () => Date.now() } = {}) {
  const now = new Date(clock());
  const candidates = await db.collection("outboxEvents").find({
    processedAt: null,
    deadLetteredAt: { $exists: false },
    $and: [
      { $or: [{ nextAttemptAt: { $exists: false } }, { nextAttemptAt: { $lte: now } }] },
      { $or: [{ leaseUntil: { $exists: false } }, { leaseUntil: { $lt: now } }] }
    ]
  }).sort({ createdAt: 1 }).limit(Math.max(1, Math.min(100, limit))).toArray();
  const result = { claimed: 0, processed: 0, retried: 0, deadLettered: 0, skipped: 0 };
  for (const candidate of candidates) {
    const leaseToken = randomBytes(18).toString("base64url");
    const claimResult = await db.collection("outboxEvents").findOneAndUpdate(
      { _id: candidate._id, processedAt: null, deadLetteredAt: { $exists: false },
        $and: [
          { $or: [{ leaseUntil: { $exists: false } }, { leaseUntil: { $lt: now } }] },
          { $or: [{ nextAttemptAt: { $exists: false } }, { nextAttemptAt: { $lte: now } }] }
        ] },
      { $set: { leaseToken, leaseUntil: new Date(now.getTime() + LEASE_MS) }, $inc: { attempts: 1 } },
      { returnDocument: "after" }
    );
    const event = unwrapFindOneAndUpdate(claimResult);
    if (!event) { result.skipped++; continue; }
    result.claimed++;
    try {
      if (event.type !== "message.accepted") throw new Error("unsupported_outbox_event");
      const message = await db.collection("messages").findOne({ _id: event.aggregateId, tenantId: event.tenantId });
      if (!message) throw new Error("message_not_found");
      const thread = await db.collection("threads").findOne({ _id: message.threadId, tenantId: event.tenantId });
      if (!thread) throw new Error("thread_not_found");
      const recipients = (thread.participantIds || []).filter(userId => String(userId) !== String(message.senderId));
      for (const userId of recipients) {
        await db.collection("deliveryJobs").updateOne(
          { tenantId: event.tenantId, messageId: message._id, userId },
          { $setOnInsert: { tenantId: event.tenantId, threadId: message.threadId, messageId: message._id, userId,
            state: "queued", attempts: 0, nextAttemptAt: now, createdAt: now, updatedAt: now } },
          { upsert: true }
        );
      }
      await db.collection("outboxEvents").updateOne(
        { _id: event._id, leaseToken, processedAt: null },
        { $set: { processedAt: new Date(clock()), lastError: null, dispatchedRecipients: recipients.length }, $unset: { leaseToken: "", leaseUntil: "" } }
      );
      result.processed++;
    } catch (error) {
      const attempts = Number(event.attempts || 1);
      const dead = attempts >= MAX_ATTEMPTS;
      const delay = Math.min(MAX_BACKOFF_MS, 1000 * (2 ** Math.min(attempts, 10)));
      const fields = { lastError: safeText(error?.message || "dispatch_failed", 160), leaseUntil: null, updatedAt: new Date(clock()) };
      if (dead) fields.deadLetteredAt = new Date(clock());
      else fields.nextAttemptAt = new Date(clock() + delay);
      await db.collection("outboxEvents").updateOne(
        { _id: event._id, leaseToken, processedAt: null },
        { $set: fields, $unset: { leaseToken: "", leaseUntil: "" } }
      );
      if (dead) result.deadLettered++; else result.retried++;
    }
  }
  return result;
}
