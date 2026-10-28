import { html, q, pill, meter, mbText, fmtDate, fmtDateTime, timeAgo, emptyState, $ } from "../core.js";
import { requestDialog } from "./_shared.js";

export async function render(ctx) {
  const { db } = ctx;
  const [accounts, sites, boxes] = await Promise.all([
    q(db.from("hosting_accounts").select("*").order("created_at")),
    q(db.from("websites").select("id,hosting_account_id")),
    q(db.from("email_accounts").select("id,status")),
  ]);
  const mailCount = boxes.filter((b) => b.status !== "deleted").length;
  const n = (v) => v;

  const mount = (root) => $("[data-upgrade]", root)?.addEventListener("click", () => requestDialog(ctx, {
    title: "Ask about more resources", intro: "Need more storage, bandwidth or accounts? Tell us what you need.", label: "What do you need?",
    subject: "Hosting upgrade enquiry", category: "general" }));

  return { title: "Hosting", mount, html: html`<div class="stack"><div class="page-head"><div><h1>Hosting</h1><p>Your plan, usage and limits.</p></div>
      ${accounts.length ? html`<button class="btn btn-ghost" data-upgrade type="button">Need more resources?</button>` : ""}</div>
    ${accounts.length ? accounts.map((a) => html`<article class="card"><div class="card-head"><div class="item-main"><h2>${a.plan_name || "Hosting"}</h2><div class="meta">${a.server_label ? `Server: ${a.server_label}` : ""}</div></div>
        <div class="row">${pill("hosting", a.status)}${pill("ssl", a.ssl_status)}</div></div>
      <div class="grid cols-2">
        ${meter("Storage", a.storage_used_mb, a.storage_limit_mb, mbText)}${meter("Bandwidth", a.bandwidth_used_mb, a.bandwidth_limit_mb, mbText)}
        ${meter("Websites", sites.filter((s) => s.hosting_account_id === a.id).length, a.websites_limit, n)}${meter("Databases", a.databases_used, a.databases_limit, n)}
        ${meter("Email accounts", mailCount, a.email_accounts_limit, n)}</div>
      <dl class="kv mt-l"><dt>Renews</dt><dd>${fmtDate(a.renewal_date)}</dd>
        <dt>Usage data</dt><dd>${a.usage_synced_at ? `Updated ${timeAgo(a.usage_synced_at)} (${fmtDateTime(a.usage_synced_at)})` : "Not synced automatically yet — figures are updated by SXI Digital."}</dd></dl></article>`)
      : html`<div class="card">${emptyState("hosting", "No hosting account yet", "Once your hosting is active you'll see storage, bandwidth and limits here.")}</div>`}
    <p class="dim">Server access and settings are managed by SXI Digital, so there's nothing to configure or break.</p></div>` };
}
