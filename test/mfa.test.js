import test from "node:test";
import assert from "node:assert/strict";
import { decryptMfaSecret, encryptMfaSecret, generateTotpSecret, hashRecoveryCode, provisioningUri, totpAt, verifyTotp } from "../server/mfa.js";

test("TOTP verification accepts RFC 6238 SHA-1 test vector and rejects malformed or incorrect values", () => {\n
  const rfcSecret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";\n  assert.equal(totpAt(rfcSecret, 59_000), "287082");\n  const secret = generateTotpSecret();
  const now = 1_800_000_000_000;
  const code = totpAt(secret, now);
  assert.equal(verifyTotp(secret, code, now), true);
  assert.equal(verifyTotp(secret, "12x456", now), false);
  const wrong = String((Number(code) + 1) % 1_000_000).padStart(6, "0");
  assert.equal(verifyTotp(secret, wrong, now), false);
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
