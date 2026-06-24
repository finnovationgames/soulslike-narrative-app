// docs.js — Obsidian-vault browser + markdown editor (second GitHub repo).
import { el, clear, toast, debounce } from "./util.js";
import { ConflictError } from "./github.js";

// ── demo vault (used in demo mode so the Docs UI is testable without a repo) ──
const DEMO_DIRS = {
  "": [["Narrative", "dir"], ["Quests", "dir"], ["GameDesign", "dir"], ["playtest.md", "file"]],
  "Narrative": [["Character Cast.md", "file"], ["WorldandNarrative.md", "file"]],
  "Quests": [["Quest Seeds (15 Ideas).md", "file"], ["Quests Deepmark", "dir"]],
  "Quests/Quests Deepmark": [["Black and Blinding.md", "file"]],
  "GameDesign": [["CombatMechanics.md", "file"]],
};
const DEMO_FILES = {
  "playtest.md": "# Playtest notes\n\n- Deepmark intro reads well.\n- Quartz-Mother fight needs a telegraph.\n\n> Remember to wire the *crystal mining* loop.\n",
  "Narrative/Character Cast.md": "# Character Cast\n\n**Maren** — scholar of the guild; curious, principled.\n\n**Florian** — heir to [[Bouquet]]; bright, a little vain.\n\n## Duergar\n- Kopmter Coffer — head of the Coffer family.\n",
  "Narrative/WorldandNarrative.md": "# World & Narrative\n\nThe **Deepmark** is a real under-layer now. Heat/cold stealth matters both above and below.\n\n1. Surface expeditions\n2. The descent\n3. The Quartz-Mother\n",
  "Quests/Quest Seeds (15 Ideas).md": "# Quest Seeds (15 ideas)\n\n1. **Black and Blinding** — silence the Deepmark or kill the Quartz-Mother.\n2. The Cold Light — a lantern that hides you from heat-sensers.\n3. ...\n\nSee the worked one: [[quest:bb_clear_the_deepmark]]\n",
  "Quests/Quests Deepmark/Black and Blinding.md": "# Black and Blinding\n\n**Giver:** Maren — quest: [[quest:bb_clear_the_deepmark]]\n\nDialogues: [[dialogue:deepmark_duergars_maren]] · [[dialogue:deepmark_duergars_florian]]\n\n## Branches\n\n| Branch | Flag | Outcome |\n| --- | --- | --- |\n| Parley | bb_has_pickaxe | mine crystals |\n| Hunt | bb_seek_captain | kill Quartz-Mother |\n| Relocate | bb_relocate_plan | move the nest |\n\n## TODO\n- [x] Write Maren parley\n- [x] Write Florian parley\n- [ ] Wire the ambush ending\n",
  "GameDesign/CombatMechanics.md": "# Combat Mechanics\n\nStamina gates actions. Poise breaks open ripostes.\n\n```\ndamage = base * (1 - defense/100)\n```\n",
};

// ── data accessors (demo vs vault repo) ──────────────────────
async function vlist(ctx, path) {
  if (ctx.isDemo) {
    return (DEMO_DIRS[path] || []).map(([name, type]) => ({ name, path: path ? `${path}/${name}` : name, type, sha: null }));
  }
  return ctx.ghVault.listDir(path);
}
async function vget(ctx, path) {
  if (ctx.isDemo) return { sha: null, text: DEMO_FILES[path] != null ? DEMO_FILES[path] : "" };
  const f = await ctx.ghVault.getFile(path);
  return f ? { sha: f.sha, text: f.text } : { sha: null, text: "" };
}
async function vput(ctx, path, text, sha, msg) {
  if (ctx.isDemo) { DEMO_FILES[path] = text; return null; }
  return ctx.ghVault.putFile(path, text, sha, msg);
}

