"""Test harness: static server (with the production CSP) + a mock of the Supabase REST/Auth API."""
import json, re, threading, time, http.server, socketserver, functools, copy
from urllib.parse import urlparse, parse_qsl

import os
SITE = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "site"))
CSP = ("default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; "
       "img-src 'self' data:; connect-src 'self' https://*.supabase.co; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'")
PORTAL = ("/login.html", "/reset-password.html", "/dashboard", "/admin")

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=SITE, **k)
    def end_headers(self):
        if self.path.split("?")[0].startswith(PORTAL): self.send_header("Content-Security-Policy", CSP)
        super().end_headers()
    def log_message(self, *a): pass

def serve(port=8099):
    socketserver.TCPServer.allow_reuse_address = True
    srv = socketserver.TCPServer(("127.0.0.1", port), Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv

def iso(days=0, hours=0):
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() + days * 86400 + hours * 3600))
def day(days=0): return iso(days)[:10]

def fixtures():
    return {
      "clients": [dict(id="c1", company_name="Arikho Suites", contact_name="Rudo Moyo", email="rudo@arikhosuites.co.zw", phone="+263 77 123 4567", address="12 Samora Machel Ave, Harare", status="active")],
      "profiles": [dict(id="u1", email="rudo@arikhosuites.co.zw", full_name="Rudo Moyo", phone=None, role="client", client_id="c1", is_active=True)],
      "services": [
        dict(id="s1", type="website", name="Business website", status="active", price_cents=35000, currency="USD", billing_cycle="one_time", renewal_date=None),
        dict(id="s2", type="domain", name="arikhosuites.co.zw", status="active", price_cents=1500, currency="USD", billing_cycle="yearly", renewal_date=day(60)),
        dict(id="s3", type="hosting", name="Business hosting", status="active", price_cents=12000, currency="USD", billing_cycle="yearly", renewal_date=day(200)),
        dict(id="s4", type="business_email", name="Business email", status="active", price_cents=6000, currency="USD", billing_cycle="yearly", renewal_date=day(120))],
      "domains": [dict(id="d1", name="arikhosuites.co.zw", status="active", registrar="Registrar Ltd", registered_at=day(-305), expires_at=day(60), auto_renew=True, renewal_price_cents=1500, currency="USD", nameservers=["ns1.sxidigital.com", "ns2.sxidigital.com"])],
      "hosting_accounts": [dict(id="h1", plan_name="Business Hosting", status="active", ssl_status="active", server_label="sxi-vps-01", storage_used_mb=2458, storage_limit_mb=10240,
                                bandwidth_used_mb=18432, bandwidth_limit_mb=102400, websites_limit=3, databases_used=2, databases_limit=5, email_accounts_limit=10, renewal_date=day(200), usage_synced_at=iso(hours=-2), created_at=iso(-300))],
      "websites": [dict(id="w1", name="Arikho Suites", url="https://arikhosuites.co.zw", status="live", ssl_status="active", last_updated_at=iso(-3), renewal_date=day(200), hosting_account_id="h1", domain_id="d1", created_at=iso(-300))],
      "email_accounts": [dict(id="e1", address="info@arikhosuites.co.zw", status="active", storage_used_mb=640, storage_limit_mb=5120),
                         dict(id="e2", address="sales@arikhosuites.co.zw", status="active", storage_used_mb=4900, storage_limit_mb=5120),
                         dict(id="e3", address="accounts@arikhosuites.co.zw", status="active", storage_used_mb=120, storage_limit_mb=5120)],
      "invoices": [dict(id="i1", number="INV-2026-0001", status="paid", currency="USD", subtotal_cents=13500, total_cents=13500, issue_date=day(-40), due_date=day(-26), sent_at=iso(-40), paid_at=iso(-30), notes="Thank you for your business.")],
      "invoice_items": [dict(id="ii1", invoice_id="i1", description="Business hosting (12 months)", quantity=1, unit_price_cents=12000, position=0),
                        dict(id="ii2", invoice_id="i1", description="Domain renewal arikhosuites.co.zw", quantity=1, unit_price_cents=1500, position=1)],
      "payments": [dict(id="p1", invoice_id="i1", amount_cents=13500, currency="USD", status="paid", paid_at=iso(-30), method="ecocash", created_at=iso(-30))],
      "support_tickets": [dict(id="t1", subject="Update opening hours", category="change_request", status="in_progress", created_at=iso(-2), updated_at=iso(hours=-3))],
      "support_messages": [dict(id="m1", ticket_id="t1", author_id="u1", author_name="Rudo Moyo", author_role="client", body="Please change our hours to 8-5.", created_at=iso(-2)),
                           dict(id="m2", ticket_id="t1", author_id="staff1", author_name="Tendai (SXI)", author_role="staff", body="On it — will be live today.", created_at=iso(hours=-3))],
      "notifications": [dict(id="n1", type="invoice_created", title="New invoice INV-2026-0001", body="Due soon", link="/dashboard/invoices", read_at=None, created_at=iso(hours=-5)),
                        dict(id="n2", type="ticket_update", title="New reply on your ticket", body="Update opening hours", link="/dashboard/support/t1", read_at=iso(-1), created_at=iso(-1))],
      "activity_logs": [dict(id=3, action="invoices.update", entity_type="invoices", metadata=dict(to="paid"), created_at=iso(-30)),
                        dict(id=2, action="support_tickets.insert", entity_type="support_tickets", metadata={}, created_at=iso(-2)),
                        dict(id=1, action="domains.update", entity_type="domains", metadata=dict(changed=["auto_renew"]), created_at=iso(-5))],
    }

