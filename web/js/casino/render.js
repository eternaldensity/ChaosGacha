"use strict";
/* Canvas renderer: maze walls, big machines with in-place reels,
 * floor pickups, floaters. Depends on: config, dom, state, slots. */
(function (C) {
  function rr(x, y, w, h, r) {
    const ctx = C.ctx;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
    else ctx.rect(x, y, w, h);
  }

  function drawWalls(room) {
    const ctx = C.ctx;
    for (const wl of room.walls) {
      ctx.fillStyle = "#241b33";
      ctx.fillRect(wl.x, wl.y, wl.w, wl.h);
      ctx.fillStyle = "#3b2d55"; // lit top edge
      ctx.fillRect(wl.x, wl.y, wl.w, 3);
      ctx.strokeStyle = "#171021"; ctx.lineWidth = 1;
      ctx.strokeRect(wl.x + 0.5, wl.y + 0.5, wl.w - 1, wl.h - 1);
    }
  }

  // Vertical fade so the tape reads as a wheel seen edge-on.
  function reelFade(ctx, x, y, w, h) {
    const gr = ctx.createLinearGradient(0, y, 0, y + h);
    gr.addColorStop(0, "rgba(8,10,14,.7)");
    gr.addColorStop(0.3, "rgba(8,10,14,0)");
    gr.addColorStop(0.7, "rgba(8,10,14,0)");
    gr.addColorStop(1, "rgba(8,10,14,.7)");
    ctx.fillStyle = gr;
    ctx.fillRect(x, y, w, h);
  }

  function symFont(s) {
    return s.length > 1 ? "bold 10px monospace" : "bold 15px monospace";
  }

  // One spinning slot window: a wrapping symbol tape scrolling downward,
  // easing onto the target symbol with the tier color on lock.
  function drawSlotReelWindow(m, t, i) {
    const ctx = C.ctx;
    const reel = m.pull.reels[i];
    const x = m.x - 39 + i * 27, y = m.y - 16, w = 25, h = 30;
    const H = C.REEL_H, N = C.SYMS.length;
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    ctx.fillStyle = "#10131a";
    ctx.fillRect(x, y, w, h);
    const kMin = Math.floor(-reel.pos / H) - 1;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    for (let j = 0; j <= 3; j++) {
      const k = kMin + j;
      const s = C.SYMS[C.pmod(k, N)];
      const yc = k * H + reel.pos + H / 2;
      const edge = Math.abs(yc - (y + h / 2)) / (h / 2); // 0 center, 1+ edge
      ctx.globalAlpha = Math.max(0.3, 1 - edge * 0.55);
      ctx.fillStyle = reel.state === "locked" ? t.color : "#c7ccd6";
      ctx.font = symFont(s);
      ctx.fillText(s.length > 3 ? s.slice(0, 3) : s, x + w / 2, yc);
    }
    ctx.globalAlpha = 1;
    reelFade(ctx, x, y, w, h);
    ctx.restore();
    ctx.strokeStyle = reel.state === "locked" ? t.color : "#333a47";
    ctx.lineWidth = reel.state === "locked" ? 2 : 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  }

  function slotWindows(m, t) {
    const ctx = C.ctx;
    if (m.pull) {
      for (let i = 0; i < 3; i++) drawSlotReelWindow(m, t, i);
      return;
    }
    // Idle: show the last result dimmed.
    const labels = m.idleSyms || ["◈", "◈", "◈"];
    for (let i = 0; i < 3; i++) {
      const x = m.x - 39 + i * 27, y = m.y - 16;
      ctx.fillStyle = "#1a1e28";
      ctx.fillRect(x, y, 25, 30);
      ctx.strokeStyle = "#333a47"; ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, 24, 29);
      ctx.fillStyle = "#8b93a3";
      ctx.font = "bold 13px monospace"; ctx.textAlign = "center";
      const s = String(labels[i]);
      ctx.fillText(s.length > 3 ? s.slice(0, 3) : s, x + 12.5, y + 20);
    }
  }

  function gachaWindow(m, t) {
    const ctx = C.ctx;
    const x = m.x - 42, y = m.y - 15, w = 84, h = 28;
    if (m.pull) {
      // Spinning: decoy names scroll downward and slow; the winner fades in.
      const pull = m.pull, reel = pull.reel;
      const strip = pull.gacha.strip.length ? pull.gacha.strip
        : [{ name: pull.gacha.res.name, rarity: pull.gacha.res.rarity }];
      const H = C.GREEL_H, L = strip.length;
      ctx.save();
      ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
      ctx.fillStyle = "#10131a";
      ctx.fillRect(x, y, w, h);
      const kMin = Math.floor(-reel.pos / H) - 1;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.font = "bold 10px monospace";
      for (let j = 0; j <= 3; j++) {
        const k = kMin + j;
        const e = strip[C.pmod(k, L)];
        const yc = k * H + reel.pos + H / 2;
        const edge = Math.abs(yc - (y + h / 2)) / (h / 2);
        ctx.globalAlpha = Math.max(0.3, 1 - edge * 0.55);
        ctx.fillStyle = C.rarityColor(e.rarity);
        ctx.fillText(String(e.name).slice(0, 16), m.x, yc);
      }
      if (reel.state !== "spin") {
        const a = reel.state === "locked" ? 1 : Math.min(1, reel.landT / 0.45);
        ctx.globalAlpha = a;
        ctx.fillStyle = "#10131a";
        ctx.fillRect(x, y, w, h);
        ctx.fillStyle = C.rarityColor(pull.gacha.res.rarity);
        ctx.font = "bold 10px monospace";
        ctx.fillText("▶ " + String(pull.gacha.res.name).slice(0, 12) + " ◀", m.x, y + h / 2);
      }
      ctx.globalAlpha = 1;
      reelFade(ctx, x, y, w, h);
      ctx.restore();
      ctx.strokeStyle = reel.state === "locked"
        ? C.rarityColor(pull.gacha.res.rarity) : t.color;
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
      return;
    }
    ctx.fillStyle = "#1a1e28";
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = "#333a47"; ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    ctx.textAlign = "center";
    ctx.font = "bold 10px monospace";
    if (m.lastPrize) {
      ctx.fillStyle = C.rarityColor(m.lastPrize.rarity);
      ctx.fillText(String(m.lastPrize.name).slice(0, 13), m.x, y + 18);
    } else {
      ctx.fillStyle = "#8b93a3";
      ctx.fillText((m.cat || "?").toUpperCase().slice(0, 8), m.x, y + 18);
    }
  }

  function drawMachines(room, near) {
    const ctx = C.ctx;
    const hw = C.MW / 2, hh = C.MH / 2;
    for (const m of room.machines) {
      const t = C.tierById(m.tier);
      ctx.fillStyle = m.pull ? "#12141d" : "#0d0f15";
      rr(m.x - hw, m.y - hh, C.MW, C.MH, 8); ctx.fill();
      ctx.lineWidth = near === m ? 3 : 2;
      ctx.strokeStyle = near === m ? "#fff" : m.color;
      ctx.stroke();
      // Header: kind + tier.
      ctx.fillStyle = m.color; ctx.font = "bold 11px monospace"; ctx.textAlign = "center";
      ctx.fillText((m.kind === "slot" ? "🎰" : "🎲") + " " + t.label.toUpperCase().slice(0, 9),
        m.x, m.y - hh + 13);
      if (m.kind === "slot") slotWindows(m, t);
      else gachaWindow(m, t);
      // Footer: price.
      const cost = m.kind === "slot" ? C.slotCost(t) + "c" : "1×" + t.label.slice(0, 5);
      ctx.fillStyle = m.pull ? "#ffe066" : "#c7ccd6";
      ctx.font = "10px monospace";
      ctx.fillText(m.pull ? "RUNNING…" : cost, m.x, m.y + hh - 7);
      // Progress bar while running.
      if (m.pull) {
        const f = Math.min(1, m.pull.t / m.pull.dur);
        ctx.fillStyle = "#000";
        ctx.fillRect(m.x - hw + 6, m.y - hh - 11, C.MW - 12, 7);
        ctx.fillStyle = m.pull.fin != null ? "#11d939" : t.color;
        ctx.fillRect(m.x - hw + 7, m.y - hh - 10, (C.MW - 14) * f, 5);
      }
    }
  }

  function drawPickups(room) {
    const ctx = C.ctx;
    ctx.textAlign = "center";
    for (const pk of room.pickups) {
      const bobY = pk.y + Math.sin(pk.bob * 4) * 3;
      if (pk.kind === "coins") {
        ctx.fillStyle = "#8a6d1c";
        ctx.fillRect(pk.x - 8, bobY - 8, 16, 16);
        ctx.fillStyle = "#ffe066";
        ctx.fillRect(pk.x - 6, bobY - 6, 12, 12);
        ctx.fillStyle = "#8a6d1c"; ctx.font = "bold 10px monospace";
        ctx.fillText("c", pk.x, bobY + 4);
        ctx.fillStyle = "#ffe066"; ctx.font = "10px monospace";
        ctx.fillText("+" + pk.amount, pk.x, bobY + 22);
      } else if (pk.kind === "ticket") {
        const t = C.tierById(pk.tier);
        ctx.fillStyle = "#e8e4da";
        ctx.fillRect(pk.x - 10, bobY - 7, 20, 14);
        ctx.strokeStyle = t.color; ctx.lineWidth = 2;
        ctx.strokeRect(pk.x - 10, bobY - 7, 20, 14);
        ctx.fillStyle = "#111"; ctx.font = "bold 10px monospace";
        ctx.fillText("T", pk.x, bobY + 4);
        ctx.fillStyle = t.color; ctx.font = "10px monospace";
        ctx.fillText(pk.tier.slice(0, 5), pk.x, bobY + 22);
      } else if (pk.kind === "prize") {
        const col = C.rarityColor(pk.res.rarity);
        ctx.fillStyle = col;
        ctx.fillRect(pk.x - 9, bobY - 9, 18, 18);
        ctx.fillStyle = "#fff"; ctx.font = "bold 12px monospace";
        ctx.fillText("★", pk.x, bobY + 5);
        ctx.fillStyle = col; ctx.font = "bold 10px monospace";
        ctx.fillText(String(pk.res.name).slice(0, 22), pk.x, bobY + 24);
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

  function dangerColor(d) {
    if (d < 2.5) return "#11d939";
    if (d < 4.5) return "#f7d40a";
    return "#ff8c00";
  }

  // Dark pill so depth/danger always reads against the carpet.
  function drawDepthPill(room) {
    const ctx = C.ctx;
    ctx.font = "bold 12px monospace";
    const label = "DEPTH " + room.depth + " · DANGER " + room.danger.toFixed(1);
    const w = ctx.measureText(label).width + 20;
    const x = C.WALL + 8, y = 8;
    ctx.fillStyle = "rgba(5,6,10,.88)";
    rr(x, y, w, 24, 12); ctx.fill();
    ctx.strokeStyle = dangerColor(room.danger); ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = "#fff"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
    ctx.fillText("DEPTH " + room.depth + " · ", x + 10, y + 13);
    const pre = ctx.measureText("DEPTH " + room.depth + " · ").width;
    ctx.fillStyle = dangerColor(room.danger);
    ctx.fillText("DANGER " + room.danger.toFixed(1), x + 10 + pre, y + 13);
    ctx.textBaseline = "alphabetic";
  }

  // Gold EXIT doorways with pulsing outward chevrons.
  function drawDoors() {
    const ctx = C.ctx, cx = C.W / 2, cy = C.H / 2, W2 = C.WALL;
    const bob = (Math.sin(C.G.t * 4) + 1) / 2; // 0..1 pulse
    const gold = "rgba(255,224,102," + (0.55 + 0.45 * bob).toFixed(2) + ")";
    // Mats inside the wall gaps.
    ctx.fillStyle = "#3a2f10";
    ctx.fillRect(cx - 34, 0, 68, W2);
    ctx.fillRect(cx - 34, C.H - W2, 68, W2);
    ctx.fillRect(0, cy - 34, W2, 68);
    ctx.fillRect(C.W - W2, cy - 34, W2, 68);
    // Gold side posts.
    ctx.fillStyle = "#ffe066";
    ctx.fillRect(cx - 36, 0, 3, W2); ctx.fillRect(cx + 33, 0, 3, W2);
    ctx.fillRect(cx - 36, C.H - W2, 3, W2); ctx.fillRect(cx + 33, C.H - W2, 3, W2);
    ctx.fillRect(0, cy - 36, W2, 3); ctx.fillRect(0, cy + 33, W2, 3);
    ctx.fillRect(C.W - W2, cy - 36, W2, 3); ctx.fillRect(C.W - W2, cy + 33, W2, 3);
    // EXIT labels inside the mats.
    ctx.fillStyle = "#ffe066"; ctx.font = "bold 11px monospace";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("EXIT", cx, W2 / 2);
    ctx.fillText("EXIT", cx, C.H - W2 / 2);
    ctx.fillText("EXIT", W2 / 2, cy);
    ctx.fillText("EXIT", C.W - W2 / 2, cy);
    // Outward chevrons just inside the room (door corridors stay clear).
    const off = 4 + bob * 7;
    ctx.strokeStyle = gold; ctx.lineWidth = 3; ctx.lineCap = "round";
    function chev(x, y, dx, dy) {
      // double chevron pointing along (dx, dy)
      for (let k = 0; k < 2; k++) {
        const bx = x + dx * k * 9, by = y + dy * k * 9;
        ctx.beginPath();
        ctx.moveTo(bx - dy * 8 - dx * 5, by - dx * 8 - dy * 5);
        ctx.lineTo(bx, by);
        ctx.lineTo(bx + dy * 8 - dx * 5, by + dx * 8 - dy * 5);
        ctx.stroke();
      }
    }
    chev(cx, W2 + 16 + off, 0, -1);
    chev(cx, C.H - W2 - 16 - off, 0, 1);
    chev(W2 + 16 + off, cy, -1, 0);
    chev(C.W - W2 - 16 - off, cy, 1, 0);
    ctx.textBaseline = "alphabetic";
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
    drawDoors();
    drawDepthPill(room);

    drawWalls(room);
    drawMachines(room, C.nearestMachine(false));
    drawPickups(room);
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
    // Floaters (pickup feedback).
    ctx.textAlign = "center";
    for (const f of C.floaters) {
      ctx.globalAlpha = Math.min(1, f.t);
      ctx.fillStyle = f.color; ctx.font = "bold 12px monospace";
      ctx.fillText(f.txt, f.x, f.y - (1.5 - f.t) * 30);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  };
})(window.Casino);
