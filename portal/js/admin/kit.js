// Shared helpers for the admin screens: data cache, list tables, form dialogs.
import { db, q, $, $$, html, raw, esc, icon, toast, openDialog, confirmDialog, emptyState } from "../core.js";

/** Staff may see the database's own wording (it is written to be readable); clients never do. */
export function adminError(e) {
  const m = String(e?.message || e || "");
  if (/failed to fetch|networkerror|load failed/i.test(m)) return "Can't reach the server. Check your connection.";
  if (/duplicate key|already exists/i.test(m)) return "That value already exists. It must be unique.";
  if (/foreign key|still referenced/i.test(m)) return "Other records still depend on this one, so it can't be removed.";
  if (/row-level security|permission denied/i.test(m)) return "You don't have permission to do that.";
  if (/violates check constraint/i.test(m)) return "One of the values isn't allowed. Please check the form.";
  return m.length > 220 ? "Something went wrong. Please try again." : m || "Something went wrong.";
}

/* ---- small cache of lookup data so dropdowns don't refetch constantly ---- */
const cache = new Map();
export const bust = (k) => (k ? cache.delete(k) : cache.clear());
export async function lookup(key) {
  if (cache.has(key)) return cache.get(key);
  const defs = {
    clients: () => db.from("clients").select("id,company_name,email,status").order("company_name"),
    hosting: () => db.from("hosting_accounts").select("id,plan_name,client_id").order("created_at", { ascending: false }),
    domains: () => db.from("domains").select("id,name,client_id").order("name"),
    staff: () => db.from("profiles").select("id,full_name,email,role").in("role", ["staff", "admin"]).eq("is_active", true).order("full_name"),
    servers: () => db.from("servers").select("id,name").order("name"),
  };
  const rows = await q(defs[key]());
  cache.set(key, rows); return rows;
}
export const clientName = (clients, id) => clients.find((c) => c.id === id)?.company_name || "—";
export const clientOptions = (clients) => clients.map((c) => [c.id, c.company_name]);

/* ---- <select> / form field markup ---- */
const opt = (v, l, sel) => html`<option value="${v}" ${sel ? raw("selected") : ""}>${l}</option>`;
export function fieldHtml(f, val) {
  const id = "f-" + f.name, v = val ?? "";
  const label = html`<label for="${id}">${f.label}${f.required ? html` <span class="faint">*</span>` : ""}</label>`;
  let ctl;
  if (f.type === "select") {
    ctl = html`<select class="input" id="${id}" name="${f.name}" ${f.required ? raw("required") : ""}>${f.required && v ? "" : opt("", f.required ? "Choose…" : "—", v === "")}
      ${(f.options || []).map(([ov, ol]) => opt(ov, ol, String(ov) === String(v)))}</select>`;
  } else if (f.type === "textarea") {
    ctl = html`<textarea class="input" id="${id}" name="${f.name}" maxlength="${f.max || 2000}">${v}</textarea>`;
  } else if (f.type === "checkbox") {
    return html`<div class="field"><label class="switch"><input type="checkbox" name="${f.name}" ${val ? raw("checked") : ""}><span class="track"></span><span>${f.label}</span></label></div>`;
  } else {
    const t = f.type === "money" || f.type === "number" ? "number" : f.type === "date" ? "date" : "text";
    const step = f.type === "money" ? raw(' step="0.01" min="0"') : f.type === "number" ? raw(' step="1" min="0"') : "";
    ctl = html`<input class="input" id="${id}" name="${f.name}" type="${t}" value="${v}" ${step} ${f.required ? raw("required") : ""} ${f.readonly ? raw("readonly") : ""}
      maxlength="${f.max || 300}" placeholder="${f.placeholder || ""}" autocomplete="off">`;
  }
  return html`<div class="field">${label}${ctl}${f.hint ? html`<span class="hint">${f.hint}</span>` : ""}</div>`;
}

