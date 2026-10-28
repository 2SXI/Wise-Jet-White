import { html, q, pill, fmtDate, fmtDateTime, safeUrl, icon, emptyState, $, $$ } from "../core.js";
import { requestDialog } from "./_shared.js";

const COLS = "id,name,url,status,ssl_status,last_updated_at,renewal_date,hosting_account_id,domain:domains(id,name),hosting:hosting_accounts(id,status,plan_name)";

const actions = (w) => html`<div class="row">
  ${safeUrl(w.url) ? html`<a class="btn btn-ghost btn-sm" href="${safeUrl(w.url)}" target="_blank" rel="noopener noreferrer">Visit Website ${icon("external")}</a>` : ""}
  <a class="btn btn-ghost btn-sm" href="#/websites/${w.id}">Manage</a>
  <button class="btn btn-primary btn-sm" data-change="${w.id}" type="button">Request Changes</button></div>`;

export async function render(ctx, id) {
  const { db } = ctx;
  const sites = await q(db.from("websites").select(COLS).order("created_at"));
  const mount = (root) => $$("[data-change]", root).forEach((b) => b.addEventListener("click", () => {
    const w = sites.find((s) => s.id === b.dataset.change);
    requestDialog(ctx, { title: "Request website changes", intro: `Tell us what you'd like changed on ${w.name}.`, label: "What needs changing?",
      placeholder: "e.g. Update the opening hours and replace the photo on the About page.", subject: `Website change request — ${w.name}`.slice(0, 200),
      category: "change_request", relatedType: "website", relatedId: w.id });
  }));

  if (id) {
    const w = sites.find((s) => s.id === id);
    if (!w) return { title: "Website", html: html`<a class="back" href="#/websites">${icon("back")} Websites</a>${emptyState("websites", "Website not found", "It may have been removed, or it isn't part of your account.")}` };
    return { title: w.name, mount, html: html`<div class="stack"><div><a class="back" href="#/websites">${icon("back")} Websites</a>
      <div class="page-head"><div><h1>${w.name}</h1><p>${w.domain?.name || ""}</p></div>${actions(w)}</div></div>
      <section class="card"><div class="card-head"><h2>Status</h2></div><div class="row">${pill("website", w.status)}${pill("ssl", w.ssl_status)}${w.hosting ? pill("hosting", w.hosting.status) : ""}</div>
        <dl class="kv mt-l"><dt>Website URL</dt><dd>${safeUrl(w.url) ? html`<a class="link" href="${safeUrl(w.url)}" target="_blank" rel="noopener noreferrer">${w.url}</a>` : "—"}</dd>
          <dt>Domain</dt><dd>${w.domain ? html`<a class="link" href="#/domains">${w.domain.name}</a>` : "—"}</dd>
          <dt>Hosting plan</dt><dd>${w.hosting ? html`<a class="link" href="#/hosting">${w.hosting.plan_name || "Hosting"}</a>` : "—"}</dd>
          <dt>Last updated</dt><dd>${fmtDateTime(w.last_updated_at)}</dd><dt>Renewal date</dt><dd>${fmtDate(w.renewal_date)}</dd></dl></section>
      <p class="dim">Server settings are managed by SXI Digital. Use <strong>Request Changes</strong> and we'll take care of it.</p></div>` };
  }

  return { title: "Websites", mount, html: html`<div class="stack"><div class="page-head"><div><h1>Websites</h1><p>Your sites and their current status.</p></div></div>
    ${sites.length ? sites.map((w) => html`<article class="card"><div class="card-head"><div class="item-main"><h2>${w.name}</h2><div class="meta">${w.domain?.name || w.url || ""}</div></div>
        <div class="row">${pill("website", w.status)}${pill("ssl", w.ssl_status)}</div></div>
      <dl class="kv"><dt>Hosting</dt><dd>${w.hosting ? pill("hosting", w.hosting.status) : "—"}</dd><dt>Last updated</dt><dd>${fmtDateTime(w.last_updated_at)}</dd><dt>Renewal date</dt><dd>${fmtDate(w.renewal_date)}</dd></dl>
      <div class="mt-l">${actions(w)}</div></article>`)
      : html`<div class="card">${emptyState("websites", "No websites yet", "When SXI Digital launches your website it will appear here with its status, SSL and renewal date.")}</div>`}</div>` };
}
