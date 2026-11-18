import test from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword, hashToken, safeText, isSameOrigin, constantTimeEqual } from "../server/security.js";

test("password hashes verify only the correct password", async () => {
  const encoded = await hashPassword("a-long-test-password");
  assert.notEqual(encoded, "a-long-test-password");
  assert.equal(await verifyPassword("a-long-test-password", encoded), true);
  assert.equal(await verifyPassword("wrong-password", encoded), false);
});

test("session token hashes are stable and do not reveal the token", () => {
  process.env.SSIBUCHAT_SESSION_SECRET = "test-session-pepper";
  const digest = hashToken("opaque-session-token");
  assert.equal(digest, hashToken("opaque-session-token"));
  assert.notEqual(digest, "opaque-session-token");
});

test("safeText strips control characters and bounds input", () => {
  assert.equal(safeText("hel" + String.fromCharCode(0) + "lo world", 20), "hello world");
});

test("same-origin guard rejects foreign origins", () => {
  assert.equal(isSameOrigin({ headers: { origin: "https://evil.example", host: "ssibuchat.example", "x-forwarded-proto": "https" } }), false);
  assert.equal(isSameOrigin({ headers: { origin: "https://ssibuchat.example", host: "ssibuchat.example", "x-forwarded-proto": "https" } }), true);
});

test("same-origin guard rejects missing and opaque origin metadata", () => {
  assert.equal(isSameOrigin({ headers: { host: "ssibuchat.example", "x-forwarded-proto": "https" } }), false);
  assert.equal(isSameOrigin({ headers: { origin: "null", host: "ssibuchat.example", "x-forwarded-proto": "https" } }), false);
});

test("same-origin guard accepts same-origin Referer fallback", () => {
  assert.equal(isSameOrigin({ headers: { referer: "https://ssibuchat.example/account", host: "ssibuchat.example", "x-forwarded-proto": "https" } }), true);
});

test("same-origin guard rejects a foreign Referer fallback", () => {
  assert.equal(isSameOrigin({ headers: { referer: "https://evil.example/account", host: "ssibuchat.example", "x-forwarded-proto": "https" } }), false);
});

test("same-origin guard rejects scheme downgrade even when host matches", () => {
  assert.equal(isSameOrigin({ headers: { origin: "http://ssibuchat.example", host: "ssibuchat.example", "x-forwarded-proto": "https" } }), false);
});

test("bootstrap secret comparison is constant-time safe for equal-length inputs", () => {
  assert.equal(constantTimeEqual("correct-secret", "correct-secret"), true);
  assert.equal(constantTimeEqual("correct-secret", "incorrect-secret"), false);
  assert.equal(constantTimeEqual("short", "longer"), false);
});
