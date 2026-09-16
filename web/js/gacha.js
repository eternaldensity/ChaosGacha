"use strict";
/* Gacha roll logic port (Gacha.py run_gacha/randomizer/read_file_with_weight).
 * Pool = all entries except Tree-tagged ones; rarity-pull then ±0.2 filter,
 * weights 1/4^|avg-rarity|. */
window.ChaosGacha = (function () {
  function rarityPull(min, max, avg, rnd) {
    rnd = rnd || Math.random;
    const vals = [], weights = [];
    let x = min;
    while (x < max) {
      vals.push(x);
      x += 0.1;
      weights.push(1 / Math.pow(4, Math.abs(avg - x)));
    }
    let total = 0;
    for (const w of weights) total += w;
    let pick = rnd() * total, acc = 0, idx = vals.length - 1;
    for (let i = 0; i < vals.length; i++) {
      acc += weights[i];
      if (acc >= pick) { idx = i; break; }
    }
    return vals[idx] + 0.1;
  }

  function cleanDesc(d) {
    return String(d || "").replace(/#/g, "")
      .replace(/\((Nsfw|Tech|Character|Gacha)\)/g, "").trim();
  }

  // filters: {q, source, rmin, rmax, hideNsfw, hideTech, exclude[]}.
  // A plain string is treated as {q} (backwards compatible).
  function normFilt(f) {
    if (typeof f === "string") return { q: f };
    return f || {};
  }

  // category: one of the 5, or "random".
  function buildPool(entries, category, filt, rnd) {
    rnd = rnd || Math.random;
    const F = normFilt(filt);
    let cat = category;
    if (cat === "random") {
      const cats = ["ability", "item", "skill", "trait", "familiar"];
      cat = cats[Math.floor(rnd() * cats.length)];
    }
    const ql = (F.q || "").trim().toLowerCase();
    const excl = F.exclude && F.exclude.length ? new Set(F.exclude) : null;
    const pool = entries.filter(e =>
      e.f === cat && e.t !== "tree" &&
      (!F.source || e.s === F.source) &&
      (F.rmin == null || e.r >= F.rmin) &&
      (F.rmax == null || e.r <= F.rmax) &&
      (!F.hideNsfw || !e.nsfw) &&
      (!F.hideTech || !e.tech) &&
      (!excl || !excl.has(e.name)) &&
      (!ql || e.name.toLowerCase().includes(ql) || (e.s || "").toLowerCase().includes(ql)));
    if (!pool.length) throw new Error("no entries match (loosen the filters)");
    return { cat, pool };
  }

  function drawOne(pool, min, max, avg, rnd) {
    const pull = rarityPull(min, max, avg, rnd);
    const filt = pool.filter(e => Math.abs(e.r - pull) <= 0.2);
    if (!filt.length) return null;
    const fw = filt.map(e => 1 / Math.pow(4, Math.abs(avg - e.r)));
    let total = 0;
    for (const w of fw) total += w;
    let pick = rnd() * total, acc = 0, idx = filt.length - 1;
    for (let i = 0; i < filt.length; i++) {
      acc += fw[i];
      if (acc >= pick) { idx = i; break; }
    }
    return { entry: filt[idx], weight: fw[idx], pull };
  }

  function roll(entries, tiers, category, min, max, avg, filt, rnd) {
    rnd = rnd || Math.random;
    const { cat, pool } = buildPool(entries, category, filt, rnd);
    const wOf = e => 1 / Math.pow(4, Math.abs(avg - e.r));
    let weightsum = 0;
    for (const e of pool) if (e.r <= max && min < e.r) weightsum += wOf(e);
    if (weightsum <= 0) throw new Error("rarity range matches nothing");
    for (let attempt = 0; attempt < 200; attempt++) {
      const hit = drawOne(pool, min, max, avg, rnd);
      if (!hit) continue;
      const e = hit.entry;
      return {
        category: cat, name: e.name, rarity: e.r,
        source: e.s || "", description: cleanDesc(e.d),
        odds: 100 * hit.weight / weightsum, pull: Math.round(hit.pull * 10) / 10
      };
    }
    throw new Error("could not find a match (try widening the range)");
  }

  // Candidate strip for the spin animation: plausible results drawn through
  // the same pull/filter/weight path as roll(). Caller appends the true
  // result at the end. `category` must already be resolved (not "random").
  function drawStrip(entries, category, min, max, avg, filt, count, rnd) {
    rnd = rnd || Math.random;
    const { cat, pool } = buildPool(entries, category, filt, rnd);
    const items = [];
    let guard = 0;
    while (items.length < count && guard++ < count * 40) {
      const hit = drawOne(pool, min, max, avg, rnd);
      if (hit) {
        const e = hit.entry;
        items.push({ name: e.name, rarity: e.r, source: e.s || "", category: cat });
      }
    }
    let i = 0;
    while (items.length < count && pool.length) {
      const e = pool[i++ % pool.length];
      items.push({ name: e.name, rarity: e.r, source: e.s || "", category: cat });
    }
    return items;
  }

  function rarityClass(classes, r) {
    for (const c of classes) if (r < c.max) return c;
    return classes[classes.length - 1];
  }

  return { rarityPull, cleanDesc, roll, drawStrip, rarityClass };
})();
