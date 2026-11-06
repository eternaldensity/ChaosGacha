#!/usr/bin/env python3
"""Propose sequence refs for a fiction pulls file.

`fiction/mechadragon-pulls.txt` is freeform prose: each pull lists an entry
name, a `|Rarity Category|` line (or a `(rarity, Tier, category, source)`
tuple), sometimes two alternatives separated by `OR`, and occasional notes
like `chosen: X`, `selected X`, `(not chosen)` or `replacing X`.

This script matches those names to the live entry lists and prints the
`file:number` lines that tools/pull_sequence.py consumes. It never edits
anything unless --append is given, and it only appends refs that are not
already in the sequence file.

    python3 tools/match_pulls.py fiction/mechadragon-pulls.txt
    python3 tools/match_pulls.py fiction/mechadragon-pulls.txt --append

Ambiguous or unmatched names are reported with candidates instead of being
appended, so they can be fixed by hand.
"""
import argparse
import difflib
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import generate_tree as gt  # noqa: E402
from pull_sequence import load_curses  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FILES = ["ability", "item", "skill", "trait", "familiar"]
CATS = {c: c for c in FILES}
TYPE_WORD = {"ability": "ability", "item": "item", "skill": "skill",
             "trait": "trait", "familiar": "familiar"}
TIERS = ["trash", "common", "uncommon", "rare", "elite", "epic", "legendary",
         "mythical", "divine", "transcendent"]

NAME_RE = re.compile(
    r"^\s*\[?([^\[\]]+?)\]\s*(?:[-–—]\s*(not chosen|not taken))?\s*$", re.I)
TYPE_RE = re.compile(
    r"^\|\s*([A-Za-z]+)\s+(Ability|Item|Skill|Trait|Familiar)\s*\|$", re.I)
CURSE_RE = re.compile(r"^\|\s*Severity\s+(\d+)\s*\|$", re.I)
TUPLE_RE = re.compile(
    r"^\(\s*([0-9.]+)\s*,\s*([^,]+?)\s*,\s*"
    r"(ability|item|skill|trait|familiar)\b[^)]*\)\s*$", re.I)
OR_RE = re.compile(r"^\s*or\s*$", re.I)
CHOSEN_PREFIX_RE = re.compile(
    r"^(?:chosen|selected|taken|picked)\b\s*[:\-]?\s*(.+)$", re.I)
CHOSEN_SUFFIX_RE = re.compile(
    r"^(.+?)\s+(?:was\s+)?(?:chosen|selected|taken|picked)\b\.?$", re.I)
NOTCHOSEN_RE = re.compile(r"^\(?\s*not\s+(?:chosen|taken)\s*\)?\.?$", re.I)
REPLACE_RE = re.compile(r"\breplacing\s+(.+?)\s*$", re.I)
SEQ_RE = re.compile(r"^\s*(ability|item|skill|trait|familiar):(\d+)", re.I)
SEQ_CURSE_RE = re.compile(r"^\s*curse:(.+?)\s*(?:\([^)]*\))?\s*$", re.I)


def show(path):
    try:
        rel = os.path.relpath(path, ROOT)
        return rel if not rel.startswith("..") else path
    except ValueError:
        return path


