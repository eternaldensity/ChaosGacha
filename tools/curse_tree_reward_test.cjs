"use strict";
/* Real-interface test: Curse Roulette tree rewards.
 *
 * Boots curse.html in jsdom, seeds a Chaos Tree save, spins deterministically,
 * sends the reward, and checks the tree wallet/inventory plus the gacha
 * fallback and no-tree error. Usage: node tools/curse_tree_reward_test.cjs
 */
const fs = require("fs");
const path = require("path");
const http = require("http");
const { spawn } = require("child_process");
const { JSDOM, VirtualConsole } = require("jsdom");

const REPO = path.resolve(__dirname, "..");
const PORT = 8152;
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
      http.get(BASE + "curse.html", res => { res.resume(); resolve(proc); })
        .on("error", () => {
          if (Date.now() > deadline) reject(new Error("web server did not start"));
          else setTimeout(ping, 150);
        });
    })();
  });
}

function boot(page, seed) {
  const vc = new VirtualConsole();
  const errors = [];
  vc.on("jsdomError", e => errors.push(e.message));
  vc.on("error", e => errors.push(String(e)));
  const dom = new JSDOM(fs.readFileSync(path.join(REPO, "web", page), "utf8"), {
    url: BASE + page, runScripts: "dangerously", resources: "usable",
    pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      if (seed) for (const [k, v] of Object.entries(seed)) w.localStorage.setItem(k, v);
      const noop = () => {};
      const ctx = new Proxy({}, {
        get: (t, k) => (k in t ? t[k] : noop),
        set: (t, k, v) => { t[k] = v; return true; },
      });
      w.HTMLCanvasElement.prototype.getContext = () => ctx;
      if (!w.Path2D) w.Path2D = class { constructor() {} moveTo() {} lineTo() {} arc() {} closePath() {} };
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
const curseSeed = settings => JSON.stringify({ history: [], settings });

(async () => {
  const server = await startServer();
  try {
    // ---- direct mapping: gacha defaults stay untouched -------------------
    {
      const { dom, errors } = await boot("curse.html", {
        "chaosCurse.v1": curseSeed({ spin: "off" }),
      });
      const w = dom.window, C = w.__curse;
      ok("curse: boots without errors", errors.length === 0, errors[0]);
      const r = tier => JSON.stringify(C.treeRewardFor(tier));
      ok("curse: Minor -> gold skip 2", r("Minor") === JSON.stringify([{ kind: "skip", tier: "gold", n: 2 }]), r("Minor"));
      ok("curse: Medium -> gold skip 3", r("Medium") === JSON.stringify([{ kind: "skip", tier: "gold", n: 3 }]), r("Medium"));
      ok("curse: Major -> gold choice 3 jump", r("Major") === JSON.stringify([{ kind: "choice", tier: "gold", n: 3 }]), r("Major"));
      ok("curse: Severe -> platinum skip 4", r("Severe") === JSON.stringify([{ kind: "skip", tier: "platinum", n: 4 }]), r("Severe"));
      ok("curse: Ultimate -> platinum choice 4 jump", r("Ultimate") === JSON.stringify([{ kind: "choice", tier: "platinum", n: 4 }]), r("Ultimate"));
      const med = C.rewardFor("Medium");
      ok("curse: gacha Medium still Advantage gold",
        med.length === 1 && med[0].tier === "gold" && med[0].adv === 2, JSON.stringify(med));
      ok("curse: gacha Major still uses the chosen category",
        C.rewardFor("Major", "item")[0].cat === "item");
      ok("curse: tree spec strings round-trip",
        C.treeSpec({ kind: "skip", tier: "gold", n: 3 }) === "gold skip3" &&
        C.treeSpec({ kind: "choice", tier: "platinum", n: 4 }) === "platinum choice 4 jump");
      dom.window.close();
    }

    // ---- tree destination: send to the active tree ------------------------
    {
      const { dom, errors } = await boot("curse.html", {
        "chaosCurse.v1": curseSeed({ spin: "off", target: "tree" }),
        "chaosTree.v1": JSON.stringify(treeSeed),
      });
      const w = dom.window, d = w.document;
      ok("curse: tree-target page boots", errors.length === 0, errors[0]);
      ok("curse: target select persisted",
        d.getElementById("rewardTarget").value === "tree");
      ok("curse: target note names the active tree",
        /Test Tree/.test(d.getElementById("rewardTargetNote").textContent),
        d.getElementById("rewardTargetNote").textContent);

      w.Math.random = () => 0.3; // d20 7 = Medium -> gold skip 3
      d.getElementById("spinBtn").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
      const body = d.getElementById("resultBody").textContent;
      ok("curse: tree result shows the skip ticket", /gold skip 3/.test(body), body);
      ok("curse: result shows the tree points/core payout",
        /5,000\.00 pts/.test(body) && /\+1 core/.test(body), body);
      ok("curse: category picker hidden for tree rewards",
        d.getElementById("rewardRow").style.display === "none");
      ok("curse: send button names the tree",
        d.getElementById("rewardBtn").textContent === "Send reward to active tree",
        d.getElementById("rewardBtn").textContent);

      d.getElementById("rewardBtn").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
      const saved = JSON.parse(w.localStorage.getItem("chaosTree.v1") || "{}");
      const st = saved.states && saved.states.t1;
      ok("curse: tree points include the gold tier", st && st.points === 5100, st && String(st.points));
      ok("curse: tree cores include one core", st && st.cores === 3, st && String(st.cores));
      ok("curse: tree inventory has the skip ticket",
        st && st.inventory.length === 1 &&
        st.inventory[0].kind === "skip" && st.inventory[0].tier === "gold" &&
        st.inventory[0].n === 3, JSON.stringify(st && st.inventory));
      ok("curse: toast names the tree and payout",
        /Sent gold skip 3 to "Test Tree"/.test(d.getElementById("toast").textContent),
        d.getElementById("toast").textContent);
      ok("curse: sent button is disabled",
        d.getElementById("rewardBtn").disabled &&
        /Reward sent/.test(d.getElementById("rewardBtn").textContent));

      // A second click must not duplicate the reward.
      d.getElementById("rewardBtn").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
      const saved2 = JSON.parse(w.localStorage.getItem("chaosTree.v1") || "{}");
      ok("curse: re-click does not duplicate the tree reward",
        saved2.states.t1.inventory.length === 1 && saved2.states.t1.points === 5100,
        JSON.stringify(saved2.states.t1));

      // Ultimate -> platinum Choice 4 Jump; the tree engine must parse it.
      w.Math.random = () => 0.99; // d20 20
      d.getElementById("spinBtn").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
      ok("curse: Ultimate result is a platinum choice ticket",
        /platinum choice 4 jump/.test(d.getElementById("resultBody").textContent),
        d.getElementById("resultBody").textContent);
      d.getElementById("rewardBtn").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
      const saved3 = JSON.parse(w.localStorage.getItem("chaosTree.v1") || "{}");
      const st3 = saved3.states.t1;
      ok("curse: Ultimate choice ticket lands in the tree inventory",
        st3.inventory.length === 2 &&
        st3.inventory[1].kind === "choice" && st3.inventory[1].tier === "platinum" &&
        st3.inventory[1].n === 4, JSON.stringify(st3.inventory));
      ok("curse: Ultimate adds platinum points and a core",
        st3.points === 55100 && st3.cores === 4,
        `points=${st3.points} cores=${st3.cores}`);
      dom.window.close();
    }

    // ---- no active tree: report instead of silently dropping -------------
    {
      const { dom } = await boot("curse.html", {
        "chaosCurse.v1": curseSeed({ spin: "off", target: "tree" }),
      });
      const w = dom.window, d = w.document;
      ok("curse: missing tree is explained in the note",
        /No Chaos Tree found/.test(d.getElementById("rewardTargetNote").textContent),
        d.getElementById("rewardTargetNote").textContent);
      w.Math.random = () => 0.3;
      d.getElementById("spinBtn").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
      d.getElementById("rewardBtn").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
      ok("curse: missing tree reports an error",
        /No Chaos Tree found/.test(d.getElementById("toast").textContent),
        d.getElementById("toast").textContent);
      ok("curse: missing tree writes no tree save",
        w.localStorage.getItem("chaosTree.v1") == null);
      dom.window.close();
    }

    // ---- gacha destination still works, incl. category changes after spin
    {
      const { dom } = await boot("curse.html", {
        "chaosCurse.v1": curseSeed({ spin: "off" }), // default gacha target
      });
      const w = dom.window, d = w.document;
      ok("curse: default destination is gacha",
        d.getElementById("rewardTarget").value === "gacha");
      w.Math.random = () => 0.68; // d20 14 = Major
      d.getElementById("spinBtn").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
      ok("curse: gacha Major shows the category picker",
        d.getElementById("rewardRow").style.display === "flex");
      d.getElementById("rewardCat").value = "item";
      d.getElementById("rewardCat").dispatchEvent(new w.Event("change", { bubbles: true }));
      ok("curse: changing category updates the shown reward",
        /gold item/.test(d.getElementById("resultBody").textContent),
        d.getElementById("resultBody").textContent.slice(-90));
      d.getElementById("rewardBtn").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
      const wallet = JSON.parse(w.localStorage.getItem("chaosGacha.v1") || "null");
      ok("curse: gacha reward still reaches the wallet",
        wallet && wallet.tickets.length === 1 && wallet.tickets[0].cat === "item",
        JSON.stringify(wallet && wallet.tickets));
      dom.window.close();
    }

    console.log(failures ? `${failures} FAILURES` : "ALL PASS");
  } finally {
    server.kill();
    process.exit(failures ? 1 : 0);
  }
})().catch(e => { console.log("FAIL harness:", e && e.stack || e); process.exit(1); });
