"use strict";
/* Prize -> gameplay effects (keyword mapping + rarity fallback).
 * Depends on: config, dom, state (runtime G). */
(function (C) {
// Shared: put a familiar prize into pets/stable. Used by prizes and taming.
// Money-sniffing familiars (gold slimes, treasure fairies...) join as mules
// and boost all coin earnings on top of the loot-magnet aura.
C.applyFamiliar = function (res) {
  const p = C.G.p, r = res.rarity;
  {
    const dmg = Math.max(1, Math.round(r / 3)) + (p.petBonus || 0);
    const role = C.petRole(res.name, res.tags, res.description);
    const pet = {
      name: res.name, dmg, cd: 0, role,
      cdMax: role === "medic" ? Math.max(8, 22 - r) : 1.1,
    };
    const wealthy = C.wealthyFamiliar(res);
    let suffix = "";
    if (wealthy) {
      const gain = 0.10 + r * 0.01;
      p.coinBonus = Math.min(1.0, (p.coinBonus || 0) + gain);
      C.noteBuild(res.name.slice(0, 18) + ": coins +" + Math.round(p.coinBonus * 100) + "%", "pass");
      suffix = " Coin earnings +" + Math.round(gain * 100) +
        "% (total +" + Math.round(p.coinBonus * 100) + "%).";
    }
    const roleBlurb = { bully: "brawls on contact", medic: "heals you",
      mule: "loot magnet", scout: "ticket luck", gunner: "auto-attacks" }[role];
    if (p.pets.length < 2) {
      p.pets.push(pet);
      C.noteBuild("🐾 " + res.name + " (" + role + ")", "pet");
      return "Familiar joins (" + role + " — " + roleBlurb + "): " + res.name +
        "." + suffix + " P rotates the stable.";
    }
    p.stable.push(pet);
    C.noteBuild("🐾 " + res.name + " (" + role + ", stabled)", "pet");
    return "Familiar stabled (" + role + " — " + roleBlurb + "): " + res.name +
      "." + suffix + " Press P to rotate it in (2 active).";
  }
};

// True for familiars whose theme is money itself (not merely gold-colored).
// Bare "gold"/"coin" excluded: golden retrievers and coin-sport whales stay
// ordinary pets; ticket/gacha-flavored coins stay out too.
C.wealthyFamiliar = function (res) {
  const s = (String((res && res.name) || "") + " " + String((res && res.description) || "")).toLowerCase();
  if (/\(gacha\)|reroll|ticket|advantage|coin-flipping esport|perfectly fair coin/i.test(s)) return false;
  return /spelunker fairy|lucky slime|gold slime|wealth|treasures?|newbucks|plorts?.*gold|solid-gold egg|gold bars?|free market|stock speculation|\bgreed|hoard|fortune|money|payday|\bprofit\b/i.test(s);
};

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
      // Consumables go to the satchel: Q uses the selected stack, C cycles.
      // Bombs restock slowly while selected; potions and decoys do not.
      if (/medkit|potion|food|ration|elixir|bandage|snack|feast/i.test(nm)) {
        const power = 1 + Math.floor(r / 3);
        C.satAdd("potion", power);
        C.noteBuild(res.name.slice(0, 18) + ": potion +" + power + " (Q)");
        return "Stashed " + res.name + ": potion +" + power + " HP. Press Q to drink" +
          " (+healing bonuses apply on use).";
      }
      if (/bomb|grenade|dynamite|explosive|volatile|mine/i.test(nm)) {
        const power = 2 + Math.floor(r / 2);
        C.satAdd("bomb", power);
        C.noteBuild(res.name.slice(0, 18) + ": bomb " + power + " (Q)");
        return "Stashed " + res.name + ": throw it with Q (lands late, " + power +
          " fire). Selected bombs restock +1 per 25s up to 3.";
      }
      if (/scrap|junk|spare parts|toolkit|wrench|gears|screwdriver|toolbox|duct tape/i.test(nm)) {
        const amt = 2 + Math.floor(r / 2);
        p.parts += amt;
        C.noteBuild(res.name.slice(0, 18) + ": +" + amt + "🧩");
        C.floater(p.x, p.y - 24, "+" + amt + " 🧩 parts", "#ffe066");
        return "Scrapped " + res.name + ": +" + amt + " parts. Tinkers spend them on rigs.";
      }
      if (/decoy|bait|lure|smoke/i.test(nm)) {
        const power = 5 + r * 0.3;
        C.satAdd("decoy", power);
        C.noteBuild(res.name.slice(0, 18) + ": decoy " + power.toFixed(0) + "s (Q)");
        return "Stashed " + res.name + ": press Q to vanish for " +
          power.toFixed(0) + "s (pulls stay quiet too).";
      }
      // Gear: armor blocks hits, footwear speeds you up.
      if (/pocket armor|armoury|arsenal|weapon rack/i.test(nm)) {
        const res = C.rollArmoryWeapon(r);
        p.weapon = {
          name: res.name, ranged: false, dmg: Math.max(1, Math.round(res.rarity / 2)) + 1,
          element: C.weaponElement(res.name, res.tags), pattern: "single", rate: 1, knockback: 0,
          armory: r,
        };
        C.syncDmg();
        p.armoryT = 18;
        C.noteBuild("🔫 " + res.name + " (armory, rotates)");
        return "Shouldered " + res.name + ": the Pocket Armory draws a fresh melee weapon every " +
          "18s (" + p.dmg + " dmg). Lose the bag, lose the rack.";
      }
      if (/armor|plate|aegis|chainmail|barrier|suit/i.test(nm)) {
        p.armorPct = Math.min(0.5, (p.armorPct || 0) + 0.1 + r * 0.01);
        C.noteBuild(res.name.slice(0, 18) + ": block " + Math.round(p.armorPct * 100) + "%");
        return "Armored in " + res.name + ": " + Math.round(p.armorPct * 100) +
          "% chance to fully block a hit (cap 50%).";
      }
      if (/boots|greaves|gauntlets|treads/i.test(nm)) {
        C.modStat("SPD", 1);
        C.noteBuild(res.name.slice(0, 18) + ": SPD " + p.stats.SPD);
        return "Geared " + res.name + ": +1 SPD (move " + Math.round(C.moveSpeed()) + ").";
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
        C.modStat("DEX", 1);
        C.noteBuild(res.name.slice(0, 18) + ": manual +1 " + tk + ", DEX " + p.stats.DEX, "pass");
        C.floater(p.x, p.y - 24, "+1 🎟 " + tk, "#aed1d1");
        return "Read " + res.name + ": a " + tk + " ticket falls out as a bookmark, and you pull 3% faster.";
      }
      if (/\bromance\b|love|valentine|bouquet|chocolate|teddy|promise ring/i.test(nm)) {
        C.modStat("CHA", 2);
        C.noteBuild(res.name.slice(0, 18) + ": CHA " + p.stats.CHA);
        return "Kept " + res.name + ": +2 CHA. Looking this good should be illegal.";
      }
      if (/visor|helm|goggles|headset/i.test(nm)) {
        C.modStat("DEX", 1);
        C.noteBuild(res.name.slice(0, 18) + ": DEX " + p.stats.DEX);
        return "Wearing " + res.name + ": pulls 6% faster.";
      }
      if (/gun|rifle|pistol|launcher|blaster|bow|cannon|sword|blade|knife|baton|chair|card|chip|dagger|axe|hammer|javelin|lance|spear|mace|scythe|crowbar|prybar|\bbat\b|cleaver|glaive|katana|shiv|\bstaff\b|nunchaku|rapier|cutlass|machete|shovel|sledge|morningstar|flail|halberd|tonfa|arrow|longbow|crossbow/i.test(nm)) {
        const ranged = /gun|rifle|pistol|launcher|blaster|bow|cannon|card|chip|arrow|longbow|crossbow/i.test(nm);
        const pattern = C.weaponPattern(res.name);
        p.weapon = {
          name: res.name, ranged,
          dmg: Math.max(1, Math.round(r / 2)) + (ranged ? 0 : 1),
          element: C.weaponElement(res.name, res.tags), pattern,
          rate: pattern === "rapid" ? 0.6 : 1,
          knockback: pattern === "heavy" ? 34 : 0,
          pierce: C.weaponPierce(res.name, res.description),
          bane: /inhuman|monster slay|demon slay|undead|alien|dragonslay|beast slay|conceptually more damage/i.test(nm) ? 1.5 : 0,
        };
        C.syncDmg();
        C.noteBuild("🔫 " + res.name + " (" + p.dmg + " dmg" + (ranged ? ", ranged" : ", melee") +
          (p.weapon.element ? ", " + p.weapon.element : "") +
          (pattern !== "single" ? ", " + pattern : "") + ")");
        return "Weapon equipped: " + res.name + " (" + p.dmg + " dmg" +
          (ranged ? ", ranged" : ", melee") +
          (p.weapon.element ? ", " + p.weapon.element : "") +
          (pattern !== "single" ? ", " + pattern : "") + "). J/click to fight back — Threat will rise.";
      }
      // Wealth hoards pay out in the casino: gold/treasure prizes boost all
      // coin earnings (slots + bounties). Gear checks above win, so golden
      // weapons/armor stay gear; ticket/gacha chips stay tickets.
      if (!/\(gacha\)|reroll|ticket.*advantage|discarding its result/i.test(nm) &&
          !/fortune slip|fortune cookie/i.test(nm) &&
          /relic gold|stack of gold bars|greedy ring|endless purse|bag of endless|dragon'?s hoard|hand of midas|icon of greed|attracts wealth|make money|find treasures|fills with.*gold coins|produces.*gold coins|take its gold|becomes solid gold|perceive.*valuable|trade it for.*artifact|solid-gold egg|gold bars?|gold coins?|wealth|treasure|\bgreed|hoard|bullion|ingot|doubloon|\bpurse\b|riches|\bprofit\b|payday/i.test(nm)) {
        const gain = 0.15 + r * 0.02;
        p.coinBonus = Math.min(1.0, (p.coinBonus || 0) + gain);
        C.noteBuild(res.name.slice(0, 18) + ": coins +" + Math.round(p.coinBonus * 100) + "%", "pass");
        C.floater(p.x, p.y - 24, "+" + Math.round(gain * 100) + "% 🪙 earnings", "#ffe066");
        return "Kept " + res.name + ": coin earnings +" + Math.round(gain * 100) +
          "% (total +" + Math.round(p.coinBonus * 100) + "% — slots and bounties pay more).";
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
      return C.applyFamiliar(res);
    }
    if (cat === "trait") {
      if (/speed|swift|quick|agil/i.test(nm)) {
        C.modStat("SPD", 1);
        C.noteBuild(res.name.slice(0, 18) + ": SPD " + p.stats.SPD, "pass");
        return "Trait: +1 SPD (move " + Math.round(C.moveSpeed()) + ").";
      }
      if (/vital|health|tough|regen|heal/i.test(nm)) {
        C.modStat("END", 2);
        C.noteBuild(res.name.slice(0, 18) + ": END " + p.stats.END + " (HP " + p.maxHp + ")", "pass");
        return "Trait: +2 END (max HP " + p.maxHp + ").";
      }
      if (/pull|slot|machine|luck|gamb/i.test(nm)) {
        C.modStat("DEX", 1);
        C.noteBuild(res.name.slice(0, 18) + ": DEX " + p.stats.DEX, "pass");
        return "Trait: +1 DEX (pulls ×" + C.pullMul().toFixed(2) + ").";
      }
      if (/energ|mana|reserve|spirit|focus|meditat/i.test(nm)) {
        C.modStat("FOC", 3);
        C.noteBuild(res.name.slice(0, 18) + ": FOC " + p.stats.FOC, "pass");
        return "Trait: +3 FOC (cooldowns -" + Math.round(C.cdr() * 100) + "%, mana " + C.manaMax() + ").";
      }
      if (/physical|might|brawn|bulk|mighty|strapping/i.test(nm)) {
        C.modStat("PWR", 2);
        p.stanceBonus = (p.stanceBonus || 0) + 2;
        C.noteBuild(res.name.slice(0, 18) + ": PWR " + p.stats.PWR + ", +2s stances", "pass");
        return "Trait: +2 PWR (damage " + p.dmg.toFixed(1) + "), stances +2s.";
      }
      if (/affin|attun|align|bloodline|blood of|sorcer|wizard|witch|mage|magic|arcane/i.test(nm)) {
        // Tags first: holy-tagged angel traits have no holy-word in the
        // name ("Angel", "Principality") and previously fell to raw magic.
        const aff = C.elementOf(nm, res.tags);
        if (aff && aff !== "arcane") {
          p.elemBonus[aff] = (p.elemBonus[aff] || 0) + 0.15 + r * 0.02;
          p.resist[aff] = (p.resist[aff] || 0) + 0.1;
          C.noteBuild(res.name.slice(0, 18) + ": " + aff + " +" +
            Math.round(p.elemBonus[aff] * 100) + "%/resist", "pass");
          return "Trait: " + aff + " affinity — +" +
            Math.round(p.elemBonus[aff] * 100) + "% " + aff + " damage, 10% " + aff + " resist.";
        }
        C.modStat("FOC", 2);
        C.noteBuild(res.name.slice(0, 18) + ": raw magic, cooldowns down", "pass");
        return "Trait: raw magic — power cooldowns tick faster.";
      }
      if (/invisib|stealth|cloak|silent|unseen|sneak|skulk|prowl|ghost|phantom/i.test(nm)) {
        p.ghost = (p.ghost || 0) + 1;
        C.noteBuild(res.name.slice(0, 18) + ": ghost ×" + p.ghost, "pass");
        return "Trait: ghost ×" + p.ghost + " — pulls run quieter, guards notice you later.";
      }
      if (/relationship|friendship|\bfriend\b|charm|\bromance\b|social|\bbond\b|companion|\bally\b|trust|leadership|charisma|seduc|persua|empath|rapport/i.test(nm)) {
        C.modStat("CHA", 2);
        C.noteBuild(res.name.slice(0, 18) + ": CHA " + p.stats.CHA, "pass");
        return "Trait: +2 CHA (dominates last longer, talks reach further, pets hit harder).";
      }
      // Noses for money: wealth/treasure/reward traits boost coin earnings.
      // Placed before the seer branch so Golden Rule ("sixth sense" for
      // wealth) pays coins instead of granting door intel.
      if (/golden rule|magpie|scavenger|wealth|treasure|\bgreed|hoard|bullion|ingot|doubloon|\bpurse\b|riches|\breward\b|payday|\bprofit\b|fortune(?! slip)|winner|hero'?s reward/i.test(nm)) {
        const gain = 0.15 + r * 0.02;
        p.coinBonus = Math.min(1.0, (p.coinBonus || 0) + gain);
        C.noteBuild(res.name.slice(0, 18) + ": coins +" + Math.round(p.coinBonus * 100) + "%", "pass");
        C.floater(p.x, p.y - 24, "+" + Math.round(gain * 100) + "% 🪙 earnings", "#ffe066");
        return "Trait: nose for money — coin earnings +" + Math.round(gain * 100) +
          "% (total +" + Math.round(p.coinBonus * 100) + "%).";
      }
      if (/thinker|sense|detect|perceiv|predict|foresight|intuit|insight|sixth sense|danger sense|awareness|vigil/i.test(nm)) {
        p.survey = true;
        C.modStat("LCK", 1);
        C.noteBuild(res.name.slice(0, 18) + ": seer (door intel + luck)", "pass");
        return "Trait: seer — doors show guards and best machines, +1 LCK.";
      }
      C.modStat("SPD", 1);
      C.noteBuild(res.name.slice(0, 18) + ": SPD " + p.stats.SPD, "pass");
      return "Trait: small all-round edge (rarity " + r.toFixed(1) + ").";
    }
    // Animal handling tames a live familiar at roughly the skill's rarity.
    if (cat === "skill" && /animal|beast|fauna|taming|veterinary|zoolog|xenobiolog|biolog|ecolog|husbandry|wilderness|survival|ranger|beastmaster|wildlife/i.test(nm)) {
      try {
        const pool = C.entries();
        if (!pool.length || !window.ChaosGacha) throw new Error("no data");
        const res = window.ChaosGacha.roll(pool, null, "familiar",
          Math.max(0.1, r - 1.5), r, r + 1.5, { hideNsfw: true, hideNoncon: true }, Math.random);
        C.noteBuild(res.name.slice(0, 18) + " (tamed)", "pet");
        return "Tamed with " + res.name + ": " + C.applyFamiliar(res);
      } catch (e) {
        p.petBonus = (p.petBonus || 0) + 1;
        C.noteBuild(res.name.slice(0, 18) + ": pets +1", "pass");
        return "Skill: " + res.name + " — no beasts about, but your handling sharpens (+1 pet damage).";
      }
    }
    // Silver tongues charm the casino itself.
    if (cat === "skill" && /relationship|friendship|diplomacy|charm|\bromance\b|seduction|etiquette|negotiat|oratory/i.test(nm)) {
      C.modStat("CHA", 2);
      C.noteBuild(res.name.slice(0, 18) + ": CHA " + p.stats.CHA, "pass");
      return "Skill: " + res.name + " — +2 CHA (dominates last longer, talks reach further).";
    }
    // Martial skills: wreckers pry machines/shields, fighters hit harder
    // in melee, marksmen shoot straighter. Never pull speed.
    if (cat === "skill" && /crowbar|pry|jam|wedge|breach|wreck|sunder/i.test(nm)) {
      const w = 2 + Math.floor(r / 2);
      p.wrecker = (p.wrecker || 0) + w;
      C.noteBuild(res.name.slice(0, 18) + ": wrecker +" + w);
      C.floater(p.x, p.y - 24, "wrecker +" + w, "#ff9c41");
      return "Skill: " + res.name + " — wrecker +" + w + ": melee, machines and shields take +" + w + ".";
    }
    if (cat === "skill" && /combat|martial|brawl|fighting|swordplay|fencing|boxing|wrestling|kung fu|karate|krav|muay|swordsmanship|hand-to-hand|iaijutsu|kendo|kenjutsu/i.test(nm)) {
      p.meleeBonus = (p.meleeBonus || 0) + 1;
      C.noteBuild(res.name.slice(0, 18) + ": melee +1");
      return "Skill: " + res.name + " — melee +1 ( J/F swings hit harder).";
    }
    if (cat === "skill" && /marksmanship|sniper|gunslinger|quickdraw|trick shot|sharpshoot/i.test(nm)) {
      p.rangedBonus = (p.rangedBonus || 0) + 1;
      C.noteBuild(res.name.slice(0, 18) + ": +ranged dmg");
      return "Skill: " + res.name + " — +1 damage on ranged attacks.";
    }
    // Money skills haggle the house itself: Commerce, Tax Evasion and kin
    // boost all coin earnings. (Bare "trade(s)" excluded: profession-trade
    // skills like Blacksmithing keep their PROF edge below.)
    if (cat === "skill" && /commerce|haggl|monetary|tax evasion|money laundering|entrepreneur|merchant|bargain|good price|wealth|treasure|\bgreed|payday|\bprofit\b/i.test(nm)) {
      const gain = 0.15 + r * 0.02;
      p.coinBonus = Math.min(1.0, (p.coinBonus || 0) + gain);
      C.noteBuild(res.name.slice(0, 18) + ": coins +" + Math.round(p.coinBonus * 100) + "%", "pass");
      C.floater(p.x, p.y - 24, "+" + Math.round(gain * 100) + "% 🪙 earnings", "#ffe066");
      return "Skill: " + res.name + " — you haggle the house: coin earnings +" +
        Math.round(gain * 100) + "% (total +" + Math.round(p.coinBonus * 100) + "%).";
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
        if (kind === "pull") { C.modStat("DEX", 1); C.noteBuild(nn + ": DEX " + p.stats.DEX, "pass"); return "Skill: " + res.name + " — +1 DEX (pulls ×" + C.pullMul().toFixed(2) + ")."; }
        if (kind === "calm") { p.threatDecayT = 1; C.noteBuild(nn + ": threat decays", "pass"); return "Skill: " + res.name + " — laying low lowers Threat over time."; }
        if (kind === "healplus") { p.healBonus = (p.healBonus || 0) + 1; C.noteBuild(nn + ": +healing", "pass"); return "Skill: " + res.name + " — all healing +1."; }
        if (kind === "luck") { C.modStat("LCK", 1); C.noteBuild(nn + ": LCK " + p.stats.LCK, "pass"); return "Skill: " + res.name + " — +1 LCK (jackpots likelier, better tickets)."; }
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
      C.modStat("DEX", 1);
      C.noteBuild(res.name.slice(0, 18) + ": DEX " + p.stats.DEX, "pass");
      return "Skill: pulls 10% faster (DEX " + p.stats.DEX + ").";
    }
    // Pack leaders: items that feed your menagerie buff all pets.
    if (cat === "item" && /guardian|companions?|\bpets?\b|familiars?|minions?|pack leader|beastmaster/i.test(nm)) {
      p.petBonus = (p.petBonus || 0) + 1;
      for (const pt of p.pets) pt.dmg += 1;
      C.noteBuild(res.name.slice(0, 18) + ": pets +1");
      return "Kept " + res.name + ": your familiars hit +1 (present and future).";
    }
    // Generic fallback scales with rarity so every pull is useful.
    if (!p.weapon && r >= 3) {
      p.weapon = { name: res.name + " (improv)", ranged: false, dmg: Math.max(1, Math.round(r / 2)) };
      p.weapon.pierce = C.weaponPierce(res.name, res.description);
      C.syncDmg();
      return "Prize doubles as weapon: " + res.name + ". You can fight back now.";
    }
    C.modStat("PWR", 1); C.modStat("SPD", 1);
    C.noteBuild(res.name.slice(0, 18) + ": PWR/SPD +1", "pass");
    return "Prize essence: +1 PWR/+1 SPD (rarity " + r.toFixed(1) + " " + C.rarityName(r) + ").";
  };

  // Elemental set bonuses: 3+ prizes sharing an elemental tag grant +25%
  // damage of that element (reuses the elemBonus machinery, so burn/poison
  // ticks and shieldbreaking scale too). Healing 3+ grants slow regen.
  // Counts come from prizeLog tags; each set is granted once per run.
  C.TAG_SETS = [
    ["fire", "fire", 3, 0.25], ["water", "water", 3, 0.25],
    ["ice", "frost", 3, 0.25], ["lightning", "bolt", 3, 0.25],
    ["earth", "earth", 3, 0.25], ["wind", "wind", 3, 0.25],
    ["shadow", "shadow", 3, 0.25], ["nature", "nature", 3, 0.25],
    ["poison", "venom", 3, 0.25], ["holy", "light", 3, 0.25],
  ];
  C.checkTagSets = function () {
    const p = C.G.p;
    p.tagSetsGranted = p.tagSetsGranted || {};
    const counts = {};
    for (const e of (C.G.prizeLog || [])) {
      for (const t of (e.tags || [])) counts[t] = (counts[t] || 0) + 1;
    }
    for (const [tag, el, need, bonus] of C.TAG_SETS) {
      if ((counts[tag] || 0) >= need && !p.tagSetsGranted[tag]) {
        p.tagSetsGranted[tag] = true;
        p.elemBonus[el] = (p.elemBonus[el] || 0) + bonus;
        C.noteBuild("🏷 " + tag + " ×" + need + ": +" +
          Math.round(bonus * 100) + "% " + el, "pass");
        C.floater(p.x, p.y - 40, "set: " + tag + " +" +
          Math.round(bonus * 100) + "% " + el + "!", "#ffe066");
      }
    }
    if ((counts.healing || 0) >= 3 && !p.tagSetsGranted.healing && !p.regen) {
      p.tagSetsGranted.healing = true;
      p.regen = 1;
      C.noteBuild("🏷 healing ×3: regen 1HP/30s", "pass");
      C.floater(p.x, p.y - 40, "set: healing regen!", "#11d939");
    }
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
