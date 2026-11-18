import React, { useEffect, useState } from "react";

const resources = {
  work: ["workspaces", "projects", "tasks", "events"],
  commerce: ["businesses", "products", "orders"],
  finance: ["finance"],
  media: ["media"]
};
const labels = { workspaces: "Workspaces", projects: "Projects", tasks: "Tasks", events: "Calendar", businesses: "Businesses", products: "Products", orders: "Orders", finance: "Finance records", media: "Media assets" };

async function api(path, options = {}) {
  const response = await fetch(path, { credentials: "include", headers: { "content-type": "application/json", ...(options.headers || {}) }, ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "request_failed");
  return data;
}
function Field({ label, value, onChange, type = "text", required = false, placeholder = "" }) {
  return <label className="module-field">{label}<input type={type} value={value} onChange={e => onChange(e.target.value)} required={required} placeholder={placeholder}/></label>;
}
export default function ModuleWorkspace({ active, user }) {
  const [resource, setResource] = useState("tasks");
  const [items, setItems] = useState([]);
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [prefs, setPrefs] = useState({ layout: "comfortable", contextualPanels: true, modules: ["connect","work","commerce","finance","media","ai"] });
  const [consent, setConsent] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [answer, setAnswer] = useState("");
  const [selectedWorkspace, setSelectedWorkspace] = useState("");
  const [workspaceMembers, setWorkspaceMembers] = useState([]);
  const [workspaceDocuments, setWorkspaceDocuments] = useState([]);
  const [workspaceActivity, setWorkspaceActivity] = useState([]);
  const [inviteUsername, setInviteUsername] = useState("");
  const [inviteRole, setInviteRole] = useState("editor");
  const [inviteToken, setInviteToken] = useState("");
  const [workspaceInviteToken, setWorkspaceInviteToken] = useState("");
  const [documentTitle, setDocumentTitle] = useState("");
  const [documentContent, setDocumentContent] = useState("");
  const [activeDocument, setActiveDocument] = useState(null);
  const [ledgerAccounts, setLedgerAccounts] = useState([]);
  const [ledgerJournals, setLedgerJournals] = useState([]);
  const [trialBalance, setTrialBalance] = useState([]);
  const [storefronts, setStorefronts] = useState([]);
  const [selectedStorefront, setSelectedStorefront] = useState("");
  const [storefrontProducts, setStorefrontProducts] = useState([]);
  const [selectedStoreProduct, setSelectedStoreProduct] = useState("");
  const [orderQuantity, setOrderQuantity] = useState("1");
  const [commerceOrders, setCommerceOrders] = useState([]);
  const [checkoutIntent, setCheckoutIntent] = useState(null);
  const [inventoryDrafts, setInventoryDrafts] = useState({});
  const [ledgerAccountForm, setLedgerAccountForm] = useState({code:"",name:"",type:"asset",currency:"UGX"});
  const [ledgerJournalForm, setLedgerJournalForm] = useState({debitAccountId:"",creditAccountId:"",amountMinor:"",memo:""});

  useEffect(() => {
    if (active === "work") setResource("tasks");
    if (active === "commerce") setResource("businesses");
    if (active === "finance") setResource("finance");
    if (active === "media") setResource("media");
    setError(""); setMessage(""); setForm({});
  }, [active]);

  useEffect(() => {
    if (!user || !resources[active]) { setItems([]); return; }
    let cancelled = false;
    api("/api/modules/" + resource).then(d => { if (!cancelled) { setItems(d.items || []); if (resource === "workspaces" && d.items?.length && !selectedWorkspace) setSelectedWorkspace(d.items[0].id); } }).catch(e => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [active, resource, user?.id]);

  useEffect(() => {
    if (!user || active !== "work" || resource !== "workspaces" || !selectedWorkspace) { setWorkspaceMembers([]); setWorkspaceDocuments([]); setWorkspaceActivity([]); return; }
    let cancelled = false;
    Promise.all([
      api("/api/workspaces/"+selectedWorkspace+"/members"),
      api("/api/workspaces/"+selectedWorkspace+"/documents"),
      api("/api/workspaces/"+selectedWorkspace+"/activity")
    ]).then(([members,documents,activity])=>{if(!cancelled){setWorkspaceMembers(members.members||[]);setWorkspaceDocuments(documents.documents||[]);setWorkspaceActivity(activity.events||[]);}}).catch(e=>{if(!cancelled)setError(e.message);});
    return ()=>{cancelled=true;};
  }, [active,resource,selectedWorkspace,user?.id]);

  useEffect(() => {
    if (!user || active !== "work") return;
    api("/api/workspace/preferences").then(d => setPrefs(d.preferences)).catch(() => {});
  }, [active, user?.id]);

  useEffect(() => {
    if (!user || active !== "ai") return;
    api("/api/ai/consent").then(d => setConsent(d.enabled === true)).catch(e => setError(e.message));
  }, [active, user?.id]);
  useEffect(() => {
    if (!user || active !== "finance") return;
    refreshLedger().catch(e=>setError(e.message));
  }, [active,user?.id]);
  useEffect(() => {
    if (!user || active !== "commerce" || resource !== "orders") return;
    let cancelled=false;
    Promise.all([api("/api/commerce/storefronts"),api("/api/commerce/orders")]).then(([stores,orders])=>{if(!cancelled){setStorefronts(stores.storefronts||[]);setCommerceOrders(orders.orders||[]);if(!selectedStorefront&&stores.storefronts?.length)setSelectedStorefront(stores.storefronts[0].id);}}).catch(e=>{if(!cancelled)setError(e.message);});
    return ()=>{cancelled=true;};
  }, [active,resource,user?.id]);
  useEffect(() => {
    if (!user || active !== "commerce" || resource !== "orders" || !selectedStorefront) {setStorefrontProducts([]);return;}
    let cancelled=false;
    api("/api/commerce/storefronts?businessId="+encodeURIComponent(selectedStorefront)).then(d=>{if(!cancelled){setStorefrontProducts(d.products||[]);if(!selectedStoreProduct&&d.products?.length)setSelectedStoreProduct(d.products[0].id);}}).catch(e=>{if(!cancelled)setError(e.message);});
    return ()=>{cancelled=true;};
  }, [active,resource,selectedStorefront,user?.id]);

  function set(name, value) { setForm(current => ({ ...current, [name]: value })); }
  async function refresh() {
    const d = await api("/api/modules/" + resource);
    setItems(d.items || []);
  }
  async function create(e) {
    e.preventDefault(); setBusy(true); setError(""); setMessage("");
    try {
      const body = { ...form };
      if (resource === "orders") body.items = [{ productId: body.productId, quantity: Number(body.quantity || 1) }];
      if (resource === "products") { body.priceMinor = Number(body.priceMinor); body.status = body.status || "active"; }
      if (resource === "finance") body.amountMinor = Number(body.amountMinor);
      if (resource === "media") body.sizeBytes = Number(body.sizeBytes || 0);
      const saved = await api("/api/modules/" + resource, { method: "POST", body: JSON.stringify(body) });
      setForm({}); await refresh(); if (resource === "workspaces" && saved.item?.id) setSelectedWorkspace(saved.item.id); setMessage("Saved.");
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function refreshCommerce() {
    const [stores,orders]=await Promise.all([api("/api/commerce/storefronts"),api("/api/commerce/orders")]);
    setStorefronts(stores.storefronts||[]);setCommerceOrders(orders.orders||[]);
    if(!selectedStorefront&&stores.storefronts?.length)setSelectedStorefront(stores.storefronts[0].id);
  }
  async function createCommerceOrder(e) {
    e.preventDefault();setBusy(true);setError("");setMessage("");setCheckoutIntent(null);
    try { const product=storefrontProducts.find(item=>item.id===selectedStoreProduct);if(!product)throw new Error("select_product");await api("/api/commerce/orders",{method:"POST",body:JSON.stringify({businessId:selectedStorefront,idempotencyKey:crypto.randomUUID(),items:[{productId:product.id,quantity:Number(orderQuantity)}]})});await refreshCommerce();setMessage("Order created. Checkout is available when a payment provider or sandbox is enabled."); }
    catch(e){setError(e.message);}finally{setBusy(false);}
  }
  async function checkoutCommerceOrder(order) {
    setBusy(true);setError("");setMessage("");
    try { const d=await api("/api/commerce/orders/"+order.id+"/checkout",{method:"POST",body:JSON.stringify({idempotencyKey:crypto.randomUUID()})});setCheckoutIntent(d.paymentIntent||null);await refreshCommerce();setMessage("Checkout intent created."); }
    catch(e){setError(e.message);}finally{setBusy(false);}
  }
  async function settleSandboxPayment() {
    if(!checkoutIntent?.id)return;setBusy(true);setError("");setMessage("");
    try { await api("/api/commerce/payments/"+checkoutIntent.id+"/sandbox-settle",{method:"POST",body:"{}"});setCheckoutIntent(null);await refreshCommerce();setMessage("Sandbox payment settled. No real funds were moved."); }
    catch(e){setError(e.message);}finally{setBusy(false);}
  }
  async function updateCommerceOrder(order,status) {
    setBusy(true);setError("");setMessage("");
    try { await api("/api/commerce/orders/"+order.id+"/status",{method:"PATCH",body:JSON.stringify({status})});await refreshCommerce();setMessage("Merchant order status updated."); }
    catch(e){setError(e.message);}finally{setBusy(false);}
  }
  async function saveProductInventory(item) {
    const draft=inventoryDrafts[item.id]||{stockQuantity:item.stockQuantity||0,trackInventory:item.trackInventory===true};
    setBusy(true);setError("");setMessage("");
    try { await api("/api/commerce/products/"+item.id+"/inventory",{method:"PATCH",body:JSON.stringify({stockQuantity:Number(draft.stockQuantity),trackInventory:draft.trackInventory})});await refresh();setMessage("Inventory updated."); }
    catch(e){setError(e.message);}finally{setBusy(false);}
  }
  async function refreshLedger() {
    const [accounts,journals,balance]=await Promise.all([
      api("/api/finance/ledger/accounts"),
      api("/api/finance/ledger/journals"),
      api("/api/finance/ledger/trial-balance")
    ]);
    setLedgerAccounts(accounts.accounts||[]);setLedgerJournals(journals.journals||[]);setTrialBalance(balance.accounts||[]);
  }
  async function createLedgerAccount(e) {
    e.preventDefault();setBusy(true);setError("");setMessage("");
    try { await api("/api/finance/ledger/accounts",{method:"POST",body:JSON.stringify(ledgerAccountForm)});setLedgerAccountForm({code:"",name:"",type:"asset",currency:"UGX"});await refreshLedger();setMessage("Ledger account created."); }
    catch(e){setError(e.message);}finally{setBusy(false);}
  }
  async function postLedgerJournal(e) {
    e.preventDefault();setBusy(true);setError("");setMessage("");
    try {
      const debit=ledgerAccounts.find(account=>account.id===ledgerJournalForm.debitAccountId);
      const credit=ledgerAccounts.find(account=>account.id===ledgerJournalForm.creditAccountId);
      if(!debit||!credit)throw new Error("select_two_accounts");
      await api("/api/finance/ledger/journals",{method:"POST",body:JSON.stringify({currency:debit.currency,memo:ledgerJournalForm.memo,idempotencyKey:crypto.randomUUID(),entries:[{accountId:debit.id,debitMinor:Number(ledgerJournalForm.amountMinor),creditMinor:0},{accountId:credit.id,debitMinor:0,creditMinor:Number(ledgerJournalForm.amountMinor)}]})});
      setLedgerJournalForm({debitAccountId:"",creditAccountId:"",amountMinor:"",memo:""});await refreshLedger();setMessage("Balanced journal posted.");
    }catch(e){setError(e.message);}finally{setBusy(false);}
  }
  async function reverseLedgerJournal(id) {
    setBusy(true);setError("");setMessage("");
    try { await api("/api/finance/ledger/journals/"+id+"/reverse",{method:"POST",body:"{}"});await refreshLedger();setMessage("Reversal journal posted."); }
    catch(e){setError(e.message);}finally{setBusy(false);}
  }
  async function refreshWorkspace() {
    if (!selectedWorkspace) return;
    const [members,documents,activity] = await Promise.all([
      api("/api/workspaces/"+selectedWorkspace+"/members"),
      api("/api/workspaces/"+selectedWorkspace+"/documents"),
      api("/api/workspaces/"+selectedWorkspace+"/activity")
    ]);
    setWorkspaceMembers(members.members||[]); setWorkspaceDocuments(documents.documents||[]); setWorkspaceActivity(activity.events||[]);
  }
  async function inviteToWorkspace(e) {
    e.preventDefault(); setBusy(true); setError(""); setMessage(""); setInviteToken("");
    try { const d=await api("/api/workspaces/"+selectedWorkspace+"/invites",{method:"POST",body:JSON.stringify({username:inviteUsername,role:inviteRole})}); setInviteToken(d.invite.token); setInviteUsername(""); await refreshWorkspace(); setMessage("Invitation created. Share the one-time token with the invited account holder."); }
    catch(e){setError(e.message);} finally{setBusy(false);}
  }
  async function acceptWorkspaceInvite(e) {
    e.preventDefault(); setBusy(true); setError(""); setMessage("");
    try { const d=await api("/api/workspace-invites/"+encodeURIComponent(workspaceInviteToken.trim())+"/accept",{method:"POST",body:"{}"}); setResource("workspaces"); const list=await api("/api/modules/workspaces"); setItems(list.items||[]); setSelectedWorkspace(d.workspaceId); setWorkspaceInviteToken(""); setMessage("You joined the shared workspace."); }
    catch(e){setError(e.message);} finally{setBusy(false);}
  }
  async function changeWorkspaceMemberRole(member,role) {
    setBusy(true); setError(""); try { await api("/api/workspaces/"+selectedWorkspace+"/members/"+member.userId,{method:"PATCH",body:JSON.stringify({role})}); await refreshWorkspace(); setMessage("Member role updated."); } catch(e){setError(e.message);} finally{setBusy(false);}
  }
  async function removeWorkspaceMember(member) {
    setBusy(true); setError(""); try { await api("/api/workspaces/"+selectedWorkspace+"/members/"+member.userId,{method:"DELETE"}); await refreshWorkspace(); setMessage("Member removed."); } catch(e){setError(e.message);} finally{setBusy(false);}
  }
  async function createWorkspaceDocument(e) {
    e.preventDefault(); setBusy(true); setError(""); setMessage("");
    try { const d=await api("/api/workspaces/"+selectedWorkspace+"/documents",{method:"POST",body:JSON.stringify({title:documentTitle,content:documentContent})}); setActiveDocument(d.document); setDocumentTitle(d.document.title); setDocumentContent(d.document.content); await refreshWorkspace(); setMessage("Shared document created."); }
    catch(e){setError(e.message);} finally{setBusy(false);}
  }
  async function openWorkspaceDocument(id) {
    setError(""); try { const d=await api("/api/workspaces/"+selectedWorkspace+"/documents/"+id); setActiveDocument(d.document); setDocumentTitle(d.document.title); setDocumentContent(d.document.content); }
    catch(e){setError(e.message);}
  }
  async function saveWorkspaceDocument(e) {
    e.preventDefault(); if(!activeDocument)return; setBusy(true); setError(""); setMessage("");
    try { const d=await api("/api/workspaces/"+selectedWorkspace+"/documents/"+activeDocument.id,{method:"PATCH",body:JSON.stringify({expectedVersion:activeDocument.version,title:documentTitle,content:documentContent})}); setActiveDocument(d.document); await refreshWorkspace(); setMessage("Document saved as version "+d.document.version+"."); }
    catch(e){setError(e.message);} finally{setBusy(false);}
  }
  async function savePrefs(next) {
    setPrefs(next);
    try { await api("/api/workspace/preferences", { method: "PUT", body: JSON.stringify({ preferences: next }) }); setMessage("Workspace preferences saved."); }
    catch (e) { setError(e.message); }
  }
  async function setAiConsent(enabled) {
    try { const d = await api("/api/ai/consent", { method: "PUT", body: JSON.stringify({ enabled }) }); setConsent(d.enabled); setAnswer(""); setMessage(enabled ? "AI enabled. Your prompts may be sent to the configured AI provider." : "AI disabled and stored AI conversations deleted."); }
    catch (e) { setError(e.message); }
  }
  async function askAi(e) {
    e.preventDefault(); setBusy(true); setError(""); setAnswer("");
    try { const d = await api("/api/ai/chat", { method: "POST", body: JSON.stringify({ message: prompt }) }); setAnswer(d.answer); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  const currentWorkspaceRole = workspaceMembers.find(member=>member.userId===user?.id)?.role || null;
  if (!user) return <section className="module-panel"><h2>{active[0].toUpperCase()+active.slice(1)} workspace</h2><p>Sign in to use your private {active} workspace.</p></section>;
  if (active === "ai") return <section className="module-panel">
    <div className="module-heading"><div><div className="eyebrow">AI STUDIO</div><h2>Your opt-in assistant</h2><p>AI is off until you explicitly enable it. Prompts are sent to your configured provider only after consent.</p></div><button className={consent ? "toggle on" : "toggle"} onClick={() => setAiConsent(!consent)}>{consent ? "AI enabled" : "Enable AI"}</button></div>
    {consent ? <form className="module-form" onSubmit={askAi}><label className="module-field">Ask SsibuChat AI<textarea value={prompt} onChange={e=>setPrompt(e.target.value)} maxLength={8000} required placeholder="What would you like help with?"/></label><button className="btn-dark" disabled={busy || !prompt.trim()}>{busy ? "Thinking…" : "Ask AI"}</button></form> : <p className="module-muted">Enable AI to continue. You can switch it off at any time.</p>}
    {answer ? <div className="module-answer"><b>Assistant</b><p>{answer}</p></div> : null}
    <p className="module-muted">If no AI provider is configured, the service returns a safe unavailable response. No simulated answer is shown.</p>
    {error ? <p className="form-error">{error}</p> : null}
  </section>;

  return <section className="module-panel">
    <div className="module-heading"><div><div className="eyebrow">{active.toUpperCase()} MODULE</div><h2>{active === "work" ? "Your workbench" : active === "commerce" ? "Your marketplace tools" : active === "finance" ? "Your finance records" : "Your media library"}</h2><p>Private records scoped to your independent SsibuChat account.</p></div>
      {resources[active]?.length > 1 ? <select value={resource} onChange={e=>{setResource(e.target.value);setForm({});setError("");}}>{resources[active].map(r=><option key={r} value={r}>{labels[r]}</option>)}</select> : null}
    </div>
    {active === "work" && resource === "workspaces" ? <div className="workspace-collaboration">
      <form className="workspace-accept-form" onSubmit={acceptWorkspaceInvite}><Field label="Accept a workspace invitation token" value={workspaceInviteToken} onChange={setWorkspaceInviteToken} required placeholder="Paste the one-time token"/><button className="toggle" disabled={busy||!workspaceInviteToken.trim()}>Accept invitation</button></form>
      {items.length ? <>
        <label className="module-field">Selected workspace<select value={selectedWorkspace} onChange={e=>{setSelectedWorkspace(e.target.value);setActiveDocument(null);setInviteToken("");}}>{items.map(item=><option key={item.id} value={item.id}>{item.name||"Workspace"}</option>)}</select></label>
        <div className="workspace-collab-grid">
          <section className="workspace-collab-card"><h3>Members</h3>{workspaceMembers.map(member=><div className="workspace-member" key={member.userId}><span><b>{member.displayName||member.username}</b><small>@{member.username}</small></span>{currentWorkspaceRole==="owner"&&member.role!=="owner"?<span className="workspace-member-actions"><select value={member.role} onChange={e=>changeWorkspaceMemberRole(member,e.target.value)}><option value="editor">Editor</option><option value="viewer">Viewer</option></select><button type="button" className="toggle" onClick={()=>removeWorkspaceMember(member)}>Remove</button></span>:<em>{member.role}</em>}</div>)}{currentWorkspaceRole==="owner"?<form onSubmit={inviteToWorkspace} className="workspace-invite-form"><b>Invite a person</b><Field label="Existing username" value={inviteUsername} onChange={setInviteUsername} required/><label className="module-field">Role<select value={inviteRole} onChange={e=>setInviteRole(e.target.value)}><option value="editor">Editor</option><option value="viewer">Viewer</option></select></label><button className="btn-dark" disabled={busy||!inviteUsername.trim()}>Create invite</button>{inviteToken?<div className="workspace-invite-token"><small>One-time invitation token</small><code>{inviteToken}</code><button type="button" className="toggle" onClick={()=>navigator.clipboard?.writeText(inviteToken)}>Copy token</button></div>:null}</form>:<p className="module-muted">Only the workspace owner can invite members.</p>}</section>
          <section className="workspace-collab-card"><h3>Shared documents</h3><div className="workspace-document-list">{workspaceDocuments.map(doc=><button type="button" key={doc.id} className={activeDocument?.id===doc.id?"workspace-document active":"workspace-document"} onClick={()=>openWorkspaceDocument(doc.id)}><b>{doc.title}</b><small>Version {doc.version}</small></button>)}</div>{currentWorkspaceRole==="viewer"?<p className="module-muted">You have view-only access to this workspace.</p>:<form onSubmit={activeDocument?saveWorkspaceDocument:createWorkspaceDocument} className="workspace-document-form"><Field label="Document title" value={documentTitle} onChange={setDocumentTitle} required/><label className="module-field">Document content<textarea value={documentContent} onChange={e=>setDocumentContent(e.target.value)} rows={6} maxLength={50000} required/></label><div className="workspace-document-actions"><button className="btn-dark" disabled={busy}>{busy?"Saving…":activeDocument?"Save new version":"Create shared document"}</button>{activeDocument?<button type="button" className="toggle" onClick={()=>{setActiveDocument(null);setDocumentTitle("");setDocumentContent("");}}>New document</button>:null}</div></form>}</section>
          <section className="workspace-collab-card"><h3>Activity</h3>{workspaceActivity.length?workspaceActivity.map(event=><div className="workspace-activity" key={event.id}><b>{event.summary}</b><small>{event.type} · {new Date(event.createdAt).toLocaleString()}</small></div>):<p className="module-muted">No activity yet.</p>}</section>
        </div>
      </> : <p className="module-muted">Create a workspace above to invite members and collaborate on shared documents.</p>}
    </div> : null}
    {active==="commerce"&&resource==="orders"?<div className="commerce-panel">
      <div className="eyebrow">BUYER CHECKOUT</div><h3>Browse storefronts</h3>
      <form className="commerce-order-form" onSubmit={createCommerceOrder}><label className="module-field">Storefront<select value={selectedStorefront} onChange={e=>{setSelectedStorefront(e.target.value);setSelectedStoreProduct("");}} required><option value="">Choose a storefront</option>{storefronts.map(store=><option key={store.id} value={store.id}>{store.name}</option>)}</select></label><label className="module-field">Product<select value={selectedStoreProduct} onChange={e=>setSelectedStoreProduct(e.target.value)} required><option value="">Choose a product</option>{storefrontProducts.map(product=><option key={product.id} value={product.id} disabled={!product.available}>{product.name} · {product.currency} {product.priceMinor.toLocaleString()} minor units{product.available?"":" · out of stock"}</option>)}</select></label><Field label="Quantity" type="number" value={orderQuantity} onChange={setOrderQuantity} required/><button className="btn-dark" disabled={busy||!selectedStorefront||!selectedStoreProduct}>Create buyer order</button></form>
      {checkoutIntent?<div className="checkout-intent"><b>Sandbox payment intent</b><small>{checkoutIntent.id} · {checkoutIntent.status}</small>{checkoutIntent.sandboxSettlementEnabled?<button type="button" className="toggle" onClick={settleSandboxPayment} disabled={busy}>Simulate sandbox settlement</button>:<p className="module-muted">Sandbox settlement is disabled. No real payment provider is configured.</p>}</div>:null}
      <div className="eyebrow">BUYER / MERCHANT ORDERS</div><div className="commerce-orders">{commerceOrders.map(order=><article className="commerce-order" key={order.id}><div><b>{order.items?.map(item=>item.name+" × "+item.quantity).join(", ")}</b><small>{order.currency} {order.totalMinor.toLocaleString()} minor units · {order.status} · {order.paymentStatus}</small></div>{order.buyerId===user.id&&order.status==="draft"?<button type="button" className="toggle" onClick={()=>checkoutCommerceOrder(order)} disabled={busy}>Checkout</button>:order.merchantId===user.id&&order.paymentStatus==="paid"&&order.status!=="completed"&&order.status!=="cancelled"?<select value={order.status} onChange={e=>updateCommerceOrder(order,e.target.value)} disabled={busy}><option value="confirmed">Confirmed</option><option value="accepted">Accepted</option><option value="processing">Processing</option><option value="shipped">Shipped</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option></select>:null}</article>)}</div>
      <p className="module-muted">Payment mode is disabled by default. Sandbox settlement is a test-only simulation; external payment collection, refunds and reconciliation are not enabled.</p>
    </div>:null}
    {active==="finance"?<div className="ledger-panel">
      <div className="module-heading"><div><div className="eyebrow">DOUBLE-ENTRY LEDGER</div><h3>Accounts and journals</h3><p>Every posted journal balances debits and credits. Posted entries are immutable; corrections use reversal journals.</p></div></div>
      <div className="ledger-grid">
        <form className="ledger-card" onSubmit={createLedgerAccount}><h4>Create account</h4><Field label="Account code" value={ledgerAccountForm.code} onChange={v=>setLedgerAccountForm({...ledgerAccountForm,code:v.toUpperCase()})} required/><Field label="Account name" value={ledgerAccountForm.name} onChange={v=>setLedgerAccountForm({...ledgerAccountForm,name:v})} required/><label className="module-field">Type<select value={ledgerAccountForm.type} onChange={e=>setLedgerAccountForm({...ledgerAccountForm,type:e.target.value})}><option value="asset">Asset</option><option value="liability">Liability</option><option value="equity">Equity</option><option value="income">Income</option><option value="expense">Expense</option></select></label><Field label="Currency" value={ledgerAccountForm.currency} onChange={v=>setLedgerAccountForm({...ledgerAccountForm,currency:v.toUpperCase()})} required/><button className="btn-dark" disabled={busy}>Create account</button></form>
        <form className="ledger-card" onSubmit={postLedgerJournal}><h4>Post balanced journal</h4><label className="module-field">Debit account<select value={ledgerJournalForm.debitAccountId} onChange={e=>setLedgerJournalForm({...ledgerJournalForm,debitAccountId:e.target.value})} required><option value="">Select account</option>{ledgerAccounts.map(account=><option key={account.id} value={account.id}>{account.code} · {account.name} ({account.currency})</option>)}</select></label><label className="module-field">Credit account<select value={ledgerJournalForm.creditAccountId} onChange={e=>setLedgerJournalForm({...ledgerJournalForm,creditAccountId:e.target.value})} required><option value="">Select account</option>{ledgerAccounts.map(account=><option key={account.id} value={account.id}>{account.code} · {account.name} ({account.currency})</option>)}</select></label><Field label="Amount (minor units)" type="number" value={ledgerJournalForm.amountMinor} onChange={v=>setLedgerJournalForm({...ledgerJournalForm,amountMinor:v})} required/><Field label="Memo" value={ledgerJournalForm.memo} onChange={v=>setLedgerJournalForm({...ledgerJournalForm,memo:v})} required/><button className="btn-dark" disabled={busy||ledgerAccounts.length<2}>Post journal</button></form>
      </div>
      <div className="ledger-card"><h4>Trial balance</h4>{trialBalance.length?trialBalance.map(row=><div className="ledger-row" key={row.accountId}><span><b>{row.code} · {row.name}</b><small>{row.currency}</small></span><strong>{row.netMinor.toLocaleString()}</strong></div>):<p className="module-muted">No posted journals yet.</p>}</div>
      <div className="ledger-card"><h4>Posted journals</h4>{ledgerJournals.length?ledgerJournals.map(journal=><div className="ledger-row" key={journal.id}><span><b>{journal.memo}</b><small>{journal.currency} {journal.totalMinor.toLocaleString()} · {new Date(journal.createdAt).toLocaleString()}</small></span>{journal.reversalOf?<em>Reversal</em>:<button type="button" className="toggle" onClick={()=>reverseLedgerJournal(journal.id)} disabled={busy}>Reverse</button>}</div>):<p className="module-muted">No journals posted yet.</p>}</div>
    </div>:null}
    {active === "work" ? <div className="workspace-preferences"><b>Dashboard preferences</b><select value={prefs.layout} onChange={e=>savePrefs({...prefs,layout:e.target.value})}><option value="comfortable">Comfortable layout</option><option value="compact">Compact layout</option></select><label><input type="checkbox" checked={prefs.contextualPanels} onChange={e=>savePrefs({...prefs,contextualPanels:e.target.checked})}/> Contextual panels</label></div> : null}
    {resource!=="orders"?<form className="module-form" onSubmit={create}>
      {resource === "workspaces" ? <><Field label="Workspace name" value={form.name||""} onChange={v=>set("name",v)} required/><Field label="Description" value={form.description||""} onChange={v=>set("description",v)}/></> : null}
      {resource === "projects" ? <><Field label="Project name" value={form.name||""} onChange={v=>set("name",v)} required/><Field label="Description" value={form.description||""} onChange={v=>set("description",v)}/><Field label="Workspace ID (optional)" value={form.workspaceId||""} onChange={v=>set("workspaceId",v)}/></> : null}
      {resource === "tasks" ? <><Field label="Task title" value={form.title||""} onChange={v=>set("title",v)} required/><Field label="Description" value={form.description||""} onChange={v=>set("description",v)}/><Field label="Workspace ID (optional)" value={form.workspaceId||""} onChange={v=>set("workspaceId",v)}/><Field label="Project ID (optional)" value={form.projectId||""} onChange={v=>set("projectId",v)}/><label className="module-field">Priority<select value={form.priority||"normal"} onChange={e=>set("priority",e.target.value)}><option>low</option><option>normal</option><option>high</option><option>urgent</option></select></label><Field label="Due date" type="date" value={form.dueDate||""} onChange={v=>set("dueDate",v)}/></> : null}
      {resource === "events" ? <><Field label="Event title" value={form.title||""} onChange={v=>set("title",v)} required/><Field label="Start (ISO date/time)" value={form.startsAt||""} onChange={v=>set("startsAt",v)} required placeholder="2026-12-01T09:00:00+03:00"/><Field label="End (ISO date/time)" value={form.endsAt||""} onChange={v=>set("endsAt",v)} required/><Field label="Workspace ID (optional)" value={form.workspaceId||""} onChange={v=>set("workspaceId",v)}/><Field label="Timezone" value={form.timezone||"Africa/Kampala"} onChange={v=>set("timezone",v)}/></> : null}
      {resource === "businesses" ? <><Field label="Business name" value={form.name||""} onChange={v=>set("name",v)} required/><Field label="Category" value={form.category||""} onChange={v=>set("category",v)}/><Field label="Description" value={form.description||""} onChange={v=>set("description",v)}/><Field label="Website" value={form.website||""} onChange={v=>set("website",v)}/></> : null}
      {resource === "products" ? <><Field label="Product name" value={form.name||""} onChange={v=>set("name",v)} required/><Field label="Business ID" value={form.businessId||""} onChange={v=>set("businessId",v)} required/><Field label="Price (minor currency units)" type="number" value={form.priceMinor||""} onChange={v=>set("priceMinor",v)} required/><Field label="Currency (ISO 4217)" value={form.currency||"UGX"} onChange={v=>set("currency",v.toUpperCase())} required/><Field label="SKU" value={form.sku||""} onChange={v=>set("sku",v)}/><Field label="Initial stock quantity" type="number" value={form.stockQuantity||"0"} onChange={v=>set("stockQuantity",v)}/><label className="module-field module-checkbox"><input type="checkbox" checked={form.trackInventory===true} onChange={e=>set("trackInventory",e.target.checked)}/> Track inventory</label></> : null}
      
      {resource === "finance" ? <><label className="module-field">Type<select value={form.type||"expense"} onChange={e=>set("type",e.target.value)}><option>income</option><option>expense</option><option>refund</option><option>fee</option></select></label><Field label="Amount (minor units)" type="number" value={form.amountMinor||""} onChange={v=>set("amountMinor",v)} required/><Field label="Currency" value={form.currency||"UGX"} onChange={v=>set("currency",v.toUpperCase())} required/><Field label="Description" value={form.description||""} onChange={v=>set("description",v)}/><Field label="Reference" value={form.reference||""} onChange={v=>set("reference",v)}/></> : null}
      {resource === "media" ? <><Field label="Asset name" value={form.name||""} onChange={v=>set("name",v)} required/><Field label="MIME type" value={form.mimeType||""} onChange={v=>set("mimeType",v)}/><Field label="Size in bytes" type="number" value={form.sizeBytes||"0"} onChange={v=>set("sizeBytes",v)}/><Field label="Storage key (provider-managed)" value={form.storageKey||""} onChange={v=>set("storageKey",v)}/></> : null}
      <button className="btn-dark" disabled={busy}>{busy ? "Saving…" : "Save " + (labels[resource]||"record").toLowerCase()}</button>
    </form>:null}
    {resource === "media" ? <p className="module-muted">This creates metadata only. File upload/storage is not configured yet.</p> : null}
    {resource === "finance" ? <p className="module-muted">These are immutable bookkeeping records, not a wallet or payment account.</p> : null}
    {message ? <p className="module-success" role="status">{message}</p> : null}
    {error ? <p className="form-error">{error}</p> : null}
    <div className="module-records"><h3>{labels[resource]} ({items.length})</h3>{items.length ? items.map(item=><article className="module-record" key={item.id}><b>{item.name||item.title||item.description||item.type||"Record"}</b><small>{item.status||item.createdAt ? String(item.status||new Date(item.createdAt).toLocaleString()) : ""} · ID: {item.id}</small><span>{item.description||item.note||item.reference||""}</span>{resource==="products"?<div className="inventory-editor"><Field label="Available stock" type="number" value={String(inventoryDrafts[item.id]?.stockQuantity??item.stockQuantity??0)} onChange={v=>setInventoryDrafts({...inventoryDrafts,[item.id]:{...inventoryDrafts[item.id],stockQuantity:v,trackInventory:inventoryDrafts[item.id]?.trackInventory??item.trackInventory===true}})}/><label className="module-field module-checkbox"><input type="checkbox" checked={inventoryDrafts[item.id]?.trackInventory??item.trackInventory===true} onChange={e=>setInventoryDrafts({...inventoryDrafts,[item.id]:{...inventoryDrafts[item.id],stockQuantity:inventoryDrafts[item.id]?.stockQuantity??item.stockQuantity??0,trackInventory:e.target.checked}})}/> Track inventory</label><button type="button" className="toggle" onClick={()=>saveProductInventory(item)} disabled={busy}>Save inventory</button></div>:null}</article>) : <p className="module-muted">No records yet.</p>}</div>
  </section>;
}
