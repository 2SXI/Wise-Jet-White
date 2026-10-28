# SXI Digital — website + client portal

One folder you can host anywhere that serves static files. No Node server, no build step.

```
site/        ← upload this to your web root
  index.html, services.html, …      existing marketing site (phone numbers fixed, "Client Login" added)
  login.html, reset-password.html   sign in / reset password
  dashboard/                        client dashboard   →  yourdomain.com/dashboard/
  admin/                            admin dashboard (staff and admins only)
  portal/                           styles + JavaScript (+ self-hosted Supabase library)
  _headers, vercel.json             security headers (Netlify/Cloudflare Pages, Vercel)
supabase/    ← database (run once in Supabase) + 164 database tests
tests/       ← unit + browser tests
```

## How it's secured

The browser talks directly to Supabase, so **the database is the security boundary**, not the page:

* **Row Level Security** on every table — a client can only ever read their own rows, whatever the front-end does. Draft invoices are invisible to clients. Roles can't be self-assigned. Invoices only become *paid* by recording a payment. The audit log can't be edited by anyone. (164 automated checks, including attempts to break each rule.)
* **XSS** is the main browser-side risk. All dynamic text is escaped by default (`html` templates in `portal/js/util.js`), links are limited to `http(s)`, and the portal pages ship with a strict Content-Security-Policy (no inline or third-party scripts). Tested by injecting `<img onerror>` into every field.
* The Supabase **anon key** in `config.js` is public by design. **Never** put the service-role key, or any hosting / mail / payment API key, anywhere in `site/`.

### Honest trade-offs of the plain-HTML approach
* The session token lives in browser storage (Supabase's default). That's why the CSP matters: **don't add third-party scripts (analytics, chat widgets, ad pixels) to `login.html`, `dashboard/` or `admin/`.**
* Login throttling is Supabase Auth's built-in rate limit plus a small client-side delay (no custom per-account limiter yet).
* Anything that needs a secret — cPanel/CloudPanel/Mailcow calls, Paynow/Stripe — must run server-side. That will be **Supabase Edge Functions** in Phase 8, never browser code.

## Setup

1. **Supabase project.** Authentication → disable *Allow new users to sign up* (SXI creates client accounts). Set minimum password length to 10+. Under *URL Configuration* set the Site URL to your domain and add `https://YOURDOMAIN/reset-password.html` to the redirect URLs (needed for password-reset emails).
2. **Database.** In the SQL editor run, in order: `supabase/migrations/0001_schema.sql`, `0002_security.sql`, `0003_client_helpers.sql`, `0004_admin_helpers.sql`. Optional: run `supabase/seed_demo.sql` for a demo client with sample data.
3. **Connect the site.** Edit `site/portal/js/config.js`: your project URL + anon key (Project Settings → API). Optionally set `WEBMAIL_URL`.
4. **First admin.** Authentication → Add user, then in the SQL editor:
   ```sql
   update public.profiles set role = 'admin' where email = 'you@sxidigital.com';
   ```
5. **First client.** Create their login in Supabase → Authentication → Users (tick *Auto confirm*). Then sign in to `/admin/`, open **Clients → Add client**, and on the client's page use **Link a login by email**. Add their domains, hosting, websites, mailboxes and invoices from the other admin screens. Tell the client to use *Forgot password?* on the login page to set their own password.
6. **Deploy** the contents of `site/` to your host. Netlify / Cloudflare Pages read `_headers`; Vercel reads `vercel.json`; on Nginx/Apache add the same headers for `/login.html`, `/reset-password.html`, `/dashboard/*`, `/admin/*`.
7. **Daily job** (overdue invoices + renewal reminders), in the SQL editor:
   ```sql
   select cron.schedule('sxi-daily', '0 4 * * *', 'select public.run_daily_maintenance()');
   ```

## What's in the client dashboard
Overview · Websites · Domains · Email · Hosting · Invoices · Support · Profile · Settings, a notification bell, and a bottom tab bar + "More" sheet on phones.
Things a client can only *ask for* — renewals, transfers, DNS changes, website changes, new/deleted mailboxes, mailbox password resets — are filed as support tickets (through the `create_ticket` database function, which takes the client from the login session, never from the browser). Mailbox passwords are never shown. Nothing pretends to be connected when it isn't: **Open Webmail** stays disabled until `WEBMAIL_URL` is set, hosting usage says when it hasn't been synced, and invoices show no fake "Pay now" button.

## What's in the admin dashboard
Overview (open tickets, unpaid invoices, expiring domains, income this month) · Clients (with a detail page and login linking) · Services · Websites · Domains · Hosting · Email · Invoices (draft → add items → send → mark paid, printable) · Payments (mark paid / failed / refund) · Support (reply, status, priority, assignment, private notes) · Servers · Activity log · Team & logins (admins only) · Settings. Responsive: sidebar on desktop, bottom tab bar + "More" on phones.
Money rules are enforced by the database, not the screens: sent invoices are locked, invoices only become paid via a payment, and role changes are admin-only. Creating the *login itself* still happens in Supabase (browser code can't hold the service-role key). Hosting usage is typed in by hand until a control-panel integration exists.

### v2 additions
Glass-and-glow redesign across login, admin and client dashboard · **Ctrl/Cmd+K command palette** (jump to any screen, client, invoice, domain or ticket; run quick actions) · income chart, live activity feed and animated counters on the Overview · **sortable columns** and **Export CSV** on every list · **Renewals** screen (domains, hosting and services due within 120 days, one click to draft the invoice) · private notes on each client.

## Neural-network background
`login.html`, `reset-password.html` and `/admin/` show a faint animated network behind the content (`portal/js/neural.js`, same look as the marketing site). It's purely decorative: it ignores clicks, pauses when the tab is hidden, and shows a still frame for visitors who prefer reduced motion. Tune its strength with `startNeuralBackground({ faint: 0.8 })` (0 = invisible, 1 = as bright as the marketing site). The client dashboard is deliberately left clean; to add it there, import and call the same function in `portal/js/dashboard.js`.

## Tests
```
node --test tests/util.test.mjs                    # 10 unit tests (escaping, redirects, formatting)
pip install playwright && playwright install chromium
python3 tests/e2e.py                               # 94 client-dashboard browser checks against a mocked Supabase API
python3 tests/e2e_admin.py                         # 52 admin browser checks (desktop + phone, actions, XSS)
bash supabase/run_tests.sh                         # 164 database checks (needs local PostgreSQL)
```
The browser tests use a *mock* of the Supabase API, so the first thing to verify after step 5 is a real sign-in against your project (and a real admin action, such as sending an invoice).

## Roadmap
- [x] 1 Inspection · [x] 2 Database + auth + roles · [x] 3 Client dashboard
- [x] 4 Admin dashboard + client management · [x] 5 Websites/domains/hosting admin · [x] 6 Invoices & payments UI
- [x] 7 Support (admin side) · [ ] 8 Provider abstractions (hosting, email, payments) · [ ] 9 Security review · [ ] 10 Polish
