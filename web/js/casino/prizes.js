"use strict";
/* Prize -> gameplay effects (keyword mapping + rarity fallback).
 * Depends on: config, dom, state (runtime G). */
(function (C) {
  C.applyPrize = function (res) {
    const p = C.G.p, cat = res.category;
    const nm = (res.name + " " + res.description).toLowerCase(), r = res.rarity;
    const bonus = 1 + (r - 1) * 0.08;
    if (cat === "item" && /gun|rifle|pistol|launcher|blaster|bow|cannon|sword|blade|knife|baton|chair|card|chip|dagger|axe|hammer/i.test(nm)) {
      const ranged = /gun|rifle|pistol|launcher|blaster|bow|cannon|card|chip/i.test(nm);
      p.weapon = { name: res.name, ranged, dmg: Math.max(1, Math.round(r / 2)) + (ranged ? 0 : 1) };
      p.dmg = p.weapon.dmg;
      return "Weapon equipped: " + res.name + " (" + p.dmg + " dmg" +
        (ranged ? ", ranged" : ", melee") + "). J/click to fight back — Threat will rise.";
    }
    if (cat === "ability" && /fire|flame|lightning|bolt|projectile|emit|kinesis|blast|beam/i.test(nm)) {
      p.weapon = p.weapon || { name: res.name + " (zap)", ranged: true, dmg: Math.max(1, Math.round(r / 2)) };
      p.dmg = Math.max(p.dmg, p.weapon.dmg);
      return "Combat ability: " + res.name + ". You can now attack (J/click).";
    }
    if (cat === "familiar") {
      const dmg = Math.max(1, Math.round(r / 3));
      p.pets.push({ name: res.name, dmg, cd: 0 });
      return "Familiar joins: " + res.name + " (auto-attacks, " + dmg + " dmg).";
    }
    if (cat === "trait") {
      if (/speed|swift|quick|agil/i.test(nm)) {
        p.speed *= 1 + 0.04 * bonus;
        return "Trait: +" + Math.round(4 * bonus) + "% move speed.";
      }
      if (/vital|health|tough|regen|heal/i.test(nm)) {
        p.maxHp += 1; p.hp = Math.min(p.maxHp, p.hp + 1);
        return "Trait: +1 max HP.";
      }
      if (/pull|slot|machine|luck|gamb/i.test(nm)) {
        p.pullMul = Math.max(0.6, p.pullMul * 0.92);
        return "Trait: pulls 8% faster.";
      }
      p.speed *= 1.02; p.pullMul = Math.max(0.6, p.pullMul * 0.98);
      return "Trait: small all-round edge (rarity " + r.toFixed(1) + ").";
    }
    if (cat === "skill") {
      if (r >= 4 || /slot|machine|discount|coin|econom/i.test(nm)) {
        p.discount = Math.min(0.4, p.discount + 0.08);
        return "Skill: slot costs -8% (total -" + Math.round(p.discount * 100) + "%).";
      }
      p.pullMul = Math.max(0.6, p.pullMul * 0.9);
      return "Skill: pulls 10% faster.";
    }
    // Generic fallback scales with rarity so every pull is useful.
    if (!p.weapon && r >= 3) {
      p.weapon = { name: res.name + " (improv)", ranged: false, dmg: Math.max(1, Math.round(r / 2)) };
      p.dmg = p.weapon.dmg;
      return "Prize doubles as weapon: " + res.name + ". You can fight back now.";
    }
    p.dmg += 0.2 * bonus; p.speed += 2;
    return "Prize essence: +damage/speed (rarity " + r.toFixed(1) + " " + C.rarityName(r) + ").";
  };

  C.checkFeats = function () {
    const f = C.G.feats;
    if (!f.firstPulls && C.G.pulls >= 20) {
      f.firstPulls = 1;
      C.G.p.tickets.silver++;
      C.showCard("Feat: Degenerate (20 pulls)", "+1× Silver Skill ticket.", "", 2500);
    }
  };
})(window.Casino);
