import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const STEP_SECONDS = 30;
const CODE_DIGITS = 6;
const RECOVERY_COUNT = 10;

function base32Encode(buffer) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0, value = 0, output = "";
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) { output += alphabet[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits) output += alphabet[(value << (5 - bits)) & 31];
  return output;
}
function base32Decode(input) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0, value = 0;
  const bytes = [];
  for (const char of String(input).replace(/=+$/,"").toUpperCase()) {
    const digit = alphabet.indexOf(char);
    if (digit < 0) throw new Error("invalid_totp_secret");
    value = (value << 5) | digit; bits += 5;
    if (bits >= 8) { bytes.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(bytes);
}
function encryptionKey() {
  const configured = process.env.SSIBUCHAT_MFA_ENCRYPTION_KEY;
  if (!configured || configured.length < 32) throw new Error("mfa_encryption_key_not_configured");
  return createHash("sha256").update(configured).digest();
}
export function encryptMfaSecret(secret) {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(String(secret), "utf8"), cipher.final()]);
  return [iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
}
export function decryptMfaSecret(encoded) {
  const [ivText, tagText, dataText] = String(encoded || "").split(".");
  if (!ivText || !tagText || !dataText) throw new Error("invalid_encrypted_mfa_secret");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivText, "base64url"));
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(dataText, "base64url")), decipher.final()]).toString("utf8");
}
export function generateTotpSecret() { return base32Encode(randomBytes(20)); }
export function totpAt(secret, timestamp = Date.now()) {
  const counter = Math.floor(timestamp / 1000 / STEP_SECONDS);
  const message = Buffer.alloc(8); message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", base32Decode(secret)).update(message).digest();
  const offset = digest[digest.length - 1] & 15;
  const binary = ((digest[offset] & 127) << 24) | ((digest[offset + 1] & 255) << 16) | ((digest[offset + 2] & 255) << 8) | (digest[offset + 3] & 255);
  return String(binary % (10 ** CODE_DIGITS)).padStart(CODE_DIGITS, "0");
}
export function verifyTotp(secret, code, timestamp = Date.now(), window = 1) {
  const supplied = String(code || "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(supplied)) return false;
  for (let offset = -window; offset <= window; offset++) {
    const expected = totpAt(secret, timestamp + offset * STEP_SECONDS * 1000);
    const a = Buffer.from(expected), b = Buffer.from(supplied);
    if (a.length === b.length && timingSafeEqual(a, b)) return true;
  }
  return false;
}
export function createRecoveryCodes() {
  return Array.from({ length: RECOVERY_COUNT }, () => randomBytes(8).toString("hex").toUpperCase());
}
export function hashRecoveryCode(code) {
  const pepper = process.env.SSIBUCHAT_SESSION_SECRET;
  if (!pepper) throw new Error("session_secret_not_configured");
  return createHmac("sha256", pepper).update(String(code || "").replace(/[^a-f0-9]/gi, "").toUpperCase()).digest("hex");
}
export function provisioningUri(secret, account, issuer = "SsibuChat") {
  const label = encodeURIComponent(issuer + ":" + account);
  const params = new URLSearchParams({ secret, issuer, algorithm: "SHA1", digits: String(CODE_DIGITS), period: String(STEP_SECONDS) });
  return "otpauth://totp/" + label + "?" + params.toString();
}
