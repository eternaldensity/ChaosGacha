"use strict";
/* Boot: input wiring + first run. Depends on: all casino modules. */
(function (C) {
  addEventListener("keydown", e => {
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(e.key)) e.preventDefault();
    C.keys[e.key.toLowerCase()] = true;
    if (e.key.toLowerCase() === "r" && C.G && C.G.over) C.newRun();
  });
  addEventListener("keyup", e => { C.keys[e.key.toLowerCase()] = false; });
  C.ui.canvas.addEventListener("mousedown", () => { C.queueAttack(); });
  C.el("againBtn").addEventListener("click", () => C.newRun());

  C.newRun();
  requestAnimationFrame(C.frame);
})(window.Casino);
