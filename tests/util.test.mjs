import { test } from "node:test";
import assert from "node:assert/strict";
import { html, raw, esc, safeNext, money, fmtDate, daysUntil, mbText, pct, tone, pill, safeUrl, describeActivity, linkToHash, timeAgo } from "../site/portal/js/util.js";

test("html`` escapes interpolated values (XSS)", () => {
  const evil = `<img src=x onerror="alert(1)">`;
  const out = html`<p>${evil}</p>`.s;
  assert.ok(!out.includes("<img"));
  assert.ok(out.includes("&lt;img"));
  assert.equal(html`<a title="${'" onmouseover="x'}">`.s, '<a title="&quot; onmouseover=&quot;x">');
  assert.equal(esc(`'"<>&`), "&#39;&quot;&lt;&gt;&amp;");
});
test("html`` composes safely and joins arrays", () => {
  const li = (t) => html`<li>${t}</li>`;
  assert.equal(html`<ul>${["a", "<b>"].map(li)}</ul>`.s, "<ul><li>a</li><li>&lt;b&gt;</li></ul>");
  assert.equal(html`${null}${undefined}${false}x`.s, "x");
  assert.equal(html`${raw("<b>ok</b>")}`.s, "<b>ok</b>");
  assert.equal(html`${0}`.s, "0");
});
test("safeNext only allows in-area same-site paths", () => {
  assert.equal(safeNext("/dashboard/#/invoices", "client"), "/dashboard/#/invoices");
  assert.equal(safeNext("/admin/", "admin"), "/admin/");
  assert.equal(safeNext("/admin/", "client"), "/dashboard/");
  for (const bad of ["https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)", "", "dashboard", "/dashboardx", "/dashboard\r\nX: y", "/%2F%2Fevil", undefined, null, 5, "/dashboard/" + "a".repeat(400)])
    assert.equal(safeNext(bad, "client"), "/dashboard/", JSON.stringify(bad));
});
test("money handles currencies and nulls", () => {
  assert.equal(money(1500, "USD"), "$15.00");
  assert.equal(money(null), "—");
  assert.match(money(250000, "ZWG"), /2,500\.00|ZWG/);
});
test("dates are timezone-safe for date-only values", () => {
  assert.equal(fmtDate("2026-03-12"), "12 Mar 2026");
  assert.equal(fmtDate(null), "—");
  assert.equal(daysUntil("2026-10-11", new Date("2026-10-01T23:30:00Z")), 10);
  assert.equal(daysUntil("2026-09-30", new Date("2026-10-01T00:10:00Z")), -1);
  assert.equal(daysUntil(null), null);
});
test("storage and percentage helpers", () => {
  assert.equal(mbText(2458), "2.4 GB"); assert.equal(mbText(512), "512 MB"); assert.equal(mbText(10240), "10 GB"); assert.equal(mbText(null), "—");
  assert.equal(pct(2458, 10240), 24); assert.equal(pct(5, 0), 0); assert.equal(pct(900, 100), 100);
});
test("status tones and pills escape/label correctly", () => {
  assert.equal(tone("website", "live"), "ok"); assert.equal(tone("invoice", "overdue"), "danger"); assert.equal(tone("invoice", "draft"), "");
  assert.match(pill("ssl", "active").s, /SSL active/); assert.match(pill("ticket", "waiting_for_client").s, /Waiting for you/);
});
test("activity wording & notification links", () => {
  assert.equal(describeActivity({ action: "invoices.update", metadata: { to: "paid" } }), "Invoice paid");
  assert.equal(describeActivity({ action: "domains.update", metadata: { changed: ["auto_renew"] } }), "Domain auto-renew changed");
  assert.equal(describeActivity({ action: "weird.thing", entity_type: "gizmos" }), "Gizmo updated");
  assert.equal(linkToHash("/dashboard/invoices"), "#/invoices");
  assert.equal(linkToHash("/dashboard/support/abc"), "#/support/abc");
  assert.equal(linkToHash("https://evil.example"), "#/overview");
  assert.equal(linkToHash("/admin/x"), "#/overview");
});
test("timeAgo", () => {
  const now = Date.parse("2026-10-01T12:00:00Z");
  assert.equal(timeAgo("2026-10-01T11:59:50Z", now), "just now"); assert.equal(timeAgo("2026-10-01T11:30:00Z", now), "30 min ago"); assert.equal(timeAgo("2026-10-01T09:00:00Z", now), "3 h ago");
});

test("safeUrl only allows http(s)", () => {
  assert.equal(safeUrl("https://arikhosuites.co.zw"), "https://arikhosuites.co.zw");
  for (const bad of ["javascript:alert(1)", "data:text/html,x", "//evil.example", "ftp://x.y", "https://a.b\"onmouseover=x", "", null, undefined, 5])
    assert.equal(safeUrl(bad), null, String(bad));
});
