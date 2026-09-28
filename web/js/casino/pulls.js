"use strict";
/* Pull lifecycle: E starts a machine pull, you walk away, loot drops on the
 * floor when done. Pulls tick even while you kite guards or visit rooms.
 * Depends on: config, dom, state, slots, prizes, hud (all runtime). */
(function (C) {
  C.nearestMachine = function (freeOnly) {
    const room = C.curRoom();
    let best = null, bd = C.INTERACT_R;
    for (const m of room.machines) {
      if (freeOnly && m.pull) continue;
      const d = Math.hypot(m.x - C.G.p.x, m.y - C.G.p.y);
      if (d < bd) { bd = d; best = m; }
    }
    return best;
  };

  C.tryStartPull = function () {
    if (C.G.over || C.G.title) return;
    const m = C.nearestMachine(true);
    if (!m) return;
    const t = C.tierById(m.tier);
    if (m.kind === "slot") {
      const c = C.slotCost(t);
      if (C.G.p.coins < c) {
        C.showCard("Not enough coins", t.label + " slot costs " + c + ".", "", 1800);
        return;
      }
      C.G.p.coins -= c;
      const pay = C.rollSlotPayout(t);
      m.pull = {
        t: 0, dur: t.pull * C.G.p.pullMul, pay,
        syms: C.symbolsFor(pay), locks: [false, false, false],
        disp: ["7", "7", "7"], fin: null,
      };
    } else {
      if ((C.G.p.tickets[m.tier] || 0) < 1) {
        C.showCard("Need 1× " + t.label + " ticket",
          "Win it from " + t.label + " slots first (depth " + t.minDepth + "+).", "", 2200);
        return;
      }
      C.G.p.tickets[m.tier]--;
      m.pull = { t: 0, dur: 3.0 * C.G.p.pullMul, gacha: C.gachaRoll(m.tier, m.cat), gIdx: 0, fin: null };
    }
    // Noise: alert nearby guards.
    const room = C.curRoom();
    room.alert = 5;
    for (const gd of room.guards) {
      if (Math.hypot(gd.x - C.G.p.x, gd.y - C.G.p.y) < 300) gd.chase = true;
    }
    C.updateHud();
  };

  function dropSpot(room, m) {
    const front = m.y < C.H / 2 ? 1 : -1;
    return {
      x: Math.max(60, Math.min(C.W - 60, m.x + (Math.random() * 30 - 15))),
      y: m.y + front * (C.MH / 2 + 18),
    };
  }

  function spawnPickup(room, m, data) {
    const s = dropSpot(room, m);
    room.pickups.push(Object.assign({ x: s.x, y: s.y, bob: Math.random() * 6 }, data));
  }

  function completePull(room, m) {
    const pull = m.pull, t = C.tierById(m.tier);
    m.pull = null;
    C.G.pulls++;
    if (m.kind === "slot") {
      const pay = pull.pay, at = { x: m.x, y: m.y };
      if (pay.kind === "jackpot") {
        spawnPickup(room, m, { kind: "coins", amount: pay.coins });
        spawnPickup(room, m, { kind: "ticket", tier: pay.ticket });
        C.floater(at.x, at.y - 50, "JACKPOT 7-7-7!", "#f7d40a");
        C.showCard("JACKPOT 7-7-7! +" + pay.coins + " coins + 1× " + pay.ticket,
          t.label + " slot screams. Every guard heard that. Grab the loot.", "", 3500);
        for (const gd of room.guards) gd.chase = true;
      } else if (pay.kind === "ticket") {
        spawnPickup(room, m, { kind: "ticket", tier: pay.ticket });
        C.floater(at.x, at.y - 50, "🎟 " + pay.ticket, t.color);
      } else if (pay.kind === "coins") {
        spawnPickup(room, m, { kind: "coins", amount: pay.coins });
        C.floater(at.x, at.y - 50, "+" + pay.coins + " 🪙", "#ffe066");
      } else {
        C.floater(at.x, at.y - 50, "house wins", "#878d96");
      }
    } else {
      spawnPickup(room, m, { kind: "prize", res: pull.gacha.res, tier: m.tier });
      C.floater(m.x, m.y - 50, "🎲 " + pull.gacha.res.name.slice(0, 24), C.rarityColor(pull.gacha.res.rarity));
    }
    C.checkFeats();
    C.updateHud();
  }

  // Animate one machine pull; returns true when it just finished.
  function tickMachinePull(room, m, dt) {
    const pull = m.pull;
    if (!pull) return;
    if (pull.fin != null) {
      pull.fin -= dt;
      if (pull.fin <= 0) completePull(room, m);
      return;
    }
    pull.t += dt;
    if (m.kind === "slot") {
      const frac = Math.min(1, pull.t / pull.dur);
      const locks = [0.55, 0.75, 0.95];
      locks.forEach((edge, i) => {
        if (frac >= edge) {
          pull.locks[i] = true;
          pull.disp[i] = pull.syms[i];
        } else {
          pull.disp[i] = C.SYMS[Math.floor(Math.random() * C.SYMS.length)];
        }
      });
    } else if (pull.gacha.strip.length && Math.random() < 0.5) {
      pull.gIdx = (pull.gIdx + 1) % pull.gacha.strip.length;
    }
    if (pull.t >= pull.dur) pull.fin = 0.42; // hold the locked result briefly
  }

  // Tick every known room's pulls so loot is waiting when you circle back.
  C.updatePulls = function (dt) {
    for (const room of C.rooms.values()) {
      for (const m of room.machines) tickMachinePull(room, m, dt);
    }
  };

  C.updatePickups = function (dt) {
    const p = C.G.p, room = C.curRoom();
    for (const pk of room.pickups) pk.bob += dt;
    for (const pk of [...room.pickups]) {
      if (Math.hypot(pk.x - p.x, pk.y - p.y) > C.PICKUP_R) continue;
      room.pickups.splice(room.pickups.indexOf(pk), 1);
      if (pk.kind === "coins") {
        p.coins += pk.amount;
        C.floater(p.x, p.y - 24, "+" + pk.amount + " 🪙", "#ffe066");
      } else if (pk.kind === "ticket") {
        p.tickets[pk.tier] = (p.tickets[pk.tier] || 0) + 1;
        const t = C.tierById(pk.tier);
        C.floater(p.x, p.y - 24, "+1 🎟 " + pk.tier, t.color);
      } else if (pk.kind === "prize") {
        const res = pk.res;
        const note = C.applyPrize(res);
        C.showCard("[" + C.rarityName(res.rarity) + " " + res.category + "] " + res.name +
          " (" + res.rarity.toFixed(1) + ")",
          (res.description || "").slice(0, 160) + " — " + note,
          "Ticket: " + pk.tier + " · odds " + (res.odds || 0).toFixed(2) + "%", 6000);
      }
      C.updateHud();
    }
  };
})(window.Casino);
