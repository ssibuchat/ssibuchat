import { randomBytes } from "node:crypto";
import { safeText } from "./security.js";

const MIGRATION_ID = "2026-11-18-tenant-membership-v1";
const now = () => new Date();
function unwrap(result) { return result?.value ?? result ?? null; }

export async function runMigrations(db) {
  const token = randomBytes(18).toString("base64url"), timestamp = now();
  let claim;
  try {
    claim = unwrap(await db.collection("schemaMigrations").findOneAndUpdate(
      { id:MIGRATION_ID, $or:[{status:{$exists:false}},{status:"failed"},{leaseUntil:{$lt:timestamp}}] },
      { $set:{ status:"running", leaseToken:token, leaseUntil:new Date(timestamp.getTime()+60_000), startedAt:timestamp } },
      { upsert:true, returnDocument:"after" }
    ));
  } catch (error) {
    if (error?.code === 11000) return { skipped:true };
    throw error;
  }
  if (!claim || claim.leaseToken !== token) return { skipped:true };
  try {
    const users = await db.collection("users").find({}).toArray();
    for (const user of users) {
      const tenantId = user.tenantId || "global";
      if (!user.tenantId || !user.schemaVersion) {
        await db.collection("users").updateOne({ _id:user._id }, { $set:{ tenantId, schemaVersion:1 } });
      }
      await db.collection("memberships").updateOne(
        { tenantId, userId:user._id },
        { $setOnInsert:{ tenantId, userId:user._id, role:user.role==="admin"?"admin":"member", status:user.status==="active"?"active":"suspended", createdAt:user.createdAt||timestamp } },
        { upsert:true }
      );
    }
    const workspaces = await db.collection("workspaces").find({}).toArray();
    for (const workspace of workspaces) {
      if (!workspace.ownerId) continue;
      const tenantId = workspace.tenantId || "global";
      await db.collection("workspaceMembers").updateOne(
        { tenantId, workspaceId:workspace._id, userId:workspace.ownerId },
        { $setOnInsert:{ tenantId, workspaceId:workspace._id, userId:workspace.ownerId, role:"owner", status:"active", createdAt:workspace.createdAt||timestamp } },
        { upsert:true }
      );
    }
    await db.collection("schemaMigrations").updateOne(
      { id:MIGRATION_ID, leaseToken:token },
      { $set:{ status:"completed", completedAt:now() }, $unset:{ leaseToken:"", leaseUntil:"" } }
    );
    return { applied:true, id:MIGRATION_ID, users:users.length, workspaces:workspaces.length };
  } catch (error) {
    await db.collection("schemaMigrations").updateOne(
      { id:MIGRATION_ID, leaseToken:token },
      { $set:{ status:"failed", lastError:safeText(error?.message||"migration_failed",180), updatedAt:now() }, $unset:{ leaseToken:"", leaseUntil:"" } }
    );
    throw error;
  }
}
