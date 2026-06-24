// quests.js — quest browser + light editor (whole-file custom_quests.json).
import { el, clear, field, openPicker, toast, clone, uniqueId, slugify, toGodotJson, downloadText, openTextSheet, debounce } from "./util.js";
import { ConflictError } from "./github.js";
import { validateQuest } from "./validate.js";

const DIFFICULTIES = ["", "Trivial", "Easy", "Normal", "Hard", "Deadly"];
export const REGIONS = ["", "Elthiad", "Cinder Bloom", "Deepmark", "Hollow Reach", "Saltreach", "Darkmist", "Swamp", "Frontier"];
export const STATUSES = ["", "placeholder", "draft", "semi-final", "final"];
export const STATUS_BADGE = { placeholder: "red", draft: "", "semi-final": "gold", final: "green" };

// ── List ─────────────────────────────────────────────────────
export function renderQuestList(ctx, mount) {
  const m = clear(mount);
  m.appendChild(el("div", { class: "row", style: "gap:8px;margin-bottom:10px" }, [
    el("button", { class: "btn ghost grow", style: "border-style:dashed", onclick: () => createNewQuest(ctx) }, "＋ New quest"),
    el("button", { class: "btn ghost", onclick: () => importQuests(ctx) }, "⬆ Import"),
  ]));

  const list = ctx.store.quests.list || [];
  if (!list.length) {
    m.appendChild(el("div", { class: "empty" }, "No quests yet. Tap ＋ to add one, or author them on the desktop editor."));
    return;
  }

  const search = el("input", { type: "search", placeholder: "🔍 Filter by name, region, NPC, status, tag…", autocapitalize: "none", spellcheck: "false", style: "margin-bottom:10px" });
  search.value = ctx.questFilter || "";
  m.appendChild(search);
  const listHost = el("div");
  m.appendChild(listHost);

  const draw = () => {
    ctx.questFilter = search.value;
    const f = search.value.trim().toLowerCase();
    clear(listHost);
    let shown = 0;
    list.forEach((q, i) => {
      if (f && !questHaystack(q).includes(f)) return;
      shown++;
      const stages = Array.isArray(q.stages) ? q.stages.length : 0;
      const badges = [];
      if (q.region) badges.push(el("span", { class: "badge blue" }, q.region));
      if (q.status) badges.push(el("span", { class: "badge " + (STATUS_BADGE[q.status] || "") }, q.status));
      else if (q.difficulty) badges.push(el("span", { class: "badge gold" }, q.difficulty));
      const npcLine = q.npcs && q.npcs.length ? " · " + q.npcs.slice(0, 3).join(", ") : "";
      listHost.appendChild(el("div", { class: "list-row", onclick: () => ctx.go(`#/q/${i}`) }, [
        el("div", { class: "grow" }, [
          el("div", { class: "card-title", text: q.name || q.id || "(unnamed quest)" }),
          el("div", { class: "card-meta", text: `${q.id || "no-id"}${npcLine} · ${stages} stage${stages === 1 ? "" : "s"}` }),
        ]),
        el("div", { class: "row", style: "gap:4px;flex-wrap:wrap;justify-content:flex-end;max-width:42%" }, badges),
        el("div", { class: "chevron", text: "›" }),
      ]));
    });
    if (!shown) listHost.appendChild(el("div", { class: "empty" }, `No quests match “${search.value}”.`));
  };
  search.addEventListener("input", debounce(draw, 150));
  draw();
}

function questHaystack(q) {
  return [q.name, q.id, q.region, q.status, q.difficulty, q.description, (q.npcs || []).join(" "), (q.tags || []).join(" "), q.notes]
    .filter(Boolean).join(" ").toLowerCase();
}

async function createNewQuest(ctx) {
  const name = window.prompt("Name for the new quest:", "");
  if (name === null) return;
  const taken = new Set((ctx.store.quests.list || []).map((q) => q.id));
  const id = uniqueId(slugify(name) || "quest", taken);
  const quest = { id, name: name.trim() || id, difficulty: "Normal", giver_id: "", description: "", reward_gold: 0, reward_rep: 0, stages: [] };
  const newList = [...(ctx.store.quests.list || []), quest];
  try {
    await saveQuestList(ctx, newList, `Create quest: ${id}`);
    ctx.go(`#/q/${newList.length - 1}`);
  } catch (e) {
    if (e instanceof ConflictError) toast("Quests changed on GitHub — reopen Quests to refresh.", "err");
    else toast(e.message || "Could not create quest", "err");
  }
}

