"use strict";
/* Real-interface test: CYOA Story Start -> gacha wallet or active Chaos Tree.
 * Boots docs.html in jsdom and drives the actual start buttons. */
const fs = require("fs");
const path = require("path");
const http = require("http");
const { spawn } = require("child_process");
const { JSDOM, VirtualConsole } = require("jsdom");

const REPO = path.resolve(__dirname, "..");
const PORT = 8153;
const BASE = `http://127.0.0.1:${PORT}/`;
let failures = 0;
function ok(name, cond, extra) {
  if (cond) console.log(`ok ${name}`);
  else { failures++; console.log(`FAIL ${name}${extra ? ": " + extra : ""}`); }
}

function startServer() {
  const proc = spawn("python3", ["-m", "http.server", String(PORT)],
    { cwd: path.join(REPO, "web"), stdio: "ignore" });
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 8000;
    (function ping() {
      http.get(BASE + "docs.html", res => { res.resume(); resolve(proc); })
        .on("error", () => {
          if (Date.now() > deadline) reject(new Error("web server did not start"));
          else setTimeout(ping, 150);
        });
    })();
  });
}

function boot(seed) {
  const vc = new VirtualConsole();
  const errors = [];
  vc.on("jsdomError", e => errors.push(e.message));
  vc.on("error", e => errors.push(String(e)));
  const dom = new JSDOM(fs.readFileSync(path.join(REPO, "web", "docs.html"), "utf8"), {
    url: BASE + "docs.html", runScripts: "dangerously", resources: "usable",
    pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      if (seed) for (const [k, v] of Object.entries(seed)) w.localStorage.setItem(k, v);
    },
  });
  return new Promise(resolve => {
    dom.window.addEventListener("load", () => setTimeout(() => resolve({ dom, errors }), 40));
  });
}

const treeSeed = {
  trees: [{
    id: "t1", name: "Test Tree", seed: 2, params: {}, limit: 800,
    filters: {}, dataVersion: "test", static: false, createdAt: 1,
  }],
  states: {
    t1: {
      points: 100, cores: 2, inventory: [], unlocked: [0],
      meta_used: {}, added_links: [], swaps: [], entry_swaps: [],
      reveal_temp_until: 0, history: [], echo_used: 0,
    },
  },
  activeId: "t1", guideSeen: true, settings: {},
};

(async () => {
  const server = await startServer();
  try {
    // ---- mapping and gacha defaults --------------------------------------
    {
      const { dom, errors } = await boot({});
      const w = dom.window, D = w.__docs;
      ok("docs: boots without errors", errors.length === 0, errors[0]);
      ok("docs: gacha STARS unchanged",
        D.STARTS.transmigration.length === 3 &&
        D.STARTS.changed2.length === 1 && D.STARTS.changed2[0].adv === 3);
      const names = list => list.map(t => `${t.tier}${t.twin ? " twin" : ""}`).join(",");
      ok("docs: transmigration tree start is 3 gold twins",
        names(D.TREE_STARTS.transmigration) === "gold twin,gold twin,gold twin",
        names(D.TREE_STARTS.transmigration));
      ok("docs: native tree starts keep their tiers",
        names(D.TREE_STARTS.native1) === "gold twin" &&
        names(D.TREE_STARTS.native2) === "silver twin,silver twin" &&
        names(D.TREE_STARTS.native3) === "bronze twin,bronze twin,bronze twin",
        names(D.TREE_STARTS.native3));
      ok("docs: changed1 is platinum + 2 gold twins",
        names(D.TREE_STARTS.changed1) === "platinum twin,gold twin,gold twin",
        names(D.TREE_STARTS.changed1));
      ok("docs: changed2 triple-advantage becomes 3 platinum twins",
        names(D.TREE_STARTS.changed2) === "platinum twin,platinum twin,platinum twin",
        names(D.TREE_STARTS.changed2));

      // default destination is still the gacha wallet
      w.document.getElementById("cyoa-transmigration")
        .dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
      const wallet = JSON.parse(w.localStorage.getItem("chaosGacha.v1") || "null");
      ok("docs: gacha start still seeds the ticket wallet",
        wallet && wallet.tickets.length === 3 &&
        wallet.tickets.every(t => t.tier === "gold"), JSON.stringify(wallet && wallet.tickets));
      dom.window.close();
    }

    // ---- tree destination: twin tickets pay 2 cores each ------------------
    {
      const { dom, errors } = await boot({
        "chaosTree.v1": JSON.stringify(treeSeed),
      });
      const w = dom.window, d = w.document;
      ok("docs: tree-target page boots", errors.length === 0, errors[0]);
      ok("docs: destination defaults to gacha",
        d.getElementById("cyoaTarget").value === "gacha");
      const sel = d.getElementById("cyoaTarget");
      sel.value = "tree";
      sel.dispatchEvent(new w.Event("change", { bubbles: true }));
      ok("docs: switching destination shows the active tree",
        /Test Tree/.test(d.getElementById("cyoaTargetNote").textContent),
        d.getElementById("cyoaTargetNote").textContent);
      ok("docs: destination choice persists",
        JSON.parse(w.localStorage.getItem("chaosDocs.v1") || "{}").settings.target === "tree");

      d.getElementById("cyoa-transmigration")
        .dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
      let saved = JSON.parse(w.localStorage.getItem("chaosTree.v1") || "{}");
      let st = saved.states.t1;
      ok("docs: tree transmigration adds 6 cores", st.cores === 8, String(st.cores));
      ok("docs: tree transmigration adds gold tier points", st.points === 15100, String(st.points));
      ok("docs: plain twin tickets do not clutter the inventory",
        st.inventory.length === 0, JSON.stringify(st.inventory));
      ok("docs: tree start explains the payout",
        /6 cores/.test(d.getElementById("toast").textContent) &&
        /15,000\.00 pts/.test(d.getElementById("toast").textContent),
        d.getElementById("toast").textContent);

      d.getElementById("cyoa-changed2")
        .dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
      saved = JSON.parse(w.localStorage.getItem("chaosTree.v1") || "{}");
      st = saved.states.t1;
      ok("docs: changed2 adds three platinum twins (6 more cores)",
        st.cores === 14, String(st.cores));
      ok("docs: changed2 adds platinum tier points",
        st.points === 165100, String(st.points));
      ok("docs: changed2 still leaves the inventory empty",
        st.inventory.length === 0, JSON.stringify(st.inventory));
      dom.window.close();
    }

    // ---- no tree: report instead of silently dropping the start -----------
    {
      const { dom } = await boot({
        "chaosDocs.v1": JSON.stringify({ settings: { target: "tree" } }),
      });
      const w = dom.window, d = w.document;
      ok("docs: missing tree is explained in the note",
        /No Chaos Tree found/.test(d.getElementById("cyoaTargetNote").textContent),
        d.getElementById("cyoaTargetNote").textContent);
      d.getElementById("cyoa-transmigration")
        .dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
      ok("docs: missing tree shows the start error",
        /No Chaos Tree found/.test(d.getElementById("toast").textContent),
        d.getElementById("toast").textContent);
      ok("docs: missing tree writes no tree save",
        w.localStorage.getItem("chaosTree.v1") == null);
      ok("docs: start button reports the missing tree",
        /No active tree/.test(d.getElementById("cyoa-transmigration").textContent));
      dom.window.close();
    }

    console.log(failures ? `${failures} FAILURES` : "ALL PASS");
  } finally {
    server.kill();
    process.exit(failures ? 1 : 0);
  }
})().catch(e => { console.log("FAIL harness:", e && e.stack || e); process.exit(1); });
