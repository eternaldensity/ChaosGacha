"use strict";
/* Chaos Tree web app: multiple named trees, localStorage saves,
 * import/export, canvas 3D view, SVG neighbour view, full engine UI. */
(function () {
  const E = window.ChaosEngine, G = window.ChaosGen;
  const DATA = window.CHAOS_DATA || { entries: [], tiers: [], classes: [] };
  const LS_KEY = "chaosTree.v1";
  const LS_STATIC = "chaosTree.static.v1";

  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

  function toast(msg, isErr) {
    const t = $("toast");
    t.textContent = msg;
    t.className = "toast" + (isErr ? " err" : "");
    t.style.display = "block";
    clearTimeout(t._h);
    t._h = setTimeout(() => { t.style.display = "none"; }, 3200);
  }
  function err(e) { toast(e && e.message ? e.message : String(e), true); }

  function classOf(r) {
    for (const c of DATA.classes) if (r < c.max) return c;
    return DATA.classes[DATA.classes.length - 1];
  }
  const CAT_COLORS = {
    ability: "#b388ff", item: "#ffd54f", skill: "#7cc4ff",
    trait: "#69f0ae", familiar: "#ff8a65", __root__: "#ffffff"
  };
  const catColor = f => CAT_COLORS[f] || "#9aa0b0";

  // ---- storage ---------------------------------------------------------
  function loadDB() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const db = JSON.parse(raw);
        db.trees = db.trees || []; db.states = db.states || {};
        return db;
      }
    } catch (e) { /* corrupted -> fresh */ }
    return { trees: [], states: {}, activeId: null };
  }
  function saveDB() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(DB)); }
    catch (e) { toast("Storage full: export your trees to keep them safe.", true); }
  }
  let DB = loadDB();
  const runtimes = new Map();   // treeId -> runtime
  const memoryStatic = new Map(); // treeId -> payload (quota fallback)
  function loadStatic(id) {
    if (memoryStatic.has(id)) return memoryStatic.get(id);
    try {
      const raw = localStorage.getItem(LS_STATIC + "." + id);
      if (raw) { const p = JSON.parse(raw); memoryStatic.set(id, p); return p; }
    } catch (e) { /* ignore */ }
    return null;
  }
  function saveStatic(id, payload) {
    memoryStatic.set(id, payload);
    try { localStorage.setItem(LS_STATIC + "." + id, JSON.stringify(payload)); }
    catch (e) { toast("Tree too big for browser storage; it will live in memory until you export it.", true); }
  }
  function getTree(id) { return DB.trees.find(t => t.id === id) || null; }
  function activeTree() { return getTree(DB.activeId); }
  function activeState() {
    const t = activeTree();
    if (!t) return null;
    if (!DB.states[t.id]) DB.states[t.id] = E.newState();
    return DB.states[t.id];
  }

  async function getRuntime(tree) {
    if (runtimes.has(tree.id)) return runtimes.get(tree.id);
    let rt;
    if (tree.static) {
      const payload = loadStatic(tree.id);
      if (!payload) throw new Error("static tree data missing (re-import the file)");
      rt = G.buildRuntime(payload);
    } else {
      const res = await G.generate(DATA.entries, tree.seed, tree.params || {}, {
        limit: tree.limit || null,
        includeGachaOnly: !!(tree.params && tree.params.includeGachaOnly)
      }, () => {});
      rt = G.buildRuntime(res);
    }
    const st = DB.states[tree.id] || E.newState();
    E.applySwaps(rt, st);
    E.applyAddedLinks(rt, st);
    runtimes.set(tree.id, rt);
    return rt;
  }
  function dropRuntime(id) { runtimes.delete(id); }

  // ---- tabs --------------------------------------------------------------
  let currentTab = "trees";
  document.querySelectorAll("#tabs button").forEach(b => {
    b.addEventListener("click", () => showTab(b.dataset.tab));
  });
  function showTab(name) {
    currentTab = name;
    document.querySelectorAll("#tabs button").forEach(b =>
      b.classList.toggle("active", b.dataset.tab === name));
    document.querySelectorAll(".tabpage").forEach(p =>
      p.classList.toggle("active", p.id === "tab-" + name));
    if (name === "view3d") requestAnimationFrame(draw3D);
    if (name === "node") renderNode();
    if (name === "tickets") renderTickets();
    if (name === "trees") renderTrees();
  }

  // ---- trees tab ---------------------------------------------------------
  function uid() {
    return Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
  }
  function renderTrees() {
    const ul = $("treeList");
    $("treeCount").textContent = DB.trees.length
      ? `${DB.trees.length} tree${DB.trees.length > 1 ? "s" : ""} · active: ${activeTree() ? activeTree().name : "none"}`
      : "No trees yet — generate one below.";
    ul.innerHTML = "";
    for (const t of DB.trees) {
      const st = DB.states[t.id];
      const li = document.createElement("li");
      li.innerHTML =
        `<div class="grow"><b>${esc(t.name)}</b><br>` +
        `<span class="muted small">${t.static ? "imported file" : "seed " + esc(String(t.seed)) + (t.limit ? " · " + t.limit + " entries" : " · full")}
        ${st ? " · " + st.unlocked.length + " unlocked · " + E.fmt(st.points) + " pts · " + st.cores + " cores" : ""}</span></div>`;
      const open = document.createElement("button");
      open.textContent = t.id === DB.activeId ? "Active ✓" : "Open";
      open.disabled = t.id === DB.activeId;
      open.addEventListener("click", async () => {
        DB.activeId = t.id; saveDB(); renderTrees(); refreshAll();
        try { await getRuntime(t); showTab("view3d"); }
        catch (e) { err(e); }
      });
      const ren = document.createElement("button");
      ren.textContent = "✎";
      ren.title = "Rename";
      ren.addEventListener("click", () => {
        const name = prompt("Rename tree:", t.name);
        if (name && name.trim()) { t.name = name.trim().slice(0, 60); saveDB(); renderTrees(); }
      });
      const del = document.createElement("button");
      del.textContent = "🗑"; del.className = "danger"; del.title = "Delete";
      del.addEventListener("click", () => {
        if (!confirm(`Delete "${t.name}" and its saved progress?`)) return;
        DB.trees = DB.trees.filter(x => x.id !== t.id);
        delete DB.states[t.id];
        try { localStorage.removeItem(LS_STATIC + "." + t.id); } catch (e) {}
        memoryStatic.delete(t.id); dropRuntime(t.id);
        if (DB.activeId === t.id) DB.activeId = DB.trees.length ? DB.trees[0].id : null;
        saveDB(); renderTrees(); refreshAll();
      });
      li.append(open, ren, del);
      ul.appendChild(li);
    }
  }

  $("btnCreate").addEventListener("click", async () => {
    const name = ($("newName").value.trim() || "Untitled tree").slice(0, 60);
    const seed = parseInt($("newSeed").value, 10) || Math.floor(Math.random() * 1e9);
    const limit = $("newSize").value ? parseInt($("newSize").value, 10) : null;
    const params = {
      meanDegree: parseFloat($("newDegree").value) || 2.5,
      rejoinBias: Math.max(0, Math.min(1, parseFloat($("newRejoin").value || "0.7")))
    };
    const btn = $("btnCreate");
    btn.disabled = true;
    $("genProg").style.display = "block";
    const bar = $("genProg").firstElementChild;
    try {
      const res = await G.generate(DATA.entries, seed, params, { limit }, (frac, label) => {
        bar.style.width = Math.round(frac * 100) + "%";
        $("genMsg").textContent = `${label}… ${Math.round(frac * 100)}%`;
      });
      const tree = { id: uid(), name, seed, params, limit, createdAt: Date.now() };
      DB.trees.push(tree);
      DB.states[tree.id] = E.newState();
      DB.activeId = tree.id;
      dropRuntime(tree.id);
      runtimes.set(tree.id, G.buildRuntime(res));
      saveDB(); renderTrees(); refreshAll();
      $("genMsg").textContent = `Generated ${res.nodes.length} nodes.`;
      showTab("view3d");
    } catch (e) { err(e); }
    btn.disabled = false;
    setTimeout(() => { $("genProg").style.display = "none"; }, 1200);
  });

  $("btnExport").addEventListener("click", () => {
    const t = activeTree();
    if (!t) return toast("No active tree to export.", true);
    const payload = {
      app: "chaos-tree", v: 1, exportedAt: new Date().toISOString(),
      tree: { name: t.name, seed: t.seed, params: t.params || {}, limit: t.limit || null,
              static: !!t.static, topology: t.static ? loadStatic(t.id) : null },
      state: DB.states[t.id] || E.newState()
    };
    const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = t.name.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").toLowerCase() + ".chaos-tree.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  });
  $("btnImport").addEventListener("click", () => $("fileImport").click());
  $("fileImport").addEventListener("change", async () => {
    const f = $("fileImport").files[0];
    if (!f) return;
    try {
      const payload = JSON.parse(await f.text());
      if (payload && payload.app === "chaos-tree" && payload.tree) {
        const td = payload.tree;
        const tree = { id: uid(), name: String(td.name || f.name).slice(0, 60),
          seed: td.seed != null ? td.seed : Math.floor(Math.random() * 1e9),
          params: td.params || {}, limit: td.limit || null,
          static: !!td.static, createdAt: Date.now() };
        if (td.static && td.topology) saveStatic(tree.id, td.topology);
        DB.trees.push(tree);
        DB.states[tree.id] = Object.assign(E.newState(), payload.state || {});
        DB.activeId = tree.id; saveDB(); renderTrees(); refreshAll();
        toast(`Imported "${tree.name}".`);
        showTab("view3d");
      } else if (payload && payload.format === "chaos-tree" && payload.nodes && payload.edges) {
        const tree = { id: uid(), name: f.name.replace(/\.json$/i, "").slice(0, 60),
          seed: payload.seed != null ? payload.seed : 0, params: {}, limit: null,
          static: true, createdAt: Date.now() };
        saveStatic(tree.id, { nodes: payload.nodes, edges: payload.edges });
        DB.trees.push(tree);
        DB.states[tree.id] = E.newState();
        DB.activeId = tree.id; saveDB(); renderTrees(); refreshAll();
        toast(`Imported Python tree "${tree.name}".`);
        showTab("view3d");
      } else throw new Error("unrecognised file (need a chaos-tree export or Python tree JSON)");
    } catch (e) { err(e); }
    $("fileImport").value = "";
  });

  // ---- selection + refresh -------------------------------------------------
  let selectedId = null;
  async function current() {
    const t = activeTree();
    if (!t) return null;
    try {
      const rt = await getRuntime(t);
      return { tree: t, rt, st: activeState() };
    } catch (e) { err(e); return null; }
  }
  async function refreshAll() {
    renderTrees();
    if (currentTab === "view3d") draw3D();
    if (currentTab === "node") await renderNode();
    if (currentTab === "tickets") await renderTickets();
    updateViewInfo();
  }
  async function mutate(fn) {
    const c = await current();
    if (!c) return null;
    try {
      const out = fn(c);
      saveDB();
      await refreshAll();
      return out === undefined ? true : out;
    } catch (e) { err(e); return null; }
  }

  // ---- 3D view ---------------------------------------------------------------
  const PROJ_F = 3.0; // perspective focal length
  const cam = { yaw: 0.6, pitch: 0.35, dist: 3.2, zoom: 1 };
  const canvas = $("view3d");
  const ctx = canvas.getContext("2d");
  let projected = []; // [{id,x,y,r,node,vis}]
  let lastFitKey = "";
  // Frame the shown nodes: with only the root + one neighbour unlocked the
  // sphere is mostly empty, so magnify (zoom) in; as the tree fills out,
  // ease back to ~full-sphere framing. Runs only when the shown set changes,
  // so manual zoom/rotate is never overridden mid-session.
  function maybeAutoFit(d) {
    const key = d.tree.id + ":" + d.st.unlocked.length + ":" + d.vis.size + ":" +
      (d.st.swaps || []).length + ":" + (d.st.added_links || []).length;
    if (key === lastFitKey) return;
    lastFitKey = key;
    const shown = [];
    let maxR = 0.12;
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (const nd of d.rt.nodes) {
      if (!d.vis.has(nd.id) && !d.unl.has(nd.id)) continue;
      const p = nd.pos;
      shown.push(p);
      const r = Math.hypot(p[0], p[1], p[2]);
      if (r > maxR) maxR = r;
      if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0];
      if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1];
      if (p[2] < z0) z0 = p[2]; if (p[2] > z1) z1 = p[2];
    }
    cam.dist = Math.max(1.05, Math.min(4.2, 1.05 + maxR * 2.15));
    const proj = PROJ_F / (PROJ_F + cam.dist); // scale at origin
    // zoom so the shown cloud's diameter fills ~60% of the smaller side
    const spreadWorld = Math.max(0.04, Math.hypot(x1 - x0, y1 - y0, z1 - z0));
    cam.zoom = Math.max(1, Math.min(15, 1.476 / (spreadWorld * proj)));
    // With only a few nodes out, the default angle can stack them along the
    // view axis (one hidden dot). Pick an angle that spreads them on screen
    // (full perspective projection, so foreshortening counts).
    if (shown.length > 1 && shown.length <= 8) {
      const spread = (yw, pt) => {
        const cy = Math.cos(yw), sy = Math.sin(yw);
        const cp = Math.cos(pt), sp = Math.sin(pt);
        let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
        for (const p of shown) {
          const x = p[0] * cy - p[2] * sy, z = p[0] * sy + p[2] * cy;
          const y2 = p[1] * cp - z * sp, z2 = p[1] * sp + z * cp;
          const s = PROJ_F / (PROJ_F + z2 + cam.dist);
          const sx = x * s, syy = y2 * s;
          if (sx < x0) x0 = sx; if (sx > x1) x1 = sx;
          if (syy < y0) y0 = syy; if (syy > y1) y1 = syy;
        }
        return Math.hypot(x1 - x0, y1 - y0);
      };
      let best = null;
      for (let i = 0; i < 8; i++) {
        for (const pt of [0.2, 0.55, 0.95]) {
          const yw = (i / 8) * Math.PI * 2;
          const sp = spread(yw, pt);
          if (!best || sp > best[0]) best = [sp, yw, pt];
        }
      }
      if (best && best[0] > 1e-6) { cam.yaw = best[1]; cam.pitch = best[2]; }
    }
  }
  window.__treeDebug = { cam, getProjected: () => projected };
  function fitCanvas() {
    const r = canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.round(r.width * dpr));
    canvas.height = Math.max(1, Math.round(r.height * dpr));
  }
  window.addEventListener("resize", () => { fitCanvas(); draw3D(); });

  function project(p) {
    const { yaw, pitch, dist } = cam;
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    let x = p[0] * cy - p[2] * sy, z = p[0] * sy + p[2] * cy, y = p[1];
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const y2 = y * cp - z * sp, z2 = y * sp + z * cp;
    const scale = PROJ_F / (PROJ_F + z2 + dist);
    return [x * scale, y2 * scale, scale];
  }

  async function viewData() {
    const c = await current();
    if (!c) return null;
    const meta = E.viewState(c.rt, c.st);
    const vis = new Set(E.visible(c.rt, c.st.unlocked, meta));
    const unl = new Set(c.st.unlocked);
    return { ...c, meta, vis, unl };
  }
  async function updateViewInfo() {
    const d = await viewData();
    if (!d) { $("viewInfo").textContent = "No tree selected."; return; }
    $("viewInfo").textContent =
      `${esc(d.tree.name)} · ${d.st.unlocked.length}/${d.rt.nodes.length} unlocked · ${d.vis.size} visible`;
  }
  async function draw3D() {
    fitCanvas();
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    const d = await viewData();
    if (!d) return;
    updateViewInfo();
    maybeAutoFit(d);
    const cx = W / 2, cy = H / 2, base = Math.min(W, H) * 0.42 * cam.zoom;
    // edges between shown nodes
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(140,150,175,0.28)";
    ctx.beginPath();
    for (const nd of d.rt.nodes) {
      if (!d.vis.has(nd.id) && !d.unl.has(nd.id)) continue;
      for (const b of (d.rt.adj[nd.id] || [])) {
        if (b < nd.id) continue;
        if (!d.vis.has(b) && !d.unl.has(b)) continue;
        const [x1, y1] = project(nd.pos), [x2, y2] = project(d.rt.byId[b].pos);
        ctx.moveTo(cx + x1 * base, cy - y1 * base);
        ctx.lineTo(cx + x2 * base, cy - y2 * base);
      }
    }
    ctx.stroke();
    // nodes, far first
    const items = [];
    for (const nd of d.rt.nodes) {
      if (!d.vis.has(nd.id) && !d.unl.has(nd.id)) continue;
      const [x, y, s] = project(nd.pos);
      items.push({ nd, x: cx + x * base, y: cy - y * base, s });
    }
    items.sort((a, b) => a.s - b.s);
    projected = [];
    const dotScale = Math.min(cam.zoom, 3.5);
    for (const it of items) {
      const unlocked = d.unl.has(it.nd.id);
      const col = catColor(it.nd.file);
      const rad = Math.max(2, Math.min(10, (unlocked ? 3.4 : 2.6) + it.nd.rarity * 0.55)) * dotScale * (window.devicePixelRatio || 1) / 1.5;
      ctx.beginPath();
      ctx.arc(it.x, it.y, rad, 0, Math.PI * 2);
      if (unlocked) { ctx.fillStyle = col; ctx.fill(); }
      else { ctx.globalAlpha = 0.55; ctx.fillStyle = "#20242e"; ctx.fill(); ctx.strokeStyle = col; ctx.stroke(); ctx.globalAlpha = 1; }
      if (it.nd.id === selectedId) {
        ctx.beginPath(); ctx.arc(it.x, it.y, rad + 4, 0, Math.PI * 2);
        ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; ctx.stroke(); ctx.lineWidth = 1;
      }
      projected.push({ id: it.nd.id, x: it.x, y: it.y, r: rad + 8, name: `#${it.nd.id} ${it.nd.name} · ${it.nd.rarity}` });
    }
    if (selectedId != null && d.rt.byId[selectedId]) {
      const nd = d.rt.byId[selectedId];
      $("selInfo").textContent =
        `#${nd.id} ${nd.name} [${nd.file} | ${nd.source}] rarity ${nd.rarity}` +
        (d.unl.has(nd.id) ? " · unlocked" : " · locked");
    }
  }

  (function bindCamera() {
    const pts = new Map();
    let lastPinch = 0, moved = 0;
    const tip = $("hoverTip");
    function hideTip() { tip.style.display = "none"; }
    function hover(e) {
      const r = canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const x = (e.clientX - r.left) * dpr, y = (e.clientY - r.top) * dpr;
      let best = null, bd = 1e9;
      // need runtime names: look up via the last drawn frame's ids
      for (const p of projected) {
        const d = Math.hypot(p.x - x, p.y - y);
        if (d < p.r && d < bd) { bd = d; best = p; }
      }
      if (best && best.name) {
        tip.textContent = best.name;
        tip.style.display = "block";
        tip.style.left = (e.clientX - r.left) + "px";
        tip.style.top = (e.clientY - r.top) + "px";
      } else hideTip();
    }
    canvas.addEventListener("pointerdown", e => {
      canvas.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, [e.clientX, e.clientY]);
      moved = 0;
    });
    canvas.addEventListener("pointermove", e => {
      if (e.pointerType !== "touch" && !pts.has(e.pointerId)) { hover(e); return; }
      if (!pts.has(e.pointerId)) return;
      hideTip();
      const prev = pts.get(e.pointerId);
      pts.set(e.pointerId, [e.clientX, e.clientY]);
      moved += Math.abs(e.clientX - prev[0]) + Math.abs(e.clientY - prev[1]);
      if (pts.size === 1) {
        cam.yaw += (e.clientX - prev[0]) * 0.008;
        cam.pitch = Math.max(-1.4, Math.min(1.4, cam.pitch + (e.clientY - prev[1]) * 0.008));
        draw3D();
      } else if (pts.size === 2) {
        const [p, q] = [...pts.values()];
        const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
        if (lastPinch) cam.zoom = Math.max(0.3, Math.min(15, cam.zoom * (d / lastPinch)));
        lastPinch = d;
        draw3D();
      }
    });
    const up = e => {
      pts.delete(e.pointerId);
      if (pts.size < 2) lastPinch = 0;
      if (moved < 8) tapSelect(e);
    };
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    canvas.addEventListener("pointerleave", hideTip);
    canvas.addEventListener("wheel", e => {
      e.preventDefault();
      cam.zoom = Math.max(0.3, Math.min(15, cam.zoom * (1 - e.deltaY * 0.0015)));
      draw3D();
    }, { passive: false });

    function tapSelect(e) {
      const r = canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const x = (e.clientX - r.left) * dpr, y = (e.clientY - r.top) * dpr;
      let best = null, bd = 1e9;
      for (const p of projected) {
        const d = Math.hypot(p.x - x, p.y - y);
        if (d < p.r && d < bd) { bd = d; best = p.id; }
      }
      if (best != null) {
        selectedId = best;
        draw3D();
        showTab("node");
      }
    }
  })();
  $("btnResetCam").addEventListener("click", () => {
    cam.yaw = 0.6; cam.pitch = 0.35;
    lastFitKey = ""; // force re-fit on next draw
    draw3D();
  });

  // ---- node tab (detail + 2D neighbours) --------------------------------------
  function shortName(s) {
    s = String(s == null ? "" : s);
    return s.length > 16 ? s.slice(0, 15) + "…" : s;
  }
  function nodeLine(nd, unl, extra) {
    const cls = classOf(nd.rarity);
    return `<div><span class="dot" style="background:${esc(cls.color)}"></span>` +
      `<b>#${nd.id} ${esc(nd.name)}</b> <span class="pill">${esc(nd.file)}</span> ` +
      `<span class="pill">${esc(nd.source || "—")}</span></div>` +
      `<div class="small muted">${esc(cls.name)} · rarity ${nd.rarity} · cost ${unl ? "—" : E.fmt(Math.pow(10, nd.rarity))}` +
      (extra || "") + `</div>` +
      (nd.description ? `<p class="small">${esc(nd.description)}</p>` : "");
  }
  async function renderNode() {
    const card = $("nodeCard"), svg = $("nbrSvg");
    svg.innerHTML = "";
    const c = await current();
    if (!c) { card.innerHTML = "<h2>No tree selected</h2>"; return; }
    if (selectedId == null || !c.rt.byId[selectedId]) {
      const first = c.rt.byId[0] ? [...(c.rt.adj[0] || [])][0] : null;
      selectedId = first != null ? first : 0;
    }
    const nd = c.rt.byId[selectedId];
    const meta = E.viewState(c.rt, c.st);
    const unl = c.st.unlocked.includes(nd.id);
    const front = E.frontier(c.rt, c.st.unlocked).has(nd.id);
    let actions = "";
    if (!unl && nd.id !== 0) {
      if (front) {
        const cost = E.nodeCostFor(c.st, c.rt, nd.id);
        const ok = c.st.cores >= 1 && c.st.points >= cost;
        actions = `<div class="row" style="margin-top:8px"><button class="primary" data-act="unlock" ${ok ? "" : "disabled"}>` +
          `Unlock (${E.fmt(cost)} pts + 1 core)</button></div>` +
          (ok ? "" : `<div class="muted small" style="margin-top:4px">Needs 1 core + ${E.fmt(cost)} pts (have ${c.st.cores} / ${E.fmt(c.st.points)}).</div>`);
      } else {
        actions = `<div class="muted small" style="margin-top:8px">Not adjacent — reach it with a skip / jump / hop ticket (Tickets tab).</div>`;
      }
    } else if (unl) {
      actions = `<div class="muted small" style="margin-top:8px">Unlocked ✓</div>`;
    }
    card.innerHTML = `<h2>Selected node</h2>` + nodeLine(nd, unl) + actions;
    const ub = card.querySelector('[data-act="unlock"]');
    if (ub) ub.addEventListener("click", async () => {
      const ok = await mutate(({ st, rt }) => E.unlock(st, rt, nd.id));
      if (ok) toast(`Unlocked ${nd.name}.`);
    });

    // 2D neighbour view: center + ring. Only neighbours you can actually
    // see (unlocked, frontier, or revealed by an ability) are shown; hidden
    // nodes stay hidden. Normal unlocks stay frontier-only (engine-enforced);
    // abilities (lifeline/gacha/duplicate/…) are the only other paths.
    const NS = "http://www.w3.org/2000/svg";
    const cx = 180, cyy = 150, R0 = 96;
    const unlSet = new Set(c.st.unlocked);
    const vis = new Set(E.visible(c.rt, c.st.unlocked, meta));
    const nbs = [...(c.rt.adj[nd.id] || [])]
      .filter(b => unlSet.has(b) || vis.has(b))
      .sort((a, b) => a - b);
    function circle(x, y, r, fill, stroke, id, label) {
      const g = document.createElementNS(NS, "g");
      g.style.cursor = "pointer";
      const ci = document.createElementNS(NS, "circle");
      ci.setAttribute("cx", x); ci.setAttribute("cy", y); ci.setAttribute("r", r);
      ci.setAttribute("fill", fill); ci.setAttribute("stroke", stroke || "#333947");
      g.appendChild(ci);
      const t = document.createElementNS(NS, "text");
      t.setAttribute("x", x); t.setAttribute("y", y + r + 13);
      t.setAttribute("text-anchor", "middle");
      t.setAttribute("fill", "#9aa0b0"); t.setAttribute("font-size", "10");
      t.textContent = label;
      g.appendChild(t);
      g.addEventListener("click", () => { selectedId = id; renderNode(); });
      svg.appendChild(g);
    }
    for (const b of nbs) {
      const i = nbs.indexOf(b), a = (2 * Math.PI * i) / Math.max(1, nbs.length) - Math.PI / 2;
      const x = cx + R0 * Math.cos(a), y = cyy + R0 * Math.sin(a);
      const l = document.createElementNS(NS, "line");
      l.setAttribute("x1", cx); l.setAttribute("y1", cyy);
      l.setAttribute("x2", x); l.setAttribute("y2", y);
      l.setAttribute("stroke", "#333947");
      svg.appendChild(l);
    }
    circle(cx, cyy, 26, catColor(nd.file), "#fff", nd.id, shortName(nd.name));
    nbs.forEach((b, i) => {
      const a = (2 * Math.PI * i) / Math.max(1, nbs.length) - Math.PI / 2;
      const x = cx + R0 * Math.cos(a), y = cyy + R0 * Math.sin(a);
      const bnd = c.rt.byId[b];
      const isUnl = c.st.unlocked.includes(b);
      circle(x, y, 15, isUnl ? catColor(bnd.file) : "#20242e",
        catColor(bnd.file), b, shortName(bnd.name));
    });
    const legend = document.createElementNS(NS, "text");
    legend.setAttribute("x", 8); legend.setAttribute("y", 292);
    legend.setAttribute("fill", "#9aa0b0"); legend.setAttribute("font-size", "10");
    const totalConns = new Set(c.rt.adj[nd.id] || []).size;
    const hidden = totalConns - nbs.length;
    legend.textContent = `${nd.name} — ${nbs.length} shown` +
      (hidden ? ` · ${hidden} hidden` : "") + " (tap a dot to inspect)";
    svg.appendChild(legend);
  }

  // ---- tickets tab --------------------------------------------------------------
  const TICKET_TIERS = ["bronze", "silver", "gold", "platinum", "diamond", "legendary", "mythical", "divine", "transcendent"];
  function fillTicketForm() {
    $("tkTier").innerHTML = TICKET_TIERS.map(t => `<option>${t}</option>`).join("");
    $("tkCat").innerHTML = E.CATEGORIES.map(c => `<option>${c}</option>`).join("");
  }
  function ticketLabel(t) {
    let s = `${t.tier || "tierless"} ${t.kind}`;
    if (t.kind === "skip" || t.kind === "choice") s += ` ${t.n}`;
    if (t.category) s += ` ${t.category}`;
    return s;
  }
  function nodeOptions(ids, rt, extra) {
    return ids.map(id => {
      const nd = rt.byId[id];
      return `<option value="${id}">#${id} ${esc(nd.name)} (${nd.file}, ${nd.rarity}${extra ? ", " + extra(nd) : ""})</option>`;
    }).join("");
  }

  async function renderTickets() {
    const c = await current();
    const inv = $("invList"), meta = $("metaBox");
    if (!c) {
      inv.innerHTML = "<li class='muted'>No tree selected.</li>";
      return;
    }
    const { st, rt } = c;
    const m = E.viewState(rt, st);
    $("wPoints").textContent = E.fmt(st.points);
    $("wCores").textContent = st.cores;
    $("wBonus").textContent = `+${m.ticket_bonus}%`;
    const echoLeft = m.echo - (st.echo_used || 0);
    const bits = [];
    if (m.sight) bits.push(`sight+${m.sight}`);
    if (m.see_far) bits.push("see-far");
    if (m.survey) bits.push(`survey+${m.survey}`);
    if (m.trace_name) bits.push("trace-name");
    if (m.trace_desc) bits.push("trace-desc");
    if (m.compass) bits.push("compass");
    if (m.reveal_full) bits.push("reveal-full");
    if (echoLeft > 0) bits.push(`echo×${echoLeft}`);
    if (m.root_pact) bits.push("root-pact");
    if (Object.keys(m.cat_sight).length) bits.push("cat-sight");
    for (const k of ["lock_refund", "add_link", "gacha", "lifeline", "recall", "duplicate", "shuffle", "swap"]) {
      if (m[k]) bits.push(`${k.replace(/_/g, "-")}×${m[k] - ((st.meta_used || {})[k] || 0)}`);
    }
    if (m.reshuffle) bits.push("reshuffle");
    $("wMeta").textContent = bits.length ? bits.join(", ") : "none";

    // inventory
    inv.innerHTML = "";
    if (!st.inventory.length) inv.innerHTML = "<li class='muted'>No tickets — award one above.</li>";
    st.inventory.forEach((t, idx) => {
      const li = document.createElement("li");
      li.innerHTML = `<div class="grow"><b>${esc(ticketLabel(t))}</b></div>`;
      const ctl = document.createElement("div");
      ctl.className = "row";
      ctl.style.marginTop = "6px";
      const useBtn = (label, fn) => {
        const b = document.createElement("button");
        b.textContent = label; b.className = "primary";
        b.addEventListener("click", async () => {
          const ok = await mutate(fn);
          if (ok) toast("Done.");
        });
        return b;
      };
      if (t.kind === "skip") {
        const { dist } = E.hopDistances(rt, st.unlocked);
        const cands = rt.nodes.filter(nd => !st.unlocked.includes(nd.id) && nd.id !== 0 &&
          (dist[nd.id] != null && dist[nd.id] <= 1 + t.n)).map(nd => nd.id);
        const sel = document.createElement("select");
        sel.innerHTML = nodeOptions(cands, rt, nd => "cost " + E.fmt(E.nodeCost(rt, nd.id)));
        ctl.append(sel, useBtn(`Skip →`, ({ st, rt }) => E.unlockSkip(st, rt, parseInt(sel.value, 10), t.n)));
      } else if (t.kind === "jump" || t.kind === "choice") {
        const fromSel = document.createElement("select");
        fromSel.innerHTML = nodeOptions(st.unlocked.filter(u => u !== 0), rt);
        const cat = t.category;
        const showCands = () => {
          const list = E.jumpCandidates(rt, cat, parseInt(fromSel.value, 10), st.unlocked)
            .slice(0, t.kind === "choice" ? t.n : 1);
          pickSel.innerHTML = list.map(([dd, nd], i) =>
            `<option value="${i}">#${nd.id} ${esc(nd.name)} (${nd.rarity})</option>`).join("");
        };
        const pickSel = document.createElement("select");
        fromSel.addEventListener("change", showCands);
        ctl.append(fromSel, pickSel);
        showCands();
        ctl.append(useBtn(t.kind === "choice" ? "Choice jump →" : "Jump →",
          ({ st, rt }) => E.unlockJump(st, rt, cat, parseInt(fromSel.value, 10), parseInt(pickSel.value || "0", 10))));
      } else if (t.kind === "hop") {
        const { dist } = E.hopDistances(rt, st.unlocked);
        const cands = rt.nodes.filter(nd => !st.unlocked.includes(nd.id) && (dist[nd.id] || 0) >= 2).map(nd => nd.id);
        const sel = document.createElement("select");
        sel.innerHTML = nodeOptions(cands.slice(0, 400), rt);
        ctl.append(sel, useBtn("Hop →", ({ st, rt }) => E.unlockHop(st, rt, parseInt(sel.value, 10))));
      } else {
        const span = document.createElement("span");
        span.className = "muted small";
        span.textContent = "spent via Unlock buttons";
        ctl.appendChild(span);
      }
      const wrap = document.createElement("div");
      wrap.style.width = "100%";
      wrap.appendChild(ctl);
      li.appendChild(wrap);
      inv.appendChild(li);
    });

    // meta abilities
    meta.innerHTML = "";
    const vis = E.visible(rt, st.unlocked, m);
    const unl = new Set(st.unlocked);
    const lockedVisIds = vis.filter(id => !unl.has(id));
    const used = k => (st.meta_used || {})[k] || 0;
    function addMeta(title, desc, controls) {
      const d = document.createElement("details");
      const s = document.createElement("summary");
      s.textContent = title;
      d.appendChild(s);
      const p = document.createElement("p");
      p.className = "muted small"; p.textContent = desc;
      d.appendChild(p);
      d.appendChild(controls);
      meta.appendChild(d);
    }
    function btn(label, fn) {
      const b = document.createElement("button");
      b.textContent = label; b.className = "primary";
      b.addEventListener("click", async () => {
        const ok = await mutate(fn);
        if (ok) toast("Done.");
      });
      return b;
    }
    function nodeSel(ids, costFn) {
      const sel = document.createElement("select");
      sel.innerHTML = nodeOptions(ids, rt, costFn);
      return sel;
    }
    let any = false;
    const have = (k) => m[k] - used(k) > 0;
    if (m.lock_refund && have("lock_refund")) {
      any = true;
      const sel = nodeSel(st.unlocked.filter(u => u !== 0), rt);
      const row = document.createElement("div"); row.className = "row";
      row.append(sel, btn("Lock + refund", ({ st, rt }) => E.useLockRefund(st, rt, parseInt(sel.value, 10))));
      addMeta(`Undo Stone ×${m.lock_refund - used("lock_refund")}`, "Lock an unlocked node, refund its core + points.", row);
    }
    if (m.add_link && have("add_link")) {
      any = true;
      const a = nodeSel(lockedVisIds, rt), b = nodeSel(lockedVisIds, rt);
      const row = document.createElement("div"); row.className = "row";
      row.append(a, b, btn("Graft link", ({ st, rt }) =>
        E.useAddLink(st, rt, parseInt(a.value, 10), parseInt(b.value, 10))));
      addMeta(`Tree Graft ×${m.add_link - used("add_link")}`, `Link two close unconnected nodes (≤ ${E.ADD_LINK_DISTANCE}).`, row);
    }
    if (m.reveal_temp && (st.reveal_temp_until || 0) < Date.now() / 1000) {
      any = true;
      addMeta("Glimpse", "Reveal the full tree for 10 seconds.",
        btn("Reveal 10s", ({ st, rt }) => E.useReveal(st, rt)));
    }
    if (m.gacha && have("gacha")) {
      any = true;
      addMeta(`Chaos Die ×${m.gacha - used("gacha")}`, `Random free unlock, rarity ${m.gacha_min}–${m.gacha_max}.`,
        btn("Roll", ({ st, rt }) => {
          const nd = E.useGacha(st, rt);
          selectedId = nd.id;
          toast(`Rolled #${nd.id} ${nd.name}.`);
        }));
    }
    if (m.lifeline && have("lifeline")) {
      any = true;
      const sel = nodeSel([...E.frontier(rt, st.unlocked)], rt);
      const row = document.createElement("div"); row.className = "row";
      row.append(sel, btn("Free unlock", ({ st, rt }) => E.useLifeline(st, rt, parseInt(sel.value, 10))));
      addMeta(`Lifeline ×${m.lifeline - used("lifeline")}`, "Free unlock of a frontier (adjacent) node.", row);
    }
    if (m.recall && have("recall")) {
      any = true;
      addMeta(`Recall ×${m.recall - used("recall")}`, "Undo your most recent unlock (refund core + points).",
        btn("Undo last unlock", ({ st, rt }) => E.useRecall(st, rt)));
    }
    if (m.duplicate && have("duplicate")) {
      any = true;
      addMeta(`Duplicate ×${m.duplicate - used("duplicate")}`, `Random unlock sharing an owned non-Generic source, rarity ≤ ${m.duplicate_max}.`,
        btn("Duplicate", ({ st, rt }) => {
          const nd = E.useDuplicate(st, rt);
          selectedId = nd.id;
          toast(`Duplicated #${nd.id} ${nd.name}.`);
        }));
    }
    if (m.shuffle && have("shuffle")) {
      any = true;
      const sel = nodeSel(lockedVisIds, rt);
      const row = document.createElement("div"); row.className = "row";
      row.append(sel, btn("Shuffle", ({ st, rt }) => E.useShuffle(st, rt, parseInt(sel.value, 10))));
      addMeta(`Shuffle ×${m.shuffle - used("shuffle")}`, "Swap a visible locked node with a random unseen one of similar rarity.", row);
    }
    if (m.swap && have("swap")) {
      any = true;
      const a = nodeSel(lockedVisIds, rt), b = nodeSel(lockedVisIds, rt);
      const row = document.createElement("div"); row.className = "row";
      row.append(a, b, btn("Swap", ({ st, rt }) => E.useSwap(st, rt, parseInt(a.value, 10), parseInt(b.value, 10))));
      addMeta(`Swap ×${m.swap - used("swap")}`, "Swap two visible locked nodes of your choice.", row);
    }
    if (m.reshuffle) {
      any = true;
      const sel = nodeSel(lockedVisIds, rt);
      const row = document.createElement("div"); row.className = "row";
      row.append(sel, btn("Reshuffle (¼ cost)", ({ st, rt }) => E.useReshuffle(st, rt, parseInt(sel.value, 10))));
      addMeta("Reshuffle (unlimited)", "Shuffle at a quarter of the node's points cost.", row);
    }
    if (!any) meta.innerHTML = "<span class='muted small'>Unlock tree-meta nodes (Sight, Graft, Chaos Die…) to gain abilities.</span>";
    const surveyed = E.surveyNames(rt, st.unlocked, m);
    if (surveyed.length) {
      const d = document.createElement("details");
      const s = document.createElement("summary");
      s.textContent = `Surveyed names (${surveyed.length})`;
      d.appendChild(s);
      const ul = document.createElement("ul");
      ul.className = "list";
      for (const [id, name] of surveyed.slice(0, 60)) {
        const li = document.createElement("li");
        li.innerHTML = `<div class="grow"><b>#${id} ${esc(name)}</b></div>`;
        const go = document.createElement("button");
        go.textContent = "View";
        go.addEventListener("click", () => { selectedId = id; showTab("node"); });
        li.appendChild(go);
        ul.appendChild(li);
      }
      d.appendChild(ul);
      meta.appendChild(d);
    }
  }

  $("btnAward").addEventListener("click", async () => {
    const tier = $("tkTier").value, kind = $("tkKind").value;
    const n = parseInt($("tkN").value, 10) || 2;
    const cat = $("tkCat").value;
    let spec = tier;
    if (kind === "skip") spec = `${tier} skip${n}`;
    else if (kind === "jump") spec = `${tier} ${cat} jump`;
    else if (kind === "choice") spec = `${tier} choice ${n} jump`;
    else if (kind === "hop") spec = `${tier} hop`;
    const ok = await mutate(({ st, rt }) => {
      const m = E.viewState(rt, st);
      const echoLeft = m.echo - (st.echo_used || 0);
      E.award(st, spec, m.ticket_bonus, echoLeft > 0);
    });
    if (ok) { toast(`Awarded ${spec}.`); }
  });

  $("btnTrace").addEventListener("click", async () => {
    const c = await current();
    if (!c) return;
    const field = $("trField").value, q = $("trQ").value.trim();
    const ul = $("traceList");
    ul.innerHTML = "";
    if (!q) return toast("Type something to trace.", true);
    try {
      const res = E.trace(c.rt, c.st, field, q, 5);
      if (!res.length) ul.innerHTML = "<li class='muted'>No matches.</li>";
      for (const r of res) {
        const li = document.createElement("li");
        li.innerHTML = `<div class="grow"><b>#${r.node.id} ${esc(r.node.name)}</b> ` +
          `<span class="pill">${r.dist} hop${r.dist === 1 ? "" : "s"}</span><br>` +
          `<span class="muted small">${esc(r.path.map(p => "#" + p).join(" → "))}</span></div>`;
        const go = document.createElement("button");
        go.textContent = "View";
        go.addEventListener("click", () => { selectedId = r.node.id; showTab("node"); });
        li.appendChild(go);
        ul.appendChild(li);
      }
    } catch (e) { err(e); }
  });

  // ---- boot ---------------------------------------------------------------
  fillTicketForm();
  renderTrees();
  if (DB.activeId && getTree(DB.activeId)) showTab("view3d");
  else showTab("trees");
  refreshAll();
})();