// Paste a quest object {…} or an array [ {…} ] (e.g. from custom_quests.json authored
// elsewhere) and merge it into the repo — easy way to include quests added without the app.
function importQuests(ctx) {
  openTextSheet({
    title: "Import quest JSON",
    placeholder: 'Paste a quest object  {"id":"…","name":"…","stages":[…]}  or an array of them.',
    submitLabel: "Import & save",
    onSubmit: async (txt) => {
      let data;
      try { data = JSON.parse(txt); } catch (_) { toast("That isn't valid JSON.", "err"); return false; }
      const incoming = Array.isArray(data) ? data : [data];
      if (!incoming.length || !incoming.every((q) => q && typeof q === "object" && !Array.isArray(q))) { toast("Expected a quest object or an array of them.", "err"); return false; }
      const list = [...(ctx.store.quests.list || [])];
      let added = 0, replaced = 0;
      for (const q of incoming) {
        if (!q.id) q.id = uniqueId(slugify(q.name || "quest"), new Set(list.map((x) => x.id)));
        const ix = list.findIndex((x) => x.id === q.id);
        if (ix >= 0) { list[ix] = q; replaced++; } else { list.push(q); added++; }
      }
      try { await saveQuestList(ctx, list, `Import ${incoming.length} quest(s)`); }
      catch (e) { toast(e.message || "Save failed", "err"); return false; }
      toast(`Imported — ${added} added, ${replaced} replaced`, "ok");
      ctx.go("#/q");
    },
  });
}

