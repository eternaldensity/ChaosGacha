"use strict";
/* Advantage-style draft: when slots are full (or via B), pick which power
 * holds each slot instead of silently stashing. Game sim pauses while open.
 * Depends on: config, dom, state, effects (runtime). */
(function (C) {
  function slotLine(ab, i) {
    return "[" + C.SLOT_KEYS[i] + "] " + ab.name + " — " + ab.op +
      (ab.element ? "/" + ab.element : "") +
      (ab.cdLeft > 0 ? " (" + ab.cdLeft.toFixed(0) + "s cd)" : "");
  }

  function abLine(ab) {
    return ab.name + " — " + ab.op +
      (ab.element ? "/" + ab.element : "") + " — " + ab.blurb;
  }

  C.openDraft = function (mode) {
    if (C.G.draft) return;
    C.G.draft = mode;
    render();
    C.ui.draftBox.classList.remove("hide");
  };

  C.closeDraft = function () {
    if (!C.G || !C.G.draft) return;
    C.G.draft = null;
    C.ui.draftBox.classList.add("hide");
  };

  // Swap a stashed ability into slot i (attuning: 8s cooldown, Doc rule).
  C.draftSwap = function (slotIdx) {
    const G = C.G, mode = G.draft;
    if (!mode) return;
    const from = mode.kind === "new"
      ? G.p.stash.indexOf(mode.ab)
      : G.p.stash.indexOf(mode.pick);
    const ab = mode.kind === "new" ? mode.ab : mode.pick;
    if (!ab || from < 0) { C.closeDraft(); return; }
    G.p.stash.splice(from, 1);
    const old = G.p.slots[slotIdx];
    G.p.slots[slotIdx] = ab;
    if (old) G.p.stash.push(old);
    ab.cdLeft = Math.max(ab.cdLeft || 0, 8);
    C.showCard("Slotted [" + C.SLOT_KEYS[slotIdx] + "]: " + ab.name,
      ab.blurb + " (attuning 8s).", old ? "Swapped out: " + old.name + " (stashed)." : "", 3000);
    C.closeDraft();
    C.updateHud();
  };

  // Manage mode: choose a stashed ability first, then a slot.
  C.draftPickStash = function (idx) {
    const G = C.G;
    if (!G.draft || G.draft.kind !== "manage") return;
    G.draft.pick = G.p.stash[idx];
    render();
  };

  function render() {
    const G = C.G, mode = G.draft;
    const box = C.ui.draftList;
    box.innerHTML = "";
    const el = (tag, txt, cls) => {
      const d = document.createElement(tag);
      if (txt) d.textContent = txt;
      if (cls) d.className = cls;
      return d;
    };
    if (mode.kind === "new") {
      box.appendChild(el("p", "Slots full! New pull: " + abLine(mode.ab)));
      box.appendChild(el("p", "Take it into a slot (old power stashes), or keep your loadout:", "small"));
      G.p.slots.forEach((s, i) => {
        const b = el("button", "Take [" + C.SLOT_KEYS[i] + "], stash " + s.name, "draftBtn");
        b.addEventListener("click", () => C.draftSwap(i));
        box.appendChild(b);
      });
      const keep = el("button", "Keep loadout (stash " + mode.ab.name + ")", "draftBtn dim");
      keep.addEventListener("click", () => C.closeDraft());
      box.appendChild(keep);
    } else {
      if (!G.p.stash.length) {
        box.appendChild(el("p", "Stash is empty. New powers land here when slots are full."));
      } else {
        box.appendChild(el("p", "1) pick a stashed power" +
          (mode.pick ? ": " + mode.pick.name + " — 2) pick a slot:" : ""), "small"));
        G.p.stash.forEach((s, i) => {
          const b = el("button", (mode.pick === s ? "▶ " : "") + abLine(s),
            "draftBtn" + (mode.pick === s ? " sel" : ""));
          b.addEventListener("click", () => C.draftPickStash(i));
          box.appendChild(b);
        });
        if (mode.pick) {
          G.p.slots.forEach((s, i) => {
            const b = el("button", "Into [" + C.SLOT_KEYS[i] + "] (stash " + s.name + ")", "draftBtn");
            b.addEventListener("click", () => C.draftSwap(i));
            box.appendChild(b);
          });
        }
      }
      const done = el("button", "Done (Esc)", "draftBtn dim");
      done.addEventListener("click", () => C.closeDraft());
      box.appendChild(done);
    }
    C.ui.draftTitle.textContent = mode.kind === "new" ? "🎰 Slots full — draft!" : "🎒 Stash manager";
  }
})(window.Casino);
