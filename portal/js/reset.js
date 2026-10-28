import { db, configured, $, html } from "./core.js";
import { startNeuralBackground } from "./neural.js";

startNeuralBackground();

const form = $("#reset-form"), msg = $("#msg"), btn = $("#submit");
const show = (t, k = "") => { msg.innerHTML = t ? html`<p class="alert ${k}" role="alert">${t}</p>`.s : ""; };

// Supabase turns the link's token into a short-lived "recovery" session. No session → invalid link.
async function ready() {
  if (!configured) return false;
  for (let i = 0; i < 10; i++) {            // detectSessionInUrl is async; give it a moment
    const { data: { session } } = await db.auth.getSession();
    if (session) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}
ready().then((ok) => { (ok ? form : $("#invalid")).hidden = false; });

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const a = $("#pw").value, b = $("#pw2").value;
  if (a.length < 10) return show("Use at least 10 characters.");
  if (a !== b) return show("The passwords don't match.");
  btn.disabled = true; btn.textContent = "Updating…";
  const { error } = await db.auth.updateUser({ password: a });
  if (error) { btn.disabled = false; btn.textContent = "Update password"; return show(error.message || "Couldn't update the password."); }
  try { await db.rpc("log_own_event", { p_action: "auth.password_changed" }); } catch { /* best effort */ }
  await db.auth.signOut();
  show("Password updated. Redirecting to sign in…", "ok");
  setTimeout(() => location.replace("/login.html"), 1200);
});
