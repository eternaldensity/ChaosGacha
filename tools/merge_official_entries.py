#!/usr/bin/env python3
"""Merge the live Chaos Gacha entry lists into gachafiles/.

The GitHub repo (Bronzdeck/ChaosGacha) is no longer where new entries land:
the live site publishes them at chaosgacha.com/gachalist.txt (the same feed
tools/fetch_official_tags.py reads). This script folds that feed into our
fork without disturbing anything the fork already owns:

  * existing entries keep their IDs (trees/shares reference file#number),
  * entries the site renamed are renamed in place (e.g. Vampire Physique ->
    Vampire Form), keeping our description and rarity,
  * entries the site added are appended after our current highest ID,
  * entries the site dropped stay in the fork untouched,
  * our reworded descriptions are never overwritten.

Three lists are compared: the upstream baseline (the last commit imported
from GitHub, read from our own git history), our current files, and the live
site feed. Renames are recognised by aligning the baseline to the site and
then checking what our file already did to the same entry.

    python3 tools/merge_official_entries.py                 # dry run + report
    python3 tools/merge_official_entries.py --apply         # rewrite files
    python3 tools/merge_official_entries.py --apply --list /tmp/lista.txt

The report (reports/upstream-merge.md) lists new, renamed, dropped, and
low-confidence matches per category for review.
"""
import argparse
import difflib
import json
import os
import re
import subprocess
import sys
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import generate_tree as gt  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GACHA_DIR = os.path.join(ROOT, "gachafiles")
TAGDATA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "tagdata")
BASE_URL = "https://www.chaosgacha.com/gachalist.txt"
DEFAULT_BASELINE = "17a95b2"          # last upstream commit in our history
DELETED_TAG = "deleted"               # marks entries the site dropped
CATMAP = {"Ability": "ability", "Item": "item", "Skill": "skill",
          "Trait": "trait", "Familiar": "familiar"}
SITE_HDR = re.compile(r"^(Ability|Item|Skill|Trait|Familiar),\s*(.*?),"
                      r"(\d+(?:\.\d+)?)\s*$")
# Tags the site uses on entries but not in its dictionaries.
EXTRA_TAGS = {"large-size", "mechanical", "machine", "passive", "anti-draconic",
              "instance-familiar"}
# Franchises the live feed cites that have no entry in our source column yet.
EXTRA_SOURCES = {"My Little Pony", "YuYu Hakusho", "Tsugumomo", "Image Comics",
                 "Darksiders"}
# Site spellings that map onto a source name the fork already uses.
SOURCE_ALIASES = {
    "devi may cry": "Devil May Cry",
    "dark soul": "Dark Souls",
    "solo levelling": "Solo Leveling",
    "high school dxd": "Highschool DxD",
    "legend of zelda": "The Legend of Zelda",
    "overlord the game": "Overlord",
    "warhammer": "Warhammer 40k",
}

# Known upstream rename families the similarity score cannot see on its own
# (the descriptions and the words differ). Keyed (category, baseline name).
RENAME_HINTS = {
    ("skill", "Intermediate Shooting"): "Intermediate Marksmanship",
    ("skill", "Novice Shooting"): "Novice Marksmanship",
    ("skill", "Adept Shooting"): "Adept Marksmanship",
    ("skill", "Expert Shooting"): "Expert Marksmanship",
    ("skill", "Master Shooting"): "Master Marksmanship",
    ("skill", "Grandmaster Shooting"): "Grandmaster Marksmanship",
    ("skill", "Divine Shooting"): "Divine Marksmanship",
    ("skill", "Intermediate Driving"): "Intermediate Riding",
    ("skill", "Novice Driving"): "Novice Riding",
    ("skill", "Adept Driving"): "Adept Riding",
    ("skill", "Expert Driving"): "Expert Riding",
    ("skill", "Master Driving"): "Master Riding",
    ("skill", "Grandmaster Driving"): "Grandmaster Riding",
    ("skill", "Divine Driving"): "Divine Riding",
    ("familiar", "Wraith"): "Shadow Stalker",
    ("trait", "Red Tear"): "Urgency",
    ("trait", "Immortal Soul"): "Resilient Soul",
    ("trait", "Bad Boy/girl Charm"): "Maverick Charm",
    ("ability", "Radio Waves"): "EMP",
    ("ability", "Oil Manipulation"): "Hydrocarbon Manipulation",
    ("ability", "Denial of Nothingness"): "True Creation",
    # approved from the merge report's review list
    ("ability", "Void Tendril"): "Shadow Tendril",
    ("ability", "Divine Blessing"): "Grand Blessing",
    ("ability", "Internet Access"): "Network Access",
    ("ability", "Blood Overdrive"): "Extreme Overdrive",
    ("ability", "Frozen Lightning"): "Lightning Bomb",
    ("ability", "Lightning Claws"): "Force Lightning",
    ("ability", "Floating"): "Air Float",
    ("ability", "Shape Altering"): "Lesser Shapeshifting",
    ("ability", "Stalagmite Burst"): "Earth Burst",
    ("ability", "Metal Manipulation"): "Metalshape",
    ("ability", "Garm Physique"): "Garm Form",
    ("trait", "Thick Skin"): "Tough Skin",
    ("trait", "Commander"): "Leader",
    ("trait", "Seamster"): "Armorer",
    ("trait", "Hero Time"): "Heroic Guardian",
    ("item", "Ticket to Belethor's General Goods"): "Belethor's General Goods Catalogue",
    ("item", "Holy Antidote"): "Universal Antidote",
    ("item", "Sand Cloak"): "Desperado Coat",
    ("item", "Gene Seed Ticket"): "Adeptus Astartes Procedure Ticket",
}


