import React, { useCallback, useEffect, useState } from "react";

const targets = [
  ["runtime", "Live runtime configuration"],
  ["github-actions", "GitHub Actions"],
  ["vercel", "Vercel"],
  ["namecheap", "Namecheap"],
  ["bluehost", "Bluehost"],
  ["other", "Other provider"]
];

export default function InfrastructureControl() {
  const [records, setRecords] = useState([]);
  const [key, setKey] = useState("");
  const [target, setTarget] = useState("runtime");
  const [environment, setEnvironment] = useState("production");
  const [value, setValue] = useState("");
  const [secret, setSecret] = useState(true);
  const [encryptionReady, setEncryptionReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const request = useCallback(async (url, options = {}) => {
    const response = await fetch(url, { credentials: "include", headers: { "content-type": "application/json", ...(options.headers || {}) }, ...options });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "configuration_request_failed");
    return data;
  }, []);

  const reload = useCallback(async () => {
    setError("");
    try {
      const data = await request("/api/admin/config");
      setRecords(data.records || []);
      setEncryptionReady(data.encryptionReady === true);
    } catch (err) { setError(err.message); }
  }, [request]);

  useEffect(() => { reload(); }, [reload]);

  async function save(event) {
    event.preventDefault();
    setBusy(true); setError(""); setNotice("");
    try {
      const data = await request("/api/admin/config", { method: "PUT", body: JSON.stringify({ key, target, environment, value, secret, activate: target === "runtime" }) });
      setKey(""); setValue(""); setNotice(data.message || "Encrypted configuration saved.");
      await reload();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  async function remove(record) {
    if (!window.confirm("Delete " + record.key + " for " + record.target + " / " + record.environment + "?")) return;
    setError(""); setNotice("");
    try { await request("/api/admin/config/" + record.id, { method: "DELETE" }); setNotice("Configuration entry deleted."); await reload(); }
    catch (err) { setError(err.message); }
  }

  return <section className="admin-card infrastructure-card">
    <div className="admin-head"><div><div className="eyebrow">INFRASTRUCTURE CONTROL PLANE</div><h2>Environment & provider configuration</h2><p>Manage independent SsibuChat configuration centrally. Values are encrypted at rest and never returned to the browser after saving.</p></div><button type="button" className="toggle" onClick={reload}>Refresh</button></div>
    <div className="tester-toggle"><div><b>Configuration vault encryption</b><span>{encryptionReady ? "Encryption key detected" : "Encryption key missing — configure SSIBUCHAT_CONFIG_ENCRYPTION_KEY in independent production hosting"}</span></div><span className={encryptionReady ? "toggle on" : "toggle"}>{encryptionReady ? "Ready" : "Blocked"}</span></div>
    <form className="security-form" onSubmit={save}>
      <b>Add or rotate a configuration value</b>
      <p>Secret values are write-only. A saved secret cannot be read back; rotate it by entering a replacement value.</p>
      <label>Environment variable / configuration key<input value={key} onChange={event => setKey(event.target.value.toUpperCase())} placeholder="CRON_SECRET" pattern="[A-Z][A-Z0-9_]{1,127}" maxLength={128} required /></label>
      <label>Destination<select value={target} onChange={event => setTarget(event.target.value)}>{targets.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
      <label>Environment<select value={environment} onChange={event => setEnvironment(event.target.value)}><option value="production">Production</option><option value="preview">Preview</option><option value="development">Development</option><option value="shared">Shared</option></select></label>
      <label>Value<input type="password" autoComplete="new-password" value={value} onChange={event => setValue(event.target.value)} maxLength={16384} required /></label>
      <label className="tester-toggle"><span><b>Mark as secret</b><small>Keep value hidden in all administrative responses.</small></span><input type="checkbox" checked={secret} onChange={event => setSecret(event.target.checked)} /></label>
      <button className="btn-dark" disabled={busy || !encryptionReady || !key || !value}>{busy ? "Saving securely…" : "Encrypt and save"}</button>
    </form>
    {notice ? <p role="status">{notice}</p> : null}
    {error ? <p className="form-error">{error}</p> : null}
    <div className="security-form"><b>Configuration inventory ({records.length})</b><p>Only metadata and synchronization state are displayed. Provider destinations remain pending until their authorized API adapters are connected and verified.</p>
      {records.map(record => <div className="session-row" key={record.id}><span><b>{record.key}</b> · {record.target} · {record.environment}</span><small>v{record.version} · {record.secret ? "Secret" : "Non-secret"} · {record.syncStatus} · Updated {record.updatedAt ? new Date(record.updatedAt).toLocaleString() : "—"}</small><button type="button" className="toggle danger" onClick={() => remove(record)}>Delete</button></div>)}
      {!records.length ? <p>No configuration values have been stored yet.</p> : null}
    </div>
  </section>;
}
