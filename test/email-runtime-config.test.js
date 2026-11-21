import test from "node:test";
import assert from "node:assert/strict";
import { encryptConfigValue } from "../server/config-vault.js";
import { getEmailRuntimeConfig } from "../server/email.js";

test("email runtime config preserves environment bootstrap values without a vault key", async () => {
  delete process.env.SSIBUCHAT_CONFIG_ENCRYPTION_KEY;
  process.env.RESEND_API_KEY = "bootstrap-key";
  process.env.SSIBUCHAT_EMAIL_FROM = "SsibuChat <noreply@example.test>";
  process.env.SSIBUCHAT_APP_URL = "https://ssibuchat.example.test";
  const config = await getEmailRuntimeConfig({});
  assert.equal(config.RESEND_API_KEY, "bootstrap-key");
  assert.equal(config.SSIBUCHAT_EMAIL_FROM, "SsibuChat <noreply@example.test>");
  assert.equal(config.SSIBUCHAT_APP_URL, "https://ssibuchat.example.test");
});

test("activated encrypted email runtime values override bootstrap environment values", async () => {
  process.env.SSIBUCHAT_CONFIG_ENCRYPTION_KEY = Buffer.alloc(32, 41).toString("base64");
  process.env.RESEND_API_KEY = "old-bootstrap-key";
  process.env.SSIBUCHAT_EMAIL_FROM = "old@example.test";
  process.env.SSIBUCHAT_APP_URL = "https://old.example.test";
  const rows = [
    { key: "RESEND_API_KEY", active: true, ...encryptConfigValue("live-runtime-key") },
    { key: "SSIBUCHAT_EMAIL_FROM", active: true, ...encryptConfigValue("SsibuChat <live@example.test>") },
    { key: "SSIBUCHAT_APP_URL", active: true, ...encryptConfigValue("https://live.example.test") }
  ];
  const db = { collection: () => ({ find: () => ({ toArray: async () => rows }) }) };
  const config = await getEmailRuntimeConfig(db);
  assert.equal(config.RESEND_API_KEY, "live-runtime-key");
  assert.equal(config.SSIBUCHAT_EMAIL_FROM, "SsibuChat <live@example.test>");
  assert.equal(config.SSIBUCHAT_APP_URL, "https://live.example.test");
  assert.equal(Object.isFrozen(config), true);
});
