import { ObjectId } from "mongodb";
import { json, readBody, safeText } from "./security.js";
import { consumeRateLimit } from "./rate-limit.js";

const now=()=>new Date();
const currencies=value=>/^[A-Z]{3}$/.test(String(value||""));
export async function routeLedger(req,res,db,principal,path){
  if(!path.startsWith("/api/finance/ledger"))return null;
  if(path==="/api/finance/ledger/accounts"){
    if(req.method==="GET"){
      const rows=await db.collection("ledgerAccounts").find({tenantId:principal.tenantId,ownerId:principal._id,status:"active"}).sort({createdAt:1}).limit(200).toArray();
      return json(res,200,{ok:true,accounts:rows.map(row=>({id:String(row._id),code:row.code,name:row.name,type:row.type,currency:row.currency}))});
    }
    if(req.method==="POST"){
      const throttle=await consumeRateLimit(db,"ledger-account",String(principal._id),30,60*60*1000);
      if(!throttle.allowed){res.setHeader("Retry-After",String(throttle.retryAfterSeconds));return json(res,429,{ok:false,error:"rate_limit_exceeded"});}
      const b=await readBody(req),code=safeText(b.code,24).toUpperCase(),name=safeText(b.name,120),type=b.type,currency=String(b.currency||"").toUpperCase();
      if(!/^[A-Z0-9_-]{2,24}$/.test(code)||!name||!["asset","liability","equity","income","expense"].includes(type)||!currencies(currency))return json(res,400,{ok:false,error:"valid_account_code_name_type_and_currency_required"});
      try{
        const created=await db.collection("ledgerAccounts").insertOne({tenantId:principal.tenantId,ownerId:principal._id,code,name,type,currency,status:"active",createdAt:now()});
        return json(res,201,{ok:true,account:{id:String(created.insertedId),code,name,type,currency}});
      }catch(error){if(error?.code===11000)return json(res,409,{ok:false,error:"account_code_already_exists"});throw error;}
    }
    return json(res,405,{ok:false,error:"method_not_allowed"});
  }
  if(path==="/api/finance/ledger/journals"&&req.method==="GET"){
    const rows=await db.collection("journalEntries").find({tenantId:principal.tenantId,ownerId:principal._id,status:"posted"}).sort({createdAt:-1}).limit(100).toArray();
    return json(res,200,{ok:true,journals:rows.map(row=>({id:String(row._id),currency:row.currency,memo:row.memo,totalMinor:row.totalDebitMinor,createdAt:row.createdAt,reversalOf:row.reversalOf?String(row.reversalOf):null,entries:row.entries}))});
  }
  if(path==="/api/finance/ledger/journals"&&req.method==="POST"){
    const throttle=await consumeRateLimit(db,"ledger-journal",String(principal._id),60,60*60*1000);
    if(!throttle.allowed){res.setHeader("Retry-After",String(throttle.retryAfterSeconds));return json(res,429,{ok:false,error:"rate_limit_exceeded"});}
    const b=await readBody(req),currency=String(b.currency||"").toUpperCase(),memo=safeText(b.memo,500),key=safeText(b.idempotencyKey,120);
    if(!currencies(currency)||!memo||key.length<16||!Array.isArray(b.entries)||b.entries.length<2||b.entries.length>20)return json(res,400,{ok:false,error:"currency_memo_idempotency_key_and_two_to_twenty_entries_required"});
    const entries=[],accountIds=new Set();let debit=0,credit=0;
    for(const item of b.entries){
      if(!ObjectId.isValid(String(item.accountId||"")))return json(res,400,{ok:false,error:"invalid_ledger_account"});
      const debitMinor=Number(item.debitMinor||0),creditMinor=Number(item.creditMinor||0);
      if(!Number.isSafeInteger(debitMinor)||!Number.isSafeInteger(creditMinor)||debitMinor<0||creditMinor<0||((debitMinor>0)===(creditMinor>0)))return json(res,400,{ok:false,error:"each_line_requires_one_positive_debit_or_credit"});
      const accountId=new ObjectId(item.accountId);
      if(accountIds.has(String(accountId)))return json(res,400,{ok:false,error:"duplicate_account_line_not_allowed"});
      accountIds.add(String(accountId));
      const account=await db.collection("ledgerAccounts").findOne({_id:accountId,tenantId:principal.tenantId,ownerId:principal._id,status:"active",currency});
      if(!account)return json(res,404,{ok:false,error:"ledger_account_not_found_or_currency_mismatch"});
      debit+=debitMinor;credit+=creditMinor;
      if(!Number.isSafeInteger(debit)||!Number.isSafeInteger(credit))return json(res,400,{ok:false,error:"journal_total_out_of_range"});
      entries.push({accountId,code:account.code,name:account.name,debitMinor,creditMinor});
    }
    if(debit<=0||debit!==credit)return json(res,400,{ok:false,error:"journal_debits_must_equal_credits"});
    const row={tenantId:principal.tenantId,ownerId:principal._id,createdBy:principal._id,currency,memo,idempotencyKey:key,totalDebitMinor:debit,totalCreditMinor:credit,entries,status:"posted",createdAt:now()};
    try{
      const created=await db.collection("journalEntries").insertOne(row);
      return json(res,201,{ok:true,journal:{id:String(created.insertedId),currency,memo,totalMinor:debit,entries:entries.map(entry=>({...entry,accountId:String(entry.accountId)}))}});
    }catch(error){
      if(error?.code===11000){const existing=await db.collection("journalEntries").findOne({tenantId:principal.tenantId,ownerId:principal._id,idempotencyKey:key});if(existing)return json(res,200,{ok:true,idempotent:true,journal:{id:String(existing._id),currency:existing.currency,memo:existing.memo,totalMinor:existing.totalDebitMinor}});}
      throw error;
    }
  }
  if(path==="/api/finance/ledger/trial-balance"&&req.method==="GET"){
    const rows=await db.collection("journalEntries").aggregate([
      {$match:{tenantId:principal.tenantId,ownerId:principal._id,status:"posted"}},
      {$unwind:"$entries"},
      {$group:{_id:{accountId:"$entries.accountId",code:"$entries.code",name:"$entries.name",currency:"$currency"},debits:{$sum:"$entries.debitMinor"},credits:{$sum:"$entries.creditMinor"}}},
      {$sort:{"_id.code":1}}
    ]).toArray();
    return json(res,200,{ok:true,accounts:rows.map(row=>({accountId:String(row._id.accountId),code:row._id.code,name:row._id.name,currency:row._id.currency,debitsMinor:row.debits,creditsMinor:row.credits,netMinor:row.debits-row.credits}))});
  }
  const reverse=path.match(/^\/api\/finance\/ledger\/journals\/([a-f0-9]{24})\/reverse$/i);
  if(reverse&&req.method==="POST"){
    const original=await db.collection("journalEntries").findOne({_id:new ObjectId(reverse[1]),tenantId:principal.tenantId,ownerId:principal._id,status:"posted"});
    if(!original)return json(res,404,{ok:false,error:"journal_not_found"});
    const existing=await db.collection("journalEntries").findOne({tenantId:principal.tenantId,ownerId:principal._id,reversalOf:original._id});
    if(existing)return json(res,409,{ok:false,error:"journal_already_reversed",reversalId:String(existing._id)});
    const reversal={tenantId:principal.tenantId,ownerId:principal._id,createdBy:principal._id,currency:original.currency,memo:"Reversal: "+original.memo,idempotencyKey:"reversal-"+String(original._id),totalDebitMinor:original.totalCreditMinor,totalCreditMinor:original.totalDebitMinor,entries:original.entries.map(entry=>({...entry,debitMinor:entry.creditMinor,creditMinor:entry.debitMinor})),status:"posted",reversalOf:original._id,createdAt:now()};
    const created=await db.collection("journalEntries").insertOne(reversal);
    return json(res,201,{ok:true,reversalId:String(created.insertedId)});
  }
  return json(res,405,{ok:false,error:"method_not_allowed"});
}