// ── Editor ───────────────────────────────────────────────────
export function renderQuestEditor(ctx, indexStr) {
  const idx = parseInt(indexStr, 10);
  const original = (ctx.store.quests.list || [])[idx];
  if (!original) {
    ctx.setHeader({ title: "Quest not found", back: "#/q", actions: [] });
    clear(ctx.main).appendChild(el("div", { class: "empty" }, "Go back and reopen Quests."));
    return;
  }
  let q = clone(original);
  if (!Array.isArray(q.stages)) q.stages = [];
  let dirty = false, saving = false;

  const body = clear(ctx.main);
  const stagesHost = el("div");

  ctx.setGuard(() => dirty);
  renderHeader();
  renderBody();

  function renderHeader() {
    ctx.setHeader({
      title: q.name || q.id,
      sub: `quest${dirty ? " · ● unsaved" : ""}`,
      back: "#/q",
      actions: [
        { label: "⬇", kind: "ghost small", onClick: () => downloadText(`${q.id || "quest"}.json`, toGodotJson(q)) },
        { label: saving ? "Saving…" : (dirty ? "Save" : "Saved"), kind: dirty ? "primary small" : "ghost small", disabled: !dirty || saving, onClick: doSave },
      ],
    });
  }
  function markDirty() { dirty = true; renderHeader(); }

  function renderBody() {
    clear(body);
    body.appendChild(metaCard());
    body.appendChild(el("div", { class: "section-title" }, "Stages"));
    body.appendChild(stagesHost);
    renderStages();
    body.appendChild(el("button", {
      class: "btn ghost", style: "width:100%;border-style:dashed;margin-top:4px",
      onclick: () => { q.stages.push({ id: uniqueId("step", new Set(q.stages.map(s => s.id))), title: "New step", objective: "" }); markDirty(); renderStages(); },
    }, "＋  Add stage"));
  }

  function metaCard() {
    const card = el("div", { class: "card accent" });
    const name = textInput(q.name, "Quest name", (v) => { q.name = v; markDirty(); });
    card.appendChild(field("Name", name));

    const diff = el("select", {}, DIFFICULTIES.map((d) => el("option", { value: d, selected: (q.difficulty || "") === d }, d || "—")));
    diff.addEventListener("change", () => { q.difficulty = diff.value; markDirty(); });

    const status = el("select", {}, STATUSES.map((s) => el("option", { value: s, selected: (q.status || "") === s }, s || "— status —")));
    status.addEventListener("change", () => { setOrDel(q, "status", status.value); markDirty(); });
    card.appendChild(el("div", { class: "row" }, [
      el("div", { class: "grow" }, field("Difficulty", diff)),
      el("div", { class: "grow" }, field("Status", status)),
    ]));

    const region = el("input", { value: q.region || "", placeholder: "region", list: "nf-regions", autocapitalize: "words" });
    region.addEventListener("input", () => { setOrDel(q, "region", region.value.trim()); markDirty(); });
    card.appendChild(el("datalist", { id: "nf-regions" }, REGIONS.filter(Boolean).map((r) => el("option", { value: r }))));
    card.appendChild(field("Region", region));

    const npcs = listInput(q.npcs, "NPCs involved (comma-separated)", (arr) => { if (arr.length) q.npcs = arr; else delete q.npcs; markDirty(); });
    card.appendChild(field("NPCs involved", npcs));
    const tags = listInput(q.tags, "tags / threads (comma-separated)", (arr) => { if (arr.length) q.tags = arr; else delete q.tags; markDirty(); });
    card.appendChild(field("Tags", tags));

    const giver = textInput(q.giver_id, "character id of quest giver", (v) => { q.giver_id = v; markDirty(); });
    const giverRow = el("div", { class: "row" }, [giver]);
    if ((ctx.store.cast.list || []).length) {
      giverRow.appendChild(el("button", { class: "btn small", onclick: () => pickCast((cid) => { q.giver_id = cid; giver.value = cid; markDirty(); }) }, "◉"));
    }
    card.appendChild(field("Giver", giverRow));

    const desc = el("textarea", { rows: "3", placeholder: "Quest description" });
    desc.value = q.description || "";
    desc.addEventListener("input", () => { q.description = desc.value; markDirty(); });
    card.appendChild(field("Description", desc));

    // link to a design-vault note (Docs tab)
    const docIn = textInput(q.design_doc, "vault path e.g. Quests/Quests Deepmark/Black and Blinding.md", (v) => { setOrDel(q, "design_doc", v); markDirty(); });
    const docRow = el("div", { class: "row" }, [docIn]);
    if (ctx.store.vaultConfigured()) {
      docRow.appendChild(el("button", { class: "btn small", onclick: () => { if (q.design_doc) { ctx.docFilePath = q.design_doc; ctx.go("#/docfile"); } else toast("Set a vault path first."); } }, "📄 Open"));
    }
    card.appendChild(field("Design doc (Docs tab)", docRow));

    const notes = el("textarea", { rows: "4", placeholder: "Production notes — the knot, gated endings, things still to write…" });
    notes.value = q.notes || "";
    notes.addEventListener("input", () => { setOrDel(q, "notes", notes.value); markDirty(); });
    card.appendChild(field("📝 Notes", notes));

    const gold = numInput(q.reward_gold, (v) => { q.reward_gold = v; markDirty(); });
    const rep = numInput(q.reward_rep, (v) => { q.reward_rep = v; markDirty(); });
    card.appendChild(el("div", { class: "row" }, [
      el("div", { class: "grow" }, field("Reward gold", gold)),
      el("div", { class: "grow" }, field("Reward rep", rep)),
    ]));
    card.appendChild(el("div", { class: "card-meta", text: `id: ${q.id}` }));
    return card;
  }

  function renderStages() {
    clear(stagesHost);
    if (!q.stages.length) { stagesHost.appendChild(el("div", { class: "empty", style: "padding:18px" }, "No stages yet.")); return; }
    q.stages.forEach((s, i) => stagesHost.appendChild(stageCard(s, i)));
  }

  function stageCard(s, i) {
    const card = el("div", { class: "card blue" });
    card.appendChild(el("div", { class: "row" }, [
      el("span", { class: "choice-idx grow", text: `Stage ${i + 1}` }),
      el("button", { class: "icon-btn", style: "font-size:1rem;min-width:32px;height:32px", onclick: () => moveStage(i, -1) }, "↑"),
      el("button", { class: "icon-btn", style: "font-size:1rem;min-width:32px;height:32px", onclick: () => moveStage(i, 1) }, "↓"),
      el("button", { class: "icon-btn", style: "font-size:1rem;min-width:32px;height:32px;color:var(--red)", onclick: () => { q.stages.splice(i, 1); markDirty(); renderStages(); } }, "✕"),
    ]));
    card.appendChild(field("Title", textInput(s.title, "Step title", (v) => { s.title = v; markDirty(); })));
    const obj = el("textarea", { rows: "2", placeholder: "What the player must do" });
    obj.value = s.objective || "";
    obj.addEventListener("input", () => { s.objective = obj.value; markDirty(); });
    card.appendChild(field("Objective", obj));
    card.appendChild(el("div", { class: "row" }, [
      el("div", { class: "grow" }, field("Trigger flag", textInput(s.trigger_flag, "starts when set (optional)", (v) => { setOrDel(s, "trigger_flag", v); markDirty(); }))),
      el("div", { class: "grow" }, field("Completion flag", textInput(s.completion_flag, "done when set", (v) => { setOrDel(s, "completion_flag", v); markDirty(); }))),
    ]));

    // dialogue link
    const dlgVal = el("span", { class: "linkchip" + (s.dialogue_id ? "" : " end") }, s.dialogue_id ? "💬 " + s.dialogue_id : "no dialogue");
    dlgVal.addEventListener("click", () => {
      const items = ctx.store.dialogueIndex.map((d) => ({ id: d.id, label: d.name || d.id, sub: d.id }));
      openPicker({
        title: "Link a dialogue",
        items,
        specials: [{ label: "✕ None", value: "" }],
        onPick: (v) => { setOrDel(s, "dialogue_id", v); markDirty(); renderStages(); },
      });
    });
    card.appendChild(el("div", { class: "row", style: "margin-top:6px;gap:8px;align-items:center" }, [
      el("span", { class: "field-label", style: "margin:0", text: "Dialogue" }), dlgVal,
    ]));
    return card;
  }

  function moveStage(i, dir) {
    const j = i + dir; if (j < 0 || j >= q.stages.length) return;
    const [s] = q.stages.splice(i, 1); q.stages.splice(j, 0, s);
    markDirty(); renderStages();
  }

  function pickCast(onPick) {
    openPicker({
      title: "Choose giver",
      items: (ctx.store.cast.list || []).map((c) => ({ id: c.id, label: c.name || c.id, sub: c.id })),
      onPick,
    });
  }

  async function doSave() {
    if (!dirty || saving) return;
    const issues = validateQuest(q).filter((i) => i.level === "error");
    if (issues.length && !window.confirm(issues.map((e) => "• " + e.msg).join("\n") + "\n\nSave anyway?")) return;
    const newList = [...(ctx.store.quests.list || [])];
    newList[idx] = q;
    saving = true; renderHeader();
    try {
      await saveQuestList(ctx, newList, `Edit quest: ${q.id}`);
      dirty = false;
      toast(ctx.isDemo ? "Saved locally (demo)" : "Saved to GitHub ✓", "ok");
    } catch (e) {
      if (e instanceof ConflictError) {
        if (window.confirm("Quests changed on GitHub since you opened them.\n\nOK = reload latest (lose your edits)\nCancel = keep editing")) {
          await reloadQuests(ctx);
          ctx.go("#/q");
        }
      } else toast(e.message || "Save failed", "err");
    } finally { saving = false; renderHeader(); }
  }
}

