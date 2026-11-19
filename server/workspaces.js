import { ObjectId } from "mongodb";
import { randomBytes } from "node:crypto";
import { json, readBody, safeText } from "./security.js";
import { hashToken } from "./security.js";
import { consumeRateLimit } from "./rate-limit.js";

const now = () => new Date();
const usernameNorm = value => String(value || "").trim().toLowerCase().replace(/[^a-z0-9_.-]/g, "").slice(0, 40);
async function memberFor(db, workspace, principal) {
  const row = await db.collection("workspaceMembers").findOne({ tenantId: principal.tenantId, workspaceId: workspace._id, userId: principal._id, status: "active" });
  if (row) return row;
  if (String(workspace.ownerId) === String(principal._id)) {
    await db.collection("workspaceMembers").updateOne(
      { tenantId: principal.tenantId, workspaceId: workspace._id, userId: principal._id },
      { $setOnInsert: { tenantId: principal.tenantId, workspaceId: workspace._id, userId: principal._id, role: "owner", status: "active", createdAt: now() } },
      { upsert: true }
    );
    return { role: "owner", status: "active" };
  }
  return null;
}
async function writeAllowed(db, res, principal, scope, limit = 30) {
  const result = await consumeRateLimit(db, scope, String(principal._id), limit, 60 * 60 * 1000);
  if (!result.allowed) { res.setHeader("Retry-After", String(result.retryAfterSeconds)); json(res,429,{ok:false,error:"rate_limit_exceeded"}); return false; }
  return true;
}
async function activity(db, tenantId, workspaceId, actorId, type, aggregateId, summary) {
  await db.collection("workspaceActivity").insertOne({ tenantId, workspaceId, actorId, type, aggregateId:aggregateId||null, summary:safeText(summary,180), createdAt:now() });
}
export async function routeWorkspaces(req, res, db, principal, path) {
  const inviteAccept = path.match(/^\/api\/workspace-invites\/([A-Za-z0-9_-]{32,})\/accept$/);
  if (inviteAccept && req.method === "POST") {
    const invite = await db.collection("workspaceInvites").findOne({ tokenHash:hashToken(inviteAccept[1]), tenantId:principal.tenantId, inviteeId:principal._id, status:"pending", expiresAt:{$gt:now()} });
    if (!invite) return json(res,404,{ok:false,error:"workspace_invite_not_found_or_expired"});
    await db.collection("workspaceMembers").updateOne(
      { tenantId:principal.tenantId, workspaceId:invite.workspaceId, userId:principal._id },
      { $set:{ role:invite.role, status:"active", updatedAt:now() }, $setOnInsert:{ createdAt:now() } },
      { upsert:true }
    );
    await db.collection("workspaceInvites").updateOne({ _id:invite._id, status:"pending" },{ $set:{ status:"accepted", acceptedAt:now() } });
    await activity(db,principal.tenantId,invite.workspaceId,principal._id,"workspace.member.join",principal._id,"A member accepted a workspace invitation");
    return json(res,200,{ok:true,joined:true,workspaceId:String(invite.workspaceId),role:invite.role});
  }
  const match = path.match(/^\/api\/workspaces\/([a-f0-9]{24})(?:\/(members|invites|documents|activity)(?:\/([a-f0-9]{24})(?:\/(revisions))?)?)?$/i);
  if (!match) return null;
  const workspaceId = new ObjectId(match[1]), section = match[2] || "", childId = match[3], suffix = match[4];
  const workspace = await db.collection("workspaces").findOne({ _id:workspaceId, tenantId:principal.tenantId });
  if (!workspace) return json(res,404,{ok:false,error:"workspace_not_found"});
  const membership = await memberFor(db,workspace,principal);
  if (!membership) return json(res,403,{ok:false,error:"workspace_membership_required"});
  const role = membership.role || "member";
  const canEdit = role === "owner" || role === "editor";
  const isOwner = role === "owner";

  if (section === "members" && req.method === "GET") {
    const rows = await db.collection("workspaceMembers").find({ tenantId:principal.tenantId, workspaceId, status:"active" }).sort({ createdAt:1 }).limit(100).toArray();
    const ids = rows.map(row=>row.userId);
    const users = ids.length ? await db.collection("users").find({ _id:{$in:ids} },{projection:{passwordHash:0,email:0,emailNormalized:0}}).toArray() : [];
    return json(res,200,{ok:true,members:rows.map(row=>{const user=users.find(item=>String(item._id)===String(row.userId));return {userId:String(row.userId),username:user?.username||null,displayName:user?.displayName||null,role:row.role,status:row.status};})});
  }
  if (section === "invites" && req.method === "POST") {
    if (!isOwner) return json(res,403,{ok:false,error:"workspace_owner_required"});
    if (!(await writeAllowed(db,res,principal,"workspace-invite"))) return;
    const body = await readBody(req), username = usernameNorm(body.username), inviteRole = body.role;
    if (!username || !["editor","viewer"].includes(inviteRole)) return json(res,400,{ok:false,error:"username_and_editor_or_viewer_role_required"});
    const invitee = await db.collection("users").findOne({ tenantId:principal.tenantId, usernameNormalized:username, status:"active" });
    if (!invitee) return json(res,404,{ok:false,error:"workspace_invitee_not_found"});
    if (String(invitee._id)===String(workspace.ownerId)) return json(res,409,{ok:false,error:"workspace_owner_already_member"});
    const existing = await db.collection("workspaceMembers").findOne({ tenantId:principal.tenantId, workspaceId, userId:invitee._id, status:"active" });
    if (existing) return json(res,409,{ok:false,error:"already_workspace_member"});
    const token = randomBytes(32).toString("base64url"), expiresAt = new Date(Date.now()+7*24*60*60*1000);
    const result = await db.collection("workspaceInvites").insertOne({ tenantId:principal.tenantId, workspaceId, inviteeId:invitee._id, invitedBy:principal._id, role:inviteRole, tokenHash:hashToken(token), status:"pending", createdAt:now(), expiresAt });
    await activity(db,principal.tenantId,workspaceId,principal._id,"workspace.invite.create",result.insertedId,"A workspace invitation was created");
    return json(res,201,{ok:true,invite:{id:String(result.insertedId),token,username:invitee.username,role:inviteRole,expiresAt}});
  }
  if (section === "members" && childId && req.method === "PATCH") {
    if (!isOwner) return json(res,403,{ok:false,error:"workspace_owner_required"});
    const body=await readBody(req),newRole=body.role;
    if (!["editor","viewer"].includes(newRole)) return json(res,400,{ok:false,error:"invalid_workspace_role"});
    const result=await db.collection("workspaceMembers").updateOne({tenantId:principal.tenantId,workspaceId,userId:new ObjectId(childId),status:"active",role:{$ne:"owner"}},{$set:{role:newRole,updatedAt:now()}});
    if(result.matchedCount!==1)return json(res,404,{ok:false,error:"workspace_member_not_found"});
    await activity(db,principal.tenantId,workspaceId,principal._id,"workspace.member.role",childId,"A workspace member role changed");
    return json(res,200,{ok:true,role:newRole});
  }
  if (section === "members" && childId && req.method === "DELETE") {
    if (!isOwner) return json(res,403,{ok:false,error:"workspace_owner_required"});
    const result=await db.collection("workspaceMembers").deleteOne({tenantId:principal.tenantId,workspaceId,userId:new ObjectId(childId),role:{$ne:"owner"}});
    if(!result.deletedCount)return json(res,404,{ok:false,error:"workspace_member_not_found"});
    await activity(db,principal.tenantId,workspaceId,principal._id,"workspace.member.remove",childId,"A workspace member was removed");
    return json(res,200,{ok:true,removed:true});
  }
  if (section === "documents" && childId && suffix === "comments" && (req.method === "GET" || req.method === "POST")) {
    const documentId=new ObjectId(childId);
    const document=await db.collection("workspaceDocuments").findOne({_id:documentId,tenantId:principal.tenantId,workspaceId,deletedAt:{$exists:false}});
    if(!document)return json(res,404,{ok:false,error:"document_not_found"});
    if(req.method==="GET"){
      const rows=await db.collection("workspaceDocumentComments").find({tenantId:principal.tenantId,workspaceId,documentId,deletedAt:{$exists:false}}).sort({createdAt:1}).limit(200).toArray();
      return json(res,200,{ok:true,comments:rows.map(row=>({id:String(row._id),authorId:String(row.authorId),text:row.text,createdAt:row.createdAt,updatedAt:row.updatedAt}))});
    }
    if(!(await writeAllowed(db,res,principal,"workspace-comment",60)))return;
    const body=await readBody(req),text=safeText(body.text,4000);
    if(!text)return json(res,400,{ok:false,error:"comment_text_required"});
    const comment={tenantId:principal.tenantId,workspaceId,documentId,authorId:principal._id,text,createdAt:now(),updatedAt:now()};
    const created=await db.collection("workspaceDocumentComments").insertOne(comment);
    await activity(db,principal.tenantId,workspaceId,principal._id,"workspace.document.comment",created.insertedId,"A shared document received a comment");
    return json(res,201,{ok:true,comment:{id:String(created.insertedId),authorId:String(principal._id),text,createdAt:comment.createdAt}});
  }
  if (section === "documents" && req.method === "GET" && !childId) {
    const rows=await db.collection("workspaceDocuments").find({tenantId:principal.tenantId,workspaceId,deletedAt:{$exists:false}}).sort({updatedAt:-1}).limit(100).toArray();
    return json(res,200,{ok:true,documents:rows.map(row=>({id:String(row._id),title:row.title,version:row.version,updatedAt:row.updatedAt,updatedBy:String(row.updatedBy||row.createdBy)}))});
  }
  if (section === "documents" && req.method === "POST" && !childId) {
    if(!canEdit)return json(res,403,{ok:false,error:"workspace_editor_required"});
    if(!(await writeAllowed(db,res,principal,"workspace-document",60)))return;
    const body=await readBody(req),title=safeText(body.title,160),content=safeText(body.content,50000);
    if(!title||!content)return json(res,400,{ok:false,error:"document_title_and_content_required"});
    const document={tenantId:principal.tenantId,workspaceId,createdBy:principal._id,updatedBy:principal._id,title,content,version:1,createdAt:now(),updatedAt:now()};
    const created=await db.collection("workspaceDocuments").insertOne(document);
    await db.collection("workspaceDocumentRevisions").insertOne({tenantId:principal.tenantId,workspaceId,documentId:created.insertedId,version:1,title,content,authorId:principal._id,createdAt:now()});
    await activity(db,principal.tenantId,workspaceId,principal._id,"workspace.document.create",created.insertedId,"A shared document was created");
    return json(res,201,{ok:true,document:{id:String(created.insertedId),title,content,version:1}});
  }
  if (section === "documents" && childId && suffix === "revisions" && req.method === "GET") {
    const rows=await db.collection("workspaceDocumentRevisions").find({tenantId:principal.tenantId,workspaceId,documentId:new ObjectId(childId)}).sort({version:-1}).limit(50).toArray();
    return json(res,200,{ok:true,revisions:rows.map(row=>({version:row.version,title:row.title,content:row.content,authorId:String(row.authorId),createdAt:row.createdAt}))});
  }
  if (section === "documents" && childId && !suffix && req.method === "GET") {
    const row=await db.collection("workspaceDocuments").findOne({_id:new ObjectId(childId),tenantId:principal.tenantId,workspaceId,deletedAt:{$exists:false}});
    if(!row)return json(res,404,{ok:false,error:"document_not_found"});
    return json(res,200,{ok:true,document:{id:String(row._id),title:row.title,content:row.content,version:row.version,updatedAt:row.updatedAt}});
  }
  if (section === "documents" && childId && !suffix && req.method === "PATCH") {
    if(!canEdit)return json(res,403,{ok:false,error:"workspace_editor_required"});
    if(!(await writeAllowed(db,res,principal,"workspace-document",60)))return;
    const body=await readBody(req),expectedVersion=Number(body.expectedVersion),title=safeText(body.title,160),content=safeText(body.content,50000);
    if(!Number.isSafeInteger(expectedVersion)||expectedVersion<1||!title||!content)return json(res,400,{ok:false,error:"expected_version_title_and_content_required"});
    const documentId=new ObjectId(childId),existing=await db.collection("workspaceDocuments").findOne({_id:documentId,tenantId:principal.tenantId,workspaceId,deletedAt:{$exists:false}});
    if(!existing)return json(res,404,{ok:false,error:"document_not_found"});
    if(existing.version!==expectedVersion)return json(res,409,{ok:false,error:"document_version_conflict",currentVersion:existing.version});
    const nextVersion=expectedVersion+1;
    const updated=await db.collection("workspaceDocuments").updateOne({_id:documentId,tenantId:principal.tenantId,workspaceId,version:expectedVersion},{$set:{title,content,version:nextVersion,updatedBy:principal._id,updatedAt:now()}});
    if(updated.modifiedCount!==1)return json(res,409,{ok:false,error:"document_version_conflict"});
    await db.collection("workspaceDocumentRevisions").insertOne({tenantId:principal.tenantId,workspaceId,documentId,version:nextVersion,title,content,authorId:principal._id,createdAt:now()});
    await activity(db,principal.tenantId,workspaceId,principal._id,"workspace.document.update",documentId,"A shared document was updated");
    return json(res,200,{ok:true,document:{id:childId,title,content,version:nextVersion}});
  }
  if (section === "activity" && req.method === "GET") {
    const rows=await db.collection("workspaceActivity").find({tenantId:principal.tenantId,workspaceId}).sort({createdAt:-1}).limit(100).toArray();
    return json(res,200,{ok:true,events:rows.map(row=>({id:String(row._id),actorId:String(row.actorId),type:row.type,summary:row.summary,createdAt:row.createdAt}))});
  }
  return json(res,405,{ok:false,error:"method_not_allowed"});
}
