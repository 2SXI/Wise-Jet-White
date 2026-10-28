import { db, q, html, raw, $, $$, toast, money, fmtDate, fmtDateTime, timeAgo, pill, icon, titleCase, describeActivity, daysUntil } from "../core.js";
import { lookup, clientName, formDialog, listPage, adminError, bust, callAdminFn } from "./kit.js";
import { showSecret } from "./clients.js";

export async function overview(ctx) {
  const soon = new Date(Date.now() + 60 * 864e5).toISOString().slice(0, 10);
  const month = new Date(); month.setUTCDate(1); const m0 = month.toISOString().slice(0, 10);
  const since = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() - 5, 1)).toISOString();
  const [clients, tickets, unpaid, doms, paid, counts, hist, feed] = await Promise.all([lookup("clients"),
    q(db.from("support_tickets").select("id,subject,client_id,status,updated_at").in("status", ["open", "in_progress"]).order("updated_at", { ascending: false }).limit(6)),
    q(db.from("invoices").select("id,number,client_id,total_cents,currency,due_date,status").in("status", ["sent", "overdue"]).order("due_date").limit(50)),
    q(db.from("domains").select("id,name,client_id,expires_at").eq("status", "active").lte("expires_at", soon).order("expires_at").limit(8)),
    q(db.from("payments").select("amount_cents,currency").eq("status", "paid").gte("paid_at", m0)),
    Promise.all(["domains", "websites", "hosting_accounts", "email_accounts"].map((t) => db.from(t).select("id", { count: "exact", head: true }))),
    q(db.from("payments").select("amount_cents,currency,paid_at").eq("status", "paid").gte("paid_at", since)),
    q(db.from("activity_logs").select("id,action,entity_type,metadata,created_at,client_id").order("created_at", { ascending: false }).limit(6)).catch(() => []),
  ]);
  const months = Array.from({ length: 6 }, (_, i) => { const d = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() - 5 + i, 1)); return { key: d.toISOString().slice(0, 7), label: d.toLocaleString("en-GB", { month: "short", timeZone: "UTC" }), v: 0 }; });
  hist.filter((p) => p.currency === "USD" && p.paid_at).forEach((p) => { const b = months.find((x) => x.key === p.paid_at.slice(0, 7)); if (b) b.v += Number(p.amount_cents); });
  const chart = revenueChart(months);
  const sum = (rows, cur) => rows.filter((r) => r.currency === cur).reduce((a, r) => a + Number(r.amount_cents), 0);
  const owed = (cur) => sum(unpaid.map((i) => ({ amount_cents: i.total_cents, currency: i.currency })), cur);
  const overdue = unpaid.filter((i) => i.status === "overdue");
  const active = clients.filter((c) => c.status === "active").length;
  const stat = (label, value, sub = "") => html`<div class="card"><div class="stat"><span class="label">${label}</span><span class="value" data-count="${value}">${value}</span>${sub ? html`<span class="faint">${sub}</span>` : ""}</div></div>`;
  const out = html`<div class="page-head hero"><div><h1>${greeting()}, ${(ctx.profile.full_name || "there").split(" ")[0]}</h1><p>Here's what's happening across SXI Digital today.</p></div><span class="live">All systems normal</span></div>
    <div class="grid cols-4">${stat("Active clients", active, `${clients.length} total`)}${stat("Open tickets", tickets.length >= 6 ? "6+" : tickets.length)}
      ${stat("Outstanding", money(owed("USD")), overdue.length ? `${overdue.length} overdue` : "none overdue")}${stat("Received this month", money(sum(paid, "USD")))}</div>
    <div class="grid cols-4 mt-l">${stat("Domains", counts[0].count ?? 0)}${stat("Websites", counts[1].count ?? 0)}${stat("Hosting accounts", counts[2].count ?? 0)}${stat("Mailboxes", counts[3].count ?? 0)}</div>
    <div class="grid cols-2 mt-l"><div class="card"><div class="card-head"><h2>Income · last 6 months</h2><span class="faint">USD</span></div>${chart}</div>
      <div class="card"><div class="card-head"><h2>Recent activity</h2><a class="link" href="#/activity">All</a></div>${feed.length ? html`<div class="feed">${feed.map((a) => html`<div class="ev"><span class="dot"></span><div><div>${a.action.startsWith("auth.") ? titleCase(a.action.slice(5)) : describeActivity(a)}</div><div class="faint">${a.client_id ? clientName(clients, a.client_id) + " · " : ""}${timeAgo(a.created_at)}</div></div></div>`)}</div>` : html`<p class="faint">No activity yet.</p>`}</div></div>
    <div class="grid cols-2 mt-l">
      <div class="card"><div class="card-head"><h2>Needs attention: tickets</h2><a class="link" href="#/support">All</a></div>
        ${tickets.length ? html`<div class="list">${tickets.map((t) => html`<a class="item" href="#/support/${t.id}"><div class="item-main"><div class="title">${t.subject}</div><div class="meta">${clientName(clients, t.client_id)} · ${timeAgo(t.updated_at)}</div></div>${pill("ticket", t.status)}</a>`)}</div>` : html`<p class="faint">Nothing waiting. 🎉</p>`}</div>
      <div class="card"><div class="card-head"><h2>Unpaid invoices</h2><a class="link" href="#/invoices">All</a></div>
        ${unpaid.length ? html`<div class="list">${unpaid.slice(0, 6).map((i) => html`<a class="item" href="#/invoices/${i.id}"><div class="item-main"><div class="title">${i.number}</div><div class="meta">${clientName(clients, i.client_id)} · due ${fmtDate(i.due_date)}</div></div><span>${money(i.total_cents, i.currency)}</span></a>`)}</div>` : html`<p class="faint">Everything is paid.</p>`}</div>
      <div class="card"><div class="card-head"><h2>Domains expiring within 60 days</h2><a class="link" href="#/domains">All</a></div>
        ${doms.length ? html`<div class="list">${doms.map((d) => { const n = daysUntil(d.expires_at); return html`<a class="item" href="#/domains"><div class="item-main"><div class="title">${d.name}</div><div class="meta">${clientName(clients, d.client_id)}</div></div><span class="pill ${n < 0 ? "danger" : n <= 30 ? "warn" : "info"}">${n < 0 ? "Expired" : n + " days"}</span></a>`; })}</div>` : html`<p class="faint">No renewals coming up.</p>`}</div>
      <div class="card"><div class="card-head"><h2>Quick actions</h2></div><div class="row">
        <a class="btn btn-primary" href="#/clients">${icon("plus")}Add client</a><button class="btn btn-ghost" data-inv type="button">New invoice</button><a class="btn btn-ghost" href="#/domains">Domains</a></div></div></div>`;
  return { title: "Overview", html: out, mount: (v) => { $("[data-inv]", v).addEventListener("click", () => ctx.newInvoice()); countUp(v); } };
}

