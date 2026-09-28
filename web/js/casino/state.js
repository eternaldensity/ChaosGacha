"use strict";
/* Run state: rooms, player, input. Depends on: config, dom, legacy, hud (runtime). */
(function (C) {
  C.rooms = new Map();
  C.projs = [];
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

  C.newRun = function () {
    const b = C.legacyBonus();
    C.G = {
      over: false, t: 0, kills: 0, pulls: 0, threat: 0,
      roomX: 0, roomY: 0, waveT: 50,
      feats: {},
      p: {
        x: C.W / 2, y: C.H / 2 + 60, r: 10, hp: 3 + b.maxHp, maxHp: 3 + b.maxHp,
        speed: 165, coins: 100 + b.coins, tickets: blankTickets(),
        weapon: null, dmg: 1, range: 74, atkCd: 0, rollCd: 0, rollT: 0, inv: 0,
        pullMul: b.pullMul, discount: 0, pets: [],
      },
      pull: null, cardT: 0, shake: 0,
    };
    C.rooms.clear();
    C.projs.length = 0;
    C.getRoom(0, 0);
    C.hideDeath();
    C.updateHud();
    C.showCard("Soul traded: +100 coins (+legacy " + b.coins + ")",
      "Slots give coins/tickets. Feed tickets to gacha. Security wants your soul. Run.",
      "Hold E at a machine. Deeper = better tiers, worse danger.", 5200);
  };

  C.getRoom = function (x, y) {
    const k = C.roomKey(x, y);
    if (C.rooms.has(k)) return C.rooms.get(k);
    const depth = Math.abs(x) + Math.abs(y);
    const danger = 1 + depth * 0.6 + Math.random() * 0.5;
    const room = { x, y, depth, danger, machines: [], guards: [], alert: 0, _seen: false };
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
    for (let i = 0; i < 6; i++) spots.push({ x: 120 + i * 144, y: C.WALL + 34 });
    for (let i = 0; i < 6; i++) spots.push({ x: 120 + i * 144, y: C.H - C.WALL - 34 });
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
        id: i, kind, tier: t.id, color: t.color,
        cat: kind === "gacha"
          ? (Math.random() < 0.55 ? "random" : C.CATS[Math.floor(Math.random() * C.CATS.length)])
          : null,
        x: spots[i].x, y: spots[i].y, w: 64, h: 40,
      });
    });
    const nGuards = Math.min(6, 1 + Math.floor(danger / 1.6));
    for (let i = 0; i < nGuards; i++) room.guards.push(C.makeGuard(room, danger));
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
    if (C.G.pull) C.cancelPull("You left the room");
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
