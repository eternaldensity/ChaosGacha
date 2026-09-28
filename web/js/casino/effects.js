"use strict";
/* Active ability ops: compile keyword-matched ability prizes into runnable,
 * cooldown-gated powers bound to slot keys (J/K/L). Unmatched abilities fall
 * back to the legacy essence path in prizes.js — never a dead pull.
 * Depends on: config, state (runtime). Execution lives in combat.js. */
(function (C) {
  C.SLOT_KEYS = ["J", "K", "L"];

  // Doc rule, run-scaled: 1 slot, +1 per 5 abilities owned, cap 3.
  C.maxSlots = function () {
    return Math.min(3, 1 + Math.floor((C.G.p.abilitiesOwned || 0) / 5));
  };

  C.slotCd = function (base, rarity) {
    return base / (1 + 0.06 * rarity);
  };

  // Returns {name, rarity, op, element, power, cd, cdLeft, blurb} or null.
  C.compileAbility = function (res) {
    const nm = (res.name + " " + (res.description || "")).toLowerCase(), r = res.rarity;
    if (/fire|flame|lightning|bolt|projectile|emit|blast|beam|breath|plasma|frost|ice|freeze|shadow.?bolt|holy.?light|acid|poison.?spit|energy.?blast/i.test(nm)) {
      const element = /fire|flame|blast|explos|plasma|inferno/i.test(nm) ? "fire"
        : /lightning|bolt|storm|thunder|electric/i.test(nm) ? "bolt"
        : /frost|ice|freeze|cold|blizzard/i.test(nm) ? "frost"
        : /poison|acid|venom|toxic/i.test(nm) ? "venom" : "arcane";
      const power = Math.max(1, Math.round(r / 2));
      return {
        name: res.name, rarity: r, op: "bolt", element, power,
        cd: C.slotCd(0.55, r), cdLeft: 0,
        blurb: element + " bolt (" + power + " dmg" + (C.G.p.weapon ? ", +1 armed" : "") + ")",
      };
    }
    if (/teleport|blink|dash|phase|afterimage|flicker/i.test(nm)) {
      return {
        name: res.name, rarity: r, op: "dash", power: 340,
        cd: C.slotCd(6, r), cdLeft: 0, blurb: "blink-dash, i-frames",
      };
    }
    if (/heal|regen|restor|purif|cure|second.?wind|mend|rejuvenat/i.test(nm)) {
      const power = 1 + Math.floor(r / 3);
      return {
        name: res.name, rarity: r, op: "heal", power,
        cd: C.slotCd(25, r), cdLeft: 0, blurb: "restore " + power + " HP",
      };
    }
    return null;
  };

  // Equip into the first free slot; overflow goes to the stash.
  // Returns the bound key ("J"/"K"/"L") or null when stashed.
  C.equipAbility = function (ab) {
    const p = C.G.p;
    if (p.slots.length < C.maxSlots()) {
      p.slots.push(ab);
      return C.SLOT_KEYS[p.slots.length - 1];
    }
    p.stash.push(ab);
    return null;
  };

  // Newly opened slots auto-fill from the stash. Returns count moved.
  C.fillSlots = function () {
    const p = C.G.p;
    let moved = 0;
    while (p.slots.length < C.maxSlots() && p.stash.length) {
      p.slots.push(p.stash.shift());
      moved++;
    }
    return moved;
  };
})(window.Casino);
