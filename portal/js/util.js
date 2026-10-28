// Pure helpers (no DOM, no Supabase) so they can be unit-tested in Node.

/* ---------- safe HTML templating ----------
   Everything interpolated into html`...` is ESCAPED unless it is already an html`` result
   or wrapped in raw(). This is the main defence against XSS from stored data. */
class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Raw(String(s));
export function esc(v) {
  return String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
const part = (v) => v instanceof Raw ? v.s : Array.isArray(v) ? v.map(part).join("") : (v == null || v === false) ? "" : esc(v);
export function html(strings, ...vals) {
  let out = strings[0];
  vals.forEach((v, i) => { out += part(v) + strings[i + 1]; });
  return new Raw(out);
}

/* ---------- redirects ---------- */
export function homeFor(role) { return role === "client" ? "/dashboard/" : "/admin/"; }
/** Only same-site paths inside the area the role may use; everything else falls back to the role's home. */
export function safeNext(next, role) {
  const fallback = homeFor(role);
  if (typeof next !== "string" || !next || next.length > 300) return fallback;
  if (!next.startsWith("/") || next.startsWith("//") || next.includes("\\") || /[\u0000-\u001f\u007f]/.test(next)) return fallback;
  let u; try { u = new URL(next, "https://x.invalid"); } catch { return fallback; }
  if (u.origin !== "https://x.invalid") return fallback;
  const area = role === "client" ? "/dashboard" : "/admin";
  const ok = u.pathname === area || u.pathname.startsWith(area + "/");
  return ok ? u.pathname + u.search + u.hash : fallback;
}

/* ---------- formatting ---------- */
export function money(cents, currency = "USD") {
  if (cents == null) return "—";
  const v = Number(cents) / 100;
  try { return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(v); }
  catch { return `${v.toFixed(2)} ${currency}`; }
}
const dOpts = { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" };
export function fmtDate(d) {
  if (!d) return "—";
  const dt = /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(d + "T00:00:00Z") : new Date(d);
  return isNaN(dt) ? "—" : dt.toLocaleDateString("en-GB", dOpts);
}
export function fmtDateTime(d) {
  if (!d) return "—";
  const dt = new Date(d);
  return isNaN(dt) ? "—" : dt.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
export function timeAgo(d, now = Date.now()) {
  const s = Math.max(0, Math.round((now - new Date(d).getTime()) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} d ago`;
  return fmtDate(new Date(d).toISOString().slice(0, 10));
}
export function daysUntil(dateStr, now = new Date()) {
  if (!dateStr) return null;
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((new Date(dateStr + "T00:00:00Z").getTime() - today) / 86400000);
}
export function mbText(mb) {
  if (mb == null) return "—";
  const n = Number(mb);
  return n >= 1024 ? `${(n / 1024).toFixed(n >= 10240 ? 0 : 1)} GB` : `${n} MB`;
}
export const pct = (used, limit) => (!limit ? 0 : Math.min(100, Math.round((Number(used) / Number(limit)) * 100)));
export const titleCase = (s) => String(s).replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

/* ---------- status → colour ---------- */
const TONES = {
  website:  { live: "ok", building: "info", maintenance: "warn", offline: "danger", suspended: "danger" },
  domain:   { active: "ok", pending: "info", transferring: "info", expired: "danger", suspended: "danger" },
  hosting:  { active: "ok", pending: "info", suspended: "danger", terminated: "danger" },
  mailbox:  { active: "ok", pending: "info", suspended: "danger" },
  invoice:  { paid: "ok", sent: "info", overdue: "danger" },
  ticket:   { open: "info", in_progress: "warn", waiting_for_client: "warn", resolved: "ok" },
  ssl:      { active: "ok", pending: "info", expired: "danger" },
  service:  { active: "ok", pending: "info", suspended: "danger", expired: "danger" },
  account:  { active: "ok", suspended: "danger" },
};
export function tone(kind, status) { return (TONES[kind] || {})[status] || ""; }
export function statusLabel(kind, status) {
  if (kind === "ssl") return status === "none" ? "No SSL" : `SSL ${status}`;
  if (kind === "ticket" && status === "waiting_for_client") return "Waiting for you";
  return titleCase(status);
}
export function pill(kind, status) {
  return html`<span class="pill ${tone(kind, status)}">${statusLabel(kind, status)}</span>`;
}

/* ---------- activity feed wording ---------- */
export function describeActivity(a) {
  const m = a.metadata || {};
  const to = m.to, changed = m.changed || [];
  switch (a.action) {
    case "invoices.update": return to === "sent" ? "Invoice issued" : to === "paid" ? "Invoice paid" : to === "overdue" ? "Invoice marked overdue" : "Invoice updated";
    case "payments.insert": return "Payment recorded";
    case "payments.update": return to ? `Payment ${to}` : "Payment updated";
    case "domains.update":  return changed.includes("auto_renew") ? "Domain auto-renew changed" : to ? `Domain ${to}` : "Domain updated";
    case "domains.insert":  return "Domain added";
    case "websites.update": return to ? `Website is now ${to}` : "Website updated";
    case "websites.insert": return "Website added";
    case "hosting_accounts.update": return to ? `Hosting ${to}` : "Hosting updated";
    case "hosting_accounts.insert": return "Hosting account created";
    case "email_accounts.insert": return "Mailbox added";
    case "email_accounts.update": return to ? `Mailbox ${to}` : "Mailbox updated";
    case "services.insert": return "Service added";
    case "services.update": return to ? `Service ${to}` : "Service updated";
    case "support_tickets.insert": return "Support ticket opened";
    case "support_tickets.update": return to ? `Ticket ${titleCase(to).toLowerCase()}` : "Ticket updated";
    default: return titleCase((a.entity_type || "item").replace(/s$/, "")) + " updated";
  }
}

/** Maps a notification's server-side link (/dashboard/xyz) to a hash route (#/xyz). */
export function linkToHash(link) {
  if (typeof link !== "string" || !link.startsWith("/dashboard")) return "#/overview";
  const rest = link.slice("/dashboard".length).replace(/^\/+/, "");
  return "#/" + (rest || "overview");
}

/** Only http(s) URLs may become links; anything else (javascript:, data:, ...) is dropped. */
export function safeUrl(u) { return typeof u === "string" && /^https?:\/\/[^\s"'<>]+$/i.test(u) ? u : null; }
