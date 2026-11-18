import { ObjectId } from "mongodb";
import { json, readBody, safeText } from "./security.js";
import { consumeRateLimit } from "./rate-limit.js";

const definitions = {
  workspaces: { collection: "workspaces", fields: { name: 100, description: 1000, color: 24 } },
  projects: { collection: "projects", fields: { workspaceId: 24, name: 120, description: 2000, status: 24, dueDate: 40 } },
  tasks: { collection: "tasks", fields: { workspaceId: 24, projectId: 24, title: 180, description: 2000, status: 24, priority: 16, dueDate: 40, assignee: 80 } },
  events: { collection: "calendarEvents", fields: { workspaceId: 24, title: 180, description: 2000, startsAt: 40, endsAt: 40, timezone: 64, location: 180 } },
  businesses: { collection: "businesses", fields: { name: 140, description: 2000, category: 60, website: 300, phone: 40, address: 300 } },
  products: { collection: "products", fields: { businessId: 24, name: 140, description: 2000, currency: 3, priceMinor: 12, sku: 80, status: 24 } },
  orders: { collection: "orders", fields: { businessId: 24, currency: 3, note: 1000 } },
  finance: { collection: "financeRecords", fields: { type: 24, currency: 3, amountMinor: 14, reference: 120, description: 500, status: 24 } },
  media: { collection: "mediaAssets", fields: { name: 180, mimeType: 100, sizeBytes: 14, storageKey: 300, checksum: 128, visibility: 16 } }
};
const enums = {
  projects: { status: ["planned", "active", "paused", "completed", "archived"] },
  tasks: { status: ["todo", "in_progress", "blocked", "done"], priority: ["low", "normal", "high", "urgent"] },
  products: { status: ["draft", "active", "archived"] },
  finance: { type: ["income", "expense", "refund", "fee"], status: ["recorded", "pending", "void"] },
  media: { visibility: ["private", "workspace", "public"] }
};
const isoCurrency = value => /^[A-Z]{3}$/.test(String(value || ""));
const validId = value => ObjectId.isValid(String(value || ""));
function serialize(row) {
  return { id: String(row._id), ...Object.fromEntries(Object.entries(row).filter(([key]) => !["_id", "ownerId", "tenantId"].includes(key)).map(([key, value]) => [key, value instanceof ObjectId ? String(value) : value])) };
}
export function projectInput(key, input) {
  const definition = definitions[key], result = {};
  for (const [field, max] of Object.entries(definition.fields)) {
    if (input[field] === undefined) continue;
    const value = input[field];
    if (["priceMinor", "sizeBytes", "amountMinor"].includes(field)) {
      if (!Number.isSafeInteger(value) || value < 0) throw new Error("invalid_" + field);
      result[field] = value;
    } else if (field === "currency") {
      if (!isoCurrency(value)) throw new Error("invalid_currency");
      result[field] = value;
    } else {
      result[field] = safeText(value, max);
    }
  }
  for (const [field, allowed] of Object.entries(enums[key] || {})) {
    if (result[field] !== undefined && !allowed.includes(result[field])) throw new Error("invalid_" + field);
  }
  if (key === "products" && result.priceMinor === undefined) throw new Error("priceMinor_required");
  if (key === "finance" && (result.amountMinor === undefined || !result.currency || !result.type)) throw new Error("finance_amount_currency_and_type_required");
  return result;
}
async function ownedReference(db, collection, id, principal) {
  if (!validId(id)) return null;
  return db.collection(collection).findOne({ _id: new ObjectId(id), tenantId: principal.tenantId, ownerId: principal._id });
}
async function allowWrite(db, res, principal, scope, limit, windowMs) {
  const result = await consumeRateLimit(db, scope, String(principal._id), limit, windowMs);
  if (!result.allowed) {
    res.setHeader("Retry-After", String(result.retryAfterSeconds));
    json(res, 429, { ok: false, error: "rate_limit_exceeded" });
    return false;
  }
  return true;
}
export async function routeModules(req, res, db, principal, path) {
  if (path === "/api/workspace/preferences") {
    if (req.method === "GET") {
      const row = await db.collection("workspacePreferences").findOne({ tenantId: principal.tenantId, userId: principal._id });
      return json(res, 200, { ok: true, preferences: row?.preferences || { layout: "comfortable", modules: ["connect", "work", "commerce", "finance", "media", "ai"], contextualPanels: true } });
    }
    if (req.method === "PUT") {
      if (!(await allowWrite(db, res, principal, "workspace-preferences", 30, 60 * 60 * 1000))) return;
      const body = await readBody(req), p = body.preferences || {};
      const modules = Array.isArray(p.modules) ? [...new Set(p.modules.filter(x => ["connect", "work", "commerce", "finance", "media", "ai"].includes(x)))].slice(0, 6) : ["connect", "work", "commerce", "finance", "media", "ai"];
      const preferences = { layout: ["comfortable", "compact"].includes(p.layout) ? p.layout : "comfortable", modules, contextualPanels: p.contextualPanels !== false };
      await db.collection("workspacePreferences").updateOne({ tenantId: principal.tenantId, userId: principal._id }, { $set: { preferences, updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } }, { upsert: true });
      return json(res, 200, { ok: true, preferences });
    }
    return json(res, 405, { ok: false, error: "method_not_allowed" });
  }

  if (path === "/api/ai/consent") {
    if (req.method === "GET") {
      const row = await db.collection("aiPreferences").findOne({ tenantId: principal.tenantId, userId: principal._id });
      return json(res, 200, { ok: true, enabled: row?.enabled === true, updatedAt: row?.updatedAt || null });
    }
    if (req.method === "PUT") {
      if (!(await allowWrite(db, res, principal, "ai-consent", 5, 60 * 60 * 1000))) return;
      const body = await readBody(req);
      if (typeof body.enabled !== "boolean") return json(res, 400, { ok: false, error: "enabled_boolean_required" });
      await db.collection("aiPreferences").updateOne({ tenantId: principal.tenantId, userId: principal._id }, { $set: { enabled: body.enabled, updatedAt: new Date() } }, { upsert: true });
      if (!body.enabled) await db.collection("aiConversations").deleteMany({ tenantId: principal.tenantId, userId: principal._id });
      return json(res, 200, { ok: true, enabled: body.enabled });
    }
    return json(res, 405, { ok: false, error: "method_not_allowed" });
  }

  if (path === "/api/ai/chat") {
    if (req.method !== "POST") return json(res, 405, { ok: false, error: "method_not_allowed" });
    if (!(await allowWrite(db, res, principal, "ai-chat", 20, 60 * 1000))) return;
    const consent = await db.collection("aiPreferences").findOne({ tenantId: principal.tenantId, userId: principal._id, enabled: true });
    if (!consent) return json(res, 403, { ok: false, error: "explicit_ai_consent_required" });
    const base = process.env.SSIBUCHAT_AI_BASE_URL, apiKey = process.env.SSIBUCHAT_AI_API_KEY, model = process.env.SSIBUCHAT_AI_MODEL;
    if (!base || !apiKey || !model) return json(res, 503, { ok: false, error: "ai_provider_not_configured" });
    const body = await readBody(req), prompt = safeText(body.message, 8000);
    if (!prompt) return json(res, 400, { ok: false, error: "message_required" });
    const response = await fetch(base.replace(/\/$/, "") + "/chat/completions", {
      method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + apiKey },
      body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }], max_tokens: 1200 }),
      signal: AbortSignal.timeout(20000)
    });
    if (!response.ok) return json(res, 502, { ok: false, error: "ai_provider_error" });
    const result = await response.json(), answer = safeText(result.choices?.[0]?.message?.content, 12000);
    if (!answer) return json(res, 502, { ok: false, error: "ai_empty_response" });
    const createdAt = new Date();
    await db.collection("aiConversations").insertOne({ tenantId: principal.tenantId, userId: principal._id, prompt, answer, model, createdAt });
    return json(res, 200, { ok: true, answer, model, createdAt });
  }

  const match = path.match(/^\/api\/modules\/([a-z-]+)(?:\/([a-f0-9]{24}))?$/i);
  if (!match) return null;
  const key = match[1], id = match[2], definition = definitions[key];
  if (!definition) return json(res, 404, { ok: false, error: "module_not_found" });
  const collection = db.collection(definition.collection);
  if (req.method === "GET") {
    let rows;
    if (key === "workspaces") {
      const memberships = await db.collection("workspaceMembers").find({ tenantId: principal.tenantId, userId: principal._id, status: "active" }).toArray();
      const ids = memberships.map(row => row.workspaceId);
      rows = await collection.find({ tenantId: principal.tenantId, $or: [{ ownerId: principal._id }, { _id: { $in: ids } }] }).sort({ updatedAt: -1 }).limit(100).toArray();
    } else {
      rows = await collection.find({ tenantId: principal.tenantId, ownerId: principal._id }).sort({ updatedAt: -1 }).limit(100).toArray();
    }
    return json(res, 200, { ok: true, items: rows.map(serialize) });
  }
  if (req.method === "POST" && !id) {
    if (!(await allowWrite(db, res, principal, "module-write:" + key, 60, 60 * 1000))) return;
    const body = await readBody(req), fields = projectInput(key, body);
    if (key === "projects" && fields.workspaceId && !(await ownedReference(db, "workspaces", fields.workspaceId, principal))) return json(res, 404, { ok: false, error: "workspace_not_found" });
    if (key === "tasks") {
      if (fields.projectId && !(await ownedReference(db, "projects", fields.projectId, principal))) return json(res, 404, { ok: false, error: "project_not_found" });
      if (fields.workspaceId && !(await ownedReference(db, "workspaces", fields.workspaceId, principal))) return json(res, 404, { ok: false, error: "workspace_not_found" });
    }
    if (key === "events" && fields.workspaceId && !(await ownedReference(db, "workspaces", fields.workspaceId, principal))) return json(res, 404, { ok: false, error: "workspace_not_found" });
    if (key === "products" && fields.businessId && !(await ownedReference(db, "businesses", fields.businessId, principal))) return json(res, 404, { ok: false, error: "business_not_found" });
    if (key === "orders") {
      const business = await ownedReference(db, "businesses", body.businessId, principal);
      if (!business || !Array.isArray(body.items) || !body.items.length || body.items.length > 50) return json(res, 400, { ok: false, error: "valid_business_and_order_items_required" });
      const items = [];
      let totalMinor = 0, currency = "";
      for (const item of body.items) {
        const product = await ownedReference(db, "products", item.productId, principal);
        const quantity = Number(item.quantity);
        if (!product || product.businessId !== String(business._id) || product.status !== "active" || !Number.isInteger(quantity) || quantity < 1 || quantity > 1000) return json(res, 400, { ok: false, error: "invalid_order_item" });
        if (currency && currency !== product.currency) return json(res, 400, { ok: false, error: "mixed_currency_order_not_supported" });
        currency = product.currency; totalMinor += product.priceMinor * quantity;
        if (!Number.isSafeInteger(totalMinor)) return json(res, 400, { ok: false, error: "order_total_out_of_range" });
        items.push({ productId: product._id, name: product.name, unitPriceMinor: product.priceMinor, quantity });
      }
      const row = { tenantId: principal.tenantId, ownerId: principal._id, businessId: business._id, items, currency, totalMinor, note: safeText(body.note, 1000), status: "draft", paymentStatus: "not_started", createdAt: new Date(), updatedAt: new Date() };
      const result = await collection.insertOne(row);
      return json(res, 201, { ok: true, item: serialize({ ...row, _id: result.insertedId }) });
    }
    if (key === "finance") fields.status = fields.status || "recorded";
    const row = { ...fields, tenantId: principal.tenantId, ownerId: principal._id, createdAt: new Date(), updatedAt: new Date() };
    const result = await collection.insertOne(row);
    if (key === "workspaces") {
      await db.collection("workspaceMembers").updateOne({ tenantId: principal.tenantId, workspaceId: result.insertedId, userId: principal._id }, { $setOnInsert: { tenantId: principal.tenantId, workspaceId: result.insertedId, userId: principal._id, role: "owner", status: "active", createdAt: new Date() } }, { upsert: true });
      await db.collection("workspaceActivity").insertOne({ tenantId: principal.tenantId, workspaceId: result.insertedId, actorId: principal._id, type: "workspace.create", aggregateId: result.insertedId, summary: "A workspace was created", createdAt: new Date() });
    }
    return json(res, 201, { ok: true, item: serialize({ ...row, _id: result.insertedId }) });
  }
  if (req.method === "PATCH" && id) {
    if (!(await allowWrite(db, res, principal, "module-write:" + key, 60, 60 * 1000))) return;
    if (key === "orders" || key === "finance") return json(res, 403, { ok: false, error: "financial_records_are_immutable" });
    const fields = projectInput(key, await readBody(req));
    if (key === "projects" && fields.workspaceId && !(await ownedReference(db, "workspaces", fields.workspaceId, principal))) return json(res, 404, { ok: false, error: "workspace_not_found" });
    if (key === "tasks") {
      if (fields.projectId && !(await ownedReference(db, "projects", fields.projectId, principal))) return json(res, 404, { ok: false, error: "project_not_found" });
      if (fields.workspaceId && !(await ownedReference(db, "workspaces", fields.workspaceId, principal))) return json(res, 404, { ok: false, error: "workspace_not_found" });
    }
    if (key === "events" && fields.workspaceId && !(await ownedReference(db, "workspaces", fields.workspaceId, principal))) return json(res, 404, { ok: false, error: "workspace_not_found" });
    if (key === "products" && fields.businessId && !(await ownedReference(db, "businesses", fields.businessId, principal))) return json(res, 404, { ok: false, error: "business_not_found" });
    const result = await collection.findOneAndUpdate({ _id: new ObjectId(id), tenantId: principal.tenantId, ownerId: principal._id }, { $set: { ...fields, updatedAt: new Date() } }, { returnDocument: "after" });
    if (!result) return json(res, 404, { ok: false, error: "item_not_found" });
    return json(res, 200, { ok: true, item: serialize(result) });
  }
  if (req.method === "DELETE" && id) {
    if (!(await allowWrite(db, res, principal, "module-write:" + key, 60, 60 * 1000))) return;
    if (key === "orders" || key === "finance") return json(res, 403, { ok: false, error: "financial_records_are_immutable" });
    const result = await collection.deleteOne({ _id: new ObjectId(id), tenantId: principal.tenantId, ownerId: principal._id });
    return json(res, result.deletedCount ? 200 : 404, { ok: result.deletedCount === 1, error: result.deletedCount ? undefined : "item_not_found" });
  }
  return json(res, 405, { ok: false, error: "method_not_allowed" });
}
