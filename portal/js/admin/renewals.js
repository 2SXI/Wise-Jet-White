import { db, q, html, toast, money, fmtDate, pill, daysUntil, titleCase } from "../core.js";
import { lookup, clientName, listPage, adminError, formDialog } from "./kit.js";

/** Everything that renews in the next 120 days (or already lapsed), in one place, with one-click invoicing. */
export async function renewals(ctx) {
  const lim = new Date(Date.now() + 120 * 864e5).toISOString().slice(0, 10);
  const [clients, doms, host, svcs] = await Promise.all([lookup("clients"),
    q(db.from("domains").select("id,client_id,name,expires_at,renewal_price_cents,currency,status").eq("status", "active").lte("expires_at", lim)),
    q(db.from("hosting_accounts").select("id,client_id,plan_name,renewal_date,status").eq("status", "active").lte("renewal_date", lim)),
    q(db.from("services").select("id,client_id,name,type,renewal_date,price_cents,currency,status").eq("status", "active").lte("renewal_date", lim))]);
  const rows = [
    ...doms.filter((d) => d.expires_at).map((d) => ({ id: "d" + d.id, kind: "Domain", name: d.name, client_id: d.client_id, date: d.expires_at, cents: d.renewal_price_cents || 0, currency: d.currency, desc: `Domain renewal ${d.name}` })),
    ...host.filter((h) => h.renewal_date).map((h) => ({ id: "h" + h.id, kind: "Hosting", name: h.plan_name || "Hosting", client_id: h.client_id, date: h.renewal_date, cents: 0, currency: "USD", desc: `${h.plan_name || "Hosting"} renewal` })),
    ...svcs.filter((s) => s.renewal_date).map((s) => ({ id: "s" + s.id, kind: titleCase(s.type), name: s.name, client_id: s.client_id, date: s.renewal_date, cents: s.price_cents, currency: s.currency, desc: `${s.name} renewal`, service_id: s.id })),
  ].sort((a, b) => a.date.localeCompare(b.date));
  const invoice = (r) => formDialog({
    title: "Invoice this renewal", submitText: "Create draft", row: { description: r.desc, price: (r.cents / 100).toFixed(2) },
    extra: html`<p class="dim">${clientName(clients, r.client_id)} · ${r.currency} · due ${fmtDate(r.date)}</p>`,
    fields: [{ name: "description", label: "Description", required: true, max: 500 }, { name: "price", label: "Amount", type: "money", required: true }],
    onSave: async (v) => {
      const i = await q(db.from("invoices").insert({ client_id: r.client_id, currency: r.currency, due_date: r.date < new Date().toISOString().slice(0, 10) ? new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10) : r.date }).select("id").single());
      await q(db.from("invoice_items").insert({ invoice_id: i.id, description: v.description, unit_price_cents: v.price, service_id: r.service_id ?? null, position: 0 }));
      toast("Draft invoice created.", "ok"); ctx.go("#/invoices/" + i.id);
    } });
  const page = listPage({
    title: "Renewals", sub: "Domains, hosting and services renewing within 120 days. Click a row to draft the invoice.", rows, emptyIcon: "renewals", emptyText: "No renewals coming up.",
    statuses: ["Domain", "Hosting"], statusOf: (r) => r.kind, onOpen: invoice, searchText: (r) => `${r.name} ${r.kind} ${clientName(clients, r.client_id)}`,
    cols: [{ label: "Item", cell: (r) => html`<strong>${r.name}</strong><div class="meta">${r.kind}</div>` }, { label: "Client", cell: (r) => clientName(clients, r.client_id), hideM: true },
      { label: "Date", cell: (r) => fmtDate(r.date), hideM: true }, { label: "Amount", num: true, hideM: true, cell: (r) => (r.cents ? money(r.cents, r.currency) : "—") },
      { label: "When", cell: (r) => { const n = daysUntil(r.date); return html`<span class="pill ${n < 0 ? "danger" : n <= 30 ? "warn" : "info"}">${n < 0 ? `${-n}d overdue` : n === 0 ? "Today" : `${n} days`}</span>`; } }],
  });
  return { title: "Renewals", ...page };
}
