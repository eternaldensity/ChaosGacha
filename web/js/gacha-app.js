"use strict";
/* Chaos Gacha web app: mobile-first roller with ticket wallet + history. */
(function () {
  const G = window.ChaosGacha;
  const DATA = window.CHAOS_DATA || { entries: [], tiers: [], classes: [] };
  const LS = "chaosGacha.v1";
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
        d.tickets = d.tickets || []; d.history = d.history || [];
        d.settings = d.settings || { spin: "normal" };
        d.settings.filters = d.settings.filters || {};
        return d;
      }
    } catch (e) {}
    return { tickets: [], history: [], settings: { spin: "normal", filters: {} } };
  }
  function save() {
    try { localStorage.setItem(LS, JSON.stringify(DB)); }
    catch (e) { toast("Storage full.", true); }
  }
  let DB = load();
  const uid = () => Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
  let lastResult = null;

  function resultText(r) {
    const cls = G.rarityClass(DATA.classes, r.rarity);
    return `🎰 ${r.name} (${r.rarity}, ${cls.name}, ${r.category}${r.source ? ", " + r.source : ""})` +
      (r.d20 != null ? ` 🎲${r.d20} ${G.gamblerLabel({ effect: r.geffect })}` : "");
  }
  window.__gacha = window.__gacha || {};
  window.__gacha.resultText = resultText;

  // tabs
  document.querySelectorAll("#tabs button").forEach(b =>
    b.addEventListener("click", () => {
      document.querySelectorAll("#tabs button").forEach(x => x.classList.toggle("active", x === b));
      document.querySelectorAll(".tabpage").forEach(p =>
        p.classList.toggle("active", p.id === "tab-" + b.dataset.tab));
      if (b.dataset.tab === "history") renderHistory();
    }));

  // Tier button colors (sampled from the original site's tier art).
  function hexRgb(h) {
    return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  }
  function mix(h, target, amt) {
    const [r, g, b] = hexRgb(h);
    const m = (c, t) => Math.round(c + (t - c) * amt);
    return `rgb(${m(r, target[0])},${m(g, target[1])},${m(b, target[2])})`;
  }
  function tierStyle(t) {
    const base = t.color || "#555";
    const [r, g, b] = hexRgb(base);
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    const fg = lum > 0.6 ? "#1a1a1a" : "#ffffff";
    return `background:linear-gradient(180deg, ${mix(base, [255, 255, 255], 0.35)} 0%, ${base} 45%, ${mix(base, [0, 0, 0], 0.3)} 100%);` +
      `color:${fg};text-shadow:${lum > 0.6 ? "0 1px 0 rgba(255,255,255,.35)" : "0 1px 2px rgba(0,0,0,.6)"};`;
  }

  // preset + category pickers
  let preset = "gold", category = "random";
  const CATS = ["random", "ability", "item", "skill", "trait", "familiar"];

  function checkedSources() {
    return [...document.querySelectorAll(".gfCheck")]
      .filter(c => c.checked).map(c => c.value);
  }
  function refreshSources(keep) {
    const prev = keep ? checkedSources() : null;
    const host = $("gfSources");
    host.innerHTML = "";
    const FILES = ["ability", "item", "skill", "trait", "familiar"];
    const LETTER = { ability: "A", item: "I", skill: "S", trait: "T", familiar: "F" };
    const counts = {};
    for (const e of DATA.entries) {
      if (e.t === "tree" || !e.s) continue;
      if (category !== "random" && e.f !== category) continue;
      counts[e.s] = counts[e.s] || {};
      counts[e.s][e.f] = (counts[e.s][e.f] || 0) + 1;
    }
    const breakdown = s => FILES.filter(f => counts[s][f])
      .map(f => `${counts[s][f]}${LETTER[f]}`).join(", ");
    for (const s of Object.keys(counts).sort((a, b) => a.localeCompare(b))) {
      const lab = document.createElement("label");
      lab.style.cssText = "display:flex;gap:6px;align-items:center;min-height:44px;flex:1;min-width:44%;";
      lab.title = `${s}: ${breakdown(s)}`;
      const cb = document.createElement("input");
      cb.type = "checkbox"; cb.className = "gfCheck"; cb.value = s;
      cb.checked = !prev || prev.includes(s);
      cb.style.cssText = "width:22px;height:22px";
      cb.addEventListener("change", () => { refreshSrcCount(); updatePoolCount(); collectFilters(); });
      const nm = document.createElement("span");
      nm.className = "srcbreak";
      nm.textContent = `${s} [${breakdown(s)}]`;
      lab.append(cb, nm);
      host.appendChild(lab);
    }
    refreshSrcCount();
    updatePoolCount();
  }
  function refreshSrcCount() {
    const boxes = [...document.querySelectorAll(".gfCheck")];
    const n = boxes.filter(c => c.checked).length;
    $("gfCount").textContent = n === boxes.length ? "all" : `${n}/${boxes.length}`;
  }
  function collectFilters() {
    const rmin = parseFloat($("fRmin").value), rmax = parseFloat($("fRmax").value);
    const F = {
      q: $("q").value,
      sources: checkedSources(),
      rmin: isNaN(rmin) ? null : rmin,
      rmax: isNaN(rmax) ? null : rmax,
      hideNsfw: !!$("fNsfw").checked,
      hideTech: !!$("fTech").checked,
      dedup: !!$("fDedup").checked
    };
    DB.settings.filters = {
      q: F.q, sources: F.sources,
      rmin: $("fRmin").value, rmax: $("fRmax").value,
      hideNsfw: F.hideNsfw, hideTech: F.hideTech, dedup: F.dedup
    };
    save();
    return F;
  }
  function restoreFilters() {
    const F = (DB.settings && DB.settings.filters) || {};
    $("q").value = F.q || "";
    $("fRmin").value = F.rmin || "";
    $("fRmax").value = F.rmax || "";
    $("fNsfw").checked = F.hideNsfw !== false; // safe by default
    $("fTech").checked = !!F.hideTech;
    $("fDedup").checked = !!F.dedup;
    refreshSources(false);
    // legacy single-source setting -> check just that one
    const legacy = F.sources || (F.source ? [F.source] : null);
    if (legacy) {
      document.querySelectorAll(".gfCheck").forEach(c => { c.checked = legacy.includes(c.value); });
      refreshSrcCount();
    }
    updatePoolCount();
  }
  function updatePoolCount() {
    try {
      const F = {
        q: $("q").value, sources: checkedSources(),
        rmin: parseFloat($("fRmin").value) || null,
        rmax: parseFloat($("fRmax").value) || null,
        hideNsfw: !!$("fNsfw").checked, hideTech: !!$("fTech").checked
      };
      const cats = category === "random" ? CATS.slice(1) : [category];
      let n = 0;
      for (const c of cats) {
        const ql = (F.q || "").trim().toLowerCase();
        n += DATA.entries.filter(e =>
          e.f === c && e.t !== "tree" &&
          (!F.sources.length || F.sources.includes(e.s)) &&
          (F.rmin == null || e.r >= F.rmin) &&
          (F.rmax == null || e.r <= F.rmax) &&
          (!F.hideNsfw || !e.nsfw) && (!F.hideTech || !e.tech) &&
          (!ql || e.name.toLowerCase().includes(ql) || (e.s || "").toLowerCase().includes(ql))).length;
      }
      $("poolCount").textContent = `≈${n} entr${n === 1 ? "y" : "ies"} in pool.`;
    } catch (e) { /* controls not ready */ }
  }
  function renderPickers() {
    const pg = $("presetGrid");
    pg.innerHTML = "";
    for (const t of DATA.tiers) {
      const b = document.createElement("button");
      b.className = "pick" + (preset === t.name ? " sel" : "");
      b.setAttribute("style", tierStyle(t));
      b.innerHTML = `<b>${esc(t.name)}</b><br><span class="small" style="opacity:.85">⌀${t.avg}</span>`;
      b.addEventListener("click", () => {
        preset = t.name;
        $("cMin").value = t.min; $("cAvg").value = t.avg; $("cMax").value = t.max;
        renderPickers();
      });
      pg.appendChild(b);
    }
    const cg = $("catGrid");
    cg.innerHTML = "";
    for (const c of CATS) {
      const b = document.createElement("button");
      b.className = "pick" + (category === c ? " sel" : "");
      b.textContent = c === "random" ? "🎲 random" : c;
      b.addEventListener("click", () => { category = c; renderPickers(); refreshSources(true); });
      cg.appendChild(b);
    }
    $("tkTier").innerHTML = DATA.tiers.map(t => `<option>${t.name}</option>`).join("");
    $("tkCat").innerHTML = CATS.map(c => `<option>${c}</option>`).join("");
  }

  function showResult(r, keepMulti) {
    lastResult = r;
    const cls = G.rarityClass(DATA.classes, r.rarity);
    $("resultCard").style.display = "block";
    $("resultCard").style.boxShadow = `0 0 32px ${cls.color}44, var(--shadow)`;
    if (!keepMulti) $("multiCard").style.display = "none";
    $("resultBody").innerHTML =
      `<div class="small" style="color:${esc(cls.color)}">— ${esc(cls.name)} ${esc(r.category)}${r.source ? " [" + esc(r.source) + "]" : ""} —</div>` +
      `<div class="result-name"><span class="dot" style="background:${esc(cls.color)}"></span><b>${esc(r.name)}</b> · ${r.rarity}</div>` +
      `<div class="small muted">${r.odds.toFixed(2)}% odds</div>` +
      (r.d20 != null ? `<div class="small muted">🎲 Gambler d20 → ${r.d20}: ${esc(G.gamblerLabel({ effect: r.geffect }))}${r.gambleNote ? ` (${esc(r.gambleNote)})` : ""}</div>` : "") +
      (r.description ? `<p>${esc(r.description)}</p>` : "");
    $("resultCard").scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function showDestroyed(g, note) {
    lastResult = null;
    const cls = G.rarityClass(DATA.classes, 0);
    $("resultCard").style.display = "block";
    $("resultCard").style.boxShadow = "";
    $("multiCard").style.display = "none";
    $("resultBody").innerHTML =
      `<div class="result-name">💥 Ticket destroyed</div>` +
      `<div class="small muted">🎲 Gambler d20 → ${g.d20}: Destroyed. ` +
      (note || "No roll, no history entry.") + `</div>`;
    $("resultCard").scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function tierNames() { return DATA.tiers.map(t => t.name); }
  function presetNums(name) {
    const t = DATA.tiers.find(t => t.name === name);
    return t ? { min: t.min, avg: t.avg, max: t.max } : null;
  }

  function doRoll(min, max, avg, cat, ticketId, tierName) {
    if (spinning) return;
    const F = collectFilters();
    if (F.dedup) F.exclude = DB.history.map(h => h.name);
    let g = null;
    if (DB.settings.gambler) {
      g = G.gamblerApply(tierNames(), tierName || "bronze", cat);
      if (g.effect === "rankUp" || g.effect === "rankDown") {
        const pn = presetNums(g.tier);
        if (pn) { min = pn.min; avg = pn.avg; max = pn.max; }
      }
      cat = g.cat;
      if (g.effect === "destroyed") {
        if (ticketId) DB.tickets = DB.tickets.filter(t => t.id !== ticketId);
        save(); renderTickets();
        showDestroyed(g);
        return;
      }
    }
    const rollOnce = () => G.roll(DATA.entries, DATA.tiers, cat, min, max, avg, F);
    let r;
    try {
      r = rollOnce();
      if (g && g.effect === "advantage") {
        const r2 = rollOnce();
        if (r2.rarity >= r.rarity) {
          r2.gambleNote = `kept ${r2.rarity} over ${r.rarity}`;
          r = r2;
        } else {
          r.gambleNote = `kept ${r.rarity} over ${r2.rarity}`;
        }
      }
    } catch (e) { toast(e.message, true); return; }
    if (g) { r.d20 = g.d20; r.geffect = g.effect; }
    if (ticketId) DB.tickets = DB.tickets.filter(t => t.id !== ticketId);
    DB.history.unshift(Object.assign({ id: uid(), at: Date.now(), min, max, avg }, r));
    if (DB.history.length > 500) DB.history.length = 500;
    save(); renderTickets();
    const speed = (DB.settings && DB.settings.spin) || "normal";
    const reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (speed === "off" || reduced || !window.requestAnimationFrame) { showResult(r); return; }
    spinReel(r, min, max, avg, F, SPIN_SPEEDS[speed] || SPIN_SPEEDS.normal);
  }

  const SPIN_SPEEDS = {
    fast: { dur: 1200, n: 16 },
    normal: { dur: 2600, n: 30 },
    slow: { dur: 4200, n: 46 },
    slower: { dur: 6200, n: 64 }
  };
  const TRAIL_ROWS = 8; // decoys past the winner so the list end never shows
  let spinning = false;

  function spinReel(r, min, max, avg, filt, opt) {
    let items;
    try {
      items = G.drawStrip(DATA.entries, r.category, min, max, avg, filt, opt.n + TRAIL_ROWS);
    } catch (e) { showResult(r); return; }
    const winIdx = opt.n;
    items.splice(winIdx, 0, { name: r.name, rarity: r.rarity, source: r.source, category: r.category });
    const reel = $("reel"), inner = $("reelInner");
    inner.innerHTML = "";
    for (const it of items) {
      const cls = G.rarityClass(DATA.classes, it.rarity);
      const row = document.createElement("div");
      row.className = "rrow";
      row.innerHTML = `<span class="dot" style="background:${esc(cls.color)}"></span>` +
        `<span class="nm">${esc(it.name)}</span>` +
        `<span class="pill">${esc(it.category)} ${it.rarity}</span>`;
      inner.appendChild(row);
    }
    $("reelCard").style.display = "block";
    $("resultCard").style.display = "none";
    $("rollBtn").disabled = true;
    spinning = true;
    const rows = Array.from(inner.children);
    const rowh = rows.length ? rows[0].offsetHeight || 54 : 54;
    const viewH = reel.clientHeight || rowh * 5;
    const total = Math.max(0, winIdx * rowh + rowh / 2 - viewH / 2);
    const t0 = performance.now();
    let done = false;
    const finish = () => { done = true; };
    reel.onclick = finish;
    function frame(now) {
      if (done) now = t0 + opt.dur;
      const t = Math.min(1, (now - t0) / opt.dur);
      const p = 1 - Math.pow(1 - t, 4); // ease-out: fast whizz, gentle settle
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
        $("rollBtn").disabled = false;
        showResult(r);
        return;
      }
      window.requestAnimationFrame(frame);
    }
    window.requestAnimationFrame(frame);
  }

  $("rollBtn").addEventListener("click", () => {
    const min = parseFloat($("cMin").value), avg = parseFloat($("cAvg").value), max = parseFloat($("cMax").value);
    if (!(min < max) || isNaN(avg)) return toast("Need min < max and a numeric avg.", true);
    doRoll(min, max, avg, category, null, preset);
  });

  $("btnMulti").addEventListener("click", () => {
    if (spinning) return;
    const min = parseFloat($("cMin").value), avg = parseFloat($("cAvg").value), max = parseFloat($("cMax").value);
    if (!(min < max) || isNaN(avg)) return toast("Need min < max and a numeric avg.", true);
    const F = collectFilters();
    if (F.dedup) F.exclude = DB.history.map(h => h.name);
    const useGamble = !!DB.settings.gambler;
    const results = [];
    let destroyed = 0;
    try {
      for (let i = 0; i < 10; i++) {
        let mm = min, ma = avg, mx = max, cc = category, g = null;
        if (useGamble) {
          g = G.gamblerApply(tierNames(), preset, category);
          if (g.effect === "rankUp" || g.effect === "rankDown") {
            const pn = presetNums(g.tier);
            if (pn) { mm = pn.min; ma = pn.avg; mx = pn.max; }
          }
          cc = g.cat;
          if (g.effect === "destroyed") { destroyed++; continue; }
        }
        if (F.dedup) F.exclude = DB.history.map(h => h.name).concat(results.map(r => r.name));
        const rollOnce = () => G.roll(DATA.entries, DATA.tiers, cc, mm, ma, mx, F);
        let r = rollOnce();
        if (g && g.effect === "advantage") {
          const r2 = rollOnce();
          if (r2.rarity >= r.rarity) {
            r2.gambleNote = `kept ${r2.rarity} over ${r.rarity}`;
            r = r2;
          } else {
            r.gambleNote = `kept ${r.rarity} over ${r2.rarity}`;
          }
        }
        if (g) { r.d20 = g.d20; r.geffect = g.effect; }
        results.push(r);
      }
    } catch (e) { toast(e.message + (results.length ? ` (${results.length} landed first)` : ""), true); }
    if (!results.length) {
      showDestroyed({ d20: "—" }, "Gambler destroyed all ten tickets. Brutal.");
      return;
    }
    const stamped = results.map(r => Object.assign({ id: uid(), at: Date.now(), min, max, avg }, r));
    DB.history.unshift(...stamped);
    if (DB.history.length > 500) DB.history.length = 500;
    save(); renderTickets(); renderStats();
    let best = results[0];
    for (const r of results) if (r.rarity > best.rarity) best = r;
    showResult(best);
    $("multiHead").textContent = `best of ${results.length}` +
      (destroyed ? ` (${destroyed} destroyed)` : "") + ` below`;
    const ul = $("multiList");
    ul.innerHTML = "";
    results.slice().sort((a, b) => b.rarity - a.rarity).forEach(r => {
      const cls = G.rarityClass(DATA.classes, r.rarity);
      const li = document.createElement("li");
      li.innerHTML = `<div class="grow"><span class="dot" style="background:${esc(cls.color)}"></span>` +
        `<b>${esc(r.name)}</b> <span class="pill">${esc(r.category)} ${r.rarity}</span>` +
        (r === best ? ` <span class="pill" style="border-color:var(--accent);color:var(--accent)">★ best</span>` : "") +
        `<br><span class="muted small">${esc(r.source || "—")}</span></div>`;
      const b = document.createElement("button");
      b.textContent = "👁";
      b.addEventListener("click", () => showResult(r, true));
      li.appendChild(b);
      ul.appendChild(li);
    });
    $("multiCard").style.display = "block";
  });

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

  $("btnAddTicket").addEventListener("click", () => {
    DB.tickets.push({ id: uid(), tier: $("tkTier").value, cat: $("tkCat").value });
    save(); renderTickets();
  });

  function tierOf(name) { return DATA.tiers.find(t => t.name === name) || DATA.tiers[2]; }

  function renderTickets() {
    $("ticketCount").textContent = DB.tickets.length ? `(${DB.tickets.length})` : "";
    const ul = $("ticketList");
    ul.innerHTML = DB.tickets.length ? "" : "<li class='muted'>No tickets — quick-roll above, or add tickets here and spend them.</li>";
    for (const t of DB.tickets) {
      const li = document.createElement("li");
      const tp = tierOf(t.tier);
      li.innerHTML = `<div class="grow"><span class="pill" style="${esc(tierStyle(tp))}border:none">${esc(t.tier)}</span> <span class="pill">${esc(t.cat)}</span></div>`;
      const b = document.createElement("button");
      b.textContent = "Roll 🎲"; b.className = "primary";
      b.addEventListener("click", () => {
        const p = tierOf(t.tier);
        doRoll(p.min, p.max, p.avg, t.cat, t.id, t.tier);
      });
      li.appendChild(b);
      ul.appendChild(li);
    }
  }

  function renderStats() {
    const box = $("statBody");
    const h = DB.history;
    if (!h.length) { box.innerHTML = "<span class='muted'>No rolls yet.</span>"; return; }
    let best = h[0];
    const byClass = {};
    for (const r of h) {
      if (r.rarity > best.rarity) best = r;
      const cn = G.rarityClass(DATA.classes, r.rarity).name;
      byClass[cn] = (byClass[cn] || 0) + 1;
    }
    const bc = G.rarityClass(DATA.classes, best.rarity);
    box.innerHTML =
      `<div class="kv"><span class="k">Rolls</span><b>${h.length}</b></div>` +
      `<div class="kv"><span class="k">Best</span><b><span class="dot" style="background:${esc(bc.color)}"></span>${esc(best.name)} (${best.rarity})</b></div>` +
      `<div style="margin-top:4px">` +
      Object.entries(byClass).map(([k, v]) => `<span class="pill" style="margin:2px">${esc(k)}×${v}</span>`).join("") +
      `</div>`;
  }

  function renderHistory() {
    renderStats();
    $("histCount").textContent = DB.history.length ? `(${DB.history.length})` : "";
    const ul = $("histList");
    ul.innerHTML = DB.history.length ? "" : "<li class='muted'>No rolls yet.</li>";
    for (const h of DB.history.slice(0, 200)) {
      const cls = G.rarityClass(DATA.classes, h.rarity);
      const li = document.createElement("li");
      li.innerHTML = `<div class="grow"><span class="dot" style="background:${esc(cls.color)}"></span>` +
        `<b>${esc(h.name)}</b> <span class="pill">${esc(h.category)} ${h.rarity}</span>` +
        (h.d20 != null ? ` <span class="pill" title="${esc(G.gamblerLabel({ effect: h.geffect }))}">🎲${h.d20}</span>` : "") + `<br>` +
        `<span class="muted small">${esc(h.source || "—")} · ${new Date(h.at).toLocaleString()} · ${h.odds.toFixed(2)}%</span></div>`;
      const b = document.createElement("button");
      b.textContent = "👁";
      b.title = "View";
      b.addEventListener("click", () => showResult(h));
      li.appendChild(b);
      ul.appendChild(li);
    }
  }

  $("btnClearHist").addEventListener("click", () => {
    if (!DB.history.length || !confirm("Clear roll history?")) return;
    DB.history = []; save(); renderHistory();
  });
  $("btnExportHist").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify({ app: "chaos-gacha", v: 1, tickets: DB.tickets, history: DB.history })], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "chaos-gacha-history.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  });
  $("btnImportHist").addEventListener("click", () => $("fileHist").click());
  $("fileHist").addEventListener("change", async () => {
    const f = $("fileHist").files[0];
    if (!f) return;
    try {
      const p = JSON.parse(await f.text());
      if (!p || (p.app && p.app !== "chaos-gacha")) throw new Error("not a chaos-gacha file");
      DB.tickets = Array.isArray(p.tickets) ? p.tickets : [];
      DB.history = Array.isArray(p.history) ? p.history : [];
      save(); renderTickets(); renderHistory();
      toast("Imported.");
    } catch (e) { toast(e.message || "Import failed.", true); }
    $("fileHist").value = "";
  });

  renderPickers();
  $("cMin").value = 1.5; $("cAvg").value = 3.3; $("cMax").value = 5.3;
  try {
    const n = (DATA.entries || []).length;
    $("dataVer").textContent = `data v${DATA.dataVersion || "?"} · ${n} entries`;
  } catch (e) {}
  $("spinSpeed").value = (DB.settings && DB.settings.spin) || "normal";
  $("gambler").checked = !!(DB.settings && DB.settings.gambler);
  $("gambler").addEventListener("change", () => {
    DB.settings.gambler = $("gambler").checked;
    save();
  });
  $("spinSpeed").addEventListener("change", () => {
    DB.settings.spin = $("spinSpeed").value;
    save();
  });
  restoreFilters();
  $("gfAll").addEventListener("click", () => {
    document.querySelectorAll(".gfCheck").forEach(c => { c.checked = true; });
    refreshSrcCount(); updatePoolCount(); collectFilters();
  });
  $("gfNone").addEventListener("click", () => {
    document.querySelectorAll(".gfCheck").forEach(c => { c.checked = false; });
    refreshSrcCount(); updatePoolCount(); collectFilters();
  });
  $("gfExport").addEventListener("click", () => {
    const checked = new Set(checkedSources());
    const excluded = [...document.querySelectorAll(".gfCheck")]
      .map(c => c.value).filter(v => !checked.has(v)).sort();
    const blob = new Blob([JSON.stringify({
      app: "chaos-gacha", kind: "source-exclusions", version: 1, excluded
    })], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "chaos-gacha-source-exclusions.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  });
  $("gfImport").addEventListener("click", () => $("fileGfSrc").click());
  $("fileGfSrc").addEventListener("change", async () => {
    const f = $("fileGfSrc").files[0];
    if (!f) return;
    try {
      const p = JSON.parse(await f.text());
      const listed = Array.isArray(p.excluded) ? p.excluded : null;
      if (!listed) throw new Error("not a source-exclusions file");
      const known = new Set([...document.querySelectorAll(".gfCheck")].map(c => c.value));
      const valid = listed.filter(s => known.has(s));
      document.querySelectorAll(".gfCheck").forEach(c => { c.checked = !valid.includes(c.value); });
      refreshSrcCount(); updatePoolCount(); collectFilters();
      toast(`Excluded ${valid.length} source${valid.length === 1 ? "" : "s"}` +
        (listed.length > valid.length ? ` (${listed.length - valid.length} unknown ignored)` : "") + ".");
    } catch (e) { toast(e.message || "Import failed.", true); }
    $("fileGfSrc").value = "";
  });
  for (const id of ["q", "fRmin", "fRmax", "fNsfw", "fTech", "fDedup"]) {
    $(id).addEventListener("change", () => { collectFilters(); updatePoolCount(); });
    $(id).addEventListener("input", updatePoolCount);
  }
  renderTickets();
})();
