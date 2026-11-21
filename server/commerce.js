import { ObjectId } from "mongodb";
import { json, readBody, safeText, hashToken } from "./security.js";
import { consumeRateLimit } from "./rate-limit.js";

const now=()=>new Date();
const validId=value=>ObjectId.isValid(String(value||""));
const inventoryReservations=async(db,tenantId,items)=>{
  const reserved=[];
  for(const item of items){
    if(!item.trackInventory)continue;
    const result=await db.collection("products").updateOne(
      {_id:item.productId,tenantId,businessId:String(item.businessId),trackInventory:true,stockQuantity:{$gte:item.quantity},status:"active"},
      {$inc:{stockQuantity:-item.quantity},$set:{updatedAt:now()}}
    );
    if(result.modifiedCount!==1){
      for(const previous of reserved)await db.collection("products").updateOne({_id:previous.productId,tenantId},{$inc:{stockQuantity:previous.quantity}});
      return false;
    }
    reserved.push({productId:item.productId,quantity:item.quantity});
  }
  return true;
};
export async function routeCommerce(req,res,db,principal,path){
  if(!path.startsWith("/api/commerce"))return null;
  if(path==="/api/commerce/storefronts"&&req.method==="GET"){
    const u=new URL(req.url||"/","http://"+(req.headers?.host||"localhost"));
    const businessId=u.searchParams.get("businessId");
    if(!businessId){
      const businesses=await db.collection("businesses").find({tenantId:principal.tenantId}).sort({createdAt:-1}).limit(100).toArray();
      return json(res,200,{ok:true,storefronts:businesses.map(business=>({id:String(business._id),name:business.name,merchantId:String(business.ownerId)}))});
    }
    if(!validId(businessId))return json(res,400,{ok:false,error:"valid_business_id_required"});
    const business=await db.collection("businesses").findOne({_id:new ObjectId(businessId),tenantId:principal.tenantId});
    if(!business)return json(res,404,{ok:false,error:"storefront_not_found"});
    const products=await db.collection("products").find({tenantId:principal.tenantId,businessId:String(business._id),status:"active"}).sort({createdAt:-1}).limit(100).toArray();
    return json(res,200,{ok:true,storefront:{id:String(business._id),name:business.name,merchantId:String(business.ownerId)},products:products.map(product=>({id:String(product._id),name:product.name,description:product.description,priceMinor:product.priceMinor,currency:product.currency,sku:product.sku||null,available:product.trackInventory?product.stockQuantity>0:true}))});
  }
  if(path==="/api/commerce/orders"&&req.method==="GET"){
    const rows=await db.collection("orders").find({tenantId:principal.tenantId,$or:[{buyerId:principal._id},{merchantId:principal._id}]}).sort({createdAt:-1}).limit(100).toArray();
    const ids=rows.map(row=>row._id),intents=ids.length?await db.collection("paymentIntents").find({tenantId:principal.tenantId,orderId:{$in:ids}}).toArray():[];
    return json(res,200,{ok:true,orders:rows.map(row=>{const intent=intents.find(item=>String(item.orderId)===String(row._id));return {id:String(row._id),businessId:String(row.businessId),buyerId:String(row.buyerId),merchantId:String(row.merchantId),items:row.items,totalMinor:row.totalMinor,currency:row.currency,status:row.status,paymentStatus:row.paymentStatus,paymentIntentId:intent?String(intent._id):null,sandboxSettlementEnabled:process.env.SSIBUCHAT_PAYMENT_MODE==="sandbox"&&process.env.SSIBUCHAT_ALLOW_SANDBOX_SETTLEMENT==="true",createdAt:row.createdAt};})});
  }
  if(path==="/api/commerce/orders"&&req.method==="POST"){
    const throttle=await consumeRateLimit(db,"commerce-order",String(principal._id),20,60*60*1000);
    if(!throttle.allowed){res.setHeader("Retry-After",String(throttle.retryAfterSeconds));return json(res,429,{ok:false,error:"rate_limit_exceeded"});}
    const b=await readBody(req),businessId=String(b.businessId||""),key=safeText(b.idempotencyKey,120);
    if(!validId(businessId)||!Array.isArray(b.items)||b.items.length<1||b.items.length>50||key.length<16)return json(res,400,{ok:false,error:"business_items_and_idempotency_key_required"});
    const business=await db.collection("businesses").findOne({_id:new ObjectId(businessId),tenantId:principal.tenantId});
    if(!business)return json(res,404,{ok:false,error:"storefront_not_found"});
    const items=[];let totalMinor=0,currency="";
    for(const input of b.items){
      const quantity=Number(input.quantity);
      if(!validId(input.productId)||!Number.isSafeInteger(quantity)||quantity<1||quantity>1000)return json(res,400,{ok:false,error:"invalid_order_item"});
      const product=await db.collection("products").findOne({_id:new ObjectId(input.productId),tenantId:principal.tenantId,status:"active"});
      if(!product||String(product.businessId)!==String(business._id)||!Number.isSafeInteger(product.priceMinor)||product.priceMinor<0)return json(res,400,{ok:false,error:"product_unavailable"});
      if(currency&&currency!==product.currency)return json(res,400,{ok:false,error:"mixed_currency_order_not_supported"});
      if(product.trackInventory&&(!Number.isSafeInteger(product.stockQuantity)||product.stockQuantity<quantity))return json(res,409,{ok:false,error:"insufficient_inventory"});
      currency=product.currency;totalMinor+=product.priceMinor*quantity;
      if(!Number.isSafeInteger(totalMinor))return json(res,400,{ok:false,error:"order_total_out_of_range"});
      items.push({productId:product._id,businessId:String(business._id),name:product.name,sku:product.sku||null,unitPriceMinor:product.priceMinor,quantity,trackInventory:product.trackInventory===true});
    }
    const requestHash=hashToken(JSON.stringify({businessId,items:items.map(item=>({productId:String(item.productId),quantity:item.quantity}))}));
    const row={tenantId:principal.tenantId,ownerId:principal._id,buyerId:principal._id,merchantId:business.ownerId,businessId:business._id,items,currency,totalMinor,note:safeText(b.note,1000),status:"draft",paymentStatus:"not_started",idempotencyKey:key,requestHash,createdAt:now(),updatedAt:now()};
    try{
      const created=await db.collection("orders").insertOne(row);
      return json(res,201,{ok:true,order:{id:String(created.insertedId),businessId:String(business._id),items,totalMinor,currency,status:"draft",paymentStatus:"not_started"}});
    }catch(error){
      if(error?.code===11000){const existing=await db.collection("orders").findOne({tenantId:principal.tenantId,buyerId:principal._id,idempotencyKey:key});if(existing){if(existing.requestHash!==requestHash)return json(res,409,{ok:false,error:"idempotency_key_reused_with_different_payload"});return json(res,200,{ok:true,idempotent:true,order:{id:String(existing._id),status:existing.status,paymentStatus:existing.paymentStatus,totalMinor:existing.totalMinor,currency:existing.currency}});}}
      throw error;
    }
  }
  const inventory=path.match(/^\/api\/commerce\/products\/([a-f0-9]{24})\/inventory$/i);
  if(inventory&&req.method==="PATCH"){
    const b=await readBody(req),stockQuantity=Number(b.stockQuantity),trackInventory=b.trackInventory===true;
    if(!Number.isSafeInteger(stockQuantity)||stockQuantity<0||stockQuantity>1_000_000_000)return json(res,400,{ok:false,error:"invalid_stock_quantity"});
    const product=await db.collection("products").findOne({_id:new ObjectId(inventory[1]),tenantId:principal.tenantId,ownerId:principal._id});
    if(!product)return json(res,404,{ok:false,error:"merchant_product_not_found"});
    await db.collection("products").updateOne({_id:product._id,tenantId:principal.tenantId,ownerId:principal._id},{$set:{stockQuantity,trackInventory,updatedAt:now()}});
    return json(res,200,{ok:true,inventory:{stockQuantity,trackInventory}});
  }
  const orderStatus=path.match(/^\/api\/commerce\/orders\/([a-f0-9]{24})\/status$/i);
  if(orderStatus&&req.method==="PATCH"){
    const b=await readBody(req),status=b.status;
    if(!["accepted","processing","shipped","completed","cancelled"].includes(status))return json(res,400,{ok:false,error:"invalid_order_status"});
    const order=await db.collection("orders").findOne({_id:new ObjectId(orderStatus[1]),tenantId:principal.tenantId,merchantId:principal._id});
    if(!order)return json(res,404,{ok:false,error:"merchant_order_not_found"});
    if(order.status==="cancelled"||order.status==="completed")return json(res,409,{ok:false,error:"order_already_final"});
    if(status==="cancelled"&&order.paymentStatus==="paid")return json(res,409,{ok:false,error:"paid_order_requires_provider_refund"});
    if(status==="cancelled"&&order.status==="awaiting_payment"){
      for(const item of order.items.filter(row=>row.trackInventory))await db.collection("products").updateOne({_id:item.productId,tenantId:principal.tenantId},{$inc:{stockQuantity:item.quantity}});
    }
    await db.collection("orders").updateOne({_id:order._id,tenantId:principal.tenantId,merchantId:principal._id},{$set:{status,updatedAt:now()}});
    return json(res,200,{ok:true,status});
  }
  const checkout=path.match(/^\/api\/commerce\/orders\/([a-f0-9]{24})\/checkout$/i);
  if(checkout&&req.method==="POST"){
    if(process.env.SSIBUCHAT_PAYMENT_MODE!=="sandbox")return json(res,503,{ok:false,error:"payment_provider_not_configured"});
    const b=await readBody(req),key=safeText(b.idempotencyKey,120);
    if(key.length<16)return json(res,400,{ok:false,error:"checkout_idempotency_key_required"});
    const order=await db.collection("orders").findOne({_id:new ObjectId(checkout[1]),tenantId:principal.tenantId,buyerId:principal._id});
    if(!order)return json(res,404,{ok:false,error:"buyer_order_not_found"});
    if(order.paymentStatus==="paid")return json(res,200,{ok:true,paid:true});
    const existing=await db.collection("paymentIntents").findOne({tenantId:principal.tenantId,orderId:order._id,status:{$in:["pending","succeeded"]}});
    if(existing)return json(res,200,{ok:true,paymentIntent:{id:String(existing._id),status:existing.status,provider:"sandbox",amountMinor:existing.amountMinor,currency:existing.currency}});
    if(order.status!=="draft")return json(res,409,{ok:false,error:"order_not_checkout_ready"});
    const reserved=await inventoryReservations(db,principal.tenantId,order.items);
    if(!reserved)return json(res,409,{ok:false,error:"inventory_reservation_failed"});
    const intent={tenantId:principal.tenantId,orderId:order._id,buyerId:principal._id,merchantId:order.merchantId,provider:"sandbox",status:"pending",amountMinor:order.totalMinor,currency:order.currency,idempotencyKey:key,createdAt:now(),updatedAt:now()};
    let created;
    try{created=await db.collection("paymentIntents").insertOne(intent);}
    catch{
      for(const item of order.items.filter(row=>row.trackInventory))await db.collection("products").updateOne({_id:item.productId,tenantId:principal.tenantId},{$inc:{stockQuantity:item.quantity}});
      return json(res,503,{ok:false,error:"payment_intent_creation_failed"});
    }
    const changed=await db.collection("orders").updateOne({_id:order._id,tenantId:principal.tenantId,buyerId:principal._id,status:"draft"},{$set:{status:"awaiting_payment",paymentStatus:"pending",updatedAt:now()}});
    if(changed.modifiedCount!==1){
      await db.collection("paymentIntents").updateOne({_id:created.insertedId,status:"pending"},{$set:{status:"cancelled",updatedAt:now()}});
      for(const item of order.items.filter(row=>row.trackInventory))await db.collection("products").updateOne({_id:item.productId,tenantId:principal.tenantId},{$inc:{stockQuantity:item.quantity}});
      return json(res,409,{ok:false,error:"order_checkout_state_changed"});
    }
    return json(res,201,{ok:true,paymentIntent:{id:String(created.insertedId),status:"pending",provider:"sandbox",amountMinor:intent.amountMinor,currency:intent.currency,sandboxSettlementEnabled:process.env.SSIBUCHAT_ALLOW_SANDBOX_SETTLEMENT==="true"}});
  }
  const settle=path.match(/^\/api\/commerce\/payments\/([a-f0-9]{24})\/sandbox-settle$/i);
  if(settle&&req.method==="POST"){
    if(process.env.SSIBUCHAT_PAYMENT_MODE!=="sandbox"||process.env.SSIBUCHAT_ALLOW_SANDBOX_SETTLEMENT!=="true")return json(res,403,{ok:false,error:"sandbox_settlement_disabled"});
    const intent=await db.collection("paymentIntents").findOne({_id:new ObjectId(settle[1]),tenantId:principal.tenantId,buyerId:principal._id});
    if(intent?.status==="succeeded")return json(res,200,{ok:true,settled:true,sandbox:true,idempotent:true});
    if(!intent||intent.status!=="pending")return json(res,404,{ok:false,error:"pending_sandbox_payment_not_found"});
    const claimed=await db.collection("paymentIntents").updateOne({_id:intent._id,status:"pending"},{$set:{status:"succeeded",settledAt:now(),updatedAt:now()}});
    if(claimed.modifiedCount!==1)return json(res,409,{ok:false,error:"payment_already_processed"});
    await db.collection("orders").updateOne({_id:intent.orderId,tenantId:principal.tenantId,paymentStatus:"pending"},{$set:{paymentStatus:"paid",status:"confirmed",paidAt:now(),updatedAt:now()}});
    return json(res,200,{ok:true,settled:true,sandbox:true});
  }
  return json(res,405,{ok:false,error:"method_not_allowed"});
}