class Mock:
    def __init__(self):
        self.db = fixtures(); self.calls = []; self.n = 100
        self.good_password = "correct-horse-battery"; self.role = "client"; self.authed = True
    def nid(self, p): self.n += 1; return f"{p}{self.n}"

    def session(self):
        u = self.user()
        return dict(access_token="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1MSIsInJvbGUiOiJhdXRoZW50aWNhdGVkIiwiZXhwIjo0MTAyNDQ0ODAwfQ.sig",
                    refresh_token="r", token_type="bearer", expires_in=3600, expires_at=int(time.time()) + 3600, user=u)
    def user(self):
        return dict(id="u1", aud="authenticated", role="authenticated", email="rudo@arikhosuites.co.zw", app_metadata={}, user_metadata={}, created_at=iso(-300))

    @staticmethod
    def _match(row, k, v):
        op, _, val = v.partition(".")
        cur = row.get(k)
        s = "null" if cur is None else str(cur).lower() if isinstance(cur, bool) else str(cur)
        if op == "eq": return s == val
        if op == "neq": return s != val
        if op == "is": return (cur is None) == (val == "null")
        if op == "in": return s in [x.strip('"') for x in val.strip("()").split(",")]
        return True

    def select(self, table, qs, single):
        rows = list(self.db.get(table, []))
        if table == "email_accounts": rows = [r for r in rows if r.get("status") != "deleted"]
        for k, v in qs:
            if k in ("select", "order", "limit", "offset", "columns"): continue
            rows = [r for r in rows if self._match(r, k, v)]
        for k, v in qs:
            if k == "order":
                col, _, d = v.split(",")[0].partition(".")
                rows.sort(key=lambda r: (r.get(col) is None, r.get(col) if r.get(col) is not None else 0), reverse=(d == "desc"))
        for k, v in qs:
            if k == "limit": rows = rows[: int(v)]
        out = []
        for r in rows:
            r = copy.deepcopy(r)
            if table == "websites":
                d = next((x for x in self.db["domains"] if x["id"] == r.get("domain_id")), None); h = next((x for x in self.db["hosting_accounts"] if x["id"] == r.get("hosting_account_id")), None)
                r["domain"] = d and dict(id=d["id"], name=d["name"], expires_at=d["expires_at"]); r["hosting"] = h and dict(id=h["id"], status=h["status"], plan_name=h["plan_name"])
            out.append(r)
        return out

    def handle(self, route, request):
        u = urlparse(request.url); path = u.path; m = request.method
        cors = {"access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS", "access-control-expose-headers": "*"}
        def send(status, body=None, extra=None):
            h = dict(cors, **(extra or {}))
            if body is None: return route.fulfill(status=status, headers=h)
            return route.fulfill(status=status, headers=dict(h, **{"content-type": "application/json"}), body=json.dumps(body))
        if m == "OPTIONS": return send(204)
        qs = parse_qsl(u.query)
        if path == "/auth/v1/user": return send(200, self.user()) if self.authed else send(401, dict(msg="no session"))
        if path == "/auth/v1/token":
            body = json.loads(request.post_data or "{}")
            if body.get("password") == self.good_password: self.authed = True; return send(200, self.session())
            return send(400, dict(error="invalid_grant", error_description="Invalid login credentials", code=400, error_code="invalid_credentials", msg="Invalid login credentials"))
        if path == "/auth/v1/logout": self.authed = False; return send(204)
        if path == "/auth/v1/recover": self.calls.append(("recover", json.loads(request.post_data or "{}"))); return send(200, {})
        if path == "/auth/v1/user" and m == "PUT": return send(200, self.user())
        if path.startswith("/rest/v1/rpc/"):
            fn = path.rsplit("/", 1)[1]; body = json.loads(request.post_data or "{}"); self.calls.append(("rpc", fn, body))
            if fn == "set_domain_auto_renew":
                for d in self.db["domains"]:
                    if d["id"] == body["p_domain_id"]: d["auto_renew"] = body["p_enabled"]
                return send(204)
            if fn == "close_ticket":
                for t in self.db["support_tickets"]:
                    if t["id"] == body["p_ticket_id"]: t["status"] = "closed"
                return send(204)
            if fn == "create_ticket":
                tid = self.nid("t"); self.db["support_tickets"].append(dict(id=tid, subject=body["p_subject"], category=body["p_category"], status="open", created_at=iso(), updated_at=iso()))
                self.db["support_messages"].append(dict(id=self.nid("m"), ticket_id=tid, author_id="u1", author_name="Rudo Moyo", author_role="client", body=body["p_body"], created_at=iso()))
                return send(200, tid)
            if fn == "log_own_event": return send(204)
            return send(404, dict(message="unknown rpc"))
        mt = re.match(r"^/rest/v1/(\w+)$", path)
        if mt:
            table = mt.group(1)
            if m == "GET":
                rows = self.select(table, qs, False); acc = request.headers.get("accept", "")
                if "pgrst.object" in acc:
                    if len(rows) != 1: return send(406, dict(code="PGRST116", details="The result contains %d rows" % len(rows), hint=None, message="JSON object requested, multiple (or no) rows returned"))
                    return send(200, rows[0])
                return send(200, rows)
            if m == "POST":
                body = json.loads(request.post_data or "{}"); self.calls.append(("insert", table, body))
                row = dict(body, id=self.nid("x"), created_at=iso())
                if table == "support_messages": row.update(author_name="Rudo Moyo", author_role="client")
                self.db[table].append(row); return send(201)
            if m == "PATCH":
                body = json.loads(request.post_data or "{}"); self.calls.append(("update", table, body, qs))
                for r in self.select(table, qs, False):
                    for real in self.db[table]:
                        if real["id"] == r["id"]: real.update(body)
                return send(204)
        return send(404, dict(message="not mocked: " + path))
