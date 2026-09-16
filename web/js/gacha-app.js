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
        return d;
      }
    } catch (e) {}
    return { tickets: [], history: [] };
  }
  function save() {
    try { localStorage.setItem(LS, JSON.stringify(DB)); }
    catch (e) { toast("Storage full.", true); }
  }
  let DB = load();
  const uid = () => Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);

  // tabs
  document.querySelectorAll("#tabs button").forEach(b =>
    b.addEventListener("click", () => {
      document.querySelectorAll("#tabs button").forEach(x => x.classList.toggle("active", x === b));
      document.querySelectorAll(".tabpage").forEach(p =>
        p.classList.toggle("active", p.id === "tab-" + b.dataset.tab));
      if (b.dataset.tab === "history") renderHistory();
    }));

  // preset + category pickers
  let preset = "gold", category = "random";
  const CATS = ["random", "ability", "item", "skill", "trait", "familiar"];
  function renderPickers() {
    const pg = $("presetGrid");
    pg.innerHTML = "";
    for (const t of DATA.tiers) {
      const b = document.createElement("button");
      b.className = "pick" + (preset === t.name ? " sel" : "");
      b.innerHTML = `<b>${esc(t.name)}</b><br><span class="small muted">⌀${t.avg}</span>`;
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
      b.addEventListener("click", () => { category = c; renderPickers(); });
      cg.appendChild(b);
    }
    $("tkTier").innerHTML = DATA.tiers.map(t => `<option>${t.name}</option>`).join("");
    $("tkCat").innerHTML = CATS.map(c => `<option>${c}</option>`).join("");
  }

  function showResult(r) {
    const cls = G.rarityClass(DATA.classes, r.rarity);
    $("resultCard").style.display = "block";
    $("resultBody").innerHTML =
      `<div class="small" style="color:${esc(cls.color)}">— ${esc(cls.name)} ${esc(r.category)}${r.source ? " [" + esc(r.source) + "]" : ""} —</div>` +
      `<div class="result-name"><span class="dot" style="background:${esc(cls.color)}"></span><b>${esc(r.name)}</b> · ${r.rarity}</div>` +
      `<div class="small muted">${r.odds.toFixed(2)}% odds</div>` +
      (r.description ? `<p>${esc(r.description)}</p>` : "");
    $("resultCard").scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function doRoll(min, max, avg, cat, ticketId) {
    let r;
    try {
      r = G.roll(DATA.entries, DATA.tiers, cat, min, max, avg, $("q").value);
    } catch (e) { toast(e.message, true); return; }
    if (ticketId) DB.tickets = DB.tickets.filter(t => t.id !== ticketId);
    DB.history.unshift(Object.assign({ id: uid(), at: Date.now(), min, max, avg }, r));
    if (DB.history.length > 500) DB.history.length = 500;
    save(); showResult(r); renderTickets();
  }

  $("rollBtn").addEventListener("click", () => {
    const min = parseFloat($("cMin").value), avg = parseFloat($("cAvg").value), max = parseFloat($("cMax").value);
    if (!(min < max) || isNaN(avg)) return toast("Need min < max and a numeric avg.", true);
    doRoll(min, max, avg, category, null);
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
      li.innerHTML = `<div class="grow"><b>${esc(t.tier)}</b> <span class="pill">${esc(t.cat)}</span></div>`;
      const b = document.createElement("button");
      b.textContent = "Roll 🎲"; b.className = "primary";
      b.addEventListener("click", () => {
        const p = tierOf(t.tier);
        doRoll(p.min, p.max, p.avg, t.cat, t.id);
      });
      li.appendChild(b);
      ul.appendChild(li);
    }
  }

  function renderHistory() {
    $("histCount").textContent = DB.history.length ? `(${DB.history.length})` : "";
    const ul = $("histList");
    ul.innerHTML = DB.history.length ? "" : "<li class='muted'>No rolls yet.</li>";
    for (const h of DB.history.slice(0, 200)) {
      const cls = G.rarityClass(DATA.classes, h.rarity);
      const li = document.createElement("li");
      li.innerHTML = `<div class="grow"><span class="dot" style="background:${esc(cls.color)}"></span>` +
        `<b>${esc(h.name)}</b> <span class="pill">${esc(h.category)} ${h.rarity}</span><br>` +
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
  renderTickets();
})();
