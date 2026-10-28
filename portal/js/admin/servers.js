import { db, q, html, raw, $, $$, toast, fmtDateTime, timeAgo, pill, icon, openDialog, titleCase } from "../core.js";
import { CONFIG } from "../config.js";
import { lookup, bust, formDialog, listPage, adminError, callAdminFn } from "./kit.js";

const FIELDS = [{ name: "name", label: "Name", required: true }, { name: "ip_address", label: "IP address" },
  { name: "provider", label: "Software", type: "select", required: true, options: [["vps", "Plain VPS"], ["cloudpanel", "CloudPanel"], ["cpanel", "cPanel"], ["directadmin", "DirectAdmin"], ["plesk", "Plesk"], ["manual", "Other"]], default: "vps" },
  { name: "os", label: "Operating system" }, { name: "status", label: "Status", type: "select", required: true, options: [["active", "Active"], ["maintenance", "Maintenance"], ["offline", "Offline"]], default: "active" },
  { name: "credentials_ref", label: "Credentials reference", hint: "Where the login is kept (e.g. password-manager entry). Never paste a password here." }];
const online = (s) => s.last_seen_at && Date.now() - new Date(s.last_seen_at).getTime() < 15 * 60 * 1000;
const bar = (label, pct, text) => html`<div class="gauge"><div class="g-top"><span>${label}</span><span class="faint">${text}</span></div><div class="g-track"><div class="g-fill ${pct > 90 ? "hot" : pct > 75 ? "warm" : ""}" data-w="${Math.max(0, Math.min(100, Math.round(pct)))}"></div></div></div>`;
const pct = (a, b) => (a != null && b ? (a / b) * 100 : 0);

export async function servers(ctx, id) {
  if (id) return detail(ctx, id);
  const rows = await q(db.from("servers").select("*").order("name"));
  const add = () => formDialog({ title: "Add server", fields: FIELDS, onSave: async (v) => { const s = await q(db.from("servers").insert(v).select("id").single()); bust(); ctx.go("#/servers/" + s.id); } });
  const page = listPage({ title: "Servers", sub: "Internal only. Clients never see this list.", rows, onAdd: add, addLabel: "Add server", emptyIcon: "servers", emptyText: "Add your first server, then connect the SXI Agent for live usage.",
    onOpen: (r) => ctx.go("#/servers/" + r.id), searchText: (r) => `${r.name} ${r.ip_address || ""} ${r.provider}`, statuses: ["active", "maintenance", "offline"], statusOf: (r) => r.status,
    cols: [{ label: "Server", cell: (r) => html`<strong>${r.name}</strong><div class="meta">${r.ip_address || "—"} · ${titleCase(r.provider)}</div>` },
      { label: "CPU", hideM: true, cell: (r) => (r.cpu_pct == null ? "—" : r.cpu_pct + "%") }, { label: "Disk", hideM: true, cell: (r) => (r.disk_used_gb == null ? "—" : `${r.disk_used_gb} / ${r.disk_gb || "?"} GB`) },
      { label: "Agent", cell: (r) => (online(r) ? html`<span class="pill ok">Online</span>` : r.last_seen_at ? html`<span class="pill danger">Silent ${timeAgo(r.last_seen_at)}</span>` : html`<span class="pill">Not connected</span>`) }] });
  return { title: "Servers", ...page };
}

