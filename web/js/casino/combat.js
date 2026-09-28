"use strict";
/* Combat: player attacks, guards, pets, projectiles, death/legacy.
 * Depends on: config, dom, state, legacy, prizes (runtime). */
(function (C) {
  C.tryAttack = function () {
    const p = C.G.p;
    if (!p.weapon || p.atkCd > 0 || C.G.over) return;
    p.atkCd = 0.45 * (p.weapon.rate || 1);
    if (p.weapon.ranged) {
      const g = C.nearestGuard(420);
      const a = g ? Math.atan2(g.y - p.y, g.x - p.x) : (p.facing || 0);
      const angs = p.weapon.pattern === "spread" ? [-0.16, 0, 0.16] : [0];
      for (const off of angs) {
        C.projs.push({
          x: p.x, y: p.y, vx: Math.cos(a + off) * 520, vy: Math.sin(a + off) * 520,
          dmg: C.playerDmg(p.dmg, p.weapon.element) + (p.rangedBonus || 0), foe: false, life: 0.8, element: p.weapon.element,
        });
      }
    } else {
      for (const gd of [...C.curRoom().guards]) {
        if (Math.hypot(gd.x - p.x, gd.y - p.y) < p.range + 14) {
          if (p.weapon.knockback) {
            const a = Math.atan2(gd.y - p.y, gd.x - p.x) || 0;
            const room = C.curRoom();
            const fx = C.collideCircle(gd.x + Math.cos(a) * p.weapon.knockback,
              gd.y + Math.sin(a) * p.weapon.knockback, 9, C.solids(room));
            gd.x = fx[0]; gd.y = fx[1];
          }
          C.damageGuard(gd, C.playerDmg(p.dmg, p.weapon.element), p.weapon.element);
        }
      }
      C.G.shake = 0.12;
    }
  };

  // Fire a slotted active power. Cooldown-gated; heal won't waste on full HP.
  // Point-segment distance for beam hits.
  function segDist(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    const l2 = dx * dx + dy * dy;
    let t = l2 ? ((px - x1) * dx + (py - y1) * dy) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
  }

  C.runActive = function (i) {
    const p = C.G.p, ab = p.slots[i];
    if (!ab || ab.cdLeft > 0 || C.G.over || C.G.title) return false;
    const armed = p.weapon ? 1 : 0;
    if (ab.op === "bolt") {
      const g = C.nearestGuard(460);
      const a = g ? Math.atan2(g.y - p.y, g.x - p.x) : p.facing;
      const dmg = C.playerDmg(ab.power + armed, ab.element);
      const angs = ab.element === "venom" ? [-0.18, 0, 0.18] : [0];
      for (const off of angs) {
        C.projs.push({
          x: p.x, y: p.y, vx: Math.cos(a + off) * 560, vy: Math.sin(a + off) * 560,
          dmg, foe: false, life: 0.9, element: ab.element,
        });
      }
    } else if (ab.op === "nova") {
      C.detonate(p.x, p.y, 135, C.playerDmg(ab.power + armed, ab.element), ab.element);
    } else if (ab.op === "wave") {
      // Cone shove: damage + radial knockback + element in front of you.
      const g = C.nearestGuard(460);
      const a = g ? Math.atan2(g.y - p.y, g.x - p.x) : p.facing;
      const dmg = C.playerDmg(ab.power + armed, ab.element);
      const room = C.curRoom();
      for (const gd of [...room.guards]) {
        const d = Math.hypot(gd.x - p.x, gd.y - p.y);
        if (d > 175) continue;
        let da = Math.atan2(gd.y - p.y, gd.x - p.x) - a;
        while (da > Math.PI) da -= Math.PI * 2;
        while (da < -Math.PI) da += Math.PI * 2;
        if (Math.abs(da) > 0.5) continue;
        const pa = Math.atan2(gd.y - p.y, gd.x - p.x) || 0;
        const fx = C.collideCircle(gd.x + Math.cos(pa) * 70, gd.y + Math.sin(pa) * 70,
          9, C.solids(room));
        gd.x = fx[0]; gd.y = fx[1];
        C.damageGuard(gd, dmg, ab.element);
      }
      C.rings.push({ x: p.x, y: p.y, age: 0, max: 0.25, r: 70 });
    } else if (ab.op === "beam") {
      const g = C.nearestGuard(460);
      const a = g ? Math.atan2(g.y - p.y, g.x - p.x) : p.facing;
      const x2 = p.x + Math.cos(a) * 340, y2 = p.y + Math.sin(a) * 340;
      C.beams.push({ x1: p.x, y1: p.y, x2, y2, age: 0, max: 0.25 });
      const dmg = C.playerDmg(ab.power + armed, ab.element);
      for (const gd of [...C.curRoom().guards]) {
        if (segDist(gd.x, gd.y, p.x, p.y, x2, y2) < 16) {
          C.damageGuard(gd, dmg, ab.element);
        }
      }
      C.G.shake = 0.1;
    } else if (ab.op === "lobbed") {
      // Shell lands late: red telegraph now, boom in 0.6s.
      const g = C.nearestGuard(520);
      const tx = g ? g.x : p.x + Math.cos(p.facing) * 200;
      const ty = g ? g.y : p.y + Math.sin(p.facing) * 200;
      C.delayed.push({
        x: tx, y: ty, t: 0.6, r: 95,
        dmg: C.playerDmg(ab.power + armed, ab.element), element: ab.element,
      });
    } else if (ab.op === "wall") {
      // Conjured cover perpendicular to facing; blocks guards + foe shots.
      const horiz = Math.abs(Math.cos(p.facing)) > Math.abs(Math.sin(p.facing));
      const w = horiz ? 16 : 110, h = horiz ? 110 : 16;
      const room = C.curRoom();
      room.tempWalls.push({
        x: p.x + Math.cos(p.facing) * 52 - w / 2,
        y: p.y + Math.sin(p.facing) * 52 - h / 2,
        w, h, t: ab.power,
      });
      C.floater(p.x, p.y - 30, "wall up!", "#7df9ff");
    } else if (ab.op === "summon") {
      p.pets.push({
        name: ab.name, role: ab.role, element: ab.element,
        dmg: ab.power, cd: 0, cdMax: 1.1,
        temp: true, dur: ab.dur, stationary: !!ab.stationary,
        x: p.x, y: p.y,
      });
      C.floater(p.x, p.y - 30, "summoned!", "#c77dff");
      C.updateHud();
    } else if (ab.op === "surge") {
      p.surge = { t: ab.dur, dmgMult: ab.dmgMult, spdMult: ab.spdMult };
      C.floater(p.x, p.y - 30, "SURGING", "#ff5555");
    } else if (ab.op === "chrono") {
      // Time bubble: everything nearby slows to a crawl.
      const room = C.curRoom();
      for (const gd of [...room.guards]) {
        if (Math.hypot(gd.x - p.x, gd.y - p.y) < 230) {
          C.applyStatus(gd, "slow", ab.power, 0.35);
        }
      }
      C.rings.push({ x: p.x, y: p.y, age: 0, max: 0.4, r: 230 });
      C.G.shake = 0.12;
    } else if (ab.op === "salvage") {
      const room = C.curRoom();
      let best = null, bd = 115;
      for (const m of room.machines) {
        const d = Math.hypot(m.x - p.x, m.y - p.y);
        if (d < bd) { bd = d; best = m; }
      }
      if (!best) return false; // nothing in reach: don't burn the cooldown
      const wasPull = !!best.pull;
      const parts = (C.tierIdx(best.tier) + 1) + 2;
      // Remove first so damageMachine's own drop doesn't double-pay.
      room.machines.splice(room.machines.indexOf(best), 1);
      room.pickups.push({ kind: "parts", amount: parts, x: best.x, y: best.y, bob: 0, age: 0 });
      room.scorch.push({ x: best.x, y: best.y, age: 0 });
      C.floater(best.x, best.y - 50, "🔧 +" + parts + "🧩" + (wasPull ? " (pull lost)" : ""), "#ffe066");
      C.G.shake = Math.max(C.G.shake, 0.1);
    } else if (ab.op === "tinker") {
      C.openDraft({ kind: "build", ab });
      return true; // menu handles the cooldown on build, not on open
    } else if (ab.op === "dash") {
      p.dashDx = Math.cos(p.facing); p.dashDy = Math.sin(p.facing);
      p.dashSpd = ab.power;
      p.rollT = 0.3;
    } else if (ab.op === "heal") {
      if (p.hp >= p.maxHp) return false;
      const amt = ab.power + (p.healBonus || 0);
      p.hp = Math.min(p.maxHp, p.hp + amt);
      C.floater(p.x, p.y - 24, "+" + amt + " HP", "#11d939");
    } else {
      return false;
    }
    ab.cdLeft = ab.cd * (1 - (p.cdr || 0));
    C.updateHud();
    return true;
  };

  // Statuses: burn/poison dps, slow mult, brief stun. Refresh on reapply.
  C.applyStatus = function (ent, id, dur, power) {
    ent.statuses = ent.statuses || {};
    ent.statuses[id] = { t: dur, power };
  };

  C.statusForElement = function (element) {
    if (element === "fire") return ["burn", 3, 0.9];
    if (element === "frost" || element === "water") return ["slow", 2, 0.5];
    if (element === "bolt") return ["stun", 0.45, 0];
    if (element === "earth") return ["stun", 0.6, 0];
    if (element === "venom" || element === "nature") return ["poison", 4, 0.6];
    if (element === "shadow") return ["weaken", 4, 1.25];
    // wind shoves (wave op); light breaks shields (damageGuard). No status.
    return null;
  };

  // Outgoing player damage: surge steroid x element affinity bonus.
  C.playerDmg = function (base, element) {
    const p = C.G.p;
    const s = p.surge;
    let m = (s && s.t > 0) ? s.dmgMult : 1;
    if (element && p.elemBonus[element]) m *= 1 + p.elemBonus[element];
    return base * m;
  };

  // Single choke point for guard damage: shields soak direct hits (dots seep
  // through), numbers pop, elements apply, death routes to killGuard.
  C.damageGuard = function (gd, amt, element, isDot) {
    if (gd.hp <= 0) return true;
    gd.statuses = gd.statuses || {};
    // Round only display-facing hits: per-frame DoT slices are fractional.
    if (!isDot) amt = Math.round(amt * 10) / 10;
    if (gd.statuses.weaken && gd.statuses.weaken.t > 0) amt *= 1.25;
    if (!isDot && gd.shield > 0) {
      // Holy/light is shieldbreaking: double soak rate.
      const soak = element === "light" || element === "holy" ? amt * 2 : amt;
      const absorbed = Math.min(gd.shield, soak);
      gd.shield -= absorbed;
      amt -= (element === "light" || element === "holy") ? absorbed / 2 : absorbed;
      C.floater(gd.x, gd.y - 30, "🛡" + absorbed, "#8b93a3");
      if (amt <= 0) { C.updateHud(); return false; }
    }
    gd.hp -= amt;
    if (!isDot) C.floater(gd.x, gd.y - 30, "-" + amt, element ? "#ffd166" : "#fff");
    if (element && !isDot) {
      const st = C.statusForElement(element);
      if (st) C.applyStatus(gd, st[0], st[1], st[2]);
    }
    if (gd.hp <= 0) { C.killGuard(gd); return true; }
    C.updateHud();
    return false;
  };

  // Guard DoTs + slow/stun. Returns {mult, stunned, died}.
  C.tickGuardStatuses = function (gd, dt) {
    gd.statuses = gd.statuses || {};
    for (const id of ["burn", "poison"]) {
      const s = gd.statuses[id];
      if (s && s.t > 0) {
        s.t -= dt;
        if (C.damageGuard(gd, s.power * dt, null, true)) return { mult: 1, stunned: false, died: true };
      }
    }
    let mult = 1, stunned = false;
    const slow = gd.statuses.slow;
    if (slow && slow.t > 0) { mult = slow.power; slow.t -= dt; }
    const stun = gd.statuses.stun;
    if (stun && stun.t > 0) { stunned = true; stun.t -= dt; }
    const weak = gd.statuses.weaken;
    if (weak && weak.t > 0) weak.t -= dt;
    return { mult, stunned, died: false };
  };

  C.updateFx = function (dt) {
    for (const rg of C.rings) rg.age += dt;
    C.rings = C.rings.filter(rg => rg.age < rg.max);
    for (const rm of C.rooms.values()) {
      if (!rm.scorch) continue;
      for (const s of rm.scorch) s.age += dt;
      rm.scorch = rm.scorch.filter(s => s.age < 20);
    }
    for (const b of C.beams) b.age += dt;
    C.beams = C.beams.filter(b => b.age < b.max);
    for (const d of C.delayed) {
      d.t -= dt;
      if (d.t <= 0) {
        C.rings.push({ x: d.x, y: d.y, age: 0, max: 0.3, r: d.r, col: "#ff8c00" });
        C.detonate(d.x, d.y, d.r, d.dmg, d.element);
      }
    }
    C.delayed = C.delayed.filter(d => d.t > 0);
  };
  C.updateRings = C.updateFx;

  // Player-placed constructs: turrets shoot, everything wears out.
  C.updatePlaced = function (dt) {
    const p = C.G.p, room = C.curRoom();
    for (const pl of [...room.placed]) {
      pl.t -= dt;
      if (pl.t <= 0) {
        room.placed.splice(room.placed.indexOf(pl), 1);
        C.floater(pl.x, pl.y - 20, pl.kind + " wears out", "#8b93a3");
        continue;
      }
      if (pl.kind === "turret") {
        pl.cd -= dt;
        const g = C.nearestGuard(380);
        if (g && pl.cd <= 0) {
          const a = Math.atan2(g.y - pl.y, g.x - pl.x);
          C.projs.push({
            x: pl.x, y: pl.y, vx: Math.cos(a) * 500, vy: Math.sin(a) * 500,
            dmg: pl.dmg, foe: false, life: 0.8, element: null,
          });
          pl.cd = 0.8;
        }
      }
    }
  };

  C.updateTempWalls = function (dt) {
    for (const room of C.rooms.values()) {
      if (!room.tempWalls) continue;
      for (const w of room.tempWalls) w.t -= dt;
      room.tempWalls = room.tempWalls.filter(w => w.t > 0);
    }
  };

  // Machines have hull by tier. AoE and stray shots wreck them into parts.
  C.damageMachine = function (room, m, amt) {
    if (!room.machines.includes(m)) return;
    m.hp -= amt;
    if (m.hp > 0) {
      C.floater(m.x, m.y - C.MH / 2 - 10, "crack", "#8b93a3");
      return;
    }
    room.machines.splice(room.machines.indexOf(m), 1);
    const parts = C.tierIdx(m.tier) + 1;
    room.pickups.push({ kind: "parts", amount: parts,
      x: m.x, y: m.y, bob: 0, age: 0 });
    room.scorch.push({ x: m.x, y: m.y, age: 0 });
    if (m.pull) C.floater(m.x, m.y - 50, "pull lost!", "#ff5555");
    C.floater(m.x, m.y - 50, "💥 " + m.tier + " " + m.kind + " → +" + parts + "🧩", "#ffe066");
    C.G.shake = Math.max(C.G.shake, 0.15);
    C.updateHud();
  };

  // Shared AoE: nova powers and volatile pickups both go through here.
  C.detonate = function (x, y, radius, dmg, element) {
    C.rings.push({ x, y, age: 0, max: 0.35, r: radius });
    const room = C.curRoom();
    for (const m of [...room.machines]) {
      if (Math.hypot(m.x - x, m.y - y) < radius + 40) C.damageMachine(room, m, dmg);
    }
    for (const gd of [...room.guards]) {
      const d = Math.hypot(gd.x - x, gd.y - y);
      if (d > radius + 14) continue;
      const a = Math.atan2(gd.y - y, gd.x - x) || 0;
      const fx = C.collideCircle(gd.x + Math.cos(a) * 52, gd.y + Math.sin(a) * 52, 9, C.solids(room));
      gd.x = fx[0]; gd.y = fx[1];
      C.damageGuard(gd, dmg, element);
    }
    C.G.shake = 0.15;
  };

  C.nearestGuard = function (maxD) {
    let best = null, bd = maxD || 1e9;
    for (const gd of C.curRoom().guards) {
      const d = Math.hypot(gd.x - C.G.p.x, gd.y - C.G.p.y);
      if (d < bd) { bd = d; best = gd; }
    }
    return best;
  };

  C.killGuard = function (gd) {
    const room = C.curRoom();
    room.guards = room.guards.filter(g => g !== gd);
    C.G.kills++;
    if (gd.type === "collector") {
      // The Collector drops what it was carrying: a payout on the floor.
      const mk = (data) => room.pickups.push(Object.assign(
        { x: gd.x, y: gd.y, bob: Math.random() * 6, age: 0 }, data));
      mk({ kind: "coins", amount: 60 + room.depth * 10 });
      mk({ kind: "ticket", tier: "gold" });
      mk({ kind: "ticket", tier: "silver" });
      C.showCard("💀 DEBT COLLECTOR DOWN",
        "It dropped +" + (60 + room.depth * 10) + " coins, gold + silver tickets. Grab them.",
        "Threat remains ★" + C.G.threat + " — the house has more.", 4000);
    }
    const nt = Math.min(5, Math.floor(C.G.kills / 2));
    if (nt > C.G.threat) {
      C.G.threat = nt;
      C.showCard("Threat ★" + nt,
        "You fought back. Future waves get faster, tougher, ranged.", "", 3000);
    }
    if (!C.G.feats.firstBlood) {
      C.G.feats.firstBlood = 1;
      C.G.p.tickets.silver++;
      C.showCard("Feat: First blood",
        "+1× Silver Ability ticket. Threat ★" + C.G.threat + ".", "", 3000);
    }
    if (Math.random() < C.ticketDropChance()) {
      const spont = ["bronze", "silver", "gold"][Math.floor(Math.random() * 3)];
      C.G.p.tickets[spont]++;
    }
    C.updateHud();
  };

  C.hurtPlayer = function (n, element) {
    const p = C.G.p;
    if (p.inv > 0 || p.rollT > 0 || C.G.over) return;
    // Armor: flat chance to fully block a hit (capped at 50%).
    if ((p.armorPct || 0) > 0 && Math.random() < p.armorPct) {
      C.floater(p.x, p.y - 24, "blocked", "#7df9ff");
      p.inv = Math.max(p.inv, 0.4);
      C.G.shake = 0.1;
      C.updateHud();
      return;
    }
    if (element && p.resist[element]) n *= 1 - Math.min(0.5, p.resist[element]);
    p.hp -= n; p.inv = 0.9; C.G.shake = 0.2;
    if (p.hp <= 0) C.die();
    C.updateHud();
  };

  C.die = function () {
    C.G.over = true;
    const dreRoom = C.curRoom();
    const best = C.saveBest(dreRoom.depth, C.G.t, C.G.kills);
    const bestTag = best ? " ★ NEW BEST" : "";
    // Too fast to impress the house: no legacy pull under 10 seconds.
    if (C.G.t < 10) {
      const room = C.curRoom();
      C.ui.deathStats.textContent = "Survived " + C.fmtTime(C.G.t) + " · depth " + room.depth +
        " · " + C.G.kills + " kills · " + C.G.pulls + " pulls." + bestTag;
      C.ui.deathLegacy.textContent = "Gone in " + Math.floor(C.G.t) +
        "s — too fast for a legacy pull. Survive 10s+ to earn one.";
      C.ui.deathLegacy.style.color = "#878d96";
      C.ui.deathBox.classList.add("show");
      return;
    }
    const mins = C.G.t / 60;
    const lt = C.legacyTierFor(mins);
    const t = C.tierById(lt);
    let res;
    try {
      const pool = C.entries();
      res = window.ChaosGacha
        ? window.ChaosGacha.roll(pool, null, "random", t.min, t.avg, t.max,
          { hideNsfw: true, hideNoncon: true }, Math.random)
        : { name: "Stub soul-boon", rarity: t.avg, category: "trait", description: "", source: "" };
    } catch (e) {
      res = { name: "Stub soul-boon", rarity: t.avg, category: "trait", description: "", source: "" };
    }
    C.legacy.push(Object.assign(
      { name: res.name, rarity: res.rarity, category: res.category, at: Date.now() },
      // Heirloom: 15+ minute runs carry their weapon across death.
      (C.G.t >= 900 && C.G.p.weapon) ? { heirloom: Object.assign({}, C.G.p.weapon) } : {}));
    C.saveLegacy();
    const room = C.curRoom();
    C.ui.deathStats.textContent = "Survived " + C.fmtTime(C.G.t) + " · depth " + room.depth +
      " · " + C.G.kills + " kills · " + C.G.pulls + " pulls · Threat ★" + C.G.threat + "." + bestTag;
    C.ui.deathLegacy.textContent = "Legacy pull (" + lt + "): [" + C.rarityName(res.rarity) + "] " +
      res.name + " (" + Number(res.rarity).toFixed(1) + ") — permanent: +" +
      Math.floor(res.rarity * 8) + " starting coins, pulls faster" +
      (res.rarity >= 6 ? ", +1 max HP" : "") + "." +
      ((C.G.t >= 900 && C.G.p.weapon) ? " Heirloom kept: " + C.G.p.weapon.name + "." : "");
    C.ui.deathLegacy.style.color = C.rarityColor(res.rarity);
    C.ui.deathBox.classList.add("show");
  };

  function hurtTouch(gd, p, d) {
    if (d < 26 && gd.atkCd <= 0) {
      C.hurtPlayer(gd.touchDmg || 1, gd.affix === "elemental" ? gd.element : null);
      if (gd.affix === "elemental" && gd.element) {
        const st = C.statusForElement(gd.element);
        if (st) C.applyStatus(p, st[0], st[1], st[2]);
      }
      gd.atkCd = 0.9;
    }
  }

  function foeShot(gd, a) {
    C.projs.push({
      x: gd.x, y: gd.y, vx: Math.cos(a) * 300, vy: Math.sin(a) * 300,
      dmg: 1, foe: true, life: 1.6,
      element: gd.affix === "elemental" ? gd.element : null,
    });
    gd.atkCd = 1.6;
  }

  function chaseMove(gd, p, room, dt, mult) {
    const a = Math.atan2(p.y - gd.y, p.x - gd.x);
    gd.x += Math.cos(a) * gd.speed * mult * dt;
    gd.y += Math.sin(a) * gd.speed * mult * dt;
    const fixed = C.collideCircle(gd.x, gd.y, 9, C.solids(room));
    gd.x = fixed[0]; gd.y = fixed[1];
    return a;
  }

  C.updateGuards = function (dt) {
    const p = C.G.p, room = C.curRoom();
    for (const gd of [...room.guards]) {
      const d = Math.hypot(gd.x - p.x, gd.y - p.y);
      // Cloaked: the trail goes cold, chasers give up.
      if (C.G.p.cloakT > 0) {
        gd.chase = false;
        const cl = C.tickGuardStatuses(gd, dt);
        if (cl.died) continue;
        if (gd.atkCd > 0) gd.atkCd -= dt;
        continue;
      }
      // DoTs tick even on unaware guards; slow/stun matter once chasing.
      const st = C.tickGuardStatuses(gd, dt);
      if (st.died) continue;
      if (!gd.chase && (d < gd.sight || room.alert > 0)) gd.chase = true;
      if (!gd.chase) { if (gd.atkCd > 0) gd.atkCd -= dt; continue; }
      const mult = (p.rollT > 0 ? 0.7 : 1) * st.mult;
      if (st.stunned) { if (gd.atkCd > 0) gd.atkCd -= dt; continue; }
      if (gd.affix === "charger") {
        gd.dashCd -= dt;
        if (gd.dashT > 0) {
          // Committed dash along the locked direction.
          gd.dashT -= dt;
          gd.x += gd.dashDx * 340 * dt;
          gd.y += gd.dashDy * 340 * dt;
          const fixed = C.collideCircle(gd.x, gd.y, 9, C.solids(room));
          gd.x = fixed[0]; gd.y = fixed[1];
          hurtTouch(gd, p, Math.hypot(gd.x - p.x, gd.y - p.y));
        } else if (gd.teleT > 0) {
          // Telegraph: hold still, then go.
          gd.teleT -= dt;
          if (gd.teleT <= 0) {
            const a = Math.atan2(p.y - gd.y, p.x - gd.x);
            gd.dashDx = Math.cos(a); gd.dashDy = Math.sin(a);
            gd.dashT = 0.28;
          }
        } else {
          const a = chaseMove(gd, p, room, dt, mult);
          if (gd.dashCd <= 0 && d < 280 && d > 70) {
            gd.teleT = 0.5; gd.dashCd = 3.2;
          }
          hurtTouch(gd, p, Math.hypot(gd.x - p.x, gd.y - p.y));
          if (gd.ranged && d < 380 && d > 120 && gd.atkCd <= 0) foeShot(gd, a);
        }
      } else {
        const a = chaseMove(gd, p, room, dt, mult);
        hurtTouch(gd, p, Math.hypot(gd.x - p.x, gd.y - p.y));
        if (gd.ranged && d < 380 && d > 120 && gd.atkCd <= 0) foeShot(gd, a);
      }
      if (gd.atkCd > 0) gd.atkCd -= dt;
    }
  };

  // Familiar storage (Doc rule, run-scaled): 2 active, rest stabled. P rotates.
  // Summoned temps stay pinned and are never stabled.
  C.rotatePets = function () {
    const p = C.G.p;
    const act = () => p.pets.filter(q => !q.temp);
    if (!p.stable.length) {
      const a = act();
      if (a.length > 1) {
        p.pets.splice(p.pets.indexOf(a[0]), 1);
        p.pets.push(a[0]);
        C.showCard("Familiars reordered",
          "Lead: " + act()[0].name + ".", "", 1800);
      }
      return;
    }
    const incoming = p.stable.shift();
    const a = act();
    if (a.length >= 2) {
      p.pets.splice(p.pets.indexOf(a[0]), 1);
      p.stable.push(a[0]);
    }
    p.pets.push(incoming);
    C.showCard("Familiars rotated",
      "Active: " + p.pets.map(q => q.name + " (" + (q.role || "gunner") + ")").join(", ") + ".",
      p.stable.length + " stabled.", 2200);
    C.updateHud();
  };

  C.updatePets = function (dt) {
    const p = C.G.p, room = C.curRoom();
    for (const pet of p.pets) {
      const i = p.pets.indexOf(pet);
      if (pet.stationary) {
        if (pet.x == null) { pet.x = p.x; pet.y = p.y; }
        continue;
      }
      const radius = (pet.role || "gunner") === "bully" ? 42 : 26;
      const spin = (pet.role || "gunner") === "bully" ? 3.2 : 2;
      const a = C.G.t * spin + i * 2.1;
      pet.x = p.x + Math.cos(a) * radius;
      pet.y = p.y + Math.sin(a) * radius;
    }
    for (const pet of [...p.pets]) {
      if (pet.temp) {
        pet.dur -= dt;
        if (pet.dur <= 0) {
          p.pets.splice(p.pets.indexOf(pet), 1);
          C.floater(p.x, p.y - 30, pet.name.slice(0, 16) + " fades", "#8b93a3");
          continue;
        }
      }
      const role = pet.role || "gunner";
      if (role === "gunner") {
        pet.cd -= dt;
        const g = C.nearestGuard(360);
        if (g && pet.cd <= 0) {
          const a = Math.atan2(g.y - p.y, g.x - p.x);
          C.projs.push({
            x: pet.stationary ? pet.x : p.x, y: pet.stationary ? pet.y : p.y,
            vx: Math.cos(a) * 460, vy: Math.sin(a) * 460,
            dmg: pet.dmg, foe: false, life: 0.7, element: pet.element || null,
          });
          pet.cd = pet.cdMax || 1.1;
        }
      } else if (role === "bully") {
        // Brawling orbiter: body-slams guards it touches.
        pet.cd -= dt;
        if (pet.cd <= 0) {
          let hit = false;
          for (const gd of [...room.guards]) {
            if (Math.hypot(gd.x - pet.x, gd.y - pet.y) < 20) {
              const a = Math.atan2(gd.y - p.y, gd.x - p.x) || 0;
              const fx = C.collideCircle(gd.x + Math.cos(a) * 30, gd.y + Math.sin(a) * 30,
                9, C.solids(room));
              gd.x = fx[0]; gd.y = fx[1];
              C.damageGuard(gd, pet.dmg, null);
              hit = true;
            }
          }
          pet.cd = hit ? 0.5 : 0.1;
        }
      } else if (role === "medic") {
        pet.cd -= dt;
        if (pet.cd <= 0) {
          if (p.hp < p.maxHp) {
            const amt = 1 + (p.healBonus || 0);
            p.hp = Math.min(p.maxHp, p.hp + amt);
            C.floater(p.x, p.y - 24, "+" + amt + " HP (" + pet.name.slice(0, 14) + ")", "#11d939");
            C.updateHud();
            pet.cd = pet.cdMax || 18;
          } else {
            pet.cd = 1;
          }
        }
      }
      // mule (loot magnet) and scout (ticket luck) are passive auras.
    }
  };

  C.updateProjectiles = function (dt) {
    const p = C.G.p, room = C.curRoom();
    for (const pr of [...C.projs]) {
      pr.x += pr.vx * dt; pr.y += pr.vy * dt; pr.life -= dt;
      if (pr.life <= 0 || C.pointBlocked(room, pr.x, pr.y) ||
          (pr.foe && C.pointBlockedTemp(room, pr.x, pr.y))) {
        C.projs.splice(C.projs.indexOf(pr), 1);
        continue;
      }
      let hit = false;
      if (pr.foe) {
        if (Math.hypot(pr.x - p.x, pr.y - p.y) < 12) {
          C.hurtPlayer(pr.dmg, pr.element);
          if (pr.element) {
            const pst = C.statusForElement(pr.element);
            if (pst) C.applyStatus(p, pst[0], pst[1], pst[2]);
          }
          hit = true;
        }
      } else {
        for (const gd of [...room.guards]) {
          if (Math.hypot(pr.x - gd.x, pr.y - gd.y) < 14) {
            C.damageGuard(gd, pr.dmg, pr.element);
            hit = true;
            break;
          }
        }
      }
      // Missed shots (both sides) slam into machines and wreck them.
      if (!hit) {
        for (const m of [...room.machines]) {
          if (Math.abs(pr.x - m.x) < C.MW / 2 && Math.abs(pr.y - m.y) < C.MH / 2) {
            C.damageMachine(room, m, pr.dmg);
            hit = true;
            break;
          }
        }
      }
      if (hit) C.projs.splice(C.projs.indexOf(pr), 1);
    }
  };
})(window.Casino);
