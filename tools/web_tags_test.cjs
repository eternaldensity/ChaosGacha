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

function boot(page) {
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

  console.log(failures ? `${failures} FAILURES` : "ALL PASS");
  } finally {
    server.kill();
    process.exit(failures ? 1 : 0);
  }
})().catch(e => { console.log("FAIL harness:", e && e.stack || e); process.exit(1); });
