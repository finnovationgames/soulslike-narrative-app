// app.js — controller: boot, routing, header, data loading, settings.
import { store } from "./store.js";
import { gh, createGitHub } from "./github.js";
import { el, clear, field, toast } from "./util.js";
import { renderDialogueList, renderDialogueEditor } from "./dialogue.js";
import { renderMap } from "./map.js";
import { renderTree } from "./tree.js";
import { renderQuestList, renderQuestEditor, reloadQuests } from "./quests.js";
import { renderDocs, renderDocEditor } from "./docs.js";

let guard = null;
let headerBack = null;
let currentRoute = "#/";
let suppressHash = false;

const ctx = {
  main: document.getElementById("view"),
  store,
  gh,
  ghVault: createGitHub(() => store.vaultCfg()),
  get isDemo() { return store.settings.demo; },
  setHeader,
  setGuard: (fn) => { guard = fn; },
  clearGuard: () => { guard = null; },
  go,
  pendingScrollNode: null,
  docsPath: "",
  docFilePath: null,
  reloadAll: () => loadData(store.mode()),
};

// ── boot ──────────────────────────────────────────────────────
boot();

async function boot() {
  store.load();
  registerSW();

  document.getElementById("btn-back").addEventListener("click", () => {
    if (headerBack) go(typeof headerBack === "string" ? headerBack : "#/");
  });
  window.addEventListener("hashchange", () => onHashChange());
  window.addEventListener("beforeunload", (e) => {
    if (guard && guard()) { e.preventDefault(); e.returnValue = ""; }
  });

  if (store.mode() === "unconfigured") { currentRoute = "#/settings"; renderSettings(); return; }

  await loadData(store.mode());
  currentRoute = location.hash || "#/";
  route(currentRoute);
}

function registerSW() {
  if (!("serviceWorker" in navigator)) return;
  if (location.protocol === "file:") return; // SW needs http(s)
  navigator.serviceWorker.register("./sw.js").catch(() => { /* non-fatal */ });
}

// ── routing ───────────────────────────────────────────────────
function go(hash) {
  hash = hash || "#/";
  if ((location.hash || "#/") === hash) { guard = null; currentRoute = hash; route(hash); }
  else location.hash = hash;
}

function onHashChange() {
  if (suppressHash) { suppressHash = false; return; }
  const next = location.hash || "#/";
  if (guard && guard()) {
    if (!window.confirm("You have unsaved changes. Leave without saving?")) {
      suppressHash = true;
      location.hash = currentRoute;
      return;
    }
  }
  guard = null;
  currentRoute = next;
  route(next);
}

function route(hash) {
  if (store.mode() === "unconfigured") return renderSettings();
  const parts = (hash || "#/").replace(/^#\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
  window.scrollTo(0, 0);
  try {
    if (!parts.length) return renderHome("dialogues");
    if (parts[0] === "settings") return renderSettings();
    if (parts[0] === "q" && parts.length === 1) return renderHome("quests");
    if (parts[0] === "q") return renderQuestEditor(ctx, parts[1]);
    if (parts[0] === "docs") return renderHome("docs");
    if (parts[0] === "docfile") return renderDocEditor(ctx, ctx.docFilePath);
    if (parts[0] === "d" && parts[2] === "map") return renderMap(ctx, parts[1]);
    if (parts[0] === "d" && parts[2] === "tree") return renderTree(ctx, parts[1]);
    if (parts[0] === "d") return renderDialogueEditor(ctx, parts[1]);
    return renderHome("dialogues");
  } catch (e) {
    console.error(e);
    clear(ctx.main).appendChild(el("div", { class: "warn-banner" }, "Something went wrong: " + (e.message || e)));
  }
}

// ── header ────────────────────────────────────────────────────
function setHeader({ title = "", sub = "", back = null, actions = [] }) {
  document.getElementById("topbar-title").textContent = title;
  document.getElementById("topbar-sub").textContent = sub || "";
  headerBack = back;
  document.getElementById("btn-back").hidden = !back;
  const host = clear(document.getElementById("topbar-actions"));
  for (const a of actions) {
    if (!a) continue;
    const iconOnly = a.icon && !a.label;
    const b = el("button", {
      class: iconOnly ? "icon-btn" : "btn " + (a.kind || "ghost small"),
      onclick: a.onClick,
      disabled: a.disabled,
    });
    b.textContent = a.label || a.icon || "";
    host.appendChild(b);
  }
}

// ── data loading ──────────────────────────────────────────────
async function loadData(mode) {
  renderLoading(mode === "demo" ? "Loading sample content…" : "Loading from GitHub…");
  try {
    if (mode === "demo") await loadDemo();
    else await loadGitHub();
    return true;
  } catch (e) {
    if (store.cacheLoad()) {
      toast("Offline — showing your last synced copy (" + store.cacheAgeText() + ")", "err");
      return true;
    }
    renderLoadError(e);
    return false;
  }
}

async function loadGitHub() {
  const entries = await gh.listDir(store.dialoguesDir());
  store.dialogueIndex = [];
  store.trees = new Map();
  const files = entries.filter((e) => e.type === "file" && e.name.endsWith(".json"));
  for (const e of files) {
    const f = await gh.getFile(e.path);
    if (!f || !f.json) continue;
    const tree = f.json;
    const id = tree.id || e.name.replace(/\.json$/, "");
    store.dialogueIndex.push({ id, name: tree.name || id, path: e.path, sha: f.sha });
    store.trees.set(id, { sha: f.sha, tree });
  }
  store.dialogueIndex.sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));

  const qf = await gh.getFile(store.questsPath());
  store.quests = { sha: qf ? qf.sha : null, list: qf && Array.isArray(qf.json) ? qf.json : [], path: store.questsPath() };

  try {
    const cf = await gh.getFile(store.castPath());
    store.cast = { sha: cf ? cf.sha : null, list: cf && Array.isArray(cf.json) ? cf.json : [] };
  } catch (_) { store.cast = { sha: null, list: [] }; }

  store.loadedAt = Date.now();
  store.cacheSave();
}

