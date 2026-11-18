import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { decryptMfaSecret, encryptMfaSecret, generateTotpSecret, hashRecoveryCode, provisioningUri, verifyTotp } from "../server/mfa.js";

test("TOTP verification accepts current code and rejects malformed or incorrect values", () => {
  const secret = generateTotpSecret();
  const now = 1_800_000_000_000;
  const counter = Math.floor(now / 1000 / 30);
  const message = Buffer.alloc(8); message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", Buffer.from(secret, "base32")).update(message).digest();
  const offset = digest[digest.length - 1] & 15;
  const binary = ((digest[offset] & 127) << 24) | ((digest[offset + 1] & 255) << 16) | ((digest[offset + 2] & 255) << 8) | (digest[offset + 3] & 255);
  const code = String(binary % 1_000_000).padStart(6, "0");
  assert.equal(verifyTotp(secret, code, now), true);
  assert.equal(verifyTotp(secret, "12x456", now), false);
  assert.equal(verifyTotp(secret, "000000", now), false);
});

test("MFA secret encryption authenticates ciphertext", () => {
  process.env.SSIBUCHAT_MFA_ENCRYPTION_KEY = "test-encryption-key-that-is-long-enough";
  const encrypted = encryptMfaSecret("JBSWY3DPEHPK3PXP");
  assert.equal(decryptMfaSecret(encrypted), "JBSWY3DPEHPK3PXP");
  const parts = encrypted.split("."); parts[2] = Buffer.from("tampered").toString("base64url");
  assert.throws(() => decryptMfaSecret(parts.join(".")));
});

test("recovery codes are keyed hashes and provisioning URI is authenticator compatible", () => {
  process.env.SSIBUCHAT_SESSION_SECRET = "test-session-pepper";
  assert.match(hashRecoveryCode("ABCD-1234"), /^[a-f0-9]{64}$/);
  const uri = provisioningUri("JBSWY3DPEHPK3PXP", "user@example.test");
  assert.match(uri, /^otpauth:\/\/totp\//);
  assert.match(uri, /issuer=SsibuChat/);
});
