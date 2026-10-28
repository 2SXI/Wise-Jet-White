import { db, configured, $, $$, html, raw, icon, toast, q, friendly, loadProfile, signOutEverywhere,
         skeleton, errorState, timeAgo, linkToHash, openDialog } from "./core.js";

const NAV = [["overview", "Overview"], ["websites", "Websites"], ["domains", "Domains"], ["email", "Email"], ["hosting", "Hosting"],
             ["invoices", "Invoices"], ["support", "Support"], ["profile", "Profile"], ["settings", "Settings"]];
const PRIMARY = ["overview", "websites", "invoices", "support"];   // bottom bar on phones; the rest live under "More"
const ids = NAV.map(([id]) => id);

const app = $("#app");
const ctx = { db, profile: null, client: null, reload: () => route(), go: (h) => { location.hash = h; } };
let notifs = [], token = 0;

/* ---------------------------------- boot ---------------------------------- */
async function boot() {
  if (!configured) return fatal("The portal isn't connected to its database yet.", "Add your Supabase URL and anon key in portal/js/config.js.");
  let profile;
  try { profile = await loadProfile(); } catch (e) { return fatal("Can't reach the server.", friendly(e)); }
  if (!profile) return location.replace("/login.html?next=" + encodeURIComponent("/dashboard/" + location.hash));
  if (profile.role !== "client") return location.replace("/admin/");

  let client;
  try { client = await q(db.from("clients").select("id,company_name,contact_name,email,phone,address,status").maybeSingle()); }
  catch (e) { return fatal("We couldn't load your account.", friendly(e)); }
  ctx.profile = profile; ctx.client = client;

  if (!client) {   // login exists but isn't linked to a company yet
    app.innerHTML = html`<main class="auth-wrap"><div class="auth-card"><h1>Your account is being set up</h1>
      <p class="sub">Your login isn't linked to a company yet. SXI Digital will finish this shortly — contact us if it takes long.</p>
      <button class="btn btn-ghost" id="so" type="button">Sign out</button></div></main>`.s;
    $("#so").onclick = () => signOutEverywhere(); return;
  }

  app.innerHTML = shell().s;
  wire();
  // Signed out in another tab (or session revoked) → back to login. Our own sign-out redirects itself.
  db.auth.onAuthStateChange((evt) => { if (evt === "SIGNED_OUT" && !window.__signingOut) location.replace("/login.html"); });
  window.addEventListener("hashchange", route);
  route();
  loadNotifs();
  setInterval(() => { if (!document.hidden) loadNotifs(); }, 60000);
}

function fatal(title, text) {
  app.innerHTML = html`<main class="auth-wrap"><div class="auth-card"><h1>${title}</h1><p class="sub">${text}</p>
    <a class="btn btn-ghost" href="/login.html">Back to sign in</a></div></main>`.s;
}

/* ---------------------------------- shell ---------------------------------- */
function shell() {
  const { profile, client } = ctx;
  return html`<div class="app">
  <aside class="sidebar">
    <div class="brand"><img src="../logo.png" alt="" width="30" height="30"><span>SXI Digital</span></div>
    <nav class="nav" aria-label="Main">${NAV.map(([id, label]) => html`<a href="#/${id}" data-nav="${id}">${icon(id)}<span>${label}</span></a>`)}</nav>
    <div class="sidebar-foot"><div class="who">${profile.full_name || profile.email}</div><div class="co">${client.company_name}</div>
      <button class="btn btn-ghost btn-sm mt" data-signout type="button">Sign out</button></div>
  </aside>
  <div class="main">
    <header class="topbar">
      <div class="t-brand"><img src="../logo.png" alt="" width="26" height="26"><span>SXI Digital</span></div>
      <div class="spacer"></div>
      <div class="panel-wrap">
        <button class="icon-btn" id="bell" type="button" aria-label="Notifications" aria-haspopup="true" aria-expanded="false">${icon("bell")}<span class="badge-dot" id="bell-count" hidden></span></button>
        <div class="panel" id="notif-panel" hidden></div>
      </div>
    </header>
    <main class="content" id="view" tabindex="-1"></main>
  </div>
  <nav class="bottomnav" aria-label="Mobile">
    ${PRIMARY.map((id) => html`<a href="#/${id}" data-nav="${id}">${icon(id)}<span>${NAV.find((n) => n[0] === id)[1]}</span></a>`)}
    <button type="button" id="more" aria-haspopup="dialog">${icon("more")}<span>More</span></button>
  </nav>
</div>`;
}

