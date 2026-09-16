"use strict";
/* Chaos Tree generator port (tools/generate_tree.py). Same structure and
 * rules; the seeded RNG differs from CPython's, so equal seeds do not give
 * bit-identical trees to the Python tool, but output is deterministic inside
 * this app and uses the identical JSON node/edge shape. */
window.ChaosGen = (function () {
  const R = window.ChaosRng;

  const DEFAULTS = {
    radius: 1.0, innerFraction: 0.12, distanceVariance: 0.15,
    clustering: 0.3, clusters: 3,
    degreeDist: "poisson", meanDegree: 2.5, degreeMin: 1, degreeMax: null,
    rejoinBias: 0.7, linkFalloff: 2.0, maxLinkDistance: 0.6,
    connect: true
  };

  function unitSphere(rng) {
    const z = rng.range(-1, 1), th = rng.range(0, 2 * Math.PI);
    const r = Math.sqrt(Math.max(0, 1 - z * z));
    return [r * Math.cos(th), r * Math.sin(th), z];
  }

  function norm3(v) {
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
  }

  function dist3(a, b) {
    return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  }

  function sampleDegree(rng, dist, mean, dmin, dmax) {
    let d;
    if (dist === "constant") d = Math.round(mean);
    else if (dist === "powerlaw") {
      const u = rng.random(), span = Math.max(1, dmax - dmin);
      d = dmin + Math.floor(span * Math.pow(1 - u, 2));
    } else d = R.poisson(rng, mean);
    return Math.max(dmin, Math.min(dmax, d));
  }

  function filterEntries(entries, opts) {
    const files = opts.files && opts.files.length ? opts.files
      : ["skill", "trait", "familiar", "item", "ability"];
    return entries.filter(e =>
      files.includes(e.f) &&
      (e.t !== "gacha" || opts.includeGachaOnly) &&
      (opts.rarityMin == null || e.r >= opts.rarityMin) &&
      (opts.rarityMax == null || e.r <= opts.rarityMax) &&
      (!opts.sources || !opts.sources.length || opts.sources.includes(e.s)));
  }

  // onStep(frac, label) is called periodically so the UI can show progress.
  // Implemented synchronously in chunks via awaited slices.
  async function generate(entries, seed, params, opts, onStep) {
    const P = Object.assign({}, DEFAULTS, params || {});
    const rng = R.make(seed);
    let items = filterEntries(entries, opts || {});
    if (!items.length) throw new Error("no entries match the given filters");
    if (opts && opts.limit && opts.limit < items.length) {
      items = rng.sample(items, opts.limit);
    }
    const n = items.length;
    const radius = P.radius, inner = P.innerFraction;
    const rmin = Math.min(...items.map(i => i.r));
    const rmax = Math.max(...items.map(i => i.r));
    const span = (rmax - rmin) || 1.0;

    const anchors = [];
    for (let k = 0; k < Math.max(1, P.clusters); k++) anchors.push(unitSphere(rng));
    const cp = Math.max(0, Math.min(1, P.clustering));

    const nodes = [];
    for (let idx = 0; idx < n; idx++) {
      const item = items[idx];
      const t = (item.r - rmin) / span;
      let radial = radius * (inner + (1 - inner) * t);
      if (P.distanceVariance > 0) radial += rng.gauss() * P.distanceVariance * radius;
      radial = Math.max(radius * 0.05, Math.min(radius, radial));
      let d = unitSphere(rng);
      if (cp > 0 && rng.random() < cp) {
        const a = anchors[rng.int(anchors.length)];
        d = norm3([(1 - cp) * d[0] + cp * a[0],
                   (1 - cp) * d[1] + cp * a[1],
                   (1 - cp) * d[2] + cp * a[2]]);
      }
      const pos = [radial * d[0], radial * d[1], radial * d[2]]
        .map(c => Math.round(c * 1e6) / 1e6);
      nodes.push({
        id: idx, file: item.f, number: item.n, name: item.name,
        rarity: item.r, source: item.s, tag: item.t, description: item.d,
        meta: (item.m || []).slice(), pos,
        r: Math.round(radial * 1e6) / 1e6
      });
      if (onStep && idx % 500 === 0) {
        onStep(idx / n * 0.35, "placing nodes");
        await new Promise(res => setTimeout(res, 0));
      }
    }

    const degMax = P.degreeMax || Math.min(n - 1, Math.max(2, Math.round(P.meanDegree * 6)));
    let targets = nodes.map(() => sampleDegree(rng, P.degreeDist, P.meanDegree, P.degreeMin, degMax));
    if (P.degreeMin > 0 && n > 1) targets = targets.map(t => Math.max(P.degreeMin, t));

    const maxd = P.maxLinkDistance * radius;
    const falloff = Math.max(0, P.linkFalloff);
    const bias = Math.max(0, Math.min(1, P.rejoinBias));
    const adj = nodes.map(() => new Set());
    const edges = [];

    const parent = nodes.map((_, i) => i);
    function find(x) {
      while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; }
      return x;
    }
    function union(a, b) {
      const ra = find(a), rb = find(b);
      if (ra !== rb) parent[ra] = rb;
    }

    const cell = maxd > 0 ? maxd : radius;
    const grid = new Map();
    nodes.forEach((nd, i) => {
      const key = gridKey(nd.pos, cell);
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key).push(i);
    });
    function gridKey(p, c) {
      return Math.floor(p[0] / c) + "," + Math.floor(p[1] / c) + "," + Math.floor(p[2] / c);
    }
    function candidates(a) {
      const p = nodes[a].pos;
      const cx = Math.floor(p[0] / cell), cy = Math.floor(p[1] / cell), cz = Math.floor(p[2] / cell);
      const out = [];
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
        const cellNodes = grid.get((cx + dx) + "," + (cy + dy) + "," + (cz + dz));
        if (!cellNodes) continue;
        for (const b of cellNodes) {
          if (b === a || adj[a].has(b)) continue;
          const d = dist3(nodes[a].pos, nodes[b].pos);
          if (d <= maxd) out.push([b, d]);
        }
      }
      return out;
    }

    const order = rng.shuffle(nodes.map((_, i) => i));
    let done = 0;
    for (const a of order) {
      while (adj[a].size < targets[a]) {
        const cands = candidates(a);
        if (!cands.length) break;
        const scores = cands.map(([b, d]) => {
          let s = falloff > 0 ? Math.pow(1.0 - d / maxd, falloff) : 1.0;
          if (bias > 0 && find(a) === find(b)) s *= (1.0 - bias);
          return Math.max(0, s);
        });
        const total = scores.reduce((x, y) => x + y, 0);
        if (total <= 0) break;
        const pick = rng.random() * total;
        let acc = 0, chosen = cands[cands.length - 1][0];
        for (let i = 0; i < cands.length; i++) {
          acc += scores[i];
          if (acc >= pick) { chosen = cands[i][0]; break; }
        }
        edges.push({ a, b: chosen, d: Math.round(dist3(nodes[a].pos, nodes[chosen].pos) * 1e6) / 1e6 });
        adj[a].add(chosen); adj[chosen].add(a);
        union(a, chosen);
      }
      done++;
      if (onStep && done % 500 === 0) {
        onStep(0.35 + done / n * 0.55, "linking nodes");
        await new Promise(res => setTimeout(res, 0));
      }
    }

    if (P.connect && n > 1) {
      let comp = new Set(nodes.map((_, i) => find(i)));
      while (comp.size > 1) {
        let best = null;
        for (let a = 0; a < n; a++) {
          for (const [b, d] of candidates(a)) {
            if (find(a) === find(b)) continue;
            if (!best || d < best[0]) best = [d, a, b];
          }
        }
        if (!best) {
          const reps = new Map();
          for (let i = 0; i < n; i++) if (!reps.has(find(i))) reps.set(find(i), i);
          const rlist = [...reps.values()];
          for (let i = 0; i < rlist.length; i++) for (let j = i + 1; j < rlist.length; j++) {
            const d = dist3(nodes[rlist[i]].pos, nodes[rlist[j]].pos);
            if (!best || d < best[0]) best = [d, rlist[i], rlist[j]];
          }
        }
        if (!best) break;
        const [, a, b] = best;
        edges.push({ a, b, d: Math.round(best[0] * 1e6) / 1e6, bridge: true });
        adj[a].add(b); adj[b].add(a);
        union(a, b);
        comp = new Set(nodes.map((_, i) => find(i)));
      }
    }

    // Synthetic origin root, mirroring add_root().
    const real = nodes.map(nd => Object.assign({}, nd, { id: nd.id + 1 }));
    const outEdges = edges.map(e => {
      const o = { a: e.a + 1, b: e.b + 1, d: e.d };
      if (e.bridge) o.bridge = true;
      return o;
    });
    let nearest = real[0];
    for (const nd of real) {
      if (nd.r < nearest.r || (nd.r === nearest.r && nd.id < nearest.id)) nearest = nd;
    }
    outEdges.push({ a: 0, b: nearest.id, d: nearest.r });
    const root = {
      id: 0, file: "__root__", number: 0, name: "Origin", rarity: 0.0,
      source: "System", tag: "both", meta: [],
      description: "The Chaos Tree's root. Free to unlock; every other node costs to unlock.",
      pos: [0, 0, 0], r: 0.0
    };
    if (onStep) onStep(1, "done");
    return { nodes: [root, ...real], edges: outEdges };
  }

  // Build the runtime structure the engine/UI use. Accepts either generator
  // output or an imported Python tree JSON ({nodes, edges}).
  function buildRuntime(payload) {
    const nodes = payload.nodes, byId = {};
    const adj = {};
    for (const nd of nodes) { byId[nd.id] = nd; adj[nd.id] = new Set(); }
    for (const e of payload.edges) {
      if (byId[e.a] == null || byId[e.b] == null) continue;
      adj[e.a].add(e.b); adj[e.b].add(e.a);
    }
    return { nodes, byId, adj, edges: payload.edges };
  }

  return { DEFAULTS, filterEntries, generate, buildRuntime };
})();
