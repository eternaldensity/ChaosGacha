"use strict";
/* Ticket display names + BBCode, shared by the gacha and tree apps.
 * Names follow the ticket anatomy from the docs: an optional Advantage (or
 * Twin) prefix, tier, category, optional theme tag, then the ticket type. */
window.ChaosTickets = (function () {
  const ADVANTAGE = {
    2: "Advantage",
    3: "Triple Advantage",
    4: "Quadruple Advantage",
    5: "Quintuple Advantage",
    6: "Sextuple Advantage",
    7: "Septuple Advantage",
    8: "Octuple Advantage",
    9: "Nonuple Advantage",
    10: "Decuple Advantage"
  };
  const FALLBACK_COLOR = "#9aa0b0";

  // Initial capitals on every word, preserving separators such as hyphens and
  // the significant "+" suffix tags use (anti-magic -> Anti-Magic, fire+ ->
  // Fire+).
  function title(value) {
    return String(value == null ? "" : value)
      .trim()
      .replace(/(^|[\s_-])([a-z])/g, (m, lead, ch) => lead + ch.toUpperCase());
  }

  function advantage(n) {
    n = parseInt(n, 10) || 1;
    if (n <= 1) return "";
    return ADVANTAGE[n] || `${n}X Advantage`;
  }

  function join(parts) {
    return parts.filter(Boolean).join(" ");
  }

  function gacha(ticket) {
    ticket = ticket || {};
    return join([
      advantage(ticket.adv),
      ticket.tier ? title(ticket.tier) : "",
      ticket.tag ? title(ticket.tag) : "",
      ticket.cat ? title(ticket.cat) : "",
      "Gacha Ticket"
    ]);
  }

  function tree(ticket) {
    ticket = ticket || {};
    const kind = ticket.kind || "plain";
    const n = parseInt(ticket.n, 10) || 2;
    const parts = [
      ticket.twin ? "Twin" : "",
      ticket.tier ? title(ticket.tier) : "",
      ticket.tag ? title(ticket.tag) : "",
      ticket.cat ? title(ticket.cat) : ""
    ];
    if (kind === "coupon") {
      parts.push("Coupon");
    } else {
      if (kind === "skip") parts.push(`Skip ${n}`);
      else if (kind === "choice") parts.push(`Choice ${n} Jump`);
      else if (kind === "jump") parts.push("Jump");
      else if (kind === "hop") parts.push("Hop");
      parts.push("Gacha Ticket");
    }
    return join(parts);
  }

  function tierColor(tier, tiers) {
    const hit = (tiers || []).find(t => t.name === tier);
    return (hit && hit.color) || FALLBACK_COLOR;
  }

  function bbcode(name, color) {
    return `[color=${color || FALLBACK_COLOR}]${name}[/color]`;
  }

  return {
    title, advantage, gacha, tree, tierColor, bbcode,
    FALLBACK_COLOR
  };
})();
