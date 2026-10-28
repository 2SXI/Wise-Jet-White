import { html, q, pill, money, fmtDate, daysUntil, friendly, toast, emptyState, openDialog, $, $$ } from "../core.js";
import { requestDialog } from "./_shared.js";

export async function render(ctx) {
  const { db } = ctx;
  const domains = await q(db.from("domains").select("id,name,status,registrar,registered_at,expires_at,auto_renew,renewal_price_cents,currency,nameservers").order("name"));

  const mount = (root) => {
    const find = (el) => domains.find((d) => d.id === el.closest("[data-domain]").dataset.domain);
    $$("[data-renew]", root).forEach((b) => b.addEventListener("click", () => { const d = find(b);
      requestDialog(ctx, { title: `Renew ${d.name}`, intro: `We'll confirm the renewal${d.renewal_price_cents != null ? ` (${money(d.renewal_price_cents, d.currency)})` : ""} and send an invoice if one is due.`,
        label: "Anything we should know? (optional)", subject: `Domain renewal — ${d.name}`, category: "domain_renewal", relatedType: "domain", relatedId: d.id,
        compose: (v) => `Please renew ${d.name}.\n\n${v.msg || ""}`.trim() }); }));
    $$("[data-transfer]", root).forEach((b) => b.addEventListener("click", () => { const d = find(b);
      requestDialog(ctx, { title: `Transfer ${d.name}`, intro: "Tell us where you'd like to move the domain. We'll guide you through the process and unlock it when you're ready.",
        label: "Where is it moving to?", placeholder: "e.g. Transferring to another registrar / another company", subject: `Domain transfer request — ${d.name}`, category: "domain_transfer", relatedType: "domain", relatedId: d.id,
        compose: (v) => `Transfer request for ${d.name}.\n\n${v.msg || ""}` }); }));
    $$("[data-dns]", root).forEach((b) => b.addEventListener("click", () => { const d = find(b);
      const dlg = openDialog(html`<div class="dlg"><h2>DNS information</h2><p class="dim">${d.name}</p>
        ${d.nameservers?.length ? html`<div><h3>Nameservers</h3><ul class="list mt">${d.nameservers.map((n) => html`<li class="item mono">${n}</li>`)}</ul></div>` : html`<p class="alert info">No nameserver details are recorded for this domain yet.</p>`}
        <p class="hint">For your protection, DNS records are managed by SXI Digital. To add or change a record, send us a request.</p>
        <div class="actions"><button class="btn btn-ghost" data-close type="button">Close</button><button class="btn btn-primary" data-dnsreq type="button">Request a DNS change</button></div></div>`);
      $("[data-dnsreq]", dlg).addEventListener("click", () => { dlg.close();
        requestDialog(ctx, { title: "Request a DNS change", label: "What should change?", placeholder: "e.g. Add a TXT record for Google verification", subject: `DNS change request — ${d.name}`, category: "technical", relatedType: "domain", relatedId: d.id }); }); }));
    $$("[data-autorenew]", root).forEach((box) => box.addEventListener("change", async () => {
      const d = find(box), want = box.checked; box.disabled = true;
      const { error } = await db.rpc("set_domain_auto_renew", { p_domain_id: d.id, p_enabled: want });
      box.disabled = false;
      if (error) { box.checked = !want; return toast(friendly(error), "error"); }
      d.auto_renew = want; $(".ar-label", box.closest("[data-domain]")).textContent = want ? "Auto-renew on" : "Auto-renew off";
      toast(`Auto-renew ${want ? "enabled" : "disabled"} for ${d.name}`, "ok");
    }));
  };

  return { title: "Domains", mount, html: html`<div class="stack"><div class="page-head"><div><h1>Domains</h1><p>Your registered domains and renewal dates.</p></div></div>
    ${domains.length ? domains.map((d) => { const left = daysUntil(d.expires_at), soon = left != null && left <= 30;
      return html`<article class="card" data-domain="${d.id}"><div class="card-head"><h2>${d.name}</h2>${pill("domain", d.status)}</div>
        ${soon ? html`<p class="alert ${left < 0 ? "" : "warn"}" role="status">${left < 0 ? "This domain has expired." : `This domain expires in ${left} day${left === 1 ? "" : "s"}.`}${d.auto_renew ? " Auto-renew is on." : " Renew it to avoid losing it."}</p>` : ""}
        <dl class="kv ${soon ? "mt-l" : ""}"><dt>Registered</dt><dd>${fmtDate(d.registered_at)}</dd><dt>Expires</dt><dd>${fmtDate(d.expires_at)}</dd>
          <dt>Registrar</dt><dd>${d.registrar || "—"}</dd><dt>Renewal price</dt><dd>${money(d.renewal_price_cents, d.currency)}</dd>
          <dt>Auto-renew</dt><dd><label class="switch"><input type="checkbox" data-autorenew ${d.auto_renew ? "checked" : ""}><span class="track"></span><span class="ar-label">Auto-renew ${d.auto_renew ? "on" : "off"}</span></label></dd></dl>
        <div class="row mt-l"><button class="btn btn-primary btn-sm" data-renew type="button">Renew Domain</button>
          <button class="btn btn-ghost btn-sm" data-transfer type="button">Request transfer</button><button class="btn btn-ghost btn-sm" data-dns type="button">View DNS information</button></div></article>`; })
      : html`<div class="card">${emptyState("domains", "No domains yet", "Domains registered through SXI Digital will be listed here with their expiry dates.")}</div>`}</div>` };
}
