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
        dmg: p.dmg, foe: false, life: 0.8,
      });
    } else {
      for (const gd of C.curRoom().guards) {
        if (Math.hypot(gd.x - p.x, gd.y - p.y) < p.range + 14) {
          gd.hp -= p.dmg;
          if (gd.hp <= 0) C.killGuard(gd);
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
      C.projs.push({
        x: p.x, y: p.y, vx: Math.cos(a) * 560, vy: Math.sin(a) * 560,
        dmg: ab.power + (p.weapon ? 1 : 0), foe: false, life: 0.9, element: ab.element,
      });
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

  C.updateGuards = function (dt) {
    const p = C.G.p, room = C.curRoom();
    for (const gd of [...room.guards]) {
      const d = Math.hypot(gd.x - p.x, gd.y - p.y);
      if (!gd.chase && (d < gd.sight || room.alert > 0)) gd.chase = true;
      if (gd.chase) {
        const a = Math.atan2(p.y - gd.y, p.x - gd.x);
        const sp = gd.speed * (p.rollT > 0 ? 0.7 : 1);
        gd.x += Math.cos(a) * sp * dt;
        gd.y += Math.sin(a) * sp * dt;
        const fixed = C.collideCircle(gd.x, gd.y, 9, C.solids(room));
        gd.x = fixed[0]; gd.y = fixed[1];
        if (d < 26 && gd.atkCd <= 0) {
          C.hurtPlayer(1);
          gd.atkCd = 0.9;
        }
        if (gd.ranged && d < 380 && d > 120 && gd.atkCd <= 0) {
          C.projs.push({
            x: gd.x, y: gd.y, vx: Math.cos(a) * 300, vy: Math.sin(a) * 300,
            dmg: 1, foe: true, life: 1.6,
          });
          gd.atkCd = 1.6;
        }
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
          C.projs.splice(C.projs.indexOf(pr), 1);
        }
      } else {
        for (const gd of [...room.guards]) {
          if (Math.hypot(pr.x - gd.x, pr.y - gd.y) < 14) {
            gd.hp -= pr.dmg;
            C.projs.splice(C.projs.indexOf(pr), 1);
            if (gd.hp <= 0) C.killGuard(gd);
            break;
          }
        }
      }
    }
  };
})(window.Casino);
