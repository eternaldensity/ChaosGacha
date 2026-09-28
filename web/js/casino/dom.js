"use strict";
/* DOM refs + card/overlay UI. Depends on: config (namespace only). */
(function (C) {
  function el(id) { return document.getElementById(id); }
  C.el = el;

  const slotReels = el("slotReels");
  C.ui = {
    overlay: el("reelOverlay"),
    reelTitle: el("reelTitle"),
    slotReels,
    sreels: [...slotReels.querySelectorAll(".sreel")],
    gachaReel: el("gachaReel"),
    chanBar: el("chanBar"),
    reelSub: el("reelSub"),
    card: el("card"),
    cardTitle: el("cardTitle"),
    cardBody: el("cardBody"),
    cardSub: el("cardSub"),
    deathBox: el("death"),
    deathStats: el("deathStats"),
    deathLegacy: el("deathLegacy"),
    canvas: el("game"),
  };
  C.ctx = C.ui.canvas.getContext("2d");
  C.ctx.imageSmoothingEnabled = false;

  C.showCard = function (t, b, s, ms) {
    C.ui.cardTitle.textContent = t;
    C.ui.cardBody.textContent = b || "";
    C.ui.cardSub.textContent = s || "";
    C.ui.card.classList.add("show");
    if (C.G) C.G.cardT = (ms || 3500) / 1000;
  };

  C.hideDeath = function () { C.ui.deathBox.classList.remove("show"); };

  // Show the reel overlay for a pull: 3 boxes for slots, 1 bar for gacha.
  C.showPullOverlay = function (machine, tier) {
    const isSlot = machine.kind === "slot";
    C.ui.overlay.classList.add("show");
    C.ui.slotReels.style.display = isSlot ? "flex" : "none";
    C.ui.gachaReel.style.display = isSlot ? "none" : "flex";
    C.ui.sreels.forEach(s => s.classList.remove("locked"));
    C.ui.chanBar.style.width = "0%";
    C.ui.reelTitle.textContent = (isSlot ? "🎰 " : "🎲 ") + tier.label + " " + machine.kind + "…";
  };

  C.hidePullOverlay = function () { C.ui.overlay.classList.remove("show"); };
})(window.Casino);
