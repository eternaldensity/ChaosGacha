#!/usr/bin/env python3
"""Detect and repair nodes that were placed on the wrong radial shell.

Upgrade once appended new entries with the app's default radius (10) instead
of the tree's own radius (50), so high-rarity entries ended up near the centre
and linked to whatever low-rarity nodes happened to be there. The code now
merges placement params and infers a missing radius from the existing layout,
but saves made before that fix still contain the misplaced cohort.

This tool finds nodes whose radial distance implies a much smaller sphere than
the rest of the tree, re-places them on the radius their rarity calls for, and
re-links them to their nearest neighbours. Existing ids (and therefore unlock
and history references) are kept.

Usage:
  python3 tools/repair_tree_radius.py SAVE.chaos-tree.json          # report only
  python3 tools/repair_tree_radius.py SAVE.chaos-tree.json --apply  # rewrite

Only app exports (payload.tree.topology) are handled.
"""
import argparse
import json
import math
import os
import random
import re
import sys
from collections import defaultdict, deque

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def load_entries():
    path = os.path.join(ROOT, "web", "data", "entries.js")
    try:
        raw = open(path, encoding="utf-8").read()
    except OSError:
        sys.exit("web/data/entries.js is missing; run tools/export_web_data.py first")
    m = re.search(r"window\.CHAOS_DATA = (.*);\s*$", raw, re.S)
    if not m:
        sys.exit(f"could not parse {path}")
    return {(e["f"], e["n"]): e for e in json.loads(m.group(1))["entries"]}


def merged_params(tree):
    topo = tree.get("topology") or {}
    params = {}
    params.update(topo.get("params") or {})
    params.update(tree.get("params") or {})
    return params


def pool_entries(entries, filters):
    """Mirror ChaosGen.filterEntries closely enough for the rarity range."""
    files = filters.get("files") or ["skill", "trait", "familiar", "item", "ability"]
    sources = filters.get("sources")
    rmin, rmax = filters.get("rarityMin"), filters.get("rarityMax")
    out = []
    for e in entries.values():
        if e["f"] not in files:
            continue
        if e.get("t") == "gacha" and not filters.get("includeGachaOnly"):
            continue
        if e.get("nsfw") and not filters.get("includeNsfw"):
            continue
        if e.get("noncon") and not filters.get("includeNoncon"):
            continue
        if rmin is not None and e["r"] < rmin:
            continue
        if rmax is not None and e["r"] > rmax:
            continue
        if sources and e["s"] not in sources:
            continue
        out.append(e)
    return out


def layout_scale(tree, nodes):
    params = merged_params(tree)
    radius = params.get("radius")
    radius = float(radius) if isinstance(radius, (int, float)) and radius > 0 else 0.0
    extent = 0.0
    for n in nodes:
        r = float(n.get("r") or 0)
        if not r:
            pos = n.get("pos") or [0, 0, 0]
            r = math.hypot(*(float(v or 0) for v in pos[:3]))
        extent = max(extent, r)
    if extent > radius:          # stale/missing params: trust the drawn layout
        radius = extent
    if not radius:
        radius = 10.0
    inner = params.get("innerFraction")
    inner = float(inner) if isinstance(inner, (int, float)) else 0.12
    return radius, inner


def expected_radial(entry, rmin, span, radius, inner):
    t = (entry["r"] - rmin) / span if span else 0.0
    return max(radius * 0.05,
               min(radius, radius * (inner + (1.0 - inner) * t)))


def implied_radius(node, entry, rmin, span, inner):
    base = inner + (1.0 - inner) * ((entry["r"] - rmin) / span if span else 0.0)
    return (float(node.get("r") or 0) / base) if base > 0 else 0.0


def connected(nodes, edges):
    adj = defaultdict(set)
    for a, b, _d in edges:
        adj[a].add(b)
        adj[b].add(a)
    if not nodes:
        return True
    seen = {nodes[0]["id"]}
    q = deque(seen)
    while q:
        x = q.popleft()
        for y in adj[x]:
            if y not in seen:
                seen.add(y)
                q.append(y)
    return len(seen) == len(nodes)


