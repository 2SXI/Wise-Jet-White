import { html, q, pill, money, fmtDate, daysUntil, meter, mbText, describeActivity, timeAgo, emptyState, safeUrl, icon, tone } from "../core.js";

const CORE = [["website", "Website"], ["domain", "Domain"], ["hosting", "Hosting"], ["business_email", "Business Email"]];

function serviceStatus(services, type) {
  const rows = services.filter((s) => s.type === type);
  if (!rows.length) return null;
  for (const s of ["active", "pending", "suspended", "expired", "cancelled"]) if (rows.some((r) => r.status === s)) return s;
  return rows[0].status;
}

export async function render(ctx) {
  const { db, client, profile } = ctx;
  const [services, websites, domains, hosting, mailboxes, unpaid, tickets, activity] = await Promise.all([
    q(db.from("services").select("id,type,name,status,price_cents,currency,billing_cycle,renewal_date")),
    q(db.from("websites").select("id,name,url,status,ssl_status,domain:domains(name)").order("created_at")),
    q(db.from("domains").select("id,name,status,expires_at,auto_renew").order("expires_at")),
    q(db.from("hosting_accounts").select("id,plan_name,status,storage_used_mb,storage_limit_mb,bandwidth_used_mb,bandwidth_limit_mb").order("created_at")),
    q(db.from("email_accounts").select("id,status")),
    q(db.from("invoices").select("id,number,status,currency,total_cents,due_date").in("status", ["sent", "overdue"]).order("due_date")),
    q(db.from("support_tickets").select("id,subject,status,updated_at").neq("status", "closed").order("updated_at", { ascending: false }).limit(4)),
    q(db.from("activity_logs").select("id,action,entity_type,metadata,created_at").order("created_at", { ascending: false }).limit(6)),
  ]);

  const site = websites[0], dom = domains[0], host = hosting[0];
  const first = (profile.full_name || "").split(" ")[0];

  // outstanding per currency (a client could have both USD and ZWG invoices)
  const owed = {}; unpaid.forEach((i) => { owed[i.currency] = (owed[i.currency] || 0) + Number(i.total_cents); });
  const owedText = Object.keys(owed).length ? Object.entries(owed).map(([c, v]) => money(v, c)).join(" + ") : money(0, "USD");
  const overdue = unpaid.filter((i) => i.status === "overdue").length;
  const nextRenewal = services.filter((s) => s.status === "active" && s.renewal_date && s.price_cents > 0 && s.billing_cycle !== "one_time")
    .sort((a, b) => a.renewal_date.localeCompare(b.renewal_date))[0];
  const extra = services.filter((s) => !CORE.some(([t]) => t === s.type));
  const dLeft = dom ? daysUntil(dom.expires_at) : null;

  return {
    title: "Overview",
    html: html`<div class="stack">
      <div class="page-head"><div><h1>Welcome back${first ? `, ${first}` : ""}</h1><p>${client.company_name}</p></div>${pill("account", client.status)}</div>

      <div class="grid cols-4">
        <div class="card stat"><span class="label">Outstanding</span><span class="value">${owedText}</span>
          <span class="${overdue ? "" : "dim"} meta">${overdue ? html`<span class="pill danger">${overdue} overdue</span>` : unpaid.length ? `${unpaid.length} unpaid invoice${unpaid.length > 1 ? "s" : ""}` : "All paid up"}</span></div>
        <div class="card stat"><span class="label">Next renewal</span>
          <span class="value">${nextRenewal ? money(nextRenewal.price_cents, nextRenewal.currency) : "—"}</span>
          <span class="dim meta">${nextRenewal ? `${nextRenewal.name} · ${fmtDate(nextRenewal.renewal_date)}` : "Nothing scheduled"}</span></div>
        <div class="card stat"><span class="label">Open support requests</span><span class="value">${tickets.length}</span>
          <a class="link meta" href="#/support">${tickets.length ? "View requests" : "Need help? Open a ticket"}</a></div>
        <div class="card stat"><span class="label">Email accounts</span><span class="value">${mailboxes.filter((m) => m.status !== "deleted").length}</span>
          <a class="link meta" href="#/email">Manage email</a></div>
      </div>

      <div class="grid cols-2">
        <section class="card"><div class="card-head"><h2>Services</h2></div>
          ${CORE.map(([type, label]) => { const st = serviceStatus(services, type);
            return html`<div class="svc"><span>${label}</span>${st ? html`<span class="pill ${tone("service", st)}">${st[0].toUpperCase() + st.slice(1)}</span>` : html`<span class="pill">Not subscribed</span>`}</div>`; })}
          ${extra.map((s) => html`<div class="svc"><span>${s.name}</span><span class="pill ${tone("service", s.status)}">${s.status[0].toUpperCase() + s.status.slice(1)}</span></div>`)}
        </section>

        <section class="card"><div class="card-head"><h2>Website</h2><a class="link" href="#/websites">All websites</a></div>
          ${site ? html`<div class="item-main"><div class="title">${site.name}</div><div class="meta">${site.domain?.name || site.url || ""}</div></div>
            <div class="row mt">${pill("website", site.status)}${pill("ssl", site.ssl_status)}</div>
            ${safeUrl(site.url) ? html`<p class="mt-l"><a class="btn btn-ghost btn-sm" href="${safeUrl(site.url)}" target="_blank" rel="noopener noreferrer">Visit website ${icon("external")}</a></p>` : ""}`
            : emptyState("websites", "No website yet", "Your website will appear here as soon as SXI Digital sets it up.")}
        </section>

        <section class="card"><div class="card-head"><h2>Domain</h2><a class="link" href="#/domains">All domains</a></div>
          ${dom ? html`<div class="item-main"><div class="title">${dom.name}</div>
            <div class="meta">Expires ${fmtDate(dom.expires_at)}${dLeft != null ? ` · ${dLeft < 0 ? "expired" : dLeft + " days left"}` : ""}</div></div>
            <div class="row mt">${pill("domain", dom.status)}<span class="tag">Auto-renew ${dom.auto_renew ? "on" : "off"}</span></div>`
            : emptyState("domains", "No domains yet", "Domains registered through SXI Digital will be listed here.")}
        </section>

        <section class="card"><div class="card-head"><h2>Hosting</h2><a class="link" href="#/hosting">Details</a></div>
          ${host ? html`<div class="stack">${meter("Storage", host.storage_used_mb, host.storage_limit_mb, mbText)}${meter("Bandwidth", host.bandwidth_used_mb, host.bandwidth_limit_mb, mbText)}</div>`
            : emptyState("hosting", "No hosting account", "Hosting usage will show here once your account is active.")}
        </section>
      </div>

      <div class="grid cols-2">
        <section class="card"><div class="card-head"><h2>Support requests</h2><a class="link" href="#/support">View all</a></div>
          ${tickets.length ? html`<div class="list">${tickets.map((t) => html`<a class="item" href="#/support/${t.id}"><div class="item-main"><div class="title">${t.subject}</div><div class="meta">Updated ${timeAgo(t.updated_at)}</div></div>${pill("ticket", t.status)}</a>`)}</div>`
            : emptyState("support", "No open requests", "Questions, change requests and issues you raise will be tracked here.")}
        </section>
        <section class="card"><div class="card-head"><h2>Recent activity</h2></div>
          ${activity.length ? html`<div class="list">${activity.map((a) => html`<div class="item"><div class="item-main"><div class="title">${describeActivity(a)}</div></div><span class="meta">${timeAgo(a.created_at)}</span></div>`)}</div>`
            : emptyState("inbox", "Nothing yet", "Changes to your services, invoices and tickets will be listed here.")}
        </section>
      </div>
    </div>`,
  };
}
