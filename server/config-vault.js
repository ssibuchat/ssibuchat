import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { ObjectId } from "mongodb";
import { json, safeText } from "./security.js";

const TARGETS = new Set(["runtime", "github-actions", "vercel", "namecheap", "bluehost", "other"]);
const ENVIRONMENTS = new Set(["shared", "production", "preview", "development"]);
const KEY_PATTERN = /^[A-Z][A-Z0-9_]{1,127}$/;

function encryptionKey() {
  const encoded = String(process.env.SSIBUCHAT_CONFIG_ENCRYPTION_KEY || "").trim();
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32 || key.toString("base64").replace(/=+$/, "") !== encoded.replace(/=+$/, "")) {
    const error = new Error("config_encryption_key_not_configured");
    error.code = "config_encryption_key_not_configured";
    throw error;
  }
  return key;
}

export function encryptConfigValue(value) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  return { algorithm: "aes-256-gcm", iv: iv.toString("base64"), ciphertext: ciphertext.toString("base64"), tag: cipher.getAuthTag().toString("base64") };
}

export function decryptConfigValue(record) {
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(record.iv, "base64"));
  decipher.setAuthTag(Buffer.from(record.tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(record.ciphertext, "base64")), decipher.final()]).toString("utf8");
}

// Server-side only. Runtime consumers must call this function; values are never exposed by the admin API.
export async function getActiveRuntimeConfig(db, environment = "production") {
  const rows = await db.collection("runtimeConfig").find({ target: "runtime", environment: { $in: ["shared", environment] }, active: true }).toArray();
  const result = {};
  for (const row of rows) result[row.key] = decryptConfigValue(row);
  return Object.freeze(result);
}

function publicRecord(row) {
  return {
    id: String(row._id), key: row.key, target: row.target, environment: row.environment,
    secret: row.secret === true, active: row.active === true, version: row.version || 1,
    syncStatus: row.syncStatus || "not_requested", updatedAt: row.updatedAt || null,
    lastSyncAt: row.lastSyncAt || null, lastSyncError: row.lastSyncError || null
  };
}

export async function routeConfig(req, res, db, actor, path) {
  const collection = db.collection("runtimeConfig");
  await collection.createIndex({ key: 1, target: 1, environment: 1 }, { unique: true, name: "runtime_config_identity" });

  if (path === "/api/admin/config" && req.method === "GET") {
    const rows = await collection.find({}).sort({ target: 1, environment: 1, key: 1 }).limit(500).toArray();
    return json(res, 200, { ok: true, encryptionReady: (() => { try { encryptionKey(); return true; } catch { return false; } })(), records: rows.map(publicRecord) });
  }

  if (path === "/api/admin/config" && req.method === "PUT") {
    let body;
    try { body = await (await import("./security.js")).readBody(req); }
    catch { return json(res, 400, { ok: false, error: "invalid_request_body" }); }
    const key = String(body.key || "").trim().toUpperCase();
    const target = String(body.target || "runtime");
    const environment = String(body.environment || "production");
    const value = typeof body.value === "string" ? body.value : "";
    if (!KEY_PATTERN.test(key) || !TARGETS.has(target) || !ENVIRONMENTS.has(environment) || !value || value.length > 16384) {
      return json(res, 400, { ok: false, error: "valid_key_target_environment_and_value_required" });
    }
    let sealed;
    try { sealed = encryptConfigValue(value); }
    catch (error) { return json(res, 503, { ok: false, error: error.code || "config_vault_unavailable" }); }
    const identity = { key, target, environment };
    const previous = await collection.findOne(identity);
    const version = (previous?.version || 0) + 1;
    const timestamp = new Date();
    const active = target === "runtime" ? body.activate !== false : false;
    const syncStatus = target === "runtime" ? (active ? "active" : "inactive") : "pending_provider_adapter";
    const record = {
      ...identity, ...sealed, secret: body.secret !== false, active, version, syncStatus,
      createdAt: previous?.createdAt || timestamp, updatedAt: timestamp, updatedBy: actor._id,
      lastSyncAt: null, lastSyncError: null
    };
    await db.collection("runtimeConfigVersions").insertOne({ ...record, configId: previous?._id || null, version, changedBy: actor._id, changedAt: timestamp });
    await collection.updateOne(identity, { $set: record, $setOnInsert: { createdAt: timestamp } }, { upsert: true });
    await db.collection("auditEvents").insertOne({ tenantId: actor.tenantId || "global", actorId: actor._id, action: "config.value.updated", target: target + "/" + environment + "/" + key, createdAt: timestamp });
    const saved = await collection.findOne(identity);
    return json(res, 200, { ok: true, record: publicRecord(saved), message: target === "runtime" ? "Encrypted runtime value saved. Runtime consumers must opt in to the live configuration service." : "Encrypted value saved. Provider synchronization is not yet connected." });
  }

  const match = path.match(/^\/api\/admin\/config\/([a-f0-9]{24})$/);
  if (match && req.method === "DELETE") {
    const _id = new ObjectId(match[1]);
    const row = await collection.findOne({ _id });
    if (!row) return json(res, 404, { ok: false, error: "config_not_found" });
    await collection.deleteOne({ _id });
    await db.collection("runtimeConfigVersions").insertOne({ configId: _id, key: row.key, target: row.target, environment: row.environment, action: "deleted", changedBy: actor._id, changedAt: new Date() });
    await db.collection("auditEvents").insertOne({ tenantId: actor.tenantId || "global", actorId: actor._id, action: "config.value.deleted", target: row.target + "/" + row.environment + "/" + row.key, createdAt: new Date() });
    return json(res, 200, { ok: true });
  }
  return false;
}
