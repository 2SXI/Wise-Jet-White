import { db, q, html, raw, $, $$, toast, money, fmtDate, fmtDateTime, pill, icon, confirmDialog, titleCase } from "../core.js";
import { lookup, bust, clientName, clientOptions, formDialog, listPage, adminError } from "./kit.js";

const today = () => new Date().toISOString().slice(0, 10);
const plusDays = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

/** Opens "new invoice" (optionally for a known client) and goes to the draft. */
export async function newInvoice(ctx, clientId = null) {
  const clients = await lookup("clients");
  formDialog({
    title: "New invoice", submitText: "Create draft",
    row: { client_id: clientId, due_date: plusDays(14), currency: "USD" },
    fields: [{ name: "client_id", label: "Client", type: "select", required: true, options: clientOptions(clients) },
      { name: "due_date", label: "Due date", type: "date", required: true },
      { name: "currency", label: "Currency", type: "select", required: true, options: [["USD", "USD"], ["ZWG", "ZWG"]] },
      { name: "notes", label: "Note printed on the invoice", type: "textarea", max: 2000 }],
    onSave: async (v) => { const i = await q(db.from("invoices").insert(v).select("id").single()); toast("Draft created. Add the line items.", "ok"); ctx.go("#/invoices/" + i.id); },
  });
}

export async function invoices(ctx, id) {
  if (id) return invoiceDetail(ctx, id);
  const [clients, rows] = await Promise.all([lookup("clients"), q(db.from("invoices").select("*").order("created_at", { ascending: false }).limit(500))]);
  const page = listPage({
    title: "Invoices", sub: "Draft, send and track what clients owe.", rows, addLabel: "New invoice", onAdd: () => newInvoice(ctx), onOpen: (r) => ctx.go("#/invoices/" + r.id),
    statuses: ["draft", "sent", "overdue", "paid", "cancelled"], statusOf: (r) => r.status, searchText: (r) => `${r.number} ${clientName(clients, r.client_id)}`, emptyIcon: "invoices",
    cols: [{ label: "Invoice", cell: (r) => html`<strong>${r.number}</strong><div class="meta">${clientName(clients, r.client_id)}</div>` },
      { label: "Due", cell: (r) => fmtDate(r.due_date), hideM: true }, { label: "Total", num: true, cell: (r) => money(r.total_cents, r.currency) },
      { label: "Status", cell: (r) => (r.status === "draft" ? html`<span class="pill">Draft</span>` : r.status === "cancelled" ? html`<span class="pill">Cancelled</span>` : pill("invoice", r.status)) }],
  });
  return { title: "Invoices", ...page };
}

