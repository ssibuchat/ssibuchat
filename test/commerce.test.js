import test from "node:test";
import assert from "node:assert/strict";
import { ObjectId } from "mongodb";
import { routeCommerce } from "../server/commerce.js";

process.env.SSIBUCHAT_SESSION_SECRET="test-session-pepper-for-commerce-integration";

function makeDb(){
  const merchantId=new ObjectId(),buyerId=new ObjectId(),businessId=new ObjectId(),productId=new ObjectId();
  const business={_id:businessId,tenantId:"tenant-1",ownerId:merchantId,name:"Merchant shop"};
  const product={_id:productId,tenantId:"tenant-1",ownerId:merchantId,businessId:String(businessId),name:"Coffee",description:"",priceMinor:2500,currency:"UGX",status:"active",trackInventory:true,stockQuantity:5};
  const orders=[],intents=[],limits=new Map();
  const collections={
    businesses:{findOne:async filter=>String(filter._id)===String(businessId)&&filter.tenantId==="tenant-1"?business:null},
    products:{
      findOne:async filter=>String(filter._id)===String(productId)&&filter.tenantId==="tenant-1"&&(!filter.ownerId||String(filter.ownerId)===String(product.ownerId))&&(!filter.status||product.status===filter.status)?product:null,
      find:filter=>cursor([product].filter(row=>row.tenantId===filter.tenantId&&String(row.businessId)===String(filter.businessId)&&row.status===filter.status)),
      updateOne:async(filter,update)=>{if(String(filter._id)!==String(productId)||filter.tenantId!=="tenant-1"||(filter.ownerId&&String(filter.ownerId)!==String(product.ownerId))||(filter.businessId&&String(filter.businessId)!==String(product.businessId))||(filter.stockQuantity?.$gte!==undefined&&product.stockQuantity<filter.stockQuantity.$gte)||(filter.trackInventory&&!product.trackInventory))return {modifiedCount:0};if(update.$inc)for(const [key,value] of Object.entries(update.$inc))product[key]=(product[key]||0)+value;if(update.$set)Object.assign(product,update.$set);return {modifiedCount:1};}
    },
    orders:{
      insertOne:async row=>{row._id=new ObjectId();orders.push(row);return {insertedId:row._id};},
      findOne:async filter=>orders.find(row=>(!filter._id||String(row._id)===String(filter._id))&&row.tenantId===filter.tenantId&&(!filter.buyerId||String(row.buyerId)===String(filter.buyerId))&&(!filter.merchantId||String(row.merchantId)===String(filter.merchantId))&&(!filter.idempotencyKey||row.idempotencyKey===filter.idempotencyKey)&&(!filter.paymentStatus||row.paymentStatus===filter.paymentStatus)&&(!filter.status||row.status===filter.status))||null,
      find:filter=>cursor(orders.filter(row=>row.tenantId===filter.tenantId&&filter.$or.some(cond=>cond.buyerId?String(row.buyerId)===String(cond.buyerId):String(row.merchantId)===String(cond.merchantId)))),
      updateOne:async(filter,update)=>{const row=orders.find(item=>String(item._id)===String(filter._id)&&rowMatch(item,filter));if(!row)return {modifiedCount:0};Object.assign(row,update.$set);return {modifiedCount:1};}
    },
    paymentIntents:{
      insertOne:async row=>{row._id=new ObjectId();intents.push(row);return {insertedId:row._id};},
      findOne:async filter=>intents.find(row=>String(row.orderId)===String(filter.orderId)&&row.tenantId===filter.tenantId&&(!filter.status?.$in||filter.status.$in.includes(row.status))&&(!filter._id||String(row._id)===String(filter._id))&&(!filter.buyerId||String(row.buyerId)===String(filter.buyerId))&&(!filter.status||filter.status===row.status))||null,
      updateOne:async(filter,update)=>{const row=intents.find(item=>String(item._id)===String(filter._id)&&(!filter.status||item.status===filter.status));if(!row)return {modifiedCount:0};Object.assign(row,update.$set);return {modifiedCount:1};}
    },
    rateLimits:{findOneAndUpdate:async filter=>{const count=(limits.get(filter.key)||0)+1;limits.set(filter.key,count);return {count};}}
  };
  function rowMatch(row,filter){return (!filter.buyerId||String(row.buyerId)===String(filter.buyerId))&&(!filter.merchantId||String(row.merchantId)===String(filter.merchantId))&&(!filter.status||row.status===filter.status)&&(!filter.paymentStatus||row.paymentStatus===filter.paymentStatus);}
  function cursor(rows){return {sort(){return this;},limit(){return this;},toArray:async()=>rows};}
  return {merchantId,buyerId,businessId,productId,business,product,orders,intents,collection:name=>collections[name]};
}
async function invoke(db,user,method,path,body={}){
  const res={statusCode:200,setHeader(){},end(value){this.body=value;}};
  await routeCommerce({method,url:path,headers:{host:"localhost"},body},res,db,user,path);
  return {status:res.statusCode,body:JSON.parse(res.body)};
}

test("buyer/merchant order separation, inventory reservation and sandbox payment lifecycle",async()=>{
  const db=makeDb(),buyer={_id:db.buyerId,tenantId:"tenant-1"},merchant={_id:db.merchantId,tenantId:"tenant-1"};
  const body={businessId:String(db.businessId),idempotencyKey:"commerce-order-idempotency-0001",items:[{productId:String(db.productId),quantity:2}]};
  const created=await invoke(db,buyer,"POST","/api/commerce/orders",body);
  assert.equal(created.status,201);
  assert.equal(created.body.order.totalMinor,5000);
  assert.equal(db.product.stockQuantity,5);
  const replay=await invoke(db,buyer,"POST","/api/commerce/orders",body);
  assert.equal(replay.status,200);assert.equal(replay.body.idempotent,true);
  const buyerOrders=await invoke(db,buyer,"GET","/api/commerce/orders");
  const merchantOrders=await invoke(db,merchant,"GET","/api/commerce/orders");
  assert.equal(buyerOrders.body.orders.length,1);assert.equal(merchantOrders.body.orders.length,1);
  const disabled=await invoke(db,buyer,"POST","/api/commerce/orders/"+created.body.order.id+"/checkout",{idempotencyKey:"checkout-idempotency-key-0001"});
  assert.equal(disabled.status,503);
  process.env.SSIBUCHAT_PAYMENT_MODE="sandbox";process.env.SSIBUCHAT_ALLOW_SANDBOX_SETTLEMENT="true";
  const checkout=await invoke(db,buyer,"POST","/api/commerce/orders/"+created.body.order.id+"/checkout",{idempotencyKey:"checkout-idempotency-key-0001"});
  assert.equal(checkout.status,201);assert.equal(db.product.stockQuantity,3);
  const settled=await invoke(db,buyer,"POST","/api/commerce/payments/"+checkout.body.paymentIntent.id+"/sandbox-settle",{});
  assert.equal(settled.status,200);assert.equal(db.orders[0].paymentStatus,"paid");
  const merchantUpdate=await invoke(db,merchant,"PATCH","/api/commerce/orders/"+created.body.order.id+"/status",{status:"processing"});
  assert.equal(merchantUpdate.status,200);assert.equal(db.orders[0].status,"processing");
  const buyerInventory=await invoke(db,buyer,"PATCH","/api/commerce/products/"+db.productId+"/inventory",{stockQuantity:99,trackInventory:true});
  assert.equal(buyerInventory.status,404);
});