// ── Docs tab: search box + folder browser ────────────────────
export function renderDocs(ctx, mount) {
  const m = clear(mount);
  const search = el("input", {
    type: "search", placeholder: "🔍 Search the whole vault…",
    autocapitalize: "none", spellcheck: "false", style: "margin-bottom:10px",
  });
  search.value = ctx.docsQuery || "";
  m.appendChild(search);
  const body = el("div");
  m.appendChild(body);

  const renderBody = () => {
    ctx.docsQuery = search.value;
    const q = search.value.trim();
    if (q) renderSearchResults(ctx, body, q);
    else renderFolder(ctx, body);
  };
  search.addEventListener("input", debounce(renderBody, 250));
  renderBody();
}

async function renderFolder(ctx, host) {
  const path = ctx.docsPath || "";
  const m = clear(host);

  const crumbs = el("div", { class: "row wrap", style: "gap:4px;margin-bottom:10px;font-size:.86rem" });
  const go = (p) => { ctx.docsPath = p; renderFolder(ctx, host); };
  crumbs.appendChild(el("a", { class: "crumb", onclick: () => go("") }, "🏷 vault"));
  let acc = "";
  for (const seg of (path ? path.split("/") : [])) {
    acc = acc ? `${acc}/${seg}` : seg;
    const here = acc;
    crumbs.appendChild(el("span", { class: "faint", text: "/" }));
    crumbs.appendChild(el("a", { class: "crumb", onclick: () => go(here) }, seg));
  }
  m.appendChild(crumbs);

  m.appendChild(el("button", {
    class: "btn ghost", style: "width:100%;border-style:dashed;margin-bottom:10px",
    onclick: () => newNote(ctx, path),
  }, "＋  New note here"));

  const listHost = el("div");
  m.appendChild(listHost);
  listHost.appendChild(el("div", { class: "empty" }, "Loading…"));

  try {
    const entries = await vlist(ctx, path);
    if ((ctx.docsPath || "") !== path) return; // navigated away while loading
    clear(listHost);
    entries.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1));
    if (!entries.length) { listHost.appendChild(el("div", { class: "empty" }, "Empty folder.")); return; }
    for (const e of entries) {
      if (e.type === "dir") {
        listHost.appendChild(el("div", { class: "list-row", onclick: () => go(e.path) }, [
          el("span", { style: "font-size:1.2rem" }, "📁"),
          el("div", { class: "grow card-title", text: e.name }),
          el("div", { class: "chevron", text: "›" }),
        ]));
      } else if (e.name.toLowerCase().endsWith(".md")) {
        listHost.appendChild(el("div", { class: "list-row", onclick: () => openDoc(ctx, e.path) }, [
          el("span", { style: "font-size:1.1rem" }, "📄"),
          el("div", { class: "grow card-title", text: e.name.replace(/\.md$/i, "") }),
          el("div", { class: "chevron", text: "›" }),
        ]));
      } else {
        listHost.appendChild(el("div", { class: "list-row", style: "opacity:.6", onclick: () => toast("Binary/non-markdown file — edit on desktop.") }, [
          el("span", { style: "font-size:1.1rem" }, "📎"),
          el("div", { class: "grow card-title", text: e.name }),
        ]));
      }
    }
  } catch (err) {
    clear(listHost);
    listHost.appendChild(el("div", { class: "warn-banner" }, "Couldn't load folder: " + (err.message || err)));
  }
}

function openDoc(ctx, path) { ctx.docFilePath = path; ctx.go("#/docfile"); }

// ── vault-wide search ────────────────────────────────────────
const vaultCache = { repo: "", files: new Map() /* path -> {sha,text} */, indexedAll: false };
function cacheKey(ctx) { return ctx.isDemo ? "demo" : `${ctx.store.settings.owner}/${ctx.store.settings.vaultRepo}`; }
function ensureCacheRepo(ctx) { const k = cacheKey(ctx); if (vaultCache.repo !== k) { vaultCache.repo = k; vaultCache.files = new Map(); vaultCache.indexedAll = false; } }

