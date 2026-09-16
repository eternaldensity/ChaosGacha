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

  // category: one of the 5, or "random". q: optional substring filter.
  function roll(entries, tiers, category, min, max, avg, q, rnd) {
    rnd = rnd || Math.random;
    let cat = category;
    if (cat === "random") {
      const cats = ["ability", "item", "skill", "trait", "familiar"];
      cat = cats[Math.floor(rnd() * cats.length)];
    }
    const ql = (q || "").trim().toLowerCase();
    const pool = entries.filter(e =>
      e.f === cat && e.t !== "tree" &&
      (!ql || e.name.toLowerCase().includes(ql) || (e.s || "").toLowerCase().includes(ql)));
    if (!pool.length) throw new Error("no entries match (try clearing the filter)");
    const wOf = e => 1 / Math.pow(4, Math.abs(avg - e.r));
    let weightsum = 0;
    for (const e of pool) if (e.r <= max && min < e.r) weightsum += wOf(e);
    if (weightsum <= 0) throw new Error("rarity range matches nothing");
    for (let attempt = 0; attempt < 200; attempt++) {
      const pull = rarityPull(min, max, avg, rnd);
      const filt = pool.filter(e => Math.abs(e.r - pull) <= 0.2);
      if (!filt.length) continue;
      const fw = filt.map(wOf);
      let total = 0;
      for (const w of fw) total += w;
      let pick = rnd() * total, acc = 0, idx = filt.length - 1;
      for (let i = 0; i < filt.length; i++) {
        acc += fw[i];
        if (acc >= pick) { idx = i; break; }
      }
      const e = filt[idx];
      return {
        category: cat, name: e.name, rarity: e.r,
        source: e.s || "", description: cleanDesc(e.d),
        odds: 100 * fw[idx] / weightsum, pull: Math.round(pull * 10) / 10
      };
    }
    throw new Error("could not find a match (try widening the range)");
  }

  function rarityClass(classes, r) {
    for (const c of classes) if (r < c.max) return c;
    return classes[classes.length - 1];
  }

  return { rarityPull, cleanDesc, roll, rarityClass };
})();
