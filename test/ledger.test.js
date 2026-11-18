import test from "node:test";
import assert from "node:assert/strict";
import { ObjectId } from "mongodb";
import { routeLedger } from "../server/ledger.js";

process.env.SSIBUCHAT_SESSION_SECRET="test-session-pepper-for-ledger-integration";

function makeDb(){
  const accounts=[],journals=[],limits=new Map();
  const collections={
    ledgerAccounts:{
      insertOne:async row=>{row._id=new ObjectId();accounts.push(row);return {insertedId:row._id};},
      findOne:async filter=>accounts.find(row=>(!filter._id||String(row._id)===String(filter._id))&&row.tenantId===filter.tenantId&&String(row.ownerId)===String(filter.ownerId)&&(!filter.status||row.status===filter.status)&&(!filter.currency||row.currency===filter.currency))||null,
      find:filter=>cursor(accounts.filter(row=>row.tenantId===filter.tenantId&&String(row.ownerId)===String(filter.ownerId)&&row.status===filter.status))
    },
    journalEntries:{
      insertOne:async row=>{if(journals.some(item=>item.tenantId===row.tenantId&&String(item.ownerId)===String(row.ownerId)&&item.idempotencyKey===row.idempotencyKey)){const error=new Error("duplicate");error.code=11000;throw error;}if(row.reversalOf&&journals.some(item=>String(item.reversalOf)===String(row.reversalOf))){const error=new Error("duplicate reversal");error.code=11000;throw error;}row._id=new ObjectId();journals.push(row);return {insertedId:row._id};},
      findOne:async filter=>journals.find(row=>(!filter._id||String(row._id)===String(filter._id))&&row.tenantId===filter.tenantId&&String(row.ownerId)===String(filter.ownerId)&&(!filter.idempotencyKey||row.idempotencyKey===filter.idempotencyKey)&&(!filter.reversalOf||String(row.reversalOf)===String(filter.reversalOf))&&(!filter.status||row.status===filter.status))||null,
      find:filter=>cursor(journals.filter(row=>row.tenantId===filter.tenantId&&String(row.ownerId)===String(filter.ownerId)&&row.status===filter.status)),
      aggregate:()=>({toArray:async()=>{const grouped=new Map();for(const journal of journals.filter(row=>row.status==="posted"))for(const line of journal.entries){const key=String(line.accountId);const row=grouped.get(key)||{_id:{accountId:line.accountId,code:line.code,name:line.name,currency:journal.currency},debits:0,credits:0};row.debits+=line.debitMinor;row.credits+=line.creditMinor;grouped.set(key,row);}return [...grouped.values()];}})
    },
    rateLimits:{findOneAndUpdate:async filter=>{const count=(limits.get(filter.key)||0)+1;limits.set(filter.key,count);return {count};}}
  };
  function cursor(rows){return {sort(){return this;},limit(){return this;},toArray:async()=>rows};}
  return {accounts,journals,collection:name=>collections[name]};
}
async function invoke(db,user,method,path,body={}){
  const res={statusCode:200,setHeader(){},end(value){this.body=value;}};
  await routeLedger({method,url:path,body},res,db,user,path);
  return {status:res.statusCode,body:JSON.parse(res.body)};
}

test("double-entry ledger enforces balanced postings, idempotency, trial balance and immutable reversal",async()=>{
  const db=makeDb(),user={_id:new ObjectId(),tenantId:"tenant-1"};
  const cash=await invoke(db,user,"POST","/api/finance/ledger/accounts",{code:"CASH",name:"Cash",type:"asset",currency:"UGX"});
  const capital=await invoke(db,user,"POST","/api/finance/ledger/accounts",{code:"CAPITAL",name:"Owner capital",type:"equity",currency:"UGX"});
  assert.equal(cash.status,201);assert.equal(capital.status,201);
  const bad=await invoke(db,user,"POST","/api/finance/ledger/journals",{currency:"UGX",memo:"Unbalanced",idempotencyKey:"journal-idempotency-0001",entries:[{accountId:cash.body.account.id,debitMinor:100,creditMinor:0},{accountId:capital.body.account.id,debitMinor:0,creditMinor:90}]});
  assert.equal(bad.status,400);
  const body={currency:"UGX",memo:"Opening capital",idempotencyKey:"journal-idempotency-0002",entries:[{accountId:cash.body.account.id,debitMinor:100000,creditMinor:0},{accountId:capital.body.account.id,debitMinor:0,creditMinor:100000}]};
  const posted=await invoke(db,user,"POST","/api/finance/ledger/journals",body);
  assert.equal(posted.status,201);assert.equal(db.journals.length,1);
  const replay=await invoke(db,user,"POST","/api/finance/ledger/journals",body);
  assert.equal(replay.status,200);assert.equal(replay.body.idempotent,true);assert.equal(db.journals.length,1);
  const balance=await invoke(db,user,"GET","/api/finance/ledger/trial-balance");
  assert.equal(balance.status,200);assert.equal(balance.body.accounts.length,2);
  const reversal=await invoke(db,user,"POST","/api/finance/ledger/journals/"+posted.body.journal.id+"/reverse");
  assert.equal(reversal.status,201);assert.equal(db.journals.length,2);
  assert.equal(db.journals[1].entries[0].debitMinor,0);
  assert.equal(db.journals[1].entries[0].creditMinor,100000);
  const duplicate=await invoke(db,user,"POST","/api/finance/ledger/journals/"+posted.body.journal.id+"/reverse");
  assert.equal(duplicate.status,409);
});
