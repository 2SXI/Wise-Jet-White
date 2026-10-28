// Standard create / edit / delete screens, driven by a small config per table.
import { db, q, html, toast, money, fmtDate, pill, mbText, safeUrl, titleCase } from "../core.js";
import { lookup, clientName, clientOptions, formDialog, listPage, bust, adminError } from "./kit.js";

const sel = (arr) => arr.map((v) => [v, titleCase(v)]);
const CUR = [["USD", "USD"], ["ZWG", "ZWG"]];
const clientField = (clients) => ({ name: "client_id", label: "Client", type: "select", required: true, options: clientOptions(clients) });
const cell = (v) => (v == null || v === "" ? html`<span class="faint">—</span>` : v);

const R = {
  services: {
    title: "Services", sub: "What each client has bought from you.", table: "services", kind: "service", status: ["pending", "active", "suspended", "cancelled", "expired"],
    fields: (c) => [clientField(c),
      { name: "type", label: "Type", type: "select", required: true, options: sel(["website", "domain", "hosting", "business_email", "care_plan", "other"]) },
      { name: "name", label: "Name", required: true, max: 200 },
      { name: "status", label: "Status", type: "select", required: true, options: sel(["pending", "active", "suspended", "cancelled", "expired"]), default: "pending" },
      { name: "price_cents", label: "Price", type: "money", required: true, default: "0" },
      { name: "currency", label: "Currency", type: "select", required: true, options: CUR, default: "USD" },
      { name: "billing_cycle", label: "Billing", type: "select", required: true, options: sel(["one_time", "monthly", "quarterly", "yearly"]), default: "yearly" },
      { name: "start_date", label: "Start date", type: "date" }, { name: "renewal_date", label: "Renewal date", type: "date" }],
    cols: (c) => [{ label: "Service", cell: (r) => html`<strong>${r.name}</strong><div class="meta">${titleCase(r.type)}</div>` },
      { label: "Client", cell: (r) => clientName(c, r.client_id), hideM: true }, { label: "Price", cell: (r) => `${money(r.price_cents, r.currency)} / ${titleCase(r.billing_cycle).toLowerCase()}`, hideM: true },
      { label: "Renews", cell: (r) => fmtDate(r.renewal_date), hideM: true }, { label: "Status", cell: (r) => pill("service", r.status) }],
    search: (r, c) => `${r.name} ${r.type} ${clientName(c, r.client_id)}`,
  },
  websites: {
    title: "Websites", sub: "Sites you build and host.", table: "websites", kind: "website", status: ["building", "live", "maintenance", "offline", "suspended"],
    fields: (c, x) => [clientField(c), { name: "name", label: "Name", required: true, max: 200 },
      { name: "url", label: "URL", placeholder: "https://…", hint: "Must start with http:// or https://" },
      { name: "status", label: "Status", type: "select", required: true, options: sel(["building", "live", "maintenance", "offline", "suspended"]), default: "building" },
      { name: "ssl_status", label: "SSL", type: "select", required: true, options: sel(["none", "pending", "active", "expired"]), default: "none" },
      { name: "hosting_account_id", label: "Hosting account", type: "select", options: x.hosting.map((h) => [h.id, `${h.plan_name || "Hosting"} · ${clientName(c, h.client_id)}`]) },
      { name: "domain_id", label: "Domain", type: "select", options: x.domains.map((d) => [d.id, d.name]) },
      { name: "renewal_date", label: "Renewal date", type: "date" }],
    cols: (c) => [{ label: "Website", cell: (r) => html`<strong>${r.name}</strong><div class="meta">${safeUrl(r.url) ? r.url : "—"}</div>` },
      { label: "Client", cell: (r) => clientName(c, r.client_id), hideM: true }, { label: "SSL", cell: (r) => pill("ssl", r.ssl_status), hideM: true }, { label: "Status", cell: (r) => pill("website", r.status) }],
    search: (r, c) => `${r.name} ${r.url || ""} ${clientName(c, r.client_id)}`,
    preSave: (v) => { if (v.url && !/^https?:\/\//i.test(v.url)) throw new Error("The URL must start with http:// or https://"); if (v.status !== undefined) v.last_updated_at = new Date().toISOString(); },
  },
  domains: {
    title: "Domains", sub: "Registered names and their expiry dates.", table: "domains", kind: "domain", status: ["active", "pending", "transferring", "expired", "suspended"],
    fields: (c) => [clientField(c), { name: "name", label: "Domain name", required: true, lower: true, placeholder: "example.co.zw" },
      { name: "registrar", label: "Registrar" }, { name: "registered_at", label: "Registered", type: "date" }, { name: "expires_at", label: "Expires", type: "date" },
      { name: "status", label: "Status", type: "select", required: true, options: sel(["pending", "active", "transferring", "expired", "suspended"]), default: "pending" },
      { name: "renewal_price_cents", label: "Renewal price", type: "money" }, { name: "currency", label: "Currency", type: "select", required: true, options: CUR, default: "USD" },
      { name: "nameservers", label: "Nameservers", type: "array", hint: "Separate with commas" },
      { name: "auto_renew", label: "Auto-renew", type: "checkbox" }],
    cols: (c) => [{ label: "Domain", cell: (r) => html`<strong>${r.name}</strong>` }, { label: "Client", cell: (r) => clientName(c, r.client_id), hideM: true },
      { label: "Expires", cell: (r) => fmtDate(r.expires_at) }, { label: "Auto", cell: (r) => (r.auto_renew ? "On" : "Off"), hideM: true }, { label: "Status", cell: (r) => pill("domain", r.status) }],
    search: (r, c) => `${r.name} ${r.registrar || ""} ${clientName(c, r.client_id)}`,
  },
  hosting: {
    title: "Hosting", sub: "Hosting accounts and their limits. Usage is entered by hand until a control panel is connected.", table: "hosting_accounts", kind: "hosting", status: ["pending", "active", "suspended", "terminated"],
    fields: (c, x) => [clientField(c), { name: "plan_name", label: "Plan" },
      { name: "server_label", label: "Server shown to client", hint: "A friendly label, not the real server name" },
      { name: "server_id", label: "Runs on server", type: "select", options: x.servers.map((v) => [v.id, v.name]) },
      { name: "panel_username", label: "Folder / username on server", lower: true, placeholder: "arikho", hint: "Matches the folder under /home. The SXI Agent then keeps storage usage up to date automatically." },
      { name: "status", label: "Status", type: "select", required: true, options: sel(["pending", "active", "suspended", "terminated"]), default: "pending" },
      { name: "ssl_status", label: "SSL", type: "select", required: true, options: sel(["none", "pending", "active", "expired"]), default: "none" },
      { name: "storage_used_mb", label: "Storage used (GB)", type: "mb", default: "0" }, { name: "storage_limit_mb", label: "Storage limit (GB)", type: "mb" },
      { name: "bandwidth_used_mb", label: "Bandwidth used (GB)", type: "mb", default: "0" }, { name: "bandwidth_limit_mb", label: "Bandwidth limit (GB)", type: "mb" },
      { name: "websites_limit", label: "Websites limit", type: "number" }, { name: "databases_used", label: "Databases used", type: "number", default: "0" },
      { name: "databases_limit", label: "Databases limit", type: "number" }, { name: "email_accounts_limit", label: "Mailbox limit", type: "number" },
      { name: "renewal_date", label: "Renewal date", type: "date" }],
    cols: (c) => [{ label: "Plan", cell: (r) => html`<strong>${r.plan_name || "Hosting"}</strong><div class="meta">${r.server_label || "—"}</div>` },
      { label: "Client", cell: (r) => clientName(c, r.client_id), hideM: true }, { label: "Storage", cell: (r) => `${mbText(r.storage_used_mb)} / ${r.storage_limit_mb ? mbText(r.storage_limit_mb) : "∞"}`, hideM: true },
      { label: "Renews", cell: (r) => fmtDate(r.renewal_date), hideM: true }, { label: "Status", cell: (r) => pill("hosting", r.status) }],
    search: (r, c) => `${r.plan_name || ""} ${r.server_label || ""} ${clientName(c, r.client_id)}`,
    preSave: (v) => { v.usage_synced_at = new Date().toISOString(); },
  },
  email: {
    title: "Email", sub: "Business mailboxes. Passwords are never stored here.", table: "email_accounts", kind: "mailbox", status: ["pending", "active", "suspended", "deleted"],
    fields: (c, x) => [clientField(c), { name: "address", label: "Address", required: true, lower: true, placeholder: "info@example.co.zw" },
      { name: "domain_id", label: "Domain", type: "select", options: x.domains.map((d) => [d.id, d.name]) },
      { name: "status", label: "Status", type: "select", required: true, options: sel(["pending", "active", "suspended", "deleted"]), default: "pending" },
      { name: "storage_used_mb", label: "Storage used (GB)", type: "mb", default: "0" }, { name: "storage_limit_mb", label: "Storage limit (GB)", type: "mb" }],
    cols: (c) => [{ label: "Mailbox", cell: (r) => html`<strong>${r.address}</strong>` }, { label: "Client", cell: (r) => clientName(c, r.client_id), hideM: true },
      { label: "Storage", cell: (r) => `${mbText(r.storage_used_mb)} / ${r.storage_limit_mb ? mbText(r.storage_limit_mb) : "∞"}`, hideM: true }, { label: "Status", cell: (r) => pill("mailbox", r.status) }],
    search: (r, c) => `${r.address} ${clientName(c, r.client_id)}`,
  },
  servers: {
    title: "Servers", sub: "Internal only. Clients never see this list.", table: "servers", kind: "service", status: ["active", "maintenance", "offline"], noClient: true,
    fields: () => [{ name: "name", label: "Name", required: true }, { name: "ip_address", label: "IP address" },
      { name: "provider", label: "Provider", type: "select", required: true, options: sel(["cloudpanel", "cpanel", "directadmin", "plesk", "vps", "manual"]), default: "manual" },
      { name: "os", label: "Operating system" }, { name: "status", label: "Status", type: "select", required: true, options: sel(["active", "maintenance", "offline"]), default: "active" },
      { name: "cpu_cores", label: "CPU cores", type: "number" }, { name: "ram_mb", label: "RAM (MB)", type: "number" },
      { name: "disk_gb", label: "Disk (GB)", type: "number" }, { name: "bandwidth_gb", label: "Bandwidth (GB)", type: "number" },
      { name: "credentials_ref", label: "Credentials reference", hint: "Where the login is kept (e.g. password-manager entry). Never paste the password here." }],
    cols: () => [{ label: "Server", cell: (r) => html`<strong>${r.name}</strong><div class="meta">${r.ip_address || "—"}</div>` }, { label: "Provider", cell: (r) => titleCase(r.provider), hideM: true },
      { label: "Specs", cell: (r) => [r.cpu_cores && `${r.cpu_cores} vCPU`, r.ram_mb && `${r.ram_mb} MB`, r.disk_gb && `${r.disk_gb} GB`].filter(Boolean).join(" · ") || "—", hideM: true },
      { label: "Status", cell: (r) => html`<span class="pill ${r.status === "active" ? "ok" : r.status === "maintenance" ? "warn" : "danger"}">${titleCase(r.status)}</span>` }],
    search: (r) => `${r.name} ${r.ip_address || ""} ${r.provider}`,
  },
};
export const RESOURCE_IDS = Object.keys(R);

export async function render(ctx, id) {
  const cfg = R[id];
  const [clients, hosting, domains, rows] = await Promise.all([
    lookup("clients"), lookup("hosting"), lookup("domains"),
    q(db.from(cfg.table).select("*").order("created_at", { ascending: false }).limit(500)),
  ]);
  const x = { hosting, domains, servers: id === "hosting" ? await lookup("servers") : [] };
  const refresh = () => { bust(); ctx.reload(); };
  const edit = (row) => formDialog({
    title: row ? `Edit ${cfg.title.toLowerCase().replace(/s$/, "")}` : `Add ${cfg.title.toLowerCase().replace(/s$/, "")}`,
    fields: cfg.fields(clients, x), row,
    onSave: async (v) => {
      cfg.preSave?.(v);
      if (row) await q(db.from(cfg.table).update(v).eq("id", row.id)); else await q(db.from(cfg.table).insert(v));
      toast(row ? "Saved." : "Added.", "ok"); refresh();
    },
    onDelete: row ? async () => { await q(db.from(cfg.table).delete().eq("id", row.id)); toast("Deleted.", "ok"); refresh(); } : null,
  });
  const page = listPage({
    title: cfg.title, sub: cfg.sub, rows, cols: cfg.cols(clients), searchText: (r) => cfg.search(r, clients),
    statuses: cfg.status, statusOf: (r) => r.status, onOpen: edit, onAdd: () => edit(null), addLabel: `Add ${cfg.title.toLowerCase().replace(/s$/, "")}`,
  });
  return { title: cfg.title, ...page };
}
