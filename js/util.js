// util.js — DOM helpers, base64/UTF-8, ids, toast.

/** Create an element. props: class, text, html, dataset, on<event> handlers, or plain attrs. children: node, string, or array. */
export function el(tag, props = {}, children = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else if (k === "html") n.innerHTML = v;
    else if (k === "dataset") Object.assign(n.dataset, v);
    else if (k === "hidden") n.hidden = !!v;
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2).toLowerCase(), v);
    else n.setAttribute(k, v === true ? "" : v);
  }
  append(n, children);
  return n;
}

export function append(node, children) {
  if (children == null) return node;
  if (!Array.isArray(children)) children = [children];
  for (const c of children) {
    if (c == null || c === false) continue;
    node.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
  }
  return node;
}

export function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); return node; }

export const $ = (sel, root = document) => root.querySelector(sel);

export function clone(obj) {
  return typeof structuredClone === "function" ? structuredClone(obj) : JSON.parse(JSON.stringify(obj));
}

export function debounce(fn, ms = 350) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

/** Encode a JS string to base64 (UTF-8 safe — dialogue text has em-dashes etc.). */
export function utf8ToB64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

/** Decode base64 (with GitHub's embedded newlines) to a UTF-8 string. */
export function b64ToUtf8(b64) {
  const bin = atob(String(b64).replace(/\s/g, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder("utf-8").decode(bytes);
}

/** Serialize JSON the way the Godot editor does: tab indent (JSON.stringify(data, "\t")). */
export function toGodotJson(obj) {
  return JSON.stringify(obj, null, "\t") + "\n";
}

export function slugify(str) {
  return String(str).toLowerCase().trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "_")
    .replace(/^_+|_+$/g, "") || "node";
}

let _uidCounter = 0;
export function uid(prefix = "n") {
  _uidCounter += 1;
  return `${prefix}_${Date.now().toString(36).slice(-4)}${_uidCounter.toString(36)}`;
}

/** Generate a node id from a seed that is unique within `taken` (a Set or object of ids). */
export function uniqueId(seed, taken) {
  const has = (k) => (taken instanceof Set ? taken.has(k) : Object.prototype.hasOwnProperty.call(taken, k));
  let base = slugify(seed).slice(0, 24);
  if (!has(base)) return base;
  let i = 2;
  while (has(`${base}_${i}`)) i += 1;
  return `${base}_${i}`;
}

let _toastTimer;
export function toast(msg, kind = "") {
  const t = document.getElementById("toast");
  if (!t) return;
  t.textContent = msg;
  t.className = "toast" + (kind ? " " + kind : "");
  t.hidden = false;
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { t.hidden = true; }, kind === "err" ? 4500 : 2600);
}

export function confirmAsync(message) {
  return Promise.resolve(window.confirm(message));
}

/** A labelled form field wrapping a control. */
export function field(labelText, control) {
  return el("label", { class: "field" }, [
    el("span", { class: "field-label", text: labelText }),
    control,
  ]);
}

/**
 * Bottom-sheet searchable picker.
 * opts: { title, items:[{id,label,sub}], onPick(id), specials:[{label,value,cls}], allowSearch }
 */
export function openPicker({ title, items = [], onPick, specials = [], allowSearch = true }) {
  const backdrop = el("div", { class: "modal-backdrop" });
  const list = el("div", { class: "modal-list" });
  const search = el("input", { type: "search", placeholder: "Search…", autocomplete: "off", autocapitalize: "none" });

  const close = () => { backdrop.remove(); document.removeEventListener("keydown", onKey); };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  const pick = (v) => { close(); onPick(v); };

  function render(filter = "") {
    clear(list);
    for (const sp of specials) {
      list.appendChild(el("div", { class: "modal-item special " + (sp.cls || ""), onclick: () => pick(sp.value) }, sp.label));
    }
    const f = filter.trim().toLowerCase();
    let shown = 0;
    for (const it of items) {
      const hay = `${it.label} ${it.sub || ""} ${it.id || ""}`.toLowerCase();
      if (f && !hay.includes(f)) continue;
      shown += 1;
      list.appendChild(el("div", { class: "modal-item", onclick: () => pick(it.id) }, [
        el("div", { text: it.label }),
        it.sub ? el("div", { class: "faint", style: "font-size:.74rem;font-family:ui-monospace,monospace", text: it.sub }) : null,
      ]));
    }
    if (!shown && !specials.length) list.appendChild(el("div", { class: "empty", text: "No matches" }));
  }

  const modal = el("div", { class: "modal" }, [
    el("div", { class: "modal-head" }, title || "Choose"),
    allowSearch ? el("div", { class: "modal-search" }, search) : null,
    list,
  ]);
  backdrop.appendChild(modal);
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
  search.addEventListener("input", () => render(search.value));
  document.addEventListener("keydown", onKey);
  document.body.appendChild(backdrop);
  render();
  if (allowSearch) setTimeout(() => search.focus(), 60);
  return close;
}

/** Trigger a file download of `text` (works in mobile browsers). */
export function downloadText(filename, text, type = "application/json") {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = el("a", { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 200);
}

/**
 * Bottom-sheet with a big textarea — for pasting JSON to import.
 * opts: { title, value, placeholder, submitLabel, onSubmit(text) -> false to keep open }
 */
export function openTextSheet({ title, value = "", placeholder = "", submitLabel = "Import", onSubmit }) {
  const backdrop = el("div", { class: "modal-backdrop" });
  const ta = el("textarea", { placeholder, spellcheck: "false", autocapitalize: "none", style: "width:100%;min-height:42vh;font-family:ui-monospace,monospace;font-size:.82rem" });
  ta.value = value;
  const close = () => backdrop.remove();
  const submit = el("button", { class: "btn primary", style: "width:100%" }, submitLabel);
  submit.addEventListener("click", async () => { const r = await onSubmit(ta.value); if (r !== false) close(); });
  const modal = el("div", { class: "modal", style: "padding:12px 12px 16px" }, [
    el("div", { class: "modal-head", style: "padding-left:2px" }, title || "Paste"),
    ta,
    el("div", { style: "height:8px" }),
    submit,
    el("button", { class: "btn ghost", style: "width:100%;margin-top:8px", onclick: close }, "Cancel"),
  ]);
  backdrop.appendChild(modal);
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
  document.body.appendChild(backdrop);
  setTimeout(() => ta.focus(), 60);
  return close;
}
