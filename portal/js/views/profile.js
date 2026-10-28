import { html, q, friendly, toast, $ } from "../core.js";
import { requestDialog } from "./_shared.js";

export async function render(ctx) {
  const { db, profile, client } = ctx;
  const mount = (root) => {
    const f = $("#pf", root);
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = $("[type=submit]", f), full_name = f.full_name.value.trim().slice(0, 200), phone = f.phone.value.trim().slice(0, 40) || null;
      btn.disabled = true; btn.textContent = "Saving…";
      const { error } = await db.from("profiles").update({ full_name, phone }).eq("id", profile.id);
      btn.disabled = false; btn.textContent = "Save changes";
      if (error) return toast(friendly(error), "error");
      profile.full_name = full_name; profile.phone = phone; toast("Profile updated", "ok");
    });
    $("[data-change-company]", root).addEventListener("click", () => requestDialog(ctx, { title: "Request a company details change", label: "What should we update?",
      placeholder: "e.g. New billing address / new contact person", subject: "Company details change", category: "general" }));
  };
  return { title: "Profile", mount, html: html`<div class="stack"><div class="page-head"><div><h1>Profile</h1><p>Your personal details.</p></div></div>
    <form id="pf" class="card form" novalidate><div class="grid cols-2">
      <div class="field"><label for="full_name">Full name</label><input class="input" id="full_name" name="full_name" maxlength="200" value="${profile.full_name}" autocomplete="name"></div>
      <div class="field"><label for="phone">Phone</label><input class="input" id="phone" name="phone" maxlength="40" value="${profile.phone || ""}" autocomplete="tel" inputmode="tel"></div>
      <div class="field"><label for="email">Email (sign-in)</label><input class="input" id="email" value="${profile.email || ""}" readonly></div></div>
      <div class="row"><button class="btn btn-primary" type="submit">Save changes</button></div></form>
    <section class="card"><div class="card-head"><h2>Company</h2><button class="btn btn-ghost btn-sm" data-change-company type="button">Request a change</button></div>
      <dl class="kv"><dt>Company</dt><dd>${client.company_name}</dd><dt>Contact</dt><dd>${client.contact_name || "—"}</dd><dt>Email</dt><dd>${client.email || "—"}</dd><dt>Phone</dt><dd>${client.phone || "—"}</dd><dt>Address</dt><dd>${client.address || "—"}</dd></dl></section></div>` };
}
