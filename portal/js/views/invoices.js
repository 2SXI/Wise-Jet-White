import { html, q, pill, money, fmtDate, emptyState, icon, $, $$ } from "../core.js";
import { requestDialog } from "./_shared.js";

const METHODS = { ecocash: "EcoCash", paynow: "Paynow", paypal: "PayPal", bank_transfer: "Bank transfer", cash: "Cash", card: "Card" };
const COLS = "id,number,status,currency,subtotal_cents,total_cents,issue_date,due_date,sent_at,paid_at,notes";

export async function render(ctx, id) {
  const { db, client } = ctx;

  if (id) {
    const inv = await q(db.from("invoices").select(COLS).eq("id", id).maybeSingle());
    if (!inv) return { title: "Invoice", html: html`<a class="back" href="#/invoices">${icon("back")} Invoices</a>${emptyState("invoices", "Invoice not found", "It may not be part of your account.")}` };
    const [items, payments] = await Promise.all([
      q(db.from("invoice_items").select("id,description,quantity,unit_price_cents,position").eq("invoice_id", id).order("position")),
      q(db.from("payments").select("id,amount_cents,currency,status,paid_at,method").eq("invoice_id", id).order("created_at")),
    ]);
    const paid = payments.filter((p) => p.status === "paid").reduce((s, p) => s + Number(p.amount_cents), 0);
    const mount = (root) => {
      $("[data-print]", root).addEventListener("click", () => window.print());
      $("[data-ask]", root)?.addEventListener("click", () => requestDialog(ctx, { title: `Question about ${inv.number}`, label: "How can we help?", subject: `Invoice ${inv.number}`, category: "billing", relatedType: "invoice", relatedId: inv.id }));
    };
    return { title: inv.number, mount, html: html`<div class="stack">
      <div class="no-print"><a class="back" href="#/invoices">${icon("back")} Invoices</a>
        <div class="page-head"><h1>${inv.number}</h1><div class="row"><button class="btn btn-ghost btn-sm" data-print type="button">${icon("print")} Print / Save PDF</button>
          <button class="btn btn-primary btn-sm" data-ask type="button">Ask about this invoice</button></div></div></div>
      <section class="card">
        <div class="inv-head"><div><div class="brand"><img src="../logo.png" alt="" width="30" height="30"><span>SXI Digital</span></div>
            <p class="dim mt">hello@sxidigital.com · +263 78 105 3299</p></div>
          <div class="inv-meta"><div class="big">Invoice ${inv.number}</div>${pill("invoice", inv.status)}
            <p class="dim mt">Issued ${fmtDate(inv.issue_date)}<br>Due ${fmtDate(inv.due_date)}</p></div></div>
        <div class="mb"><h3>Billed to</h3><p>${client.company_name}</p>${client.contact_name ? html`<p class="dim">${client.contact_name}</p>` : ""}${client.address ? html`<p class="dim">${client.address}</p>` : ""}</div>
        <table class="tbl mt-l"><thead><tr><th>Description</th><th class="num">Qty</th><th class="num">Price</th><th class="num">Amount</th></tr></thead><tbody>
          ${items.map((i) => html`<tr><td>${i.description}</td><td class="num">${Number(i.quantity)}</td><td class="num">${money(i.unit_price_cents, inv.currency)}</td><td class="num">${money(Math.round(i.quantity * i.unit_price_cents), inv.currency)}</td></tr>`)}</tbody></table>
        <div class="totals"><div><span class="dim">Subtotal</span><span>${money(inv.subtotal_cents, inv.currency)}</span></div>
          ${paid > 0 && inv.status !== "paid" ? html`<div><span class="dim">Paid so far</span><span>− ${money(paid, inv.currency)}</span></div>` : ""}
          <div class="grand"><span>${inv.status === "paid" ? "Total paid" : "Amount due"}</span><span>${money(inv.status === "paid" ? inv.total_cents : Math.max(0, inv.total_cents - paid), inv.currency)}</span></div></div>
        ${inv.notes ? html`<p class="dim mt-l">${inv.notes}</p>` : ""}
      </section>
      ${payments.length ? html`<section class="card no-print"><div class="card-head"><h2>Payments</h2></div><div class="list">${payments.map((p) => html`<div class="item"><div class="item-main"><div class="title">${money(p.amount_cents, p.currency)}</div><div class="meta">${METHODS[p.method] || (p.method ? p.method[0].toUpperCase() + p.method.slice(1).replace(/_/g, " ") : "Payment")}${p.paid_at ? ` · ${fmtDate(p.paid_at.slice(0, 10))}` : ""}</div></div><span class="pill ${p.status === "paid" ? "ok" : p.status === "failed" ? "danger" : ""}">${p.status[0].toUpperCase() + p.status.slice(1)}</span></div>`)}</div></section>` : ""}
      ${["sent", "overdue"].includes(inv.status) ? html`<p class="alert info no-print">To pay this invoice, contact SXI Digital and we'll arrange it with you. Online payment will appear here once it's available.</p>` : ""}</div>` };
  }

  const list = await q(db.from("invoices").select(COLS).order("issue_date", { ascending: false }));
  const due = list.filter((i) => ["sent", "overdue"].includes(i.status));
  const owed = {}; due.forEach((i) => { owed[i.currency] = (owed[i.currency] || 0) + Number(i.total_cents); });
  const mount = (root) => $$("[data-open]", root).forEach((r) => {
    r.addEventListener("click", () => { location.hash = `#/invoices/${r.dataset.open}`; });
    r.addEventListener("keydown", (e) => { if (e.key === "Enter") location.hash = `#/invoices/${r.dataset.open}`; });
  });
  return { title: "Invoices", mount, html: html`<div class="stack"><div class="page-head"><div><h1>Invoices</h1>
      <p>${due.length ? `Outstanding: ${Object.entries(owed).map(([c, v]) => money(v, c)).join(" + ")}` : "Nothing outstanding."}</p></div></div>
    ${list.length ? html`<section class="card"><table class="tbl"><thead><tr><th>Invoice</th><th class="hide-m">Issued</th><th>Due</th><th class="num">Total</th><th>Status</th></tr></thead><tbody>
      ${list.map((i) => html`<tr class="click" tabindex="0" data-open="${i.id}"><td><span class="mono">${i.number}</span></td><td class="hide-m">${fmtDate(i.issue_date)}</td><td>${fmtDate(i.due_date)}</td><td class="num">${money(i.total_cents, i.currency)}</td><td>${pill("invoice", i.status)}</td></tr>`)}</tbody></table></section>`
      : html`<div class="card">${emptyState("invoices", "No invoices yet", "Invoices from SXI Digital will appear here, and you'll get a notification when a new one is issued.")}</div>`}</div>` };
}
