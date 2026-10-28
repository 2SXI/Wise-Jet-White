import { html, friendly, toast, signOutEverywhere, confirmDialog, $ } from "../core.js";

export async function render(ctx) {
  const { db } = ctx;
  const mount = (root) => {
    const f = $("#pw", root), msg = $("#pw-msg", root);
    const show = (t, k = "") => { msg.innerHTML = t ? html`<p class="alert ${k}" role="alert">${t}</p>`.s : ""; };
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const a = f.pw1.value, b = f.pw2.value;
      if (a.length < 10) return show("Use at least 10 characters.");
      if (a !== b) return show("The passwords don't match.");
      const btn = $("[type=submit]", f); btn.disabled = true; btn.textContent = "Updating…";
      const { error } = await db.auth.updateUser({ password: a });
      btn.disabled = false; btn.textContent = "Update password";
      if (error) return show(friendly(error));
      try { await db.rpc("log_own_event", { p_action: "auth.password_changed" }); } catch { /* best effort */ }
      f.reset(); show("Password updated.", "ok"); toast("Password updated", "ok");
    });
    $("[data-so-all]", root).addEventListener("click", async () => {
      if (await confirmDialog({ title: "Sign out everywhere?", body: "You'll be signed out on every device, including this one.", confirmText: "Sign out everywhere" })) signOutEverywhere("global");
    });
    $("[data-so]", root).addEventListener("click", () => signOutEverywhere());
  };
  return { title: "Settings", mount, html: html`<div class="stack"><div class="page-head"><div><h1>Settings</h1><p>Security and sign-in.</p></div></div>
    <form id="pw" class="card form" novalidate><h2>Change password</h2>
      <div class="grid cols-2"><div class="field"><label for="pw1">New password</label><input class="input" id="pw1" name="pw1" type="password" autocomplete="new-password" minlength="10"><span class="hint">At least 10 characters. Use one you don't use elsewhere.</span></div>
      <div class="field"><label for="pw2">Confirm new password</label><input class="input" id="pw2" name="pw2" type="password" autocomplete="new-password"></div></div>
      <div id="pw-msg" aria-live="polite"></div><div class="row"><button class="btn btn-primary" type="submit">Update password</button></div></form>
    <section class="card"><h2>Sessions</h2><p class="dim mt">Signed in on a shared or lost device? Sign out everywhere.</p>
      <div class="row mt-l"><button class="btn btn-ghost" data-so type="button">Sign out of this device</button><button class="btn btn-danger" data-so-all type="button">Sign out everywhere</button></div></section></div>` };
}
