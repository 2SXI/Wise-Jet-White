import { CONFIG } from "./config.js";
import { html, raw, esc, homeFor, safeNext } from "./util.js";
export * from "./util.js";
export { CONFIG };

export const configured = !/YOUR-PROJECT|YOUR-ANON/.test(CONFIG.SUPABASE_URL + CONFIG.SUPABASE_ANON_KEY);
export const db = configured
  ? window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Unwrap a Supabase response or throw its error. */
export async function q(promise) {
  const { data, error } = await promise;
  if (error) throw error;
  return data;
}

/** Turn technical errors into something a client can read. Never shows SQL or stack traces. */
export function friendly(err) {
  const m = String(err?.message || err || "");
  if (/failed to fetch|networkerror|load failed/i.test(m)) return "Can't reach the server. Check your connection and try again.";
  if (/jwt|not authenticated|session/i.test(m)) return "Your session has expired. Please sign in again.";
  if (/not found|not allowed/i.test(m)) return "That item isn't available.";
  if (/violates check constraint|too short|length/i.test(m)) return "Please check what you entered and try again.";
  return "Something went wrong. Please try again, or contact support if it continues.";
}

/* ---------- icons (inline SVG, no external requests) ---------- */
const ICONS = {
  overview: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  websites: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  domains: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  email: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  hosting: '<rect x="3" y="4" width="18" height="6" rx="1.5"/><rect x="3" y="14" width="18" height="6" rx="1.5"/><path d="M7 7h.01M7 17h.01"/>',
  invoices: '<path d="M6 3h9l4 4v14l-3-2-3 2-3-2-3 2z"/><path d="M9 9h6M9 13h6"/>',
  support: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>',
  profile: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  clients: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><circle cx="17" cy="9" r="2.5"/><path d="M17 14.5a5 5 0 0 1 4.5 5"/>',
  payments: '<rect x="2.5" y="5" width="19" height="14" rx="2"/><path d="M2.5 10h19M6 15h4"/>',
  servers: '<rect x="3" y="4" width="18" height="6" rx="1.5"/><rect x="3" y="14" width="18" height="6" rx="1.5"/><path d="M7 7h.01M7 17h.01M12 7h5M12 17h5"/>',
  activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  team: '<path d="M12 3 4 6v5c0 5 3.4 8.4 8 10 4.6-1.6 8-5 8-10V6z"/><path d="m9 12 2 2 4-4"/>',
  services: '<path d="M12 3 3 8l9 5 9-5z"/><path d="m3 13 9 5 9-5M3 17.5l9 5 9-5"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  renewals: '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  download: '<path d="M12 4v11M7 11l5 5 5-5M5 20h14"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  bell: '<path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
  more: '<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>',
  back: '<path d="m15 18-6-6 6-6"/>', external: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  inbox: '<path d="M3 13h5l1 3h6l1-3h5"/><path d="M5 5h14l2 8v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-6z"/>', alert: '<circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/>',
  print: '<path d="M6 9V3h12v6M6 18H4a1 1 0 0 1-1-1v-6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6a1 1 0 0 1-1 1h-2"/><rect x="6" y="14" width="12" height="7"/>',
};
export const icon = (name) => raw(`<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICONS[name] || ""}</svg>`);

/* ---------- toast ---------- */
export function toast(message, type = "") {
  let box = $(".toasts");
  if (!box) { box = document.createElement("div"); box.className = "toasts"; box.setAttribute("role", "status"); box.setAttribute("aria-live", "polite"); document.body.append(box); }
  const t = document.createElement("div");
  t.className = `toast ${type}`; t.textContent = message;
  box.append(t); setTimeout(() => t.remove(), type === "error" ? 6000 : 3500);
}

/* ---------- dialogs (native <dialog>: focus trap + Esc handled by the browser) ---------- */
export function openDialog(content, { sheet = false } = {}) {
  const d = document.createElement("dialog");
  if (sheet) d.className = "sheet";
  d.innerHTML = content instanceof Object && "s" in content ? content.s : esc(content);
  d.addEventListener("close", () => d.remove());
  d.addEventListener("click", (e) => { if (e.target === d) d.close(); });   // click on backdrop
  document.body.append(d); d.showModal();
  $$("[data-close]", d).forEach((b) => b.addEventListener("click", () => d.close()));
  return d;
}
export function confirmDialog({ title, body, confirmText = "Confirm", danger = false }) {
  return new Promise((resolve) => {
    const d = openDialog(html`<div class="dlg"><h2>${title}</h2><p class="dim">${body}</p>
      <div class="actions"><button class="btn btn-ghost" data-close type="button">Cancel</button>
      <button class="btn ${danger ? "btn-danger" : "btn-primary"}" data-ok type="button">${confirmText}</button></div></div>`);
    let ok = false;
    $("[data-ok]", d).addEventListener("click", () => { ok = true; d.close(); });
    d.addEventListener("close", () => resolve(ok));
  });
}

/* ---------- common UI blocks ---------- */
export const emptyState = (iconName, title, text, action = "") =>
  html`<div class="empty fade">${icon(iconName)}<h3>${title}</h3><p>${text}</p>${action}</div>`;
export const errorState = (message) =>
  html`<div class="empty fade">${icon("alert")}<h3>We couldn't load this</h3><p>${message}</p><button class="btn btn-ghost btn-sm" data-retry type="button">Try again</button></div>`;
export const skeleton = (rows = 3) =>
  html`<div class="stack" aria-busy="true" aria-label="Loading">${Array.from({ length: rows }, () => html`<div class="skel h96"></div>`)}</div>`;

export function meter(label, used, limit, fmt = (n) => n) {
  const hasLimit = limit != null && Number(limit) > 0;
  const p = hasLimit ? Math.min(100, Math.round((Number(used) / Number(limit)) * 100)) : 0;
  const cls = p >= 95 ? "danger" : p >= 85 ? "warn" : "";
  return html`<div class="meter"><div class="top"><span>${label}</span><span>${fmt(used)}${hasLimit ? html` / ${fmt(limit)}` : html` <span class="faint">· no limit set</span>`}</span></div>
    <progress class="${cls}" max="100" value="${p}" aria-label="${label} usage"></progress></div>`;
}

/* ---------- session ---------- */
export async function loadProfile() {
  if (!db) return null;
  const { data: { user } } = await db.auth.getUser();
  if (!user) return null;
  const { data: p } = await db.from("profiles")
    .select("id,email,full_name,phone,role,client_id,is_active").eq("id", user.id).maybeSingle();
  return p && p.is_active ? p : null;
}
export async function signOutEverywhere(scope = "local") {
  window.__signingOut = true;   // tells the auth listener not to redirect a second time
  try { await db.rpc("log_own_event", { p_action: "auth.logout" }); } catch { /* best effort */ }
  await db.auth.signOut({ scope });
  location.replace("/login.html");
}
export { homeFor, safeNext };
