"use strict";
/* Persistent legacy bonuses (localStorage, like tree.html progress). */
(function (C) {
  const KEY = "chaosCasinoLegacy";
  C.legacy = [];
  try { C.legacy = JSON.parse(localStorage.getItem(KEY) || "[]"); }
  catch (e) { C.legacy = []; }

  C.saveLegacy = function () {
    try { localStorage.setItem(KEY, JSON.stringify(C.legacy)); } catch (e) {}
  };

  C.legacyBonus = function () {
    const b = { coins: 0, pullMul: 1, maxHp: 0 };
    for (const l of C.legacy) {
      b.coins += Math.floor((l.rarity || 1) * 8);
      b.pullMul *= 0.97;
      if ((l.rarity || 0) >= 6) b.maxHp += 1;
    }
    b.pullMul = Math.max(0.6, b.pullMul);
    return b;
  };

  C.legacyTierFor = function (mins) {
    if (mins < 3) return "bronze";
    if (mins < 8) return "silver";
    if (mins < 15) return "gold";
    if (mins < 25) return "platinum";
    if (mins < 40) return "diamond";
    return "legendary";
  };
})(window.Casino);