async function allMdFiles(ctx) {
  if (ctx.isDemo) return Object.keys(DEMO_FILES).map((p) => ({ path: p, sha: null }));
  try {
    const tree = await ctx.ghVault.listTreeRecursive();
    if (tree.length) return tree.filter((n) => n.type === "blob" && /\.md$/i.test(n.path)).map((n) => ({ path: n.path, sha: n.sha }));
  } catch (_) { /* fall through to walk */ }
  // fallback: BFS via listDir
  const out = [];
  const stack = [""];
  while (stack.length) {
    const dir = stack.pop();
    const entries = await ctx.ghVault.listDir(dir);
    for (const e of entries) {
      if (e.type === "dir") stack.push(e.path);
      else if (/\.md$/i.test(e.name)) out.push({ path: e.path, sha: e.sha });
    }
  }
  return out;
}

async function getContent(ctx, path, sha) {
  ensureCacheRepo(ctx);
  const c = vaultCache.files.get(path);
  if (c && (sha == null || c.sha === sha)) return c.text;
  const f = await vget(ctx, path);
  vaultCache.files.set(path, { sha: f.sha, text: f.text });
  return f.text;
}

async function renderSearchResults(ctx, host, query) {
  ensureCacheRepo(ctx);
  const q = query.toLowerCase();
  const m = clear(host);
  m.appendChild(el("div", { class: "section-title" }, `Results for “${query}”`));
  const nameHost = el("div");
  const contentHost = el("div");
  m.appendChild(nameHost);
  m.appendChild(contentHost);
  nameHost.appendChild(el("div", { class: "empty" }, "Searching…"));

  let files;
  try { files = await allMdFiles(ctx); }
  catch (e) { clear(nameHost); nameHost.appendChild(el("div", { class: "warn-banner" }, "Couldn't list the vault: " + (e.message || e))); return; }
  if (ctx.docsQuery.trim().toLowerCase() !== q) return; // query changed while listing

  // filename / path matches (instant)
  clear(nameHost);
  const nameHits = files.filter((f) => f.path.toLowerCase().includes(q));
  nameHost.appendChild(el("div", { class: "field-label" }, `Note names (${nameHits.length})`));
  if (nameHits.length) for (const f of nameHits) nameHost.appendChild(resultRow(ctx, f.path, null));
  else nameHost.appendChild(el("div", { class: "faint", style: "font-size:.85rem;margin:2px 2px 6px" }, "No filename matches."));

  // content matches
  const indexed = ctx.isDemo || vaultCache.indexedAll;
  if (indexed) {
    await runContentSearch(ctx, contentHost, files, query, q);
  } else {
    const btn = el("button", { class: "btn ghost", style: "width:100%;margin-top:10px" }, `🔍 Search inside ${files.length} notes`);
    btn.addEventListener("click", async () => {
      btn.disabled = true; btn.textContent = "Reading notes…";
      await runContentSearch(ctx, contentHost, files, query, q, (d, t) => { btn.textContent = `Reading notes… ${d}/${t}`; });
      vaultCache.indexedAll = true;
      btn.remove();
    });
    contentHost.appendChild(btn);
  }
}

async function runContentSearch(ctx, host, files, query, q, onProgress) {
  clear(host);
  const head = el("div", { class: "field-label" }, "In note text…");
  host.appendChild(head);
  const hits = [];
  let idx = 0, done = 0;
  const worker = async () => {
    while (idx < files.length) {
      const f = files[idx++];
      try {
        const text = await getContent(ctx, f.path, f.sha);
        const pos = text.toLowerCase().indexOf(q);
        if (pos >= 0) hits.push({ path: f.path, snippet: snippetAround(text, pos, query) });
      } catch (_) { /* skip unreadable */ }
      done++;
      if (onProgress) onProgress(done, files.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, files.length) }, worker));
  if (ctx.docsQuery.trim().toLowerCase() !== q) return; // query changed during fetch
  head.textContent = `In note text (${hits.length})`;
  if (!hits.length) host.appendChild(el("div", { class: "faint", style: "font-size:.85rem;margin:2px 2px" }, "No content matches."));
  for (const h of hits) host.appendChild(resultRow(ctx, h.path, h.snippet));
}