export async function activity(ctx) {
  const [clients, rows] = await Promise.all([lookup("clients"), q(db.from("activity_logs").select("*").order("created_at", { ascending: false }).limit(300))]);
  const who = (r) => (r.action.startsWith("auth.") ? titleCase(r.action.slice(5)) : describeActivity(r));
  const page = listPage({
    title: "Activity log", sub: "Every change, newest first. This log can't be edited.", rows: rows.map((r) => ({ ...r, id: String(r.id) })), emptyIcon: "activity",
    searchText: (r) => `${r.action} ${r.entity_type || ""} ${r.actor_role || ""} ${r.client_id ? clientName(clients, r.client_id) : ""}`,
    cols: [{ label: "What", cell: (r) => html`<strong>${who(r)}</strong><div class="meta">${r.action}</div>` }, { label: "Client", cell: (r) => (r.client_id ? clientName(clients, r.client_id) : "—"), hideM: true },
      { label: "By", cell: (r) => r.actor_role || "system", hideM: true }, { label: "When", cell: (r) => timeAgo(r.created_at) }],
  });
  return { title: "Activity", ...page };
}

export async function team(ctx) {
  if (ctx.profile.role !== "admin") return { title: "Team", html: html`<div class="empty fade">${icon("team")}<h3>Admins only</h3><p>Only admins can manage team access.</p></div>` };
  const [clients, rows] = await Promise.all([lookup("clients"), q(db.from("profiles").select("*").order("created_at"))]);
  const edit = (u) => formDialog({
    title: u.full_name || u.email, row: { role: u.role, client_id: u.client_id, is_active: u.is_active },
    fields: [{ name: "role", label: "Role", type: "select", required: true, options: [["client", "Client"], ["staff", "Staff"], ["admin", "Admin"]] },
      { name: "client_id", label: "Client (for client logins)", type: "select", options: clients.map((c) => [c.id, c.company_name]) }, { name: "is_active", label: "Account active", type: "checkbox" }],
    onSave: async (v) => { await q(db.rpc("admin_update_profile", { p_user_id: u.id, p_role: v.role, p_client_id: v.role === "client" ? v.client_id : null, p_is_active: v.is_active })); bust(); toast("Saved.", "ok"); ctx.reload(); },
  });
  const invite = () => formDialog({ title: "Add team member", submitText: "Create", row: { role: "staff", mode: "invite" },
    fields: [{ name: "full_name", label: "Name", max: 200 }, { name: "email", label: "Email", required: true, lower: true },
      { name: "role", label: "Role", type: "select", required: true, options: [["staff", "Staff"], ["admin", "Admin"]] },
      { name: "mode", label: "Access", type: "select", required: true, options: [["invite", "Email an invite link"], ["password", "Make a temporary password"]] }],
    onSave: async (v) => { const r = await callAdminFn({ action: "create_login", ...v }); if (r.temp_password) showSecret("Temporary password", `Give this to ${v.email}. Shown once.`, r.temp_password); else toast("Invite sent.", "ok"); bust(); ctx.reload(); } });
  const page = listPage({ onAdd: invite, addLabel: "Add team member",
    title: "Team & logins", sub: "Everyone who can sign in. Create new logins in Supabase → Authentication, then set their role here.", rows, onOpen: edit,
    statuses: ["client", "staff", "admin"], statusOf: (r) => r.role, searchText: (r) => `${r.email} ${r.full_name}`, emptyIcon: "team",
    cols: [{ label: "Person", cell: (r) => html`<strong>${r.full_name || r.email}</strong><div class="meta">${r.email}</div>` }, { label: "Client", cell: (r) => (r.client_id ? clientName(clients, r.client_id) : "—"), hideM: true },
      { label: "Role", cell: (r) => html`<span class="tag">${titleCase(r.role)}</span>` }, { label: "Active", cell: (r) => (r.is_active ? pill("account", "active") : pill("account", "suspended")), hideM: true }],
  });
  return { title: "Team", ...page };
}

