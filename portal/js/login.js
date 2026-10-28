import { db, configured, $, html, safeNext, homeFor, loadProfile } from "./core.js";
import { startNeuralBackground } from "./neural.js";

startNeuralBackground();

const form = $("#login-form"), msg = $("#msg"), btn = $("#submit");
const show = (text, kind = "") => { msg.innerHTML = text ? html`<p class="alert ${kind}" role="alert">${text}</p>`.s : ""; };
const params = new URLSearchParams(location.search);
let failures = 0;

if (!configured) show("The portal isn't connected to its database yet (portal/js/config.js).", "warn");

// Already signed in? Skip the form.
(async () => {
  if (!configured) return;
  const p = await loadProfile();
  if (p) location.replace(safeNext(params.get("next"), p.role));
})();

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!configured) return;
  const email = form.email.value.trim().toLowerCase(), password = form.password.value;
  if (!email || !password) return show("Enter your email and password.");

  btn.disabled = true; btn.textContent = "Signing in…"; show("");
  try {
    const { error } = await db.auth.signInWithPassword({ email, password });
    if (error) {
      failures++;
      // Small, growing delay after repeated failures (the real throttle is Supabase Auth's rate limit).
      await new Promise((r) => setTimeout(r, Math.min(failures, 5) * 400));
      return show(/rate|too many/i.test(error.message)
        ? "Too many attempts. Please wait a few minutes and try again."
        : "Incorrect email or password.");   // identical for unknown emails and wrong passwords
    }
    const p = await loadProfile();
    if (!p) { await db.auth.signOut(); return show("This account isn't active. Please contact SXI Digital."); }
    try { await db.rpc("log_own_event", { p_action: "auth.login" }); } catch { /* best effort */ }
    location.replace(safeNext(params.get("next"), p.role));
  } catch {
    show("Can't reach the server. Check your connection and try again.");
  } finally {
    btn.disabled = false; btn.textContent = "Sign in";
  }
});

$("#forgot").addEventListener("click", async (e) => {
  e.preventDefault();
  if (!configured) return;
  const email = form.email.value.trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) return show("Enter your email above first, then choose “Forgot password?”.");
  try { await db.auth.resetPasswordForEmail(email, { redirectTo: new URL("reset-password.html", location.href).href }); } catch { /* same message either way */ }
  // Same message whether or not the account exists — no account enumeration.
  show("If an account exists for that email, a reset link is on its way.", "ok");
});