async function detail(ctx, id) {
  const s = await q(db.from("servers").select("*").eq("id", id).maybeSingle());
  if (!s) throw new Error("Server not found");
  const [hist, accts] = await Promise.all([q(db.from("server_metrics").select("at,cpu_pct,ram_used_mb").eq("server_id", id).order("at", { ascending: false }).limit(288)),
    q(db.from("hosting_accounts").select("id,plan_name,panel_username,storage_used_mb,storage_limit_mb,usage_synced_at,client_id").eq("server_id", id))]);
  const clients = await lookup("clients");
  const pts = hist.slice().reverse().map((h) => Number(h.cpu_pct) || 0);
  const spark = pts.length > 1 ? raw(`<svg class="chart" viewBox="0 0 300 70" role="img" aria-label="CPU history"><polyline fill="none" stroke="#7aa2ff" stroke-width="2" stroke-linejoin="round" points="${pts.map((v, i) => `${(i / (pts.length - 1) * 296 + 2).toFixed(1)},${(66 - Math.min(100, v) * 0.62).toFixed(1)}`).join(" ")}"/></svg>`) : html`<p class="faint">History appears after a few reports.</p>`;
  const out = html`<a class="back" href="#/servers">${icon("back")}All servers</a>
    <div class="page-head"><div><h1>${s.name}</h1><p>${s.ip_address || "No IP"} · ${titleCase(s.provider)} · ${online(s) ? html`<span class="live">Online · reported ${timeAgo(s.last_seen_at)}</span>` : s.last_seen_at ? html`<span class="pill danger">Silent since ${fmtDateTime(s.last_seen_at)}</span>` : html`<span class="faint">Agent not connected</span>`}</p></div>
      <div class="row"><button class="btn btn-ghost" data-edit type="button">Edit</button><button class="btn btn-primary" data-agent type="button">${s.agent_token_hash ? "New agent token" : "Connect agent"}</button></div></div>
    <div class="grid cols-2"><div class="card"><div class="card-head"><h2>Live usage</h2></div>${s.last_seen_at ? html`<div class="gauges">
      ${bar("CPU", Number(s.cpu_pct) || 0, `${s.cpu_pct ?? 0}% · load ${s.load_1m ?? 0}`)}${bar("Memory", pct(s.ram_used_mb, s.ram_mb), `${s.ram_used_mb ?? 0} / ${s.ram_mb ?? "?"} MB`)}${bar("Disk", pct(s.disk_used_gb, s.disk_gb), `${s.disk_used_gb ?? 0} / ${s.disk_gb ?? "?"} GB`)}</div>
      <p class="faint mt">Uptime ${s.uptime_s ? Math.floor(s.uptime_s / 86400) + " days" : "—"} · ${s.cpu_cores || "?"} vCPU</p>` : html`<p class="faint">No data yet. Press <strong>Connect agent</strong> and run the one command on the server.</p>`}</div>
      <div class="card"><div class="card-head"><h2>CPU · last 24 hours</h2></div>${spark}</div></div>
    <div class="card mt-l"><div class="card-head"><h2>Hosting accounts on this server</h2><a class="link" href="#/hosting">Manage</a></div>
      ${accts.length ? html`<div class="list">${accts.map((a) => html`<div class="item"><div class="item-main"><div class="title">${a.plan_name || "Hosting"} <span class="faint mono">${a.panel_username || "no username"}</span></div><div class="meta">${clients.find((c) => c.id === a.client_id)?.company_name || "—"} · ${a.usage_synced_at ? "synced " + timeAgo(a.usage_synced_at) : "not synced"}</div></div><span>${(a.storage_used_mb / 1024).toFixed(2)} GB</span></div>`)}</div>` : html`<p class="faint">None linked. In Hosting, edit an account and choose this server and its folder name under ${CONFIG ? "/home" : ""}.</p>`}</div>`;
  const mount = (view) => {
    $$(".g-fill", view).forEach((el) => { el.style.width = el.dataset.w + "%"; });
    $("[data-edit]", view).onclick = () => formDialog({ title: "Edit server", fields: FIELDS, row: s,
      onSave: async (v) => { await q(db.from("servers").update(v).eq("id", id)); bust(); ctx.reload(); }, onDelete: async () => { await q(db.from("servers").delete().eq("id", id)); bust(); ctx.go("#/servers"); } });
    $("[data-agent]", view).onclick = async () => {
      if (ctx.profile.role !== "admin") return toast("Only admins can connect an agent.", "error");
      try {
        const r = await callAdminFn({ action: "new_agent_token", server_id: id });
        const cmd = `bash install.sh ${CONFIG.SUPABASE_URL}/functions/v1/server-report ${r.token}`;
        const d = openDialog(html`<div class="dlg"><h2>Connect the SXI Agent</h2><p class="dim">On the server, as root, in the folder containing the <span class="mono">agent</span> files, run this. The token is shown once and replaces any earlier one.</p>
          <textarea class="input mono" readonly rows="4" aria-label="Install command">${cmd}</textarea><div class="actions"><button class="btn btn-ghost" data-close type="button">Done</button><button class="btn btn-primary" data-copy type="button">Copy</button></div></div>`);
        $("[data-copy]", d).onclick = async () => { try { await navigator.clipboard.writeText(cmd); toast("Copied.", "ok"); } catch { $("textarea", d).select(); } };
        ctx.reload();
      } catch (e) { toast(adminError(e), "error"); }
    };
  };
  return { title: s.name, html: out, mount };
}
