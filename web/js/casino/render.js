"use strict";
/* Canvas renderer. Depends on: config, dom, state, slots (slotCost). */
(function (C) {
  function rr(x, y, w, h, r) {
    const ctx = C.ctx;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
    else ctx.rect(x, y, w, h);
  }

  function drawMachines(room, near) {
    const ctx = C.ctx;
    for (const m of room.machines) {
      const t = C.tierById(m.tier);
      ctx.fillStyle = "#0d0f15";
      rr(m.x - 34, m.y - 24, 68, 48, 6); ctx.fill();
      ctx.lineWidth = near === m ? 3 : 2;
      ctx.strokeStyle = m.color; ctx.stroke();
      // Mini reel window: 3 boxes for slots, 1 bar for gacha.
      ctx.fillStyle = "#1a1e28";
      if (m.kind === "slot") {
        for (let i = 0; i < 3; i++) ctx.fillRect(m.x - 27 + i * 19, m.y - 14, 16, 20);
        ctx.fillStyle = "#fff"; ctx.font = "9px monospace"; ctx.textAlign = "center";
        ctx.fillText("◈", m.x - 19, m.y); ctx.fillText("◈", m.x, m.y); ctx.fillText("◈", m.x + 19, m.y);
      } else {
        ctx.fillRect(m.x - 27, m.y - 12, 54, 16);
        ctx.fillStyle = "#fff"; ctx.font = "9px monospace"; ctx.textAlign = "center";
        ctx.fillText("●", m.x, m.y + 1);
      }
      ctx.fillStyle = m.color; ctx.font = "bold 10px monospace"; ctx.textAlign = "center";
      const cost = m.kind === "slot" ? C.slotCost(t) + "c" : "1×" + t.label.slice(0, 4);
      ctx.fillText((m.kind === "slot" ? "🎰 " : "🎲 ") + t.label.slice(0, 4) + " " + cost, m.x, m.y + 22);
      if (near === m) {
        ctx.strokeStyle = "#fff"; ctx.lineWidth = 1;
        ctx.strokeRect(m.x - 34, m.y - 24, 68, 48);
        if (C.G.pull) {
          const f = Math.min(1, C.G.pull.t / C.G.pull.dur);
          ctx.fillStyle = "#000"; ctx.fillRect(m.x - 32, m.y - 34, 64, 7);
          ctx.fillStyle = m.color; ctx.fillRect(m.x - 31, m.y - 33, 62 * f, 5);
        }
      }
    }
  }

  function drawGuards(room) {
    const ctx = C.ctx;
    for (const gd of room.guards) {
      ctx.fillStyle = gd.type === "enforcer" ? "#5a1a1a" : gd.type === "pitboss" ? "#3a2a5a" : "#111";
      ctx.fillRect(gd.x - 9, gd.y - 12, 18, 24);
      ctx.fillStyle = "#e8c39e"; ctx.fillRect(gd.x - 6, gd.y - 18, 12, 8); // head
      ctx.fillStyle = "#000"; ctx.fillRect(gd.x - 6, gd.y - 16, 12, 3); // shades
      if (gd.chase) {
        ctx.fillStyle = "#ff2222"; ctx.font = "bold 14px monospace"; ctx.textAlign = "center";
        ctx.fillText("!", gd.x, gd.y - 24);
      }
      ctx.fillStyle = "#400"; ctx.fillRect(gd.x - 10, gd.y - 28, 20, 3);
      ctx.fillStyle = "#f66";
      ctx.fillRect(gd.x - 10, gd.y - 28, 20 * Math.max(0, gd.hp) / 6, 3);
    }
  }

  C.render = function () {
    const ctx = C.ctx, room = C.curRoom(), p = C.G.p;
    ctx.save();
    if (C.G.shake > 0) ctx.translate((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6);
    // Floor carpet.
    ctx.fillStyle = "#191423"; ctx.fillRect(0, 0, C.W, C.H);
    ctx.fillStyle = "#1e1830";
    for (let y = 0; y < C.H; y += 24)
      for (let x = 0; x < C.W; x += 24)
        if ((x + y) % 48 === 0) ctx.fillRect(x, y, 12, 12);
    // Walls + door gaps.
    ctx.fillStyle = "#2b2137";
    ctx.fillRect(0, 0, C.W, C.WALL); ctx.fillRect(0, C.H - C.WALL, C.W, C.WALL);
    ctx.fillRect(0, 0, C.WALL, C.H); ctx.fillRect(C.W - C.WALL, 0, C.WALL, C.H);
    ctx.fillStyle = "#0b0d12";
    ctx.fillRect(C.W / 2 - 34, 0, 68, C.WALL);
    ctx.fillRect(C.W / 2 - 34, C.H - C.WALL, 68, C.WALL);
    ctx.fillRect(0, C.H / 2 - 34, C.WALL, 68);
    ctx.fillRect(C.W - C.WALL, C.H / 2 - 34, C.WALL, 68);
    ctx.fillStyle = "#3a2f4d";
    ctx.font = "12px monospace"; ctx.textAlign = "center";
    ctx.fillText("DEPTH " + room.depth + " · DANGER " + room.danger.toFixed(1), C.W / 2, 20);

    drawMachines(room, C.G.pull ? C.G.pull.m : C.nearestMachine());
    drawGuards(room);

    for (const pr of C.projs) {
      ctx.fillStyle = pr.foe ? "#ff5555" : "#ffe066";
      ctx.fillRect(pr.x - 3, pr.y - 3, 6, 6);
    }
    C.G.p.pets.forEach((pet, i) => {
      const a = C.G.t * 2 + i * 2.1;
      ctx.fillStyle = "#7df9ff";
      ctx.fillRect(p.x + Math.cos(a) * 26 - 5, p.y + Math.sin(a) * 26 - 5, 10, 10);
    });
    // Player (blinks while invulnerable; soul glow dims with HP).
    if (p.inv <= 0 || Math.floor(C.G.t * 12) % 2 === 0) {
      ctx.fillStyle = "#2ecc71"; ctx.fillRect(p.x - 9, p.y - 12, 18, 24);
      ctx.fillStyle = "#ffe0bd"; ctx.fillRect(p.x - 6, p.y - 18, 12, 8);
      ctx.fillStyle = "#7CFC00";
      ctx.globalAlpha = 0.3 + 0.7 * (p.hp / p.maxHp);
      ctx.fillRect(p.x - 9, p.y + 12, 18, 3);
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = "rgba(255,255,255,.5)"; ctx.font = "11px monospace"; ctx.textAlign = "center";
    ctx.fillText("N", C.W / 2, C.WALL - 8); ctx.fillText("S", C.W / 2, C.H - 8);
    ctx.fillText("W", 14, C.H / 2); ctx.fillText("E", C.W - 14, C.H / 2);
    ctx.restore();
  };
})(window.Casino);
