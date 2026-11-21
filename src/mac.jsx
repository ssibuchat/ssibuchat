import React, { useCallback, useEffect, useState } from "react";
import InfrastructureControl from "./admin-infrastructure.jsx";

export default function MacConsole() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [policy, setPolicy] = useState({ enabled: false });
  const [testers, setTesters] = useState([]);
  const [events, setEvents] = useState([]);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const request = useCallback(async (url, options = {}) => {
    const response = await fetch(url, { credentials: "include", headers: { "content-type": "application/json", ...(options.headers || {}) }, ...options });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "request_failed");
    return data;
  }, []);

  const refresh = useCallback(async () => {
    setError("");
    const [admin, audit] = await Promise.all([
      request("/api/admin/testers"),
      request("/api/admin/audit?limit=50")
    ]);
    setPolicy(admin.policy || { enabled: false });
    setTesters(admin.testers || []);
    setEvents(audit.events || []);
  }, [request]);

  useEffect(() => {
    let alive = true;
    request("/api/auth/me").then(async data => {
      if (!alive) return;
      setUser(data.user || null);
      if (data.user?.role === "admin") await refresh();
    }).catch(err => { if (alive) setError(err.message); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [request, refresh]);

  async function setAccess(enabled) {
    setError(""); setNotice("");
    try {
      const data = await request("/api/admin/testers/access", { method: "PATCH", body: JSON.stringify({ enabled }) });
      setPolicy(data.policy); setNotice(enabled ? "Independent tester access enabled." : "Independent tester access disabled; tester sessions revoked.");
      await refresh();
    } catch (err) { setError(err.message); }
  }

  async function addTester(event) {
    event.preventDefault(); setError(""); setNotice("");
    try {
      await request("/api/admin/testers", { method: "POST", body: JSON.stringify({ username, password }) });
      setUsername(""); setPassword(""); setNotice("Tester account created."); await refresh();
    } catch (err) { setError(err.message); }
  }

  async function signOut() {
    try { await request("/api/auth/logout", { method: "POST", body: "{}" }); } finally { window.location.href = "/"; }
  }

  return <main className="main-area" style={{ maxWidth: 1120, margin: "0 auto", padding: 28, minHeight: "100vh" }}>
    <header className="topbar"><div><div className="eyebrow">SSIBUCHAT · INDEPENDENT CONTROL PLANE</div><h1>Management & Administration</h1><p>Canonical MAC route: <b>/mac</b></p></div><div className="top-actions"><a className="btn-light" href="/">Open SsibuChat</a>{user ? <button className="btn-dark" onClick={signOut}>Sign out</button> : null}</div></header>
    {loading ? <section className="admin-card">Checking independent administrator session…</section> : !user ? <section className="admin-card"><h2>Administrator sign-in required</h2><p>Sign in to the independent SsibuChat account first. PTU credentials and PTU MAC are not accepted here.</p><a className="btn-dark" href="/">Go to independent SsibuChat sign-in</a></section> : user.role !== "admin" ? <section className="admin-card"><h2>Access denied</h2><p>The independent SsibuChat MAC is restricted to independent product administrators.</p></section> : <>
      <section className="admin-card"><div className="admin-head"><div><div className="eyebrow">INDEPENDENT ACCESS GOVERNANCE</div><h2>Tester access</h2><p>This policy applies only to independent SsibuChat tester accounts. PTU MAC remains separate.</p></div><button className={policy.enabled ? "toggle on" : "toggle"} onClick={() => setAccess(!policy.enabled)}>{policy.enabled ? "Disable testers" : "Enable testers"}</button></div>
        <div className="tester-toggle"><div><b>Tester sign-in policy</b><span>{policy.enabled ? "Enabled" : "Disabled by default"}</span></div><span className={policy.enabled ? "toggle on" : "toggle"}>{policy.enabled ? "Enabled" : "Blocked"}</span></div>
        <form className="tester-form" onSubmit={addTester}><input placeholder="Tester username" value={username} onChange={e => setUsername(e.target.value)} minLength={3} maxLength={32} required/><input type="password" autoComplete="new-password" placeholder="Temporary password (12+ chars)" value={password} onChange={e => setPassword(e.target.value)} minLength={12} maxLength={128} required/><button className="btn-dark" disabled={password.length < 12}>Create tester</button></form>
        <div className="tester-list">{testers.map(t => <div key={t.id}><span>@{t.username}</span><small>{t.status}</small></div>)}{!testers.length ? <p>No independent tester accounts.</p> : null}</div>
      </section>
      <InfrastructureControl/>
      <section className="admin-card"><div className="admin-head"><div><div className="eyebrow">SECURITY & ACCOUNTABILITY</div><h2>Administrative audit trail</h2><p>Latest 50 administrative events for the independent SsibuChat account.</p></div><button className="toggle" onClick={refresh}>Refresh</button></div>
        {events.map(event => <div className="session-row" key={event.id}><span>{event.action}</span><small>{event.createdAt ? new Date(event.createdAt).toLocaleString() : "—"} · {event.actorId || "system"}{event.target ? " · " + event.target : ""}</small></div>)}
        {!events.length ? <p>No administrative events recorded.</p> : null}
      </section>
    </>}
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    {notice ? <p role="status">{notice}</p> : null}
  </main>;
}