async function invoiceDetail(ctx, id) {
  const inv = await q(db.from("invoices").select("*").eq("id", id).maybeSingle());
  if (!inv) throw new Error("Invoice not found");
  const [clients, items, pays] = await Promise.all([lookup("clients"),
    q(db.from("invoice_items").select("*").eq("invoice_id", id).order("position")), q(db.from("payments").select("*").eq("invoice_id", id).order("created_at"))]);
  const draft = inv.status === "draft", open = inv.status === "sent" || inv.status === "overdue";
  const ITEM = [{ name: "description", label: "Description", required: true, max: 500 }, { name: "quantity", label: "Quantity", type: "number", default: "1" }, { name: "unit_price_cents", label: "Unit price", type: "money", required: true }];
  const itemDlg = (row) => formDialog({ title: row ? "Edit line item" : "Add line item", fields: ITEM.map((f) => f.name === "quantity" ? { ...f, hint: "Whole units" } : f), row,
    onSave: async (v) => { v.quantity = v.quantity || 1;
      if (row) await q(db.from("invoice_items").update(v).eq("id", row.id)); else await q(db.from("invoice_items").insert({ ...v, invoice_id: id, position: items.length }));
      ctx.reload(); },
    onDelete: row ? async () => { await q(db.from("invoice_items").delete().eq("id", row.id)); ctx.reload(); } : null });
  const out = html`<a class="back" href="#/invoices">${icon("back")}All invoices</a>
    <div class="page-head"><div><h1>${inv.number}</h1><p>${clientName(clients, inv.client_id)} · ${draft ? html`<span class="pill">Draft</span>` : inv.status === "cancelled" ? html`<span class="pill">Cancelled</span>` : pill("invoice", inv.status)}</p></div>
      <div class="row">${draft ? html`<button class="btn btn-primary" data-send type="button">Send to client</button>` : ""}
      ${open ? html`<button class="btn btn-primary" data-paid type="button">Mark as paid</button>` : ""}
      ${draft || open ? html`<button class="btn btn-ghost" data-cancel type="button">Cancel invoice</button>` : ""}
      <button class="btn btn-ghost" data-print type="button">${icon("print")}Print</button></div></div>
    <div class="card"><dl class="kv"><dt>Issued</dt><dd>${fmtDate(inv.issue_date)}</dd><dt>Due</dt><dd>${fmtDate(inv.due_date)}</dd><dt>Note</dt><dd>${inv.notes || "—"}</dd></dl></div>
    <div class="card mt-l"><div class="card-head"><h2>Line items</h2>${draft ? html`<button class="btn btn-ghost btn-sm" data-add type="button">${icon("plus")}Add item</button>` : ""}</div>
      ${items.length ? html`<div class="tscroll"><table class="tbl"><thead><tr><th>Description</th><th class="num">Qty</th><th class="num">Unit</th><th class="num">Amount</th></tr></thead><tbody>
        ${items.map((i) => html`<tr class="${draft ? "click" : ""}" data-item="${i.id}" ${draft ? raw('tabindex="0"') : ""}><td>${i.description}</td><td class="num">${Number(i.quantity)}</td><td class="num">${money(i.unit_price_cents, inv.currency)}</td><td class="num">${money(Math.round(i.unit_price_cents * Number(i.quantity)), inv.currency)}</td></tr>`)}</tbody></table></div>
        <div class="totals"><div class="grand"><span>Total</span><span>${money(inv.total_cents, inv.currency)}</span></div></div>` : html`<p class="faint">No items yet. Add at least one before sending.</p>`}</div>
    <div class="card mt-l"><div class="card-head"><h2>Payments</h2></div>
      ${pays.length ? html`<div class="list">${pays.map((p) => html`<div class="item"><div class="item-main"><div class="title">${money(p.amount_cents, p.currency)}</div><div class="meta">${titleCase(p.method || p.provider)} · ${fmtDateTime(p.paid_at || p.created_at)}${p.provider_reference ? ` · ${p.provider_reference}` : ""}</div></div>${pill("invoice", p.status === "paid" ? "paid" : "sent")}<span class="faint">${titleCase(p.status)}</span></div>`)}</div>` : html`<p class="faint">No payments recorded.</p>`}</div>`;
  const mount = (view) => {
    const act = (sel, fn) => { const b = $(sel, view); if (b) b.addEventListener("click", async () => { try { await fn(); } catch (e) { toast(adminError(e), "error"); } }); };
    act("[data-add]", () => itemDlg(null));
    $$("[data-item]", view).forEach((tr) => { if (!draft) return; const open = () => itemDlg(items.find((i) => i.id === tr.dataset.item)); tr.addEventListener("click", open); tr.addEventListener("keydown", (e) => e.key === "Enter" && open()); });
    act("[data-send]", async () => { if (!(await confirmDialog({ title: "Send this invoice?", body: "The client is notified and the amounts are locked.", confirmText: "Send" }))) return;
      await q(db.rpc("send_invoice", { p_invoice_id: id })); toast("Invoice sent.", "ok"); ctx.reload(); });
    act("[data-cancel]", async () => { if (!(await confirmDialog({ title: "Cancel this invoice?", body: "It will no longer be payable.", confirmText: "Cancel invoice", danger: true }))) return;
      await q(db.from("invoices").update({ status: "cancelled" }).eq("id", id)); toast("Invoice cancelled.", "ok"); ctx.reload(); });
    act("[data-paid]", () => formDialog({ title: "Record payment", submitText: "Mark as paid", row: { method: "cash" },
      extra: html`<p class="dim">Records the full remaining balance as paid.</p>`,
      fields: [{ name: "method", label: "Method", type: "select", required: true, options: [["cash", "Cash"], ["bank_transfer", "Bank transfer"], ["ecocash", "EcoCash"], ["card", "Card"], ["other", "Other"]] }, { name: "reference", label: "Reference" }],
      onSave: async (v) => { await q(db.rpc("mark_invoice_paid", { p_invoice_id: id, p_method: v.method, p_reference: v.reference })); toast("Payment recorded.", "ok"); ctx.reload(); } }));
    act("[data-print]", () => window.print());
  };
  return { title: inv.number, html: out, mount };
}

