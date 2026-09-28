"use strict";
/* Combat: player attacks, guards, pets, projectiles, death/legacy.
 * Depends on: config, dom, state, legacy, prizes (runtime). */
(function (C) {
  C.tryAttack = function () {
    const p = C.G.p;
    if (!p.weapon || p.atkCd > 0 || C.G.over) return;
    p.atkCd = 0.45;
    if (p.weapon.ranged) {
      const g = C.nearestGuard(420);
      const a = g ? Math.atan2(g.y - p.y, g.x - p.x) : 0;
      C.projs.push({
        x: p.x, y: p.y, vx: Math.cos(a) * 520, vy: Math.sin(a) * 520,
        dmg: p.dmg, foe: false, life: 0.8, element: p.weapon.element,
      });
    } else {
      for (const gd of [...C.curRoom().guards]) {
        if (Math.hypot(gd.x - p.x, gd.y - p.y) < p.range + 14) {
          C.damageGuard(gd, p.dmg, p.weapon.element);
        }
      }
      C.G.shake = 0.12;
    }
  };

  // Fire a slotted active power. Cooldown-gated; heal won't waste on full HP.
  C.runActive = function (i) {
    const p = C.G.p, ab = p.slots[i];
    if (!ab || ab.cdLeft > 0 || C.G.over || C.G.title) return false;
    if (ab.op === "bolt") {
      const g = C.nearestGuard(460);
      const a = g ? Math.atan2(g.y - p.y, g.x - p.x) : p.facing;
      const dmg = ab.power + (p.weapon ? 1 : 0);
      const angs = ab.element === "venom" ? [-0.18, 0, 0.18] : [0];
      for (const off of angs) {
        C.projs.push({
          x: p.x, y: p.y, vx: Math.cos(a + off) * 560, vy: Math.sin(a + off) * 560,
          dmg, foe: false, life: 0.9, element: ab.element,
        });
      }
    } else if (ab.op === "nova") {
      const R = 135;
      C.rings.push({ x: p.x, y: p.y, age: 0, max: 0.35, r: R });
      const room = C.curRoom();
      for (const gd of [...room.guards]) {
        const d = Math.hypot(gd.x - p.x, gd.y - p.y);
        if (d > R + 14) continue;
        const a = Math.atan2(gd.y - p.y, gd.x - p.x) || 0;
        const fx = C.collideCircle(gd.x + Math.cos(a) * 52, gd.y + Math.sin(a) * 52, 9, C.solids(room));
        gd.x = fx[0]; gd.y = fx[1];
        C.damageGuard(gd, ab.power + (p.weapon ? 1 : 0), ab.element);
      }
      C.G.shake = 0.15;
    } else if (ab.op === "dash") {
      p.dashDx = Math.cos(p.facing); p.dashDy = Math.sin(p.facing);
      p.dashSpd = ab.power;
      p.rollT = 0.3;
    } else if (ab.op === "heal") {
      if (p.hp >= p.maxHp) return false;
      p.hp = Math.min(p.maxHp, p.hp + ab.power);
      C.floater(p.x, p.y - 24, "+" + ab.power + " HP", "#11d939");
    } else {
      return false;
    }
    ab.cdLeft = ab.cd;
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
    if (element === "frost") return ["slow", 2, 0.5];
    if (element === "bolt") return ["stun", 0.45, 0];
    if (element === "venom") return ["poison", 4, 0.6];
    return null;
  };

  // Single choke point for guard damage: shields soak direct hits (dots seep
  // through), numbers pop, elements apply, death routes to killGuard.
  C.damageGuard = function (gd, amt, element, isDot) {
    if (gd.hp <= 0) return true;
    // Round only display-facing hits: per-frame DoT slices are fractional.
    if (!isDot) amt = Math.round(amt * 10) / 10;
    if (!isDot && gd.shield > 0) {
      const absorbed = Math.min(gd.shield, amt);
      gd.shield -= absorbed; amt -= absorbed;
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
    return { mult, stunned, died: false };
  };

  C.updateRings = function (dt) {
    for (const rg of C.rings) rg.age += dt;
    C.rings = C.rings.filter(rg => rg.age < rg.max);
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
    if (Math.random() < 0.3) {
      const spont = ["bronze", "silver", "gold"][Math.floor(Math.random() * 3)];
      C.G.p.tickets[spont]++;
    }
    C.updateHud();
  };

  C.hurtPlayer = function (n) {
    const p = C.G.p;
    if (p.inv > 0 || p.rollT > 0 || C.G.over) return;
    p.hp -= n; p.inv = 0.9; C.G.shake = 0.2;
    if (p.hp <= 0) C.die();
    C.updateHud();
  };

  C.die = function () {
    C.G.over = true;
    // Too fast to impress the house: no legacy pull under 10 seconds.
    if (C.G.t < 10) {
      const room = C.curRoom();
      C.ui.deathStats.textContent = "Survived " + C.fmtTime(C.G.t) + " · depth " + room.depth +
        " · " + C.G.kills + " kills · " + C.G.pulls + " pulls.";
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
    C.legacy.push({ name: res.name, rarity: res.rarity, category: res.category, at: Date.now() });
    C.saveLegacy();
    const room = C.curRoom();
    C.ui.deathStats.textContent = "Survived " + C.fmtTime(C.G.t) + " · depth " + room.depth +
      " · " + C.G.kills + " kills · " + C.G.pulls + " pulls · Threat ★" + C.G.threat + ".";
    C.ui.deathLegacy.textContent = "Legacy pull (" + lt + "): [" + C.rarityName(res.rarity) + "] " +
      res.name + " (" + Number(res.rarity).toFixed(1) + ") — permanent: +" +
      Math.floor(res.rarity * 8) + " starting coins, pulls faster" +
      (res.rarity >= 6 ? ", +1 max HP" : "") + ".";
    C.ui.deathLegacy.style.color = C.rarityColor(res.rarity);
    C.ui.deathBox.classList.add("show");
  };

  function hurtTouch(gd, p, d) {
    if (d < 26 && gd.atkCd <= 0) {
      C.hurtPlayer(1);
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

  C.updatePets = function (dt) {
    const p = C.G.p;
    for (const pet of p.pets) {
      pet.cd -= dt;
      const g = C.nearestGuard(360);
      if (g && pet.cd <= 0) {
        const a = Math.atan2(g.y - p.y, g.x - p.x);
        C.projs.push({
          x: p.x, y: p.y, vx: Math.cos(a) * 460, vy: Math.sin(a) * 460,
          dmg: pet.dmg, foe: false, life: 0.7,
        });
        pet.cd = 1.1;
      }
    }
  };

  C.updateProjectiles = function (dt) {
    const p = C.G.p, room = C.curRoom();
    for (const pr of [...C.projs]) {
      pr.x += pr.vx * dt; pr.y += pr.vy * dt; pr.life -= dt;
      if (pr.life <= 0 || C.pointBlocked(room, pr.x, pr.y)) {
        C.projs.splice(C.projs.indexOf(pr), 1);
        continue;
      }
      if (pr.foe) {
        if (Math.hypot(pr.x - p.x, pr.y - p.y) < 12) {
          C.hurtPlayer(pr.dmg);
          if (pr.element) {
            const pst = C.statusForElement(pr.element);
            if (pst) C.applyStatus(p, pst[0], pst[1], pst[2]);
          }
          C.projs.splice(C.projs.indexOf(pr), 1);
        }
      } else {
        for (const gd of [...room.guards]) {
          if (Math.hypot(pr.x - gd.x, pr.y - gd.y) < 14) {
            C.damageGuard(gd, pr.dmg, pr.element);
            C.projs.splice(C.projs.indexOf(pr), 1);
            break;
          }
        }
      }
    }
  };
})(window.Casino);
