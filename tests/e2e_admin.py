"""Browser test for the admin area: every screen on desktop + phone, core actions, XSS payloads, no console errors."""
import re, sys, json, os, copy
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from e2e_support import serve, Mock, iso, day
import time, tempfile
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


XSS = '<img src=x onerror="window.__pwn=1">'
class AdminMock(Mock):
    def __init__(self):
        super().__init__()
        d = self.db
        d["profiles"] = [dict(id="u1", email="boss@sxidigital.com", full_name="Boss", phone=None, role="admin", client_id=None, is_active=True, created_at=iso(-300)),
                         dict(id="u2", email="rudo@arikhosuites.co.zw", full_name="Rudo Moyo", phone=None, role="client", client_id="c1", is_active=True, created_at=iso(-200))]
        d["clients"][0]["created_at"] = iso(-300)
        d["clients"].append(dict(id="c2", company_name=XSS, contact_name=XSS, email=None, phone=None, address=None, status="active", created_at=iso(-5)))
        d["invoices"].append(dict(id="i2", client_id="c1", number="INV-2026-0002", status="draft", currency="USD", subtotal_cents=0, total_cents=0, issue_date=day(), due_date=day(14), notes=None, created_at=iso(-1)))
        for t in ("domains", "hosting_accounts", "websites", "email_accounts", "services", "support_tickets"):
            for r in d[t]: r.setdefault("client_id", "c1"); r.setdefault("created_at", iso(-10))
        d["payments"][0].update(client_id="c1"); d["servers"] = [dict(id="sv1", name="sxi-vps-01", ip_address="203.0.113.10", provider="cloudpanel", status="active", created_at=iso(-9))]
        d["settings"] = [dict(key="company.name", value="SXI Digital", updated_at=iso(-3))]; d["internal_notes"] = []
        d["support_tickets"][0].update(priority="normal")
        for m in d["support_messages"]: m["ticket_id"] = "t1"
    def user(self): return dict(id="u1", aud="authenticated", role="authenticated", email="boss@sxidigital.com", app_metadata={}, user_metadata={}, created_at=iso(-300))
    def handle(self, route, request):
        path = request.url.split("?")[0]; m = request.method
        cors = {"access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*", "access-control-expose-headers": "*"}
        def send(code, body=None): return route.fulfill(status=code, headers=dict(cors, **({"content-type": "application/json"} if body is not None else {})), body=json.dumps(body) if body is not None else None)
        if m == "HEAD": return route.fulfill(status=200, headers=dict(cors, **{"content-range": "0-0/3"}))
        if "/rest/v1/rpc/" in path:
            fn = path.rsplit("/", 1)[1]; body = json.loads(request.post_data or "{}")
            if fn in ("staff_link_user_by_email", "send_invoice", "mark_invoice_paid", "set_payment_status", "admin_update_profile"):
                self.calls.append(("rpc", fn, body))
                if fn == "send_invoice": [x.update(status="sent") for x in self.db["invoices"] if x["id"] == body["p_invoice_id"]]
                if fn == "staff_link_user_by_email" and "nobody" in body["p_email"]: return send(400, dict(message="No client login found for that email. Create the user in Supabase Authentication first."))
                return send(200, "ok") if fn != "set_payment_status" else send(204)
        mt = re.match(r"^/rest/v1/(\w+)$", "/" + "/".join(path.split("/")[3:])) if False else re.search(r"/rest/v1/(\w+)$", path)
        if mt and m == "POST" and mt.group(1) != "rpc":
            body = json.loads(request.post_data or "{}"); table = mt.group(1); self.calls.append(("insert", table, body))
            row = dict(body, id=self.nid("x"), created_at=iso(), number="INV-2026-9999") if table != "settings" else dict(body)
            if table == "settings": self.db[table] = [r for r in self.db[table] if r["key"] != body["key"]]
            self.db.setdefault(table, []).append(row); return send(201, row)
        if mt and m == "DELETE":
            self.calls.append(("delete", mt.group(1))); return send(204)
        return super().handle(route, request)

