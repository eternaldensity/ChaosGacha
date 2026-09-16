#!/usr/bin/env python3
"""Export gacha entries + gacha tier presets for the static web apps.

Reads the gachafiles/*.txt sources (same parsing as the tree generator)
and writes web/data/entries.js, a small JS bundle assigning
window.CHAOS_DATA. Rerun after editing the data files:

    python3 tools/export_web_data.py
"""
import datetime
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import generate_tree as gt  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "web", "data", "entries.js")

# Ticket tiers mirrored from Gacha.py (presets / presetmin / presetavg /
# presetmax) plus the tree-mode point values from tools/chaos_tree_use.py.
TIERS = [
    {"name": "bronze", "min": 0.1, "avg": 1.3, "max": 3.3, "points": 50},
    {"name": "silver", "min": 0.5, "avg": 2.3, "max": 4.3, "points": 500},
    {"name": "gold", "min": 1.5, "avg": 3.3, "max": 5.3, "points": 5000},
    {"name": "platinum", "min": 2.5, "avg": 4.3, "max": 6.3, "points": 50000},
    {"name": "diamond", "min": 3.5, "avg": 5.3, "max": 7.3, "points": 500000},
    {"name": "legendary", "min": 4.5, "avg": 6.3, "max": 8.3, "points": 5000000},
    {"name": "mythical", "min": 5.5, "avg": 7.3, "max": 9.3, "points": 50000000},
    {"name": "divine", "min": 6.5, "avg": 8.3, "max": 10.0, "points": 500000000},
    {"name": "transcendent", "min": 7.5, "avg": 9.3, "max": 10.0,
     "points": 5000000000},
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


def main():
    entries = gt.load_entries(gt.ALL_FILES, None, None, set(), set(), True)
    compact = []
    for e in entries:
        compact.append({"f": e["file"], "n": e["number"], "name": e["name"],
                        "r": e["rarity"], "s": e["source"], "t": e["tag"],
                        "d": e["description"], "m": e.get("meta", [])})
    payload = {"generated_at": datetime.datetime.now(datetime.timezone.utc)
               .isoformat(timespec="seconds"),
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
