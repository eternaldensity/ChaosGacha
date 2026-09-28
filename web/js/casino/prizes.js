"use strict";
/* Prize -> gameplay effects (keyword mapping + rarity fallback).
 * Depends on: config, dom, state (runtime G). */
(function (C) {
  C.applyPrize = function (res) {
    const p = C.G.p, cat = res.category;
    for (const mt of (res.meta || [])) {
      const tm = /ticket-bonus:(\d+)/.exec(mt);
      if (tm) {
        p.discount = Math.min(0.4, p.discount + Number(tm[1]) / 500);
        C.floater(p.x, p.y - 40, "meta: slot costs down!", "#ffe066");
      }
    }
    const nm = (res.name + " " + res.description).toLowerCase(), r = res.rarity;
    const bonus = 1 + (r - 1) * 0.08;
    if (cat === "item") {
      // Consumables trigger on touch.
      if (/medkit|potion|food|ration|elixir|bandage|snack|feast/i.test(nm)) {
        const amt = 1 + Math.floor(r / 3);
        p.hp = Math.min(p.maxHp, p.hp + amt);
        C.noteBuild(res.name.slice(0, 18) + ": ate +" + amt + " HP");
        C.floater(p.x, p.y - 24, "+" + amt + " HP", "#11d939");
        return "Consumed " + res.name + ": +" + amt + " HP on the spot.";
      }
      if (/bomb|grenade|dynamite|explosive|volatile|mine/i.test(nm)) {
        C.detonate(p.x, p.y, 135, 2 + Math.floor(r / 2), "fire");
        C.noteBuild(res.name.slice(0, 18) + ": volatile boom");
        return "Volatile " + res.name + ": it detonates on touch! Guards nearby eat " +
          (2 + Math.floor(r / 2)) + " fire damage.";
      }
      if (/decoy|bait|lure|smoke/i.test(nm)) {
        p.cloakT = 5 + r * 0.3;
        C.noteBuild(res.name.slice(0, 18) + ": cloak " + p.cloakT.toFixed(0) + "s");
        return "Deployed " + res.name + ": guards lose your trail for " +
          p.cloakT.toFixed(0) + "s (pulls stay quiet too).";
      }
      // Gear: armor blocks hits, footwear speeds you up.
      if (/armor|plate|aegis|chainmail|barrier|suit/i.test(nm)) {
        p.armorPct = Math.min(0.5, (p.armorPct || 0) + 0.1 + r * 0.01);
        C.noteBuild(res.name.slice(0, 18) + ": block " + Math.round(p.armorPct * 100) + "%");
        return "Armored in " + res.name + ": " + Math.round(p.armorPct * 100) +
          "% chance to fully block a hit (cap 50%).";
      }
      if (/boots|greaves|gauntlets|treads/i.test(nm)) {
        p.speed *= 1 + 0.03 * bonus;
        C.noteBuild(res.name.slice(0, 18) + ": +" + Math.round(3 * bonus) + "% speed");
        return "Geared " + res.name + ": +" + Math.round(3 * bonus) + "% move speed.";
      }
      if (/visor|helm|goggles|headset/i.test(nm)) {
        p.pullMul = Math.max(0.6, p.pullMul * 0.94);
        C.noteBuild(res.name.slice(0, 18) + ": pulls 6% faster");
        return "Wearing " + res.name + ": pulls 6% faster.";
      }
      if (/gun|rifle|pistol|launcher|blaster|bow|cannon|sword|blade|knife|baton|chair|card|chip|dagger|axe|hammer/i.test(nm)) {
        const ranged = /gun|rifle|pistol|launcher|blaster|bow|cannon|card|chip/i.test(nm);
        const pattern = C.weaponPattern(res.name);
        p.weapon = {
          name: res.name, ranged,
          dmg: Math.max(1, Math.round(r / 2)) + (ranged ? 0 : 1),
          element: C.weaponElement(res.name), pattern,
          rate: pattern === "rapid" ? 0.6 : 1,
          knockback: pattern === "heavy" ? 34 : 0,
        };
        p.dmg = p.weapon.dmg;
        C.noteBuild("🔫 " + res.name + " (" + p.dmg + " dmg" + (ranged ? ", ranged" : ", melee") +
          (p.weapon.element ? ", " + p.weapon.element : "") +
          (pattern !== "single" ? ", " + pattern : "") + ")");
        return "Weapon equipped: " + res.name + " (" + p.dmg + " dmg" +
          (ranged ? ", ranged" : ", melee") +
          (p.weapon.element ? ", " + p.weapon.element : "") +
          (pattern !== "single" ? ", " + pattern : "") + "). J/click to fight back — Threat will rise.";
      }
    }
    if (cat === "ability") {
      p.abilitiesOwned = (p.abilitiesOwned || 0) + 1;
      const ab = C.compileAbility(res);
      const opened = C.fillSlots();
      const slotNote = opened ? " (+" + opened + " slot opened!)" : "";
      if (ab) {
        C.noteBuild("[" + (p.slots.length < C.maxSlots() ? C.SLOT_KEYS[p.slots.length] : "stash") + "] " + ab.name + " (" + ab.op + ")");
        const key = C.equipAbility(ab);
        if (key) {
          return "Slotted [" + key + "]: " + ab.name + " — " + ab.blurb + "." + slotNote +
            " (" + p.slots.length + "/" + C.maxSlots() + " slots; +1 per 5 abilities).";
        }
        return "Stashed: " + ab.name + " (" + ab.blurb + "). Slots full" + slotNote + ".";
      }
      // Unmatched abilities fall through to the essence fallback below.
      if (opened) C.floater(p.x, p.y - 40, "+" + opened + " ability slot!", "#ffe066");
    }
    if (cat === "familiar") {
      const dmg = Math.max(1, Math.round(r / 3));
      const role = C.petRole(res.name);
      const pet = {
        name: res.name, dmg, cd: 0, role,
        cdMax: role === "medic" ? Math.max(8, 22 - r) : 1.1,
      };
      const roleBlurb = { bully: "brawls on contact", medic: "heals you",
        mule: "loot magnet", scout: "ticket luck", gunner: "auto-attacks" }[role];
      if (p.pets.length < 2) {
        p.pets.push(pet);
        C.noteBuild("🐾 " + res.name + " (" + role + ")", "pet");
        return "Familiar joins (" + role + " — " + roleBlurb + "): " + res.name +
          ". P rotates the stable.";
      }
      p.stable.push(pet);
      C.noteBuild("🐾 " + res.name + " (" + role + ", stabled)", "pet");
      return "Familiar stabled (" + role + " — " + roleBlurb + "): " + res.name +
        ". Press P to rotate it in (2 active).";
    }
    if (cat === "trait") {
      if (/speed|swift|quick|agil/i.test(nm)) {
        p.speed *= 1 + 0.04 * bonus;
        C.noteBuild(res.name.slice(0, 18) + ": +" + Math.round(4 * bonus) + "% speed", "pass");
        return "Trait: +" + Math.round(4 * bonus) + "% move speed.";
      }
      if (/vital|health|tough|regen|heal/i.test(nm)) {
        p.maxHp += 1; p.hp = Math.min(p.maxHp, p.hp + 1);
        C.noteBuild(res.name.slice(0, 18) + ": +1 max HP", "pass");
        return "Trait: +1 max HP.";
      }
      if (/pull|slot|machine|luck|gamb/i.test(nm)) {
        p.pullMul = Math.max(0.6, p.pullMul * 0.92);
        C.noteBuild(res.name.slice(0, 18) + ": pulls 8% faster", "pass");
        return "Trait: pulls 8% faster.";
      }
      p.speed *= 1.02; p.pullMul = Math.max(0.6, p.pullMul * 0.98);
      C.noteBuild(res.name.slice(0, 18) + ": edge (speed/pull)", "pass");
      return "Trait: small all-round edge (rarity " + r.toFixed(1) + ").";
    }
    if (cat === "skill") {
      if (r >= 4 || /slot|machine|discount|coin|econom/i.test(nm)) {
        p.discount = Math.min(0.4, p.discount + 0.08);
        C.noteBuild(res.name.slice(0, 18) + ": slots -" + Math.round(p.discount * 100) + "%", "pass");
        return "Skill: slot costs -8% (total -" + Math.round(p.discount * 100) + "%).";
      }
      p.pullMul = Math.max(0.6, p.pullMul * 0.9);
      C.noteBuild(res.name.slice(0, 18) + ": pulls 10% faster", "pass");
      return "Skill: pulls 10% faster.";
    }
    // Generic fallback scales with rarity so every pull is useful.
    if (!p.weapon && r >= 3) {
      p.weapon = { name: res.name + " (improv)", ranged: false, dmg: Math.max(1, Math.round(r / 2)) };
      p.dmg = p.weapon.dmg;
      return "Prize doubles as weapon: " + res.name + ". You can fight back now.";
    }
    p.dmg += 0.2 * bonus; p.speed += 2;
    C.noteBuild(res.name.slice(0, 18) + ": +dmg/speed", "pass");
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
