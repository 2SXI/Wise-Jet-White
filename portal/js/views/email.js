import { html, q, pill, meter, mbText, emptyState, icon, CONFIG, safeUrl, confirmDialog, toast, $, $$ } from "../core.js";
import { requestDialog, hostOf } from "./_shared.js";

export async function render(ctx) {
  const { db } = ctx;
  const boxes = await q(db.from("email_accounts").select("id,address,status,storage_used_mb,storage_limit_mb").order("address"));
  const webmail = safeUrl(CONFIG.WEBMAIL_URL);
  const active = boxes.filter((b) => b.status === "active").length, pending = boxes.filter((b) => b.status === "pending").length;
  const state = active ? "active" : pending ? "pending" : null;
  const domains = [...new Set(boxes.map((b) => hostOf(b.address)))];

  const mount = (root) => {
    const find = (el) => boxes.find((b) => b.id === el.closest("[data-box]").dataset.box);
    $("[data-new]", root)?.addEventListener("click", () => requestDialog(ctx, {
      title: "Request a new mailbox", intro: "Tell us the address you'd like. We'll set it up and let you know when it's ready.",
      fields: [{ name: "addr", label: "Mailbox name", placeholder: `e.g. sales${domains[0] ? "@" + domains[0] : "@yourdomain.co.zw"}`, required: true }],
      label: "Notes (optional)", subject: "New mailbox request", category: "mailbox_request",
      compose: (v) => `Please create the mailbox: ${v.addr}\n\n${v.msg || ""}` }));
    $$("[data-pw]", root).forEach((b) => b.addEventListener("click", () => { const m = find(b);
      requestDialog(ctx, { title: "Change mailbox password", intro: `For security we never show or email passwords. Send a request and we'll reset the password for ${m.address} and share it with you securely.`,
        noMessage: true, submitText: "Request password reset", subject: `Password reset — ${m.address}`, category: "mailbox_request", relatedType: "email_account", relatedId: m.id,
        compose: () => `Please reset the password for ${m.address}.` }); }));
    $$("[data-del]", root).forEach((b) => b.addEventListener("click", async () => { const m = find(b);
      const ok = await confirmDialog({ title: `Delete ${m.address}?`, body: "This sends a deletion request to SXI Digital. Nothing is removed until we confirm with you, and deleted mail can't be recovered.", confirmText: "Send deletion request", danger: true });
      if (!ok) return;
      await requestDialog(ctx, { title: "Confirm deletion request", intro: m.address, label: "Anything we should know? (optional)", submitText: "Send request",
        subject: `Delete mailbox — ${m.address}`, category: "mailbox_request", relatedType: "email_account", relatedId: m.id, compose: (v) => `Please delete the mailbox ${m.address}.\n\n${v.msg || ""}` }); }));
    $$("[data-nowebmail]", root).forEach((b) => b.addEventListener("click", () => toast("Webmail will be available here once SXI's email platform is connected.")));
  };

  return { title: "Email", mount, html: html`<div class="stack">
    <div class="page-head"><div><h1>Business email</h1><p>Professional mailboxes on your own domain.</p></div>
      <button class="btn btn-primary" data-new type="button">Request new mailbox</button></div>
    <section class="card"><div class="card-head"><h2>Email service</h2>${state ? pill("service", state) : html`<span class="pill">Not set up</span>`}</div>
      <p class="dim">${state ? `${boxes.filter((b) => b.status !== "deleted").length} mailbox${boxes.length === 1 ? "" : "es"} on ${domains.join(", ")}.` : "You don't have business email yet. Request a mailbox and we'll set it up."}</p></section>
    <p class="alert info">Mailbox changes are handled by SXI Digital for now, so these actions send us a request. Self-service will appear here once our mail platform is connected. Passwords are never displayed.</p>
    ${boxes.length ? boxes.map((m) => html`<article class="card" data-box="${m.id}"><div class="card-head"><div class="item-main"><h2 class="mono">${m.address}</h2></div>${pill("mailbox", m.status)}</div>
        ${meter("Storage", m.storage_used_mb, m.storage_limit_mb, mbText)}
        <div class="row mt-l">${webmail ? html`<a class="btn btn-primary btn-sm" href="${webmail}" target="_blank" rel="noopener noreferrer">Open Webmail ${icon("external")}</a>`
            : html`<button class="btn btn-primary btn-sm" aria-disabled="true" data-nowebmail type="button">Open Webmail</button>`}
          <button class="btn btn-ghost btn-sm" data-pw type="button">Change password</button><button class="btn btn-danger btn-sm" data-del type="button">Delete mailbox</button></div></article>`)
      : html`<div class="card">${emptyState("email", "No mailboxes yet", "Request your first mailbox, for example info@ or sales@ on your own domain.")}</div>`}</div>` };
}
