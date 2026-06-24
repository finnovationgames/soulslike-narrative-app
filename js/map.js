// map.js — read-only SVG map of a dialogue tree, with touch pan/zoom.
import { el, clear, toast } from "./util.js";

const SVGNS = "http://www.w3.org/2000/svg";
const BOX_W = 156, BOX_H = 50, COL_W = 230, ROW_H = 92;

export function renderMap(ctx, id) {
  const rec = ctx.store.trees.get(id);
  if (!rec) {
    ctx.setHeader({ title: "Map", back: "#/", actions: [] });
    clear(ctx.main).appendChild(el("div", { class: "empty" }, "Tree not loaded."));
    return;
  }
  const tree = rec.tree;
  ctx.setHeader({
    title: "🗺 " + (tree.name || tree.id),
    sub: "tap a node to edit it",
    back: `#/d/${encodeURIComponent(id)}`,
    actions: [{ label: "Fit", kind: "ghost small", onClick: () => fit() }],
  });

  const pos = computeLayout(tree);
  const main = clear(ctx.main);
  const wrap = el("div", { class: "map-wrap" });
  const svg = document.createElementNS(SVGNS, "svg");
  svg.setAttribute("xmlns", SVGNS);
  wrap.appendChild(svg);
  main.appendChild(wrap);

  // bounds
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of Object.values(pos)) {
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x + BOX_W); maxY = Math.max(maxY, p.y + BOX_H);
  }
  if (!isFinite(minX)) { minX = 0; minY = 0; maxX = BOX_W; maxY = BOX_H; }
  const pad = 40;
  const full = { x: minX - pad, y: minY - pad, w: (maxX - minX) + pad * 2, h: (maxY - minY) + pad * 2 };

  // defs: arrowheads
  const defs = document.createElementNS(SVGNS, "defs");
  defs.innerHTML =
    `<marker id="arr" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
       <path d="M0,0 L8,4 L0,8 z" fill="#3a4150"/></marker>
     <marker id="arrc" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
       <path d="M0,0 L8,4 L0,8 z" fill="#b18cff"/></marker>`;
  svg.appendChild(defs);

  // edges (under nodes)
  const edgeG = document.createElementNS(SVGNS, "g");
  svg.appendChild(edgeG);
  const nodeG = document.createElementNS(SVGNS, "g");
  svg.appendChild(nodeG);

  for (const [nid, node] of Object.entries(tree.nodes || {})) {
    const from = pos[nid]; if (!from) continue;
    const edges = [];
    if (node.next_node && pos[node.next_node]) edges.push([node.next_node, false]);
    if (node.skip_to && pos[node.skip_to]) edges.push([node.skip_to, false]);
    if (Array.isArray(node.choices)) for (const c of node.choices) if (c.next_node && pos[c.next_node]) edges.push([c.next_node, true]);
    for (const [tid, isChoice] of edges) edgeG.appendChild(edge(from, pos[tid], isChoice));
  }

  for (const [nid, node] of Object.entries(tree.nodes || {})) {
    const p = pos[nid]; if (!p) continue;
    nodeG.appendChild(nodeBox(nid, node, p, tree.start_node === nid, () => {
      ctx.pendingScrollNode = nid;
      ctx.go(`#/d/${encodeURIComponent(id)}`);
    }));
  }

  // ── view state (viewBox pan/zoom) ──────────────────────────
  let vb = { ...full };
  const apply = () => svg.setAttribute("viewBox", `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
  const fit = () => { vb = { ...full }; apply(); };
  apply();

  const pointers = new Map();
  let pinchStart = null;

  wrap.addEventListener("pointerdown", (e) => {
    wrap.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, moved: false });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchStart = { dist: dist(a, b), vb: { ...vb } };
    }
  });
  wrap.addEventListener("pointermove", (e) => {
    const p = pointers.get(e.pointerId); if (!p) return;
    const rect = wrap.getBoundingClientRect();
    if (pointers.size === 2 && pinchStart) {
      pointers.get(e.pointerId).x = e.clientX;
      pointers.get(e.pointerId).y = e.clientY;
      const [a, b] = [...pointers.values()];
      const ratio = pinchStart.dist / Math.max(10, dist(a, b));
      const midX = (a.x + b.x) / 2 - rect.left, midY = (a.y + b.y) / 2 - rect.top;
      zoomTo(ratio, midX, midY, rect, pinchStart.vb);
    } else if (pointers.size === 1) {
      const dx = (e.clientX - p.x) / rect.width * vb.w;
      const dy = (e.clientY - p.y) / rect.height * vb.h;
      if (Math.abs(e.clientX - p.x) + Math.abs(e.clientY - p.y) > 3) p.moved = true;
      vb.x -= dx; vb.y -= dy; apply();
      p.x = e.clientX; p.y = e.clientY;
    }
  });
  const release = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchStart = null;
  };
  wrap.addEventListener("pointerup", release);
  wrap.addEventListener("pointercancel", release);
  wrap.addEventListener("wheel", (e) => {
    e.preventDefault();
    const rect = wrap.getBoundingClientRect();
    zoomTo(e.deltaY > 0 ? 1.12 : 0.89, e.clientX - rect.left, e.clientY - rect.top, rect, { ...vb });
  }, { passive: false });

  function zoomTo(ratio, px, py, rect, base) {
    const nw = clamp(base.w * ratio, full.w * 0.15, full.w * 4);
    const nh = base.h * (nw / base.w);
    const fx = px / rect.width, fy = py / rect.height;
    vb = { x: base.x + (base.w - nw) * fx, y: base.y + (base.h - nh) * fy, w: nw, h: nh };
    apply();
  }
}

// ── drawing helpers ───────────────────────────────────────────
function nodeBox(nid, node, p, isStart, onTap) {
  const g = document.createElementNS(SVGNS, "g");
  g.setAttribute("class", "map-node" + (isStart ? " start" : ""));
  g.setAttribute("transform", `translate(${p.x},${p.y})`);
  g.style.cursor = "pointer";

  const rect = document.createElementNS(SVGNS, "rect");
  rect.setAttribute("width", BOX_W); rect.setAttribute("height", BOX_H);
  rect.setAttribute("rx", 9); rect.setAttribute("stroke-width", isStart ? 2 : 1.2);
  g.appendChild(rect);

  const sp = document.createElementNS(SVGNS, "text");
  sp.setAttribute("x", 9); sp.setAttribute("y", 19);
  sp.setAttribute("font-weight", "700");
  sp.textContent = trunc(node.speaker || "—", 20);
  g.appendChild(sp);

  const tx = document.createElementNS(SVGNS, "text");
  tx.setAttribute("x", 9); tx.setAttribute("y", 35); tx.setAttribute("class", "sub");
  tx.textContent = trunc((node.text || "").replace(/\s+/g, " ").trim() || (hasChoices(node) ? "(choices)" : "(end)"), 24);
  g.appendChild(tx);

  if (hasChoices(node)) {
    const b = document.createElementNS(SVGNS, "text");
    b.setAttribute("x", BOX_W - 8); b.setAttribute("y", 19); b.setAttribute("text-anchor", "end");
    b.setAttribute("class", "sub"); b.setAttribute("fill", "#b18cff");
    b.textContent = "⑂" + node.choices.length;
    g.appendChild(b);
  }

  let downXY = null;
  g.addEventListener("pointerdown", (e) => { downXY = [e.clientX, e.clientY]; });
  g.addEventListener("pointerup", (e) => {
    if (!downXY) return;
    if (Math.abs(e.clientX - downXY[0]) + Math.abs(e.clientY - downXY[1]) < 6) onTap();
    downXY = null;
  });
  return g;
}

function edge(from, to, isChoice) {
  const x1 = from.x + BOX_W, y1 = from.y + BOX_H / 2;
  const x2 = to.x, y2 = to.y + BOX_H / 2;
  // if target is left of / above source, route from bottom for readability
  const path = document.createElementNS(SVGNS, "path");
  const sameDir = x2 >= x1;
  const sx = sameDir ? x1 : from.x + BOX_W / 2, sy = sameDir ? y1 : from.y + BOX_H;
  const ex = sameDir ? x2 : to.x + BOX_W / 2, ey = sameDir ? y2 : to.y;
  const dx = Math.max(40, Math.abs(ex - sx) * 0.5);
  const c1x = sameDir ? sx + dx : sx, c1y = sameDir ? sy : sy + 40;
  const c2x = sameDir ? ex - dx : ex, c2y = sameDir ? ey : ey - 40;
  path.setAttribute("d", `M${sx},${sy} C${c1x},${c1y} ${c2x},${c2y} ${ex},${ey}`);
  path.setAttribute("class", "map-edge" + (isChoice ? " choice" : ""));
  path.setAttribute("stroke-width", "1.6");
  path.setAttribute("marker-end", isChoice ? "url(#arrc)" : "url(#arr)");
  return path;
}

// ── layout ────────────────────────────────────────────────────
function computeLayout(tree) {
  const nodes = tree.nodes || {};
  const ids = Object.keys(nodes);
  const allHavePos = ids.length > 0 && ids.every((k) => Array.isArray(nodes[k].pos) && nodes[k].pos.length === 2 && nodes[k].pos.every((v) => typeof v === "number"));
  const pos = {};
  if (allHavePos) {
    for (const k of ids) pos[k] = { x: nodes[k].pos[0], y: nodes[k].pos[1] };
    return pos;
  }
  // layered BFS
  const layer = {};
  const q = [];
  const start = tree.start_node && nodes[tree.start_node] ? tree.start_node : ids[0];
  if (start) { layer[start] = 0; q.push(start); }
  while (q.length) {
    const cur = q.shift();
    for (const t of outLinks(nodes[cur])) {
      if (nodes[t] && layer[t] === undefined) { layer[t] = layer[cur] + 1; q.push(t); }
    }
  }
  let orphanLayer = Math.max(-1, ...Object.values(layer)) + 1;
  for (const k of ids) if (layer[k] === undefined) layer[k] = orphanLayer;

  const perCol = {};
  for (const k of ids) {
    const L = layer[k];
    perCol[L] = perCol[L] || 0;
    pos[k] = { x: L * COL_W, y: perCol[L] * ROW_H };
    perCol[L] += 1;
  }
  return pos;
}

function outLinks(node) {
  const out = [];
  if (node.next_node) out.push(node.next_node);
  if (node.skip_to) out.push(node.skip_to);
  if (Array.isArray(node.choices)) for (const c of node.choices) if (c.next_node) out.push(c.next_node);
  return out;
}
function hasChoices(n) { return Array.isArray(n.choices) && n.choices.length > 0; }
function trunc(s, n) { s = String(s); return s.length > n ? s.slice(0, n - 1) + "…" : s; }
function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