async function loadDemo() {
  const idx = await (await fetch("./sample-data/index.json")).json();
  store.dialogueIndex = [];
  store.trees = new Map();
  for (const name of idx.dialogues) {
    const tree = await (await fetch("./sample-data/" + name)).json();
    const id = tree.id || name.replace(/\.json$/, "");
    store.dialogueIndex.push({ id, name: tree.name || id, path: name, sha: null });
    store.trees.set(id, { sha: null, tree });
  }
  store.dialogueIndex.sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));
  try {
    const q = await (await fetch("./sample-data/custom_quests.json")).json();
    store.quests = { sha: null, list: Array.isArray(q) ? q : [], path: "custom_quests.json" };
  } catch (_) { store.quests = { sha: null, list: [], path: "custom_quests.json" }; }
  store.loadedAt = Date.now();
}

// ── views: home ───────────────────────────────────────────────
function renderHome(tab) {
  const repo = store.settings.demo ? "Demo mode" : `${store.settings.owner}/${store.settings.repo}`;
  const age = store.cacheAgeText();
  setHeader({
    title: "Narrative Forge",
    sub: repo + (age ? " · synced " + age : ""),
    back: false,
    actions: [
      { icon: "⟳", onClick: async () => { const ok = await loadData(store.mode()); if (ok) go(tab === "quests" ? "#/q" : tab === "docs" ? "#/docs" : "#/"); } },
      { icon: "⚙", onClick: () => go("#/settings") },
    ],
  });
  const body = clear(ctx.main);
  const content = el("div");
  const tabs = [
    tabBtn("Dialogues", tab === "dialogues", () => { go("#/"); }),
    tabBtn("Quests", tab === "quests", () => { go("#/q"); }),
  ];
  if (store.vaultConfigured()) tabs.push(tabBtn("Docs", tab === "docs", () => { go("#/docs"); }));
  body.appendChild(el("div", { class: "tabbar" }, tabs));
  body.appendChild(content);
  if (tab === "quests") renderQuestList(ctx, content);
  else if (tab === "docs") renderDocs(ctx, content);
  else renderDialogueList(ctx, content);
}

function tabBtn(label, active, onClick) {
  return el("button", { class: "tab" + (active ? " active" : ""), onclick: onClick }, label);
}

// ── views: loading / error ────────────────────────────────────
function renderLoading(msg) {
  setHeader({ title: "Narrative Forge", sub: "", back: false, actions: [] });
  clear(ctx.main).appendChild(el("div", { class: "empty" }, [
    el("div", { class: "logo", style: "font-size:2rem", text: "⛓" }),
    el("div", { style: "margin-top:10px", text: msg || "Loading…" }),
  ]));
}

function renderLoadError(e) {
  setHeader({ title: "Narrative Forge", sub: "", back: false, actions: [{ icon: "⚙", onClick: () => go("#/settings") }] });
  clear(ctx.main).appendChild(el("div", {}, [
    el("div", { class: "warn-banner" }, "Couldn't load: " + (e.message || e)),
    el("button", { class: "btn primary", style: "width:100%;margin-top:8px", onclick: () => loadData(store.mode()).then((ok) => ok && go("#/")) }, "Retry"),
    el("button", { class: "btn ghost", style: "width:100%;margin-top:8px", onclick: () => go("#/settings") }, "Open settings"),
  ]));
}

