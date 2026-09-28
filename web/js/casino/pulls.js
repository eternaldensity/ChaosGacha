"use strict";
/* Pull lifecycle: start/cancel/finish + reel animation.
 * Depends on: config, dom, state, slots, prizes, hud (all runtime). */
(function (C) {
  C.nearestMachine = function () {
    const room = C.curRoom();
    let best = null, bd = 78;
    for (const m of room.machines) {
      const d = Math.hypot(m.x - C.G.p.x, m.y - C.G.p.y);
      if (d < bd) { bd = d; best = m; }
    }
    return best;
  };

  C.tryStartPull = function () {
    if (C.G.pull || C.G.over) return;
    const m = C.nearestMachine();
    if (!m) return;
    const t = C.tierById(m.tier);
    if (m.kind === "slot") {
      const c = C.slotCost(t);
      if (C.G.p.coins < c) {
        C.showCard("Not enough coins", t.label + " slot costs " + c + ".", "", 1800);
        return;
      }
      C.G.p.coins -= c;
      C.G.pull = {
        m, t: 0, dur: t.pull * C.G.p.pullMul,
        pay: C.rollSlotPayout(t), syms: null, locks: [false, false, false],
      };
      C.G.pull.syms = C.symbolsFor(C.G.pull.pay);
    } else {
      if ((C.G.p.tickets[m.tier] || 0) < 1) {
        C.showCard("Need 1× " + t.label + " ticket",
          "Win it from " + t.label + " slots first (depth " + t.minDepth + "+).", "", 2200);
        return;
      }
      C.G.p.tickets[m.tier]--;
      C.G.pull = { m, t: 0, dur: 3.0 * C.G.p.pullMul, gacha: C.gachaRoll(m.tier, m.cat), gIdx: 0 };
    }
    // Noise: alert nearby guards.
    const room = C.curRoom();
    room.alert = 5;
    for (const gd of room.guards) {
      if (Math.hypot(gd.x - C.G.p.x, gd.y - C.G.p.y) < 300) gd.chase = true;
    }
    C.showPullOverlay(m, t);
    C.updateHud();
  };

  C.cancelPull = function (msg) {
    if (!C.G.pull) return;
    C.G.pull = null;
    C.hidePullOverlay();
    if (msg) C.showCard("Pull interrupted", msg + " (no refund — the house thanks you).", "", 2000);
  };

  C.finishPull = function () {
    const pull = C.G.pull, m = pull.m, t = C.tierById(m.tier);
    C.G.pull = null;
    C.hidePullOverlay();
    C.G.pulls++;
    if (m.kind === "slot") {
      const pay = pull.pay;
      if (pay.kind === "jackpot") {
        C.G.p.coins += pay.coins;
        C.G.p.tickets[pay.ticket] = (C.G.p.tickets[pay.ticket] || 0) + 1;
        C.showCard("JACKPOT 7-7-7! +" + pay.coins + " coins + 1× " + pay.ticket,
          t.label + " slot screams. Every guard heard that.", "", 3500);
        for (const gd of C.curRoom().guards) gd.chase = true;
      } else if (pay.kind === "ticket") {
        C.G.p.tickets[pay.ticket] = (C.G.p.tickets[pay.ticket] || 0) + 1;
        C.showCard("🎟 +1× " + pay.ticket + " ticket",
          "From a " + t.label + " slot (" + pull.syms.join(" ") + "). Feed it to a " +
          pay.ticket + " gacha.", "", 3000);
      } else if (pay.kind === "coins") {
        C.G.p.coins += pay.coins;
        C.showCard("🪙 +" + pay.coins + " coins",
          t.label + " slot (" + pull.syms.join(" ") + ").", "", 1800);
      } else {
        C.showCard("House wins",
          t.label + " slot (" + pull.syms.join(" ") + "). Try again deeper for better EV.", "", 1800);
      }
    } else {
      const res = pull.gacha.res;
      const note = C.applyPrize(res);
      C.showCard("[" + C.rarityName(res.rarity) + " " + res.category + "] " + res.name +
        " (" + res.rarity.toFixed(1) + ")",
        (res.description || "").slice(0, 160) + " — " + note,
        "Ticket: " + t.label + " · odds " + (res.odds || 0).toFixed(2) + "%", 6000);
    }
    C.checkFeats();
    C.updateHud();
  };

  // Advance the active pull one tick: reel theater, then a short
  // resolution beat with the locked result before paying out.
  C.updatePull = function (dt) {
    const pull = C.G.pull;
    if (!pull) return;
    if (pull._finIn != null) {
      pull._finIn -= dt;
      if (pull._finIn <= 0) C.finishPull();
      return;
    }
    pull.t += dt;
    const frac = Math.min(1, pull.t / pull.dur);
    C.ui.chanBar.style.width = (frac * 100).toFixed(1) + "%";
    if (pull.m.kind === "slot") {
      // 3 reels spin fast, lock left-to-right at 55/75/95%.
      const locks = [0.55, 0.75, 0.95];
      C.ui.sreels.forEach((sn, i) => {
        if (frac >= locks[i]) {
          if (!pull.locks[i]) { pull.locks[i] = true; sn.classList.add("locked"); }
          sn.textContent = pull.syms[i];
        } else {
          sn.textContent = C.SYMS[Math.floor(Math.random() * C.SYMS.length)];
        }
      });
      C.ui.reelSub.textContent = "Reels… " + Math.round(frac * 100) + "% — hold still";
    } else {
      // Single gacha reel: cycle decoys, settle on the winner at the end.
      const strip = pull.gacha.strip || [];
      if (frac < 0.92 && strip.length) {
        if (Math.random() < 0.5) {
          pull.gIdx = (pull.gIdx + 1) % strip.length;
          const d = strip[pull.gIdx];
          C.ui.gachaReel.textContent = d.name;
          C.ui.gachaReel.style.color = C.rarityColor(d.rarity);
        }
      } else {
        C.ui.gachaReel.textContent = "▶ " + pull.gacha.res.name + " ◀";
        C.ui.gachaReel.style.color = C.rarityColor(pull.gacha.res.rarity);
      }
      C.ui.reelSub.textContent = "Gacha reel… " + Math.round(frac * 100) + "% — hold still";
    }
    if (pull.t >= pull.dur && pull._finIn == null) {
      if (pull.m.kind === "slot") {
        C.ui.sreels.forEach((sn, i) => { sn.textContent = pull.syms[i]; sn.classList.add("locked"); });
      } else {
        C.ui.gachaReel.textContent = "▶ " + pull.gacha.res.name + " ◀";
        C.ui.gachaReel.style.color = C.rarityColor(pull.gacha.res.rarity);
      }
      pull._finIn = 0.42;
    }
  };
})(window.Casino);