function resultRow(ctx, path, snippetHtml) {
  const name = path.split("/").pop().replace(/\.md$/i, "");
  const folder = path.split("/").slice(0, -1).join("/");
  return el("div", { class: "list-row", style: "flex-direction:column;align-items:stretch;gap:3px", onclick: () => openDoc(ctx, path) }, [
    el("div", { class: "row" }, [
      el("span", { style: "font-size:1.05rem" }, "📄"),
      el("div", { class: "grow card-title", text: name }),
      el("div", { class: "chevron", text: "›" }),
    ]),
    folder ? el("div", { class: "faint", style: "font-size:.74rem", text: folder }) : null,
    snippetHtml ? el("div", { class: "snippet", html: snippetHtml }) : null,
  ]);
}

function snippetAround(text, pos, query) {
  const start = Math.max(0, pos - 30), end = Math.min(text.length, pos + query.length + 50);
  const raw = (start > 0 ? "…" : "") + text.slice(start, end).replace(/\s+/g, " ").trim() + (end < text.length ? "…" : "");
  let s = raw.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const eq = query.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (eq) s = s.replace(new RegExp(eq, "ig"), (mm) => `<mark>${mm}</mark>`);
  return s;
}

async function newNote(ctx, folder) {
  let name = window.prompt("New note name:", "");
  if (name === null) return;
  name = name.trim();
  if (!name) return;
  if (!/\.md$/i.test(name)) name += ".md";
  const full = folder ? `${folder}/${name}` : name;
  const body = `# ${name.replace(/\.md$/i, "")}\n\n`;
  try {
    if (ctx.isDemo) {
      DEMO_FILES[full] = body;
      (DEMO_DIRS[folder] = DEMO_DIRS[folder] || []).push([name, "file"]);
    } else {
      await ctx.ghVault.putFile(full, body, null, `Create ${full}`);
    }
    ctx.docFilePath = full;
    ctx.go("#/docfile");
  } catch (e) { toast(e.message || "Couldn't create note", "err"); }
}

// ── markdown file editor (full view) ─────────────────────────
export async function renderDocEditor(ctx, path) {
  if (!path) {
    ctx.setHeader({ title: "Docs", back: "#/docs", actions: [] });
    clear(ctx.main).appendChild(el("div", { class: "empty" }, "Open a note from the Docs tab."));
    return;
  }
  const name = path.split("/").pop();
  ctx.docsPath = path.split("/").slice(0, -1).join("/"); // so Back returns to the right folder

  let text = "", sha = null, dirty = false, saving = false, mode = "preview";
  ctx.setHeader({ title: name, sub: "loading…", back: "#/docs", actions: [] });
  clear(ctx.main).appendChild(el("div", { class: "empty" }, "Loading…"));

  try {
    const f = await vget(ctx, path);
    text = f.text; sha = f.sha;
  } catch (e) {
    clear(ctx.main).appendChild(el("div", { class: "warn-banner" }, "Couldn't load: " + (e.message || e)));
    return;
  }

  ctx.setGuard(() => dirty);
  render();

  function header() {
    ctx.setHeader({
      title: name,
      sub: path + (dirty ? " · ● unsaved" : ""),
      back: "#/docs",
      actions: [
        { label: mode === "edit" ? "👁" : "✎", kind: "ghost small", onClick: () => { mode = mode === "edit" ? "preview" : "edit"; render(); } },
        { label: saving ? "Saving…" : (dirty ? "Save" : "Saved"), kind: dirty ? "primary small" : "ghost small", disabled: !dirty || saving, onClick: doSave },
      ],
    });
  }

  function render() {
    header();
    const m = clear(ctx.main);
    if (mode === "edit") {
      const ta = el("textarea", { class: "doc-editor", spellcheck: "false", autocapitalize: "sentences" });
      ta.value = text;
      ta.addEventListener("input", () => { text = ta.value; if (!dirty) { dirty = true; header(); } });
      m.appendChild(ta);
    } else {
      const prev = el("div", { class: "md-preview" });
      prev.innerHTML = mdToHtml(text, makeResolver(ctx));
      wireNavLinks(ctx, prev);
      m.appendChild(prev);
    }
  }

  async function doSave() {
    if (!dirty || saving) return;
    saving = true; header();
    try {
      const ns = await vput(ctx, path, text, sha, `Edit ${path}`);
      if (ns) sha = ns;
      dirty = false;
      toast(ctx.isDemo ? "Saved locally (demo)" : "Saved to GitHub ✓", "ok");
    } catch (e) {
      if (e instanceof ConflictError) {
        if (window.confirm("This note changed on GitHub since you opened it.\n\nOK = reload latest (lose your edits)\nCancel = keep editing")) {
          const f = await vget(ctx, path);
          text = f.text; sha = f.sha; dirty = false; render();
          toast("Reloaded latest", "ok");
        }
      } else toast(e.message || "Save failed", "err");
    } finally { saving = false; header(); }
  }
}

