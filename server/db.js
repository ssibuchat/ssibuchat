import { MongoClient } from "mongodb";
let clientPromise;
let indexesPromise;
export async function getDb() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("database_not_configured");
  if (!clientPromise) {
    const client = new MongoClient(uri, { maxPoolSize: 10, serverSelectionTimeoutMS: 8000 });
    clientPromise = client.connect().catch((error) => { clientPromise = null; throw error; });
  }
  const client = await clientPromise;
  return client.db(process.env.MONGODB_DB || "ssibuchat");
}
export async function ensureIndexes(db) {
  if (!indexesPromise) indexesPromise = Promise.all([
    db.collection("users").createIndex({ emailNormalized: 1 }, { unique: true, sparse: true }),
    db.collection("users").createIndex({ usernameNormalized: 1 }, { unique: true, sparse: true }),
    db.collection("sessions").createIndex({ tokenHash: 1 }, { unique: true }),
    db.collection("sessions").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),    db.collection("mfaChallenges").createIndex({ tokenHash: 1 }, { unique: true }),    db.collection("mfaChallenges").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    db.collection("mfaChallenges").createIndex({ tokenHash: 1 }, { unique: true }),
    db.collection("mfaChallenges").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    db.collection("threads").createIndex({ tenantId: 1, participantIds: 1, updatedAt: -1 }),
    db.collection("messages").createIndex({ tenantId: 1, threadId: 1, createdAt: -1 }),
    db.collection("messages").createIndex({ tenantId: 1, senderId: 1, idempotencyKey: 1 }, { unique: true, sparse: true }),
    db.collection("outboxEvents").createIndex({ tenantId: 1, type: 1, aggregateId: 1 }, { unique: true, partialFilterExpression: { aggregateId: { $type: "objectId" } } }),
    db.collection("memberships").createIndex({ tenantId: 1, userId: 1 }, { unique: true }),
    db.collection("auditEvents").createIndex({ tenantId: 1, createdAt: -1 }),
    ...["workspaces","projects","tasks","calendarEvents","businesses","products","orders","financeRecords","mediaAssets"].map(name => db.collection(name).createIndex({ tenantId: 1, ownerId: 1, updatedAt: -1 })),
    db.collection("workspacePreferences").createIndex({ tenantId: 1, userId: 1 }, { unique: true }),
    db.collection("aiPreferences").createIndex({ tenantId: 1, userId: 1 }, { unique: true }),
    db.collection("aiConversations").createIndex({ tenantId: 1, userId: 1, createdAt: -1 }),
    db.collection("rateLimits").createIndex({ key: 1 }, { unique: true }),
    db.collection("rateLimits").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
  ]).catch((error) => { indexesPromise = null; throw error; });
  await indexesPromise;
}