def norm(s):
    s = str(s or "").lower().replace("&", "and")
    s = re.sub(r"[^a-z0-9+ ]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def load_entries():
    items = gt.load_entries(FILES, None, None, set(), set(), True, True, True)
    index = {}
    for e in items:
        index[(e["file"], e["number"])] = e
    return index


def next_meaningful(lines, i):
    j = i + 1
    while j < len(lines) and not lines[j].strip():
        j += 1
    return j


def parse_events(path):
    """Split the pulls file into events of one or more alternative entries."""
    with open(path, encoding="utf-8") as fh:
        lines = fh.read().splitlines()

    events = []
    event = None
    or_seen = False
    i = 0
    while i < len(lines):
        raw = lines[i]
        line = raw.strip()
        if not line:
            i += 1
            continue

        m = NAME_RE.match(line)
        if m:
            j = next_meaningful(lines, i)
            look = lines[j].strip() if j < len(lines) else ""
            tm, um = TYPE_RE.match(look), TUPLE_RE.match(look)
            cm = CURSE_RE.match(look)
            if tm or um or cm:
                entry = {"name": m.group(1).strip(),
                         "flag": (m.group(2) or "").lower()}
                if cm:
                    entry.update(kind="curse", category="curse",
                                 tier="", rarity=None)
                    if event is None or (event["entries"] and not or_seen):
                        if event is not None:
                            events.append(event)
                        event = {"label": "", "entries": [],
                                 "chosen": None, "replaced": []}
                    event["entries"].append(entry)
                    or_seen = False
                    i = j + 1
                    continue
                if tm:
                    tier, cat = tm.group(1).lower(), TYPE_WORD[tm.group(2).lower()]
                    entry.update(category=cat, tier=tier, rarity=None)
                else:
                    entry.update(rarity=float(um.group(1)),
                                 tier="",
                                 category=TYPE_WORD[um.group(3).lower()])
                if event is None or (event["entries"] and not or_seen):
                    if event is not None:
                        events.append(event)
                    event = {"label": "", "entries": [],
                             "chosen": None, "replaced": []}
                event["entries"].append(entry)
                or_seen = False
                i = j + 1
                continue
        if OR_RE.match(line):
            or_seen = True
            i += 1
            continue
        if NOTCHOSEN_RE.match(line) and event is not None and event["entries"]:
            event["entries"][-1]["flag"] = "not chosen"
            i += 1
            continue

        cm = CHOSEN_PREFIX_RE.match(line) or CHOSEN_SUFFIX_RE.match(line)
        if cm and event is not None:
            event["chosen"] = cm.group(1).split(",")[0].strip(" .")
        rm = REPLACE_RE.search(line)
        if rm and event is not None:
            event["replaced"].append(rm.group(1).strip(" ."))
        i += 1

    if event is not None:
        events.append(event)
    return events


def best_matches(name, category, rarity, by_name, index):
    key = norm(name)
    cands = list(by_name.get(key, []))
    if not cands:
        # containment catches upstream renames around a shared word
        # (Wyvern -> Hellkite Wyvern) without matching unrelated names.
        if len(key) >= 4:
            for k, entries in by_name.items():
                if key in k or k in key:
                    cands.extend(entries)
    if not cands:
        close = difflib.get_close_matches(key, list(by_name), n=3, cutoff=0.8)
        for c in close:
            cands.extend(by_name[c])
    if not cands:
        return [], False
    if category:
        same = [e for e in cands if e["file"] == category]
        if same:
            cands = same
    if rarity is not None:
        close_r = [e for e in cands if abs(e["rarity"] - rarity) <= 0.05]
        if close_r:
            cands = close_r
    # de-duplicate by ref, keep deterministic order
    seen, out = set(), []
    for e in cands:
        ref = (e["file"], e["number"])
        if ref not in seen:
            seen.add(ref)
            out.append(e)
    exact = any(norm(e["name"]) == key for e in out)
    return out, exact


def parse_seq(path):
    refs = set()
    if not path or not os.path.exists(path):
        return refs
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            m = SEQ_RE.match(line)
            if m:
                refs.add(f"{m.group(1).lower()}:{int(m.group(2))}")
                continue
            m = SEQ_CURSE_RE.match(line)
            if m:
                refs.add("curse:" + m.group(1).strip().lower())
    return refs


def choose_flags(entry_list, event):
    """Return [(entry, flag)] with 'not chosen' on the alternatives."""
    explicit = [e for e in entry_list if e["flag"]]
    if explicit:
        return [(e, "not chosen" if e["flag"] else "") for e in entry_list]
    if event.get("chosen"):
        want = norm(event["chosen"])
        hit = [e for e in entry_list if want and
               (norm(e["name"]) == want or want in norm(e["name"]))]
        if hit:
            return [(e, "" if e is hit[0] else "not chosen") for e in entry_list]
    # default, matching newer pulls: first is taken, the rest are offered
    return [(e, "" if k == 0 else "not chosen")
            for k, e in enumerate(entry_list)]


def main(argv=None):
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("pulls")
    ap.add_argument("--seq", default=None,
                    help="sequence file (default: <pulls>-seq.txt sibling)")
    ap.add_argument("--append", action="store_true",
                    help="append the unambiguous missing refs to the sequence")
    args = ap.parse_args(argv)

    seq_path = args.seq
    if not seq_path:
        stem = args.pulls[:-len("-pulls.txt")] \
            if args.pulls.endswith("-pulls.txt") else os.path.splitext(args.pulls)[0]
        seq_path = stem + "-seq.txt"
    known_refs = parse_seq(seq_path)

    index = load_entries()
    by_name = {}
    for e in index.values():
        by_name.setdefault(norm(e["name"]), []).append(e)
    curses = load_curses()
    curse_by_norm = {}
    for key, c in curses.items():
        curse_by_norm.setdefault(norm(c["label"]), c)

    events = parse_events(args.pulls)
    proposed = []
    problems = 0
    already = 0
    for event in events:
        label = " / ".join(e["name"] for e in event["entries"])
        print(f"# {label}")
        for entry, flag in choose_flags(event["entries"], event):
            flagtxt = f" ({flag})" if flag else ""
            if entry.get("kind") == "curse":
                key = norm(entry["name"])
                c = curse_by_norm.get(key)
                if c is None:
                    close = difflib.get_close_matches(
                        key, list(curse_by_norm), n=1, cutoff=0.8)
                    c = curse_by_norm[close[0]] if close else None
                if c is None:
                    problems += 1
                    print(f"?? curse {entry['name']!r} -- no match")
                    continue
                ref = "curse:" + c["label"]
                state = "in seq" if ref.lower() in known_refs else "NEW"
                if state == "in seq":
                    already += 1
                else:
                    proposed.append((ref, flag, c["label"], "curse"))
                print(f"{ref}{flagtxt}  # severity {c['sev']} [{state}]")
                continue

            matches, exact = best_matches(entry["name"], entry["category"],
                                          entry.get("rarity"), by_name, index)
            if len(matches) > 1:
                # On a re-run the pulls file still contains old entries whose
                # ref is already in the sequence; prefer that exact ref.
                known = [e for e in matches
                         if f"{e['file']}:{e['number']}" in known_refs]
                if len(known) == 1:
                    matches = known
            if len(matches) == 1:
                e = matches[0]
                ref = f"{e['file']}:{e['number']}"
                state = "in seq" if ref in known_refs else "NEW"
                if state == "in seq":
                    already += 1
                else:
                    proposed.append((ref, flag, e["name"], e["rarity"]))
                note = "" if exact else "  [fuzzy name match]"
                if entry.get("rarity") is not None and \
                        abs(e["rarity"] - entry["rarity"]) > 0.05:
                    note += f"  [rarity {entry['rarity']} vs {e['rarity']}]"
                print(f"{ref}{flagtxt}  # {e['name']} ({e['rarity']})"
                      f" [{state}]{note}")
            else:
                problems += 1
                print(f"?? {entry['name']!r}"
                      f" ({entry['category']}, rarity {entry.get('rarity')})"
                      f"  -- {state_candidates(matches)}")
        for name in event["replaced"]:
            matches, _ = best_matches(name, None, None, by_name, index)
            if matches:
                e = matches[0]
                print(f"# note: '{e['name']}' was replaced -> mark "
                      f"{e['file']}:{e['number']} (replaced)")
            else:
                print(f"# note: could not resolve replaced entry {name!r}")
        print()

    print(f"{len(events)} events: {already} refs already in "
          f"{show(seq_path)}, {len(proposed)} new, "
          f"{problems} unresolved")
    if not args.append:
        if proposed:
            print("pass --append to add the new refs to the sequence")
        return 0
    if problems:
        print("refusing to append while entries are unresolved", file=sys.stderr)
        return 1
    if not proposed:
        print("nothing to append")
        return 0
    with open(seq_path, "a", encoding="utf-8") as fh:
        fh.write("\n# Added by tools/match_pulls.py\n")
        for ref, flag, _name, _rarity in proposed:
            fh.write(ref + (f" ({flag})" if flag else "") + "\n")
    print(f"appended {len(proposed)} refs to {show(seq_path)}")
    print("next: python3 tools/pull_sequence.py " + show(seq_path))
    return 0


def state_candidates(matches):
    if not matches:
        return "no match"
    return "candidates: " + ", ".join(
        f"{e['file']}:{e['number']} {e['name']} ({e['rarity']})"
        for e in matches[:4])


if __name__ == "__main__":
    sys.exit(main())
