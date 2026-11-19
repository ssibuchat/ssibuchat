import test from "node:test";
import assert from "node:assert/strict";
import { encryptConfigValue } from "../server/config-vault.js";
import { getMediaRuntimeConfig } from "../server/media.js";
import { presignS3, s3StorageConfigured } from "../server/s3-signing.js";

test("media runtime config uses environment bootstrap values when vault is unavailable", async () => {
  delete process.env.SSIBUCHAT_CONFIG_ENCRYPTION_KEY;
  process.env.SSIBUCHAT_S3_ENDPOINT = "https://objects.example.test";
  process.env.SSIBUCHAT_S3_BUCKET = "ssibuchat";
  process.env.SSIBUCHAT_S3_ACCESS_KEY_ID = "bootstrap-access";
  process.env.SSIBUCHAT_S3_SECRET_ACCESS_KEY = "bootstrap-secret";
  const config = await getMediaRuntimeConfig({});
  assert.equal(config.SSIBUCHAT_S3_ENDPOINT, "https://objects.example.test");
  assert.equal(s3StorageConfigured(config), true);
});

test("media runtime config activates encrypted storage and scanner credentials without redeploy", async () => {
  process.env.SSIBUCHAT_CONFIG_ENCRYPTION_KEY = Buffer.alloc(32, 57).toString("base64");
  process.env.SSIBUCHAT_S3_ENDPOINT = "https://old-objects.example.test";
  const values = {
    SSIBUCHAT_S3_ENDPOINT: "https://live-objects.example.test",
    SSIBUCHAT_S3_BUCKET: "live-bucket",
    SSIBUCHAT_S3_REGION: "us-east-1",
    SSIBUCHAT_S3_ACCESS_KEY_ID: "live-access",
    SSIBUCHAT_S3_SECRET_ACCESS_KEY: "live-secret",
    SSIBUCHAT_MEDIA_SCAN_URL: "https://scanner.example.test/scan",
    SSIBUCHAT_MEDIA_SCAN_TOKEN: "live-scan-token"
  };
  const rows = Object.entries(values).map(([key, value]) => ({ key, active: true, ...encryptConfigValue(value) }));
  const db = { collection: () => ({ find: () => ({ toArray: async () => rows }) }) };
  const config = await getMediaRuntimeConfig(db);
  assert.equal(config.SSIBUCHAT_S3_ENDPOINT, "https://live-objects.example.test");
  assert.equal(config.SSIBUCHAT_S3_SECRET_ACCESS_KEY, "live-secret");
  assert.equal(config.SSIBUCHAT_MEDIA_SCAN_TOKEN, "live-scan-token");
  assert.equal(s3StorageConfigured(config), true);
  const signed = presignS3({ method: "PUT", key: "tenant/user/file", contentType: "image/png", env: config, clock: new Date("2026-01-02T03:04:05.000Z") });
  assert.match(signed.url, /^https:\/\/live-objects\.example\.test\//);
});