def norm(s):
    s = str(s or "").lower().replace("&", "and")
    s = re.sub(r"[^a-z0-9+ ]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def name_sim(a, b):
    return difflib.SequenceMatcher(None, norm(a), norm(b), autojunk=False).ratio()


# ---------------------------------------------------------------- parsing --
def parse_repo(lines):
    """Parse one gachafiles list into entries with their full block."""
    entries = []
    cur = None
    for line in lines:
        m = gt.HEADER_RE.match(line)
        if m:
            cur = {"id": int(m.group(1)), "name": m.group(2).strip(),
                   "rarity": float(m.group(3)), "source": m.group(4) or "",
                   "header": line, "extra": []}
            entries.append(cur)
        elif cur is not None:
            cur["extra"].append(line)
    return entries


def read_baseline(ref, category):
    out = subprocess.run(["git", "show", f"{ref}:gachafiles/{category}.txt"],
                         cwd=ROOT, capture_output=True, text=True)
    if out.returncode != 0:
        raise SystemExit(f"cannot read {ref}:gachafiles/{category}.txt: "
                         f"{out.stderr.strip()}")
    return parse_repo(out.stdout.splitlines())


def read_ours(category):
    path = os.path.join(GACHA_DIR, f"{category}.txt")
    with open(path, encoding="utf-8") as fh:
        return parse_repo(fh.read().splitlines())


def head_names(category):
    """Entry names as of the last commit, to spot renames made by a merge."""
    out = subprocess.run(["git", "show", f"HEAD:gachafiles/{category}.txt"],
                         cwd=ROOT, capture_output=True, text=True)
    if out.returncode != 0:
        return {}
    return {e["id"]: e["name"] for e in parse_repo(out.stdout.splitlines())}


def read_site(path):
    """Parse gachalist.txt into {category: [entry, ...]} in site order."""
    with open(path, encoding="utf-8") as fh:
        lines = fh.read().splitlines()
    out = {c: [] for c in CATMAP.values()}
    cur = None
    for line in lines:
        m = SITE_HDR.match(line)
        if m and not line.startswith("|"):
            cur = {"category": CATMAP[m.group(1)], "name": m.group(2).strip(),
                   "rarity": float(m.group(3)), "body": []}
            out[cur["category"]].append(cur)
        elif cur is not None:
            s = line.strip()
            if not s:
                continue
            # The feed occasionally repeats a header fragment (.Shadow,4.1)
            # or prefixes the prose with the document's own heading marks.
            if re.match(r"^\.[^,]+,\s*\d+(?:\.\d+)?$", s):
                continue
            if s.startswith("#"):
                bullet = s.startswith("#-")
                s = s.lstrip("#").strip()
                if bullet:
                    s = s.lstrip("-").strip()
            cur["body"].append(s)
    for entries in out.values():
        for e in entries:
            fixed = SITE_NAME_FIXES.get(norm(e["name"]))
            if fixed:
                e["name"] = fixed
            text = " ".join(x for x in e["body"] if x)
            e["tags"], e["text"] = split_site_body(text)
    return out


def split_site_body(text):
    """Split the |Tag| slots from the visible text."""
    slots = []
    rest = text.strip()
    if rest.startswith("|"):
        parts = rest.split("|")
        # |a|b||c|text... -> slots are the leading non-empty groups
        i = 1
        while i < len(parts):
            slot = parts[i].strip()
            if not slot:
                i += 1
                continue
            if re.match(r"^[A-Za-z0-9 +'()/.-]+$", slot) and len(slot) <= 40:
                slots.append(slot)
                i += 1
            else:
                break
        rest = "|".join(parts[i:]).strip()
    # The feed sometimes glues a duplicated header fragment onto the prose.
    rest = re.sub(r"^\.[^,]+,\s*\d+(?:\.\d+)?\s*", "", rest)
    return slots, rest.lstrip("-: ").strip()


def load_site_tag_dicts():
    with open(os.path.join(TAGDATA, "dicts.json"), encoding="utf-8") as fh:
        dicts = json.load(fh)
    known = {}
    for cat, rows in dicts.items():
        for row in rows:
            key = gt.normalize_tag(row["name"])
            if key:
                known.setdefault(cat, set()).add(key)
    return known


def tag_tokens(slots, category, known):
    out = set()
    for slot in slots:
        key = gt.normalize_tag(slot)
        if not key:
            continue
        if key in known.get(category, ()) or key in EXTRA_TAGS:
            out.add(key)
    return sorted(out)


def source_for(text, sources):
    """Split a leading 'Franchise - ' prefix when it names a known source."""
    m = re.match(r"^(.{2,45}?)\s+[-–—]\s+(.*)$", text)
    if not m:
        return "", text
    prefix = m.group(1).strip()
    key = norm(prefix)
    for src in sources:
        if norm(src) == key:
            return src, m.group(2).strip()
    alias = SOURCE_ALIASES.get(key)
    if alias:
        return alias, m.group(2).strip()
    return "", text


def known_sources(baseline, ours):
    out = set(EXTRA_SOURCES)
    for e in baseline + ours:
        if e["source"]:
            out.add(e["source"].strip())
    return out


# --------------------------------------------------------------- aligning --
def align(base, site):
    """Map baseline entries to site entries, in order.

    Exact names are anchors; between them a similarity/rarity score pairs
    in-place renames. Pairs below the confidence bar are returned as
    suggestions instead of being applied, because the site also replaces
    entries in place with unrelated new ones (Glass Manipulation ->
    Cellulose Manipulation) and a wrong rename would hijack an ID.
    Returns (pairs, new_site_indices, dropped_base_indices, suggestions).
    """
    bn = [norm(x["name"]) for x in base]
    sn = [norm(x["name"]) for x in site]
    sm = difflib.SequenceMatcher(None, bn, sn, autojunk=False)
    pairs = {}
    used = set()
    blocks = []

    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == "equal":
            for k in range(i2 - i1):
                pairs[i1 + k] = j1 + k
                used.add(j1 + k)
        elif tag == "replace":
            blocks.append((i1, i2, j1, j2))

    suggestions = []
    for i1, i2, j1, j2 in blocks:
        cand = []
        for i in range(i1, i2):
            for j in range(j1, j2):
                s = name_sim(base[i]["name"], site[j]["name"])
                bonus = 0.3 if base[i]["rarity"] == site[j]["rarity"] else 0.0
                if abs(base[i]["rarity"] - site[j]["rarity"]) <= 0.3:
                    bonus = max(bonus, 0.15)
                cand.append((s + bonus, s, i, j))
        cand.sort(reverse=True)
        for score, s, i, j in cand:
            if s < 0.3 or score < 0.5 or i in pairs or j in used:
                continue
            if not confident_rename(base[i]["name"], site[j]["name"], s):
                continue
            pairs[i] = j
            used.add(j)

        # Leftovers in one block are often in-place replacements: keep the
        # best-scoring candidate pairs as review suggestions only.
        left_b = [i for i in range(i1, i2) if i not in pairs]
        left_s = [j for j in range(j1, j2) if j not in used]
        for i in left_b:
            best = None
            for j in left_s:
                if j in used:
                    continue
                s = name_sim(base[i]["name"], site[j]["name"])
                if best is None or s > best[0]:
                    best = (s, j)
            if best and best[0] >= 0.2:
                suggestions.append((i, best[1], best[0]))

    new = [j for j in range(len(site)) if j not in used]
    dropped = [i for i in range(len(base)) if i not in pairs]
    return pairs, new, dropped, suggestions


def confident_rename(old, new, sim):
    """A rename is only applied when the names clearly correspond.

    Same first word is the usual pattern (Vampire Physique -> Vampire Form);
    a light stem lets -ing/-er pairs through (Earthbending -> Earthbender),
    containment covers extensions (Igris -> Igris the Blood Red), and
    near-identical spellings stand on their own (Shadowflames -> Shadowflame).
    Shared generic suffixes (Glass -> Cellulose Manipulation) are rejected.
    """
    if sim >= 0.85:
        return True
    ta, tb = norm(old).split(), norm(new).split()
    if not ta or not tb:
        return False

    # one name extends the other (Igris -> Igris the Blood Red,
    # Wyvern -> Hellkite Wyvern, Armor -> Metal Armor)
    if set(ta) <= set(tb) or set(tb) <= set(ta):
        return True

    def stem(w):
        return re.sub(r"(ing|ers?|ed|es|s)$", "", w)

    return stem(ta[0]) == stem(tb[0]) and sim >= 0.5


def apply_hints(base, site, pairs, used, category, hints):
    """Force baseline names to a known site rename (see RENAME_HINTS)."""
    by_name = {}
    for j, e in enumerate(site):
        by_name.setdefault(norm(e["name"]), j)
    for i, e in enumerate(base):
        target = hints.get((category, e["name"]))
        if not target or i in pairs:
            continue
        j = by_name.get(norm(target))
        if j is None or j in used:
            continue
        pairs[i] = j
        used.add(j)


# ---------------------------------------------------------------- merging --
def entry_header(eid, name, rarity, source):
    tail = f", {source}" if source else ""
    return f"{eid}. {name}, {rarity:.1f}{tail}"


def site_description(entry, category, known, sources):
    tokens = tag_tokens(entry["tags"], category, known)
    source, text = source_for(entry["text"], sources)
    text = re.sub(r"\s+", " ", text).strip()
    prefix = "".join(f"(Tag:{t})" for t in tokens)
    return source or "Generic", "#" + prefix + text


def same_generated_text(entry, expected):
    """True when an existing entry is a copy of a previous merge's addition."""
    have = " ".join(x for x in entry["extra"] if x.strip()).lstrip("#")
    have = re.sub(r"\([^)]*\)", "", have)
    want = re.sub(r"\([^)]*\)", "", expected.lstrip("#"))
    return name_sim(have, want) >= 0.95


# Hand-written site prose occasionally has a doubled word or an obvious slip;
# imported descriptions are cleaned so the fork does not inherit them.
DESC_FIXES = [
    (r"\bdesctruc", "destruc"),
    (r"\belecritiy\b", "electricity"),
    (r"\bcolumms\b", "columns"),
    (r"\badorkable\b", "adorable"),
    (r"\bwreather\b", "wreathe"),
    (r"\bbarrelled\b", "barreled"),
    (r"\bassult\b", "assault"),
    (r"\briding at riding\b", "riding"),
    (r"\bcomplimented\b", "complemented"),
    (r"\bSepiroth\b", "Sephiroth"),
    (r"\bghould\b", "ghoul"),
    (r"\bPheonix\b", "Phoenix"),
    (r"\bIgris possess\b", "Igris possesses"),
    (r"\bDiance\b", "Diancie"),
    (r"\bgreay\b", "great"),
    (r"\babilties\b", "abilities"),
    (r"\b(affect)\s+the more\b", r"\1, the more"),
    (r"the larger of an area they can affect, the more potent they can amplify"
     r" the sunlight",
     "the larger the area they can affect and the more potent the sunlight"
     " they can amplify"),
    (r"\bgolem like\b", "golem-like"),
    (r"\btwo dimensional\b", "two-dimensional"),
    (r"\bbarelled\b", "barreled"),
    (r"\belectrcitiy\b", "electricity"),
    (r"\bpin point\b", "pinpoint"),
    (r"\bassasins\b", "assassins"),
    (r"\bproffesional\b", "professional"),
]

# Site spellings that are outright wrong and safe to correct everywhere.
SITE_NAME_FIXES = {"diance": "Diancie"}


def polish_text(text):
    text = re.sub(r"\b([Tt])he they expend\b",
                  lambda m: m.group(1) + "he more they expend", text)
    text = re.sub(r"\b([A-Za-z]+)(\s+\1)\b", r"\1", text, flags=re.I)
    for pat, rep in DESC_FIXES:
        text = re.sub(pat, rep, text, flags=re.I)
    return re.sub(r"\s+", " ", text).strip()


def tag_parts(entry):
    """Split an entry's leading description tokens into (tags, others)."""
    line = next((x for x in entry["extra"] if x.strip().startswith("#")), "")
    m = re.match(r"^\s*#\s*(.*)$", line)
    if not m:
        return set(), []
    rest = m.group(1)
    pos, tags, others = 0, set(), []
    for tm in re.finditer(r"\(([^)]*)\)", rest):
        if tm.start() != pos:
            break
        tok = tm.group(1)
        low = tok.lower()
        if low.startswith("tag:") or low.startswith("tags:"):
            tags.update(gt.parse_tags([tok]))
        else:
            others.append(tok)
        pos = tm.end()
    return tags, others


def entry_tags(entry):
    """Thematic tags currently on an entry's description line."""
    line = next((x for x in entry["extra"] if x.strip().startswith("#")), "")
    tokens, _ = gt.parse_description(line.strip())
    return set(gt.parse_tags(tokens))


def rewrite_desc(entry, prose):
    """Replace an entry's visible text, keeping its tag/system tokens."""
    line = next((x for x in entry["extra"] if x.strip().startswith("#")), "")
    m = re.match(r"^(\s*#\s*)", line)
    prefix = m.group(1) if m else "#"
    tags, others = tag_parts(entry)
    return (prefix + "".join(f"(Tag:{t})" for t in sorted(tags)) +
            "".join(f"({o})" for o in others) + prose)


def retag_line(line, add=None, remove=None):
    """Add/remove one thematic tag, keeping the other leading tokens."""
    m = re.match(r"^(\s*#\s*)(.*)$", line)
    if not m:
        return line
    prefix, rest = m.group(1), m.group(2)
    pos, tags, others = 0, set(), []
    for tm in re.finditer(r"\(([^)]*)\)", rest):
        if tm.start() != pos:
            break
        tok = tm.group(1)
        low = tok.lower()
        if low.startswith("tag:") or low.startswith("tags:"):
            tags.update(gt.parse_tags([tok]))
        else:
            others.append(tok)
        pos = tm.end()
    text = rest[pos:]
    if add:
        add = gt.normalize_tag(add)
        if add in tags:
            return line
        tags.add(add)
    if remove:
        remove = gt.normalize_tag(remove)
        if remove not in tags:
            return line
        tags.discard(remove)
    return (prefix + "".join(f"(Tag:{t})" for t in sorted(tags)) +
            "".join(f"({o})" for o in others) + text)


def apply_tag(lines, header_idx, add=None, remove=None):
    """Apply a tag change to the description line of one entry block."""
    j = header_idx + 1
    while j < len(lines) and not gt.HEADER_RE.match(lines[j]):
        if lines[j].strip().startswith("#"):
            lines[j] = retag_line(lines[j], add=add, remove=remove)
            return
        j += 1


def plan_category(category, baseline, ours, site, known, hints):
    sources = known_sources(baseline, ours)
    ours_by_id = {e["id"]: e for e in ours}
    pairs, new_idx, dropped_idx, suggestions = align(baseline, site)
    apply_hints(baseline, site, pairs, set(pairs.values()), category, hints)
    # An entry can also move within the list (the site inserted a material
    # manipulation set and relocated Fabric Manipulation). Restore exact-name
    # matches using our current names, which may already carry a rename from
    # an earlier run, so moved entries are not treated as dropped.
    used = set(pairs.values())
    site_by_name = {}
    for j, s in enumerate(site):
        site_by_name.setdefault(norm(s["name"]), []).append(j)
    for i, b in enumerate(baseline):
        if i in pairs:
            continue
        o = ours_by_id.get(b["id"])
        if o is None:
            continue
        for j in site_by_name.get(norm(o["name"]), []):
            if j not in used:
                pairs[i] = j
                used.add(j)
                break
    new_idx = [j for j in range(len(site)) if j not in used]
    dropped_idx = [i for i in range(len(baseline)) if i not in pairs]
    dropped_ids = {baseline[i]["id"] for i in dropped_idx}
    suggestions = [s for s in suggestions if s[0] not in pairs and s[1] not in used]

    renames, overrides, conflicts, collisions, removals = [], [], [], [], []
    duplicate_names = []
    name_owner = {norm(o["name"]): o["id"] for o in ours}
    for i, j in sorted(pairs.items()):
        b, s = baseline[i], site[j]
        o = ours_by_id.get(b["id"])
        if o is None:
            continue                       # our fork deleted it; leave deleted
        if norm(s["name"]) == norm(b["name"]):
            continue                       # the site did not rename it
        if norm(o["name"]) == norm(s["name"]):
            continue                       # already renamed
        owner = name_owner.get(norm(s["name"]))
        if owner is not None and owner != o["id"]:
            # A previous merge may already have appended the site's copy of
            # this entry under its new name. If the text is the generated
            # one, drop that duplicate so the rename can take the name.
            dup = ours_by_id.get(owner)
            if dup is not None and same_generated_text(
                    dup, site_description(s, category, known, sources)[1]):
                removals.append(dup)
            elif owner in dropped_ids:
                # The other owner is an entry the site dropped; it keeps the
                # name but is tagged deleted, so the rename still goes ahead.
                duplicate_names.append((o, s["name"], dup))
            else:
                collisions.append((o, s["name"], dup))
                continue
        if norm(o["name"]) == norm(b["name"]):
            renames.append((o, b["name"], s["name"]))
        else:
            # both sides renamed it differently: the site's name wins, but
            # flag it so the override is visible.
            overrides.append((o, o["name"], s["name"], b["name"]))
            renames.append((o, o["name"], s["name"]))
            conflicts.append((o, b["name"], o["name"], s["name"]))
        name_owner[norm(s["name"])] = o["id"]

    # Correct known site misspellings on our side too, so the fixed name does
    # not look like a brand-new entry on the next run.
    for o in ours:
        fixed = SITE_NAME_FIXES.get(norm(o["name"]))
        if not fixed or norm(fixed) == norm(o["name"]):
            continue
        owner = name_owner.get(norm(fixed))
        if owner is not None and owner != o["id"]:
            continue
        renames.append((o, o["name"], fixed))
        name_owner[norm(fixed)] = o["id"]

    # Site entries the confident pass could not pair. Each is offered with
    # the dropped baseline entry it most resembles, for manual review.
    suggestions_out = []
    for i, j, sim in suggestions:
        b, s = baseline[i], site[j]
        o = ours_by_id.get(b["id"])
        suggestions_out.append({
            "ours": o, "id": b["id"], "old": b["name"],
            "new": s["name"], "score": sim,
        })

    final_names = {norm(o["name"]) for o in ours}
    final_names |= {norm(r[2]) for r in renames}
    next_id = max([e["id"] for e in ours] + [0]) + 1
    new_entries = []
    for j in new_idx:
        s = site[j]
        if norm(s["name"]) in final_names:
            continue                       # already present under that name
        source, desc = site_description(s, category, known, sources)
        new_entries.append({
            "id": next_id, "name": s["name"], "rarity": s["rarity"],
            "source": source, "description": desc,
        })
        final_names.add(norm(s["name"]))
        next_id += 1

    dropped = [baseline[i] for i in dropped_idx]

    # Entries the site no longer lists get (Tag:deleted) so they can be
    # filtered out on demand; the tag is removed again if a later merge
    # recognises the entry as a rename instead of a deletion.
    dropped_ids = {d["id"] for d in dropped}
    tag_deleted, untag_deleted = [], []
    for o in ours:
        has = DELETED_TAG in entry_tags(o)
        if o["id"] in dropped_ids and not has:
            tag_deleted.append(o)
        elif o["id"] not in dropped_ids and has:
            untag_deleted.append(o)

    # Renamed entries also take the site's current prose (our tags are kept).
    # Imported copies are re-polished in place, but never a fork rewrite.
    baseline_max = max([e["id"] for e in baseline] + [0])
    renamed_ids = {o["id"] for o, _, _ in renames}
    # Also adopt prose for entries renamed by an earlier run (the names at
    # HEAD differ), so an interrupted merge still converges.
    head = head_names(category)
    adopter_ids = set(renamed_ids)
    adopter_ids |= {oid for oid, nm in head.items()
                    if oid in ours_by_id
                    and norm(nm) != norm(ours_by_id[oid]["name"])}
    site_for_our_id = {}
    for i, j in pairs.items():
        b = baseline[i]
        if b["id"] in ours_by_id:
            site_for_our_id[b["id"]] = site[j]
    site_by_name = {}
    for s in site:
        site_by_name.setdefault(norm(s["name"]), s)
    desc_updates = []
    for o in ours:
        lookup = SITE_NAME_FIXES.get(norm(o["name"]), o["name"])
        s = site_for_our_id.get(o["id"]) or site_by_name.get(norm(lookup))
        if s is None:
            continue
        _src, prose = source_for(s["text"], sources)
        prose = polish_text(prose)
        if not prose:
            continue
        if o["id"] in adopter_ids:
            new_line = rewrite_desc(o, prose)
        elif o["id"] > baseline_max:
            # An imported copy: refresh it only while it still carries the
            # raw site text, so a later manual rewrite is never clobbered.
            have = " ".join(x for x in o["extra"] if x.strip()).lstrip("#")
            have = re.sub(r"\([^)]*\)", "", have)
            raw = re.sub(r"\([^)]*\)", "",
                         site_description(s, category, known, sources)[1])
            if name_sim(have, raw) < 0.98:
                continue
            new_line = rewrite_desc(o, prose)
        else:
            continue
        current = next((x for x in o["extra"] if x.strip().startswith("#")), "")
        if new_line.strip() != current.strip():
            desc_updates.append((o, new_line))

    return {
        "renames": renames, "overrides": overrides, "conflicts": conflicts,
        "new": new_entries, "dropped": dropped, "suggestions": suggestions_out,
        "collisions": collisions, "removals": removals,
        "duplicate_names": duplicate_names,
        "tag_deleted": tag_deleted, "untag_deleted": untag_deleted,
        "desc_updates": desc_updates,
    }


# ---------------------------------------------------------------- report --
def write_report(path, plan, mode):
    lines = ["# Upstream merge report", "",
             f"_Generated by tools/merge_official_entries.py ({mode})._", ""]
    for cat in ["ability", "item", "skill", "trait", "familiar"]:
        p = plan[cat]
        lines += [f"## {cat.capitalize()}", "",
                  f"- new: **{len(p['new'])}**",
                  f"- renamed: **{len(p['renames'])}**",
                  f"- dropped upstream (kept here): **{len(p['dropped'])}**",
                  f"- marked deleted: **{len(p['tag_deleted'])}**",
                  f"- descriptions refreshed: **{len(p['desc_updates'])}**",
                  f"- possible renames to review: **{len(p['suggestions'])}**", ""]
        if p["renames"]:
            lines += ["### Renames", ""]
            for o, old, new in p["renames"]:
                lines.append(f"- `#{o['id']}` {old} → **{new}**")
            lines.append("")
        if p["conflicts"]:
            lines += ["### Both sides renamed", ""]
            for o, b, own, s in p["conflicts"]:
                lines.append(f"- `#{o['id']}` baseline {b}: ours {own} → site **{s}**")
            lines.append("")
        if p["collisions"]:
            lines += ["### Rename collisions (not applied)", ""]
            for o, target, owner in p["collisions"]:
                who = (f"`#{owner['id']}` {owner['name']}" if owner
                       else "another entry")
                lines.append(f"- `#{o['id']}` {o['name']} → **{target}** skipped:"
                             f" {who} already owns that name")
            lines.append("")
        if p["duplicate_names"]:
            lines += ["### Duplicate names (dropped entry keeps its name)", ""]
            for o, target, owner in p["duplicate_names"]:
                who = (f"`#{owner['id']}` {owner['name']}" if owner
                       else "another entry")
                lines.append(f"- `#{o['id']}` → **{target}**; {who} also has"
                             f" that name and stays tagged `deleted`")
            lines.append("")
        if p["removals"]:
            lines += ["### Duplicate copies removed", ""]
            for r in p["removals"]:
                lines.append(f"- `#{r['id']}` {r['name']} (added by an earlier"
                             f" merge; the rename takes the name)")
            lines.append("")
        if p["desc_updates"]:
            lines += ["### Descriptions refreshed", "",
                      "Imported prose adopts the site's current text (tags kept) "
                      "with doubled words and known slips cleaned.", ""]
            for o, _line in p["desc_updates"]:
                lines.append(f"- `#{o['id']}` {o['name']}")
            lines.append("")
        if p["suggestions"]:
            lines += ["### Possible renames (not applied)", "",
                      "Add the credible pairs to `RENAME_HINTS` in "
                      "tools/merge_official_entries.py, then rerun.", ""]
            for s in sorted(p["suggestions"], key=lambda x: -x["score"]):
                lines.append(f"- `#{s['id']}` {s['old']} ~ **{s['new']}**"
                             f" (score {s['score']:.2f})")
            lines.append("")
        if p["new"]:
            lines += ["### New entries", ""]
            for n in p["new"]:
                lines.append(f"- `#{n['id']}` **{n['name']}** ({n['rarity']:.1f},"
                             f" {n['source']})")
            lines.append("")
        if p["dropped"]:
            lines += ["### No longer on the site (kept)", ""]
            for d in p["dropped"]:
                lines.append(f"- `#{d['id']}` {d['name']} ({d['rarity']:.1f})")
            lines.append("")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines) + "\n")