function wire() {
  $$("[data-signout]").forEach((b) => b.addEventListener("click", () => signOutEverywhere()));
  $("#more").addEventListener("click", () => {
    const d = openDialog(html`<div class="dlg"><h2>Menu</h2><nav class="sheet-nav" aria-label="All sections">
      ${NAV.map(([id, label]) => html`<a href="#/${id}">${icon(id)}<span>${label}</span></a>`)}</nav>
      <button class="btn btn-ghost" data-so type="button">Sign out</button></div>`, { sheet: true });
    $$("a", d).forEach((a) => a.addEventListener("click", () => d.close()));
    $("[data-so]", d).addEventListener("click", () => signOutEverywhere());
  });
  $("#bell").addEventListener("click", (e) => { e.stopPropagation(); toggleNotifs(); });
  document.addEventListener("click", (e) => { if (!e.target.closest(".panel-wrap")) closeNotifs(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeNotifs(); });
}

/* -------------------------------- notifications -------------------------------- */
async function loadNotifs() {
  try {
    notifs = await q(db.from("notifications").select("id,type,title,body,link,read_at,created_at").order("created_at", { ascending: false }).limit(15));
    const n = notifs.filter((x) => !x.read_at).length, badge = $("#bell-count");
    badge.hidden = n === 0; badge.textContent = n > 9 ? "9+" : n;
    $("#bell").setAttribute("aria-label", n ? `Notifications (${n} unread)` : "Notifications");
    if (!$("#notif-panel").hidden) renderNotifs();
  } catch { /* the bell is non-critical; stay quiet */ }
}
function renderNotifs() {
  const panel = $("#notif-panel"), unread = notifs.some((n) => !n.read_at);
  panel.innerHTML = html`<header><h3>Notifications</h3>${unread ? html`<button class="link" data-readall type="button">Mark all read</button>` : ""}</header>
    ${notifs.length ? notifs.map((n) => html`<button class="notif ${n.read_at ? "" : "unread"}" type="button" data-id="${n.id}" data-link="${n.link || ""}">
        <div class="n-title">${n.title}</div>${n.body ? html`<div class="dim">${n.body}</div>` : ""}<div class="n-meta">${timeAgo(n.created_at)}</div></button>`)
      : html`<div class="empty">${icon("inbox")}<h3>You're all caught up</h3><p>Invoices, renewals and support replies will show up here.</p></div>`}`.s;
  const readAll = $("[data-readall]", panel);
  if (readAll) readAll.onclick = async () => {
    try { await q(db.from("notifications").update({ read_at: new Date().toISOString() }).is("read_at", null)); await loadNotifs(); } catch (e) { toast(friendly(e), "error"); }
  };
  $$(".notif", panel).forEach((b) => b.addEventListener("click", async () => {
    const n = notifs.find((x) => x.id === b.dataset.id);
    closeNotifs();
    if (n && !n.read_at) { try { await q(db.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", n.id)); } catch { /* ignore */ } loadNotifs(); }
    ctx.go(linkToHash(b.dataset.link));
  }));
}
function toggleNotifs() { const p = $("#notif-panel"); if (p.hidden) { renderNotifs(); p.hidden = false; $("#bell").setAttribute("aria-expanded", "true"); loadNotifs(); } else closeNotifs(); }
function closeNotifs() { const p = $("#notif-panel"); if (p && !p.hidden) { p.hidden = true; $("#bell").setAttribute("aria-expanded", "false"); } }

/* ----------------------------------- router ----------------------------------- */
async function route() {
  const my = ++token, view = $("#view");
  const [section, arg] = location.hash.replace(/^#\/?/, "").split("/");
  const id = ids.includes(section) ? section : "overview";

  $$("[data-nav]").forEach((a) => (a.dataset.nav === id ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));

  view.removeAttribute("data-route"); view.innerHTML = skeleton().s;
  const routeName = [id, arg].filter(Boolean).join("/");
  try {
    const mod = await import(`./views/${id}.js`);
    const out = await mod.render(ctx, arg);
    if (my !== token) return;                      // user already navigated elsewhere
    document.title = `${out.title} · SXI Digital`;
    const banner = ctx.client.status === "suspended"
      ? html`<p class="alert warn mt" role="status">Your account is suspended. You can still view invoices and contact support.</p>` : "";
    view.innerHTML = html`${banner}<div class="fade">${out.html}</div>`.s;
    out.mount?.(view);
    view.dataset.route = routeName;                // marks which screen is on display (used by tests / debugging)
    view.focus({ preventScroll: true }); window.scrollTo(0, 0);
  } catch (e) {
    if (my !== token) return;
    console.error(e);
    view.innerHTML = errorState(friendly(e)).s;
    view.dataset.route = routeName;
    $("[data-retry]", view).onclick = route;
  }
}

boot();
