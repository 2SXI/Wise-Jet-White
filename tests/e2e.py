import re, sys, json, time
from playwright.sync_api import sync_playwright
import os; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from e2e_support import serve, Mock

import tempfile; SHOTS = os.path.join(tempfile.gettempdir(), "sxi-shots"); os.makedirs(SHOTS, exist_ok=True)
PORT = 8099; BASE = f"http://127.0.0.1:{PORT}"
results = []
def check(name, ok, detail=""):
    results.append((bool(ok), name, detail)); print(("PASS " if ok else "FAIL ") + name + (f"  -> {detail}" if (detail and not ok) else ""))

CONFIG_JS = 'export const CONFIG = {SUPABASE_URL:"https://test.supabase.co",SUPABASE_ANON_KEY:"anon",WEBMAIL_URL:"",SUPPORT_WHATSAPP:""};'
SECTIONS = ["overview", "websites", "domains", "email", "hosting", "invoices", "support", "profile", "settings"]

def new_context(browser, mock, authed=True, mobile=False, configured=True):
    ctx = browser.new_context(viewport={"width": 390, "height": 844} if mobile else {"width": 1280, "height": 900}, device_scale_factor=1)
    if configured:
        ctx.route("**/portal/js/config.js", lambda r, _: r.fulfill(status=200, content_type="application/javascript", body=CONFIG_JS))
        ctx.route("https://test.supabase.co/**", lambda r, req: mock.handle(r, req))
    ctx.route(re.compile(r"https://fonts\.(googleapis|gstatic)\.com/.*"), lambda r, _: r.abort())
    if authed:
        ctx.add_init_script("localStorage.setItem('sb-test-auth-token', JSON.stringify(%s))" % json.dumps(mock.session()))
    return ctx

def watch(page, errors):
    page.on("pageerror", lambda e: errors.append("pageerror: " + str(e)))
    def on_console(m):
        if m.type == "error" and "fonts.g" not in (m.location.get("url") or "") and "fonts.g" not in m.text: errors.append("console: " + m.text)
    page.on("console", on_console)

def goto(page, section, arg=None):
    route = section + (f"/{arg}" if arg else "")
    page.evaluate("h => { location.hash = h }", "#/" + route)
    page.wait_for_selector(f'#view[data-route="{route}"]', timeout=8000)   # wait for THIS screen, not a stale one

def wait_for(page, pred, timeout=5.0):
    # Must wait THROUGH Playwright (not time.sleep): the sync API only serves mocked network
    # requests while a Playwright call is running.
    end = time.time() + timeout
    while time.time() < end:
        if pred(): return True
        page.wait_for_timeout(50)
    return pred()

def overflow(page): return page.evaluate("document.documentElement.scrollWidth > window.innerWidth + 1")
def txt(page, sel="#view"): return page.inner_text(sel)

