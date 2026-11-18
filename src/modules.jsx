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
    api("/api/modules/" + resource).then(d => { if (!cancelled) setItems(d.items || []); }).catch(e => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [active, resource, user?.id]);

  useEffect(() => {
    if (!user || active !== "work") return;
    api("/api/workspace/preferences").then(d => setPrefs(d.preferences)).catch(() => {});
  }, [active, user?.id]);

  useEffect(() => {
    if (!user || active !== "ai") return;
    api("/api/ai/consent").then(d => setConsent(d.enabled === true)).catch(e => setError(e.message));
  }, [active, user?.id]);

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
      await api("/api/modules/" + resource, { method: "POST", body: JSON.stringify(body) });
      setForm({}); await refresh(); setMessage("Saved.");
    } catch (e) { setError(e.message); } finally { setBusy(false); }
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
    {active === "work" ? <div className="workspace-preferences"><b>Dashboard preferences</b><select value={prefs.layout} onChange={e=>savePrefs({...prefs,layout:e.target.value})}><option value="comfortable">Comfortable layout</option><option value="compact">Compact layout</option></select><label><input type="checkbox" checked={prefs.contextualPanels} onChange={e=>savePrefs({...prefs,contextualPanels:e.target.checked})}/> Contextual panels</label></div> : null}
    <form className="module-form" onSubmit={create}>
      {resource === "workspaces" ? <><Field label="Workspace name" value={form.name||""} onChange={v=>set("name",v)} required/><Field label="Description" value={form.description||""} onChange={v=>set("description",v)}/></> : null}
      {resource === "projects" ? <><Field label="Project name" value={form.name||""} onChange={v=>set("name",v)} required/><Field label="Description" value={form.description||""} onChange={v=>set("description",v)}/><Field label="Workspace ID (optional)" value={form.workspaceId||""} onChange={v=>set("workspaceId",v)}/></> : null}
      {resource === "tasks" ? <><Field label="Task title" value={form.title||""} onChange={v=>set("title",v)} required/><Field label="Description" value={form.description||""} onChange={v=>set("description",v)}/><label className="module-field">Priority<select value={form.priority||"normal"} onChange={e=>set("priority",e.target.value)}><option>low</option><option>normal</option><option>high</option><option>urgent</option></select></label><Field label="Due date" type="date" value={form.dueDate||""} onChange={v=>set("dueDate",v)}/></> : null}
      {resource === "events" ? <><Field label="Event title" value={form.title||""} onChange={v=>set("title",v)} required/><Field label="Start (ISO date/time)" value={form.startsAt||""} onChange={v=>set("startsAt",v)} required placeholder="2026-12-01T09:00:00+03:00"/><Field label="End (ISO date/time)" value={form.endsAt||""} onChange={v=>set("endsAt",v)} required/><Field label="Timezone" value={form.timezone||"Africa/Kampala"} onChange={v=>set("timezone",v)}/></> : null}
      {resource === "businesses" ? <><Field label="Business name" value={form.name||""} onChange={v=>set("name",v)} required/><Field label="Category" value={form.category||""} onChange={v=>set("category",v)}/><Field label="Description" value={form.description||""} onChange={v=>set("description",v)}/><Field label="Website" value={form.website||""} onChange={v=>set("website",v)}/></> : null}
      {resource === "products" ? <><Field label="Product name" value={form.name||""} onChange={v=>set("name",v)} required/><Field label="Business ID" value={form.businessId||""} onChange={v=>set("businessId",v)} required/><Field label="Price (minor currency units)" type="number" value={form.priceMinor||""} onChange={v=>set("priceMinor",v)} required/><Field label="Currency (ISO 4217)" value={form.currency||"UGX"} onChange={v=>set("currency",v.toUpperCase())} required/><Field label="SKU" value={form.sku||""} onChange={v=>set("sku",v)}/></> : null}
      {resource === "orders" ? <><Field label="Business ID" value={form.businessId||""} onChange={v=>set("businessId",v)} required/><Field label="Product ID" value={form.productId||""} onChange={v=>set("productId",v)} required/><Field label="Quantity" type="number" value={form.quantity||"1"} onChange={v=>set("quantity",v)} required/></> : null}
      {resource === "finance" ? <><label className="module-field">Type<select value={form.type||"expense"} onChange={e=>set("type",e.target.value)}><option>income</option><option>expense</option><option>refund</option><option>fee</option></select></label><Field label="Amount (minor units)" type="number" value={form.amountMinor||""} onChange={v=>set("amountMinor",v)} required/><Field label="Currency" value={form.currency||"UGX"} onChange={v=>set("currency",v.toUpperCase())} required/><Field label="Description" value={form.description||""} onChange={v=>set("description",v)}/><Field label="Reference" value={form.reference||""} onChange={v=>set("reference",v)}/></> : null}
      {resource === "media" ? <><Field label="Asset name" value={form.name||""} onChange={v=>set("name",v)} required/><Field label="MIME type" value={form.mimeType||""} onChange={v=>set("mimeType",v)}/><Field label="Size in bytes" type="number" value={form.sizeBytes||"0"} onChange={v=>set("sizeBytes",v)}/><Field label="Storage key (provider-managed)" value={form.storageKey||""} onChange={v=>set("storageKey",v)}/></> : null}
      <button className="btn-dark" disabled={busy}>{busy ? "Saving…" : resource === "orders" ? "Create draft order" : "Save " + (labels[resource]||"record").toLowerCase()}</button>
    </form>
    {resource === "orders" ? <p className="module-muted">Orders are draft records only. Payment collection is not enabled.</p> : null}
    {resource === "media" ? <p className="module-muted">This creates metadata only. File upload/storage is not configured yet.</p> : null}
    {resource === "finance" ? <p className="module-muted">These are immutable bookkeeping records, not a wallet or payment account.</p> : null}
    {message ? <p className="module-success" role="status">{message}</p> : null}
    {error ? <p className="form-error">{error}</p> : null}
    <div className="module-records"><h3>{labels[resource]} ({items.length})</h3>{items.length ? items.map(item=><article className="module-record" key={item.id}><b>{item.name||item.title||item.description||item.type||"Record"}</b><small>{item.status||item.createdAt ? String(item.status||new Date(item.createdAt).toLocaleString()) : ""} · ID: {item.id}</small><span>{item.description||item.note||item.reference||""}</span></article>) : <p className="module-muted">No records yet.</p>}</div>
  </section>;
}
