import test from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword, hashToken, safeText, isSameOrigin } from "../server/security.js";

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
  assert.equal(safeText("hello\\u0000world", 5), "hello");
});

test("same-origin guard rejects foreign origins", () => {
  assert.equal(isSameOrigin({ headers: { origin: "https://evil.example", host: "ssibuchat.example" } }), false);
  assert.equal(isSameOrigin({ headers: { origin: "https://ssibuchat.example", host: "ssibuchat.example" } }), true);
});
