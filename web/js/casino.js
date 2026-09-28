"use strict";
/* Chaos Casino MVP: topdown room crawler, slow pulls, 3-reel slots, 1-reel gacha.
 * Slots -> coins/tickets. Gacha (1 ticket) -> Chaos Gacha prize via ChaosGacha.roll.
 * Depth gates: plat 4+, diamond 6+, legendary 8+, mythical 11+, divine 14+.
 */
(function () {
  const cv = document.getElementById("game");
  const ctx = cv.getContext("2d");
  ctx.imageSmoothingEnabled = false;

  const el = id => document.getElementById(id);
  const overlay = el("reelOverlay"), reelTitle = el("reelTitle"),
    slotReels = el("slotReels"), sreels = [...slotReels.querySelectorAll(".sreel")],
    gachaReel = el("gachaReel"), chanBar = el("chanBar"),
    card = el("card"), cardTitle = el("cardTitle"), cardBody = el("cardBody"), cardSub = el("cardSub"),
    deathBox = el("death");

  // ---- tiers (presets mirror Gacha.py min/avg/max) ----
  const TIERS = [
    { id: "bronze",    label: "Bronze",    cost: 5,    pull: 2.5, color: "#9c7e5a", min: 0.1, avg: 1.3, max: 3.3,  minDepth: 0 },
    { id: "silver",    label: "Silver",    cost: 12,   pull: 3.0, color: "#aed1d1", min: 0.5, avg: 2.3, max: 4.3,  minDepth: 0 },
    { id: "gold",      label: "Gold",      cost: 30,   pull: 3.8, color: "#11d939", min: 1.5, avg: 3.3, max: 5.3,  minDepth: 2 },
    { id: "platinum",  label: "Platinum",  cost: 70,   pull: 4.5, color: "#1172d9", min: 2.5, avg: 4.3, max: 6.3,  minDepth: 4 },
    { id: "diamond",   label: "Diamond",   cost: 150,  pull: 5.2, color: "#6811d9", min: 3.5, avg: 5.3, max: 7.3,  minDepth: 6 },
    { id: "legendary", label: "Legendary", cost: 300,  pull: 6.0, color: "#f7d40a", min: 4.5, avg: 6.3, max: 8.3,  minDepth: 8 },
    { id: "mythical",  label: "Mythical",  cost: 600,  pull: 6.5, color: "#fc61ff", min: 5.5, avg: 7.3, max: 9.3,  minDepth: 11 },
    { id: "divine",    label: "Divine",    cost: 1200, pull: 7.5, color: "#ff8c00", min: 6.5, avg: 8.3, max: 10.0, minDepth: 14 },
  ];
  const tierById = id => TIERS.find(t => t.id === id);
  const allowed = depth => TIERS.filter(t => depth >= t.minDepth);

  function rarityColor(r) {
    if (r < 1) return "#878d96"; if (r < 2) return "#9c7e5a"; if (r < 3) return "#aed1d1";
    if (r < 4) return "#11d939"; if (r < 5) return "#1172d9"; if (r < 6) return "#6811d9";
    if (r < 7) return "#f7d40a"; if (r < 8) return "#fc61ff"; if (r < 9) return "#ff8c00";
    return "#ff0000";
  }
  function rarityName(r) {
    if (r < 1) return "Trash"; if (r < 2) return "Common"; if (r < 3) return "Uncommon";
    if (r < 4) return "Rare"; if (r < 5) return "Elite"; if (r < 6) return "Epic";
    if (r < 7) return "Legendary"; if (r < 8) return "Mythical"; if (r < 9) return "Divine";
    return "Transcendent";
  }

  const ENTRIES = (window.CHAOS_DATA && window.CHAOS_DATA.entries) || [];
  const CATS = ["ability", "item", "skill", "trait", "familiar"];
  const SYMS = ["7", "BAR", "★", "♦", "♥", "🪙"];

  // ---- persistent legacy ----
  let legacy = [];
  try { legacy = JSON.parse(localStorage.getItem("chaosCasinoLegacy") || "[]"); } catch (e) { legacy = []; }
  function legacyBonus() {
    const b = { coins: 0, pullMul: 1, maxHp: 0 };
    for (const l of legacy) {
      b.coins += Math.floor((l.rarity || 1) * 8);
      b.pullMul *= 0.97;
      if ((l.rarity || 0) >= 6) b.maxHp += 1;
    }
    b.pullMul = Math.max(0.6, b.pullMul);
    return b;
  }

  // ---- run state ----
  const W = 960, H = 540, WALL = 46;
  let G = null;
  const rooms = new Map();
  const key = (x, y) => x + "," + y;

  function newRun() {
    const b = legacyBonus();
    G = {
      over: false, t: 0, kills: 0, pulls: 0, threat: 0,
      roomX: 0, roomY: 0, waveT: 50,
      feats: {},
      p: {
        x: W / 2, y: H / 2 + 60, r: 10, hp: 3 + b.maxHp, maxHp: 3 + b.maxHp,
        speed: 165, coins: 100 + b.coins, tickets: { bronze: 0, silver: 0, gold: 0, platinum: 0, diamond: 0, legendary: 0, mythical: 0, divine: 0 },
        weapon: null, dmg: 1, range: 74, atkCd: 0, rollCd: 0, rollT: 0, inv: 0,
        pullMul: b.pullMul, discount: 0, magnet: 0, cloak: 0, pets: [],
      },
      pull: null, cardT: 0, shake: 0,
    };
    rooms.clear();
    getRoom(0, 0);
    hideDeath();
    showCard("Soul traded: +100 coins (+legacy " + b.coins + ")",
      "Slots give coins/tickets. Feed tickets to gacha. Security wants your soul. Run.",
      "Hold E at a machine. Deeper = better tiers, worse danger.", 5200);
  }

  function getRoom(x, y) {
    const k = key(x, y);
    if (rooms.has(k)) return rooms.get(k);
    const depth = Math.abs(x) + Math.abs(y);
    const danger = 1 + depth * 0.6 + Math.random() * 0.5;
    const room = { x, y, depth, danger, machines: [], guards: [], alert: 0 };
    // 12 machines: 8 slots + 4 gacha, tiers sampled from allowed(depth)
    const pool = allowed(depth);
    const pickTier = () => {
      const ws = pool.map((t, i) => (i + 1) * (depth >= t.minDepth + 2 ? 2 : 1));
      let tot = 0; for (const w of ws) tot += w;
      let r = Math.random() * tot;
      for (let i = 0; i < pool.length; i++) { r -= ws[i]; if (r <= 0) return pool[i]; }
      return pool[pool.length - 1];
    };
    let id = 0;
    const spots = [];
    for (let i = 0; i < 6; i++) spots.push({ x: 120 + i * 144, y: WALL + 34 });
    for (let i = 0; i < 6; i++) spots.push({ x: 120 + i * 144, y: H - WALL - 34 });
    // shuffle tiers so gacha isn't always bottom row
    const kinds = ["slot", "slot", "slot", "slot", "slot", "slot", "slot", "slot", "gacha", "gacha", "gacha", "gacha"];
    for (let i = kinds.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = kinds[i]; kinds[i] = kinds[j]; kinds[j] = t; }
    kinds.forEach((kind, i) => {
      const t = pickTier();
      room.machines.push({
        id: id++, kind, tier: t.id, color: t.color,
        cat: kind === "gacha" ? (Math.random() < 0.55 ? "random" : CATS[Math.floor(Math.random() * CATS.length)]) : null,
        x: spots[i].x, y: spots[i].y, w: 64, h: 40,
      });
    });
    const nGuards = Math.min(6, 1 + Math.floor(danger / 1.6));
    for (let i = 0; i < nGuards; i++) {
      room.guards.push(makeGuard(room, depth, danger));
    }
    rooms.set(k, room);
    return room;
  }
  function curRoom() { return getRoom(G.roomX, G.roomY); }

  function makeGuard(room, depth, danger) {
    const elite = G.threat >= 3 && Math.random() < 0.35;
    const fast = G.threat >= 2 && Math.random() < 0.4;
    return {
      x: WALL + 60 + Math.random() * (W - WALL * 2 - 120),
      y: WALL + 110 + Math.random() * (H - WALL * 2 - 220),
      hp: (elite ? 5 : 2) + Math.floor(danger / 3) + (fast ? 1 : 0),
      speed: (fast ? 150 : 118) + danger * 6 + G.threat * 7,
      sight: 215 + danger * 12, atkCd: 0, chase: false, ranged: elite,
      type: elite ? "enforcer" : fast ? "pitboss" : "guard",
    };
  }

  // ---- input ----
  const keys = {};
  let attackQueued = false;
  addEventListener("keydown", e => {
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(e.key)) e.preventDefault();
    keys[e.key.toLowerCase()] = true;
    if (e.key.toLowerCase() === "r" && G && G.over) newRun();
  });
  addEventListener("keyup", e => { keys[e.key.toLowerCase()] = false; });
  cv.addEventListener("mousedown", () => { attackQueued = true; });

  function moving() {
    return keys["w"] || keys["a"] || keys["s"] || keys["d"] ||
      keys["arrowup"] || keys["arrowdown"] || keys["arrowleft"] || keys["arrowright"];
  }

  // ---- card / death UI ----
  function showCard(t, b, s, ms) {
    cardTitle.textContent = t; cardBody.textContent = b || ""; cardSub.textContent = s || "";
    card.classList.add("show"); G.cardT = (ms || 3500) / 1000;
  }
  function hideDeath() { deathBox.classList.remove("show"); }

  // ---- slot + gacha resolution ----
  function slotCost(t) { return Math.max(1, Math.round(t.cost * (1 - G.p.discount))); }

  function rollSlotPayout(t) {
    const r = Math.random();
    const idx = TIERS.indexOf(t);
    const up = TIERS[Math.min(TIERS.length - 1, idx + 1)];
    const ticketFor = (rr) => {
      if (rr < 0.7) return t.id;
      if (rr < 0.9 && idx > 0) return TIERS[idx - 1].id;
      return up.id;
    };
    if (r < 0.01) return { kind: "jackpot", coins: t.cost * 10, ticket: t.id };
    if (r < 0.31) return { kind: "ticket", ticket: ticketFor(Math.random()) };
    if (r < 0.86) return { kind: "coins", coins: Math.round(t.cost * (0.6 + Math.random() * 1.6)) };
    return { kind: "nothing" };
  }
  function symbolsFor(pay) {
    if (pay.kind === "jackpot") return ["7", "7", "7"];
    if (pay.kind === "ticket") {
      const s = SYMS[1 + Math.floor(Math.random() * 4)];
      return [s, s, s];
    }
    if (pay.kind === "coins") {
      const a = SYMS[Math.floor(Math.random() * SYMS.length)];
      let b = SYMS[Math.floor(Math.random() * SYMS.length)];
      if (b === a) b = SYMS[(SYMS.indexOf(a) + 2) % SYMS.length];
      return Math.random() < 0.4 ? [a, a, b] : [a, b, "🪙"];
    }
    const a = SYMS[Math.floor(Math.random() * SYMS.length)];
    let b = SYMS[Math.floor(Math.random() * SYMS.length)];
    let c = SYMS[Math.floor(Math.random() * SYMS.length)];
    if (a === b && b === c) c = SYMS[(SYMS.indexOf(c) + 1) % SYMS.length];
    return [a, b, c];
  }

  function gachaRoll(tierId, cat) {
    const t = tierById(tierId);
    try {
      if (!ENTRIES.length || !window.ChaosGacha) throw new Error("no data");
      const res = window.ChaosGacha.roll(ENTRIES, null, cat, t.min, t.avg, t.max,
        { hideNsfw: true, hideNoncon: true }, Math.random);
      let strip = [];
      try {
        strip = window.ChaosGacha.drawStrip(ENTRIES, cat, t.min, t.avg, t.max,
          { hideNsfw: true, hideNoncon: true }, 14, Math.random);
      } catch (e) { strip = []; }
      return { res, strip };
    } catch (e) {
      const stub = { category: cat === "random" ? "item" : cat, name: tierId + " trinket", rarity: t.avg, source: "Casino", description: "Fallback prize (data missing).", odds: 0 };
      return { res: stub, strip: [] };
    }
  }

  function applyPrize(res) {
    const p = G.p, cat = res.category, nm = (res.name + " " + res.description).toLowerCase(), r = res.rarity;
    const bonus = 1 + (r - 1) * 0.08;
    if (cat === "item" && /gun|rifle|pistol|launcher|blaster|bow|cannon|sword|blade|knife|baton|chair|card|chip|dagger|axe|hammer/i.test(nm)) {
      const ranged = /gun|rifle|pistol|launcher|blaster|bow|cannon|card|chip/i.test(nm);
      p.weapon = { name: res.name, ranged, dmg: Math.max(1, Math.round(r / 2)) + (ranged ? 0 : 1) };
      p.dmg = p.weapon.dmg;
      return "Weapon equipped: " + res.name + " (" + p.dmg + " dmg" + (ranged ? ", ranged" : ", melee") + "). J/click to fight back — Threat will rise.";
    }
    if (cat === "ability" && /fire|flame|lightning|bolt|projectile|emit|kinesis|blast|beam/i.test(nm)) {
      p.weapon = p.weapon || { name: res.name + " (zap)", ranged: true, dmg: Math.max(1, Math.round(r / 2)) };
      p.dmg = Math.max(p.dmg, p.weapon.dmg);
      return "Combat ability: " + res.name + ". You can now attack (J/click).";
    }
    if (cat === "familiar") {
      p.pets.push({ name: res.name, dmg: Math.max(1, Math.round(r / 3)), cd: 0 });
      return "Familiar joins: " + res.name + " (auto-attacks, " + p.pets[p.pets.length - 1].dmg + " dmg).";
    }
    if (cat === "trait") {
      if (/speed|swift|quick|agil/i.test(nm)) { p.speed *= 1 + 0.04 * bonus; return "Trait: +" + Math.round(4 * bonus) + "% move speed."; }
      if (/vital|health|tough|regen|heal/i.test(nm)) { p.maxHp += 1; p.hp = Math.min(p.maxHp, p.hp + 1); return "Trait: +1 max HP."; }
      if (/pull|slot|machine|luck|gamb/i.test(nm)) { p.pullMul = Math.max(0.6, p.pullMul * 0.92); return "Trait: pulls 8% faster."; }
      p.speed *= 1.02; p.pullMul = Math.max(0.6, p.pullMul * 0.98);
      return "Trait: small all-round edge (rarity " + r.toFixed(1) + ").";
    }
    if (cat === "skill") {
      if (r >= 4 || /slot|machine|discount|coin|econom/i.test(nm)) { p.discount = Math.min(0.4, p.discount + 0.08); return "Skill: slot costs -8% (total -" + Math.round(p.discount * 100) + "%)."; }
      p.pullMul = Math.max(0.6, p.pullMul * 0.9);
      return "Skill: pulls 10% faster.";
    }
    // generic fallback scales with rarity
    if (!p.weapon && r >= 3) {
      p.weapon = { name: res.name + " (improv)", ranged: false, dmg: Math.max(1, Math.round(r / 2)) };
      p.dmg = p.weapon.dmg;
      return "Prize doubles as weapon: " + res.name + ". You can fight back now.";
    }
    p.dmg += 0.2 * bonus; p.speed += 2;
    return "Prize essence: +damage/speed (rarity " + r.toFixed(1) + " " + rarityName(r) + ").";
  }

  // ---- pulls ----
  function nearestMachine() {
    const room = curRoom(); let best = null, bd = 78;
    for (const m of room.machines) {
      const d = Math.hypot(m.x - G.p.x, m.y - G.p.y);
      if (d < bd) { bd = d; best = m; }
    }
    return best;
  }
  function tryStartPull() {
    if (G.pull || G.over) return;
    const m = nearestMachine();
    if (!m) return;
    const t = tierById(m.tier);
    if (m.kind === "slot") {
      const c = slotCost(t);
      if (G.p.coins < c) { showCard("Not enough coins", t.label + " slot costs " + c + ".", "", 1800); return; }
      G.p.coins -= c;
      const pay = rollSlotPayout(t);
      G.pull = { m, t: 0, dur: t.pull * G.p.pullMul, pay, syms: symbolsFor(pay), locks: [false, false, false] };
    } else {
      if ((G.p.tickets[m.tier] || 0) < 1) { showCard("Need 1× " + t.label + " ticket", "Win it from " + t.label + " slots first (depth " + t.minDepth + "+).", "", 2200); return; }
      G.p.tickets[m.tier]--;
      const g = gachaRoll(m.tier, m.cat);
      G.pull = { m, t: 0, dur: 3.0 * G.p.pullMul, gacha: g, gIdx: 0 };
    }
    // noise: alert nearby guards
    const room = curRoom();
    room.alert = 5;
    for (const gd of room.guards) {
      if (Math.hypot(gd.x - G.p.x, gd.y - G.p.y) < 300) gd.chase = true;
    }
    overlay.classList.add("show");
    slotReels.style.display = G.pull.m.kind === "slot" ? "flex" : "none";
    gachaReel.style.display = G.pull.m.kind === "slot" ? "none" : "flex";
    sreels.forEach(s => s.classList.remove("locked"));
    reelTitle.textContent = (m.kind === "slot" ? "🎰 " : "🎲 ") + t.label + " " + m.kind + "…";
  }
  function cancelPull(msg) {
    if (!G.pull) return;
    G.pull = null;
    overlay.classList.remove("show");
    if (msg) showCard("Pull interrupted", msg + " (no refund — the house thanks you).", "", 2000);
  }
  function finishPull() {
    const pull = G.pull, m = pull.m, t = tierById(m.tier);
    G.pull = null;
    overlay.classList.remove("show");
    G.pulls++;
    if (m.kind === "slot") {
      const pay = pull.pay;
      if (pay.kind === "jackpot") {
        G.p.coins += pay.coins; G.p.tickets[pay.ticket] = (G.p.tickets[pay.ticket] || 0) + 1;
        showCard("JACKPOT 7-7-7! +" + pay.coins + " coins + 1× " + pay.ticket,
          t.label + " slot screams. Every guard heard that.", "", 3500);
        for (const gd of curRoom().guards) gd.chase = true;
      } else if (pay.kind === "ticket") {
        G.p.tickets[pay.ticket] = (G.p.tickets[pay.ticket] || 0) + 1;
        showCard("🎟 +" + "1× " + pay.ticket + " ticket", "From a " + t.label + " slot (" + pull.syms.join(" ") + "). Feed it to a " + pay.ticket + " gacha.", "", 3000);
      } else if (pay.kind === "coins") {
        G.p.coins += pay.coins;
        showCard("🪙 +" + pay.coins + " coins", t.label + " slot (" + pull.syms.join(" ") + ").", "", 1800);
      } else {
        showCard("House wins", t.label + " slot (" + pull.syms.join(" ") + "). Try again deeper for better EV.", "", 1800);
      }
    } else {
      const res = pull.gacha.res;
      const note = applyPrize(res);
      showCard("[" + rarityName(res.rarity) + " " + res.category + "] " + res.name + " (" + res.rarity.toFixed(1) + ")",
        (res.description || "").slice(0, 160) + " — " + note, "Ticket: " + t.label + " · odds " + (res.odds || 0).toFixed(2) + "%", 6000);
      if (!G.p.weapon && res.rarity >= 3 && res.category !== "item" && res.category !== "ability") {
        // pity: mid-tier+ prizes eventually arm the player via fallback (handled in applyPrize)
      }
    }
    checkFeats();
  }

  function checkFeats() {
    const f = G.feats;
    if (!f.firstPulls && G.pulls >= 20) { f.firstPulls = 1; G.p.tickets.silver++; showCard("Feat: Degenerate (20 pulls)", "+1× Silver Skill ticket.", "", 2500); }
  }

  // ---- combat ----
  const projs = [];
  function tryAttack() {
    const p = G.p;
    if (!p.weapon || p.atkCd > 0 || G.over) return;
    p.atkCd = 0.45;
    const room = curRoom();
    if (p.weapon.ranged) {
      const g = nearestGuard(420);
      const a = g ? Math.atan2(g.y - p.y, g.x - p.x) : 0;
      projs.push({ x: p.x, y: p.y, vx: Math.cos(a) * 520, vy: Math.sin(a) * 520, dmg: p.dmg, foe: false, life: 0.8 });
    } else {
      for (const gd of room.guards) {
        if (Math.hypot(gd.x - p.x, gd.y - p.y) < p.range + 14) {
          gd.hp -= p.dmg;
          if (gd.hp <= 0) killGuard(gd);
        }
      }
      G.shake = 0.12;
    }
  }
  function nearestGuard(maxD) {
    let best = null, bd = maxD || 1e9;
    for (const gd of curRoom().guards) {
      const d = Math.hypot(gd.x - G.p.x, gd.y - G.p.y);
      if (d < bd) { bd = d; best = gd; }
    }
    return best;
  }
  function killGuard(gd) {
    const room = curRoom();
    room.guards = room.guards.filter(g => g !== gd);
    G.kills++;
    const nt = Math.min(5, Math.floor(G.kills / 2));
    if (nt > G.threat) {
      G.threat = nt;
      showCard("Threat ★" + nt, "You fought back. Future waves get faster, tougher, ranged.", "", 3000);
    }
    if (!G.feats.firstBlood) {
      G.feats.firstBlood = 1;
      G.p.tickets.silver++;
      showCard("Feat: First blood", "+1× Silver Ability ticket. Threat ★" + G.threat + ".", "", 3000);
    }
    if (Math.random() < 0.3) {
      const spont = ["bronze", "silver", "gold"][Math.floor(Math.random() * 3)];
      G.p.tickets[spont]++;
    }
  }
  function hurtPlayer(n) {
    const p = G.p;
    if (p.inv > 0 || p.rollT > 0 || G.over) return;
    p.hp -= n; p.inv = 0.9; G.shake = 0.2;
    cancelPull("Tackled by security");
    if (p.hp <= 0) die();
  }

  function legacyTierFor(mins) {
    if (mins < 3) return "bronze"; if (mins < 8) return "silver"; if (mins < 15) return "gold";
    if (mins < 25) return "platinum"; if (mins < 40) return "diamond"; return "legendary";
  }
  function die() {
    G.over = true;
    overlay.classList.remove("show");
    const mins = G.t / 60;
    const lt = legacyTierFor(mins);
    const t = tierById(lt);
    let res;
    try {
      res = window.ChaosGacha
        ? window.ChaosGacha.roll(ENTRIES, null, "random", t.min, t.avg, t.max, { hideNsfw: true, hideNoncon: true }, Math.random)
        : { name: "Stub soul-boon", rarity: t.avg, category: "trait", description: "", source: "" };
    } catch (e) { res = { name: "Stub soul-boon", rarity: t.avg, category: "trait", description: "", source: "" }; }
    legacy.push({ name: res.name, rarity: res.rarity, category: res.category, at: Date.now() });
    try { localStorage.setItem("chaosCasinoLegacy", JSON.stringify(legacy)); } catch (e) {}
    const room = curRoom();
    el("deathStats").textContent = "Survived " + fmtTime(G.t) + " · depth " + room.depth +
      " · " + G.kills + " kills · " + G.pulls + " pulls · Threat ★" + G.threat + ".";
    el("deathLegacy").textContent = "Legacy pull (" + lt + "): [" + rarityName(res.rarity) + "] " +
      res.name + " (" + Number(res.rarity).toFixed(1) + ") — permanent: +" +
      Math.floor(res.rarity * 8) + " starting coins, pulls faster" + (res.rarity >= 6 ? ", +1 max HP" : "") + ".";
    el("deathLegacy").style.color = rarityColor(res.rarity);
    deathBox.classList.add("show");
  }
  function fmtTime(s) {
    const m = Math.floor(s / 60), ss = Math.floor(s % 60);
    return m + ":" + String(ss).padStart(2, "0");
  }

  // ---- update ----
  let last = 0;
  function frame(ts) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (ts - last) / 1000 || 0.016);
    last = ts;
    if (!G) return;
    update(dt);
    render(dt);
  }

  function update(dt) {
    const p = G.p, room = curRoom();
    if (G.cardT > 0) { G.cardT -= dt; if (G.cardT <= 0) card.classList.remove("show"); }
    if (G.over) return;
    G.t += dt;
    if (p.atkCd > 0) p.atkCd -= dt;
    if (p.inv > 0) p.inv -= dt;
    if (p.rollCd > 0) p.rollCd -= dt;
    if (p.rollT > 0) p.rollT -= dt;
    if (G.shake > 0) G.shake -= dt;
    room.alert = Math.max(0, room.alert - dt);

    // feats: pacifist timer
    if (!G.feats.pacifist && G.t > 300 && G.kills === 0) {
      G.feats.pacifist = 1; p.tickets.gold++;
      showCard("Feat: Ghost (5:00 pacifist)", "+1× Gold Trait ticket.", "", 3000);
    }
    if (!G.feats.deep && room.depth >= 3) {
      G.feats.deep = 1; p.tickets.gold++;
      showCard("Feat: High roller (depth 3)", "+1× Gold Random ticket.", "", 3000);
    }

    // movement (cancels pulls)
    let mx = (keys["d"] || keys["arrowright"] ? 1 : 0) - (keys["a"] || keys["arrowleft"] ? 1 : 0);
    let my = (keys["s"] || keys["arrowdown"] ? 1 : 0) - (keys["w"] || keys["arrowup"] ? 1 : 0);
    if (mx || my) {
      if (G.pull) cancelPull("You moved");
      const l = Math.hypot(mx, my); mx /= l; my /= l;
      p.x += mx * p.speed * dt; p.y += my * p.speed * dt;
    }
    if (keys[" "] && p.rollCd <= 0 && (mx || my)) { p.rollT = 0.32; p.rollCd = 5; }
    if (p.rollT > 0) { p.x += mx * 260 * dt; p.y += my * 260 * dt; }

    // doors (N/S/E/W gaps in walls)
    const doorR = 34;
    let entered = null;
    if (p.y < WALL - 6 && Math.abs(p.x - W / 2) < doorR) entered = "N";
    else if (p.y > H - WALL + 6 && Math.abs(p.x - W / 2) < doorR) entered = "S";
    else if (p.x < WALL - 6 && Math.abs(p.y - H / 2) < doorR) entered = "W";
    else if (p.x > W - WALL + 6 && Math.abs(p.y - H / 2) < doorR) entered = "E";
    if (entered) {
      if (G.pull) cancelPull("You left the room");
      if (entered === "N") { G.roomY--; p.y = H - WALL - 20; p.x = W / 2; }
      if (entered === "S") { G.roomY++; p.y = WALL + 20; p.x = W / 2; }
      if (entered === "W") { G.roomX--; p.x = W - WALL - 20; p.y = H / 2; }
      if (entered === "E") { G.roomX++; p.x = WALL + 20; p.y = H / 2; }
      onEnterRoom();
    }
    p.x = Math.max(WALL - 2, Math.min(W - WALL + 2, p.x));
    p.y = Math.max(WALL - 2, Math.min(H - WALL + 2, p.y));

    // pull start / progress
    if (keys["e"] && !G.pull) tryStartPull();
    if (G.pull) {
      const pull = G.pull;
      if (pull._finIn != null) {
        // resolution beat: keep locked reels readable, then pay out
        pull._finIn -= dt;
        if (pull._finIn <= 0) finishPull();
      } else {
        pull.t += dt;
        const frac = Math.min(1, pull.t / pull.dur);
        chanBar.style.width = (frac * 100).toFixed(1) + "%";
      if (pull.m.kind === "slot") {
        // 3 reels spin fast, lock at 55/75/95%
        const locks = [0.55, 0.75, 0.95];
        sreels.forEach((sn, i) => {
          if (frac >= locks[i]) {
            if (!pull.locks[i]) { pull.locks[i] = true; sn.classList.add("locked"); }
            sn.textContent = pull.syms[i];
          } else {
            sn.textContent = SYMS[Math.floor(Math.random() * SYMS.length)];
          }
        });
        reelSub().textContent = "Reels… " + Math.round(frac * 100) + "% — hold still";
      } else {
        // single gacha reel: cycle decoys, settle on winner at end
        const strip = pull.gacha.strip || [];
        if (frac < 0.92 && strip.length) {
          if (Math.random() < 0.5) {
            pull.gIdx = (pull.gIdx + 1) % strip.length;
            const d = strip[pull.gIdx];
            gachaReel.textContent = d.name;
            gachaReel.style.color = rarityColor(d.rarity);
          }
        } else {
          gachaReel.textContent = "▶ " + pull.gacha.res.name + " ◀";
          gachaReel.style.color = rarityColor(pull.gacha.res.rarity);
        }
        reelSub().textContent = "Gacha reel… " + Math.round(frac * 100) + "% — hold still";
      }
      if (pull.t >= pull.dur && pull._finIn == null) {
        // lock final symbols, hold 0.42s so the win reads, then pay out
        if (pull.m.kind === "slot") {
          sreels.forEach((sn, i) => { sn.textContent = pull.syms[i]; sn.classList.add("locked"); });
        } else {
          gachaReel.textContent = "▶ " + pull.gacha.res.name + " ◀";
          gachaReel.style.color = rarityColor(pull.gacha.res.rarity);
        }
        pull._finIn = 0.42;
      }
      }
    }

    // attacks
    if ((keys["j"] || attackQueued) && p.weapon) tryAttack();
    attackQueued = false;

    // guards
    for (const gd of [...room.guards]) {
      const d = Math.hypot(gd.x - p.x, gd.y - p.y);
      if (!gd.chase && (d < gd.sight || room.alert > 0)) gd.chase = true;
      if (gd.chase) {
        const a = Math.atan2(p.y - gd.y, p.x - gd.x);
        const sp = gd.speed * (p.rollT > 0 ? 0.7 : 1);
        gd.x += Math.cos(a) * sp * dt; gd.y += Math.sin(a) * sp * dt;
        if (d < 26) {
          if (gd.atkCd <= 0) { hurtPlayer(1); gd.atkCd = 0.9; }
        }
        if (gd.ranged && d < 380 && d > 120 && gd.atkCd <= 0) {
          projs.push({ x: gd.x, y: gd.y, vx: Math.cos(a) * 300, vy: Math.sin(a) * 300, dmg: 1, foe: true, life: 1.6 });
          gd.atkCd = 1.6;
        }
      }
      if (gd.atkCd > 0) gd.atkCd -= dt;
    }
    // pets
    for (const pet of p.pets) {
      pet.cd -= dt;
      const g = nearestGuard(360);
      if (g && pet.cd <= 0) {
        const a = Math.atan2(g.y - p.y, g.x - p.x);
        projs.push({ x: p.x, y: p.y, vx: Math.cos(a) * 460, vy: Math.sin(a) * 460, dmg: pet.dmg, foe: false, life: 0.7 });
        pet.cd = 1.1;
      }
    }
    // projectiles
    for (const pr of [...projs]) {
      pr.x += pr.vx * dt; pr.y += pr.vy * dt; pr.life -= dt;
      if (pr.life <= 0) { projs.splice(projs.indexOf(pr), 1); continue; }
      if (pr.foe) {
        if (Math.hypot(pr.x - p.x, pr.y - p.y) < 12) { hurtPlayer(pr.dmg); projs.splice(projs.indexOf(pr), 1); }
      } else {
        for (const gd of [...room.guards]) {
          if (Math.hypot(pr.x - gd.x, pr.y - gd.y) < 14) {
            gd.hp -= pr.dmg;
            projs.splice(projs.indexOf(pr), 1);
            if (gd.hp <= 0) killGuard(gd);
            break;
          }
        }
      }
    }

    // waves scale with threat + danger
    G.waveT -= dt;
    if (G.waveT <= 0) {
      G.waveT = Math.max(25, 60 - G.threat * 5 - room.danger * 2);
      const n = 1 + Math.floor(G.threat / 2) + (room.danger > 4 ? 1 : 0);
      for (let i = 0; i < n; i++) {
        const gd = makeGuard(room, room.depth, room.danger);
        gd.x = WALL + 30; gd.y = WALL + 80 + Math.random() * 100; gd.chase = true;
        room.guards.push(gd);
      }
      showCard("Security wave ★" + G.threat, n + " guard(s) converge. Pulls are loud — keep moving.", "", 2200);
    }
    updateHud();
  }

  function reelSub() { return el("reelSub"); }

  function onEnterRoom() {
    const room = curRoom();
    projs.length = 0;
    if (G.pull) cancelPull("You left the room");
    if (!room._seen) {
      room._seen = true;
      const tiers = [...new Set(room.machines.map(m => m.tier))].join(", ");
      showCard("Depth " + room.depth + " · Danger " + room.danger.toFixed(1),
        "Machines: " + tiers + ". " + room.guards.length + " guards on floor.",
        room.depth >= 4 ? "Platinum+ country. Watch the timer." : "", 2600);
    }
    updateHud();
  }

  // ---- render ----
  function rr(x, y, w, h, r) {
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h);
  }
  function render() {
    const room = curRoom(), p = G.p;
    ctx.save();
    if (G.shake > 0) ctx.translate((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6);
    // floor carpet
    ctx.fillStyle = "#191423"; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#1e1830";
    for (let y = 0; y < H; y += 24) for (let x = 0; x < W; x += 24)
      if ((x + y) % 48 === 0) ctx.fillRect(x, y, 12, 12);
    // walls + doors
    ctx.fillStyle = "#2b2137";
    ctx.fillRect(0, 0, W, WALL); ctx.fillRect(0, H - WALL, W, WALL);
    ctx.fillRect(0, 0, WALL, H); ctx.fillRect(W - WALL, 0, WALL, H);
    ctx.fillStyle = "#0b0d12";
    ctx.fillRect(W / 2 - 34, 0, 68, WALL); ctx.fillRect(W / 2 - 34, H - WALL, 68, WALL);
    ctx.fillRect(0, H / 2 - 34, WALL, 68); ctx.fillRect(W - WALL, H / 2 - 34, WALL, 68);
    ctx.fillStyle = "#3a2f4d";
    ctx.font = "12px monospace"; ctx.textAlign = "center";
    ctx.fillText("DEPTH " + room.depth + " · DANGER " + room.danger.toFixed(1), W / 2, 20);

    // machines
    const near = G.pull ? G.pull.m : nearestMachine();
    for (const m of room.machines) {
      const t = tierById(m.tier);
      ctx.fillStyle = "#0d0f15";
      rr(m.x - 34, m.y - 24, 68, 48, 6); ctx.fill();
      ctx.lineWidth = near === m ? 3 : 2;
      ctx.strokeStyle = m.color; ctx.stroke();
      // mini reel window: 3 boxes for slots, 1 bar for gacha
      ctx.fillStyle = "#1a1e28";
      if (m.kind === "slot") {
        for (let i = 0; i < 3; i++) ctx.fillRect(m.x - 27 + i * 19, m.y - 14, 16, 20);
        ctx.fillStyle = "#fff"; ctx.font = "9px monospace";
        ctx.fillText("◈", m.x - 19, m.y); ctx.fillText("◈", m.x, m.y); ctx.fillText("◈", m.x + 19, m.y);
      } else {
        ctx.fillRect(m.x - 27, m.y - 12, 54, 16);
        ctx.fillStyle = "#fff"; ctx.font = "9px monospace";
        ctx.fillText("●", m.x, m.y + 1);
      }
      ctx.fillStyle = m.color; ctx.font = "bold 10px monospace";
      const cost = m.kind === "slot" ? slotCost(t) + "c" : "1×" + t.label.slice(0, 4);
      ctx.fillText((m.kind === "slot" ? "🎰 " : "🎲 ") + t.label.slice(0, 4) + " " + cost, m.x, m.y + 22);
      if (near === m) {
        ctx.strokeStyle = "#fff"; ctx.lineWidth = 1;
        ctx.strokeRect(m.x - 34, m.y - 24, 68, 48);
        // channel bar above machine
        if (G.pull) {
          const f = Math.min(1, G.pull.t / G.pull.dur);
          ctx.fillStyle = "#000"; ctx.fillRect(m.x - 32, m.y - 34, 64, 7);
          ctx.fillStyle = m.color; ctx.fillRect(m.x - 31, m.y - 33, 62 * f, 5);
        }
      }
    }

    // guards
    for (const gd of room.guards) {
      ctx.fillStyle = gd.type === "enforcer" ? "#5a1a1a" : gd.type === "pitboss" ? "#3a2a5a" : "#111";
      ctx.fillRect(gd.x - 9, gd.y - 12, 18, 24);
      ctx.fillStyle = "#e8c39e"; ctx.fillRect(gd.x - 6, gd.y - 18, 12, 8); // head
      ctx.fillStyle = "#000"; ctx.fillRect(gd.x - 6, gd.y - 16, 12, 3); // shades
      if (gd.chase) { ctx.fillStyle = "#ff2222"; ctx.font = "bold 14px monospace"; ctx.fillText("!", gd.x, gd.y - 24); }
      // hp pips
      ctx.fillStyle = "#400"; ctx.fillRect(gd.x - 10, gd.y - 28, 20, 3);
      ctx.fillStyle = "#f66"; ctx.fillRect(gd.x - 10, gd.y - 28, 20 * Math.max(0, gd.hp) / 6, 3);
    }
    // projectiles
    for (const pr of projs) {
      ctx.fillStyle = pr.foe ? "#ff5555" : "#ffe066";
      ctx.fillRect(pr.x - 3, pr.y - 3, 6, 6);
    }
    // pets
    G.p.pets.forEach((pet, i) => {
      const a = G.t * 2 + i * 2.1;
      const x = p.x + Math.cos(a) * 26, y = p.y + Math.sin(a) * 26;
      ctx.fillStyle = "#7df9ff"; ctx.fillRect(x - 5, y - 5, 10, 10);
    });
    // player
    if (p.inv <= 0 || Math.floor(G.t * 12) % 2 === 0) {
      ctx.fillStyle = "#2ecc71"; ctx.fillRect(p.x - 9, p.y - 12, 18, 24);
      ctx.fillStyle = "#ffe0bd"; ctx.fillRect(p.x - 6, p.y - 18, 12, 8);
      ctx.fillStyle = "#7CFC00"; // soul glow dims with hp
      ctx.globalAlpha = 0.3 + 0.7 * (p.hp / p.maxHp);
      ctx.fillRect(p.x - 9, p.y + 12, 18, 3);
      ctx.globalAlpha = 1;
    }
    // exits hint
    ctx.fillStyle = "rgba(255,255,255,.5)"; ctx.font = "11px monospace";
    ctx.fillText("N", W / 2, WALL - 8); ctx.fillText("S", W / 2, H - 8);
    ctx.fillText("W", 14, H / 2); ctx.fillText("E", W - 14, H / 2);
    ctx.restore();
  }

  function updateHud() {
    const p = G.p, room = curRoom();
    el("hCoins").textContent = "🪙 " + p.coins;
    el("hHp").textContent = "❤ " + Math.max(0, p.hp) + "/" + p.maxHp;
    el("hThreat").textContent = "★ Threat " + G.threat;
    el("hDepth").textContent = "🚪 Depth " + room.depth + " · Danger " + room.danger.toFixed(1);
    el("hTime").textContent = "⏱ " + fmtTime(G.t) + " · ☠" + G.kills + " · 🎰" + G.pulls;
    el("hWeapon").textContent = p.weapon ? "🔫 " + p.weapon.name.slice(0, 22) : "🥊 Unarmed (J does nothing)";
    el("tickets").innerHTML = TIERS.map(t =>
      "<span class='tick' style='border-color:" + t.color + "'>" + t.label.slice(0, 4) + "×" + (p.tickets[t.id] || 0) + "</span>").join("");
  }

  el("againBtn").addEventListener("click", () => newRun());
  newRun();
  requestAnimationFrame(frame);
})();
