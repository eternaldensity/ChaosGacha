"use strict";
/* HUD. Depends on: config, dom, state (runtime). */
(function (C) {
  C.updateHud = function () {
    const p = C.G.p, room = C.curRoom();
    C.el("hCoins").textContent = "🪙 " + p.coins;
    C.el("hParts").textContent = "🧩 " + (p.parts || 0);
    C.el("hHp").textContent = "❤ " + Math.max(0, p.hp) + "/" + p.maxHp;
    C.el("hThreat").textContent = "★ Threat " + C.G.threat;
    C.el("hDepth").textContent = "🚪 Depth " + room.depth + " · Danger " + room.danger.toFixed(1);
    C.el("hTime").textContent = "⏱ " + C.fmtTime(C.G.t) + " · ☠" + C.G.kills + " · 🎰" + C.G.pulls;
    const prim = p.slots[0] ? "[" + C.SLOT_KEYS[0] + "] " + p.slots[0].name : null;
    C.el("hWeapon").textContent = prim || (p.weapon
      ? "🔫 " + p.weapon.name.slice(0, 22)
      : "🥊 Unarmed (J does nothing)");
    C.el("tickets").innerHTML = C.TIERS.map(t =>
      "<span class='tick' style='border-color:" + t.color + "'>" +
      t.label.slice(0, 4) + "×" + (p.tickets[t.id] || 0) + "</span>").join("");
    const bits = [];
    if (p.weapon) bits.push("<span class='bchip'>🔫 " + esc(p.weapon.name) + " " + p.dmg + "dmg</span>");
    p.slots.forEach((s, i) => bits.push("<span class='bchip'>[" + C.SLOT_KEYS[i] + "] " +
      esc(s.name) + " (" + s.op + (s.element ? "/" + s.element : "") + ")</span>"));
    if (p.stash.length) bits.push("<span class='bchip'>+" + p.stash.length + " stashed</span>");
    p.pets.forEach(pt => bits.push("<span class='bchip pet'>🐾 " + esc(pt.name) +
      " (" + (pt.role || "gunner") + ")</span>"));
    if (p.stable.length) bits.push("<span class='bchip pet'>+" + p.stable.length + " stabled (P)</span>");
    if (p.armorPct > 0) bits.push("<span class='bchip'>🛡 block " + Math.round(p.armorPct * 100) + "%</span>");
    if (p.cloakT > 0) bits.push("<span class='bchip'>👻 cloak " + p.cloakT.toFixed(0) + "s</span>");
    (C.G.curses || []).forEach(c => bits.push("<span class='bchip'>🎲 " +
      esc(c.label) + " (" + c.tier + (c.resolved ? ", ✓" : "") + ")</span>"));
    p.buildLog.forEach(b => bits.push("<span class='bchip " + b.cls + "'>" + esc(b.txt) + "</span>"));
    C.el("build").innerHTML = bits.join("") || "<span class='bchip'>No prizes yet — pull a gacha.</span>";

  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  };
})(window.Casino);