/** Row value → form value, and form value → database value. */
export function toForm(f, row) {
  const v = row?.[f.name];
  if (f.type === "money") return v == null ? "" : (Number(v) / 100).toFixed(2);
  if (f.type === "array") return Array.isArray(v) ? v.join(", ") : "";
  if (f.type === "checkbox") return !!v;
  if (f.type === "mb") return v == null ? "" : (Number(v) / 1024).toFixed(2).replace(/\.00$/, "");
  return v ?? (f.default ?? "");
}
export function fromForm(f, fd) {
  if (f.type === "checkbox") return fd.get(f.name) === "on";
  const raw = String(fd.get(f.name) ?? "").trim();
  if (raw === "") return f.required ? null : (f.type === "array" ? [] : null);
  if (f.type === "money") return Math.round(parseFloat(raw) * 100);
  if (f.type === "mb") return Math.round(parseFloat(raw) * 1024);
  if (f.type === "number") return parseInt(raw, 10);
  if (f.type === "array") return raw.split(/[\s,]+/).filter(Boolean).map((x) => x.toLowerCase());
  if (f.lower) return raw.toLowerCase();
  return raw;
}

/**
 * Generic create/edit dialog. onSave(values) must resolve on success or throw.
 * Fields with `type:"mb"` are typed in GB and stored as MB; "money" is typed as dollars, stored as cents.
 */
export function formDialog({ title, fields, row = null, submitText = "Save", onSave, onDelete, extra = "" }) {
  const d = openDialog(html`<form class="dlg" novalidate>
    <h2>${title}</h2>
    <div class="form form-grid">${fields.map((f) => fieldHtml(f, toForm(f, row)))}</div>
    ${extra}
    <div id="dlg-err" aria-live="polite"></div>
    <div class="actions">${onDelete ? html`<button class="btn btn-danger grow-left" data-del type="button">Delete</button>` : ""}
      <button class="btn btn-ghost" data-close type="button">Cancel</button>
      <button class="btn btn-primary" type="submit">${submitText}</button></div></form>`, { sheet: matchMedia("(max-width:880px)").matches });
  const form = $("form", d), err = $("#dlg-err", d);
  const show = (t) => { err.innerHTML = t ? html`<p class="alert" role="alert">${t}</p>`.s : ""; };
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(form), vals = {};
    for (const f of fields) {
      vals[f.name] = fromForm(f, fd);
      if (f.required && (vals[f.name] == null || Number.isNaN(vals[f.name]))) return show(`Please fill in: ${f.label}.`);
      if (typeof vals[f.name] === "number" && Number.isNaN(vals[f.name])) return show(`${f.label} must be a number.`);
    }
    const btn = $("[type=submit]", form); btn.disabled = true;
    try { await onSave(vals); d.close(); } catch (e2) { btn.disabled = false; show(adminError(e2)); }
  });
  const del = $("[data-del]", d);
  if (del) del.addEventListener("click", async () => {
    if (!(await confirmDialog({ title: "Delete this record?", body: "This can't be undone.", confirmText: "Delete", danger: true }))) return;
    try { await onDelete(); d.close(); } catch (e2) { show(adminError(e2)); }
  });
  return d;
}

/**
 * List screen: search box + status filter + table. Rows are keyboard-reachable.
 * cols: [{ label, cell(row), hideM, num }]. Returns { html, mount }.
 */
