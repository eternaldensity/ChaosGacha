"use strict";
/* Full entry database: sortable/filterable/searchable table over every
 * gacha entry, with expandable descriptions. */
(function () {
  const DATA = window.CHAOS_DATA || { entries: [], tiers: [], classes: [] };
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const CATS = ["ability", "item", "skill", "trait", "familiar"];
  const PAGE = 200;

  function checkedSources() {
    return [...document.querySelectorAll(".eqSrc")].filter(c => c.checked).map(c => c.value);
  }

  const state = {
    sort: { key: "name", dir: 1 },
    q: "", cats: new Set(CATS),
    rmin: null, rmax: null,
    shown: PAGE
  };

  function classOf(r) {
    for (const c of DATA.classes) if (r < c.max) return c;
    return DATA.classes[DATA.classes.length - 1];
  }
  function checkedSources() {
    return [...document.querySelectorAll(".eqSrc")].filter(c => c.checked).map(c => c.value);
  }

  const COLS = [
    { key: "n", label: "#" },
    { key: "name", label: "Name" },
    { key: "f", label: "Cat" },
    { key: "r", label: "Rarity" },
    { key: "s", label: "Source" }
  ];

  function filtered() {
    const q = state.q.trim().toLowerCase();
    const srcs = checkedSources();
    return DATA.entries.filter(e =>
      state.cats.has(e.f) &&
      (!srcs.length || srcs.includes(e.s)) &&
      (state.rmin == null || e.r >= state.rmin) &&
      (state.rmax == null || e.r <= state.rmax) &&
      (!q || e.name.toLowerCase().includes(q) ||
        (e.s || "").toLowerCase().includes(q) ||
        (e.d || "").toLowerCase().includes(q)));
  }

  function renderHead() {
    const head = $("eqHead");
    head.innerHTML = "";
    for (const col of COLS) {
      const th = document.createElement("th");
      th.style.cssText = "text-align:left;padding:4px;border-bottom:1px solid var(--line);white-space:nowrap";
      const b = document.createElement("button");
      b.style.cssText = "min-height:44px;padding:6px 8px;font-size:0.85rem;";
      b.textContent = col.label + (state.sort.key === col.key ? (state.sort.dir > 0 ? " ▲" : " ▼") : "");
      b.addEventListener("click", () => {
        if (state.sort.key === col.key) state.sort.dir *= -1;
        else state.sort = { key: col.key, dir: 1 };
        state.shown = PAGE;
        render();
      });
      th.appendChild(b);
      head.appendChild(th);
    }
  }

  function val(e) {
    switch (state.sort.key) {
      case "n": return e.n;
      case "name": return e.name.toLowerCase();
      case "f": return e.f;
      case "r": return e.r;
      case "s": return (e.s || "").toLowerCase();
      default: return 0;
    }
  }

  function render() {
    renderHead();
    const body = $("eqBody");
    body.innerHTML = "";
    const rows = filtered();
    rows.sort((a, b) => {
      const va = val(a), vb = val(b);
      const d = va < vb ? -1 : va > vb ? 1 : a.n - b.n;
      return d * state.sort.dir;
    });
    $("eqCount").textContent = `${rows.length} of ${DATA.entries.length} entries (tap a row for its description)`;
    const more = $("eqMore");
    more.style.display = rows.length > state.shown ? "" : "none";
    more.textContent = `Show more (${rows.length - state.shown} remaining)`;
    for (const e of rows.slice(0, state.shown)) {
      const cls = classOf(e.r);
      const tr = document.createElement("tr");
      tr.style.cssText = "border-top:1px solid var(--line);cursor:pointer";
      tr.innerHTML =
        `<td style="padding:8px">${e.n}</td>` +
        `<td style="padding:8px"><span class="dot" style="background:${esc(cls.color)}"></span>${esc(e.name)}</td>` +
        `<td style="padding:8px">${esc(e.f)}</td>` +
        `<td style="padding:8px">${e.r}</td>` +
        `<td style="padding:8px">${esc(e.s || "—")}</td>`;
      tr.addEventListener("click", () => {
        const next = tr.nextSibling;
        if (next && next.classList && next.classList.contains("desc")) {
          next.remove();
          return;
        }
        const dr = document.createElement("tr");
        dr.className = "desc";
        const td = document.createElement("td");
        td.setAttribute("colspan", "5");
        td.style.cssText = "padding:8px 8px 12px 26px";
        td.textContent = e.d || "(no description)";
        dr.appendChild(td);
        tr.after(dr);
      });
      body.appendChild(tr);
    }
  }

  function refreshSrcCount() {
    const boxes = [...document.querySelectorAll(".eqSrc")];
    const n = boxes.filter(c => c.checked).length;
    $("eqSrcCount").textContent = n === boxes.length ? "all" : `${n}/${boxes.length}`;
  }

  // category chips + source checkboxes
  (function bootFilters() {
    const cg = $("eqCats");
    for (const c of CATS) {
      const b = document.createElement("button");
      b.className = "sel";
      b.textContent = c;
      b.addEventListener("click", () => {
        if (state.cats.has(c)) state.cats.delete(c);
        else state.cats.add(c);
        b.classList.toggle("sel", state.cats.has(c));
        state.shown = PAGE;
        render();
      });
      cg.appendChild(b);
    }
    const counts = {};
    for (const e of (DATA.entries || [])) {
      if (!e.s) continue;
      counts[e.s] = (counts[e.s] || 0) + 1;
    }
    const host = $("eqSources");
    for (const s of Object.keys(counts).sort((a, b) => a.localeCompare(b))) {
      const lab = document.createElement("label");
      lab.style.cssText = "display:flex;gap:6px;align-items:center;min-height:44px;flex:1;min-width:44%;";
      const cb = document.createElement("input");
      cb.type = "checkbox"; cb.className = "eqSrc"; cb.value = s; cb.checked = true;
      cb.style.cssText = "width:22px;height:22px";
      cb.addEventListener("change", () => { refreshSrcCount(); state.shown = PAGE; render(); });
      const nm = document.createElement("span");
      nm.textContent = `${s} (${counts[s]})`;
      lab.append(cb, nm);
      host.appendChild(lab);
    }
    refreshSrcCount();
  })();

  $("eq").addEventListener("input", () => { state.q = $("eq").value; state.shown = PAGE; render(); });
  $("eqMin").addEventListener("change", () => {
    const v = parseFloat($("eqMin").value);
    state.rmin = isNaN(v) ? null : v;
    state.shown = PAGE; render();
  });
  $("eqMax").addEventListener("change", () => {
    const v = parseFloat($("eqMax").value);
    state.rmax = isNaN(v) ? null : v;
    state.shown = PAGE; render();
  });
  $("eqAll").addEventListener("click", () => {
    document.querySelectorAll(".eqSrc").forEach(c => { c.checked = true; });
    refreshSrcCount(); state.shown = PAGE; render();
  });
  $("eqNone").addEventListener("click", () => {
    document.querySelectorAll(".eqSrc").forEach(c => { c.checked = false; });
    refreshSrcCount(); state.shown = PAGE; render();
  });
  $("eqMore").addEventListener("click", () => { state.shown += PAGE; render(); });

  try {
    const n = (DATA.entries || []).length;
    $("dataVer").textContent = `data v${DATA.dataVersion || "?"} · ${n} entries`;
  } catch (e) {}
  window.__entries = { state, filtered, render };
  render();
})();
