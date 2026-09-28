"use strict";
/* Run state: rooms (+maze walls, pickups), player, input, collision.
 * Depends on: config, dom, legacy, hud/pulls (runtime calls). */
(function (C) {
  C.rooms = new Map();
  C.projs = [];
  C.floaters = [];
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
      feats: {},
      p: {
        x: C.W / 2, y: C.H / 2 + 60, r: 10, hp: 3 + b.maxHp, maxHp: 3 + b.maxHp,
        speed: 165, coins: 100 + b.coins, tickets: blankTickets(),
        weapon: null, dmg: 1, range: 74, atkCd: 0, rollCd: 0, rollT: 0, inv: 0,
        pullMul: b.pullMul, discount: 0, pets: [],
        slots: [], stash: [], abilitiesOwned: 0, facing: 0,
        dashDx: null, dashDy: null, dashSpd: 0,
      },
      cardT: 0, shake: 0,
    };
    C.rooms.clear();
    C.projs.length = 0;
    C.floaters.length = 0;
    C.getRoom(0, 0);
    C.hideDeath();
    C.updateHud();
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

  // Solid rects for collision: walls + machine bodies.
  C.solids = function (room) {
    const out = room.walls.slice();
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
    const room = {
      x, y, depth, danger, machines: [], guards: [],
      walls: C.genWalls(x, y, depth), pickups: [], alert: 0, _seen: false,
    };
    // 12 machines: 8 slots + 4 gacha, tiers sampled from allowed(depth).
    const pool = C.allowedTiers(depth);
    const pickTier = () => {
      const ws = pool.map((t, i) => (i + 1) * (depth >= t.minDepth + 2 ? 2 : 1));
      let tot = 0; for (const w of ws) tot += w;
      let r = Math.random() * tot;
      for (let i = 0; i < pool.length; i++) { r -= ws[i]; if (r <= 0) return pool[i]; }
      return pool[pool.length - 1];
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
        id: i, kind, tier: t.id, color: t.color, pull: null,
        idleSyms: ["◈", "◈", "◈"], lastPrize: null,
        cat: kind === "gacha"
          ? (Math.random() < 0.55 ? "random" : C.CATS[Math.floor(Math.random() * C.CATS.length)])
          : null,
        x: spots[i].x, y: spots[i].y,
      });
    });
    const nGuards = Math.min(6, 1 + Math.floor(danger / 1.6));
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

  C.makeGuard = function (room, danger) {
    const elite = C.G.threat >= 3 && Math.random() < 0.35;
    const fast = C.G.threat >= 2 && Math.random() < 0.4;
    return {
      x: C.WALL + 60 + Math.random() * (C.W - C.WALL * 2 - 120),
      y: C.WALL + 110 + Math.random() * (C.H - C.WALL * 2 - 220),
      hp: (elite ? 5 : 2) + Math.floor(danger / 3) + (fast ? 1 : 0),
      speed: (fast ? 150 : 118) + danger * 6 + C.G.threat * 7,
      sight: 215 + danger * 12, atkCd: 0, chase: false, ranged: elite,
      type: elite ? "enforcer" : fast ? "pitboss" : "guard",
    };
  };

  C.onEnterRoom = function () {
    const room = C.curRoom();
    C.projs.length = 0;
    C.floaters.length = 0;
    if (!room._seen) {
      room._seen = true;
      const tiers = [...new Set(room.machines.map(m => m.tier))].join(", ");
      C.showCard("Depth " + room.depth + " · Danger " + room.danger.toFixed(1),
        "Machines: " + tiers + ". " + room.guards.length + " guards on floor.",
        room.depth >= 4 ? "Platinum+ country. Watch the timer." : "", 2600);
    }
    C.updateHud();
  };
})(window.Casino);
