"use strict";
/* Boot: input wiring + title screen + first run. Depends on: all modules. */
(function (C) {
  C.audio.ensure();
  addEventListener("keydown", e => {
    C.audio.ensure(); C.audio.resume();
    if (e.key.toLowerCase() === "m" && C.G && !C.G.title) {
      const muted = C.audio.toggle();
      C.showCard(muted ? "🔇 Muted (M)" : "🔊 Sound on (M)", "", "", 1200);
      return;
    }
    if (e.key === "Escape" && C.G && C.G.draft) { C.closeDraft(); return; }
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(e.key)) e.preventDefault();
    C.keys[e.key.toLowerCase()] = true;
    const k = e.key.toLowerCase();
    if (k === "enter" && C.G && C.G.title) C.startGame();
    else if (k === "enter" && C.G && C.G.over) C.newRun(false);
    else if (k === "r" && C.G && C.G.over) C.newRun(false);
    else if (k === "t" && C.G && C.G.over) { C.wipeLegacy(); C.newRun(false); }
  });
  addEventListener("keyup", e => { C.keys[e.key.toLowerCase()] = false; });
  C.ui.canvas.addEventListener("mousedown", () => { C.queueAttack(); });
  C.audio.ensure();
  C.el("againBtn").addEventListener("click", () => { C.audio.ensure(); C.audio.click(); C.newRun(false); });
  C.el("curseBtn").addEventListener("click", () => C.rollCurse());
  C.el("curseNextBtn").addEventListener("click", () => C.rollCurseNext());
  C.ui.freshBtn.addEventListener("click", () => { C.wipeLegacy(); C.newRun(false); });
  C.ui.startBtn.addEventListener("click", () => { C.audio.ensure(); C.audio.click(); C.startGame(); });

  C.newRun(true);
  requestAnimationFrame(C.frame);
})(window.Casino);