// ── cross-link resolver: [[quest:id]] / [[dialogue:id]] / [[Name]] -> in-app nav ──
function makeResolver(ctx) {
  return (name) => {
    const raw = String(name).trim();
    const low = raw.toLowerCase();
    let m;
    if ((m = raw.match(/^dialogue:(.+)$/i))) { const id = m[1].trim(); const d = (ctx.store.dialogueIndex || []).find((x) => x.id === id); return { kind: "d", id, label: d ? (d.name || id) : id }; }
    if ((m = raw.match(/^quest:(.+)$/i))) { const qid = m[1].trim(); const q = (ctx.store.quests.list || []).find((x) => (x.id || "") === qid || (x.name || "").toLowerCase() === qid.toLowerCase()); return { kind: "q", id: q ? q.id : qid, label: q ? (q.name || q.id) : qid }; }
    for (const d of ctx.store.dialogueIndex || []) if (d.id.toLowerCase() === low || (d.name || "").toLowerCase() === low) return { kind: "d", id: d.id, label: d.name || d.id };
    for (const q of ctx.store.quests.list || []) if ((q.id || "").toLowerCase() === low || (q.name || "").toLowerCase() === low) return { kind: "q", id: q.id, label: q.name || q.id };
    return null;
  };
}

function wireNavLinks(ctx, container) {
  container.querySelectorAll("a.navlink").forEach((a) => {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      const nav = a.dataset.nav || "";
      const i = nav.indexOf(":");
      const kind = nav.slice(0, i), id = nav.slice(i + 1);
      if (kind === "d") {
        if (ctx.store.trees.has(id)) ctx.go(`#/d/${encodeURIComponent(id)}`);
        else toast(`Dialogue "${id}" isn't in the repo yet.`, "err");
      } else if (kind === "q") {
        const qi = (ctx.store.quests.list || []).findIndex((q) => q.id === id);
        if (qi >= 0) ctx.go(`#/q/${qi}`);
        else toast(`Quest "${id}" isn't in the repo yet.`, "err");
      }
    });
  });
}

// ── markdown -> HTML (preview); defensive, escapes first ─────
function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function splitRow(line) { return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((s) => s.trim()); }

// Plain-ASCII sentinel (no markdown chars, never appears in real text) used to stash
// generated HTML so the bold/italic pass below can't mangle ids inside links.
const TK = "ZZTOKENZZ";

