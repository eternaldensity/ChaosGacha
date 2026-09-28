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
        const amt = 1 + Math.floor(r / 3) + (p.healBonus || 0);
        p.hp = Math.min(p.maxHp, p.hp + amt);
        C.noteBuild(res.name.slice(0, 18) + ": ate +" + amt + " HP");
        C.floater(p.x, p.y - 24, "+" + amt + " HP", "#11d939");
        return "Consumed " + res.name + ": +" + amt + " HP on the spot.";
      }
      if (/bomb|grenade|dynamite|explosive|volatile|mine/i.test(nm)) {
        C.detonate(p.x, p.y, 135, C.playerDmg(2 + Math.floor(r / 2)), "fire");
        C.noteBuild(res.name.slice(0, 18) + ": volatile boom");
        return "Volatile " + res.name + ": it detonates on touch! Guards nearby eat " +
          (2 + Math.floor(r / 2)) + " fire damage.";
      }
      if (/scrap|junk|spare parts|toolkit|wrench|gears|screwdriver|toolbox|duct tape/i.test(nm)) {
        const amt = 2 + Math.floor(r / 2);
        p.parts += amt;
        C.noteBuild(res.name.slice(0, 18) + ": +" + amt + "🧩");
        C.floater(p.x, p.y - 24, "+" + amt + " 🧩 parts", "#ffe066");
        return "Scrapped " + res.name + ": +" + amt + " parts. Tinkers spend them on rigs.";
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
      const mountKind = /\bbike\b|motorcycle|scooter|skateboard|moped/i.test(nm) ? "bike"
        : /\bcar\b|truck|tank(?! top)|van|\bbus\b|jeep|limousine/i.test(nm) ? "car"
        : /horse|steed|\bmount\b|rhino|elephant|riding beast|dire wolf/i.test(nm) ? "mount"
        : null;
      if (mountKind) {
        const spec = {
          bike: { hp: 2, speedMult: 1.8, ram: 1, glyph: "🏍" },
          car: { hp: 5, speedMult: 1.3, ram: 4, glyph: "\uD83D\uDE97" },
          mount: { hp: 3, speedMult: 1.5, ram: 2, glyph: "\uD83D\uDC0E" },
        }[mountKind];
        p.mount = Object.assign({ name: res.name, kind: mountKind, ramCd: 0 }, spec);
        C.noteBuild(res.name.slice(0, 18) + ": " + mountKind + " ride");
        C.floater(p.x, p.y - 24, spec.glyph + " mounted!", "#ffe066");
        return "Mounted " + res.name + ": +" + Math.round((spec.speedMult - 1) * 100) +
          "% speed, tramples guards for " + spec.ram + ", tanks " + spec.hp + " hits.";
      }
      if (/suit|tuxedo|dress|gown|perfume|cologne|\bmask\b|costume|fashion|uniform|disguise|attire|\bcloak\b|invisibility/i.test(nm)) {
        p.presence = Math.min(0.4, (p.presence || 0) + 0.1);
        C.noteBuild(res.name.slice(0, 18) + ": presence " + Math.round(p.presence * 100) + "%");
        return "Wearing " + res.name + ": presence — guards notice you " +
          Math.round(p.presence * 100) + "% later (sight shrunk, cap 40%).";
      }
      if (/book|manual|tome|guide|textbook|handbook|grimoire|codex/i.test(nm)) {
        const tiers = ["bronze", "bronze", "silver", "silver", "gold"];
        const tk = tiers[Math.floor(Math.random() * tiers.length)];
        p.tickets[tk]++;
        p.pullMul = Math.max(0.6, p.pullMul * 0.97);
        C.noteBuild(res.name.slice(0, 18) + ": manual +1 " + tk, "pass");
        C.floater(p.x, p.y - 24, "+1 🎟 " + tk, "#aed1d1");
        return "Read " + res.name + ": a " + tk + " ticket falls out as a bookmark, and you pull 3% faster.";
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
        C.noteBuild("[" + (p.slots.length < C.maxSlots() ? C.SLOT_KEYS[p.slots.length] : "draft") + "] " + ab.name + " (" + ab.op + ")");
        const key = C.equipAbility(ab);
        if (key) {
          return "Slotted [" + key + "]: " + ab.name + " — " + ab.blurb + "." + slotNote +
            " (" + p.slots.length + "/" + C.maxSlots() + " slots; +1 per 5 abilities).";
        }
        // Full: Advantage-style draft instead of a silent stash.
        C.openDraft({ kind: "new", ab });
        return "Slots full — draft opened! Pick a slot for " + ab.name + slotNote + ".";
      }
      // Unmatched abilities fall through to the essence fallback below.
      if (opened) C.floater(p.x, p.y - 40, "+" + opened + " ability slot!", "#ffe066");
    }
    if (cat === "familiar") {
      const dmg = Math.max(1, Math.round(r / 3)) + (p.petBonus || 0);
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
      if (/energ|mana|reserve|spirit|focus|meditat/i.test(nm)) {
        p.cdr = Math.min(0.35, (p.cdr || 0) + 0.04 + r * 0.005);
        C.noteBuild(res.name.slice(0, 18) + ": cooldowns -" + Math.round(p.cdr * 100) + "%", "pass");
        return "Trait: deep reserves — power cooldowns -" + Math.round(p.cdr * 100) + "% total.";
      }
      if (/physical|might|brawn|bulk|mighty|strapping/i.test(nm)) {
        p.dmg += 0.5;
        p.stanceBonus = (p.stanceBonus || 0) + 2;
        C.noteBuild(res.name.slice(0, 18) + ": +dmg, +2s stances", "pass");
        return "Trait: physicality — +0.5 base damage (now " + p.dmg.toFixed(1) + "), stances +2s.";
      }
      if (/affin|attun|align|bloodline|blood of|sorcer|wizard|witch|mage|magic|arcane/i.test(nm)) {
        const aff = C.elementOf(nm);
        if (aff && aff !== "arcane") {
          p.elemBonus[aff] = (p.elemBonus[aff] || 0) + 0.15 + r * 0.02;
          p.resist[aff] = (p.resist[aff] || 0) + 0.1;
          C.noteBuild(res.name.slice(0, 18) + ": " + aff + " +" +
            Math.round(p.elemBonus[aff] * 100) + "%/resist", "pass");
          return "Trait: " + aff + " affinity — +" +
            Math.round(p.elemBonus[aff] * 100) + "% " + aff + " damage, 10% " + aff + " resist.";
        }
        p.cdr = Math.min(0.35, (p.cdr || 0) + 0.03);
        C.noteBuild(res.name.slice(0, 18) + ": raw magic, cooldowns down", "pass");
        return "Trait: raw magic — power cooldowns tick faster.";
      }
      if (/thinker|sense|detect|perceiv|predict|foresight|intuit|insight|sixth sense|danger sense|awareness|vigil/i.test(nm)) {
        p.survey = true;
        p.luck = (p.luck || 0) + 1;
        C.noteBuild(res.name.slice(0, 18) + ": seer (door intel + luck)", "pass");
        return "Trait: seer — doors show guards and best machines, +1 luck.";
      }
      p.speed *= 1.02; p.pullMul = Math.max(0.6, p.pullMul * 0.98);
      C.noteBuild(res.name.slice(0, 18) + ": edge (speed/pull)", "pass");
      return "Trait: small all-round edge (rarity " + r.toFixed(1) + ").";
    }
    // Profession skills (usually "Rank Profession"): the trade becomes a
    // casino edge. Unlisted trades fall through to generic pull speed.
    const PROF = [
      [/cook|culinar|baking|brewing/i, "regen", "slow-heal 1 HP / 30s"],
      [/shoot|archery|marksman|throwing|firearms/i, "ranged", "+1 ranged damage"],
      [/mechan|engineer|craft|smith|repair|tinker/i, "pull", "pulls 10% faster"],
      [/act|decept|persua|stealth|sneak|perform|disguise/i, "calm", "threat decays over time"],
      [/medic|doctor|surgery|first aid|herbal/i, "healplus", "+1 healing received"],
      [/gamb|luck|games|cheat|afi/i, "luck", "jackpots +0.5%, better tickets"],
      [/athlet|acrobat|dodge|evasion|sprint/i, "roll", "dodge recharges faster"],
      [/percept|scout|track|sense|investigat/i, "tickets", "+1 ticket right now"],
      [/leader|command|tactics|strateg/i, "pets", "pets hit +1"],
      [/farm|fish|mine|harvest|gather/i, "coins", "+25 coins right now"],
    ];
    if (cat === "skill") {
      const prof = nm.replace(/^(basic|intermediate|adept|expert|master|grandmaster|divine|trash)\s+/, "");
      for (const [re, kind] of PROF) {
        if (!re.test(prof) && !re.test(nm)) continue;
        const nn = res.name.slice(0, 20);
        if (kind === "regen") { p.regen = 1; C.noteBuild(nn + ": regen 1HP/30s", "pass"); return "Skill: " + res.name + " — you regenerate 1 HP every 30s."; }
        if (kind === "ranged") { p.rangedBonus = (p.rangedBonus || 0) + 1; C.noteBuild(nn + ": +ranged dmg", "pass"); return "Skill: " + res.name + " — +1 damage on ranged attacks."; }
        if (kind === "pull") { p.pullMul = Math.max(0.6, p.pullMul * 0.9); C.noteBuild(nn + ": pulls 10% faster", "pass"); return "Skill: " + res.name + " — pulls 10% faster."; }
        if (kind === "calm") { p.threatDecayT = 1; C.noteBuild(nn + ": threat decays", "pass"); return "Skill: " + res.name + " — laying low lowers Threat over time."; }
        if (kind === "healplus") { p.healBonus = (p.healBonus || 0) + 1; C.noteBuild(nn + ": +healing", "pass"); return "Skill: " + res.name + " — all healing +1."; }
        if (kind === "luck") { p.luck = (p.luck || 0) + 1; C.noteBuild(nn + ": luck +1", "pass"); return "Skill: " + res.name + " — luck +1 (jackpots likelier, better tickets)."; }
        if (kind === "roll") { p.rollCdMax = Math.max(2, (p.rollCdMax || 5) - 1); C.noteBuild(nn + ": dodge faster", "pass"); return "Skill: " + res.name + " — dodge recharges faster."; }
        if (kind === "tickets") { p.tickets.silver++; C.noteBuild(nn + ": spotted +1 silver", "pass"); return "Skill: " + res.name + " — you spot a dropped Silver ticket. (+1)"; }
        if (kind === "pets") { for (const pt of p.pets) pt.dmg += 1; p.petBonus = (p.petBonus || 0) + 1; C.noteBuild(nn + ": pets +1", "pass"); return "Skill: " + res.name + " — your familiars hit +1 (and future ones start stronger)."; }
        if (kind === "coins") { p.coins += 25; C.noteBuild(nn + ": +25 coins", "pass"); return "Skill: " + res.name + " — you shake +25 coins out of the cushions."; }
      }
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
