"use strict";
/* Curse Roulette pre-run gamble (Doc rules): d20 -> tier -> random curse of
 * that severity from CHAOS_CURSES. Parametric house-edge modifiers plus
 * ticket rewards. Reach depth 3 to resolve: penalties lift (soul damage, i.e.
 * max HP, stays), +1 gold each. Max 3 curses per run.
 * Depends on: config, dom, state (runtime G). */
(function (C) {
  C.curseTier = function (roll) {
    if (roll <= 6) return "Minor";
    if (roll <= 13) return "Medium";
    if (roll <= 17) return "Major";
    if (roll <= 19) return "Severe";
    return "Ultimate";
  };

  C.curseRewards = function (tier) {
    if (tier === "Minor") return ["gold"];
    if (tier === "Medium") return ["gold", "gold"];
    if (tier === "Major") return ["gold"];
    if (tier === "Severe") return ["platinum"];
    return ["platinum", "gold"]; // Ultimate
  };

  const MODS = {
    Minor: [
      { label: "Frail Start", apply: { maxHp: -1 } },
      { label: "Slow Pockets", apply: { pullMul: 1.2 } },
      { label: "Entry Fee", apply: { coins: -25 } },
    ],
    Medium: [
      { label: "Heavy Feet", apply: { speedMult: 0.9 } },
      { label: "House Cut", apply: { costMult: 1.25 } },
      { label: "Wanted", apply: { waveT: 40 } },
    ],
    Major: [
      { label: "Marked", apply: { threat0: 1 } },
      { label: "Glass Soul", apply: { maxHp: -1, pullMul: 1.15 } },
      { label: "Crowded", apply: { guardBonus: 1 } },
    ],
    Severe: [
      { label: "Doomed", apply: { maxHp: -2 } },
      { label: "Hunted", apply: { guardBonus: 1, threat0: 1 } },
    ],
    Ultimate: [
      { label: "Condemned", apply: { threat0: 2, maxHp: -1 } },
      { label: "Infested", apply: { guardBonus: 2 } },
    ],
  };

  // Rolls queued on the death screen for the NEXT run (title is gone then).
  C.pendingCurses = [];

  function pool() {
    return (window.CHAOS_CURSES || []).filter(c => !c.nsfw);
  }

  // Shared d20 roll: tier + curse flavor + house-edge modifier, no side effects.
  function pickCurse() {
    const list = pool();
    if (!list.length) return null;
    const roll = 1 + Math.floor(Math.random() * 20);
    const tier = C.curseTier(roll);
    let cands = list.filter(c => c.sev === roll);
    if (!cands.length) {
      let best = 99;
      for (const c of list) best = Math.min(best, Math.abs(c.sev - roll));
      cands = list.filter(c => Math.abs(c.sev - roll) === best);
    }
    const curse = cands[Math.floor(Math.random() * cands.length)];
    const mod = MODS[tier][Math.floor(Math.random() * MODS[tier].length)];
    return { curse, tier, roll, mod };
  }

  // Apply a picked curse to a live run state (fresh or title).
  function applyPick(G, pick) {
    const p = G.p, A = pick.mod.apply, applied = {};
    if (A.maxHp) { p.maxHp = Math.max(1, p.maxHp + A.maxHp); p.hp = Math.min(p.hp, p.maxHp); }
    if (A.pullMul) { p.pullMul *= A.pullMul; applied.pullMul = A.pullMul; }
    if (A.speedMult) { p.speed *= A.speedMult; applied.speedMult = A.speedMult; }
    if (A.coins) p.coins = Math.max(0, p.coins + A.coins);
    if (A.costMult) { G.costMult = (G.costMult || 1) * A.costMult; applied.costMult = A.costMult; }
    if (A.threat0) G.threat = Math.max(G.threat, A.threat0);
    if (A.waveT) G.waveT = Math.min(G.waveT, A.waveT);
    if (A.guardBonus) G.guardBonus = (G.guardBonus || 0) + A.guardBonus;
    for (const tk of C.curseRewards(pick.tier)) p.tickets[tk] = (p.tickets[tk] || 0) + 1;
    G.curses.push({ label: pick.curse.label, tier: pick.tier, roll: pick.roll,
      desc: pick.curse.desc, applied, resolved: false });
  }

  function curseCard(pick) {
    C.showCard("🎲 " + pick.curse.label + " (" + pick.tier + ", d20 " + pick.roll + ")",
      String(pick.curse.desc).slice(0, 140) + " — House edge: " + pick.mod.label +
        ". Reach depth 3 to resolve (+1 gold).",
      "Reward: " + C.curseRewards(pick.tier).join(" + ") + " tickets.", 5000);
  }

  // Title screen: applies to the run waiting behind it.
  C.rollCurse = function () {
    const G = C.G;
    if (!G || !G.title) return;
    if (G.curses.length >= 3) {
      C.showCard("Enough curses", "Three is plenty. The house admires restraint.", "", 2000);
      return;
    }
    const pick = pickCurse();
    if (!pick) {
      C.showCard("No curses", "Curse data missing.", "", 2000);
      return;
    }
    applyPick(G, pick);
    curseCard(pick);
    C.renderCurseList();
    C.updateHud();
  };

  // Death screen: queues for the NEXT run (applied on respawn).
  C.rollCurseNext = function () {
    const G = C.G;
    if (!G || !G.over) return;
    if (C.pendingCurses.length >= 3) return;
    const pick = pickCurse();
    if (!pick) return;
    C.pendingCurses.push(pick);
    C.renderPendingList();
  };

  C.renderPendingList = function () {
    const box = C.el("deathCurses");
    if (!box) return;
    box.innerHTML = C.pendingCurses.length
      ? "Next run: " + C.pendingCurses.map(c =>
        "🎲 " + esc(c.curse.label) + " (" + c.tier + ")").join(" · ")
      : "No curses queued — clean soul (coward).";
    const btn = C.el("curseNextBtn");
    if (btn) btn.disabled = C.pendingCurses.length >= 3;
  };

  C.resolveCurses = function () {
    const G = C.G;
    let n = 0;
    for (const c of G.curses) {
      if (c.resolved) continue;
      c.resolved = true; n++;
      G.p.tickets.gold++;
      const a = c.applied || {};
      if (a.pullMul) G.p.pullMul /= a.pullMul;
      if (a.speedMult) G.p.speed /= a.speedMult;
      if (a.costMult) G.costMult = (G.costMult || 1) / a.costMult;
      C.floater(G.p.x, G.p.y - 30, "curse lifted: " + c.label.slice(0, 18), "#11d939");
    }
    if (n) {
      C.showCard("Curses resolved ×" + n,
        "Depth 3! The house acknowledges you: +1 gold each. Soul damage stays.", "", 3500);
      C.renderCurseList();
    }
  };

  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  C.renderCurseList = function () {
    const box = C.el("curseList");
    if (box) {
      const cs = C.G ? C.G.curses : [];
      box.innerHTML = cs.length
        ? cs.map(c => "<span class='tick'>" + (c.resolved ? "✓ " : "🎲 ") +
          esc(c.label) + " (" + c.tier + ")</span>").join("")
        : "<span class='tick'>No curses — clean soul (coward).</span>";
    }
    const btn = C.el("curseBtn");
    if (btn) btn.disabled = (C.G ? C.G.curses.length : 0) >= 3;
  };

  C.renderBest = function () {
    const box = C.el("bestLine");
    if (!box) return;
    const b = C.getBest();
    box.textContent = (b.depth || b.time)
      ? "Best run: depth " + b.depth + " · " + C.fmtTime(b.time) + " · " + b.kills + " kills"
      : "No runs on record. Make the house proud.";
  };
})(window.Casino);