// ── views: settings / welcome ─────────────────────────────────
function renderSettings() {
  const s = store.settings;
  const configured = store.mode() !== "unconfigured";
  setHeader({ title: "Settings", sub: "", back: configured ? "#/" : false, actions: [] });
  const body = clear(ctx.main);

  if (!configured) {
    body.appendChild(el("div", { class: "hero" }, [
      el("div", { class: "logo", text: "⛓" }),
      el("h1", { text: "Narrative Forge" }),
      el("div", { class: "hint", text: "Write dialogue trees & browse quests on the go. Edits commit to your private GitHub repo." }),
    ]));
  }

  const token = el("input", { type: "password", value: s.token, placeholder: "github_pat_…", autocomplete: "off", autocapitalize: "none", spellcheck: "false" });
  const owner = el("input", { value: s.owner, placeholder: "your-github-username", autocapitalize: "none", spellcheck: "false" });
  const repo = el("input", { value: s.repo, placeholder: "soulslike-narrative", autocapitalize: "none", spellcheck: "false" });
  const branch = el("input", { value: s.branch || "main", placeholder: "main", autocapitalize: "none", spellcheck: "false" });
  const prefix = el("input", { value: s.prefix || "", placeholder: "(empty = repo root)", autocapitalize: "none", spellcheck: "false" });
  const vaultRepo = el("input", { value: s.vaultRepo || "", placeholder: "soulslike-vault (optional)", autocapitalize: "none", spellcheck: "false" });
  const vaultBranch = el("input", { value: s.vaultBranch || "main", placeholder: "main", autocapitalize: "none", spellcheck: "false" });

  body.appendChild(field("GitHub token (fine-grained PAT)", token));
  body.appendChild(field("Owner (username/org)", owner));
  body.appendChild(field("Repository name", repo));

  const adv = el("details", {}, [
    el("summary", {}, "Advanced"),
    field("Branch", branch),
    field("Path prefix in repo", prefix),
    el("div", { class: "section-title", style: "margin-top:10px" }, "Design vault (Docs tab) — optional"),
    field("Vault repo name", vaultRepo),
    field("Vault branch", vaultBranch),
  ]);
  body.appendChild(adv);

  const connect = el("button", { class: "btn primary", style: "width:100%;margin-top:6px" }, "Connect & load");
  connect.addEventListener("click", async () => {
    if (!token.value.trim() || !owner.value.trim() || !repo.value.trim()) { toast("Fill in token, owner and repo.", "err"); return; }
    store.saveSettings({ token: token.value.trim(), owner: owner.value.trim(), repo: repo.value.trim(), branch: (branch.value.trim() || "main"), prefix: prefix.value.trim(), vaultRepo: vaultRepo.value.trim(), vaultBranch: (vaultBranch.value.trim() || "main"), demo: false });
    connect.disabled = true; connect.textContent = "Connecting…";
    try { await gh.verify(); }
    catch (e) { toast(e.message || "Connection failed", "err"); connect.disabled = false; connect.textContent = "Connect & load"; return; }
    const ok = await loadData("github");
    if (ok) go("#/");
  });
  body.appendChild(connect);

  const demo = el("button", { class: "btn ghost", style: "width:100%;margin-top:8px" }, "Try demo (no account, read/write local only)");
  demo.addEventListener("click", async () => {
    store.saveSettings({ demo: true });
    const ok = await loadData("demo");
    if (ok) go("#/");
  });
  body.appendChild(demo);

  if (configured) {
    body.appendChild(el("hr", { class: "sep" }));
    body.appendChild(el("div", { class: "muted", style: "font-size:.85rem" },
      s.demo ? "Demo mode — changes are not saved to GitHub." : `Connected to ${s.owner}/${s.repo} (${s.branch}). Last synced ${store.cacheAgeText() || "—"}.`));
    const reload = el("button", { class: "btn", style: "width:100%;margin-top:8px" }, "Reload from GitHub");
    reload.addEventListener("click", async () => { const ok = await loadData(store.mode()); if (ok) go("#/"); });
    if (!s.demo) body.appendChild(reload);
    const disc = el("button", { class: "btn danger", style: "width:100%;margin-top:8px" }, "Disconnect & forget token");
    disc.addEventListener("click", () => { if (window.confirm("Remove the token and cached data from this device?")) { store.reset(); renderSettings(); } });
    body.appendChild(disc);
  }

  body.appendChild(el("hr", { class: "sep" }));
  body.appendChild(el("div", { class: "hint" }, [
    "Need a token? Create a fine-grained PAT scoped to just your narrative repo with ",
    el("strong", { text: "Contents: Read & Write" }), ", then paste it above. ",
    el("a", { href: "https://github.com/settings/tokens?type=beta", target: "_blank", rel: "noopener", style: "color:var(--accent-2)" }, "Open GitHub token settings ↗"),
    el("div", { style: "margin-top:6px" }, "Full walkthrough is in SETUP.md in the app folder."),
  ]));
}
