import test from "node:test";
import assert from "node:assert/strict";
import { decryptConfigValue, encryptConfigValue } from "../server/config-vault.js";

test("configuration vault encrypts and decrypts values with AES-256-GCM", () => {
  process.env.SSIBUCHAT_CONFIG_ENCRYPTION_KEY = Buffer.alloc(32, 19).toString("base64");
  const value = "cron-secret-that-must-not-be-returned";
  const sealed = encryptConfigValue(value);
  assert.equal(sealed.algorithm, "aes-256-gcm");
  assert.notEqual(sealed.ciphertext, Buffer.from(value).toString("base64"));
  assert.equal(decryptConfigValue(sealed), value);
});

test("configuration vault rejects tampered ciphertext", () => {
  process.env.SSIBUCHAT_CONFIG_ENCRYPTION_KEY = Buffer.alloc(32, 23).toString("base64");
  const sealed = encryptConfigValue("sensitive-value");
  sealed.ciphertext = Buffer.from("tampered").toString("base64");
  assert.throws(() => decryptConfigValue(sealed));
});

test("configuration vault fails closed without a valid 32-byte key", () => {
  delete process.env.SSIBUCHAT_CONFIG_ENCRYPTION_KEY;
  assert.throws(() => encryptConfigValue("value"), { code: "config_encryption_key_not_configured" });
  process.env.SSIBUCHAT_CONFIG_ENCRYPTION_KEY = "not-a-valid-key";
  assert.throws(() => encryptConfigValue("value"), { code: "config_encryption_key_not_configured" });
});