// ── shared persistence ───────────────────────────────────────
export async function saveQuestList(ctx, list, message) {
  if (ctx.isDemo) {
    ctx.store.quests.list = list;
    ctx.store.cacheSave();
    return;
  }
  const path = ctx.store.questsPath();
  const newSha = await ctx.gh.putFile(path, toGodotJson(list), ctx.store.quests.sha, message);
  ctx.store.quests = { sha: newSha, list, path };
  ctx.store.cacheSave();
}

export async function reloadQuests(ctx) {
  if (ctx.isDemo) return;
  const f = await ctx.gh.getFile(ctx.store.questsPath());
  ctx.store.quests = { sha: f ? f.sha : null, list: f && Array.isArray(f.json) ? f.json : [], path: ctx.store.questsPath() };
  ctx.store.cacheSave();
}

// ── tiny field helpers ───────────────────────────────────────
function textInput(val, placeholder, onInput) {
  const i = el("input", { value: val || "", placeholder: placeholder || "" });
  i.addEventListener("input", () => onInput(i.value));
  return i;
}
function listInput(arr, placeholder, onChange) {
  const i = el("input", { value: (arr || []).join(", "), placeholder: placeholder || "", autocapitalize: "words" });
  i.addEventListener("input", () => onChange(i.value.split(",").map((s) => s.trim()).filter(Boolean)));
  return i;
}
function numInput(val, onInput) {
  const i = el("input", { type: "number", value: val == null ? 0 : val });
  i.addEventListener("input", () => onInput(parseInt(i.value, 10) || 0));
  return i;
}
function setOrDel(obj, key, v) { if (v && String(v).trim()) obj[key] = v; else delete obj[key]; }
