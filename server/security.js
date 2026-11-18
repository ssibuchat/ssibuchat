import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
const scrypt = promisify(scryptCallback);
const COOKIE = "ssibu_session";
const DAY = 86400000;
export const hashToken = (value) => createHash("sha256").update(String(value)).digest("hex");
export async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const derived = await scrypt(String(password), salt, 64);
  return "scrypt:" + salt + ":" + Buffer.from(derived).toString("hex");
}
export async function verifyPassword(password, encoded) {
  const [kind, salt, expectedHex] = String(encoded || "").split(":");
  if (kind !== "scrypt" || !salt || !expectedHex) return false;
  const actual = Buffer.from(await scrypt(String(password), salt, 64));
  const expected = Buffer.from(expectedHex, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export function parseCookies(req) {
  return Object.fromEntries(String(req.headers?.cookie || "").split(";").map((part) => {
    const i = part.indexOf("="); return i < 0 ? ["", ""] : [part.slice(0, i).trim(), decodeURIComponent(part.slice(i + 1).trim())];
  }).filter(([key]) => key));
}
export function setSessionCookie(res, token, maxAge = 14 * DAY) {
  const secure = process.env.NODE_ENV === "production" || process.env.VERCEL ? "; Secure" : "";
  res.setHeader("Set-Cookie", COOKIE + "=" + encodeURIComponent(token) + "; Path=/; HttpOnly; SameSite=Lax; Max-Age=" + Math.floor(maxAge / 1000) + secure);
}
export function clearSessionCookie(res) {
  const secure = process.env.NODE_ENV === "production" || process.env.VERCEL ? "; Secure" : "";
  res.setHeader("Set-Cookie", COOKIE + "=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0" + secure);
}
export async function createSession(db, user) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + 14 * DAY);
  await db.collection("sessions").insertOne({ tokenHash: hashToken(token), userId: user._id, tenantId: user.tenantId, createdAt: new Date(), expiresAt });
  return token;
}
export async function currentPrincipal(req, db) {
  const token = parseCookies(req)[COOKIE]; if (!token) return null;
  const session = await db.collection("sessions").findOne({ tokenHash: hashToken(token), expiresAt: { $gt: new Date() } });
  if (!session) return null;
  const user = await db.collection("users").findOne({ _id: session.userId, status: "active" }, { projection: { passwordHash: 0 } });
  return user ? { user, session } : null;
}
export function safeText(value, max = 500) { return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max); }
export function isSameOrigin(req) {
  const origin = req.headers?.origin; if (!origin) return true;
  try { return Boolean(req.headers?.host && new URL(origin).host === req.headers.host); } catch { return false; }
}
export function json(res, status, body) { res.statusCode = status; res.setHeader("Content-Type", "application/json; charset=utf-8"); res.setHeader("Cache-Control", "no-store"); res.end(JSON.stringify(body)); }
export async function readBody(req, maxBytes = 256000) {
  if (req.body && typeof req.body === "object") return req.body;
  let raw = ""; for await (const chunk of req) { raw += chunk; if (Buffer.byteLength(raw) > maxBytes) throw new Error("body_too_large"); }
  return raw ? JSON.parse(raw) : {};
}