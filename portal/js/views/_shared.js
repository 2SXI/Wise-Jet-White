// Shared by several views (leading underscore: not a route).
import { html, openDialog, $, friendly, toast } from "../core.js";

/**
 * A "request" is a support ticket opened through the create_ticket() database function, which
 * takes the client from the signed-in session — the browser never sends a client id.
 * Used for everything the client can ASK for but not do directly: renewals, transfers,
 * website changes, new mailboxes, mailbox deletions and password resets.
 */
export function requestDialog(ctx, o) {
  return new Promise((resolve) => {
    const d = openDialog(html`<form class="dlg" novalidate>
      <h2>${o.title}</h2>
      ${o.intro ? html`<p class="dim">${o.intro}</p>` : ""}
      ${(o.fields || []).map((f) => html`<div class="field"><label for="f-${f.name}">${f.label}</label>
        <input class="input" id="f-${f.name}" name="${f.name}" maxlength="120" placeholder="${f.placeholder || ""}" autocomplete="off"></div>`)}
      ${o.noMessage ? "" : html`<div class="field"><label for="f-msg">${o.label || "Details"}</label>
        <textarea class="input" id="f-msg" name="msg" maxlength="5000" placeholder="${o.placeholder || ""}">${o.prefill || ""}</textarea></div>`}
      <div id="dlg-err" aria-live="polite"></div>
      <div class="actions"><button class="btn btn-ghost" data-close type="button">Cancel</button>
      <button class="btn btn-primary" type="submit">${o.submitText || "Send request"}</button></div></form>`);

    const form = $("form", d), err = $("#dlg-err", d);
    const show = (t) => { err.innerHTML = t ? html`<p class="alert" role="alert">${t}</p>`.s : ""; };
    let sent = null;
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const v = Object.fromEntries(new FormData(form));
      const missing = (o.fields || []).find((f) => f.required && !String(v[f.name] || "").trim());
      if (missing) return show(`Please fill in: ${missing.label}.`);
      const body = (o.compose ? o.compose(v) : String(v.msg || "")).trim();
      if (body.length < 3) return show("Please add a few details so we can help.");

      const btn = $("[type=submit]", form); btn.disabled = true; btn.textContent = "Sending…";
      const { data, error } = await ctx.db.rpc("create_ticket", {
        p_subject: o.subject, p_body: body, p_category: o.category || "general", p_priority: "normal",
        p_related_type: o.relatedType ?? null, p_related_id: o.relatedId ?? null,
      });
      if (error) { btn.disabled = false; btn.textContent = o.submitText || "Send request"; return show(friendly(error)); }
      sent = data; d.close(); toast("Request sent — you can follow it under Support.", "ok");
    });
    d.addEventListener("close", () => resolve(sent));
  });
}

export const hostOf = (addr) => String(addr).split("@")[1] || "";
