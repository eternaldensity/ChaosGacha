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

  // Complete fresh start: forget all permanent bonuses.
  C.wipeLegacy = function () {
    C.legacy = [];
    C.pendingCurses = [];
    try { localStorage.removeItem(KEY); } catch (e) {}
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

  C.legacyWeapon = function () {
    for (let i = C.legacy.length - 1; i >= 0; i--) {
      if (C.legacy[i].heirloom) return C.legacy[i].heirloom;
    }
    return null;
  };

  const BEST_KEY = "chaosCasinoBest";
  C.getBest = function () {
    try { return JSON.parse(localStorage.getItem(BEST_KEY) || "{}"); }
    catch (e) { return {}; }
  };
  // Returns true if any record fell.
  C.saveBest = function (depth, time, kills) {
    const b = C.getBest();
    let best = false;
    if (depth > (b.depth || 0)) { b.depth = depth; best = true; }
    if (time > (b.time || 0)) { b.time = Math.round(time); best = true; }
    if (kills > (b.kills || 0)) { b.kills = kills; best = true; }
    try { localStorage.setItem(BEST_KEY, JSON.stringify(b)); } catch (e) {}
    return best;
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
