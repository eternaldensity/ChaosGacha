"use strict";
/* Run state: rooms (+maze walls, pickups), player, input, collision.
 * Depends on: config, dom, legacy, hud/pulls (runtime calls). */
(function (C) {
  C.rooms = new Map();
  C.projs = [];
  C.floaters = [];
  C.rings = [];
  C.beams = [];
  C.delayed = [];
  C.keys = {};
  C.G = null;
  let attackQueued = false;
  C.queueAttack = function () { attackQueued = true; };
  // Returns true once per queued click.
  C.takeAttack = function () {
    const a = attackQueued || !!C.keys["j"];
    attackQueued = false;
    return a;
  };

  C.roomKey = (x, y) => x + "," + y;

  // Persistent one-liners describing what each prize does (see the build bar).
  C.noteBuild = function (txt, cls) {
    C.G.p.buildLog.push({ txt, cls: cls || "" });
    if (C.G.p.buildLog.length > 10) C.G.p.buildLog.shift();
  };

  function blankTickets() {
    const t = {};
    for (const tier of C.TIERS) t[tier.id] = 0;
    return t;
  }

  C.newRun = function (showTitle) {
    const b = C.legacyBonus();
    C.G = {
      over: false, title: showTitle !== false, t: 0, kills: 0, pulls: 0, threat: 0,
      roomX: 0, roomY: 0, waveT: 50,
      feats: {}, curses: [], costMult: 1, guardBonus: 0, alertMult: 1,
      p: {
        x: C.W / 2, y: C.H / 2 + 60, r: 10, hp: 3 + b.maxHp, maxHp: 3 + b.maxHp,
        speed: 165, coins: 100 + b.coins, tickets: blankTickets(),
        weapon: null, dmg: 1, range: 74, atkCd: 0, rollCd: 0, rollT: 0, inv: 0,
        pullMul: b.pullMul, discount: 0, pets: [],
        slots: [], stash: [], abilitiesOwned: 0, facing: 0,
        dashDx: null, dashDy: null, dashSpd: 0, statuses: {},
        buildLog: [], stable: [], cloakT: 0, armorPct: 0, surge: null, stance: null, mount: null,
        cdr: 0, elemBonus: {}, resist: {}, luck: 0, regen: 0, regenT: 0,
        healBonus: 0, rollCdMax: 5, threatDecayT: 0, rangedBonus: 0, draft: null,
        parts: 0, survey: false, surveyT: 0,
        sightMult: 1, cdrMult: 1, healMult: 1, dmgTakenMult: 1, dmgDealtMult: 1,
        regenOff: false, armorLock: false, pacifist: false,
        dmgTakenElementalOnly: false,
      },
      cardT: 0, shake: 0,
    };
    C.rooms.clear();
    C.projs.length = 0;
    C.floaters.length = 0;
    C.rings.length = 0;
    C.beams.length = 0;
    C.delayed.length = 0;
    // Queued death-screen curses land on the fresh run.
    for (const pick of C.pendingCurses.splice(0, C.pendingCurses.length)) {
      C.applyPick(C.G, pick);
    }
    // Heirloom: a weapon carried across death (earned by surviving 15+ min).
    const hw = C.legacyWeapon();
    if (hw) {
      C.G.p.weapon = Object.assign({}, hw);
      C.G.p.dmg = hw.dmg;
      C.noteBuild("🔫 " + hw.name + " (heirloom)");
    }
    C.getRoom(0, 0);
    C.hideDeath();
    C.updateHud();
    C.renderCurseList();
    C.renderBest();
    if (C.G.title) {
      C.showTitle();
    } else {
      C.hideTitle();
      C.showCard("Soul traded: +100 coins (+legacy " + b.coins + ")",
        "Slots give coins/tickets. Feed tickets to gacha. Security wants your soul. Run.",
        "Press E at a machine, then move — come back for the loot.", 5200);
    }
  };

  C.startGame = function () {
    if (!C.G || !C.G.title) return;
    C.G.title = false;
    C.hideTitle();
    C.showCard("Find a machine, press E, keep moving",
      "Pulls finish on their own and drop loot on the floor. Guards hear pulls — don't get cornered.",
      "Deeper doors, better machines. Good luck.", 5200);
  };

  // ---- maze walls (seeded by room coords: stable across revisits) ----
  function rectsOverlap(a, b, pad) {
    const p = pad || 0;
    return a.x < b.x + b.w + p && a.x + a.w + p > b.x &&
      a.y < b.y + b.h + p && a.y + a.h + p > b.y;
  }

  C.genWalls = function (rx, ry, depth) {
    const rnd = C.rng((rx * 73856093) ^ (ry * 19349663) ^ 0x9e37);
    const walls = [];
    // Middle band only: machine strips (top/bottom) and door cross stay clear.
    const x0 = 90, x1 = 870, y0 = 155, y1 = 385;
    const corridors = [
      { x: C.W / 2 - 60, y: 0, w: 120, h: C.H },
      { x: 0, y: C.H / 2 - 55, w: C.W, h: 110 },
    ];
    const target = depth === 0 ? 2 + Math.floor(rnd() * 2) : 4 + Math.floor(rnd() * 3);
    let tries = 0;
    while (walls.length < target && tries++ < 80) {
      const horiz = rnd() < 0.5;
      const w = horiz ? 110 + rnd() * 120 : 16;
      const h = horiz ? 16 : 90 + rnd() * 80;
      const r = { x: x0 + rnd() * (x1 - x0 - w), y: y0 + rnd() * (y1 - y0 - h), w, h };
      if (corridors.some(c => rectsOverlap(r, c, 4))) continue;
      if (walls.some(o => rectsOverlap(r, o, 30))) continue;
      walls.push(r);
    }
    return walls;
  };

  // Solid rects for collision: walls + conjured walls + machine bodies.
  C.solids = function (room) {
    const out = room.walls.slice();
    if (room.tempWalls) for (const w of room.tempWalls) out.push(w);
    for (const m of room.machines) {
      out.push({ x: m.x - C.MW / 2, y: m.y - C.MH / 2, w: C.MW, h: C.MH });
    }
    return out;
  };

  // Push a circle out of solid rects. Returns [x, y].
  C.collideCircle = function (x, y, r, rects) {
    for (const rc of rects) {
      const cx = Math.max(rc.x, Math.min(x, rc.x + rc.w));
      const cy = Math.max(rc.y, Math.min(y, rc.y + rc.h));
      const dx = x - cx, dy = y - cy, d2 = dx * dx + dy * dy;
      if (d2 >= r * r) continue;
      if (d2 === 0) {
        const l = x - rc.x, rr = rc.x + rc.w - x, tp = y - rc.y, bb = rc.y + rc.h - y;
        const m = Math.min(l, rr, tp, bb);
        if (m === l) x = rc.x - r;
        else if (m === rr) x = rc.x + rc.w + r;
        else if (m === tp) y = rc.y - r;
        else y = rc.y + rc.h + r;
      } else {
        const d = Math.sqrt(d2);
        x = cx + dx / d * r;
        y = cy + dy / d * r;
      }
    }
    return [x, y];
  };

  C.pointBlocked = function (room, x, y) {
    const solids = room.walls; // projectiles fly over machines, not walls
    for (const rc of solids) {
      if (x >= rc.x && x <= rc.x + rc.w && y >= rc.y && y <= rc.y + rc.h) return true;
    }
    return false;
  };

  // Conjured walls stop foe shots only (your magic, your rules).
  C.pointBlockedTemp = function (room, x, y) {
    for (const rc of (room.tempWalls || [])) {
      if (x >= rc.x && x <= rc.x + rc.w && y >= rc.y && y <= rc.y + rc.h) return true;
    }
    return false;
  };

  function clearOfSolids(room, x, y, r) {
    for (const s of C.solids(room)) {
      const cx = Math.max(s.x, Math.min(x, s.x + s.w));
      const cy = Math.max(s.y, Math.min(y, s.y + s.h));
      if (Math.hypot(x - cx, y - cy) < r + 8) return false;
    }
    return true;
  }

  C.getRoom = function (x, y) {
    const k = C.roomKey(x, y);
    if (C.rooms.has(k)) return C.rooms.get(k);
    const depth = Math.abs(x) + Math.abs(y);
    const danger = 1 + depth * 0.6 + Math.random() * 0.5;
    const vrnd = C.rng((x * 73471) ^ (y * 192837) ^ 0x51ab);
    const vault = depth >= 3 && vrnd() < 0.15;
    const room = {
      x, y, depth, danger, machines: [], guards: [], vault,
      walls: C.genWalls(x, y, depth), tempWalls: [], pickups: [], placed: [], scorch: [],
      alert: 0, _seen: false,
    };
    // 12 machines: 8 slots + 4 gacha. Vaults stock the top two tiers.
    const pool = C.allowedTiers(depth);
    const tierPool = vault && pool.length > 2 ? pool.slice(-2) : pool;
    const pickTier = () => {
      const P = tierPool;
      const ws = P.map((t, i) => (i + 1) * (depth >= t.minDepth + 2 ? 2 : 1));
      let tot = 0; for (const w of ws) tot += w;
      let r = Math.random() * tot;
      for (let i = 0; i < P.length; i++) { r -= ws[i]; if (r <= 0) return P[i]; }
      return P[P.length - 1];
    };
    const spots = [];
    for (let i = 0; i < 6; i++) spots.push({ x: 120 + i * 144, y: C.WALL + 44 });
    for (let i = 0; i < 6; i++) spots.push({ x: 120 + i * 144, y: C.H - C.WALL - 44 });
    // Shuffle kinds so gacha isn't always the bottom row.
    const kinds = ["slot", "slot", "slot", "slot", "slot", "slot", "slot", "slot",
      "gacha", "gacha", "gacha", "gacha"];
    for (let i = kinds.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = kinds[i]; kinds[i] = kinds[j]; kinds[j] = t;
    }
    kinds.forEach((kind, i) => {
      const t = pickTier();
      room.machines.push({
        id: i, kind, tier: t.id, color: t.color, pull: null, hp: 3 + C.tierIdx(t.id),
        idleSyms: ["◈", "◈", "◈"], lastPrize: null,
        cat: kind === "gacha"
          ? (Math.random() < 0.55 ? "random" : C.CATS[Math.floor(Math.random() * C.CATS.length)])
          : null,
        x: spots[i].x, y: spots[i].y,
      });
    });
    // Vaults run a skeleton crew (1 guard max); curses can add patrols.
    const nGuards = vault
      ? 1
      : Math.min(6, 1 + Math.floor(danger / 1.6) + (C.G.guardBonus || 0));
    let placed = 0, guardTries = 0;
    while (placed < nGuards && guardTries++ < 40) {
      const gd = C.makeGuard(room, danger);
      if (!clearOfSolids(room, gd.x, gd.y, 10)) continue;
      room.guards.push(gd);
      placed++;
    }
    C.rooms.set(k, room);
    return room;
  };

  C.curRoom = function () { return C.getRoom(C.G.roomX, C.G.roomY); };

  // Neighbor intel for surveyed doors (generates + caches the neighbor room).
  // Returns {depth, guards, best} where best is {label, color} of top machine.
  C.neighborInfo = function (dx, dy) {
    const room = C.getRoom(C.G.roomX + dx, C.G.roomY + dy);
    let best = null;
    for (const m of room.machines) {
      if (!best || C.tierIdx(m.tier) > C.tierIdx(best.tier)) best = m;
    }
    const t = best ? C.tierById(best.tier) : null;
    return {
      depth: room.depth, guards: room.guards.length,
      best: t ? { label: t.label.slice(0, 4), color: t.color } : null,
    };
  };

  // Bosses: the Collector (slow tank, threat waves) and the High Roller
  // (fast skirmisher haunting deep vaults). Both pay out in loot showers.
  C.makeBoss = function (room, danger, depth, kind) {
    const b = C.makeGuard(room, danger, true);
    b.sight = 999;
    b.ranged = true;
    b.chase = true;
    b.x = C.WALL + 80;
    b.y = C.WALL + 100 + Math.random() * 80;
    if (kind === "roller") {
      b.hp = 14 + depth * 2;
      b.speed = 175;
      b.affix = "charger";
      b.dashCd = 1.5;
      b.type = "roller";
      b.touchDmg = 1;
      b.size = 1.4;
    } else {
      b.hp = 18 + depth * 3;
      b.speed = 100;
      b.affix = "shielded";
      b.shield = 6;
      b.type = "collector";
      b.touchDmg = 2;
      b.size = 1.6;
    }
    return b;
  };

  C.hasAffix = function (gd, name) {
    return gd.affix === name || gd.affix2 === name;
  };

  C.makeGuard = function (room, danger, forceElite) {
    const elite = !!forceElite || (C.G.threat >= 3 && Math.random() < 0.35);
    const fast = C.G.threat >= 2 && Math.random() < 0.4;
    // Threat-gated affixes: chargers run you down, elementals burn/frost
    // on touch, shieldeds soak damage first.
    const th = C.G.threat;
    let affix = null, shield = 0, element = null;
    if (th >= 4 && Math.random() < 0.25) {
      affix = "shielded"; shield = 3 + Math.floor(danger);
    } else if (th >= 3 && Math.random() < 0.3) {
      affix = "elemental"; element = Math.random() < 0.5 ? "fire" : "frost";
    } else if (th >= 2 && Math.random() < 0.3) {
      affix = "charger";
    }
    // Threat 4+: elites double up.
    let affix2 = null;
    if (th >= 4 && affix && Math.random() < 0.3) {
      const seconds = affix === "elemental" ? ["charger", "shielded"] : ["charger", "shielded", "elemental"];
      affix2 = seconds[Math.floor(Math.random() * seconds.length)];
      if (affix2 === "shielded") shield += 3;
      if (affix2 === "elemental" && !element) element = Math.random() < 0.5 ? "fire" : "frost";
    }
    return {
      x: C.WALL + 60 + Math.random() * (C.W - C.WALL * 2 - 120),
      y: C.WALL + 110 + Math.random() * (C.H - C.WALL * 2 - 220),
      hp: (elite ? 5 : 2) + Math.floor(danger / 3) + (fast ? 1 : 0),
      speed: (fast ? 150 : 118) + danger * 6 + C.G.threat * 7,
      sight: 215 + danger * 12, atkCd: 0, chase: false, ranged: elite,
      type: elite ? "enforcer" : fast ? "pitboss" : "guard",
      statuses: {}, affix, affix2, shield, element,
      teleT: 0, dashT: 0, dashCd: 2, dashDx: 0, dashDy: 0,
    };
  };

  C.onEnterRoom = function () {
    const room = C.curRoom();
    C.projs.length = 0;
    C.floaters.length = 0;
    if (room.vault && room.depth >= 6 && !room.bossSpawned) {
      room.bossSpawned = true;
      if (Math.random() < 0.35) {
        room.guards.push(C.makeBoss(room, room.danger, room.depth, "roller"));
        C.showCard("🎲 HIGH ROLLER",
          "The vault's champion. Fast, rich, and rude — kill it for a shower.", "", 3000);
      }
    }
    if (!room._seen) {
      room._seen = true;
      const tiers = [...new Set(room.machines.map(m => m.tier))].join(", ");
      C.showCard(room.vault ? "★ VAULT ★ Depth " + room.depth : "Depth " + room.depth + " · Danger " + room.danger.toFixed(1),
        room.vault
          ? "Top-tier machines, skeleton crew. Grab it all — loudly."
          : "Machines: " + tiers + ". " + room.guards.length + " guards on floor.",
        room.depth >= 4 ? "Platinum+ country. Watch the timer." : "", 2600);
    }
    C.updateHud();
  };
})(window.Casino);
