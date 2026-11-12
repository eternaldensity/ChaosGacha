"use strict";
// Real-interface test: boots the actual pages in jsdom and drives the tag UI
// (entries chips/search/tooltips, gacha tag filter + tagged tickets).
// Usage: node tools/web_tags_test.cjs
const fs = require("fs");
const path = require("path");
const http = require("http");
const { spawn } = require("child_process");
const { JSDOM, VirtualConsole } = require("jsdom");

const REPO = path.resolve(__dirname, "..");
const DATA_VERSION = (fs.readFileSync(
  path.join(REPO, "web", "data", "entries.js"), "utf8")
  .match(/"dataVersion":"([^"]+)"/) || [])[1];
const PORT = 8151;
const BASE = `http://127.0.0.1:${PORT}/`;
let failures = 0;
function ok(name, cond, extra) {
  if (cond) console.log(`ok ${name}`);
  else { failures++; console.log(`FAIL ${name}${extra ? ": " + extra : ""}`); }
}

// The pages read localStorage, so serve them over HTTP like production
// (file:// is an opaque origin and jsdom refuses localStorage there).
function startServer() {
  const proc = spawn("python3", ["-m", "http.server", String(PORT)],
    { cwd: path.join(REPO, "web"), stdio: "ignore" });
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 8000;
    (function ping() {
      http.get(BASE + "entries.html", res => {
        res.resume();
        resolve(proc);
      }).on("error", () => {
        if (Date.now() > deadline) reject(new Error("web server did not start"));
        else setTimeout(ping, 150);
      });
    })();
  });
}

function boot(page, seed, fetchPayload) {
  const vc = new VirtualConsole();
  const errors = [];
  // jsdom has no canvas backend; the tree 3D view logs that on boot.
  vc.on("jsdomError", e => {
    if (!/getContext/.test(e.message)) errors.push(e.message);
  });
  vc.on("error", e => errors.push(String(e)));
  const file = page.split("?")[0];
  const dom = new JSDOM(fs.readFileSync(path.join(REPO, "web", file), "utf8"), {
    url: BASE + page, runScripts: "dangerously", resources: "usable",
    pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      if (seed) for (const [k, v] of Object.entries(seed)) w.localStorage.setItem(k, v);
      if (fetchPayload) {
        w.fetch = async () => ({
          ok: true, headers: { get: () => "application/json" },
          text: async () => JSON.stringify(fetchPayload),
        });
      }
      // jsdom has no canvas backend: give the 3D view a no-op 2D context so
      // an active tree can boot and draw without throwing.
      const noop = () => {};
      // jsdom has no layout either; pages scroll results into view.
      w.Element.prototype.scrollIntoView = noop;
      const ctx = new Proxy({}, {
        get: (t, k) => (k in t ? t[k] : noop),
        set: (t, k, v) => { t[k] = v; return true; },
      });
      w.HTMLCanvasElement.prototype.getContext = () => ctx;
      if (!w.Path2D) {
        w.Path2D = class { constructor() {} moveTo() {} lineTo() {} arc() {} closePath() {} };
      }
    },
  });
  return new Promise(resolve => {
    dom.window.addEventListener("load", () => resolve({ dom, errors }));
  });
}

