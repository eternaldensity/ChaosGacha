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

function boot(page, seed) {
  const vc = new VirtualConsole();
  const errors = [];
  // jsdom has no canvas backend; the tree 3D view logs that on boot.
  vc.on("jsdomError", e => {
    if (!/getContext/.test(e.message)) errors.push(e.message);
  });
  vc.on("error", e => errors.push(String(e)));
  const dom = new JSDOM(fs.readFileSync(path.join(REPO, "web", page), "utf8"), {
    url: BASE + page, runScripts: "dangerously", resources: "usable",
    pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      if (seed) for (const [k, v] of Object.entries(seed)) w.localStorage.setItem(k, v);
      // jsdom has no canvas backend: give the 3D view a no-op 2D context so
      // an active tree can boot and draw without throwing.
      const noop = () => {};
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
    ok("gacha: history entry carries the tag",
      (histTags.history || []).some(h => (h.tags || []).includes("holy")),
      JSON.stringify((histTags.history || [])[0] || {}).slice(0, 120));

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
      (hist2.history || []).some(h => (h.tags || []).includes("draconic")),
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
      trees: [{ id: "t1", name: "Stale tree", seed: 7, params: {}, limit: 60,
                filters: {}, dataVersion: "oldversion", static: false, createdAt: 1 }],
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

  // ---------- frozen content with no recorded version still warns ----------
  {
    // The silent case: the tree record has no dataVersion at all and its
    // snapshot was silently re-keyed to the current data. Content provenance
    // is the only thing that can flag it.
    const tree = JSON.stringify({
      trees: [{ id: "t2", name: "Unversioned tree", seed: 7, params: {}, limit: 60,
                filters: {}, static: false, createdAt: 1 }],
      states: { t2: { points: 0, cores: 0, inventory: [], unlocked: [0] } },
      activeId: "t2", guideSeen: true, settings: {},
    });
    const nodes = [{ id: 0, file: "__root__", name: "Origin", rarity: 0, pos: [0, 0, 0], r: 0 },
                   { id: 1, file: "ability", name: "HyperQbe the Streamer", rarity: 3.4,
                     source: "Q-UP", tag: "both", description: "old entry", meta: [], pos: [1, 0, 0], r: 1 }];
    const gen = JSON.stringify({ key: JSON.stringify([7, {}, {}, 60, "oldversion"]),
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
                filters: {}, dataVersion: "ee5d89ed5c", static: true, createdAt: 1 }],
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
                filters: {}, dataVersion: "ancient", static: true, createdAt: 1 }],
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

  // ---------- jump planner lists only actually pickable candidates ----------
  {
    const jumpNodes = [
      { id: 0, file: "__root__", number: 0, name: "Origin", rarity: 0,
        pos: [0, 0, 0], r: 0 },
      { id: 1, file: "ability", number: 1, name: "Super Jump",
        rarity: 0, source: "Generic", tag: "both", description: "x",
        meta: [], tags: [], pos: [5, 0, 0], r: 5 },
      { id: 2, file: "item", number: 2, name: "Gae Bolg",
        rarity: 5.3, source: "Fate", tag: "both", description: "x",
        meta: [], tags: [], pos: [6, 0, 0], r: 6 },
      { id: 3, file: "item", number: 3,
        name: "Excalibur the Sword of Promised Victory",
        rarity: 7, source: "Fate", tag: "both", description: "x",
        meta: [], tags: [], pos: [7, 0, 0], r: 7 },
      { id: 4, file: "item", number: 4, name: "Laevatein",
        rarity: 7.8, source: "Fate", tag: "both", description: "x",
        meta: [], tags: [], pos: [8, 0, 0], r: 8 },
    ];
    const jumpTopo = JSON.stringify({
      params: {}, nodes: jumpNodes,
      edges: jumpNodes.slice(1).map(nd => ({ a: 0, b: nd.id, d: nd.r })),
    });
    const bootJump = async (inventory) => {
      const db = JSON.stringify({
        trees: [{ id: "tj", name: "Jump planner", seed: 5, params: {}, limit: null,
                  filters: {}, dataVersion: null, static: true, createdAt: 1 }],
        states: { tj: { points: 1e9, cores: 50, inventory, unlocked: [0, 1] } },
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
    ok("tree planner: a jump ticket lists only the closest item",
      one.rows.length === 1 && /Gae Bolg/.test(one.rows[0].textContent),
      one.rows.map(li => li.textContent).join(" | "));
    ok("tree planner: that row is actionable",
      one.rows.length === 1 && /Jump →/.test(one.rows[0].textContent));
    one.dom.window.close();

    const three = await bootJump([{ kind: "choice", tier: null, n: 3, category: "item" }]);
    ok("tree planner: a choice-3 ticket lists the three closest items",
      three.rows.length === 3 &&
      /Gae Bolg/.test(three.rows.find(li => /Gae Bolg/.test(li.textContent)).textContent) &&
      /Excalibur/.test(three.rows.find(li => /Excalibur/.test(li.textContent)).textContent) &&
      /Laevatein/.test(three.rows.find(li => /Laevatein/.test(li.textContent)).textContent),
      three.rows.map(li => li.textContent).join(" | "));
    three.dom.window.close();
  }

  console.log(failures ? `${failures} FAILURES` : "ALL PASS");
  } finally {
    server.kill();
    process.exit(failures ? 1 : 0);
  }
})().catch(e => { console.log("FAIL harness:", e && e.stack || e); process.exit(1); });
