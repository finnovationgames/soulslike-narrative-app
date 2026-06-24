// github.js — minimal GitHub Contents API client (browser, CORS, token auth).
// A factory so the app can talk to multiple repos (narrative JSON + Obsidian vault)
// with one shared token.
import { store } from "./store.js";
import { utf8ToB64, b64ToUtf8 } from "./util.js";

export class GitHubError extends Error {
  constructor(message, status) { super(message); this.name = "GitHubError"; this.status = status; }
}
export class ConflictError extends GitHubError {
  constructor(message) { super(message || "File changed on the server", 409); this.name = "ConflictError"; }
}

/**
 * Create a client bound to a config getter.
 * getCfg() must return { token, owner, repo, branch }.
 */
export function createGitHub(getCfg) {
  function headers() {
    return {
      "Authorization": `Bearer ${getCfg().token}`,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };
  }
  function repoBase() {
    const c = getCfg();
    return `https://api.github.com/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}`;
  }
  function branch() { return getCfg().branch || "main"; }
  function contentsUrl(path) {
    const enc = path.split("/").map(encodeURIComponent).join("/");
    return `${repoBase()}/contents/${enc}`;
  }

  async function parse(resp) {
    const text = await resp.text();
    try { return text ? JSON.parse(text) : null; } catch (_) { return text; }
  }

  async function request(method, url, body) {
    let resp;
    try {
      resp = await fetch(url, {
        method,
        headers: { ...headers(), ...(body ? { "Content-Type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      throw new GitHubError("Network error — check your connection.", 0);
    }
    if (resp.status === 401) throw new GitHubError("Unauthorized — your token is missing, wrong, or expired.", 401);
    if (resp.status === 403) {
      const j = await parse(resp);
      const msg = (j && j.message) || "";
      if (/rate limit/i.test(msg)) throw new GitHubError("GitHub rate limit hit — wait a minute and retry.", 403);
      throw new GitHubError("Forbidden — the token lacks access to this repo (need Contents: Read & Write).", 403);
    }
    if (resp.status === 409) throw new ConflictError();
    if (!resp.ok) {
      const j = await parse(resp);
      throw new GitHubError((j && j.message) || `Request failed (${resp.status}).`, resp.status);
    }
    return parse(resp);
  }

  return {
    /** Validate the configured token + repo. Returns repo metadata or throws. */
    async verify() {
      return request("GET", `${repoBase()}?ref=${encodeURIComponent(branch())}`);
    },

    /** List a directory. Missing dir → []. Returns [{ name, path, sha, type }]. */
    async listDir(path) {
      const url = `${contentsUrl(path)}?ref=${encodeURIComponent(branch())}`;
      let data;
      try { data = await request("GET", url); }
      catch (e) { if (e.status === 404) return []; throw e; }
      return Array.isArray(data) ? data : [];
    },

    /** Fetch + decode a file. Missing → null. Returns { sha, json, text }. */
    async getFile(path) {
      const url = `${contentsUrl(path)}?ref=${encodeURIComponent(branch())}`;
      let data;
      try { data = await request("GET", url); }
      catch (e) { if (e.status === 404) return null; throw e; }
      const text = data.content ? b64ToUtf8(data.content) : "";
      let json = null;
      try { json = text ? JSON.parse(text) : null; } catch (_) { json = null; }
      return { sha: data.sha, json, text };
    },

    /** Create or update a file. Pass sha to update (omit/null to create). Returns the new sha. */
    async putFile(path, text, sha, message) {
      const body = { message: message || `Update ${path}`, content: utf8ToB64(text), branch: branch() };
      if (sha) body.sha = sha;
      let res;
      try { res = await request("PUT", contentsUrl(path), body); }
      catch (e) { if (e.status === 422 && sha) throw new ConflictError(); throw e; }
      return res.content.sha;
    },

    async deleteFile(path, sha, message) {
      return request("DELETE", contentsUrl(path), { message: message || `Delete ${path}`, sha, branch: branch() });
    },

    /** Whole-repo file list in one request. Returns [{ path, type:'blob'|'tree', sha, size }]. */
    async listTreeRecursive() {
      const url = `${repoBase()}/git/trees/${encodeURIComponent(branch())}?recursive=1`;
      let data;
      try { data = await request("GET", url); }
      catch (e) { if (e.status === 404 || e.status === 422) return []; throw e; }
      return data && Array.isArray(data.tree) ? data.tree : [];
    },
  };
}

// Default client, bound to the narrative-repo settings (back-compat for existing imports).
export const gh = createGitHub(() => store.settings);