function inline(s, resolve) {
  let t = esc(s);
  const tokens = [];
  const stash = (html) => { tokens.push(html); return TK + (tokens.length - 1) + TK; };
  t = t.replace(/`([^`]+)`/g, (_, c) => stash(`<code>${c}</code>`));
  t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, () => stash("<em>[image]</em>"));
  t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, txt, url) => stash(`<a href="${esc(url)}" target="_blank" rel="noopener">${txt}</a>`));
  t = t.replace(/\[\[([^\]]+)\]\]/g, (_, w) => {
    const r = resolve ? resolve(w) : null;
    if (r) return stash(`<a class="navlink ${r.kind}" data-nav="${r.kind}:${esc(r.id)}">${r.kind === "q" ? "◆" : "▶"} ${esc(r.label)}</a>`);
    return stash(`<span class="wikilink">${w}</span>`);
  });
  t = t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  t = t.replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
  t = t.replace(/(^|[^_])_([^_]+)_/g, "$1<em>$2</em>");
  t = t.replace(new RegExp(TK + "(\\d+)" + TK, "g"), (_, i) => tokens[Number(i)]);
  return t;
}

function mdToHtml(md, resolve) {
  const out = [];
  const segments = String(md).split(/```/);
  segments.forEach((seg, si) => {
    if (si % 2 === 1) { out.push(`<pre><code>${esc(seg.replace(/^\n/, ""))}</code></pre>`); return; }
    const lines = seg.split("\n");
    let listType = null;
    const closeList = () => { if (listType) { out.push(`</${listType}>`); listType = null; } };
    let para = [];
    const flushPara = () => { if (para.length) { out.push(`<p>${inline(para.join(" "), resolve)}</p>`); para = []; } };
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].replace(/\s+$/, "");
      if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /-/.test(lines[i + 1]) && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1])) {
        flushPara(); closeList();
        const header = splitRow(line);
        i += 2;
        const rows = [];
        while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { rows.push(splitRow(lines[i])); i++; }
        i--;
        let tbl = "<table><thead><tr>" + header.map((h) => `<th>${inline(h, resolve)}</th>`).join("") + "</tr></thead><tbody>";
        for (const r of rows) tbl += "<tr>" + r.map((c) => `<td>${inline(c, resolve)}</td>`).join("") + "</tr>";
        out.push(tbl + "</tbody></table>");
        continue;
      }
      const h = line.match(/^(#{1,6})\s+(.*)$/);
      const task = line.match(/^\s*[-*]\s+\[([ xX])\]\s+(.*)$/);
      const ul = line.match(/^\s*[-*]\s+(.*)$/);
      const ol = line.match(/^\s*\d+\.\s+(.*)$/);
      const bq = line.match(/^>\s?(.*)$/);
      if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) { flushPara(); closeList(); out.push("<hr>"); }
      else if (h) { flushPara(); closeList(); out.push(`<h${h[1].length}>${inline(h[2], resolve)}</h${h[1].length}>`); }
      else if (task) { flushPara(); if (listType !== "ul") { closeList(); out.push('<ul class="tasks">'); listType = "ul"; } out.push(`<li class="task"><span class="chk">${task[1].toLowerCase() === "x" ? "☑" : "☐"}</span> ${inline(task[2], resolve)}</li>`); }
      else if (ul) { flushPara(); if (listType !== "ul") { closeList(); out.push("<ul>"); listType = "ul"; } out.push(`<li>${inline(ul[1], resolve)}</li>`); }
      else if (ol) { flushPara(); if (listType !== "ol") { closeList(); out.push("<ol>"); listType = "ol"; } out.push(`<li>${inline(ol[1], resolve)}</li>`); }
      else if (bq) { flushPara(); closeList(); out.push(`<blockquote>${inline(bq[1], resolve)}</blockquote>`); }
      else if (line.trim() === "") { flushPara(); closeList(); }
      else para.push(line);
    }
    flushPara(); closeList();
  });
  return out.join("\n");
}