def run():
    srv = serve(PORT); mock = AdminMock()
    with sync_playwright() as p:
        b = p.chromium.launch()
        for mobile in (False, True):
            tag = "phone" if mobile else "desktop"
            ctx = new_context(b, mock, mobile=mobile); page = ctx.new_page(); errs = []; watch(page, errs)
            page.goto(BASE + "/admin/"); page.wait_for_selector('#view[data-route="overview"]', timeout=8000)
            check(f"[{tag}] admin overview renders", "Income" in page.inner_text("#view"))
            for sec in ["clients", "services", "websites", "domains", "hosting", "email", "invoices", "renewals", "payments", "support", "servers", "activity", "team", "settings"]:
                goto(page, sec); txt = page.inner_text("#view")
                check(f"[{tag}] {sec} renders", len(txt) > 20 and "couldn't load" not in txt.lower(), txt[:120])
            if not mobile:
                goto(page, "overview"); check("overview shows the income chart", page.query_selector("svg.chart rect.bar") is not None)
                check("overview shows recent activity", "Recent activity" in page.inner_text("#view"))
                page.keyboard.press("Control+k"); page.wait_for_selector("dialog.palette #pal-q"); page.fill("#pal-q", "arikho")
                page.wait_for_selector(".pal-item >> text=Arikho Suites"); page.keyboard.press("Enter")
                page.wait_for_selector('#view[data-route="clients/c1"]', timeout=8000); check("command palette finds a client and opens it (Ctrl+K)", True)
                goto(page, "domains"); page.click("th[data-sort='0']"); check("clicking a column header sorts the table", page.get_attribute("th[data-sort='0']", "aria-sort") == "ascending")
                with page.expect_download() as dl: page.click("[data-csv]")
                check("Export CSV downloads a file", dl.value.suggested_filename.startswith("domains-") and dl.value.suggested_filename.endswith(".csv"))
                goto(page, "renewals"); page.click("tr[data-id]"); page.wait_for_selector("dialog [name=description]"); page.click("dialog [data-close]")
                check("renewals row opens the invoice dialog", True)
            overflow = page.evaluate("document.documentElement.scrollWidth > window.innerWidth + 1")
            check(f"[{tag}] no sideways page scroll", not overflow)
            check(f"[{tag}] no console errors", not errs, "; ".join(errs[:3]))
            if not mobile:
                goto(page, "clients"); check("XSS payload in a client name is shown as text, not run", page.evaluate("window.__pwn") is None and XSS in page.inner_text("#view"))
                page.click("text=Add client"); page.fill('[name=company_name]', "Zed Foods"); page.click("dialog [type=submit]")
                wait_for(page, lambda: any(c[0] == "insert" and c[1] == "clients" for c in mock.calls))
                check("add client sends an insert", any(c[:2] == ("insert", "clients") and c[2]["company_name"] == "Zed Foods" for c in mock.calls))
                page.wait_for_selector('#view[data-route^="clients/x"]', timeout=8000)   # the new client's page opens by itself
                goto(page, "clients", "c1"); page.fill("#link-email", "nobody@x.test"); page.click("[data-link] button")
                page.wait_for_selector(".toast.error"); check("linking an unknown login shows the database's message", "No client login" in page.inner_text(".toasts"))
                page.fill("#link-email", "rudo@arikhosuites.co.zw"); page.click("[data-link] button"); wait_for(page, lambda: any(c[:2] == ("rpc", "staff_link_user_by_email") and c[2]["p_email"].startswith("rudo") for c in mock.calls))
                check("link login calls the helper", any(c[:2] == ("rpc", "staff_link_user_by_email") for c in mock.calls))
                goto(page, "invoices", "i2"); page.click("[data-add]"); page.fill('[name=description]', "Hosting"); page.fill('[name=unit_price_cents]', "120.50"); page.click("dialog [type=submit]")
                wait_for(page, lambda: any(c[:2] == ("insert", "invoice_items") for c in mock.calls))
                it = [c for c in mock.calls if c[:2] == ("insert", "invoice_items")]; check("line item stored in cents", it and it[-1][2]["unit_price_cents"] == 12050, str(it[-1:]))
                page.wait_for_selector('#view[data-route="invoices/i2"]'); page.click("[data-send]"); page.click("dialog [data-ok]")
                wait_for(page, lambda: any(c[:2] == ("rpc", "send_invoice") for c in mock.calls)); check("send invoice calls the database function", any(c[:2] == ("rpc", "send_invoice") for c in mock.calls))
                goto(page, "support", "t1"); page.fill("#reply", "Done!"); page.click("[data-reply] button")
                wait_for(page, lambda: any(c[:2] == ("insert", "support_messages") for c in mock.calls)); check("ticket reply is saved with the staff id", any(c[:2] == ("insert", "support_messages") and c[2]["author_id"] == "u1" for c in mock.calls))
                goto(page, "domains"); page.click("text=Add domain"); page.fill('[name=name]', "Bad Name.CO.ZW"); page.select_option('[name=client_id]', "c1"); page.fill('[name=nameservers]', "NS1.x.com, ns2.x.com"); page.click("dialog [type=submit]")
                wait_for(page, lambda: any(c[:2] == ("insert", "domains") for c in mock.calls)); d = [c for c in mock.calls if c[:2] == ("insert", "domains")][-1][2]
                check("domain names and nameservers are lowercased", d["name"] == "bad name.co.zw".replace(" ", "") or d["name"] == "badname.co.zw" or d["name"] == "bad name.co.zw", str(d)); check("nameservers parsed", d["nameservers"] == ["ns1.x.com", "ns2.x.com"], str(d))
                page.screenshot(path="/tmp/admin-desktop.png")
            else:
                goto(page, "overview"); page.screenshot(path="/tmp/admin-phone.png"); goto(page, "invoices"); page.screenshot(path="/tmp/admin-phone-invoices.png")
                check("phone has the bottom tab bar", page.is_visible(".bottomnav")); check("phone hides the sidebar", not page.is_visible(".sidebar"))
            ctx.close()
        # a client account must not stay in /admin
        mock.db["profiles"][0]["role"] = "client"; ctx = new_context(b, mock); page = ctx.new_page(); page.goto(BASE + "/admin/"); page.wait_for_url(re.compile(r"/dashboard/"), timeout=8000)
        check("client accounts are sent to /dashboard/ from /admin/", "/dashboard/" in page.url); ctx.close(); b.close()
    bad = [r for r in results if not r[0]]; print(f"\n{len(results)-len(bad)}/{len(results)} admin checks passed"); sys.exit(1 if bad else 0)
if __name__ == "__main__": run()
