// tree.js — nested BRANCH view of a dialogue tree (read-friendly).
// Linear dialogue flows straight down (no indent); player choices / conditional skips
// indent one level and are labelled, so branching is visually obvious. Re-converging or
// looping targets show a compact "↩ (shown above)" reference. Tap a line to edit it.
import { el, clear } from "./util.js";

export function renderTree(ctx, id) {
  const rec = ctx.store.trees.get(id);
  if (!rec) {
    ctx.setHeader({ title: "Tree", back: "#/", actions: [] });
    clear(ctx.main).appendChild(el("div", { class: "empty" }, "Tree not loaded."));
    return;
  }
  const tree = rec.tree;
  const nodes = tree.nodes || {};

  let allCollapsed = false;
  function setHeader() {
    ctx.setHeader({
      title: "🌳 " + (tree.name || tree.id),
      sub: "branch view · tap a line to edit",
      back: `#/d/${encodeURIComponent(id)}`,
      actions: [
        { label: allCollapsed ? "⤢ Expand" : "⤡ Collapse", kind: "ghost small", onClick: () => { allCollapsed = !allCollapsed; document.querySelectorAll(".tree-branch").forEach((b) => b.classList.toggle("collapsed", allCollapsed)); setHeader(); } },
        { label: "🗺 Map", kind: "ghost small", onClick: () => ctx.go(`#/d/${encodeURIComponent(id)}/map`) },
      ],
    });
  }
  setHeader();

  const view = clear(ctx.main).appendChild(el("div", { class: "tree-view" }));
  const rendered = new Set();
  const jump = (nid) => { ctx.pendingScrollNode = nid; ctx.go(`#/d/${encodeURIComponent(id)}`); };

  const snip = (node) => {
    const t = (node.text || "").replace(/\s+/g, " ").trim();
    return t.slice(0, 72) + (t.length > 72 ? "…" : "");
  };
  const hasChoices = (n) => Array.isArray(n.choices) && n.choices.length > 0;

  function nodeRow(nid) {
    const node = nodes[nid];
    return el("div", { class: "tree-row" + (nid === tree.start_node ? " start" : ""), onclick: () => jump(nid) }, [
      nid === tree.start_node ? el("span", { class: "badge gold" }, "START") : null,
      el("span", { class: "tree-speaker", text: node.speaker || "—" }),
      node.emotion && node.emotion !== "neutral" ? el("span", { class: "badge", text: node.emotion }) : null,
      el("span", { class: "tree-text", text: snip(node) || (hasChoices(node) ? "(choices)" : "") }),
    ]);
  }
  const refLeaf = (nid) => el("div", { class: "tree-ref", onclick: () => jump(nid) }, `↩ ${nodes[nid] ? nodes[nid].speaker || nid : nid}: ${nodes[nid] ? snip(nodes[nid]) : ""} — shown above`);
  const endLeaf = (label) => el("div", { class: "tree-leaf-end" }, label || "■ end");
  const missingLeaf = (t) => el("div", { class: "tree-leaf-end", style: "color:var(--red)" }, `→ "${t}" (missing node)`);

  function outgoing(node) {
    if (Array.isArray(node.choices) && node.choices.length) {
      return node.choices.map((c) => ({ label: c.label || "(unlabelled choice)", target: c.next_node, kind: "choice" }));
    }
    const out = [];
    if (node.next_node !== undefined) out.push({ label: null, target: node.next_node, kind: "next" });
    if (node.skip_to) out.push({ label: `↷ skip if ${node.requires_trait || "trait"}`, target: node.skip_to, kind: "skip" });
    return out;
  }

  function renderChain(startId, container) {
    let cur = startId;
    while (cur != null) {
      if (!nodes[cur]) { container.appendChild(missingLeaf(cur)); return; }
      if (rendered.has(cur)) { container.appendChild(refLeaf(cur)); return; }
      rendered.add(cur);
      container.appendChild(nodeRow(cur));
      const edges = outgoing(nodes[cur]);
      if (edges.length === 0) { container.appendChild(endLeaf()); return; }
      if (edges.length === 1 && edges[0].kind === "next") {
        const t = edges[0].target;
        if (!t) { container.appendChild(endLeaf("■ ends conversation")); return; }
        cur = t;
        continue;
      }
      for (const e of edges) {
        const branch = el("div", { class: "tree-branch" + (allCollapsed ? " collapsed" : "") });
        const label = el("div", { class: "tree-branch-label" + (e.kind === "choice" ? " choice" : "") }, e.label || "→");
        label.addEventListener("click", () => branch.classList.toggle("collapsed"));
        const content = el("div", { class: "tree-branch-content" });
        if (!e.target) content.appendChild(endLeaf("■ ends conversation"));
        else if (!nodes[e.target]) content.appendChild(missingLeaf(e.target));
        else renderChain(e.target, content);
        branch.appendChild(label);
        branch.appendChild(content);
        container.appendChild(branch);
      }
      return;
    }
  }

  const start = tree.start_node && nodes[tree.start_node] ? tree.start_node : Object.keys(nodes)[0];
  if (start) renderChain(start, view);

  const orphans = Object.keys(nodes).filter((n) => !rendered.has(n));
  if (orphans.length) {
    view.appendChild(el("div", { class: "section-title", style: "color:var(--amber)" }, `⚠ Unreachable from start (${orphans.length})`));
    for (const o of orphans) if (!rendered.has(o)) renderChain(o, view);
  }
}
