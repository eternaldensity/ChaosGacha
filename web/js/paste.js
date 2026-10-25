"use strict";
/* Anonymous paste upload for Chaos Tree share links.
 *
 * The web apps are static, so share data has to live on some CORS-friendly
 * host. Providers are tried in order; the caller should fall back to a
 * manual "copy the JSON, paste a raw URL" flow if upload() throws. Every
 * provider is unauthenticated and returns the raw URL a viewer fetches.
 *
 * dpaste.com is first because its upload and raw-read responses carry CORS
 * headers. pastebin.ai is a fallback: its API supports delete tokens and
 * longer expirations, but its browser responses are not readable from other
 * origins in practice. */
window.ChaosPaste = (function () {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const DEFAULT_DAYS = 7;

  // UI expiry ("1d", "7d", "30d") -> whole days. Accepts a number, or the
  // provider-style forms 1w/1m/1y too, so callers cannot silently fall back
  // to 7 days by passing the wrong option name.
  function expiryDays(expiration) {
    if (typeof expiration === "number" && isFinite(expiration) && expiration > 0) {
      return Math.min(365, Math.max(1, Math.round(expiration)));
    }
    const key = String(expiration == null ? "" : expiration).trim().toLowerCase();
    let m = key.match(/^(\d+)\s*d(?:ays?)?$/);
    if (m) return Math.min(365, Math.max(1, parseInt(m[1], 10)));
    m = key.match(/^(\d+)\s*w(?:eeks?)?$/);
    if (m) return Math.min(365, Math.max(1, parseInt(m[1], 10) * 7));
    m = key.match(/^(\d+)\s*m(?:onths?)?$/);
    if (m) return Math.min(365, Math.max(1, parseInt(m[1], 10) * 30));
    m = key.match(/^(\d+)\s*y(?:ears?)?$/);
    if (m) return Math.min(365, Math.max(1, parseInt(m[1], 10) * 365));
    return DEFAULT_DAYS;
  }

  // pastebin.ai accepts 10m/1h/1d/1w/2w/1m/6m/1y/never, NOT 7d or 30d.
  function pastebinExpiry(expiration) {
    const key = String(expiration == null ? "" : expiration).trim().toLowerCase();
    if (/^(10m|1h|1d|1w|2w|1m|6m|1y|never)$/.test(key)) return key;
    const days = expiryDays(key);
    if (days <= 1) return "1d";
    if (days <= 7) return "1w";
    if (days <= 14) return "2w";
    if (days <= 31) return "1m";
    if (days <= 183) return "6m";
    return "1y";
  }

  function expiresAt(days) {
    return new Date(Date.now() + days * DAY_MS).toISOString();
  }

  const PROVIDERS = [
    {
      name: "dpaste.com",
      canDelete: false,
      async upload(text, opts) {
        const days = expiryDays(opts.expiration);
        const body = new URLSearchParams();
        body.set("content", text);
        body.set("title", opts.title || "Chaos Tree view");
        body.set("expiry_days", String(days));
        body.set("format", "url");
        const res = await fetch("https://dpaste.com/api/v2/", { method: "POST", body });
        if (!res.ok) throw new Error("HTTP " + res.status);
        const url = (await res.text()).trim();
        if (!/^https?:\/\/\S+$/.test(url)) throw new Error("unexpected response");
        return {
          provider: "dpaste.com", rawUrl: url.replace(/\/$/, "") + ".txt",
          pageUrl: url, deleteToken: null, canDelete: false,
          expiresAt: expiresAt(days), expiryDays: days
        };
      },
      async remove() { throw new Error("dpaste.com pastes expire on their own"); }
    },
    {
      name: "pastebin.ai",
      canDelete: true,
      async upload(text, opts) {
        const res = await fetch("https://pastebin.ai/api/v1/pastes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: opts.title || "Chaos Tree view",
            content: text,
            language: "plaintext",
            visibility: "unlisted",
            expiration: pastebinExpiry(opts.expiration)
          })
        });
        if (!res.ok) throw new Error("HTTP " + res.status);
        const j = await res.json();
        if (!j || !j.raw_url) throw new Error("no raw url in response");
        return {
          provider: "pastebin.ai", rawUrl: j.raw_url, pageUrl: j.url || null,
          deleteToken: j.delete_token || null, canDelete: !!j.delete_token,
          expiresAt: j.expires_at || null
        };
      },
      async remove(result) {
        if (!result.deleteToken) throw new Error("no delete token");
        const m = String(result.rawUrl).match(/\/raw\/([^/?#]+)/);
        if (!m) throw new Error("could not find the paste id");
        const res = await fetch("https://pastebin.ai/api/v1/pastes/" + m[1], {
          method: "DELETE", headers: { "X-Delete-Token": result.deleteToken }
        });
        if (!res.ok && res.status !== 204) throw new Error("HTTP " + res.status);
      }
    }
  ];

  async function upload(text, opts) {
    opts = opts || {};
    const errors = [];
    for (const p of PROVIDERS) {
      try { return await p.upload(text, opts); }
      catch (e) {
        const msg = e && e.message ? e.message : String(e);
        if (e && e.name === "AbortError") throw e;
        errors.push(p.name + ": " + msg);
      }
    }
    throw new Error("couldn't upload the share data (" + errors.join("; ") + ")");
  }

  function providerFor(name) {
    return PROVIDERS.find(p => p.name === name) || null;
  }
  async function remove(result) {
    const p = providerFor(result && result.provider);
    if (!p) throw new Error("unknown provider");
    if (result.canDelete === false) throw new Error(p.name + " pastes expire on their own");
    return p.remove(result);
  }

  return { upload, remove, expiryDays, pastebinExpiry, PROVIDERS };
})();