export async function settings(ctx) {
  const rows = await q(db.from("settings").select("*").order("key"));
  const out = html`<div class="page-head"><div><h1>Settings</h1><p>Business-wide values stored as key and JSON value.</p></div><button class="btn btn-primary" data-add type="button">${icon("plus")}Add setting</button></div>
    <div class="card">${rows.length ? html`<div class="list">${rows.map((r) => html`<button class="item item-btn" type="button" data-key="${r.key}"><div class="item-main"><div class="title mono">${r.key}</div><div class="meta mono">${JSON.stringify(r.value).slice(0, 120)}</div></div><span class="faint">${timeAgo(r.updated_at)}</span></button>`)}</div>` : html`<p class="faint">No settings yet.</p>`}</div>`;
  const F = [{ name: "key", label: "Key", required: true, lower: true, placeholder: "company.name", hint: "Lowercase letters, numbers, dots and underscores" }, { name: "value", label: "Value (JSON)", type: "textarea", required: true, max: 5000, hint: 'Text needs quotes: "SXI Digital". Numbers and true/false don\'t.' }];
  const dlg = (row) => formDialog({ title: row ? "Edit setting" : "Add setting", fields: F.map((f) => (row && f.name === "key" ? { ...f, readonly: true } : f)), row: row && { key: row.key, value: JSON.stringify(row.value) },
    onSave: async (v) => { let val; try { val = JSON.parse(v.value); } catch { throw new Error("The value must be valid JSON."); }
      if (!/^[a-z0-9_.]+$/.test(v.key)) throw new Error("The key may only use lowercase letters, numbers, dots and underscores.");
      await q(db.from("settings").upsert({ key: v.key, value: val, updated_at: new Date().toISOString() })); toast("Saved.", "ok"); ctx.reload(); },
    onDelete: row ? async () => { await q(db.from("settings").delete().eq("key", row.key)); ctx.reload(); } : null });
  return { title: "Settings", html: out, mount: (v) => { $("[data-add]", v).onclick = () => dlg(null); $$("[data-key]", v).forEach((b) => b.addEventListener("click", () => dlg(rows.find((r) => r.key === b.dataset.key)))); } };
}

const greeting = () => { const h = new Date().getHours(); return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening"; };

function revenueChart(months) {
  const max = Math.max(1, ...months.map((x) => x.v)), W = 520, H = 190, base = 160, bw = 46, gap = (W - bw * 6) / 7;
  const bars = months.map((x, i) => { const h = Math.max(x.v ? 4 : 0, Math.round((x.v / max) * 120)), px = Math.round(gap + i * (bw + gap));
    return `<rect class="bar ${i === 5 ? "cur" : ""}" x="${px}" y="${base - h}" width="${bw}" height="${h}" rx="6"><title>${x.label}: ${money(x.v)}</title></rect>
      <text x="${px + bw / 2}" y="${base + 20}" text-anchor="middle">${x.label}</text>${x.v ? `<text class="val" x="${px + bw / 2}" y="${base - h - 8}" text-anchor="middle">${money(x.v).replace(".00", "")}</text>` : ""}`; }).join("");
  return raw(`<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Income for the last six months"><defs><linearGradient id="barg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7aa2ff"/><stop offset="1" stop-color="#2451f5" stop-opacity=".55"/></linearGradient></defs>
    <line class="grid-l" x1="0" x2="${W}" y1="${base}" y2="${base}"/><line class="grid-l" x1="0" x2="${W}" y1="${base - 60}" y2="${base - 60}"/><line class="grid-l" x1="0" x2="${W}" y1="${base - 120}" y2="${base - 120}"/>${bars}</svg>`);
}

/** Numbers count up once on load (skipped for reduced motion and non-numeric values). */
function countUp(root) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  $$("[data-count]", root).forEach((el) => {
    const raw0 = el.dataset.count, m = /^(\$?)([\d,]+(?:\.\d+)?)$/.exec(raw0); if (!m) return;
    const target = parseFloat(m[2].replace(/,/g, "")), dec = (m[2].split(".")[1] || "").length, t0 = performance.now();
    const step = (t) => { const p = Math.min(1, (t - t0) / 700), e = 1 - Math.pow(1 - p, 3), v = target * e;
      el.textContent = m[1] + v.toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec }); if (p < 1) requestAnimationFrame(step); else el.textContent = raw0; };
    requestAnimationFrame(step);
  });
}
