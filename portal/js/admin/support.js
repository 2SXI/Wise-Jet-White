import { db, q, html, $, $$, toast, fmtDateTime, timeAgo, pill, icon, titleCase } from "../core.js";
import { lookup, clientName, listPage, adminError } from "./kit.js";

const ST = ["open", "in_progress", "waiting_for_client", "resolved", "closed"];
const pillT = (s) => (s === "closed" ? html`<span class="pill">Closed</span>` : pill("ticket", s));

export async function support(ctx, id) {
  if (id) return detail(ctx, id);
  const [clients, rows] = await Promise.all([lookup("clients"), q(db.from("support_tickets").select("*").order("updated_at", { ascending: false }).limit(500))]);
  const page = listPage({
    title: "Support", sub: "Tickets and change requests from clients.", rows, onOpen: (r) => ctx.go("#/support/" + r.id), emptyIcon: "support", emptyText: "No tickets yet.",
    statuses: ST, statusOf: (r) => r.status, searchText: (r) => `${r.subject} ${clientName(clients, r.client_id)} ${r.category}`,
    cols: [{ label: "Ticket", cell: (r) => html`<strong>${r.subject}</strong><div class="meta">${clientName(clients, r.client_id)} · ${titleCase(r.category)}</div>` },
      { label: "Priority", cell: (r) => html`<span class="tag">${titleCase(r.priority)}</span>`, hideM: true }, { label: "Updated", cell: (r) => timeAgo(r.updated_at), hideM: true }, { label: "Status", cell: (r) => pillT(r.status) }],
  });
  return { title: "Support", ...page };
}

async function detail(ctx, id) {
  const t = await q(db.from("support_tickets").select("*").eq("id", id).maybeSingle());
  if (!t) throw new Error("Ticket not found");
  const [clients, staff, msgs, notes] = await Promise.all([lookup("clients"), lookup("staff"),
    q(db.from("support_messages").select("*").eq("ticket_id", id).order("created_at")),
    q(db.from("internal_notes").select("*").eq("entity_type", "ticket").eq("entity_id", id).order("created_at"))]);
  const opts = (arr, cur) => arr.map(([v, l]) => html`<option value="${v}" ${v === cur ? "selected" : ""}>${l}</option>`);
  const out = html`<a class="back" href="#/support">${icon("back")}All tickets</a>
    <div class="page-head"><div><h1>${t.subject}</h1><p><a class="link" href="#/clients/${t.client_id}">${clientName(clients, t.client_id)}</a> · ${titleCase(t.category)} · opened ${fmtDateTime(t.created_at)}</p></div>${pillT(t.status)}</div>
    <div class="card ticket-controls"><div class="field"><label for="t-status">Status</label><select class="input" id="t-status">${opts(ST.map((s) => [s, titleCase(s)]), t.status)}</select></div>
      <div class="field"><label for="t-prio">Priority</label><select class="input" id="t-prio">${opts(["low", "normal", "high", "urgent"].map((s) => [s, titleCase(s)]), t.priority)}</select></div>
      <div class="field"><label for="t-assign">Assigned to</label><select class="input" id="t-assign"><option value="">Unassigned</option>${opts(staff.map((s) => [s.id, s.full_name || s.email]), t.assigned_to)}</select></div></div>
    <div class="msgs mt-l" aria-label="Conversation">${msgs.map((m) => html`<div class="msg ${m.author_role === "client" ? "" : "mine"}"><div class="by"><strong>${m.author_name}</strong>${m.author_role === "client" ? "" : html`<span class="tag">SXI</span>`}<span>${fmtDateTime(m.created_at)}</span></div><div class="body">${m.body}</div></div>`)}</div>
    <form class="card mt-l form" data-reply novalidate><div class="field"><label for="reply">Reply to client</label><textarea class="input" id="reply" maxlength="10000"></textarea></div>
      <div class="row"><button class="btn btn-primary" type="submit">Send reply</button></div></form>
    <div class="card mt-l"><div class="card-head"><h2>Internal notes</h2><span class="faint">Clients never see these</span></div>
      ${notes.length ? html`<div class="list">${notes.map((n) => html`<div class="item"><div class="item-main"><div class="body pre">${n.body}</div><div class="meta">${fmtDateTime(n.created_at)}</div></div></div>`)}</div>` : html`<p class="faint">No notes.</p>`}
      <form class="form mt" data-note novalidate><textarea class="input" id="note" maxlength="10000" aria-label="New internal note" placeholder="Add a private note…"></textarea><div class="row"><button class="btn btn-ghost" type="submit">Add note</button></div></form></div>`;
  const mount = (view) => {
    const upd = (patch) => async (e) => { try { await q(db.from("support_tickets").update(patch(e.target.value)).eq("id", id)); toast("Updated.", "ok"); ctx.reload(); } catch (err) { toast(adminError(err), "error"); } };
    $("#t-status", view).addEventListener("change", upd((v) => ({ status: v })));
    $("#t-prio", view).addEventListener("change", upd((v) => ({ priority: v })));
    $("#t-assign", view).addEventListener("change", upd((v) => ({ assigned_to: v || null })));
    $("[data-reply]", view).addEventListener("submit", async (e) => {
      e.preventDefault(); const body = $("#reply", view).value.trim(); if (!body) return toast("Write a reply first.", "error");
      try { await q(db.from("support_messages").insert({ ticket_id: id, author_id: ctx.profile.id, body }));
        if (t.status === "open") await q(db.from("support_tickets").update({ status: "waiting_for_client" }).eq("id", id));
        toast("Reply sent.", "ok"); ctx.reload(); } catch (err) { toast(adminError(err), "error"); }
    });
    $("[data-note]", view).addEventListener("submit", async (e) => {
      e.preventDefault(); const body = $("#note", view).value.trim(); if (!body) return;
      try { await q(db.from("internal_notes").insert({ entity_type: "ticket", entity_id: id, client_id: t.client_id, body, author_id: ctx.profile.id })); toast("Note added.", "ok"); ctx.reload(); } catch (err) { toast(adminError(err), "error"); }
    });
  };
  return { title: t.subject, html: out, mount };
}