def main():
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--list", help="local gachalist.txt (default: fetch live)")
    ap.add_argument("--baseline-ref", default=DEFAULT_BASELINE,
                    help=f"git revision of the imported upstream lists "
                         f"(default {DEFAULT_BASELINE})")
    ap.add_argument("--apply", action="store_true", help="rewrite gachafiles/")
    ap.add_argument("--hints",
                    help="JSON {category: {old: new}} of extra renames to adopt")
    ap.add_argument("--report", default=os.path.join(
        ROOT, "reports", "upstream-merge.md"))
    ap.add_argument("--no-report", action="store_true")
    args = ap.parse_args()

    if args.list:
        with open(args.list, encoding="utf-8") as fh:
            site_text = fh.read()
    else:
        with urllib.request.urlopen(BASE_URL, timeout=60) as r:
            site_text = r.read().decode("utf-8")
    tmp = os.path.join(ROOT, ".gachalist.tmp")
    with open(tmp, "w", encoding="utf-8") as fh:
        fh.write(site_text)
    try:
        site = read_site(tmp)
    finally:
        os.unlink(tmp)

    known = load_site_tag_dicts()
    hints = dict(RENAME_HINTS)
    if args.hints:
        with open(args.hints, encoding="utf-8") as fh:
            extra = json.load(fh)
        for cat, mapping in extra.items():
            for old, new in mapping.items():
                hints[(cat, old)] = new
    plan = {}
    for cat in ["ability", "item", "skill", "trait", "familiar"]:
        baseline = read_baseline(args.baseline_ref, cat)
        ours = read_ours(cat)
        plan[cat] = plan_category(cat, baseline, ours, site[cat], known, hints)

    total_new = sum(len(p["new"]) for p in plan.values())
    total_ren = sum(len(p["renames"]) for p in plan.values())
    total_drop = sum(len(p["dropped"]) for p in plan.values())
    total_sug = sum(len(p["suggestions"]) for p in plan.values())
    total_rm = sum(len(p["removals"]) for p in plan.values())
    total_del = sum(len(p["tag_deleted"]) for p in plan.values())
    total_desc = sum(len(p["desc_updates"]) for p in plan.values())
    print(f"new entries: {total_new}   renames: {total_ren}   "
          f"dropped upstream: {total_drop}   marked deleted: {total_del}   "
          f"descriptions refreshed: {total_desc}")
    print(f"duplicates removed: {total_rm}   possible renames: {total_sug}")
    for cat, p in plan.items():
        print(f"  {cat}: +{len(p['new'])}  rename {len(p['renames'])}  "
              f"kept {len(p['dropped'])}  del {len(p['tag_deleted'])}  "
              f"desc {len(p['desc_updates'])}  review {len(p['suggestions'])}")

    if not args.no_report:
        write_report(args.report, plan, "dry run" if not args.apply else "applied")
        print(f"report: {os.path.relpath(args.report, ROOT)}")
    if not args.apply:
        print("dry run — pass --apply to rewrite gachafiles/")
        return 0

    for cat, p in plan.items():
        path = os.path.join(GACHA_DIR, f"{cat}.txt")
        with open(path, encoding="utf-8") as fh:
            lines = fh.read().splitlines()
        drop_ids = {r["id"] for r in p["removals"]}
        if drop_ids:
            kept, skip = [], False
            for line in lines:
                m = gt.HEADER_RE.match(line)
                if m:
                    skip = int(m.group(1)) in drop_ids
                if not skip:
                    kept.append(line)
            lines = kept
        by_id = {}
        for idx, line in enumerate(lines):
            m = gt.HEADER_RE.match(line)
            if m:
                by_id[int(m.group(1))] = idx
        for o, _old, new in p["renames"]:
            if o["id"] in drop_ids:
                continue
            idx = by_id[o["id"]]
            m = gt.HEADER_RE.match(lines[idx])
            lines[idx] = entry_header(o["id"], new, float(m.group(3)),
                                      (m.group(4) or "").strip())
        for o in p["tag_deleted"]:
            if o["id"] in drop_ids:
                continue
            apply_tag(lines, by_id[o["id"]], add=DELETED_TAG)
        for o in p["untag_deleted"]:
            if o["id"] in drop_ids:
                continue
            apply_tag(lines, by_id[o["id"]], remove=DELETED_TAG)
        for o, new_line in p["desc_updates"]:
            if o["id"] in drop_ids:
                continue
            idx = by_id[o["id"]]
            j = idx + 1
            while j < len(lines) and not gt.HEADER_RE.match(lines[j]):
                if lines[j].strip().startswith("#"):
                    lines[j] = new_line
                    break
                j += 1
        for n in p["new"]:
            lines.append(entry_header(n["id"], n["name"], n["rarity"],
                                      n["source"]))
            lines.append(n["description"])
        with open(path, "w", encoding="utf-8", newline="\n") as fh:
            fh.write("\n".join(lines) + "\n")
        print(f"wrote gachafiles/{cat}.txt"
              f" (+{len(p['new'])}, {len(p['renames'])} renamed,"
              f" {len(drop_ids)} duplicates removed)")
    print("done — rerun: python3 tools/export_web_data.py")
    return 0


if __name__ == "__main__":
    sys.exit(main())
