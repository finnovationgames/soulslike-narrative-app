// dialogue.js — dialogue tree list + outline editor (lossless round-trip).
import {
  el, append, clear, field, openPicker, toast, clone, uniqueId, slugify,
  toGodotJson, debounce, downloadText, openTextSheet,
} from "./util.js";
import { ConflictError } from "./github.js";
import { validateTree } from "./validate.js";
import { REGIONS, STATUSES, STATUS_BADGE } from "./quests.js";

const MANAGED = new Set(["speaker", "text", "next_node", "choices", "note", "emotion"]);
const ADV_NUM = new Set(["timer", "timeout_choice"]);
// The 12 game emotions (neutral = default/unset). Sets node.emotion → picks the portrait.
const EMOTIONS = ["happy", "sad", "angry", "afraid", "disgusted", "surprised", "crying", "determined", "smug", "hurt", "thoughtful"];
const ADV_KEYS = ["condition", "timer", "timeout_choice", "requires_trait", "skip_to"];

// ── List view ────────────────────────────────────────────────
export function renderDialogueList(ctx, mount) {
  const m = clear(mount);
  m.appendChild(el("div", { class: "row", style: "gap:8px;margin-bottom:10px" }, [
    el("button", { class: "btn ghost grow", style: "border-style:dashed", onclick: () => createNewTree(ctx) }, "＋ New tree"),
    el("button", { class: "btn ghost", onclick: () => importTree(ctx) }, "⬆ Import"),
  ]));

  const idx = ctx.store.dialogueIndex;
  if (!idx.length) {
    m.appendChild(el("div", { class: "empty" }, "No dialogue trees yet. Tap ＋ to write one."));
    return;
  }

  const search = el("input", { type: "search", placeholder: "🔍 Filter by name, region, NPC, status, tag…", autocapitalize: "none", spellcheck: "false", style: "margin-bottom:10px" });
  search.value = ctx.dlgFilter || "";
  m.appendChild(search);
  const listHost = el("div");
  m.appendChild(listHost);

  const draw = () => {
    ctx.dlgFilter = search.value;
    const f = search.value.trim().toLowerCase();
    clear(listHost);
    let shown = 0;
    for (const d of idx) {
      const rec = ctx.store.trees.get(d.id);
      const tree = rec ? rec.tree : {};
      if (f && !dlgHaystack(d, tree).includes(f)) continue;
      shown++;
      const n = rec ? Object.keys(tree.nodes || {}).length : null;
      const badges = [];
      if (tree.region) badges.push(el("span", { class: "badge blue" }, tree.region));
      if (tree.status) badges.push(el("span", { class: "badge " + (STATUS_BADGE[tree.status] || "") }, tree.status));
      listHost.appendChild(el("div", { class: "list-row", onclick: () => ctx.go(`#/d/${encodeURIComponent(d.id)}`) }, [
        el("div", { class: "grow" }, [
          el("div", { class: "card-title", text: d.name || d.id }),
          el("div", { class: "card-meta", text: d.id + (n != null ? ` · ${n} nodes` : "") }),
        ]),
        el("div", { class: "row", style: "gap:4px;flex-wrap:wrap;justify-content:flex-end;max-width:42%" }, badges),
        el("div", { class: "chevron", text: "›" }),
      ]));
    }
    if (!shown) listHost.appendChild(el("div", { class: "empty" }, `No trees match “${search.value}”.`));
  };
  search.addEventListener("input", debounce(draw, 150));
  draw();
}

function dlgHaystack(d, tree) {
  return [d.id, d.name, tree.region, tree.status, (tree.npcs || []).join(" "), (tree.tags || []).join(" "), tree.notes]
    .filter(Boolean).join(" ").toLowerCase();
}

async function createNewTree(ctx) {
  const name = window.prompt("Name for the new dialogue tree:", "");
  if (name === null) return;
  const taken = new Set(ctx.store.dialogueIndex.map((d) => d.id));
  const id = uniqueId(slugify(name) || "dialogue", taken);
  const tree = { id, name: (name.trim() || id), start_node: "intro", nodes: { intro: { speaker: "", text: "" } } };
  try {
    let sha = null;
    if (!ctx.isDemo) {
      sha = await ctx.gh.putFile(ctx.store.dialoguePath(id), toGodotJson(tree), null, `Create dialogue: ${id}`);
    }
    ctx.store.dialogueIndex.push({ id, name: tree.name, path: ctx.store.dialoguePath(id), sha });
    ctx.store.dialogueIndex.sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));
    ctx.store.trees.set(id, { sha, tree });
    ctx.store.cacheSave();
    ctx.go(`#/d/${encodeURIComponent(id)}`);
  } catch (e) {
    toast(e.message || "Could not create tree", "err");
  }
}

