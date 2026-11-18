import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { route } from "../server/router.js";
import { hashToken } from "../server/security.js";
import { encryptMfaSecret, generateTotpSecret, hashRecoveryCode, totpAt } from "../server/mfa.js";

process.env.SSIBUCHAT_SESSION_SECRET = "test-session-pepper-for-mfa-api-integration";
process.env.SSIBUCHAT_MFA_ENCRYPTION_KEY = "test-mfa-encryption-key-for-api-integration";

function makeDb(user, challenge) {
  const sessions = [], audits = [], counters = new Map();
  const collections = {
    mfaChallenges: {
      findOne: async filter => filter.tokenHash === challenge.tokenHash && challenge.usedAt === null && challenge.expiresAt > filter.expiresAt.$gt ? challenge : null,
      updateOne: async (filter, update) => {
        if (challenge._id !== filter._id || challenge.usedAt !== null || challenge.expiresAt <= filter.expiresAt.$gt) return { modifiedCount: 0 };
        challenge.usedAt = update.$set.usedAt; return { modifiedCount: 1 };
      }
    },
    users: {
      findOne: async filter => {
        if (String(filter._id) !== String(user._id) || user.status !== "active" || user.mfaEnabled !== true) return null;
        return user;
      },
      updateOne: async (filter, update) => {
        if (String(filter._id) !== String(user._id)) return { modifiedCount: 0 };
        if (update.$pull?.recoveryCodeHashes) {
          const before = user.recoveryCodeHashes.length;
          user.recoveryCodeHashes = user.recoveryCodeHashes.filter(code => code !== update.$pull.recoveryCodeHashes);
          return { modifiedCount: before === user.recoveryCodeHashes.length ? 0 : 1 };
        }
        return { modifiedCount: 0 };
      }
    },
    rateLimits: {
      findOneAndUpdate: async filter => {
        const count = (counters.get(filter.key) || 0) + 1;
        counters.set(filter.key, count);
        return { count };
      }
    },
    sessions: { insertOne: async document => { sessions.push(document); return { insertedId: "session-" + sessions.length }; } },
    auditEvents: { insertOne: async document => { audits.push(document); return { insertedId: "audit-" + audits.length }; } }
  };
  return { collection: name => collections[name], sessions, audits };
}
async function invoke(db, challengeToken, code) {
  const headers = {};
  const res = { statusCode: 200, setHeader(name, value) { headers[name] = value; }, end(body) { this.body = body; } };
  const req = { method: "POST", url: "/api/auth/mfa/verify", headers: { host: "localhost", origin: "http://localhost" }, socket: {}, body: { challengeToken, code } };
  await route(req, res, db);
  return { status: res.statusCode, body: JSON.parse(res.body), headers };
}
function fixture(codeHashes = []) {
  const secret = generateTotpSecret();
  const challengeToken = randomBytes(32).toString("base64url");
  const user = { _id: "user-1", username: "tester", displayName: "Tester", role: "member", tenantId: "global", status: "active", mfaEnabled: true, mfaSecretEncrypted: encryptMfaSecret(secret), recoveryCodeHashes: codeHashes };
  const challenge = { _id: "challenge-1", tokenHash: hashToken(challengeToken), userId: user._id, expiresAt: new Date(Date.now() + 5 * 60 * 1000), usedAt: null };
  return { user, challenge, challengeToken, secret, db: makeDb(user, challenge) };
}

test("MFA login challenge creates a session and cannot be replayed", async () => {
  const f = fixture();
  const result = await invoke(f.db, f.challengeToken, totpAt(f.secret));
  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.equal(f.db.sessions.length, 1);
  assert.ok(f.challenge.usedAt instanceof Date);
  const replay = await invoke(f.db, f.challengeToken, totpAt(f.secret));
  assert.equal(replay.status, 401);
  assert.equal(f.db.sessions.length, 1);
});

test("MFA recovery code is consumed after successful challenge", async () => {
  const recoveryCode = "A1B2C3D4E5F60708";
  const f = fixture([hashRecoveryCode(recoveryCode)]);
  const result = await invoke(f.db, f.challengeToken, recoveryCode);
  assert.equal(result.status, 200);
  assert.deepEqual(f.user.recoveryCodeHashes, []);
  assert.equal(f.db.sessions.length, 1);
});

test("invalid MFA challenge code does not create a session or consume the challenge", async () => {
  const f = fixture();
  const result = await invoke(f.db, f.challengeToken, "not-a-code");
  assert.equal(result.status, 401);
  assert.equal(f.db.sessions.length, 0);
  assert.equal(f.challenge.usedAt, null);
});