(async () => {
  const server = await startServer();
  try {
  // ---------- entries page ----------
  {
    const { dom, errors } = await boot("entries.html");
    const w = dom.window, d = w.document;
    ok("entries: no page errors", errors.length === 0, errors[0]);
    ok("entries: data loaded", (w.CHAOS_DATA && w.CHAOS_DATA.entries || []).length > 4000);
    ok("entries: tag docs loaded", w.CHAOS_TAGS && Object.keys(w.CHAOS_TAGS).length === 5);
    ok("entries: railway tag doc loaded",
      (w.CHAOS_TAGS.item || []).some(t => t.tag === "railway" && t.desc));
    ok("entries: railway tag has the curated 32 entries",
      w.CHAOS_DATA.tagCounts.railway === 32, String(w.CHAOS_DATA.tagCounts.railway));

    const chips = [...d.querySelectorAll("#eqTags button")];
    ok("entries: chips rendered", chips.length > 20, String(chips.length));

    // pick a chip for a tag we can verify against the data
    const data = w.CHAOS_DATA.entries;
    const wantTag = "fire";
    const hold = data.filter(e => (e.tags || []).includes(wantTag)).length;
    ok("entries: fire entries exist", hold > 50, String(hold));
    const chip = chips.find(b => b.textContent.startsWith(wantTag + " "));
    ok("entries: fire chip present", !!chip);
    const before = d.getElementById("eqCount").textContent;
    chip.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    const after = d.getElementById("eqCount").textContent;
    const shown = parseInt(after.split(" ")[0], 10);
    ok("entries: chip filter narrows", shown > 0 && shown < data.length, after);
    ok("entries: count mentions tag", /tags: fire/.test(after), after);
    ok("entries: before/after differ", before !== after);

    // rendered rows all carry the tag, and pills show dictionary tooltips
    const rows = [...d.querySelectorAll("#eqBody tr")].slice(0, 25);
    const nameOf = tr => tr.children[1] ? tr.children[1].textContent.trim() : "";
    const allTagged = rows.every(tr => {
      const nm = nameOf(tr).replace(/\s*📋$/, "").trim();
      const e = data.find(x => x.name === nm);
      return e && (e.tags || []).includes(wantTag);
    });
    ok("entries: every shown row carries the tag", allTagged);
    const pills = [...d.querySelectorAll("#eqBody td .pill[title]")];
    ok("entries: pills carry dictionary tooltips", pills.length > 0,
      String(pills.length));
    const titleOk = pills.slice(0, 5).every(p => p.title.length > 10);
    ok("entries: tooltip text is a real description", titleOk,
      pills[0] && pills[0].title);

    // Copy buttons live in their own table column so they line up vertically
    // instead of sitting after each (different-length) entry name.
    const headCells = [...d.querySelectorAll("#eqHead th")];
    ok("entries: copy column has a header",
      headCells.length === 7 && /📋/.test(headCells[2].textContent),
      headCells.map(th => th.textContent).join("|"));
    const dataRows = [...d.querySelectorAll("#eqBody tr:not(.desc)")].slice(0, 20);
    ok("entries: every row has the copy column",
      dataRows.length > 0 && dataRows.every(tr => tr.children.length === 7));
    ok("entries: copy buttons share one column",
      dataRows.every(tr => tr.children[2].querySelector("button") &&
        /📋/.test(tr.children[2].textContent)));
    ok("entries: name cell no longer holds the copy button",
      dataRows.every(tr => !tr.children[1].querySelector("button")));
    dataRows[0].dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    const desc = dataRows[0].nextElementSibling;
    ok("entries: expanded description spans the copy column",
      desc && desc.classList.contains("desc") &&
      desc.querySelector("td").getAttribute("colspan") === "7",
      desc && desc.querySelector("td") && desc.querySelector("td").getAttribute("colspan"));

    // The fork-only railway tag has a custom dictionary entry and 32 entries.
    const railQ = d.getElementById("eqTagQ");
    railQ.value = "railway";
    railQ.dispatchEvent(new w.Event("input", { bubbles: true }));
    const railChip = [...d.querySelectorAll("#eqTags button")]
      .find(b => b.textContent.startsWith("railway "));
    ok("entries: railway chip found by search", !!railChip,
      [...d.querySelectorAll("#eqTags button")].map(b => b.textContent).join(","));
    if (railChip) railChip.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    const railPill = [...d.querySelectorAll("#eqBody td .pill[title]")]
      .find(p => /railway/i.test(p.title));
    ok("entries: railway pill carries its doc", !!railPill,
      railPill && railPill.title);

    // tag search narrows the chip list
    const chipQ = d.getElementById("eqTagQ");
    chipQ.value = "anti-";
    chipQ.dispatchEvent(new w.Event("input", { bubbles: true }));
    const anti = [...d.querySelectorAll("#eqTags button")];
    ok("entries: tag search filters chips",
      anti.length > 0 && anti.every(b => b.textContent.startsWith("anti-")),
      anti.map(b => b.textContent).join(","));
    dom.window.close();
  }

  // ---------- gacha page ----------
  {
    const { dom, errors } = await boot("gacha.html");
    const w = dom.window, d = w.document;
    ok("gacha: no page errors", errors.length === 0, errors[0]);
    const opts = [...d.querySelectorAll("#fTag option")].map(o => o.value);
    ok("gacha: tag filter lists tags", opts.length > 50, String(opts.length));
    ok("gacha: filter includes official names",
      opts.includes("fire") && opts.includes("fire+") && opts.includes("anti-dragon"));
    ok("gacha: filter includes railway", opts.includes("railway"));

    // roll with a tag selected -> result must carry that tag (spin off so the
    // result renders immediately instead of after the wheel animation)
    d.getElementById("spinSpeed").value = "off";
    d.getElementById("spinSpeed").dispatchEvent(new w.Event("change", { bubbles: true }));
    d.getElementById("fTag").value = "holy";
    d.getElementById("rollBtn").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    const body = d.getElementById("resultBody").textContent;
    ok("gacha: tagged roll produced a result", /holy/.test(body), body.slice(0, 80));
    ok("gacha: result pill shows the tag", /🏷 holy/.test(d.getElementById("resultBody").innerHTML));
    const histTags = JSON.parse(w.localStorage.getItem("chaosGacha.v1") || "{}");
    const entryOf = h => (w.CHAOS_DATA.entries || [])
      .find(e => e.f === h.f && e.n === h.n);
    const h0 = (histTags.history || [])[0] || {};
    const e0 = entryOf(h0);
    ok("gacha: history entry carries the tag",
      !!e0 && (e0.tags || []).includes("holy"), JSON.stringify(h0).slice(0, 120));
    ok("gacha: history stores identity, not entry text",
      h0.f != null && h0.n != null &&
      !("name" in h0) && !("description" in h0) && !("tags" in h0),
      JSON.stringify(h0).slice(0, 120));

    // a ticket carrying a tag rolls only that tag
    d.getElementById("tkTier").value = "legendary";
    d.getElementById("tkTag").value = "draconic";
    d.getElementById("btnAddTicket").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    ok("gacha: ticket added with tag pill",
      /🏷 draconic/.test(d.getElementById("ticketList").innerHTML));
    const rollBtns = [...d.querySelectorAll("#ticketList button")];
    rollBtns[rollBtns.length - 1].dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    const ticketHtml = d.getElementById("resultBody").innerHTML;
    ok("gacha: tagged ticket rolls tagged entry", /🏷 draconic/.test(ticketHtml),
      ticketHtml.slice(0, 140));
    const hist2 = JSON.parse(w.localStorage.getItem("chaosGacha.v1") || "{}");
    ok("gacha: tagged ticket history is tagged",
      (hist2.history || []).some(h => {
        const e = entryOf(h);
        return !!e && (e.tags || []).includes("draconic");
      }),
      JSON.stringify((hist2.history || [])[0] || {}).slice(0, 120));
    ok("gacha: ticket was spent",
      (hist2.tickets || []).length === 0, JSON.stringify(hist2.tickets));

    // a tag the chosen tier cannot reach reports a clear error (no silent roll)
    d.getElementById("tkTier").value = "trash";
    d.getElementById("tkTag").value = "draconic";
    d.getElementById("btnAddTicket").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    const before3 = (JSON.parse(w.localStorage.getItem("chaosGacha.v1") || "{}").history || []).length;
    const btns3 = [...d.querySelectorAll("#ticketList button")];
    btns3[btns3.length - 1].dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    const after3 = (JSON.parse(w.localStorage.getItem("chaosGacha.v1") || "{}").history || []).length;
    ok("gacha: impossible tag+tier shows a toast",
      /no entries match|matches nothing/.test(d.getElementById("toast").textContent),
      d.getElementById("toast").textContent);
    ok("gacha: impossible roll adds no history", after3 === before3);

    // a tag with no entries in the chosen category reports a clear error
    d.getElementById("fTag").value = "";
    const catBtn = [...d.querySelectorAll("#catGrid button")].find(b => b.textContent === "skill");
    catBtn.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    const skillOpts = [...d.querySelectorAll("#fTag option")].map(o => o.value);
    // official tags are per category: skill's own tags appear, familiar-only
    // tags (medium-size) do not. Curated elemental themes still ride along.
    ok("gacha: filter is category-aware (skill)",
      skillOpts.includes("expertise") && !skillOpts.includes("medium-size"),
      skillOpts.slice(0, 8).join(","));
    dom.window.close();
  }

  // ---------- gacha history: identity, migration, removal, copy ----------
  {
    const oldRow = {
      id: "h1", at: Date.now(), min: 1.5, max: 5.3, avg: 3.3,
      name: "Tinder", category: "ability", rarity: 1.3, source: "Generic",
      description: "an old stored description", tags: ["fire"],
      meta: [], odds: 1.23, pull: 1.3,
    };
    const db = JSON.stringify({ tickets: [], history: [oldRow], settings: {} });
    const { dom, errors } = await boot("gacha.html", { "chaosGacha.v1": db });
    const w = dom.window, d = w.document;
    ok("gacha history: no page errors", errors.length === 0, errors[0]);
    const saved = JSON.parse(w.localStorage.getItem("chaosGacha.v1") || "{}");
    const h0 = (saved.history || [])[0] || {};
    ok("gacha history: legacy rows migrate to identity",
      h0.f === "ability" && h0.n === 1 && !("description" in h0),
      JSON.stringify(h0).slice(0, 140));

    d.querySelector('#tabs [data-tab="history"]')
      .dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    const rowText = d.getElementById("histList").textContent;
    ok("gacha history: migrated row renders live data",
      /Tinder/.test(rowText) && !/an old stored description/.test(rowText),
      rowText.slice(0, 120));

    // copy all: formatted pull list in the current data
    let copied = "";
    Object.defineProperty(w.navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (t) => { copied = t; } },
    });
    d.getElementById("btnCopyHist")
      .dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    await new Promise(r => setTimeout(r, 20));
    ok("gacha history: copy-all produces the formatted list",
      /Tinder/.test(copied) && /\(1\.3, Common, ability, Generic, #fire\)/.test(copied),
      copied.slice(0, 140));

    // per-row removal
    w.confirm = () => true;
    const del = d.querySelector('#histList button[title="Remove from history"]');
    ok("gacha history: row has a remove button", !!del);
    if (del) del.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    const after = JSON.parse(w.localStorage.getItem("chaosGacha.v1") || "{}");
    ok("gacha history: individual row removal", (after.history || []).length === 0,
      String((after.history || []).length));

    // importing an old wallet migrates its full rows to identity
    const payload = { app: "chaos-gacha", v: 1, tickets: [], history: [oldRow] };
    const file = new w.File([JSON.stringify(payload)], "hist.json",
      { type: "application/json" });
    const finput = d.getElementById("fileHist");
    Object.defineProperty(finput, "files", { value: [file], configurable: true });
    finput.dispatchEvent(new w.Event("change", { bubbles: true }));
    await new Promise(r => setTimeout(r, 100));
    const imported = JSON.parse(w.localStorage.getItem("chaosGacha.v1") || "{}");
    ok("gacha history: importing an old wallet migrates rows",
      (imported.history || []).length === 1 &&
      imported.history[0].f === "ability" && imported.history[0].n === 1 &&
      !("description" in imported.history[0]),
      JSON.stringify((imported.history || [])[0] || {}).slice(0, 140));
    dom.window.close();
  }

  // ---------- history sort order ----------
  {
    const rows = [
      { id: "h2", at: 2, min: 1.5, max: 5.3, avg: 3.3, f: "ability", n: 2, odds: 1, pull: 2 },
      { id: "h1", at: 1, min: 1.5, max: 5.3, avg: 3.3, f: "ability", n: 1, odds: 1, pull: 1 },
    ];
    const db = JSON.stringify({ tickets: [], history: rows, settings: {} });
    const { dom } = await boot("gacha.html", { "chaosGacha.v1": db });
    const w = dom.window, d = w.document;
    d.querySelector('#tabs [data-tab="history"]')
      .dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    let copied = "";
    Object.defineProperty(w.navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (t) => { copied = t; } },
    });
    const copy = async () => {
      copied = "";
      d.getElementById("btnCopyHist")
        .dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
      await new Promise(r => setTimeout(r, 20));
      return copied;
    };
    const order = () => [...d.querySelectorAll("#histList b")].map(b => b.textContent);
    ok("history sort: newest first by default",
      order()[0] === "Ember" && order()[1] === "Tinder", order().join(","));
    copied = await copy();
    ok("history sort: copy respects newest first",
      copied.indexOf("Ember\n") < copied.indexOf("Tinder\n"), copied.slice(0, 80));
    const sel = d.getElementById("histSort");
    sel.value = "old"; sel.dispatchEvent(new w.Event("change", { bubbles: true }));
    ok("history sort: oldest first reorders rows",
      order()[0] === "Tinder" && order()[1] === "Ember", order().join(","));
    copied = await copy();
    ok("history sort: copy respects oldest first",
      copied.indexOf("Tinder\n") < copied.indexOf("Ember\n"), copied.slice(0, 80));
    sel.value = "rarityAsc"; sel.dispatchEvent(new w.Event("change", { bubbles: true }));
    ok("history sort: rarity ascending",
      order()[0] === "Tinder" && order()[1] === "Ember", order().join(","));
    sel.value = "rarity"; sel.dispatchEvent(new w.Event("change", { bubbles: true }));
    copied = await copy();
    ok("history sort: copy respects rarity order",
      copied.indexOf("Ember\n") < copied.indexOf("Tinder\n"), copied.slice(0, 80));
    dom.window.close();
  }

  // ---------- ticket theme-tag picker ----------
  {
    const { dom } = await boot("gacha.html");
    const w = dom.window, d = w.document;
    const tier = d.getElementById("tkTier"), cat = d.getElementById("tkCat");
    const q = d.getElementById("tkTagQ");
    const chips = () => [...d.querySelectorAll("#tkTags button")].map(b => b.textContent);
    const fireOf = () => {
      const t = chips().find(x => /^fire \(/.test(x));
      return t ? Number(t.match(/\((\d+)\)/)[1]) : null;
    };
    tier.value = "gold"; tier.dispatchEvent(new w.Event("change", { bubbles: true }));
    cat.value = "random"; cat.dispatchEvent(new w.Event("change", { bubbles: true }));
    q.value = "fire"; q.dispatchEvent(new w.Event("input", { bubbles: true }));
    const randomFire = fireOf();
    cat.value = "ability"; cat.dispatchEvent(new w.Event("change", { bubbles: true }));
    const abilityFire = fireOf();
    ok("ticket tags: counts follow the ticket category",
      randomFire != null && abilityFire != null && randomFire >= abilityFire,
      `${randomFire} vs ${abilityFire}`);
    q.value = "zzzznotatag";
    q.dispatchEvent(new w.Event("input", { bubbles: true }));
    ok("ticket tags: search can empty the list",
      /No tags match/.test(d.getElementById("tkTags").textContent),
      d.getElementById("tkTags").textContent.slice(0, 80));
    q.value = "fire"; q.dispatchEvent(new w.Event("input", { bubbles: true }));
    const chip = [...d.querySelectorAll("#tkTags button")]
      .find(b => /^fire \(/.test(b.textContent));
    ok("ticket tags: fire chip is offered", !!chip);
    if (chip) chip.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    ok("ticket tags: clicking selects the tag",
      d.getElementById("tkTag").value === "fire" &&
      d.getElementById("tkTagPick").textContent === "fire",
      d.getElementById("tkTag").value);
    d.getElementById("btnAddTicket").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    const db = JSON.parse(w.localStorage.getItem("chaosGacha.v1") || "{}");
    ok("ticket tags: added ticket carries the selection",
      !!(db.tickets && db.tickets[0]) && db.tickets[0].tag === "fire",
      JSON.stringify(db.tickets && db.tickets[0]));
    dom.window.close();
  }

  // ---------- Resonance weighting ----------
  {
    const { dom } = await boot("gacha.html");
    const w = dom.window;
    const A = { f: "ability", n: 9001, t: "both", name: "A", r: 3,
                s: "X", d: "", tags: ["fire", "dark"] };
    const B = { f: "ability", n: 9002, t: "both", name: "B", r: 3,
                s: "X", d: "", tags: ["ice"] };
    const lcg = seed => () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
    const count = (boost) => {
      let a = 0, b = 0;
      const rnd = lcg(12345);
      for (let i = 0; i < 800; i++) {
        const r = w.ChaosGacha.roll([A, B], [], "ability", 0, 10, 3,
          boost ? { tagBoost: boost } : {}, rnd);
        if (r.name === "A") a++; else b++;
      }
      return [a, b];
    };
    const [plainA, plainB] = count(null);
    ok("resonance: no boost is neutral",
      Math.abs(plainA - plainB) < 120, `${plainA}/${plainB}`);
    const [boostA, boostB] = count(["fire", "dark"]);
    ok("resonance: each matching tag doubles the odds",
      boostA > 2.5 * boostB, `${boostA}/${boostB}`);
    dom.window.close();
  }

  // ---------- gacha page: Gambler visibility ----------
  {
    const { dom, errors } = await boot("gacha.html");
    const w = dom.window, d = w.document;
    ok("gacha gambler: no page errors", errors.length === 0, errors[0]);
    d.getElementById("spinSpeed").value = "off";
    d.getElementById("spinSpeed").dispatchEvent(new w.Event("change", { bubbles: true }));
    d.getElementById("gambler").checked = true;
    d.getElementById("gambler").dispatchEvent(new w.Event("change", { bubbles: true }));

    // An advantage ticket rolls several wheels and then waits for the keep
    // choice. The d20 is already decided by then, so the prompt itself must
    // say what Gambler did instead of waiting for the kept result's card.
    const realRandom = w.Math.random;
    w.Math.random = () => 0.5;   // d20 = 11: "No change"
    d.getElementById("tkTier").value = "gold";
    d.getElementById("tkAdv").value = "2";
    d.getElementById("btnAddTicket").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    const tkBtns = [...d.querySelectorAll("#ticketList button")];
    tkBtns[tkBtns.length - 1].dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    const prompt = d.getElementById("resultBody").textContent;
    ok("gacha gambler: advantage prompt shows the d20 roll",
      /wheels landed/.test(prompt) && /Gambler d20 → 11: No change/.test(prompt), prompt);
    ok("gacha gambler: advantage prompt still lists every wheel",
      d.querySelectorAll("#multiList li").length === 2,
      String(d.querySelectorAll("#multiList li").length));

    // Copy while the advantage choice is pending: no single result exists
    // yet, so the button copies every wheel.
    let copied = "";
    Object.defineProperty(w.navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (t) => { copied = t; } },
    });
    const wheelNames = [...d.querySelectorAll("#multiList b")].map(b => b.textContent);
    d.getElementById("btnCopy").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    await new Promise(r => setTimeout(r, 20));
    ok("gacha gambler: copy captures every advantage wheel before a pick",
      wheelNames.length === 2 && wheelNames.every(n => copied.includes(n)) &&
      copied.split("\n\n").length >= 2,
      copied.slice(0, 200));

    // Every x10 ticket rolls its own d20, so every row must show it. Force a
    // rank up on the first ticket (d20 = 20) so the "gold → platinum" note is
    // deterministic; the rest roll "No change".
    let firstRoll = true;
    w.Math.random = () => {
      if (firstRoll) { firstRoll = false; return 0.99; }
      return 0.5;
    };
    d.getElementById("btnMulti").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    const rows = [...d.querySelectorAll("#multiList li")];
    const rowText = rows.map(li => li.textContent).join(" | ");
    ok("gacha gambler: every x10 row shows its own d20",
      rows.length === 10 && rows.every(li => /🎲 \d+: /.test(li.textContent)),
      String(rows.length) + " rows: " + rowText);
    ok("gacha gambler: x10 spells out what a rank up moved",
      /🎲 20: Rank Up \(gold → platinum\)/.test(rowText), rowText);
    const db = JSON.parse(w.localStorage.getItem("chaosGacha.v1") || "{}");
    ok("gacha gambler: x10 records the d20 on every ticket",
      (db.history || []).length === 10 &&
      db.history.every(h => h.d20 != null && h.geffect),
      JSON.stringify((db.history || [])[0] || {}).slice(0, 100));
    ok("gacha gambler: no page errors after rolls", errors.length === 0, errors[0]);
    dom.window.close();
  }

  // ---------- tag exclusion ----------
  {
    const { dom, errors } = await boot("gacha.html");
    const w = dom.window, d = w.document;
    ok("exclude tags: gacha no page errors", errors.length === 0, errors[0]);

    // engine level: notTags keeps matching entries out of the candidate pool
    const sample = [
      { f: "ability", t: "both", name: "Keep Me", r: 1.0, s: "X", d: "", tags: ["fire"] },
      { f: "ability", t: "both", name: "Drop Me", r: 1.0, s: "X", d: "", tags: ["fire", "deleted"] },
    ];
    const pool = w.ChaosGacha.candidates(sample, "ability", 0, 2, { notTags: ["deleted"] });
    ok("exclude tags: engine drops matching entries",
      pool.length === 1 && pool[0].entry.name === "Keep Me",
      pool.map(p => p.entry.name).join(","));

    // UI level: include fire + exclude fire leaves nothing to roll
    d.getElementById("spinSpeed").value = "off";
    d.getElementById("spinSpeed").dispatchEvent(new w.Event("change", { bubbles: true }));
    d.getElementById("fTag").value = "fire";
    d.getElementById("fExTags").value = "fire";
    d.getElementById("rollBtn").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    ok("exclude tags: conflicting include/exclude reports an empty pool",
      /no entries match/.test(d.getElementById("toast").textContent),
      d.getElementById("toast").textContent);

    const histBefore = (JSON.parse(w.localStorage.getItem("chaosGacha.v1") || "{}").history || []).length;
    d.getElementById("fExTags").value = "";
    d.getElementById("rollBtn").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    const histAfter = (JSON.parse(w.localStorage.getItem("chaosGacha.v1") || "{}").history || []).length;
    ok("exclude tags: clearing the exclusion rolls again", histAfter === histBefore + 1,
      `${histBefore} -> ${histAfter}`);
    dom.window.close();
  }
  {
    const { dom } = await boot("entries.html");
    const w = dom.window, d = w.document;
    const before = w.__entries.filtered().length;
    const names = [...d.querySelectorAll("#eqExTagNames option")].map(o => o.value);
    ok("exclude tags: entries page offers tag suggestions",
      names.includes("deleted"), String(names.length));
    d.getElementById("eqExTags").value = "deleted";
    d.getElementById("eqExTags").dispatchEvent(new w.Event("input", { bubbles: true }));
    const after = w.__entries.filtered();
    ok("exclude tags: entries page hides deleted entries",
      after.length < before &&
      after.every(e => !((e.tags || e.tg || []).includes("deleted"))),
      `${before} -> ${after.length}`);
    dom.window.close();
  }
  {
    const { dom } = await boot("tree.html");
    const w = dom.window;
    const ents = [
      { f: "ability", n: 1, t: "both", name: "Keep Node", r: 1.0, s: "X", d: "", m: [], tags: ["fire"] },
      { f: "ability", n: 2, t: "both", name: "Drop Node", r: 1.0, s: "X", d: "", m: [], tags: ["deleted"] },
      { f: "ability", n: 3, t: "both", name: "Keep Two", r: 2.0, s: "X", d: "", m: [], tags: ["fire"] },
    ];
    const res = await w.ChaosGen.generate(ents, 5, { clusters: 1, connect: false },
      { notTags: ["deleted"] });
    ok("exclude tags: tree generation skips matching entries",
      res.nodes.filter(n => n.name !== "Origin").length === 2 &&
      !res.nodes.some(n => n.name === "Drop Node"),
      res.nodes.map(n => n.name).join(","));
    dom.window.close();
  }

  // ---------- content flags come from thematic tags ----------
  {
    const { dom } = await boot("gacha.html");
    const w = dom.window;
    const entries = w.CHAOS_DATA.entries || [];
    const badNsfw = entries.filter(e => (e.tags || []).includes("nsfw") && !e.nsfw);
    const badTech = entries.filter(e => (e.tags || []).includes("tech") && !e.tech);
    ok("data: every nsfw tag sets the nsfw flag", badNsfw.length === 0,
      badNsfw.slice(0, 3).map(e => e.name).join(", "));
    ok("data: every tech tag sets the tech flag", badTech.length === 0,
      badTech.slice(0, 3).map(e => e.name).join(", "));
    const badNoncon = entries.filter(e => (e.tags || []).includes("noncon") && !e.noncon);
    ok("data: every noncon tag sets the noncon flag", badNoncon.length === 0,
      badNoncon.slice(0, 3).map(e => e.name).join(", "));
    const tome = entries.find(e => /Tome of the Grand Rizzard/i.test(e.name));
    ok("data: a tag-only nsfw entry is gated", !!tome && tome.nsfw === true,
      tome ? tome.name : "not found");
    dom.window.close();
  }

  // ---------- tree page ----------
  {
    const { dom, errors } = await boot("tree.html");
    const w = dom.window, d = w.document;
    ok("tree: no page errors", errors.length === 0, errors[0]);
    const ownOpts = [...d.querySelectorAll("#ownTag option")].map(o => o.value);
    const newOpts = [...d.querySelectorAll("#newTag option")].map(o => o.value);
    ok("tree: owned-tag filter populated", ownOpts.length > 20, String(ownOpts.length));
    ok("tree: generation tag filter populated", newOpts.length > 20, String(newOpts.length));
    ok("tree: options carry counts", /\(\d+\)/.test(d.querySelector("#newTag option:nth-child(2)").textContent));
    dom.window.close();
  }

  // ---------- tree page: data-version mismatch offers Upgrade ----------
  {
    const stale = JSON.stringify({
      trees: [{ id: "t1", name: "Stale tree", seed: 7, params: {}, limit: null,
                filters: { sources: ["Generic"] }, dataVersion: "oldversion",
                versionScheme: 2, static: false, createdAt: 1 }],
      states: { t1: { points: 0, cores: 0, inventory: [], unlocked: [0] } },
      activeId: "t1", guideSeen: true, settings: {},
    });
    const { dom, errors } = await boot("tree.html", { "chaosTree.v1": stale });
    const w = dom.window, d = w.document;
    ok("tree: no page errors on a stale tree", errors.length === 0, errors[0]);
    ok("tree: mismatch banner is shown", d.getElementById("verWarn").style.display !== "none");
    const banner = d.getElementById("btnUpgradeActive");
    ok("tree: banner offers Upgrade", !!banner);
    const rowBtn = d.querySelector('#treeList button[data-tree-id="t1"]');
    ok("tree: tree row carries an Upgrade button keyed by id", !!rowBtn);
    banner.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    await new Promise(r => setTimeout(r, 150));
    const picked = !!d.querySelector("#treeList .upPicker") ||
      [...d.querySelectorAll("#treeList b")].some(b => /upgraded/i.test(b.textContent));
    ok("tree: banner Upgrade opens the upgrade flow", picked,
      d.getElementById("treeList").textContent.slice(0, 120));
    dom.window.close();
  }

  // ---------- generated exports keep their exact layout ----------
  {
    const tree = JSON.stringify({
      trees: [{ id: "tex", name: "Export me", seed: 7, params: { radius: 50 },
                limit: null, filters: {}, dataVersion: DATA_VERSION,
                versionScheme: 2, static: false, createdAt: 1 }],
      states: { tex: { points: 0, cores: 0, inventory: [], unlocked: [0] } },
      activeId: "tex", guideSeen: true, settings: {},
    });
    const nodes = [
      { id: 0, file: "__root__", number: 0, name: "Origin", rarity: 0,
        source: "System", tag: "both", description: "", meta: [], tags: [],
        pos: [0, 0, 0], r: 0 },
      { id: 1, file: "ability", number: 1, name: "Tinder", rarity: 1.3,
        source: "Generic", tag: "both", description: "weak flames", meta: [],
        tags: [], pos: [1, 0, 0], r: 1 },
      { id: 2, file: "item", number: 2, name: "Excalibur", rarity: 7.0,
        source: "Fate", tag: "both", description: "sword", meta: [], tags: [],
        pos: [2, 0, 0], r: 2 },
    ];
    const gen = JSON.stringify({
      key: JSON.stringify([7, { radius: 50 }, {}, null, DATA_VERSION]),
      res: { nodes, edges: [{ a: 0, b: 1, d: 1 }, { a: 1, b: 2, d: 1 }] },
    });
    const { dom } = await boot("tree.html",
      { "chaosTree.v1": tree, "chaosTree.gen.v1.tex": gen });
    const w = dom.window, d = w.document;
    let captured = null;
    w.URL.createObjectURL = (blob) => { captured = blob; return "blob:test"; };
    w.URL.revokeObjectURL = () => {};
    w.HTMLAnchorElement.prototype.click = function () {};
    d.getElementById("btnExport").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    await new Promise(r => setTimeout(r, 20));
    ok("tree export: generated tree carries its layout", !!captured);
    const payload = captured ? JSON.parse(await captured.text()) : {};
    ok("tree export: layout holds the same nodes",
      payload.tree && payload.tree.topology &&
      payload.tree.topology.nodes.length === 3 &&
      payload.tree.topology.nodes[1].file === "ability" &&
      payload.tree.topology.nodes[1].number === 1);
    ok("tree export: layout uses compact identity rows",
      payload.tree && payload.tree.topology &&
      payload.tree.topology.nodes[1]._c === 1 &&
      !("name" in payload.tree.topology.nodes[1]));
    dom.window.close();
    if (payload.tree) {
    // Import into a clean profile: freeze the layout instead of re-sampling.
    const { dom: dom2 } = await boot("tree.html");
    const w2 = dom2.window, d2 = w2.document;
    const file = new w2.File([JSON.stringify(payload)], "export.json",
      { type: "application/json" });
    const input = d2.getElementById("fileImport");
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    input.dispatchEvent(new w2.Event("change", { bubbles: true }));
    await new Promise(r => setTimeout(r, 200));
    const db = JSON.parse(w2.localStorage.getItem("chaosTree.v1") || "{}");
    const imported = (db.trees || [])[0] || {};
    ok("tree import: layout import is frozen", imported.static === true);
    ok("tree import: recorded data version is preserved",
      imported.dataVersion === DATA_VERSION, String(imported.dataVersion));
    const stored = JSON.parse(w2.localStorage.getItem(
      "chaosTree.static.v1." + imported.id) || "null");
    ok("tree import: layout survives", !!stored && stored.nodes.length === 3);
    ok("tree import: placement params survive",
      !!stored && stored.params && stored.params.radius === 50,
      JSON.stringify(stored && stored.params));
    ok("tree import: layout keeps its edges",
      !!stored && stored.edges.length === 2 &&
      stored.edges.every(e => e.length === 3 &&
        e.every(v => typeof v === "number")),
      JSON.stringify(stored && stored.edges));
    const rt = await w2.__treeDebug.runtime();
    ok("tree import: runtime keeps the tree's radius", rt && rt.params && rt.params.radius === 50,
      JSON.stringify(rt && rt.params));
    ok("tree import: imported layout stays connected",
      rt && rt.edges.length === 2 && Object.keys(rt.adj).length === 3 &&
      rt.nodes.every(nd => nd.name),
      rt ? `${rt.nodes.length} nodes, ${rt.edges.length} edges` : "no runtime");

    // Python-generator trees carry snake_case params; keep them for Upgrade.
    const py = {
      format: "chaos-tree", version: 1, seed: 3,
      params: { radius: 50, mean_degree: 4, max_link_distance: 0.5,
                files: ["ability"], sources: "all", include_nsfw: false },
      nodes: [{ id: 0, file: "__root__", number: 0, name: "Origin",
                rarity: 0, pos: [0, 0, 0], r: 0 }],
      edges: [],
    };
    const pyFile = new w2.File([JSON.stringify(py)], "python-tree.json",
      { type: "application/json" });
    Object.defineProperty(input, "files", { value: [pyFile], configurable: true });
    input.dispatchEvent(new w2.Event("change", { bubbles: true }));
    await new Promise(r => setTimeout(r, 150));
    const db2 = JSON.parse(w2.localStorage.getItem("chaosTree.v1") || "{}");
    const pyt = (db2.trees || []).find(t => /python-tree/.test(t.name));
    ok("tree import: python placement params are mapped",
      !!pyt && pyt.params.radius === 50 && pyt.params.meanDegree === 4 &&
      pyt.params.maxLinkDistance === 0.5, JSON.stringify(pyt && pyt.params));
    ok("tree import: python filters are kept",
      !!pyt && Array.isArray(pyt.filters.files) &&
      pyt.filters.files[0] === "ability", JSON.stringify(pyt && pyt.filters));

    // App exports have kept placement params on the record, on the topology,
    // or both. Keep whichever copy exists so a later Upgrade never sees an
    // empty params object and falls back to the radius-10 default.
    const legacyApp = {
      app: "chaos-tree", v: 1,
      tree: { name: "Topology params only", seed: 9, limit: null, filters: {},
              dataVersion: DATA_VERSION, static: true,
              topology: { v: 3, params: { radius: 50, meanDegree: 4 },
                          nodes: [{ id: 0, file: "__root__", number: 0,
                                    pos: [0, 0, 0], r: 0 }], edges: [] } },
      state: {},
    };
    const legFile = new w2.File([JSON.stringify(legacyApp)], "topology-params.json",
      { type: "application/json" });
    Object.defineProperty(input, "files", { value: [legFile], configurable: true });
    input.dispatchEvent(new w2.Event("change", { bubbles: true }));
    await new Promise(r => setTimeout(r, 150));
    const db3 = JSON.parse(w2.localStorage.getItem("chaosTree.v1") || "{}");
    const leg = (db3.trees || []).find(t => /topology params only/i.test(t.name));
    ok("tree import: topology-only placement params survive",
      !!leg && leg.params.radius === 50 && leg.params.meanDegree === 4,
      JSON.stringify(leg && leg.params));
    const legStored = leg && JSON.parse(
      w2.localStorage.getItem("chaosTree.static.v1." + leg.id) || "null");
    ok("tree import: topology-only params reach the snapshot",
      !!legStored && legStored.params && legStored.params.radius === 50,
      JSON.stringify(legStored && legStored.params));
    dom2.window.close();
    }
  }

  // ---------- frozen content with no recorded version still warns ----------
  {
    // The silent case: the tree record has no dataVersion at all and its
    // snapshot was silently re-keyed to the current data. Content provenance
    // is the only thing that can flag it.
    const tree = JSON.stringify({
      trees: [{ id: "t2", name: "Unversioned tree", seed: 7, params: {}, limit: null,
                filters: {}, versionScheme: 2, static: false, createdAt: 1 }],
      states: { t2: { points: 0, cores: 0, inventory: [], unlocked: [0] } },
      activeId: "t2", guideSeen: true, settings: {},
    });
    const nodes = [{ id: 0, file: "__root__", name: "Origin", rarity: 0, pos: [0, 0, 0], r: 0 },
                   { id: 1, file: "ability", name: "HyperQbe the Streamer", rarity: 3.4,
                     source: "Q-UP", tag: "both", description: "old entry", meta: [], pos: [1, 0, 0], r: 1 }];
    const gen = JSON.stringify({ key: JSON.stringify([7, {}, {}, null, "oldversion"]),
                                 res: { nodes, edges: [{ a: 0, b: 1, d: 1 }] } });
    const { dom, errors } = await boot("tree.html",
      { "chaosTree.v1": tree, "chaosTree.gen.v1.t2": gen });
    const w = dom.window, d = w.document;
    ok("tree: frozen tree boots", errors.length === 0, errors[0]);
    ok("tree: unversioned frozen content still warns",
      d.getElementById("verWarn").style.display !== "none",
      d.getElementById("verWarnText").textContent.slice(0, 120));
    const saved = JSON.parse(w.localStorage.getItem("chaosTree.gen.v1.t2") || "{}");
    const savedKey = JSON.parse(saved.key || "[]");
    ok("tree: frozen run kept its old entries under the current key",
      saved.res && saved.res.nodes && saved.res.nodes.some(nd => nd.name === "HyperQbe the Streamer") &&
      savedKey[4] === w.CHAOS_DATA.dataVersion,
      JSON.stringify(savedKey));
    ok("tree: row pill names the stale version",
      /data voldversion/.test(d.getElementById("treeList").textContent),
      d.getElementById("treeList").textContent.slice(0, 140));
    dom.window.close();
  }

  // ---------- static (imported) snapshot on old data warns too ----------
  {
    const tree = JSON.stringify({
      trees: [{ id: "t3", name: "Imported primary", seed: 5, params: {}, limit: null,
                filters: {}, dataVersion: "ee5d89ed5c", versionScheme: 2,
                static: true, createdAt: 1 }],
      states: { t3: { points: 0, cores: 0, inventory: [], unlocked: [0] } },
      activeId: "t3", guideSeen: true, settings: {},
    });
    const topo = JSON.stringify({
      params: {},
      nodes: [{ id: 0, file: "__root__", name: "Origin", rarity: 0, pos: [0, 0, 0], r: 0 },
              { id: 1, file: "ability", name: "HyperQbe the Streamer", rarity: 3.4, source: "Q-UP",
                tag: "both", description: "baked entry", meta: [], pos: [1, 0, 0], r: 1 }],
      edges: [{ a: 0, b: 1, d: 1 }],
    });
    const { dom, errors } = await boot("tree.html",
      { "chaosTree.v1": tree, "chaosTree.static.v1.t3": topo });
    const w = dom.window, d = w.document;
    ok("tree: static snapshot boots", errors.length === 0, errors[0]);
    ok("tree: imported snapshot on old data warns",
      d.getElementById("verWarn").style.display !== "none",
      d.getElementById("verWarnText").textContent.slice(0, 140));
    ok("tree: warning says it is a frozen snapshot",
      /frozen snapshot/.test(d.getElementById("verWarnText").textContent));
    ok("tree: row pill names the exported version",
      /data vee5d89ed5c/.test(d.getElementById("treeList").textContent),
      d.getElementById("treeList").textContent.slice(0, 140));
    ok("tree: warning counts vanished entries for a versioned snapshot too",
      /1 of its entries no longer exist/.test(d.getElementById("verWarnText").textContent),
      d.getElementById("verWarnText").textContent.slice(-90));
    // an external snapshot with no recorded version stays quiet
    const anon = JSON.stringify({
      trees: [{ id: "t4", name: "External file", seed: 5, params: {}, limit: null,
                filters: {}, dataVersion: null, static: true, createdAt: 1 }],
      states: { t4: { points: 0, cores: 0, inventory: [], unlocked: [0] } },
      activeId: "t4", guideSeen: true, settings: {},
    });
    // A version-less file still warns if it references entries that no longer
    // exist in the data ("HyperQbe the Streamer" in the stub topology).
    const b2 = await boot("tree.html",
      { "chaosTree.v1": anon, "chaosTree.static.v1.t4": topo });
    const b2d = b2.dom.window.document;
    ok("tree: version-less file with vanished entries warns",
      b2d.getElementById("verWarn").style.display !== "none",
      b2d.getElementById("verWarnText").textContent.slice(0, 120));
    ok("tree: warning counts the vanished entries",
      /1 of its entries no longer exist/.test(b2d.getElementById("verWarnText").textContent),
      b2d.getElementById("verWarnText").textContent.slice(-90));
    ok("tree: row pill flags stale entries",
      /1 stale entry/.test(b2d.getElementById("treeList").textContent),
      b2d.getElementById("treeList").textContent.slice(0, 120));
    b2.dom.window.close();
    dom.window.close();
  }

  // ---------- real current entries in a static snapshot are not "vanished" ---
  {
    const realNodes = [
      { id: 0, file: "__root__", number: 0, name: "Origin", rarity: 0,
        pos: [0, 0, 0], r: 0 },
      { id: 1, file: "skill", number: 1, name: "Water Stream Crushing Rock",
        rarity: 5.9, source: "One Punch Man", tag: "both", description: "x",
        meta: [], tags: [], pos: [1, 0, 0], r: 1 },
      { id: 2, file: "ability", number: 1456, name: "Rail Laying",
        rarity: 3.6, source: "Generic", tag: "both", description: "x",
        meta: [], tags: ["railway"], pos: [0, 1, 0], r: 1 },
    ];
    const realTopo = JSON.stringify({
      params: {}, nodes: realNodes,
      edges: [{ a: 0, b: 1, d: 1 }, { a: 0, b: 2, d: 1 }],
    });
    const tree = JSON.stringify({
      trees: [{ id: "t5", name: "Real static", seed: 5, params: {}, limit: null,
                filters: {}, dataVersion: "ancient", versionScheme: 2,
                static: true, createdAt: 1 }],
      states: { t5: { points: 0, cores: 0, inventory: [], unlocked: [0] } },
      activeId: "t5", guideSeen: true, settings: {},
    });
    const { dom } = await boot("tree.html",
      { "chaosTree.v1": tree, "chaosTree.static.v1.t5": realTopo });
    const w = dom.window, d = w.document;
    const txt = d.getElementById("verWarnText").textContent;
    ok("tree: real entries are not counted as vanished",
      !/no longer exist/.test(txt), txt);
    ok("tree: real-entry snapshot only reports its old version",
      /frozen snapshot/.test(txt) && /data vancient/.test(txt), txt);
    ok("tree: row pill names the version, not a bogus stale count",
      /data vancient/.test(d.getElementById("treeList").textContent) &&
      !/stale entr/.test(d.getElementById("treeList").textContent),
      d.getElementById("treeList").textContent.slice(0, 140));

    const keep = d.getElementById("btnKeepSnapshot");
    ok("tree: keep-snapshot button is offered", keep && keep.style.display !== "none");
    keep.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    ok("tree: keep-snapshot dismisses the version warning",
      d.getElementById("verWarn").style.display === "none");
    const saved = JSON.parse(w.localStorage.getItem("chaosTree.v1") || "{}");
    ok("tree: kept snapshot is persisted",
      !!(saved.trees || []).find(t => t.id === "t5" && t.snapshotKept));
    ok("tree: kept snapshot is labelled",
      /snapshot kept/.test(d.getElementById("treeList").textContent),
      d.getElementById("treeList").textContent.slice(0, 160));

    // A version-less snapshot made of real entries needs no warning at all.
    const anonTree = JSON.stringify({
      trees: [{ id: "t6", name: "External current file", seed: 5, params: {}, limit: null,
                filters: {}, dataVersion: null, static: true, createdAt: 1 }],
      states: { t6: { points: 0, cores: 0, inventory: [], unlocked: [0] } },
      activeId: "t6", guideSeen: true, settings: {},
    });
    const b3 = await boot("tree.html",
      { "chaosTree.v1": anonTree, "chaosTree.static.v1.t6": realTopo });
    ok("tree: version-less snapshot of current entries is quiet",
      b3.dom.window.document.getElementById("verWarn").style.display === "none",
      b3.dom.window.document.getElementById("verWarnText").textContent);
    b3.dom.window.close();
    dom.window.close();
  }

  // ---------- upgrade refreshes tags on kept (visible) entries --------------
  {
    const oldTree = JSON.stringify({
      trees: [{ id: "tu", name: "Upgrade tags", seed: 7, params: {}, limit: 20,
                filters: {}, dataVersion: "old", versionScheme: 2,
                static: true, createdAt: 1 }],
      states: { tu: { points: 0, cores: 0, inventory: [], unlocked: [0, 1] } },
      activeId: "tu", guideSeen: true, settings: {},
    });
    const oldTopo = JSON.stringify({
      params: {},
      nodes: [
        { id: 0, file: "__root__", number: 0, name: "Origin", rarity: 0,
          source: "System", tag: "both", description: "", meta: [], tags: [],
          pos: [0, 0, 0], r: 0 },
        { id: 1, file: "familiar", number: 465, name: "Old Penguin", rarity: 2.0,
          source: "Palworld", tag: "both",
          description: "A penguin Pal that loads itself into a launcher as living ammunition.",
          meta: [], tags: ["avian"], pos: [1, 0, 0], r: 1 },
      ],
      edges: [{ a: 0, b: 1, d: 1 }],
    });
    const { dom } = await boot("tree.html", {
      "chaosTree.v1": oldTree, "chaosTree.static.v1.tu": oldTopo,
    });
    const w = dom.window, d = w.document;
    const ownedTab = [...d.querySelectorAll("#tabs button")]
      .find(b => b.dataset.tab === "owned");
    ownedTab.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    await new Promise(r => setTimeout(r, 120));
    const ownedText = d.getElementById("ownedBody").textContent;
    ok("tree: existing save shows current name and tags without upgrading",
      /Pengullet/.test(ownedText) && !/Old Penguin/.test(ownedText) &&
      /🏷 ice/.test(ownedText) && /🏷 water/.test(ownedText),
      ownedText.slice(0, 200));
    d.getElementById("btnUpgradeActive")
      .dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    await new Promise(r => setTimeout(r, 800));
    const saved = JSON.parse(w.localStorage.getItem("chaosTree.v1") || "{}");
    const up = (saved.trees || []).find(t => /upgraded/.test(t.name));
    ok("tree: upgrade creates the new tree", !!up, JSON.stringify(saved.trees));
    const staticKey = up ? "chaosTree.static.v1." + up.id : null;
    const stored = staticKey ? w.localStorage.getItem(staticKey) : null;
    const topo = stored ? JSON.parse(stored) : null;
    ok("tree: upgrade stores an identity-only compact snapshot",
      topo && topo.v === 3 && topo.nodes.some(n => n && n._c === 1),
      topo && JSON.stringify(topo).slice(0, 80));
    const pengRow = topo && topo.nodes.find(n =>
      n && n._c === 1 && n.file === "familiar" && n.number === 465);
    ok("tree: compact snapshot stores identity and layout, not entry text",
      pengRow && !("name" in pengRow) && !("tags" in pengRow) &&
      !("description" in pengRow) && Array.isArray(pengRow.pos),
      JSON.stringify(pengRow));

    // Reload from storage: no missing-topology error, and the compact node
    // hydrates its display fields/tags from the current entries bundle.
    const seed = { "chaosTree.v1": JSON.stringify(saved) };
    if (staticKey) seed[staticKey] = stored;
    const reloaded = await boot("tree.html", seed);
    const rw = reloaded.dom.window, rd = rw.document;
    const owned2 = [...rd.querySelectorAll("#tabs button")]
      .find(b => b.dataset.tab === "owned");
    owned2.dispatchEvent(new rw.MouseEvent("click", { bubbles: true }));
    await new Promise(r => setTimeout(r, 150));
    ok("tree: compact upgraded tree reloads without a missing-data error",
      !/tree data is missing/.test(rd.getElementById("toast").textContent),
      rd.getElementById("toast").textContent);
    const reloadedText = rd.getElementById("ownedBody").textContent;
    ok("tree: reloaded upgraded tree shows current tags",
      /🏷 ice/.test(reloadedText) && /🏷 water/.test(reloadedText),
      reloadedText.slice(0, 200));

    // A Fresh copy of an upgraded (compact) tree must stay compact too; this
    // is the path that used to duplicate the full ~1.7 MB payload.
    const treesTab = [...rd.querySelectorAll("#tabs button")]
      .find(b => b.dataset.tab === "trees");
    treesTab.dispatchEvent(new rw.MouseEvent("click", { bubbles: true }));
    const upRow = [...rd.querySelectorAll("#treeList li")]
      .find(li => /upgraded/i.test(li.textContent));
    const freshBtn = upRow && [...upRow.querySelectorAll("button")]
      .find(b => /Fresh/.test(b.textContent));
    ok("tree: upgraded row offers Fresh", !!freshBtn);
    if (freshBtn) {
      freshBtn.dispatchEvent(new rw.MouseEvent("click", { bubbles: true }));
      await new Promise(r => setTimeout(r, 300));
      const db2 = JSON.parse(rw.localStorage.getItem("chaosTree.v1") || "{}");
      const fresh = (db2.trees || []).find(t => /\(fresh\)/.test(t.name));
      const freshRaw = fresh && rw.localStorage.getItem("chaosTree.static.v1." + fresh.id);
      const freshPayload = freshRaw && JSON.parse(freshRaw);
      ok("tree: fresh copy of an upgraded tree stays compact",
        freshPayload && freshPayload.v === 3,
        freshPayload && JSON.stringify(freshPayload).slice(0, 80));
    }
    reloaded.dom.window.close();
    dom.window.close();
  }

  // ---------- upgrade appends new entries without reassigning existing ones --
  {
    const grow = JSON.stringify({
      trees: [{ id: "tg", name: "Grow tree", seed: 7, params: {}, limit: null,
                filters: { files: ["familiar"], sources: ["Palworld"],
                           includeNsfw: true, includeNoncon: true, includeGachaOnly: true },
                dataVersion: "old", versionScheme: 2, static: true, createdAt: 1 }],
      states: { tg: { points: 0, cores: 0, inventory: [], unlocked: [0, 1] } },
      activeId: "tg", guideSeen: true, settings: {},
    });
    const growTopo = JSON.stringify({
      params: {},
      nodes: [
        { id: 0, file: "__root__", number: 0, name: "Origin", rarity: 0,
          source: "System", tag: "both", description: "", meta: [], tags: [],
          pos: [0, 0, 0], r: 0 },
        { id: 1, file: "familiar", number: 465, name: "Old Penguin", rarity: 2.0,
          source: "Palworld", tag: "both", description: "old entry", meta: [],
          tags: ["avian"], pos: [1, 0, 0], r: 1 },
      ],
      edges: [{ a: 0, b: 1, d: 1 }],
    });
    const { dom } = await boot("tree.html", {
      "chaosTree.v1": grow, "chaosTree.static.v1.tg": growTopo,
    });
    const w = dom.window, d = w.document;
    d.getElementById("btnUpgradeActive")
      .dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    await new Promise(r => setTimeout(r, 100));
    const go = d.querySelector("#treeList .upPicker button.primary");
    if (go) go.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    await new Promise(r => setTimeout(r, 800));
    const saved = JSON.parse(w.localStorage.getItem("chaosTree.v1") || "{}");
    const up = (saved.trees || []).find(t => /upgraded/.test(t.name));
    ok("tree: growth upgrade creates a tree", !!up, JSON.stringify(saved.trees));
    const payload = up && JSON.parse(w.localStorage.getItem("chaosTree.static.v1." + up.id) || "null");
    const old = payload && payload.nodes.find(n => n && n._c && n.id === 1);
    const lamball = payload && payload.nodes.find(n =>
      n && n._c && n.file === "familiar" && n.number === 461);
    ok("tree: growth upgrade preserves the existing node identity and position",
      old && old.number === 465 &&
      JSON.stringify(old.pos) === JSON.stringify([1, 0, 0]),
      JSON.stringify(old));
    ok("tree: growth upgrade appends a newly added entry",
      !!lamball && payload.nodes.length > 2,
      payload && JSON.stringify(payload.nodes.slice(-2)));
    ok("tree: growth upgrade is identity-only",
      payload && payload.v === 3 &&
      !("name" in (old || {})) && !("tags" in (old || {})),
      payload && JSON.stringify(payload).slice(0, 80));
    ok("tree: growth upgrade stamps the current identity version",
      up && up.versionScheme === 2 && up.dataVersion === w.CHAOS_DATA.dataVersion);
    dom.window.close();
  }

  // ---------- upgrade infers a legacy tree's radius -------------------------
  {
    // A pre-fix snapshot has no placement params anywhere, but its nodes
    // span radius 50. Upgrade must trust the layout instead of falling back
    // to the app's radius-10 default (which used to drop high-rarity entries
    // next to the low-rarity ones near the centre).
    const legacy = JSON.stringify({
      trees: [{ id: "tr", name: "Radiusless tree", seed: 7, params: {}, limit: null,
                filters: { files: ["familiar"], sources: ["Palworld"],
                           includeNsfw: true, includeNoncon: true, includeGachaOnly: true },
                dataVersion: "old", versionScheme: 2, static: true, createdAt: 1 }],
      states: { tr: { points: 0, cores: 0, inventory: [], unlocked: [0, 1] } },
      activeId: "tr", guideSeen: true, settings: {},
    });
    const topo = JSON.stringify({
      nodes: [
        { id: 0, file: "__root__", number: 0, name: "Origin", rarity: 0,
          source: "System", tag: "both", description: "", meta: [], tags: [],
          pos: [0, 0, 0], r: 0 },
        { id: 1, file: "familiar", number: 590, name: "Shaolong", rarity: 7.7,
          source: "Palworld", tag: "both", description: "old entry", meta: [],
          tags: [], pos: [50, 0, 0], r: 50 },
      ],
      edges: [{ a: 0, b: 1, d: 50 }],
    });
    const { dom } = await boot("tree.html", {
      "chaosTree.v1": legacy, "chaosTree.static.v1.tr": topo,
    });
    const w = dom.window, d = w.document;
    d.getElementById("btnUpgradeActive")
      .dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    await new Promise(r => setTimeout(r, 100));
    const go = d.querySelector("#treeList .upPicker button.primary");
    if (go) go.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    await new Promise(r => setTimeout(r, 800));
    const saved = JSON.parse(w.localStorage.getItem("chaosTree.v1") || "{}");
    const up = (saved.trees || []).find(t => /upgraded/.test(t.name));
    const payload = up && JSON.parse(
      w.localStorage.getItem("chaosTree.static.v1." + up.id) || "null");
    const lamball = payload && payload.nodes.find(n =>
      n && n._c && n.file === "familiar" && n.number === 461);
    // Shaolong (rarity 7.7) is already present; Lamball (1.2) is added.
    // With the inferred radius 50 it belongs at r≈7.3, not the buggy r≈1.5.
    ok("tree: upgrade infers the layout radius when params are missing",
      !!lamball && lamball.r > 5 && lamball.r < 10,
      lamball ? `r=${lamball.r}` : "no Lamball");
    ok("tree: inferred node position matches its shell",
      !!lamball && Math.abs(Math.hypot(...lamball.pos) - lamball.r) < 1e-4,
      lamball && JSON.stringify(lamball.pos));
    ok("tree: upgrade persists the inferred radius in the snapshot",
      !!payload && payload.params && payload.params.radius === 50,
      JSON.stringify(payload && payload.params));
    ok("tree: upgraded record carries the inferred radius",
      !!up && up.params && up.params.radius === 50,
      JSON.stringify(up && up.params));
    dom.window.close();
  }

  // ---------- legacy saves migrate to identity-only storage for free --------
  {
    const legacy = JSON.stringify({
      trees: [{ id: "tl", name: "Legacy save", seed: 5, params: {}, limit: null,
                filters: {}, dataVersion: "legacy-version", static: true, createdAt: 1 }],
      states: { tl: { points: 0, cores: 0, inventory: [], unlocked: [0, 1] } },
      activeId: "tl", guideSeen: true, settings: {},
    });
    const legacyTopo = JSON.stringify({
      params: {},
      nodes: [
        { id: 0, file: "__root__", number: 0, name: "Origin", rarity: 0,
          source: "System", tag: "both", description: "", meta: [], tags: [],
          pos: [0, 0, 0], r: 0 },
        { id: 1, file: "familiar", number: 465, name: "Old Penguin",
          rarity: 2.0, source: "Palworld", tag: "both", description: "old entry",
          meta: [], tags: ["avian"], pos: [1, 0, 0], r: 1 },
      ],
      edges: [{ a: 0, b: 1, d: 1 }],
    });
    const { dom } = await boot("tree.html", {
      "chaosTree.v1": legacy, "chaosTree.static.v1.tl": legacyTopo,
    });
    const w = dom.window, d = w.document;
    const db = JSON.parse(w.localStorage.getItem("chaosTree.v1") || "{}");
    const t = (db.trees || [])[0];
    ok("tree: legacy save adopts the identity-only scheme",
      t && t.versionScheme === 2 && t.dataVersion === w.CHAOS_DATA.dataVersion,
      t && `${t.versionScheme}/${t.dataVersion}`);
    ok("tree: legacy save no longer shows a version warning",
      d.getElementById("verWarn").style.display === "none",
      d.getElementById("verWarnText").textContent);
    const stored = JSON.parse(w.localStorage.getItem("chaosTree.static.v1.tl") || "null");
    const row = stored && stored.nodes.find(n =>
      n && n._c === 1 && n.file === "familiar" && n.number === 465);
    ok("tree: legacy save is rewritten without entry text",
      stored && stored.v === 3 && row && !("name" in row) && !("tags" in row),
      stored && JSON.stringify(stored).slice(0, 80));
    const owned = [...d.querySelectorAll("#tabs button")]
      .find(b => b.dataset.tab === "owned");
    owned.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    await new Promise(r => setTimeout(r, 120));
    const text = d.getElementById("ownedBody").textContent;
    ok("tree: legacy save shows current name and tags",
      /Pengullet/.test(text) && !/Old Penguin/.test(text) &&
      /🏷 ice/.test(text) && /🏷 water/.test(text), text.slice(0, 200));
    dom.window.close();
  }

  // ---------- jump planner aggregates actual picks across launch nodes ------
  {
    const jumpNodes = [
      { id: 0, file: "__root__", number: 0, name: "Origin", rarity: 0,
        pos: [0, 0, 0], r: 0 },
      { id: 1, file: "ability", number: 1, name: "Water Stream Crushing Rock",
        rarity: 5.9, source: "One Punch Man", tag: "both", description: "x",
        meta: [], tags: [], pos: [5, 0, 0], r: 5 },
      { id: 2, file: "item", number: 1, name: "Gae Bolg",
        rarity: 5.3, source: "Fate", tag: "both", description: "x",
        meta: [], tags: [], pos: [6, 0, 0], r: 6 },
      { id: 3, file: "item", number: 2,
        name: "Excalibur the Sword of Promised Victory",
        rarity: 7, source: "Fate", tag: "both", description: "x",
        meta: [], tags: [], pos: [7, 0, 0], r: 7 },
      { id: 4, file: "item", number: 3, name: "Laevatein",
        rarity: 7.8, source: "Fate", tag: "both", description: "x",
        meta: [], tags: [], pos: [8, 0, 0], r: 8 },
      { id: 5, file: "ability", number: 2, name: "Intermediate Cooking",
        rarity: 2.3, source: "Generic", tag: "both", description: "x",
        meta: [], tags: [], pos: [10, 0, 0], r: 10 },
      { id: 6, file: "item", number: 5, name: "Vorpal Blade",
        rarity: 4, source: "Black Souls", tag: "both", description: "x",
        meta: [], tags: [], pos: [11, 0, 0], r: 11 },
    ];
    const jumpTopo = JSON.stringify({
      params: {}, nodes: jumpNodes,
      edges: jumpNodes.slice(1).map(nd => ({ a: 0, b: nd.id, d: nd.r })),
    });
    const bootJump = async (inventory) => {
      const db = JSON.stringify({
        trees: [{ id: "tj", name: "Jump planner", seed: 5, params: {}, limit: null,
                  filters: {}, dataVersion: null, static: true, createdAt: 1 }],
        states: { tj: { points: 1e9, cores: 50, inventory,
                        unlocked: [0, 1, 5] } },
        activeId: "tj", guideSeen: true, settings: {},
      });
      const { dom } = await boot("tree.html",
        { "chaosTree.v1": db, "chaosTree.static.v1.tj": jumpTopo });
      const w = dom.window, d = w.document;
      d.querySelector('#tabs button[data-tab="tickets"]').dispatchEvent(
        new w.MouseEvent("click", { bubbles: true }));
      d.getElementById("planToggle").dispatchEvent(
        new w.MouseEvent("click", { bubbles: true }));
      d.getElementById("planScope").value = "jump";
      d.getElementById("planScope").dispatchEvent(new w.Event("change", { bubbles: true }));
      await new Promise(r => setTimeout(r, 250));
      return { dom, rows: [...d.querySelectorAll("#planList > li")] };
    };

    const one = await bootJump([{ kind: "jump", tier: null, category: "item" }]);
    const oneText = one.rows.map(li => li.textContent).join(" | ");
    ok("tree planner: a jump ticket lists the closest item from every launch",
      one.rows.length === 2 && /Gae Bolg/.test(oneText) && /Vorpal Blade/.test(oneText),
      oneText);
    ok("tree planner: every row is actionable",
      one.rows.length === 2 && one.rows.every(li => /Jump →/.test(li.textContent)));
    const od = one.dom.window.document;
    ok("tree planner: no launch-from dropdown remains", !od.getElementById("planJumpFrom"));

    // Hiding Unlockable now must survive a planner rerender.
    od.getElementById("unlockToggle").dispatchEvent(
      new one.dom.window.MouseEvent("click", { bubbles: true }));
    const hiddenBefore = od.getElementById("unlockList").style.display;
    od.getElementById("planScope").value = "visible";
    od.getElementById("planScope").dispatchEvent(
      new one.dom.window.Event("change", { bubbles: true }));
    await new Promise(r => setTimeout(r, 250));
    od.getElementById("planScope").value = "jump";
    od.getElementById("planScope").dispatchEvent(
      new one.dom.window.Event("change", { bubbles: true }));
    await new Promise(r => setTimeout(r, 250));
    ok("tree planner: a hidden Unlockable now list stays hidden on rerender",
      hiddenBefore === "none" &&
      od.getElementById("unlockList").style.display === "none" &&
      od.getElementById("unlockToggle").textContent === "Show",
      `${hiddenBefore} -> ${od.getElementById("unlockList").style.display}`);

    // The shown row is the action the engine accepts: click one.
    const row = od.querySelector("#planList > li");
    const id = parseInt(row.textContent.match(/#(\d+)/)[1], 10);
    row.querySelector("button.primary").dispatchEvent(
      new one.dom.window.MouseEvent("click", { bubbles: true }));
    await new Promise(r => setTimeout(r, 300));
    const saved = JSON.parse(one.dom.window.localStorage.getItem("chaosTree.v1"));
    ok("tree planner: a jump row unlocks its displayed node",
      saved.states.tj.unlocked.includes(id), `id=${id}`);
    one.dom.window.close();

    const three = await bootJump([{ kind: "choice", tier: null, n: 3, category: "item" }]);
    const threeText = three.rows.map(li => li.textContent).join(" | ");
    ok("tree planner: a choice-3 ticket unions each launch's three closest",
      three.rows.length === 4 &&
      /Gae Bolg/.test(threeText) && /Excalibur/.test(threeText) &&
      /Laevatein/.test(threeText) && /Vorpal Blade/.test(threeText),
      threeText);
    three.dom.window.close();
  }

  // ---------- shared views keep the owner's actual jump picks ----------
  {
    const { dom: src } = await boot("tree.html");
    const w = src.window;
    const N = (id, file, name, x, rarity) => ({
      id, file, number: id, name, rarity, source: "Test", tag: "both",
      description: "x", meta: [], tags: [], pos: [x, 0, 0], r: x,
    });
    const payloadFor = (nodes, edges, unlocked) => {
      const rt = w.ChaosGen.buildRuntime({ nodes, edges });
      const st = Object.assign(w.ChaosEngine.newState(), {
        points: 1e9, cores: 10,
        inventory: [{ kind: "jump", tier: null, category: "item" }],
        unlocked: unlocked || [0, 1],
      });
      const payload = w.ChaosShare.collect(null, rt, st, { name: "Shared jump" });
      w.ChaosShare.validate(payload);
      return payload;
    };
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const openJumpPlanner = async payload => {
      const { dom, errors } = await boot(
        "tree.html?share=https%3A%2F%2Fexample.com%2Fraw", null, payload);
      await wait(500);
      const vw = dom.window, vd = vw.document;
      vd.querySelector('#tabs button[data-tab="tickets"]').dispatchEvent(
        new vw.MouseEvent("click", { bubbles: true }));
      vd.getElementById("planToggle").dispatchEvent(
        new vw.MouseEvent("click", { bubbles: true }));
      vd.getElementById("planScope").value = "jump";
      vd.getElementById("planScope").dispatchEvent(
        new vw.Event("change", { bubbles: true }));
      await wait(250);
      return {
        dom, errors,
        rows: [...vd.querySelectorAll("#planList > li")],
        count: vd.getElementById("planCount").textContent,
        invSelects: [...vd.querySelectorAll("#invList select")].map(sel =>
          [...sel.options].map(o => o.textContent)),
      };
    };

    // A hidden node is the real closest pick; the visible item is farther.
    const hiddenPayload = payloadFor([
      N(0, "__root__", "Origin", 0, 0),
      N(1, "ability", "Launch", 5, 1),
      N(2, "item", "Distant Visible Item", 20, 3),
      N(4, "item", "Hidden Jump Item", 6, 4),
      N(5, "ability", "Stepping Stone", 6.5, 2),
    ], [
      { a: 0, b: 1, d: 5 }, { a: 0, b: 2, d: 20 },
      { a: 0, b: 5, d: 6.5 }, { a: 4, b: 5, d: 0.5 },
    ]);
    ok("share: jumpReach records the owner's hidden pick",
      Array.isArray(hiddenPayload.view.jumpReach) &&
      hiddenPayload.view.jumpReach.some(h => h.id === 4 && h.from === 1),
      JSON.stringify(hiddenPayload.view.jumpReach));
    ok("share: a farther visible node is not recorded as the jump pick",
      !hiddenPayload.view.jumpReach.some(h => h.id === 2));
    ok("share: jump target node data travels with the snapshot",
      hiddenPayload.view.jumpNodes.some(nd => nd.id === 4 &&
        nd.name === "Hidden Jump Item"));
    const hidden = await openJumpPlanner(hiddenPayload);
    const hiddenText = hidden.rows.map(li => li.textContent).join(" | ");
    ok("share: shared planner names the hidden jump target",
      hidden.rows.length === 1 && /#4 Hidden Jump Item/.test(hiddenText) &&
      /from #1/.test(hiddenText) && /2 hops/.test(hiddenText) &&
      !/Hidden node/.test(hiddenText), hiddenText);
    ok("share: shared planner does not invent a visible jump target",
      !/Distant Visible Item/.test(hiddenText), hiddenText);
    const hiddenPick = (hidden.invSelects[1] || []).join(" | ");
    ok("share: inventory jump picker uses the shared jump targets",
      hidden.invSelects.length >= 2 &&
      /#4 Hidden Jump Item/.test(hiddenPick) &&
      !/Distant Visible Item/.test(hiddenPick), hiddenPick);
    ok("share: shared planner has no page errors", hidden.errors.length === 0,
      hidden.errors[0]);
    hidden.dom.window.close();

    // Snapshots made before jumpReach only recorded hidden picks. Their
    // ranks still let the viewer reconstruct the real jumps and drop a
    // visible node that was never actually in reach.
    const legacyPayload = JSON.parse(JSON.stringify(hiddenPayload));
    delete legacyPayload.view.jumpReach;
    delete legacyPayload.view.jumpNodes;
    legacyPayload.view.hiddenReach.jump.push({ id: 4, from: 0, ticket: 0, rank: 0 });
    w.ChaosShare.validate(legacyPayload);
    const legacy = await openJumpPlanner(legacyPayload);
    const legacyText = legacy.rows.map(li => li.textContent).join(" | ");
    ok("share: legacy snapshot reconstructs the hidden jump target",
      legacy.rows.length === 1 && /Hidden node #4/.test(legacyText) &&
      /from #1/.test(legacyText) && !/from #0/.test(legacyText), legacyText);
    ok("share: legacy snapshot drops the fake visible jump target",
      !/Distant Visible Item/.test(legacyText), legacyText);
    const legacyPick = (legacy.invSelects[1] || []).join(" | ");
    ok("share: legacy inventory jump picker keeps the real target",
      /#4/.test(legacyPick) && !/Distant Visible Item/.test(legacyPick), legacyPick);
    legacy.dom.window.close();

    // A visible jump target keeps its full node data.
    const visiblePayload = payloadFor([
      N(0, "__root__", "Origin", 0, 0),
      N(1, "ability", "Launch", 5, 1),
      N(2, "item", "Near Item", 6, 3),
      N(3, "item", "Far Item", 7, 4),
    ], [
      { a: 0, b: 1, d: 5 }, { a: 0, b: 2, d: 6 }, { a: 0, b: 3, d: 7 },
    ]);
    const visible = await openJumpPlanner(visiblePayload);
    const visibleText = visible.rows.map(li => li.textContent).join(" | ");
    ok("share: shared planner keeps a visible jump target and its name",
      visible.rows.length === 1 && /#2 Near Item/.test(visibleText) &&
      !/Hidden node/.test(visibleText), visibleText);
    visible.dom.window.close();

    // Two launches can share the same closest target: keep both in the
    // ticket's launch dropdown, but show the target once in the planner.
    const duplicatePayload = payloadFor([
      N(0, "__root__", "Origin", 0, 0),
      N(1, "ability", "Launch A", 5, 1),
      N(2, "item", "Far Item", 20, 3),
      N(5, "ability", "Launch B", 7, 2),
      N(7, "item", "Shared Target", 6, 4),
      N(8, "ability", "Stepping Stone", 6, 2),
    ], [
      { a: 0, b: 1, d: 5 }, { a: 0, b: 2, d: 20 },
      { a: 0, b: 5, d: 7 }, { a: 0, b: 8, d: 6 }, { a: 7, b: 8, d: 0.5 },
    ], [0, 1, 5]);
    const sharedHits = duplicatePayload.view.jumpReach.filter(h => h.id === 7);
    ok("share: jumpReach keeps each launch's own pick",
      sharedHits.length === 2 && sharedHits.some(h => h.from === 1) &&
      sharedHits.some(h => h.from === 5), JSON.stringify(sharedHits));
    const duplicate = await openJumpPlanner(duplicatePayload);
    ok("share: planner dedupes a shared target across launches",
      duplicate.rows.length === 1 && /#7 Shared Target/.test(
        duplicate.rows[0].textContent));
    const dupFroms = (duplicate.invSelects[0] || []).join(" | ");
    ok("share: ticket dropdown keeps both launch nodes", /#1 Launch A/.test(dupFroms) &&
      /#5 Launch B/.test(dupFroms), dupFroms);
    ok("share: ticket picker shows the shared target",
      (duplicate.invSelects[1] || []).some(o => /#7 Shared Target/.test(o)),
      (duplicate.invSelects[1] || []).join(" | "));
    duplicate.dom.window.close();
    src.window.close();
  }

  console.log(failures ? `${failures} FAILURES` : "ALL PASS");
  } finally {
    server.kill();
    process.exitCode = failures ? 1 : 0;
  }
})().catch(e => {
  console.log("FAIL harness:", e && e.stack || e);
  process.exitCode = 1;
});