// Paste a dialogue tree JSON (e.g. a data/dialogues/<id>.json authored elsewhere) and
// save it into the repo — easy way to include trees added without the app.
function importTree(ctx) {
  openTextSheet({
    title: "Import dialogue JSON",
    placeholder: 'Paste a tree  {"id":"…","start_node":"…","nodes":{…}}',
    submitLabel: "Import & save",
    onSubmit: async (txt) => {
      let tree;
      try { tree = JSON.parse(txt); } catch (_) { toast("That isn't valid JSON.", "err"); return false; }
      if (!tree || typeof tree !== "object" || !tree.nodes || typeof tree.nodes !== "object") { toast("Expected a tree with a `nodes` object.", "err"); return false; }
      const taken = new Set(ctx.store.dialogueIndex.map((d) => d.id));
      if (!tree.id) tree.id = uniqueId(slugify(tree.name || "dialogue"), taken);
      const exists = taken.has(tree.id);
      if (exists && !window.confirm(`A tree "${tree.id}" already exists. Replace it?`)) return false;
      try {
        let sha = null;
        if (!ctx.isDemo) {
          const cur = exists ? await ctx.gh.getFile(ctx.store.dialoguePath(tree.id)) : null;
          sha = await ctx.gh.putFile(ctx.store.dialoguePath(tree.id), toGodotJson(tree), cur ? cur.sha : null, `Import dialogue: ${tree.id}`);
        }
        if (!exists) {
          ctx.store.dialogueIndex.push({ id: tree.id, name: tree.name || tree.id, path: ctx.store.dialoguePath(tree.id), sha });
          ctx.store.dialogueIndex.sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));
        }
        ctx.store.trees.set(tree.id, { sha, tree });
        ctx.store.cacheSave();
        ctx.go(`#/d/${encodeURIComponent(tree.id)}`);
      } catch (e) { toast(e.message || "Import failed", "err"); return false; }
    },
  });
}

