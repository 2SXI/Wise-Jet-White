// Loads the admin app and, if anything fails (missing file, old cached copy, syntax error), says so on the page.
const app = document.getElementById("app");
const show = (title, detail) => {
  app.textContent = "";
  const wrap = document.createElement("main"); wrap.className = "auth-wrap";
  const card = document.createElement("div"); card.className = "auth-card";
  const h = document.createElement("h1"); h.textContent = title;
  const p = document.createElement("p"); p.className = "sub"; p.textContent = detail;
  const pre = document.createElement("pre"); pre.className = "mono faint"; 
  card.append(h, p); wrap.append(card); app.append(wrap); return pre;
};
import("./admin.js?v=3").catch((e) => {
  console.error(e);
  const msg = String(e && e.message || e);
  show("The admin couldn't start",
    "A script failed to load. Re-upload the whole site folder (including portal/js/admin/), then hard-refresh with Ctrl+Shift+R. Details: " + msg);
});
