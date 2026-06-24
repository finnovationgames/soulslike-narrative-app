// validate.js — lightweight content checks (a phone-sized slice of the desktop Flags & Checks tab).

/** Returns [{ level: "error"|"warn", msg, node? }] for a dialogue tree. */
export function validateTree(tree) {
  const out = [];
  const nodes = tree.nodes || {};
  const ids = Object.keys(nodes);

  if (!ids.length) { out.push({ level: "error", msg: "Tree has no nodes." }); return out; }
  if (!tree.start_node) out.push({ level: "error", msg: "No start node set." });
  else if (!nodes[tree.start_node]) out.push({ level: "error", msg: `Start node "${tree.start_node}" doesn't exist.` });

  for (const [nid, node] of Object.entries(nodes)) {
    if (!(node.speaker || "").trim() && !(node.text || "").trim() && !hasChoices(node))
      out.push({ level: "warn", node: nid, msg: `"${nid}" is empty (no speaker, text, or choices).` });

    if (node.next_node && !nodes[node.next_node])
      out.push({ level: "error", node: nid, msg: `"${nid}" links to missing node "${node.next_node}".` });
    if (node.skip_to && !nodes[node.skip_to])
      out.push({ level: "error", node: nid, msg: `"${nid}" skip_to missing node "${node.skip_to}".` });

    if (Array.isArray(node.choices)) {
      node.choices.forEach((c, i) => {
        if (!(c.label || "").trim())
          out.push({ level: "warn", node: nid, msg: `"${nid}" choice ${i + 1} has no label.` });
        if (c.next_node && !nodes[c.next_node])
          out.push({ level: "error", node: nid, msg: `"${nid}" choice ${i + 1} links to missing node "${c.next_node}".` });
      });
    }
  }

  // unreachable nodes
  const reached = reachable(tree);
  for (const nid of ids) if (!reached.has(nid))
    out.push({ level: "warn", node: nid, msg: `"${nid}" can't be reached from the start.` });

  // errors first
  out.sort((a, b) => (a.level === b.level ? 0 : a.level === "error" ? -1 : 1));
  return out;
}

function hasChoices(node) { return Array.isArray(node.choices) && node.choices.length > 0; }

function reachable(tree) {
  const nodes = tree.nodes || {};
  const seen = new Set();
  const q = [];
  if (tree.start_node && nodes[tree.start_node]) q.push(tree.start_node);
  while (q.length) {
    const cur = q.shift();
    if (seen.has(cur) || !nodes[cur]) continue;
    seen.add(cur);
    const n = nodes[cur];
    if (n.next_node) q.push(n.next_node);
    if (n.skip_to) q.push(n.skip_to);
    if (Array.isArray(n.choices)) for (const c of n.choices) if (c.next_node) q.push(c.next_node);
  }
  return seen;
}

/** Returns [{ level, msg }] for a quest. */
export function validateQuest(quest) {
  const out = [];
  if (!(quest.id || "").trim()) out.push({ level: "error", msg: "Quest has no id." });
  if (!(quest.name || "").trim()) out.push({ level: "warn", msg: "Quest has no name." });
  const stages = Array.isArray(quest.stages) ? quest.stages : [];
  if (!stages.length) out.push({ level: "warn", msg: "Quest has no stages." });
  stages.forEach((s, i) => {
    if (!(s.title || "").trim()) out.push({ level: "warn", msg: `Stage ${i + 1} has no title.` });
  });
  return out;
}
