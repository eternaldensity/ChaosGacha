"use strict";
/* Boot: input wiring + title screen + first run. Depends on: all modules. */
(function (C) {
  addEventListener("keydown", e => {
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(e.key)) e.preventDefault();
    C.keys[e.key.toLowerCase()] = true;
    const k = e.key.toLowerCase();
    if (k === "enter" && C.G && C.G.title) C.startGame();
    else if (k === "enter" && C.G && C.G.over) C.newRun(false);
    else if (k === "r" && C.G && C.G.over) C.newRun(false);
  });
  addEventListener("keyup", e => { C.keys[e.key.toLowerCase()] = false; });
  C.ui.canvas.addEventListener("mousedown", () => { C.queueAttack(); });
  C.el("againBtn").addEventListener("click", () => C.newRun(false));
  C.ui.startBtn.addEventListener("click", () => C.startGame());

  C.newRun(true);
  requestAnimationFrame(C.frame);
})(window.Casino);