def repair(path, apply=False, threshold=0.4, samples=96):
    payload = json.load(open(path, encoding="utf-8"))
    tree = payload.get("tree")
    if not tree or not tree.get("topology"):
        sys.exit("this tool expects an app export with payload.tree.topology")
    topo = tree["topology"]
    nodes = topo.get("nodes") or []
    edges = topo.get("edges") or []
    entries = load_entries()

    radius, inner = layout_scale(tree, nodes)
    pool = pool_entries(entries, tree.get("filters") or {})
    prs = [e["r"] for e in pool]
    rmin = min(prs)
    span = (max(prs) - rmin) or 1.0

    suspects = []
    for nd in nodes:
        e = entries.get((nd.get("file"), nd.get("number")))
        if not e:
            continue
        imp = implied_radius(nd, e, rmin, span, inner)
        if imp < radius * threshold:
            suspects.append((nd, e, imp))

    print(f"{path}")
    print(f"  layout radius {radius:g}, inner {inner:g}, "
          f"rarity range {rmin:g}-{rmin + span:g}")
    print(f"  {len(nodes)} nodes, {len(edges)} edges, "
          f"connected={connected(nodes, edges)}")
    if not suspects:
        print("  no out-of-band nodes found")
        return 0

    suspects.sort(key=lambda s: s[0]["r"])
    print(f"  {len(suspects)} node(s) placed on the wrong shell "
          f"(implied radius < {radius * threshold:g}):")
    for nd, e, imp in suspects[:8]:
        print(f"    id {nd['id']:>5}  {e['name'][:34]:34}  rarity {e['r']:<4g} "
              f"r {nd['r']:<7.2f} implied {imp:.1f}")
    if len(suspects) > 8:
        print(f"    ... and {len(suspects) - 8} more")
    rare = [e["r"] for _, e, _ in suspects]
    print(f"  their rarities span {min(rare):g}-{max(rare):g}; "
          f"they should sit at radius "
          f"{expected_radial({'r': min(rare)}, rmin, span, radius, inner):.1f}-"
          f"{expected_radial({'r': max(rare)}, rmin, span, radius, inner):.1f}")

    if not apply:
        print("  (report only; pass --apply to rewrite the file)")
        return 1

    # ---- re-place -------------------------------------------------------
    suspect_ids = {nd["id"] for nd, _, _ in suspects}
    moved = {nd["id"]: nd for nd, _, _ in suspects}
    others = [nd for nd in nodes if nd["id"] not in suspect_ids]
    rng = random.Random((tree.get("seed") or 0) ^ 0x5EED)
    placed = []
    for nd, e, _imp in suspects:
        radial = expected_radial(e, rmin, span, radius, inner)
        best, best_d = None, -1.0
        for _ in range(samples):
            z = rng.random() * 2 - 1
            th = rng.random() * 2 * math.pi
            rr = math.sqrt(max(0.0, 1 - z * z))
            p = [radial * rr * math.cos(th),
                 radial * rr * math.sin(th),
                 radial * z]
            md = min((math.dist(p, o["pos"]) for o in others + placed),
                     default=float("inf"))
            if md > best_d:
                best_d, best = md, p
        nd["pos"] = [round(c, 6) for c in best]
        nd["r"] = round(radial, 6)
        placed.append(nd)

    # ---- re-link --------------------------------------------------------
    params = merged_params(tree)
    maxd = float(params.get("maxLinkDistance") or 0.6) * radius
    k_max = max(1, round(float(params.get("meanDegree") or 2.5)))
    kept = [e for e in edges if e[0] not in suspect_ids and e[1] not in suspect_ids]
    removed = len(edges) - len(kept)
    seen = {tuple(sorted((e[0], e[1]))) for e in kept}
    fresh = []
    for nd in placed:
        cands = sorted(
            ((math.dist(nd["pos"], o["pos"]), o["id"]) for o in nodes
             if o["id"] != nd["id"]),
            key=lambda x: x[0])
        linked = 0
        for d, oid in cands:
            if linked >= k_max:
                break
            if d > maxd and linked > 0:
                break
            key = tuple(sorted((nd["id"], oid)))
            if key in seen:
                continue
            seen.add(key)
            fresh.append([min(nd["id"], oid), max(nd["id"], oid), round(d, 6)])
            linked += 1
        if not linked and cands:
            d, oid = cands[0]
            key = tuple(sorted((nd["id"], oid)))
            if key not in seen:
                seen.add(key)
                fresh.append([min(nd["id"], oid), max(nd["id"], oid), round(d, 6)])

    topo["edges"] = kept + fresh
    topo["params"] = dict(topo.get("params") or {}, radius=radius, innerFraction=inner)
    tree["params"] = dict(tree.get("params") or {}, radius=radius, innerFraction=inner)

    # ---- verify ---------------------------------------------------------
    worst = 0.0
    for nd in nodes:
        e = entries.get((nd.get("file"), nd.get("number")))
        if not e:
            continue
        exp = expected_radial(e, rmin, span, radius, inner)
        worst = max(worst, abs(float(nd["r"]) - exp))
    ok_conn = connected(nodes, topo["edges"])
    bad_after = sum(1 for nd in nodes
                    if (e := entries.get((nd.get("file"), nd.get("number"))))
                    and implied_radius(nd, e, rmin, span, inner) < radius * threshold)
    print(f"  removed {removed} stale link(s), added {len(fresh)} new link(s)")
    print(f"  remaining out-of-band nodes: {bad_after}")
    print(f"  worst rarity-band deviation after repair: {worst:.2f}")
    print(f"  connected after repair: {ok_conn}")
    if bad_after or not ok_conn or worst > radius * 0.25:
        print("  refusing to write: validation failed")
        return 2

    backup = path + ".bak"
    if not os.path.exists(backup):
        with open(backup, "w", encoding="utf-8") as fh:
            json.dump(json.load(open(path, encoding="utf-8")), fh,
                      ensure_ascii=False, separators=(",", ":"))
        print(f"  backup: {backup}")
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, separators=(",", ":"))
    print(f"  wrote {path}")
    return 0


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("path")
    ap.add_argument("--apply", action="store_true", help="rewrite the save file")
    ap.add_argument("--threshold", type=float, default=0.4,
                    help="flag nodes whose implied radius is below this "
                         "fraction of the layout radius (default 0.4)")
    args = ap.parse_args()
    sys.exit(repair(args.path, args.apply, args.threshold))


if __name__ == "__main__":
    main()
