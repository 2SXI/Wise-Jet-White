import { html, q, pill, timeAgo, fmtDateTime, titleCase, emptyState, icon, friendly, toast, confirmDialog, openDialog, $, $$ } from "../core.js";

const CATS = [["general", "General question"], ["change_request", "Website change"], ["technical", "Technical issue"], ["billing", "Billing"], ["mailbox_request", "Email"], ["domain_renewal", "Domain renewal"], ["domain_transfer", "Domain transfer"]];

export async function render(ctx, id) {
  const { db, profile } = ctx;

  if (id) {
    const t = await q(db.from("support_tickets").select("id,subject,category,status,created_at,updated_at").eq("id", id).maybeSingle());
    if (!t) return { title: "Ticket", html: html`<a class="back" href="#/support">${icon("back")} Support</a>${emptyState("support", "Ticket not found", "It may not be part of your account.")}` };
    const msgs = await q(db.from("support_messages").select("id,author_id,author_name,author_role,body,created_at").eq("ticket_id", id).order("created_at"));
    const closed = t.status === "closed";
    const mount = (root) => {
      const m = $(".msgs", root); m?.lastElementChild?.scrollIntoView({ block: "nearest" });
      const form = $("#reply", root);
      form?.addEventListener("submit", async (e) => {
        e.preventDefault();
        const body = form.body.value.trim(); if (!body) return;
        const btn = $("[type=submit]", form); btn.disabled = true; btn.textContent = "Sending…";
        const { error } = await db.from("support_messages").insert({ ticket_id: id, author_id: profile.id, body });
        if (error) { btn.disabled = false; btn.textContent = "Send reply"; return toast(friendly(error), "error"); }
        ctx.reload();
      });
      $("[data-close-ticket]", root)?.addEventListener("click", async () => {
        if (!await confirmDialog({ title: "Close this ticket?", body: "You won't be able to reply once it's closed. Open a new ticket if you need more help.", confirmText: "Close ticket" })) return;
        const { error } = await db.rpc("close_ticket", { p_ticket_id: id });
        if (error) return toast(friendly(error), "error");
        toast("Ticket closed", "ok"); ctx.reload();
      });
    };
    return { title: t.subject, mount, html: html`<div class="stack"><div><a class="back" href="#/support">${icon("back")} Support</a>
      <div class="page-head"><div><h1>${t.subject}</h1><p>${titleCase(t.category)} · opened ${fmtDateTime(t.created_at)}</p></div>
        <div class="row">${pill("ticket", t.status)}${closed ? "" : html`<button class="btn btn-ghost btn-sm" data-close-ticket type="button">Close ticket</button>`}</div></div></div>
      <div class="msgs">${msgs.map((m) => { const mine = m.author_id === profile.id;
        return html`<div class="msg ${mine ? "mine" : ""}"><div class="by"><strong>${mine ? "You" : m.author_name || "SXI Digital"}</strong>${!mine && m.author_role !== "client" ? html`<span class="tag">SXI Digital</span>` : ""}<span>${timeAgo(m.created_at)}</span></div><div class="body">${m.body}</div></div>`; })}</div>
      ${closed ? html`<p class="alert info">This ticket is closed. Need more help? <a class="link" href="#/support">Open a new ticket</a>.</p>`
        : html`<form id="reply" class="card form"><div class="field"><label for="body">Reply</label><textarea class="input" id="body" name="body" maxlength="10000" placeholder="Write your reply…" required></textarea></div>
            <div class="row"><button class="btn btn-primary" type="submit">Send reply</button></div></form>`}</div>` };
  }

  const tickets = await q(db.from("support_tickets").select("id,subject,category,status,updated_at").order("updated_at", { ascending: false }));
  let filter = "open";
  const draw = (root) => {
    const rows = tickets.filter((t) => filter === "all" || (filter === "open" ? t.status !== "closed" : t.status === "closed"));
    $("#tlist", root).innerHTML = (rows.length ? html`<div class="list">${rows.map((t) => html`<a class="item" href="#/support/${t.id}"><div class="item-main"><div class="title">${t.subject}</div>
        <div class="meta"><span class="tag">${titleCase(t.category)}</span> · Updated ${timeAgo(t.updated_at)}</div></div>${pill("ticket", t.status)}</a>`)}</div>`
      : emptyState("support", filter === "open" ? "No open tickets" : "Nothing here", "Questions, change requests and issues you raise will be tracked here.")).s;
    $$("[data-filter]", root).forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.filter === filter)));
  };
  const mount = (root) => {
    draw(root);
    $$("[data-filter]", root).forEach((b) => b.addEventListener("click", () => { filter = b.dataset.filter; draw(root); }));
    $$("[data-new]", root).forEach((b) => b.addEventListener("click", () => {
      const d = openDialog(html`<form class="dlg" novalidate><h2>New support ticket</h2>
        <div class="field"><label for="n-cat">Topic</label><select class="input" id="n-cat" name="cat">${CATS.map(([v, l]) => html`<option value="${v}">${l}</option>`)}</select></div>
        <div class="field"><label for="n-sub">Subject</label><input class="input" id="n-sub" name="subject" maxlength="200" required placeholder="Short summary"></div>
        <div class="field"><label for="n-msg">How can we help?</label><textarea class="input" id="n-msg" name="msg" maxlength="10000" required></textarea></div>
        <div id="n-err" aria-live="polite"></div>
        <div class="actions"><button class="btn btn-ghost" data-close type="button">Cancel</button><button class="btn btn-primary" type="submit">Send ticket</button></div></form>`);
      const f = $("form", d), err = $("#n-err", d);
      f.addEventListener("submit", async (e) => {
        e.preventDefault();
        const v = Object.fromEntries(new FormData(f));
        if (v.subject.trim().length < 3 || !v.msg.trim()) { err.innerHTML = html`<p class="alert" role="alert">Add a subject and a message.</p>`.s; return; }
        const btn = $("[type=submit]", f); btn.disabled = true; btn.textContent = "Sending…";
        const { data, error } = await db.rpc("create_ticket", { p_subject: v.subject.trim(), p_body: v.msg.trim(), p_category: v.cat, p_priority: "normal", p_related_type: null, p_related_id: null });
        if (error) { btn.disabled = false; btn.textContent = "Send ticket"; err.innerHTML = html`<p class="alert" role="alert">${friendly(error)}</p>`.s; return; }
        d.close(); toast("Ticket sent", "ok"); location.hash = `#/support/${data}`;
      });
    }));
  };
  return { title: "Support", mount, html: html`<div class="stack"><div class="page-head"><div><h1>Support</h1><p>Ask a question or request a change. We reply here.</p></div>
      <button class="btn btn-primary" data-new type="button">New ticket</button></div>
    <div class="tabs" role="group" aria-label="Filter tickets"><button class="tab" data-filter="open" type="button" aria-pressed="true">Open</button><button class="tab" data-filter="closed" type="button" aria-pressed="false">Closed</button><button class="tab" data-filter="all" type="button" aria-pressed="false">All</button></div>
    <section class="card" id="tlist"></section></div>` };
}
