import { ObjectId } from "mongodb";
import { json } from "./security.js";

function serialize(row) {
  return {
    id:String(row._id), type:row.type, threadId:String(row.threadId),
    messageId:String(row.messageId), actorId:String(row.actorId),
    preview:row.preview, readAt:row.readAt || null, createdAt:row.createdAt
  };
}

export async function routeNotifications(req,res,db,principal,path) {
  if (path === "/api/notifications" && req.method === "GET") {
    const query = new URL(req.url || "/", "http://" + (req.headers?.host || "localhost")).searchParams;
    const requested = Number(query.get("limit") || 30);
    const limit = Number.isInteger(requested) ? Math.max(1,Math.min(100,requested)) : 30;
    const filter = { tenantId:principal.tenantId, userId:principal._id };
    const [rows,unreadCount] = await Promise.all([
      db.collection("notifications").find(filter).sort({createdAt:-1}).limit(limit).toArray(),
      db.collection("notifications").countDocuments({...filter,readAt:null})
    ]);
    return json(res,200,{ok:true,notifications:rows.map(serialize),unreadCount});
  }
  if (path === "/api/notifications/read-all" && req.method === "PATCH") {
    const result = await db.collection("notifications").updateMany(
      {tenantId:principal.tenantId,userId:principal._id,readAt:null},
      {$set:{readAt:new Date(),updatedAt:new Date()}}
    );
    return json(res,200,{ok:true,updated:result.modifiedCount || 0});
  }
  const match = path.match(/^\/api\/notifications\/([a-f0-9]{24})\/read$/i);
  if (match && req.method === "PATCH") {
    const result = await db.collection("notifications").updateOne(
      {_id:new ObjectId(match[1]),tenantId:principal.tenantId,userId:principal._id,readAt:null},
      {$set:{readAt:new Date(),updatedAt:new Date()}}
    );
    if (!result.matchedCount) {
      const exists = await db.collection("notifications").findOne({_id:new ObjectId(match[1]),tenantId:principal.tenantId,userId:principal._id});
      if (!exists) return json(res,404,{ok:false,error:"notification_not_found"});
    }
    return json(res,200,{ok:true,read:true,changed:result.modifiedCount===1});
  }
  return null;
}