export async function payments(ctx) {
  const [clients, rows, invs] = await Promise.all([lookup("clients"), q(db.from("payments").select("*").order("created_at", { ascending: false }).limit(500)), q(db.from("invoices").select("id,number"))]);
  const num = (id) => invs.find((i) => i.id === id)?.number || "—";
  const NEXT = { pending: [["paid", "Mark paid"], ["failed", "Mark failed"]], failed: [["pending", "Retry"]], paid: [["refunded", "Refund"]], refunded: [] };
  const open = (p) => {
    const actions = NEXT[p.status] || [];
    const d = formDialog({ title: `Payment · ${money(p.amount_cents, p.currency)}`, submitText: "Close", fields: [], onSave: async () => {},
      extra: html`<dl class="kv"><dt>Invoice</dt><dd>${num(p.invoice_id)}</dd><dt>Client</dt><dd>${clientName(clients, p.client_id)}</dd><dt>Method</dt><dd>${titleCase(p.method || p.provider)}</dd><dt>Reference</dt><dd>${p.provider_reference || "—"}</dd><dt>Status</dt><dd>${titleCase(p.status)}</dd></dl>
        ${actions.length ? html`<div class="row mt">${actions.map(([s, l]) => html`<button class="btn ${s === "refunded" || s === "failed" ? "btn-danger" : "btn-primary"} btn-sm" type="button" data-set="${s}">${l}</button>`)}</div>` : html`<p class="faint mt">No further changes are possible.</p>`}` });
    $$("[data-set]", d).forEach((b) => b.addEventListener("click", async () => {
      try { await q(db.rpc("set_payment_status", { p_payment_id: p.id, p_status: b.dataset.set })); d.close(); toast("Payment updated.", "ok"); bust(); ctx.reload(); } catch (e) { toast(adminError(e), "error"); }
    }));
  };
  const page = listPage({
    title: "Payments", sub: "Money received. Marking a payment paid settles its invoice.", rows, onOpen: open, emptyIcon: "payments", statuses: ["pending", "paid", "failed", "refunded"], statusOf: (r) => r.status,
    searchText: (r) => `${num(r.invoice_id)} ${clientName(clients, r.client_id)} ${r.provider_reference || ""} ${r.method || ""}`,
    cols: [{ label: "Invoice", cell: (r) => html`<strong>${num(r.invoice_id)}</strong><div class="meta">${clientName(clients, r.client_id)}</div>` }, { label: "Method", cell: (r) => titleCase(r.method || r.provider), hideM: true },
      { label: "Date", cell: (r) => fmtDate((r.paid_at || r.created_at).slice(0, 10)), hideM: true }, { label: "Amount", num: true, cell: (r) => money(r.amount_cents, r.currency) },
      { label: "Status", cell: (r) => html`<span class="pill ${r.status === "paid" ? "ok" : r.status === "pending" ? "info" : r.status === "failed" ? "danger" : ""}">${titleCase(r.status)}</span>` }],
  });
  return { title: "Payments", ...page };
}
