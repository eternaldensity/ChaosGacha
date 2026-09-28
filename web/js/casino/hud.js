"use strict";
/* HUD. Depends on: config, dom, state (runtime). */
(function (C) {
  C.updateHud = function () {
    const p = C.G.p, room = C.curRoom();
    C.el("hCoins").textContent = "🪙 " + p.coins;
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
  };
})(window.Casino);
