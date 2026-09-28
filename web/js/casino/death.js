"use strict";
/* Death slot machine: the run cashes out on the death screen. Machine tier
 * follows max depth reached; pull count follows survival time. Spins pay
 * tickets, coins, caches and run-bonuses banked for the NEXT run only
 * (nothing permanent — records are the only immortality).
 * Depends on: config, dom, state (C.banked), audio (runtime). */
(function (C) {
  C.banked = null; // consumed by the next respawn, forfeited by fresh starts

  function blankBanked() {
    return { tickets: {}, coins: 0, ammo: 0, parts: 0, maxHp: 0 };
  }

  // Highest tier whose doors you could have reached. Died at home: bronze.
  C.deathTier = function (maxDepth) {
    if (maxDepth <= 0) return C.TIERS[0];
    let best = C.TIERS[0];
    for (const t of C.TIERS) if (maxDepth >= t.minDepth) best = t;
    return best;
  };

  C.deathPulls = function (secs) {
    return Math.min(10, 2 + Math.floor(secs / 60));
  };

  const REEL_SYMS = ["7", "BAR", "★", "♦", "♥", "🪙"];

  // One pull: rigged display symbols + banked reward.
  C.deathPayout = function (tier) {
    const idx = C.tierIdx(tier.id);
    const lower = C.TIERS[Math.max(0, idx - 1)];
    const r = Math.random();
    const trips = () => {
      const s = REEL_SYMS[1 + Math.floor(Math.random() * 4)];
      return [s, s, s];
    };
    if (r < 0.03) {
      return { syms: ["7", "7", "7"], label: "JACKPOT +" + (tier.cost * 8) + " 🪙 +1 " + tier.id,
        pay: { ticket: tier.id, coins: tier.cost * 8 }, jackpot: true };
    }
    if (r < 0.55) {
      const tk = (idx > 0 && Math.random() < 0.3) ? lower.id : tier.id;
      return { syms: trips(), label: "🎟 +1 " + tk, pay: { ticket: tk } };
    }
    if (r < 0.80) {
      const coins = tier.cost * (2 + Math.floor(Math.random() * 4));
      const a = REEL_SYMS[Math.floor(Math.random() * REEL_SYMS.length)];
      return { syms: [a, a, "🪙"], label: "🪙 +" + coins, pay: { coins } };
    }
    if (r < 0.92) {
      if (Math.random() < 0.5) {
        const ammo = 3 + idx;
        return { syms: ["★", "★", "★"], label: "💥 +" + ammo + " ammo cache", pay: { ammo } };
      }
      const parts = 2 + Math.floor(idx / 2);
      return { syms: ["★", "★", "★"], label: "🧩 +" + parts + " parts cache", pay: { parts } };
    }
    if (idx >= 3) {
      return { syms: ["♦", "♦", "♦"], label: "❤ +1 max HP next run", pay: { maxHp: 1 } };
    }
    return { syms: trips(), label: "🎟 +1 " + tier.id + " (bonus)", pay: { ticket: tier.id } };
  };

  C.bankDeath = function (out) {
    const B = C.G.machine.banked;
    const pay = out.pay;
    if (pay.ticket) B.tickets[pay.ticket] = (B.tickets[pay.ticket] || 0) + 1;
    if (pay.coins) B.coins += pay.coins;
    if (pay.ammo) B.ammo += pay.ammo;
    if (pay.parts) B.parts += pay.parts;
    if (pay.maxHp) B.maxHp += pay.maxHp;
    if (out.jackpot) C.audio.jackpot();
  };

  function bankedLine(B) {
    const bits = [];
    for (const [k, v] of Object.entries(B.tickets)) if (v > 0) bits.push(v + "×" + k);
    if (B.coins) bits.push("+" + B.coins + "🪙");
    if (B.ammo) bits.push("+" + B.ammo + "💥");
    if (B.parts) bits.push("+" + B.parts + "🧩");
    if (B.maxHp) bits.push("+" + B.maxHp + "❤");
    return bits.length ? bits.join(" · ") : "nothing yet — spin!";
  }

  function renderBanked() {
    C.ui.dmBanked.textContent = "Next run: " + bankedLine(C.G.machine.banked);
  }

  function addResult(out) {
    const d = document.createElement("div");
    d.textContent = (out.jackpot ? "🎰 " : "") + out.label;
    if (out.jackpot) d.className = "dm-jackpot";
    const list = C.ui.dmResults;
    list.appendChild(d);
    list.scrollTop = list.scrollHeight;
  }

  // Arm the machine on death (or hide it under the 10s gate).
  C.armDeathMachine = function () {
    const G = C.G;
    const box = C.ui.deathMachine;
    if (G.t < 10) {
      box.classList.add("hide");
      return null;
    }
    const tier = C.deathTier(G.maxDepth || 0);
    G.machine = {
      tier, pullsLeft: C.deathPulls(G.t), spinning: false, banked: blankBanked(),
    };
    C.ui.dmTitle.textContent = "🎰 " + tier.label + " Soul Slot — " +
      G.machine.pullsLeft + " pulls (depth " + (G.maxDepth || 0) + ", " +
      C.fmtTime(G.t) + ")";
    C.ui.dmTitle.style.color = tier.color;
    for (const sn of C.ui.dmReels) sn.textContent = "?";
    C.ui.dmResults.innerHTML = "";
    C.ui.spinBtn.disabled = false;
    C.ui.spinBtn.textContent = "SPIN (Space)";
    renderBanked();
    box.classList.remove("hide");
    return G.machine;
  };

  // Returns true when a spin started (key handler should not respawn).
  C.spinDeath = function () {
    const G = C.G;
    const M = G && G.machine;
    if (!G || !G.over || !M || M.spinning || M.pullsLeft <= 0) return false;
    M.spinning = true;
    M.pullsLeft -= 1;
    C.ui.spinBtn.disabled = true;
    const out = C.deathPayout(M.tier);
    const reels = C.ui.dmReels;
    const locks = [350, 650, 950];
    const timers = [];
    reels.forEach((sn, i) => {
      timers.push(setInterval(() => {
        sn.textContent = REEL_SYMS[Math.floor(Math.random() * REEL_SYMS.length)];
      }, 60));
    });
    locks.forEach((ms, i) => {
      setTimeout(() => {
        clearInterval(timers[i]);
        reels[i].textContent = out.syms[i];
        C.audio.lock();
        if (i === locks.length - 1) {
          C.bankDeath(out);
          addResult(out);
          renderBanked();
          M.spinning = false;
          if (M.pullsLeft > 0) {
            C.ui.spinBtn.disabled = false;
            C.ui.dmTitle.textContent = "🎰 " + M.tier.label + " Soul Slot — " +
              M.pullsLeft + " pulls left";
          } else {
            C.ui.spinBtn.textContent = "CASHED OUT — respawn! (R)";
            C.ui.spinBtn.disabled = true;
          }
        }
      }, ms);
    });
    return true;
  };

  // Instantly resolve unspun pulls (R respawns through them), then hand
  // the machine's bank to the respawn (spins bank per-machine, not per-run).
  C.resolveDeathRest = function () {
    const G = C.G;
    const M = G && G.machine;
    if (!M) return;
    if (!M.spinning) {
      while (M.pullsLeft > 0) {
        M.pullsLeft -= 1;
        const out = C.deathPayout(M.tier);
        C.bankDeath(out);
        addResult(out);
      }
      renderBanked();
    }
    C.banked = M.banked;
  };

  // Respawn consumes the bank into starting resources; returns a summary.
  C.applyBanked = function (p) {
    const B = C.banked;
    if (!B) return "";
    for (const [k, v] of Object.entries(B.tickets)) {
      if (v > 0) p.tickets[k] = (p.tickets[k] || 0) + v;
    }
    p.coins += B.coins;
    p.ammo = Math.min(C.ammoMax(), p.ammo + B.ammo);
    p.parts += B.parts;
    if (B.maxHp > 0) {
      for (let i = 0; i < B.maxHp; i++) C.modStat("END", 2);
    }
    C.banked = null;
    return bankedLine(B);
  };
})(window.Casino);
