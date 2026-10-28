// Ctrl/Cmd+K command palette: jump to any screen, client, invoice, domain or ticket; run quick actions.
import { db, q, $, $$, html, icon, openDialog } from "../core.js";
import { lookup } from "./kit.js";

let data = null;
async function load() {
  if (data) return data;
  const get = (t, sel, ord) => db.from(t).select(sel).order(ord, { ascending: false }).limit(150).then((r) => r.data || []).catch(() => []);
  const [clients, domains, invoices, tickets] = await Promise.all([lookup("clients").catch(() => []), get("domains", "id,name", "created_at"), get("invoices", "id,number,status", "created_at"), get("support_tickets", "id,subject", "updated_at")]);
  return (data = { clients, domains, invoices, tickets });
}
export const resetPalette = () => { data = null; };

export function openPalette(ctx, nav) {
  const d = openDialog(html`<div class="pal"><input id="pal-q" type="search" placeholder="Search clients, invoices, domains, tickets… or type a command" aria-label="Search" autocomplete="off">
    <div class="pal-list" role="listbox" id="pal-list"></div><div class="pal-foot"><span><span class="kbd">↑↓</span> move</span><span><span class="kbd">Enter</span> open</span><span><span class="kbd">Esc</span> close</span></div></div>`);
  d.classList.add("palette");
  const input = $("#pal-q", d), list = $("#pal-list", d); let items = [], sel = 0;
  const base = [
    ...nav.map(([id, label, ic]) => ({ g: "Go to", t: label, ic, run: () => ctx.go("#/" + id) })),
    { g: "Actions", t: "New invoice", ic: "plus", run: () => ctx.newInvoice() },
    { g: "Actions", t: "Add client", ic: "clients", run: () => ctx.go("#/clients/new") },
  ];
  const build = (term) => {
    const t = term.trim().toLowerCase(), D = data || { clients: [], domains: [], invoices: [], tickets: [] };
    const all = [...base,
      ...D.clients.map((c) => ({ g: "Clients", t: c.company_name, m: c.email || "", ic: "clients", run: () => ctx.go("#/clients/" + c.id) })),
      ...D.invoices.map((i) => ({ g: "Invoices", t: i.number, m: i.status, ic: "invoices", run: () => ctx.go("#/invoices/" + i.id) })),
      ...D.domains.map((x) => ({ g: "Domains", t: x.name, ic: "domains", run: () => ctx.go("#/domains") })),
      ...D.tickets.map((x) => ({ g: "Tickets", t: x.subject, ic: "support", run: () => ctx.go("#/support/" + x.id) }))];
    items = (t ? all.filter((i) => `${i.t} ${i.m || ""}`.toLowerCase().includes(t)) : all.filter((i) => i.g !== "Domains" && i.g !== "Tickets" && i.g !== "Invoices")).slice(0, 30);
    sel = 0; draw();
  };
  const draw = () => {
    let g = "";
    list.innerHTML = items.length ? items.map((i, n) => { const head = i.g !== g ? html`<div class="pal-group">${i.g}</div>` : ""; g = i.g;
      return html`${head}<button class="pal-item" type="button" role="option" data-n="${n}" aria-selected="${n === sel}">${icon(i.ic)}<span>${i.t}</span>${i.m ? html`<span class="meta">${i.m}</span>` : ""}</button>`; }).map(String).join("") : html`<p class="faint pal-group">No results</p>`.s;
    $$(".pal-item", list).forEach((b) => b.addEventListener("click", () => go(+b.dataset.n)));
    list.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  };
  const go = (n) => { const it = items[n]; if (!it) return; d.close(); it.run(); };
  input.addEventListener("input", () => build(input.value));
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); sel = Math.min(items.length - 1, sel + 1); draw(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); sel = Math.max(0, sel - 1); draw(); }
    else if (e.key === "Enter") { e.preventDefault(); go(sel); }
  });
  build(""); input.focus(); load().then(() => { if (d.isConnected) build(input.value); });
}
