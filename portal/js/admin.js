import { db, configured, $, $$, html, icon, q, friendly, loadProfile, signOutEverywhere, skeleton, errorState, openDialog } from "./core.js";
import { startNeuralBackground } from "./neural.js";
import { newInvoice } from "./admin/billing.js";
import { openPalette } from "./admin/palette.js";

const NAV = [["overview", "Overview", "overview"], ["clients", "Clients", "clients"], ["services", "Services", "services"], ["websites", "Websites", "websites"], ["domains", "Domains", "domains"],
  ["hosting", "Hosting", "hosting"], ["email", "Email", "email"], ["invoices", "Invoices", "invoices"], ["renewals", "Renewals", "renewals"], ["payments", "Payments", "payments"], ["support", "Support", "support"],
  ["servers", "Servers", "servers"], ["activity", "Activity", "activity"], ["team", "Team", "team"], ["settings", "Settings", "settings"]];
const PRIMARY = ["overview", "clients", "invoices", "support"];
const app = $("#app");
const ctx = { db, profile: null, reload: () => route(), go: (h) => { location.hash = h; } };
let token = 0;

async function loadView(id, arg) {
  switch (id) {
    case "overview": return (await import("./admin/misc.js")).overview(ctx);
    case "activity": return (await import("./admin/misc.js")).activity(ctx);
    case "team": return (await import("./admin/misc.js")).team(ctx);
    case "settings": return (await import("./admin/misc.js")).settings(ctx);
    case "clients": return (await import("./admin/clients.js")).render(ctx, arg);
    case "invoices": return (await import("./admin/billing.js")).invoices(ctx, arg);
    case "servers": return (await import("./admin/servers.js")).servers(ctx, arg);
    case "renewals": return (await import("./admin/renewals.js")).renewals(ctx);
    case "payments": return (await import("./admin/billing.js")).payments(ctx);
    case "support": return (await import("./admin/support.js")).support(ctx, arg);
    default: return (await import("./admin/resources.js")).render(ctx, id);
  }
}

async function boot() {
  if (!configured) return fatal("The portal isn't connected to its database yet.", "Add your Supabase URL and anon key in portal/js/config.js.");
  let me;
  try { me = await loadProfile(); } catch (e) { return fatal("Can't reach the server.", friendly(e)); }
  if (!me) return location.replace("/login.html?next=" + encodeURIComponent("/admin/" + location.hash));
  if (me.role === "client") return location.replace("/dashboard/");
  ctx.profile = me; ctx.newInvoice = (cid) => newInvoice(ctx, cid);
  app.innerHTML = shell().s;
  startNeuralBackground();
  $$("[data-signout]").forEach((b) => b.addEventListener("click", () => signOutEverywhere()));
  $("#more").addEventListener("click", () => {
    const d = openDialog(html`<div class="dlg"><h2>Menu</h2><nav class="sheet-nav" aria-label="All sections">${NAV.map(([id, label, ic]) => html`<a href="#/${id}">${icon(ic)}<span>${label}</span></a>`)}</nav>
      <button class="btn btn-ghost" data-so type="button">Sign out</button></div>`, { sheet: true });
    $$("a", d).forEach((a) => a.addEventListener("click", () => d.close()));
    $("[data-so]", d).addEventListener("click", () => signOutEverywhere());
  });
  const pal = () => { if (!document.querySelector("dialog.palette")) openPalette(ctx, NAV.filter(([id]) => id !== "team" || me.role === "admin")); };
  $("#search").addEventListener("click", pal);
  document.addEventListener("keydown", (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); pal(); } });
  db.auth.onAuthStateChange((evt) => { if (evt === "SIGNED_OUT" && !window.__signingOut) location.replace("/login.html"); });
  window.addEventListener("hashchange", route);
  route(); openCount(); setInterval(() => { if (!document.hidden) openCount(); }, 60000);
}
function fatal(title, text) {
  app.innerHTML = html`<main class="auth-wrap"><div class="auth-card"><h1>${title}</h1><p class="sub">${text}</p><a class="btn btn-ghost" href="/login.html">Back to sign in</a></div></main>`.s;
}
function shell() {
  const p = ctx.profile;
  const link = ([id, label, ic]) => html`<a href="#/${id}" data-nav="${id}">${icon(ic)}<span>${label}</span>${id === "support" ? html`<span class="count" id="open-count" hidden></span>` : ""}</a>`;
  return html`<div class="app admin">
    <aside class="sidebar"><div class="brand"><img src="../logo.png" alt="" width="30" height="30"><span>SXI Admin</span></div>
      <nav class="nav" aria-label="Main">${NAV.filter(([id]) => id !== "team" || p.role === "admin").map(link)}</nav>
      <div class="sidebar-foot"><div class="who">${p.full_name || p.email}</div><div class="co">${p.role === "admin" ? "Administrator" : "Staff"}</div><button class="btn btn-ghost btn-sm mt" data-signout type="button">Sign out</button></div></aside>
    <div class="main"><header class="topbar"><div class="t-brand"><img src="../logo.png" alt="" width="26" height="26"><span>SXI Admin</span></div><button class="search-btn" id="search" type="button" aria-label="Search and commands">${icon("search")}<span class="lbl-d">Search or jump to…</span><span class="kbd">Ctrl K</span></button><div class="spacer"></div></header>
      <main class="content wide" id="view" tabindex="-1"></main></div>
    <nav class="bottomnav" aria-label="Mobile">${PRIMARY.map((id) => { const n = NAV.find((x) => x[0] === id); return html`<a href="#/${id}" data-nav="${id}">${icon(n[2])}<span>${n[1]}</span></a>`; })}
      <button type="button" id="more" aria-haspopup="dialog">${icon("more")}<span>More</span></button></nav></div>`;
}
async function openCount() {
  try {
    const { count } = await db.from("support_tickets").select("id", { count: "exact", head: true }).in("status", ["open", "waiting_for_client"]);
    const b = $("#open-count"); if (b) { b.hidden = !count; b.textContent = count > 99 ? "99+" : count; }
  } catch { /* non-critical */ }
}
async function route() {
  const my = ++token, view = $("#view");
  const [section, arg] = location.hash.replace(/^#\/?/, "").split("/");
  const id = NAV.some(([n]) => n === section) ? section : "overview";
  $$("[data-nav]").forEach((a) => (a.dataset.nav === id ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
  view.removeAttribute("data-route"); view.innerHTML = skeleton().s;
  const name = [id, arg].filter(Boolean).join("/");
  try {
    const out = await loadView(id, arg);
    if (my !== token) return;
    document.title = `${out.title} · SXI Admin`;
    view.innerHTML = html`<div class="fade">${out.html}</div>`.s;
    out.mount?.(view); view.dataset.route = name;
    view.focus({ preventScroll: true }); window.scrollTo(0, 0);
    if (id === "support") openCount();
  } catch (e) {
    if (my !== token) return;
    console.error(e);
    const { adminError } = await import("./admin/kit.js");
    view.innerHTML = errorState(adminError(e)).s; view.dataset.route = name; $("[data-retry]", view).onclick = route;
  }
}
boot();
