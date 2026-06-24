// store.js — settings, in-memory data, and offline cache (localStorage).

const SETTINGS_KEY = "nf.settings";
const CACHE_KEY = "nf.cache";

const DEFAULTS = {
  token: "",
  owner: "",
  repo: "",
  branch: "main",
  prefix: "", // path prefix inside the repo, e.g. "" (root) or "data/"
  demo: false,
  // Optional second repo: the Obsidian design vault (markdown). Owner is reused.
  vaultRepo: "",
  vaultBranch: "main",
};

export const store = {
  settings: { ...DEFAULTS },

  // in-memory working data
  dialogueIndex: [], // [{ id, name, path, sha }]
  trees: new Map(),  // id -> { sha, tree }
  quests: { sha: null, list: [], path: "" },
  cast: { sha: null, list: [] }, // loaded lazily, used for speaker/giver suggestions
  loadedAt: null,

  load() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) this.settings = { ...DEFAULTS, ...JSON.parse(raw) };
    } catch (_) { /* ignore */ }
    return this;
  },

  saveSettings(patch) {
    this.settings = { ...this.settings, ...patch };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
    return this.settings;
  },

  reset() {
    this.settings = { ...DEFAULTS };
    localStorage.removeItem(SETTINGS_KEY);
    localStorage.removeItem(CACHE_KEY);
    this.dialogueIndex = [];
    this.trees = new Map();
    this.quests = { sha: null, list: [], path: "" };
    this.cast = { sha: null, list: [] };
  },

  mode() {
    if (this.settings.demo) return "demo";
    const s = this.settings;
    return s.token && s.owner && s.repo ? "github" : "unconfigured";
  },

  // Is the Obsidian-vault (Docs) repo set up? (Shown only when configured, or in demo.)
  vaultConfigured() { return this.settings.demo || !!this.settings.vaultRepo; },
  vaultCfg() {
    const s = this.settings;
    return { token: s.token, owner: s.owner, repo: s.vaultRepo, branch: s.vaultBranch || "main" };
  },

  // ── path helpers (repo-relative) ────────────────────────────
  dialoguesDir() { return `${this.settings.prefix}dialogues`; },
  dialoguePath(id) { return `${this.dialoguesDir()}/${id}.json`; },
  questsPath() { return `${this.settings.prefix}custom_quests.json`; },
  castPath() { return `${this.settings.prefix}custom_cast.json`; },

  // ── offline cache ───────────────────────────────────────────
  cacheSave() {
    try {
      const snapshot = {
        savedAt: Date.now(),
        dialogueIndex: this.dialogueIndex,
        trees: Array.from(this.trees.entries()),
        quests: this.quests,
        cast: this.cast,
        repo: `${this.settings.owner}/${this.settings.repo}`,
      };
      localStorage.setItem(CACHE_KEY, JSON.stringify(snapshot));
    } catch (_) { /* storage full / private mode — non-fatal */ }
  },

  cacheLoad() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return false;
      const snap = JSON.parse(raw);
      if (snap.repo !== `${this.settings.owner}/${this.settings.repo}`) return false;
      this.dialogueIndex = snap.dialogueIndex || [];
      this.trees = new Map(snap.trees || []);
      this.quests = snap.quests || { sha: null, list: [], path: "" };
      this.cast = snap.cast || { sha: null, list: [] };
      this.loadedAt = snap.savedAt;
      return true;
    } catch (_) { return false; }
  },

  cacheAgeText() {
    if (!this.loadedAt) return "";
    const mins = Math.round((Date.now() - this.loadedAt) / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins} min ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs} h ago`;
    return `${Math.round(hrs / 24)} d ago`;
  },

  // ── derived helpers ─────────────────────────────────────────
  /** Distinct speaker names seen across loaded trees + cast — for the speaker datalist. */
  knownSpeakers() {
    const set = new Set();
    for (const { tree } of this.trees.values()) {
      for (const node of Object.values(tree.nodes || {})) {
        if (node.speaker) set.add(node.speaker);
      }
    }
    for (const c of this.cast.list || []) {
      if (c && c.name) set.add(c.name);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  },
};