srv = serve(PORT)
with sync_playwright() as p:
    browser = p.chromium.launch()

    # ---------- A. not configured ----------
    mock = Mock(); ctx = new_context(browser, mock, authed=False, configured=False); pg = ctx.new_page()
    pg.goto(f"{BASE}/login.html"); pg.wait_for_selector("#msg .alert")
    check("A1 login page warns when the database isn't configured", "isn't connected" in txt(pg, "#msg"))
    check("A2 login page has the neural-network backdrop (decorative, ignores clicks)", pg.query_selector("canvas.neural-bg") is not None and pg.get_attribute("canvas.neural-bg", "aria-hidden") == "true" and pg.evaluate("getComputedStyle(document.querySelector('canvas.neural-bg')).pointerEvents") == "none"); ctx.close()

    # ---------- B/C. anonymous + login ----------
    mock = Mock(); mock.authed = False; ctx = new_context(browser, mock, authed=False); pg = ctx.new_page(); errs = []; watch(pg, errs)
    pg.goto(f"{BASE}/dashboard/#/invoices"); pg.wait_for_url(re.compile(r"login\.html"), timeout=8000)
    check("B1 anonymous visitor is sent to login with a next parameter", "next=%2Fdashboard%2F" in pg.url, pg.url)
    pg.fill("#email", "rudo@arikhosuites.co.zw"); pg.fill("#password", "wrong"); pg.click("#submit"); pg.wait_for_selector("#msg .alert")
    check("C1 wrong password gives a generic error", "Incorrect email or password" in txt(pg, "#msg"))
    pg.fill("#email", "nobody@example.com"); pg.fill("#password", "wrong"); pg.click("#submit"); pg.wait_for_timeout(1200)
    check("C2 unknown email gives the same error (no account enumeration)", "Incorrect email or password" in txt(pg, "#msg"))
    pg.fill("#password", mock.good_password); pg.fill("#email", "rudo@arikhosuites.co.zw"); pg.click("#submit")
    pg.wait_for_url(re.compile(r"/dashboard/"), timeout=8000); pg.wait_for_selector("#view h1")
    check("C3 correct password lands on the dashboard", "/dashboard/" in pg.url)
    check("C4 sign-in is audited via log_own_event", any(c[:2] == ("rpc", "log_own_event") and c[2]["p_action"] == "auth.login" for c in mock.calls))
    check("C5 next=… open redirect is ignored",
          (lambda: (pg.goto(f"{BASE}/login.html?next=https://evil.example/x") or True) and "/dashboard/" in pg.url or pg.wait_for_url(re.compile(r"/dashboard/"), timeout=5000) or "evil" not in pg.url)())
    real = [e for e in errs if "status of 400" not in e]   # the two 400s are the deliberate wrong-password attempts
    check("C6 no unexpected JS errors during login/redirects", not real, "; ".join(real)); ctx.close()

    # ---------- D/E. desktop: content + every section ----------
    mock = Mock(); ctx = new_context(browser, mock); pg = ctx.new_page(); errs = []; watch(pg, errs)
    pg.goto(f"{BASE}/dashboard/"); pg.wait_for_selector("#view h1")
    t = txt(pg)
    check("D1 welcome + company shown", "Welcome back, Rudo" in t and "Arikho Suites" in t)
    check("D2 outstanding is $0.00 when everything is paid", "$0.00" in t and "All paid up" in t)
    check("D3 next renewal is the domain at $15.00", "$15.00" in t and "arikhosuites.co.zw" in t)
    check("D4 hosting meters appear on the overview", "2.4 GB" in t and "18 GB" in t)
    check("D5 all four core services show Active", t.count("Active") >= 4)
    check("D6 recent activity is human-readable", "Invoice paid" in t and "Support ticket opened" in t)
    check("D7 sidebar lists all nine sections", len(pg.query_selector_all(".sidebar .nav a")) == 9)
    check("D7b client dashboard stays clean (no backdrop)", pg.query_selector("canvas.neural-bg") is None)
    check("D8 current page is marked for assistive tech", pg.get_attribute(".sidebar .nav a[data-nav=overview]", "aria-current") == "page")
    pg.screenshot(path=SHOTS + "/desktop_overview.png", full_page=True)
    for s in SECTIONS:
        goto(pg, s)
        check(f"E1 {s}: renders without horizontal overflow", not overflow(pg))
        pg.screenshot(path=f"{SHOTS}/desktop_{s}.png", full_page=True)
    check("E2 no JS/console errors across all sections", not errs, "; ".join(errs))

    # ---------- F. section content & actions ----------
    goto(pg, "websites"); t = txt(pg)
    check("F1 website card shows status, SSL and hosting", "Live" in t and "SSL active" in t and "Active" in t and "arikhosuites.co.zw" in t)
    check("F2 Visit/Manage/Request Changes buttons", all(x in t for x in ["Visit Website", "Manage", "Request Changes"]))
    check("F3 Visit link opens safely in a new tab", pg.get_attribute("a:has-text('Visit Website')", "rel") == "noopener noreferrer")
    pg.click("[data-change]"); pg.wait_for_selector("dialog[open]"); pg.fill("#f-msg", "Please update the hours on the contact page."); pg.click("dialog [type=submit]")
    wait_for(pg, lambda: any(x[:2] == ("rpc", "create_ticket") for x in mock.calls)); c = [x for x in mock.calls if x[:2] == ("rpc", "create_ticket")][-1][2]
    check("F4 Request Changes creates a ticket linked to the website", c["p_category"] == "change_request" and c["p_related_type"] == "website" and c["p_related_id"] == "w1", str(c))
    check("F5 client never sends a client id", "client_id" not in json.dumps(c))
    pg.click("a:has-text('Manage')"); pg.wait_for_selector("#view h1:has-text('Arikho Suites')")
    check("F6 Manage opens the website detail", "Last updated" in txt(pg) and "Renewal date" in txt(pg))

    goto(pg, "domains"); t = txt(pg)
    check("F7 domain fields", all(x in t for x in ["Registered", "Expires", "Registrar Ltd", "$15.00", "Auto-renew"]))
    pg.click(".switch"); pg.wait_for_selector(".ar-label:has-text('off')")
    check("F8 toggling auto-renew calls the RPC and updates the label", any(c[:2] == ("rpc", "set_domain_auto_renew") and c[2]["p_enabled"] is False for c in mock.calls))
    pg.click("[data-dns]"); pg.wait_for_selector("dialog[open]")
    check("F9 DNS info shows nameservers read-only", "ns1.sxidigital.com" in txt(pg, "dialog") and "managed by SXI" in txt(pg, "dialog")); pg.keyboard.press("Escape")
    pg.click("[data-renew]"); pg.wait_for_selector("dialog[open]"); pg.click("dialog [type=submit]")
    check("F10 Renew Domain files a renewal request", wait_for(pg, lambda: any(c[:2] == ("rpc", "create_ticket") and c[2]["p_category"] == "domain_renewal" for c in mock.calls)))
    pg.click("[data-transfer]"); pg.wait_for_selector("dialog[open]")
    check("F11 transfer request dialog opens", "Transfer" in txt(pg, "dialog")); pg.keyboard.press("Escape")

    goto(pg, "email"); t = txt(pg)
    check("F12 mailboxes listed; no password field or value anywhere", all(x in t for x in ["info@arikhosuites.co.zw", "sales@", "accounts@"]) and pg.query_selector("input[type=password]") is None and not re.search(r"password\s*[:=]", t, re.I))
    check("F13 near-full mailbox is flagged", pg.query_selector("progress.danger") is not None)
    check("F14 webmail disabled until configured", pg.get_attribute("[data-nowebmail]", "aria-disabled") == "true")
    pg.click("[data-pw]"); pg.wait_for_selector("dialog[open]"); pg.click("dialog [type=submit]")
    check("F15 password change is a request, not an exposure", wait_for(pg, lambda: any(c[:2] == ("rpc", "create_ticket") and "Password reset" in c[2]["p_subject"] for c in mock.calls)))
    pg.click("[data-del] >> nth=0"); pg.wait_for_selector("dialog[open]")
    check("F16 deleting a mailbox asks for confirmation first", "Delete" in txt(pg, "dialog")); pg.keyboard.press("Escape")
    pg.click("[data-new]"); pg.wait_for_selector("dialog[open]"); pg.click("dialog [type=submit]")
    check("F17 new-mailbox form validates required fields", "Please fill in" in txt(pg, "#dlg-err")); pg.keyboard.press("Escape")

    goto(pg, "hosting"); t = txt(pg)
    check("F18 hosting limits match the brief", all(x in t for x in ["2.4 GB / 10 GB", "18 GB / 100 GB", "1 / 3", "2 / 5", "3 / 10", "SSL active", "sxi-vps-01"]), t[:400])
    check("F19 no server controls exposed", not any(x in t.lower() for x in ["root", "ssh", "restart", "password"]))

    goto(pg, "invoices"); t = txt(pg)
    check("F20 invoice list", "INV-2026-0001" in t and "$135.00" in t and "Paid" in t)
    pg.click("tr[data-open]"); pg.wait_for_selector("#view h1:has-text('INV-2026-0001')"); t = txt(pg)
    check("F21 invoice detail has branding, items and totals", all(x in t for x in ["SXI Digital", "Billed to", "Business hosting", "Domain renewal", "Subtotal", "Total paid", "$135.00"]))
    check("F22 print/save-as-PDF and ask-about-invoice available", pg.query_selector("[data-print]") and pg.query_selector("[data-ask]"))
    check("F23 invoice shows the payment received", "ecocash" in t.lower())

    goto(pg, "support"); t = txt(pg)
    check("F24 ticket list shows the open ticket", "Update opening hours" in t and "In progress" in t)
    pg.click("[data-new]"); pg.wait_for_selector("dialog[open]"); pg.fill("#n-sub", "Email stopped working"); pg.fill("#n-msg", "I can't send mail since this morning."); pg.click("dialog [type=submit]")
    pg.wait_for_selector("#view h1:has-text('Email stopped working')")
    check("F25 new ticket created and opened", "I can't send mail" in txt(pg))
    pg.fill("#body", "Update: it's fixed itself."); pg.click("#reply [type=submit]"); pg.wait_for_selector(".msg:has-text(\"it's fixed itself\")")
    check("F26 reply appears in the thread", True)
    pg.click("[data-close-ticket]"); pg.wait_for_selector("dialog[open]"); pg.click("dialog [data-ok]"); pg.wait_for_selector(".alert:has-text('closed')")
    check("F27 closing a ticket locks replies", pg.query_selector("#reply") is None)
    goto(pg, "support", "t1")
    check("F28 staff replies are labelled", "SXI Digital" in txt(pg) and "On it" in txt(pg))

    goto(pg, "profile"); pg.fill("#full_name", "Rudo M. Moyo"); pg.click("#pf [type=submit]")
    check("F29 profile update sends only name/phone", wait_for(pg, lambda: any(c[0] == "update" and c[1] == "profiles" and set(c[2]) == {"full_name", "phone"} for c in mock.calls)))
    check("F30 company details are read-only with a change request", "Request a change" in txt(pg))
    goto(pg, "settings"); pg.fill("#pw1", "short"); pg.fill("#pw2", "short"); pg.click("#pw [type=submit]")
    check("F31 weak password rejected", "at least 10" in txt(pg, "#pw-msg"))
    pg.fill("#pw1", "a-long-passphrase-1"); pg.fill("#pw2", "different-passphrase"); pg.click("#pw [type=submit]")
    check("F32 mismatched passwords rejected", "don't match" in txt(pg, "#pw-msg"))

    # ---------- notifications ----------
    goto(pg, "overview")
    check("F33 unread count shown on the bell", pg.inner_text("#bell-count") == "1")
    pg.click("#bell"); pg.wait_for_selector("#notif-panel:not([hidden])")
    check("F34 panel lists notifications", "New invoice INV-2026-0001" in txt(pg, "#notif-panel"))
    pg.click(".notif.unread"); pg.wait_for_url(re.compile(r"#/invoices$")); pg.wait_for_selector("#bell-count", state="hidden")
    check("F35 clicking marks it read and navigates", any(c[0] == "update" and c[1] == "notifications" for c in mock.calls))
    pg.click("[data-signout]"); pg.wait_for_selector("#login-form", timeout=8000)
    check("F36 sign out returns to login and is audited", any(c[:2] == ("rpc", "log_own_event") and c[2]["p_action"] == "auth.logout" for c in mock.calls))
    ctx.close()

    # ---------- G. XSS ----------
    mock = Mock(); X = '<img src=x onerror="window.__xss=1">'
    d = mock.db; d["clients"][0]["company_name"] = X; d["websites"][0]["name"] = X; d["websites"][0]["url"] = "javascript:alert(1)"
    d["support_tickets"][0]["subject"] = X; d["support_messages"][0]["body"] = X; d["support_messages"][1]["author_name"] = X
    d["notifications"][0]["title"] = X; d["invoice_items"][0]["description"] = X; d["services"][0]["name"] = X
    d["hosting_accounts"][0]["plan_name"] = X; d["email_accounts"][0]["address"] = "info@x.co.zw"; d["domains"][0]["nameservers"] = [X]; d["invoices"][0]["notes"] = X
    ctx = new_context(browser, mock); pg = ctx.new_page(); errs = []; watch(pg, errs)
    pg.goto(f"{BASE}/dashboard/"); pg.wait_for_selector("#view h1")
    for s in SECTIONS: goto(pg, s)
    goto(pg, "invoices", "i1"); goto(pg, "support", "t1"); goto(pg, "domains"); pg.click("[data-dns]"); pg.wait_for_selector("dialog[open]"); pg.keyboard.press("Escape")
    goto(pg, "overview"); pg.click("#bell"); pg.wait_for_selector("#notif-panel:not([hidden])")
    check("G1 injected markup never executes", pg.evaluate("window.__xss === undefined"))
    check("G2 injected markup creates no elements", pg.evaluate("document.querySelectorAll('img[src=x]').length") == 0)
    goto(pg, "support", "t1"); check("G3 payload is displayed as literal text", "<img src=x" in txt(pg))
    goto(pg, "websites"); check("G4 javascript: URLs never become links", pg.query_selector("a[href^='javascript']") is None and "Visit Website" not in txt(pg))
    ctx.close()

    # ---------- H. wrong role ----------
    mock = Mock(); mock.db["profiles"][0]["role"] = "staff"; ctx = new_context(browser, mock); pg = ctx.new_page()
    pg.goto(f"{BASE}/dashboard/"); pg.wait_for_url(re.compile(r"/admin/"), timeout=8000)
    check("H1 staff are redirected away from the client dashboard", "/admin/" in pg.url)
    pg.wait_for_selector(".admin .sidebar")
    check("H1b admin page shows the neural-network backdrop", pg.query_selector("canvas.neural-bg") is not None); ctx.close()
    mock = Mock(); mock.db["profiles"][0]["is_active"] = False; ctx = new_context(browser, mock); pg = ctx.new_page()
    pg.goto(f"{BASE}/dashboard/"); pg.wait_for_url(re.compile(r"login\.html"), timeout=8000)
    check("H2 deactivated users are sent to login", "login.html" in pg.url); ctx.close()
    mock = Mock(); mock.db["clients"] = []; ctx = new_context(browser, mock); pg = ctx.new_page()
    pg.goto(f"{BASE}/dashboard/"); pg.wait_for_selector("h1")
    check("H3 unlinked login sees a friendly set-up screen", "being set up" in pg.inner_text("body")); ctx.close()

    # ---------- empty / error states ----------
    mock = Mock()
    for k in ["services", "domains", "hosting_accounts", "websites", "email_accounts", "invoices", "invoice_items", "payments", "support_tickets", "support_messages", "notifications", "activity_logs"]: mock.db[k] = []
    ctx = new_context(browser, mock); pg = ctx.new_page(); errs = []; watch(pg, errs); pg.goto(f"{BASE}/dashboard/"); pg.wait_for_selector("#view h1")
    for s in SECTIONS: goto(pg, s); check(f"I1 {s}: has a helpful empty state", len(txt(pg)) > 40 and "undefined" not in txt(pg) and "null" not in txt(pg).lower().replace("nullable", ""), txt(pg)[:120])
    pg.screenshot(path=SHOTS + "/empty_websites.png"); check("I2 no console errors in empty state", not errs, "; ".join(errs)); ctx.close()
    mock = Mock(); ctx = new_context(browser, mock); pg = ctx.new_page(); pg.goto(f"{BASE}/dashboard/"); pg.wait_for_selector("#view h1")
    ctx.route("https://test.supabase.co/rest/v1/websites*", lambda r, req: r.abort("failed"))
    goto_ok = pg.evaluate("location.hash='#/websites'"); pg.wait_for_selector("[data-retry]", timeout=8000)
    check("I3 network failure shows a friendly error with retry", "reach the server" in txt(pg) and "TypeError" not in txt(pg)); pg.screenshot(path=SHOTS + "/error_state.png"); ctx.close()

    # ---------- J. mobile ----------
    mock = Mock(); ctx = new_context(browser, mock, mobile=True); pg = ctx.new_page(); errs = []; watch(pg, errs)
    pg.goto(f"{BASE}/dashboard/"); pg.wait_for_selector("#view h1")
    check("J1 sidebar hidden, bottom nav visible on phones", not pg.is_visible(".sidebar") and pg.is_visible(".bottomnav"))
    for s in SECTIONS:
        goto(pg, s); check(f"J2 {s}: no horizontal scroll on a phone", not overflow(pg)); pg.screenshot(path=f"{SHOTS}/mobile_{s}.png")
    goto(pg, "overview"); pg.click("#more"); pg.wait_for_selector("dialog[open]")
    check("J3 More sheet lists every section", len(pg.query_selector_all("dialog .sheet-nav a")) == 9); pg.screenshot(path=SHOTS + "/mobile_more.png")
    pg.click("dialog .sheet-nav a[href='#/domains']"); pg.wait_for_selector("#view h1:has-text('Domains')")
    check("J4 navigating from the sheet closes it", pg.query_selector("dialog[open]") is None)
    tgt = pg.evaluate("[...document.querySelectorAll('.bottomnav a, .bottomnav button')].every(e => e.getBoundingClientRect().height >= 40)")
    check("J5 touch targets are at least 40px tall", tgt)
    check("J6 no console errors on mobile", not errs, "; ".join(errs)); ctx.close()
    browser.close()

fails = [r for r in results if not r[0]]
print(f"\n{len(results) - len(fails)}/{len(results)} checks passed")
sys.exit(1 if fails else 0)
