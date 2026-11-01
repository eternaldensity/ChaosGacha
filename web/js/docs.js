"use strict";
/* Docs helper: CYOA "start here" buttons seed either the gacha ticket wallet
 * (localStorage key shared with gacha.html) or the active Chaos Tree. A
 * Triple-Advantage gacha ticket is one ticket that rolls three wheels; the
 * tree version uses Twin tickets instead, so the start buys more cores but
 * the same tier points (it still has to pay for every node it unlocks). */
(function () {
  var GLS = "chaosGacha.v1";
  var TLS = "chaosTree.v1";
  var DLS = "chaosDocs.v1";
  var E = window.ChaosEngine;

  function T(tier, cat, n) {
    var out = [];
    for (var i = 0; i < n; i++) out.push({ tier: tier, cat: cat });
    return out;
  }
  function TW(tier, n) {
    var out = [];
    for (var i = 0; i < n; i++) out.push({ tier: tier, twin: true });
    return out;
  }
  var STARTS = {
    transmigration: T("gold", "random", 3),
    native1: T("gold", "random", 1),
    native2: T("silver", "random", 2),
    native3: T("bronze", "random", 3),
    changed1: T("platinum", "random", 1).concat(T("gold", "random", 2)),
    changed2: [{ tier: "platinum", cat: "random", adv: 3 }]
  };
  // Every tree starter is a plain Twin ticket: +2 cores, normal tier points.
  // Changed Fate's triple-advantage platinum becomes three platinum twins.
  var TREE_STARTS = {
    transmigration: TW("gold", 3),
    native1: TW("gold", 1),
    native2: TW("silver", 2),
    native3: TW("bronze", 3),
    changed1: TW("platinum", 1).concat(TW("gold", 2)),
    changed2: TW("platinum", 3)
  };

  function uid() {
    return Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
  }
  function loadSettings() {
    try {
      var d = JSON.parse(localStorage.getItem(DLS) || "null");
      if (d && d.settings) return d.settings;
    } catch (e) {}
    return {};
  }
  function saveSettings(s) {
    try { localStorage.setItem(DLS, JSON.stringify({ settings: s })); } catch (e) {}
  }
  var SETTINGS = loadSettings();
  if (SETTINGS.target === undefined) SETTINGS.target = "gacha";
  function target() { return SETTINGS.target === "tree" ? "tree" : "gacha"; }

  function toast(msg, isErr) {
    var t = document.getElementById("toast");
    if (!t) return;
    t.textContent = msg;
    t.className = "toast" + (isErr ? " err" : "");
    t.style.display = "block";
    clearTimeout(t._h);
    t._h = setTimeout(function () { t.style.display = "none"; }, 3200);
  }

  function award(list) {
    var db;
    try {
      db = JSON.parse(localStorage.getItem(GLS) || "null") ||
        { tickets: [], history: [], settings: { spin: "normal", filters: {} } };
    } catch (e) {
      db = { tickets: [], history: [], settings: { spin: "normal", filters: {} } };
    }
    db.tickets = db.tickets || [];
    for (var i = 0; i < list.length; i++) {
      var ticket = { id: uid(), tier: list[i].tier, cat: list[i].cat };
      if ((list[i].adv | 0) > 1) ticket.adv = list[i].adv;
      db.tickets.push(ticket);
    }
    try { localStorage.setItem(GLS, JSON.stringify(db)); } catch (e) {}
    return list.length;
  }

  function activeTreeInfo() {
    var db;
    try {
      db = JSON.parse(localStorage.getItem(TLS) || "null");
    } catch (e) {
      return { error: "The Chaos Tree save is unreadable; open the tree app and export a backup." };
    }
    if (!db || !Array.isArray(db.trees) || !db.trees.length) {
      return { error: "No Chaos Tree found. Open the tree app and create or import a tree first." };
    }
    var tree = db.trees.find(function (t) { return t.id === db.activeId; }) || db.trees[0];
    if (!tree) return { error: "No active Chaos Tree found." };
    return { db: db, tree: tree };
  }
  function updateTargetNote() {
    var note = document.getElementById("cyoaTargetNote");
    if (!note) return;
    if (target() !== "tree") {
      note.textContent = "Tickets go to the gacha wallet.";
      return;
    }
    var info = activeTreeInfo();
    note.textContent = info.error || ("Active tree: " + info.tree.name);
  }
  // Award plain Twin tickets through the tree engine. Plain tickets are not
  // retained in the inventory: their whole value is the points and cores
  // paid out at award time, exactly like the tree's own Award button.
  function awardTree(list) {
    if (!E) throw new Error("The Chaos Tree engine failed to load; reload the page.");
    var info = activeTreeInfo();
    if (info.error) throw new Error(info.error);
    var db = info.db, tree = info.tree;
    db.states = db.states || {};
    var state = db.states[tree.id] || E.newState();
    state.points = Number(state.points) || 0;
    state.cores = Number(state.cores) || 0;
    state.inventory = Array.isArray(state.inventory) ? state.inventory : [];
    var pts = 0, cores = 0;
    for (var i = 0; i < list.length; i++) {
      var out = E.award(state, list[i].tier + " twin", 0, false, false, null);
      pts += out.pts;
      cores += out.cores;
    }
    db.states[tree.id] = state;
    if (db.activeId !== tree.id) db.activeId = tree.id;
    localStorage.setItem(TLS, JSON.stringify(db));
    return { tree: tree, count: list.length, pts: pts, cores: cores };
  }

  var targetSel = document.getElementById("cyoaTarget");
  if (targetSel) {
    targetSel.value = target();
    targetSel.addEventListener("change", function () {
      SETTINGS.target = targetSel.value === "tree" ? "tree" : "gacha";
      saveSettings(SETTINGS);
      updateTargetNote();
    });
  }
  window.addEventListener("focus", updateTargetNote);
  updateTargetNote();

  var btns = document.querySelectorAll(".cyoa-start");
  for (var i = 0; i < btns.length; i++) {
    (function (b) {
      b.addEventListener("click", function () {
        var key = b.getAttribute("data-start");
        var old = b.textContent;
        b.disabled = true;
        if (target() === "tree") {
          var tlist = TREE_STARTS[key] || [];
          if (!tlist.length) { b.disabled = false; return; }
          try {
            var res = awardTree(tlist);
            b.textContent = "Added " + res.count + " tree ticket" + (res.count === 1 ? "" : "s") + " ✓";
            toast("Added " + res.count + " Twin ticket" + (res.count === 1 ? "" : "s") +
              " to \"" + res.tree.name + "\": +" + res.cores + " cores, +" +
              E.fmt(res.pts) + " pts. Open/reload the Tree app to spend them.");
          } catch (e) {
            b.textContent = "No active tree";
            toast(e && e.message ? e.message : "Couldn't add the tree tickets.", true);
          }
          setTimeout(function () { b.textContent = old; b.disabled = false; }, 2600);
          return;
        }
        var list = STARTS[key] || [];
        if (!list.length) { b.disabled = false; return; }
        var n = award(list);
        b.textContent = "Added " + n + " ticket" + (n === 1 ? "" : "s") + " ✓ (see ticket wallet)";
        setTimeout(function () { b.textContent = old; b.disabled = false; }, 2600);
      });
    })(btns[i]);
  }
  window.__docs = {
    award: award, awardTree: awardTree, activeTreeInfo: activeTreeInfo,
    STARTS: STARTS, TREE_STARTS: TREE_STARTS, target: target
  };
})();