// ── Editor view ──────────────────────────────────────────────
export function renderDialogueEditor(ctx, id) {
  const rec = ctx.store.trees.get(id);
  if (!rec) {
    ctx.setHeader({ title: "Not found", back: "#/", actions: [] });
    clear(ctx.main).appendChild(el("div", { class: "empty" }, "That tree isn't loaded. Go back and reopen."));
    return;
  }
  let tree = clone(rec.tree);
  if (!tree.nodes) tree.nodes = {};
  let sha = rec.sha;
  let dirty = false;
  let saving = false;
  const usesPos = Object.values(tree.nodes).some((n) => Array.isArray(n.pos));

  const body = clear(ctx.main);
  const warnHost = el("div");
  const nodesHost = el("div");
  body.appendChild(warnHost);
  body.appendChild(treeMetaCard());
  body.appendChild(el("div", { class: "section-title" }, "Nodes"));
  body.appendChild(nodesHost);
  body.appendChild(el("button", {
    class: "btn ghost", style: "width:100%;border-style:dashed;margin-top:4px",
    onclick: () => { const nid = addNode(""); renderNodes(); scrollToNode(nid); },
  }, "＋  Add node"));

  // ── header ─────────────────────────────────────────────────
  function renderHeader() {
    ctx.setHeader({
      title: tree.name || tree.id,
      sub: `${Object.keys(tree.nodes).length} nodes${dirty ? " · ● unsaved" : ""}`,
      back: "#/",
      actions: [
        { label: "🗺", kind: "ghost small", onClick: () => ctx.go(`#/d/${encodeURIComponent(id)}/map`) },
        { label: "⬇", kind: "ghost small", onClick: () => downloadText(`${id}.json`, toGodotJson(tree)) },
        { label: saving ? "Saving…" : (dirty ? "Save" : "Saved"), kind: dirty ? "primary small" : "ghost small", disabled: !dirty || saving, onClick: doSave },
      ],
    });
  }
  function markDirty() { if (!dirty) { dirty = true; renderHeader(); } else renderHeader(); revalidate(); }

  // ── tree metadata ──────────────────────────────────────────
  function treeMetaCard() {
    const setKey = (k, v) => { if (v && String(v).trim()) tree[k] = v; else delete tree[k]; };
    const card = el("div", { class: "card accent" });
    const nameIn = el("input", { value: tree.name || "", placeholder: "Tree name" });
    nameIn.addEventListener("input", () => { tree.name = nameIn.value; markDirty(); });
    card.appendChild(field("Tree name", nameIn));

    const region = el("input", { value: tree.region || "", placeholder: "region", list: "nf-dregions", autocapitalize: "words" });
    region.addEventListener("input", () => { setKey("region", region.value.trim()); markDirty(); });
    card.appendChild(el("datalist", { id: "nf-dregions" }, REGIONS.filter(Boolean).map((r) => el("option", { value: r }))));
    const status = el("select", {}, STATUSES.map((s) => el("option", { value: s, selected: (tree.status || "") === s }, s || "— status —")));
    status.addEventListener("change", () => { setKey("status", status.value); markDirty(); });
    card.appendChild(el("div", { class: "row" }, [
      el("div", { class: "grow" }, field("Region", region)),
      el("div", { class: "grow" }, field("Status", status)),
    ]));

    const npcsIn = el("input", { value: (tree.npcs || []).join(", "), placeholder: "NPCs / speakers (comma-separated)", autocapitalize: "words" });
    npcsIn.addEventListener("input", () => { const a = npcsIn.value.split(",").map((s) => s.trim()).filter(Boolean); if (a.length) tree.npcs = a; else delete tree.npcs; markDirty(); });
    card.appendChild(field("NPCs involved", npcsIn));
    const tagsIn = el("input", { value: (tree.tags || []).join(", "), placeholder: "tags (comma-separated)", autocapitalize: "words" });
    tagsIn.addEventListener("input", () => { const a = tagsIn.value.split(",").map((s) => s.trim()).filter(Boolean); if (a.length) tree.tags = a; else delete tree.tags; markDirty(); });
    card.appendChild(field("Tags", tagsIn));

    const notes = el("textarea", { rows: "3", placeholder: "Notes for this whole conversation…" });
    notes.value = tree.notes || "";
    notes.addEventListener("input", () => { setKey("notes", notes.value); markDirty(); });
    card.appendChild(field("📝 Notes", notes));

    card.appendChild(el("div", { class: "card-meta", text: `id: ${tree.id}   ·   start: ${tree.start_node || "(none)"}` }));
    return card;
  }

  // ── validation banner ──────────────────────────────────────
  const revalidate = debounce(() => {
    const issues = validateTree(tree);
    clear(warnHost);
    if (!issues.length) return;
    const ul = el("ul");
    for (const it of issues.slice(0, 8)) {
      ul.appendChild(el("li", {}, it.node
        ? [el("a", { onclick: () => scrollToNode(it.node) }, it.msg)]
        : [it.msg]));
    }
    warnHost.appendChild(el("div", { class: "warn-banner" }, [
      el("strong", { text: `${issues.length} thing${issues.length > 1 ? "s" : ""} to check` }), ul,
    ]));
  }, 200);

  // ── node list ──────────────────────────────────────────────
  function renderNodes() {
    clear(nodesHost);
    const ids = orderedNodeIds();
    const speakers = ctx.store.knownCharacters();
    const dl = el("datalist", { id: "nf-speakers" }, speakers.map((s) => el("option", { value: s })));
    nodesHost.appendChild(dl);
    for (const nid of ids) nodesHost.appendChild(renderNode(nid));
    renderHeader();
    revalidate();
  }

  function orderedNodeIds() {
    // start node first, then BFS over links, then any orphans — stable, readable order.
    const all = Object.keys(tree.nodes);
    const seen = new Set();
    const out = [];
    const queue = [];
    if (tree.start_node && tree.nodes[tree.start_node]) queue.push(tree.start_node);
    while (queue.length) {
      const cur = queue.shift();
      if (seen.has(cur) || !tree.nodes[cur]) continue;
      seen.add(cur); out.push(cur);
      for (const t of outLinks(tree.nodes[cur])) if (t && !seen.has(t)) queue.push(t);
    }
    for (const nid of all) if (!seen.has(nid)) out.push(nid);
    return out;
  }

  function renderNode(nid) {
    const node = tree.nodes[nid];
    const isStart = tree.start_node === nid;
    const card = el("div", { class: "card node-card" + (isStart ? " start" : ""), id: "node-" + cssId(nid) });

    const head = el("div", { class: "node-head" }, [
      isStart ? el("span", { class: "badge gold" }, "START") : null,
      el("span", { class: "node-id grow", text: nid }),
      el("button", { class: "btn ghost small", onclick: () => openNodeMenu(nid) }, "⋯"),
    ]);
    card.appendChild(head);

    const speaker = el("input", { class: "speaker-input grow", value: node.speaker || "", placeholder: "Speaker", list: "nf-speakers", autocapitalize: "words" });
    speaker.addEventListener("input", () => { node.speaker = speaker.value; markDirty(); });
    const pickChar = el("button", { class: "btn small", title: "Choose character", onclick: () => openPicker({
      title: "Choose character",
      items: ctx.store.knownCharacters().map((n) => ({ id: n, label: n })),
      onPick: (n) => { node.speaker = n; speaker.value = n; markDirty(); },
    }) }, "◉");
    card.appendChild(field("Speaker", el("div", { class: "row" }, [speaker, pickChar])));

    const emoSel = el("select", {});
    emoSel.appendChild(el("option", { value: "", selected: !node.emotion || node.emotion === "neutral" }, "😐 neutral (default)"));
    for (const e of EMOTIONS) emoSel.appendChild(el("option", { value: e, selected: node.emotion === e }, e));
    emoSel.addEventListener("change", () => { if (emoSel.value) node.emotion = emoSel.value; else delete node.emotion; markDirty(); });
    card.appendChild(field("Emotion", emoSel));

    const text = el("textarea", { placeholder: "What they say…", rows: "3" });
    text.value = node.text || "";
    text.addEventListener("input", () => { node.text = text.value; autoGrow(text); markDirty(); });
    card.appendChild(field("Text", text));
    setTimeout(() => autoGrow(text), 0);

    const noteIn = el("input", { class: "node-note", value: node.note || "", placeholder: "📝 note (e.g. Maren is furious here / needs a line)" });
    noteIn.addEventListener("input", () => { if (noteIn.value.trim()) node.note = noteIn.value; else delete node.note; markDirty(); });
    card.appendChild(noteIn);

    const hasChoices = Array.isArray(node.choices) && node.choices.length > 0;
    if (hasChoices) {
      const wrap = el("div");
      node.choices.forEach((ch, i) => wrap.appendChild(renderChoice(nid, node, ch, i)));
      card.appendChild(wrap);
      card.appendChild(el("div", { class: "row", style: "margin-top:8px;gap:8px" }, [
        el("button", { class: "btn small", onclick: () => { node.choices.push({ label: "", next_node: "" }); markDirty(); renderNodes(); scrollToNode(nid); } }, "＋ Choice"),
        el("button", { class: "btn ghost small", onclick: () => makeLinear(nid) }, "Make linear"),
      ]));
    } else {
      // linear
      card.appendChild(el("div", { class: "row", style: "margin-top:4px;gap:8px;align-items:center" }, [
        el("span", { class: "field-label", style: "margin:0", text: "Then" }),
        linkChip(node.next_node, (val) => setLink(node, "next_node", val, node.speaker)),
      ]));
      card.appendChild(el("button", {
        class: "btn ghost small", style: "margin-top:8px",
        onclick: () => { delete node.next_node; node.choices = [{ label: "", next_node: "" }]; markDirty(); renderNodes(); scrollToNode(nid); },
      }, "Split into choices"));
    }

    card.appendChild(renderAdvanced(nid, node));
    return card;
  }

  function renderChoice(nid, node, ch, i) {
    const box = el("div", { class: "choice" });
    box.appendChild(el("div", { class: "row" }, [
      el("span", { class: "choice-idx grow", text: `Choice ${i + 1}` }),
      el("button", { class: "icon-btn", style: "font-size:1rem;min-width:32px;height:32px", title: "Move up", onclick: () => moveChoice(node, i, -1) }, "↑"),
      el("button", { class: "icon-btn", style: "font-size:1rem;min-width:32px;height:32px", title: "Move down", onclick: () => moveChoice(node, i, 1) }, "↓"),
      el("button", { class: "icon-btn", style: "font-size:1rem;min-width:32px;height:32px;color:var(--red)", title: "Delete choice", onclick: () => { node.choices.splice(i, 1); if (!node.choices.length) makeLinear(nid, true); else { markDirty(); renderNodes(); scrollToNode(nid); } } }, "✕"),
    ]));
    const label = el("input", { value: ch.label || "", placeholder: "Button label" });
    label.addEventListener("input", () => { ch.label = label.value; markDirty(); });
    box.appendChild(field("Label", label));

    box.appendChild(el("div", { class: "row", style: "align-items:center;gap:8px;margin-bottom:6px" }, [
      el("span", { class: "field-label", style: "margin:0", text: "Goes to" }),
      linkChip(ch.next_node, (val) => setLink(ch, "next_node", val, node.speaker)),
    ]));

    box.appendChild(renderEffects(ch));

    // optional gating condition
    const cond = el("input", { value: ch.condition || "", placeholder: "flag required to show (optional)" });
    cond.addEventListener("input", () => { if (cond.value.trim()) ch.condition = cond.value.trim(); else delete ch.condition; markDirty(); });
    const det = el("details", {}, [el("summary", {}, "Show condition / advanced"), field("Visible only if flag", cond)]);
    if (ch.condition) det.open = true;
    box.appendChild(det);
    return box;
  }

  function renderEffects(ch) {
    const host = el("div");
    const draw = () => {
      clear(host);
      const eff = ch.effects || {};
      const keys = Object.keys(eff);
      host.appendChild(el("div", { class: "field-label", text: "Effects when chosen" }));
      for (const k of keys) {
        const valIn = el("input", { class: "grow", value: String(eff[k]), placeholder: "value" });
        valIn.addEventListener("input", () => { ch.effects[k] = valIn.value; markDirty(); });
        host.appendChild(el("div", { class: "effects-row" }, [
          el("span", { class: "eff-key badge blue", text: k }),
          valIn,
          el("button", { class: "icon-btn", style: "font-size:1rem;min-width:32px;height:32px;color:var(--red)", onclick: () => { delete ch.effects[k]; if (!Object.keys(ch.effects).length) delete ch.effects; markDirty(); draw(); } }, "✕"),
        ]));
      }
      host.appendChild(el("button", { class: "btn ghost small", style: "margin-top:4px", onclick: () => addEffect(ch, draw) }, "＋ effect"));
    };
    draw();
    return host;
  }

  function addEffect(ch, redraw) {
    const known = [
      { id: "set_flag", label: "set_flag — set a world flag" },
      { id: "give_item", label: "give_item — give the player an item" },
      { id: "unlock", label: "unlock — unlock a character/content" },
      { id: "standing_", label: "standing_… — change faction standing" },
    ];
    openPicker({
      title: "Add effect",
      items: known,
      specials: [{ label: "✎ Custom key…", value: "__custom__" }],
      onPick: (key) => {
        if (key === "__custom__") {
          key = window.prompt("Effect key (e.g. standing_duergar):", "");
          if (!key) return;
        } else if (key === "standing_") {
          const f = window.prompt("Faction (e.g. duergar):", "");
          if (!f) return;
          key = "standing_" + slugify(f);
        }
        if (!ch.effects) ch.effects = {};
        if (!(key in ch.effects)) ch.effects[key] = "";
        markDirty(); redraw();
      },
    });
  }

  function renderAdvanced(nid, node) {
    const extra = Object.keys(node).filter((k) => !MANAGED.has(k));
    const det = el("details");
    det.appendChild(el("summary", {}, "Advanced fields" + (extra.length ? ` (${extra.length})` : "")));
    const host = el("div", { class: "advanced" });
    const draw = () => {
      clear(host);
      for (const k of Object.keys(node).filter((x) => !MANAGED.has(x))) {
        if (k === "pos" || (node[k] !== null && typeof node[k] === "object")) {
          const desc = k === "pos" ? `[${node.pos}] — layout, set on desktop` : "structured (stage/choreography) — preserved, edit on desktop";
          host.appendChild(el("div", { class: "row" }, [
            el("span", { class: "badge", text: k }),
            el("span", { class: "faint", style: "font-size:.78rem", text: desc }),
          ]));
          continue;
        }
        const isNum = ADV_NUM.has(k);
        const inp = el("input", { class: "grow", type: isNum ? "number" : "text", value: String(node[k]), placeholder: "value" });
        inp.addEventListener("input", () => {
          const v = inp.value.trim();
          if (v === "") delete node[k];
          else node[k] = isNum ? Number(v) : v;
          markDirty();
        });
        host.appendChild(el("div", { class: "effects-row" }, [
          el("span", { class: "eff-key badge", text: k }), inp,
          el("button", { class: "icon-btn", style: "font-size:1rem;min-width:32px;height:32px;color:var(--red)", onclick: () => { delete node[k]; markDirty(); draw(); det.querySelector("summary").textContent = "Advanced fields"; } }, "✕"),
        ]));
      }
      host.appendChild(el("button", { class: "btn ghost small", onclick: () => addAdvanced(node, draw) }, "＋ field"));
    };
    draw();
    det.appendChild(host);
    return det;
  }

  function addAdvanced(node, redraw) {
    openPicker({
      title: "Add field",
      items: ADV_KEYS.filter((k) => !(k in node)).map((k) => ({ id: k, label: k })),
      specials: [{ label: "✎ Custom key…", value: "__custom__" }],
      onPick: (key) => {
        if (key === "__custom__") { key = window.prompt("Field key:", ""); if (!key) return; }
        if (!(key in node)) node[key] = ADV_NUM.has(key) ? 0 : "";
        markDirty(); redraw();
      },
    });
  }

  // ── link chip ──────────────────────────────────────────────
  function linkChip(target, onChange) {
    const isEnd = !target;
    const chip = el("span", { class: "linkchip" + (isEnd ? " end" : "") }, [
      el("span", { class: "arrow", text: "→" }),
      isEnd ? "END" : el("span", { text: nodeShort(target) }),
    ]);
    chip.addEventListener("click", () => openLinkPicker(onChange));
    return chip;
  }

  function openLinkPicker(onPick) {
    const items = orderedNodeIds().map((nid) => ({ id: nid, label: nodeShort(nid), sub: nid }));
    openPicker({
      title: "Link to…",
      items,
      specials: [
        { label: "＋ New node (inherits speaker)", value: "__new__" },
        { label: "END — end conversation here", value: "" },
      ],
      onPick,
    });
  }

  function setLink(obj, key, val, seedSpeaker) {
    if (val === "__new__") {
      const nid = addNode(seedSpeaker || "");
      obj[key] = nid;
      markDirty(); renderNodes(); scrollToNode(nid);
      return;
    }
    obj[key] = val;
    markDirty(); renderNodes();
  }

  // ── node operations ────────────────────────────────────────
  function addNode(seedSpeaker) {
    const nid = uniqueId(seedSpeaker || "node", tree.nodes);
    const node = { speaker: seedSpeaker || "", text: "" };
    if (usesPos) node.pos = nextPos();
    tree.nodes[nid] = node;
    if (!tree.start_node) tree.start_node = nid;
    markDirty();
    return nid;
  }

  function nextPos() {
    const n = Object.keys(tree.nodes).length;
    return [40 + (n % 5) * 240, 40 + Math.floor(n / 5) * 170];
  }

  function makeLinear(nid, silent) {
    const node = tree.nodes[nid];
    delete node.choices;
    if (node.next_node === undefined) node.next_node = "";
    markDirty();
    if (!silent) { renderNodes(); scrollToNode(nid); } else { renderNodes(); }
  }

  function moveChoice(node, i, dir) {
    const j = i + dir;
    if (j < 0 || j >= node.choices.length) return;
    const [c] = node.choices.splice(i, 1);
    node.choices.splice(j, 0, c);
    markDirty(); renderNodes();
  }

  function openNodeMenu(nid) {
    const isStart = tree.start_node === nid;
    openPicker({
      title: `Node: ${nid}`,
      allowSearch: false,
      items: [],
      specials: [
        !isStart ? { label: "★ Set as start node", value: "start" } : null,
        { label: "⧉ Duplicate node", value: "dup" },
        { label: "🗑 Delete node", value: "del", cls: "" },
      ].filter(Boolean),
      onPick: (action) => {
        if (action === "start") { tree.start_node = nid; markDirty(); renderNodes(); }
        else if (action === "dup") duplicateNode(nid);
        else if (action === "del") deleteNode(nid);
      },
    });
  }

  function duplicateNode(nid) {
    const copy = clone(tree.nodes[nid]);
    if (copy.pos) copy.pos = [copy.pos[0] + 30, copy.pos[1] + 30];
    const newId = uniqueId(nid + "_copy", tree.nodes);
    tree.nodes[newId] = copy;
    markDirty(); renderNodes(); scrollToNode(newId);
  }

  function deleteNode(nid) {
    if (!window.confirm(`Delete node "${nid}"? Links pointing to it become END.`)) return;
    delete tree.nodes[nid];
    for (const n of Object.values(tree.nodes)) {
      if (n.next_node === nid) n.next_node = "";
      if (n.skip_to === nid) delete n.skip_to;
      if (Array.isArray(n.choices)) for (const c of n.choices) if (c.next_node === nid) c.next_node = "";
    }
    if (tree.start_node === nid) tree.start_node = Object.keys(tree.nodes)[0] || "";
    markDirty(); renderNodes();
  }

  // ── helpers ────────────────────────────────────────────────
  function nodeShort(nid) {
    const n = tree.nodes[nid];
    if (!n) return nid + " (missing!)";
    const t = (n.text || "").replace(/\s+/g, " ").trim();
    return `${n.speaker || "—"}: ${t.slice(0, 26)}${t.length > 26 ? "…" : ""}`;
  }
  function scrollToNode(nid) {
    requestAnimationFrame(() => {
      const elem = document.getElementById("node-" + cssId(nid));
      if (elem) elem.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }

  // ── save ───────────────────────────────────────────────────
  async function doSave() {
    if (!dirty || saving) return;
    const issues = validateTree(tree).filter((i) => i.level === "error");
    if (issues.length && !window.confirm(`${issues.length} problem(s):\n` + issues.map((e) => "• " + e.msg).join("\n") + "\n\nSave anyway?")) return;
    const text = toGodotJson(tree);
    saving = true; renderHeader();
    try {
      if (ctx.isDemo) {
        ctx.store.trees.set(id, { sha, tree: clone(tree) });
        dirty = false;
        toast("Saved locally (demo — not pushed to GitHub)", "ok");
      } else {
        const newSha = await ctx.gh.putFile(ctx.store.dialoguePath(id), text, sha, `Edit dialogue: ${id}`);
        sha = newSha;
        ctx.store.trees.set(id, { sha, tree: clone(tree) });
        const ix = ctx.store.dialogueIndex.find((d) => d.id === id);
        if (ix) { ix.sha = sha; ix.name = tree.name; }
        ctx.store.cacheSave();
        dirty = false;
        toast("Saved to GitHub ✓", "ok");
      }
    } catch (e) {
      if (e instanceof ConflictError) return handleConflict();
      toast(e.message || "Save failed", "err");
    } finally {
      saving = false; renderHeader();
    }
  }

  async function handleConflict() {
    saving = false; renderHeader();
    const reload = window.confirm(
      "This tree changed on GitHub since you opened it (maybe synced from your PC).\n\n" +
      "OK = load the latest version (your unsaved edits here are lost)\n" +
      "Cancel = keep editing (you can copy your text out first)"
    );
    if (!reload) return;
    try {
      const f = await ctx.gh.getFile(ctx.store.dialoguePath(id));
      if (f && f.json) {
        tree = f.json; sha = f.sha;
        ctx.store.trees.set(id, { sha, tree: clone(tree) });
        dirty = false;
        toast("Reloaded latest", "ok");
        renderNodes();
      }
    } catch (e) { toast(e.message || "Reload failed", "err"); }
  }

  // ── kick off the first render (after all decls, so consts like `revalidate` exist) ──
  ctx.setGuard(() => dirty);
  renderHeader();
  renderNodes();
  if (ctx.pendingScrollNode) { const n = ctx.pendingScrollNode; ctx.pendingScrollNode = null; scrollToNode(n); }
}

// shared
function outLinks(node) {
  const out = [];
  if (node.next_node) out.push(node.next_node);
  if (node.skip_to) out.push(node.skip_to);
  if (Array.isArray(node.choices)) for (const c of node.choices) if (c.next_node) out.push(c.next_node);
  return out;
}
function cssId(s) { return String(s).replace(/[^a-zA-Z0-9_-]/g, "_"); }
function autoGrow(ta) { ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight + 2, 360) + "px"; }
