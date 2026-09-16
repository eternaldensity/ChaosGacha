#!/usr/bin/env python3
"""Export gacha entries + gacha tier presets for the static web apps.

Reads the gachafiles/*.txt sources (same parsing as the tree generator)
and writes web/data/entries.js, a small JS bundle assigning
window.CHAOS_DATA. Rerun after editing the data files:

    python3 tools/export_web_data.py
"""
import datetime
import hashlib
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import generate_tree as gt  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "web", "data", "entries.js")

# Ticket tiers mirrored from Gacha.py (presets / presetmin / presetavg /
# presetmax) plus the tree-mode point values from tools/chaos_tree_use.py
# and the button colors sampled from the original site's tier PNGs
# (bronze.png … divine.png; transcendent extrapolated darker than divine).
TIERS = [
    {"name": "bronze", "min": 0.1, "avg": 1.3, "max": 3.3, "points": 50, "color": "#74573e"},
    {"name": "silver", "min": 0.5, "avg": 2.3, "max": 4.3, "points": 500, "color": "#acb9b8"},
    {"name": "gold", "min": 1.5, "avg": 3.3, "max": 5.3, "points": 5000, "color": "#f6c54c"},
    {"name": "platinum", "min": 2.5, "avg": 4.3, "max": 6.3, "points": 50000, "color": "#bcd5eb"},
    {"name": "diamond", "min": 3.5, "avg": 5.3, "max": 7.3, "points": 500000, "color": "#9bf3eb"},
    {"name": "legendary", "min": 4.5, "avg": 6.3, "max": 8.3, "points": 5000000, "color": "#f5993d"},
    {"name": "mythical", "min": 5.5, "avg": 7.3, "max": 9.3, "points": 50000000, "color": "#ff6bae"},
    {"name": "divine", "min": 6.5, "avg": 8.3, "max": 10.0, "points": 500000000, "color": "#f61e1e"},
    {"name": "transcendent", "min": 7.5, "avg": 9.3, "max": 10.0,
     "points": 5000000000, "color": "#8f1010"},
]

# Rarity classes mirrored from Gacha.py run_gacha().
CLASSES = [
    {"max": 1.0, "name": "Trash", "color": "#a39589"},
    {"max": 2.0, "name": "Common", "color": "#9c7e5a"},
    {"max": 3.0, "name": "Uncommon", "color": "#aed1d1"},
    {"max": 4.0, "name": "Rare", "color": "#11d939"},
    {"max": 5.0, "name": "Elite", "color": "#1172d9"},
    {"max": 6.0, "name": "Epic", "color": "#6811d9"},
    {"max": 7.0, "name": "Legendary", "color": "#f7d40a"},
    {"max": 8.0, "name": "Mythical", "color": "#fc61ff"},
    {"max": 9.0, "name": "Divine", "color": "#ff8c00"},
    {"max": 99.0, "name": "Transcendent", "color": "#ff0000"},
]

CATEGORIES = ["ability", "item", "skill", "trait", "familiar"]


def flag_map():
    """Map (file, number) -> token set by re-scanning the raw data files.
    Used to preserve NSFW/Tech flags that the tree pipeline strips."""
    out = {}
    for path in [os.path.join(gt.GACHA_DIR, f + ".txt") for f in gt.ALL_FILES]:
        file = os.path.basename(path)[:-4]
        cur = None
        desc_lines = []
        with open(path, encoding="utf-8") as fh:
            lines = fh.read().splitlines()
        def flush():
            if cur is not None:
                toks, _ = gt.parse_description(
                    " ".join(l.strip() for l in desc_lines if l.strip()))
                out[(file, cur)] = toks
        for line in lines:
            m = gt.HEADER_RE.match(line)
            if m:
                flush()
                cur = int(m.group(1))
                desc_lines = []
            else:
                desc_lines.append(line)
        flush()
    return out


def main():
    entries = gt.load_entries(gt.ALL_FILES, None, None, set(), set(), True)
    flags = flag_map()
    # Data version: hash over topology/behaviour-relevant fields (file,
    # number, rarity, source, tag, meta tokens). Display text (names,
    # descriptions) is excluded so prose edits don't invalidate trees.
    # Trees record the version they were generated with; a mismatch warns
    # that regeneration may produce a different tree.
    h = hashlib.sha256()
    for e in entries:
        h.update(("\x1f".join([e["file"], str(e["number"]), repr(e["rarity"]),
                               e["source"] or "", e["tag"],
                               ",".join(e.get("meta", []))]) + "\n").encode("utf-8"))
    data_version = h.hexdigest()[:10]
    compact = []
    for e in entries:
        toks = flags.get((e["file"], e["number"]), set())
        item = {"f": e["file"], "n": e["number"], "name": e["name"],
                "r": e["rarity"], "s": e["source"], "t": e["tag"],
                "d": e["description"], "m": e.get("meta", [])}
        if "Nsfw" in toks:
            item["nsfw"] = True
        if "Tech" in toks:
            item["tech"] = True
        compact.append(item)
    payload = {"generated_at": datetime.datetime.now(datetime.timezone.utc)
               .isoformat(timespec="seconds"),
               "dataVersion": data_version,
               "counts": {c: sum(1 for e in compact if e["f"] == c)
                          for c in CATEGORIES},
               "tiers": TIERS, "classes": CLASSES, "categories": CATEGORIES,
               "entries": compact}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as fh:
        fh.write("window.CHAOS_DATA = ")
        fh.write(json.dumps(payload, ensure_ascii=False,
                            separators=(",", ":")))
        fh.write(";\n")
    print(f"wrote {OUT} ({os.path.getsize(OUT)} bytes, "
          f"{len(compact)} entries)")


if __name__ == "__main__":
    main()