const csvCell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
export function listPage({ csvName: cn, title, sub, rows, cols, searchText, statuses, statusOf, onOpen, addLabel, onAdd, emptyIcon = "inbox", emptyText = "Nothing here yet." }) {
  const csvName = cn ?? title.toLowerCase().replace(/\W+/g, "-");
  const head = html`<div class="page-head"><div><h1>${title}</h1>${sub ? html`<p>${sub}</p>` : ""}</div>
    <div class="row">${csvName ? html`<button class="btn btn-ghost" data-csv type="button">${icon("download")}Export CSV</button>` : ""}${onAdd ? html`<button class="btn btn-primary" data-add type="button">${icon("plus")}${addLabel || "Add"}</button>` : ""}</div></div>
    <div class="toolbar"><input class="input" type="search" data-search placeholder="Search…" aria-label="Search ${title}" autocomplete="off">
    ${statuses ? html`<div class="tabs" role="group" aria-label="Filter by status">${["all", ...statuses].map((s) => html`<button class="tab" type="button" data-st="${s}" aria-pressed="${s === "all"}">${s === "all" ? "All" : s.replace(/_/g, " ")}</button>`)}</div>` : ""}</div>
    <div class="card tcard" data-table></div>`;
  const mount = (view) => {
    let term = "", st = "all", sortI = -1, dir = 1;
    const plain = (c, r) => String(c.cell(r)?.s ?? c.cell(r) ?? "").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
    const draw = () => {
      let shown = rows.filter((r) => (st === "all" || (statusOf && statusOf(r) === st)) && (!term || searchText(r).toLowerCase().includes(term)));
      if (sortI >= 0) { const c = cols[sortI]; shown = [...shown].sort((a, b) => dir * plain(c, a).localeCompare(plain(c, b), undefined, { numeric: true })); }
      view.__shown = shown;
      $("[data-table]", view).innerHTML = shown.length ? html`<div class="tscroll"><table class="tbl"><thead><tr>${cols.map((c, i) => html`<th class="sortable ${c.num ? "num" : ""} ${c.hideM ? "hide-m" : ""}" data-sort="${i}" ${sortI === i ? raw(`aria-sort="${dir > 0 ? "ascending" : "descending"}"`) : ""}>${c.label}${sortI === i ? (dir > 0 ? " ↑" : " ↓") : ""}</th>`)}</tr></thead>
        <tbody>${shown.map((r) => html`<tr class="${onOpen ? "click" : ""}" data-id="${r.id}" ${onOpen ? raw('tabindex="0"') : ""}>${cols.map((c) => html`<td class="${c.num ? "num" : ""} ${c.hideM ? "hide-m" : ""}">${c.cell(r)}</td>`)}</tr>`)}</tbody></table></div>
        <p class="hint tcount">${shown.length} of ${rows.length}</p>`.s
        : emptyState(emptyIcon, rows.length ? "No matches" : "Nothing here yet", rows.length ? "Try a different search or filter." : emptyText).s;
    };
    draw();
    $("[data-search]", view).addEventListener("input", (e) => { term = e.target.value.trim().toLowerCase(); draw(); });
    $$("[data-st]", view).forEach((b) => b.addEventListener("click", () => { st = b.dataset.st; $$("[data-st]", view).forEach((x) => x.setAttribute("aria-pressed", String(x === b))); draw(); }));
    $("[data-table]", view).addEventListener("click", (e) => { const th = e.target.closest("th[data-sort]"); if (!th) return; const i = +th.dataset.sort; dir = sortI === i ? -dir : 1; sortI = i; draw(); });
    const csv = $("[data-csv]", view);
    if (csv) csv.addEventListener("click", () => {
      const data = (view.__shown || rows).map((r) => cols.map((c) => csvCell(plain(c, r))).join(","));
      const blob = new Blob(["\ufeff" + [cols.map((c) => csvCell(c.label)).join(","), ...data].join("\n")], { type: "text/csv" });
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `${csvName}-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    });
    const open = (e) => { const tr = e.target.closest("tr[data-id]"); if (tr && onOpen) onOpen(rows.find((r) => r.id === tr.dataset.id)); };
    $("[data-table]", view).addEventListener("click", open);
    $("[data-table]", view).addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.matches("tr[data-id]")) open(e); });
    const add = $("[data-add]", view); if (add) add.addEventListener("click", onAdd);
  };
  return { html: head, mount };
}

/** Calls the admin-users Edge Function with the signed-in staff member's session. */
export async function callAdminFn(body) {
  const { data, error } = await db.functions.invoke("admin-users", { body });
  if (error) {
    let msg = error.message;
    try { const j = await error.context.json(); msg = j.error || msg; } catch { /* keep default */ }
    if (/not found|404|failed to send|fetch/i.test(String(msg))) msg = "The login service isn't set up yet. Deploy the admin-users function (see README → Login service).";
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}
