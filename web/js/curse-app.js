"use strict";
/* Curse Roulette web app: d20 spin -> severity -> random curse of that
 * severity, with resolve conditions and ticket rewards spendable in either
 * the gacha ticket wallet or the active Chaos Tree. Mechanics mirror the
 * original site's curse page; the tree mapping is a fork addition. */
(function () {
  const CURSES = window.CHAOS_CURSES || [];
  const E = window.ChaosEngine;
  const LS = "chaosCurse.v1";
  const GLS = "chaosGacha.v1";
  const TLS = "chaosTree.v1";
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  function toast(msg, isErr) {
    const t = $("toast");
    t.textContent = msg;
    t.className = "toast" + (isErr ? " err" : "");
    t.style.display = "block";
    clearTimeout(t._h);
    t._h = setTimeout(() => { t.style.display = "none"; }, 3000);
  }

  function load() {
    try {
      const raw = localStorage.getItem(LS);
      if (raw) {
        const d = JSON.parse(raw);
        d.history = d.history || [];
        d.settings = d.settings || {};
        return d;
      }
    } catch (e) {}
    return { history: [], settings: {} };
  }
  function save() {
    try { localStorage.setItem(LS, JSON.stringify(DB)); }
    catch (e) { toast("Storage full.", true); }
  }
  let DB = load();
  if (DB.settings.reward === undefined) DB.settings.reward = true;
  if (DB.settings.target === undefined) DB.settings.target = "gacha";
  if (DB.settings.spin === undefined) DB.settings.spin = "normal";
  if (DB.settings.nsfw === undefined) DB.settings.nsfw = true; // safe by default
  const uid = () => Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
  let lastResult = null;
  let spinning = false;

  function tierOf(roll) {
    if (roll <= 6) return "Minor";
    if (roll <= 13) return "Medium";
    if (roll <= 17) return "Major";
    if (roll <= 19) return "Severe";
    return "Ultimate";
  }
  function rewardTarget() {
    return DB.settings.target === "tree" ? "tree" : "gacha";
  }

  // Gacha tickets per the reference table. Medium is one Advantage ticket
  // (roll two wheels, keep whichever you prefer); Major/Ultimate let the
  // roller pick the category.
  function gachaRewardFor(tier, cat) {
    cat = cat || "random";
    if (tier === "Minor") return [{ tier: "gold", cat: "random" }];
    if (tier === "Medium") return [{ tier: "gold", cat: "random", adv: 2 }];
    if (tier === "Major") return [{ tier: "gold", cat }];
    if (tier === "Severe") return [{ tier: "platinum", cat: "random" }];
    return [{ tier: "platinum", cat }];
  }

  // Tree tickets. These are the tree-engine's own movement tickets, not
  // gacha reward tickets: each also pays the tier's points and 1 core when
  // awarded to the active tree. Major/Ultimate use Choice N Jump so the
  // player can pick among the nearest nodes; skip N covers the lower tiers.
  function treeRewardFor(tier) {
    if (tier === "Minor") return [{ kind: "skip", tier: "gold", n: 2 }];
    if (tier === "Medium") return [{ kind: "skip", tier: "gold", n: 3 }];
    if (tier === "Major") return [{ kind: "choice", tier: "gold", n: 3 }];
    if (tier === "Severe") return [{ kind: "skip", tier: "platinum", n: 4 }];
    return [{ kind: "choice", tier: "platinum", n: 4 }];
  }

  function rewardFor(tier, cat, target) {
    return (target || "gacha") === "tree"
      ? treeRewardFor(tier)
      : gachaRewardFor(tier, cat);
  }

  // Human-readable gacha reward line, e.g. "gold random (2× Advantage)".
  function ticketLabel(t) {
    return `${t.tier} ${t.cat}` + ((t.adv | 0) > 1 ? ` (${t.adv}× Advantage)` : "");
  }
  function treeActionLabel(t) {
    let action = `${t.tier} ${t.kind}`;
    if (t.kind === "skip" || t.kind === "choice") action += ` ${t.n}`;
    if (t.kind === "choice") action += " jump";
    return action;
  }
  // Tree reward line, including the wallet payout that E.award attaches.
  function treeTicketLabel(t) {
    const pts = E ? (E.TIER_POINTS[t.tier] || 0) : 0;
    return `${treeActionLabel(t)} (tree: +${E ? E.fmt(pts) : pts} pts, +1 core)`;
  }
  function rewardLabel(t, target) {
    return target === "tree" ? treeTicketLabel(t) : ticketLabel(t);
  }
  function treeSpec(t) {
    if (t.kind === "skip") return `${t.tier} skip${t.n}`;
    if (t.kind === "choice") return `${t.tier} choice ${t.n} jump`;
    return `${t.tier} ${t.kind}`;
  }

  // The tree app stores all of its trees and progress in one localStorage
  // record. Read it fresh on every send so a tree created/opened in another
  // tab is picked up without a reload.
  function activeTreeInfo() {
    let db;
    try {
      db = JSON.parse(localStorage.getItem(TLS) || "null");
    } catch (e) {
      return { error: "The Chaos Tree save is unreadable; open the tree app and export a backup." };
    }
    if (!db || !Array.isArray(db.trees) || !db.trees.length) {
      return { error: "No Chaos Tree found. Open the tree app and create or import a tree first." };
    }
    const tree = db.trees.find(t => t.id === db.activeId) || db.trees[0];
    if (!tree) return { error: "No active Chaos Tree found." };
    return { db, tree };
  }
  function updateTargetNote() {
    const note = $("rewardTargetNote");
    if (!note) return;
    if (rewardTarget() !== "tree") {
      note.textContent = "Tickets go to the gacha wallet.";
      return;
    }
    const info = activeTreeInfo();
    note.textContent = info.error || `Active tree: ${info.tree.name}`;
  }
  // Award tree tickets through the real tree engine, so the same tier
  // points/cores/inventory rules apply as awarding them in the tree app.
  function sendTreeReward(r) {
    if (!E) throw new Error("The Chaos Tree engine failed to load; reload the page.");
    const info = activeTreeInfo();
    if (info.error) throw new Error(info.error);
    const db = info.db, tree = info.tree;
    db.states = db.states || {};
    const state = db.states[tree.id] || E.newState();
    state.points = Number(state.points) || 0;
    state.cores = Number(state.cores) || 0;
    state.inventory = Array.isArray(state.inventory) ? state.inventory : [];
    let pts = 0, cores = 0;
    for (const t of (r.reward || [])) {
      const out = E.award(state, treeSpec(t), 0, false, false, null);
      pts += out.pts;
      cores += out.cores;
    }
    db.states[tree.id] = state;
    if (db.activeId !== tree.id) db.activeId = tree.id;
    localStorage.setItem(TLS, JSON.stringify(db));
    return { tree, pts, cores };
  }
  function refreshReward() {
    if (!lastResult || lastResult.sent) return;
    const target = rewardTarget();
    lastResult.target = target;
    lastResult.reward = rewardFor(lastResult.tier, $("rewardCat").value, target);
    const line = $("rewardLine");
    if (line) line.textContent = lastResult.reward.map(t => rewardLabel(t, target)).join(" + ");
    save();
    updateRewardUI();
  }

  function nsfwHidden() { return DB.settings.nsfw !== false; }
  function cursePool() {
    return nsfwHidden() ? CURSES.filter(c => !c.nsfw) : CURSES;
  }

  function pickCurse(roll, rnd, list) {
    rnd = rnd || Math.random;
    const src = (list && list.length) ? list : CURSES;
    let cands = src.filter(c => c.sev === roll);
    if (!cands.length) {
      let best = Infinity;
      for (const c of src) best = Math.min(best, Math.abs(c.sev - roll));
      cands = src.filter(c => Math.abs(c.sev - roll) === best);
    }
    return cands[Math.floor(rnd() * cands.length)];
  }

  // Decoys for the spin strip: variety only, never the winner and never the
  // same curse twice in a row (or within the last few rows). Mirrors the
  // gacha strip: `count` rows before the winner plus TRAIL_ROWS past it so
  // the end of the list never scrolls into view.
  const TRAIL_ROWS = 8;
  function buildStrip(winner, count, list) {
    const pool = list.filter(c => c.label !== winner.label);
    const total = count + TRAIL_ROWS;
    const decoys = [];
    let guard = 0;
    while (decoys.length < total && guard++ < total * 40 && pool.length) {
      const c = pool[Math.floor(Math.random() * pool.length)];
      if (decoys.slice(-3).some(it => it.label === c.label)) continue;
      decoys.push(c);
    }
    while (decoys.length < total) decoys.push(pool[decoys.length % pool.length] || winner);
    decoys.splice(count, 0, winner);
    return decoys;
  }

  function rewardsOn() { return DB.settings.reward !== false; }
  function updateRewardUI() {
    if (!lastResult) return;
    const target = rewardTarget();
    const choice = target === "gacha" &&
      (lastResult.tier === "Major" || lastResult.tier === "Ultimate");
    $("rewardRow").style.display = (rewardsOn() && choice) ? "flex" : "none";
    $("rewardBtn").style.display = rewardsOn() ? "" : "none";
    $("rewardBtn").disabled = !!lastResult.sent;
    $("rewardBtn").textContent = lastResult.sent
      ? "Reward sent ✓"
      : (target === "tree" ? "Send reward to active tree" : "Send reward to ticket wallet");
    updateTargetNote();
  }

  function showResult(r) {
    lastResult = r;
    r.target = rewardTarget();
    r.reward = rewardFor(r.tier, $("rewardCat").value, r.target);
    save(); // showResult may re-target a result stored before the wheel stopped
    $("resultCard").style.display = "block";
    $("resultBody").innerHTML =
      `<div class="small muted">d20 = ${r.roll}: ${esc(r.tier)}</div>` +
      `<div class="result-name"><b>${esc(r.label)}</b> <span class="pill">severity ${r.sev}</span></div>` +
      (r.desc ? `<p>${esc(r.desc)}</p>` : "") +
      (r.resolve ? `<p class="small"><b>Resolve:</b> ${esc(r.resolve)}</p>` : "") +
      `<p class="small muted">Reward: <span id="rewardLine">${r.reward.map(t => rewardLabel(t, r.target)).join(" + ")}</span></p>`;
    updateRewardUI();
    $("resultCard").scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  const SPIN_SPEEDS = {
    fast: { dur: 1200, n: 16 },
    normal: { dur: 2600, n: 30 },
    slow: { dur: 4200, n: 46 },
    slower: { dur: 6200, n: 64 }
  };
  function spin() {
    if (spinning || !CURSES.length) return;
    const list = cursePool();
    if (!list.length) { toast("No curses match the current filter.", true); return; }
    const speed = (DB.settings && DB.settings.spin) || "normal";
    const opt = SPIN_SPEEDS[speed] || SPIN_SPEEDS.normal;
    const roll = 1 + Math.floor(Math.random() * 20);
    const tier = tierOf(roll);
    const winner = pickCurse(roll, null, list);
    const items = speed === "off" ? null : buildStrip(winner, opt.n, list);
    const reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const r = {
      id: uid(), at: Date.now(), roll, tier,
      label: winner.label, sev: winner.sev, desc: winner.desc, resolve: winner.resolve,
      target: rewardTarget(),
      reward: rewardFor(tier, $("rewardCat").value, rewardTarget()), resolved: false
    };
    DB.history.unshift(r);
    if (DB.history.length > 200) DB.history.length = 200;
    save(); renderHistory();
    if (speed === "off" || reduced || !window.requestAnimationFrame) { showResult(r); return; }
    spinReel(r, items, opt);
  }

  function spinReel(r, items, opt) {
    const reel = $("reel"), inner = $("reelInner");
    inner.innerHTML = "";
    for (const it of items) {
      const row = document.createElement("div");
      row.className = "rrow";
      row.innerHTML = `<span class="nm">${esc(it.label)}</span>` +
        `<span class="pill">severity ${it.sev}</span>`;
      inner.appendChild(row);
    }
    $("reelCard").style.display = "block";
    $("resultCard").style.display = "none";
    $("spinBtn").disabled = true;
    spinning = true;
    const rows = Array.from(inner.children);
    const rowh = rows.length ? rows[0].offsetHeight || 54 : 54;
    const viewH = reel.clientHeight || rowh * 5;
    const winIdx = opt.n;
    const total = Math.max(0, winIdx * rowh + rowh / 2 - viewH / 2);
    const t0 = performance.now();
    let done = false;
    reel.onclick = () => { done = true; };
    function frame(now) {
      if (done) now = t0 + opt.dur;
      const t = Math.min(1, (now - t0) / opt.dur);
      const p = 1 - Math.pow(1 - t, 4);
      const off = total * p;
      inner.style.transform = `translateY(${-off}px)`;
      for (let i = 0; i < rows.length; i++) {
        const center = i * rowh + rowh / 2 - off;
        const d = Math.min(1, Math.abs(center - viewH / 2) / (viewH / 2));
        rows[i].style.transform = `scaleY(${(1 - 0.6 * Math.pow(d, 1.3)).toFixed(3)})`;
        rows[i].style.opacity = (1 - 0.8 * Math.pow(d, 1.5)).toFixed(3);
      }
      if (t >= 1) {
        rows[winIdx].classList.add("winner");
        reel.onclick = null;
        spinning = false;
        $("spinBtn").disabled = false;
        showResult(r);
        return;
      }
      window.requestAnimationFrame(frame);
    }
    window.requestAnimationFrame(frame);
  }

  $("spinBtn").addEventListener("click", spin);

  $("rewardToggle").checked = rewardsOn();
  $("rewardToggle").addEventListener("change", () => {
    DB.settings.reward = $("rewardToggle").checked;
    save();
    updateRewardUI();
  });

  $("rewardTarget").value = rewardTarget();
  $("rewardTarget").addEventListener("change", () => {
    DB.settings.target = $("rewardTarget").value === "tree" ? "tree" : "gacha";
    save();
    updateTargetNote();
    refreshReward();
    updateRewardUI();
  });
  $("rewardCat").addEventListener("change", refreshReward);
  window.addEventListener("focus", updateTargetNote);
  updateTargetNote();

  $("spinSpeed").value = DB.settings.spin || "normal";
  $("spinSpeed").addEventListener("change", () => {
    DB.settings.spin = $("spinSpeed").value;
    save();
  });

  $("fNsfw").checked = nsfwHidden();
  $("fNsfw").addEventListener("change", () => {
    DB.settings.nsfw = $("fNsfw").checked;
    save();
  });

  $("rewardBtn").addEventListener("click", () => {
    if (!lastResult || lastResult.sent) return;
    const target = lastResult.target || rewardTarget();
    if (target === "tree") {
      try {
        const res = sendTreeReward(lastResult);
        lastResult.sent = true;
        save();
        updateRewardUI();
        const labels = lastResult.reward.map(treeActionLabel).join(" + ");
        toast(`Sent ${labels} to "${res.tree.name}": +${res.cores} core${res.cores === 1 ? "" : "s"}, +${E.fmt(res.pts)} pts.`);
      } catch (e) {
        toast(e && e.message ? e.message : "Couldn't send the reward to the tree.", true);
      }
      return;
    }
    let gdb;
    try {
      gdb = JSON.parse(localStorage.getItem(GLS) || "null") ||
        { tickets: [], history: [], settings: { spin: "normal", filters: {} } };
    } catch (e) {
      gdb = { tickets: [], history: [], settings: { spin: "normal", filters: {} } };
    }
    gdb.tickets = gdb.tickets || [];
    for (const t of lastResult.reward) {
      const ticket = { id: uid(), tier: t.tier, cat: t.cat };
      if ((t.adv | 0) > 1) ticket.adv = t.adv;
      gdb.tickets.push(ticket);
    }
    try {
      localStorage.setItem(GLS, JSON.stringify(gdb));
    } catch (e) {
      toast("Couldn't save the tickets (storage full).", true);
      return;
    }
    lastResult.sent = true;
    save();
    updateRewardUI();
    toast(`Sent ${lastResult.reward.length} ticket${lastResult.reward.length === 1 ? "" : "s"} to your wallet.`);
  });

  function resultText(r) {
    const target = r.target || "gacha";
    return `${r.label}\n(${r.tier}, d20 ${r.roll}, severity ${r.sev})` +
      (r.desc ? `\n${r.desc}` : "") +
      (r.resolve ? `\nResolve: ${r.resolve}` : "") +
      (r.reward && r.reward.length
        ? `\nReward: ${r.reward.map(t => rewardLabel(t, target)).join(" + ")}` +
          (target === "tree" ? " → active tree" : "")
        : "");
  }

  $("btnCopy").addEventListener("click", async () => {
    if (!lastResult) return;
    const t = resultText(lastResult);
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(t);
      } else {
        const ta = document.createElement("textarea");
        ta.value = t;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
      }
      toast("Copied!");
    } catch (e) { toast("Copy failed.", true); }
  });

  function renderHistory() {
    const ul = $("histList");
    ul.innerHTML = DB.history.length ? "" : "<li class='muted'>No curses yet.</li>";
    $("histCount").textContent = DB.history.length ? `(${DB.history.length})` : "";
    for (const h of DB.history.slice(0, 100)) {
      const li = document.createElement("li");
      li.innerHTML = `<div class="grow"><b>${esc(h.label)}</b> ` +
        `<span class="pill">${esc(h.tier)} · d20 ${h.roll}</span><br>` +
        `<span class="muted small">${h.resolved ? "✓ resolved" : (h.resolve ? esc(h.resolve) : "no resolve condition")}</span></div>`;
      const b = document.createElement("button");
      b.textContent = h.resolved ? "↺" : "✓";
      b.title = h.resolved ? "Mark unresolved" : "Mark resolved";
      b.addEventListener("click", () => {
        h.resolved = !h.resolved;
        save(); renderHistory();
      });
      li.appendChild(b);
      ul.appendChild(li);
    }
  }

  $("btnClearHist").addEventListener("click", () => {
    if (!DB.history.length || !confirm("Clear curse history?")) return;
    DB.history = []; save(); renderHistory();
  });

  window.__curse = {
    tierOf, pickCurse, rewardFor, treeRewardFor, treeSpec, treeActionLabel,
    rewardTarget, activeTreeInfo, resultText, nsfwHidden, cursePool
  };
  renderHistory();
})();
