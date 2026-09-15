#!/usr/bin/env python3
"""Chaos Tree usage engine + CLI.

The tree (a JSON file produced by tools/generate_tree.py) is explored by
unlocking nodes. The synthetic root (node 0) is free; every other node costs
1 core plus points equal to 10^rarity. Tickets provide 1 core each and add
their tier's points to a shared wallet, so points pool across tickets while
cores keep the 1-node-per-ticket rule.

By default only nodes adjacent to an unlocked node are visible/unlockable.
Special tickets reach further (see below).

Ticket tiers (points; cores always 1)
    bronze 25, silver 250, gold 2.5k, platinum 25k, diamond 250k,
    legendary 2.5M, mythical 25M, divine 250M, transcendent 10B.
    (10B covers every rarity: 10^9.9 ~ 7.9B.)

Special tickets (tier optional; if present the tier still adds its core's
points, otherwise the ticket is traversal-only and adds 0 points):
    skip N           unlock a node up to N extra hops beyond the frontier
                     (hop distance <= 1+N from the unlocked set)
    <cat> jump       unlock the closest node of category <cat> (ability,
                     item, skill, trait, familiar) that is not directly
                     connected to a chosen unlocked node (Euclidean distance)
    choice N jump    same, but choose from the N closest candidates
    hop              unlock a node at hop distance >= 2, plus ONE free
                     intermediate node on the shortest path from the
                     unlocked set to it

Modes of use (CLI):
    init STATE --tree TREE.json          create a fresh player state
    award STATE TICKET [TICKET...]       award tickets (adds cores + points)
    state STATE                          show wallet, cores, inventory, nodes
    visible STATE                        list unlockable nodes and their costs
    unlock STATE NODE                    normal unlock (must be visible)
    skip STATE NODE [--n N]              unlock with a skip ticket
    jump STATE CATEGORY --from ID [--pick I]   jump / choice-N jump
    hop STATE NODE                       unlock with a hop ticket
"""
import argparse
import json
import math
import os
import sys
from collections import deque

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# --- editable tuning -------------------------------------------------------
TIER_POINTS = {
    "bronze": 25,
    "silver": 250,
    "gold": 2500,
    "platinum": 25000,
    "diamond": 250000,
    "legendary": 2500000,
    "mythical": 25000000,
    "divine": 250000000,
    "transcendent": 10000000000,
}
CATEGORIES = ["ability", "item", "skill", "trait", "familiar"]
ROOT_ID = 0


# --- tree + state ----------------------------------------------------------

def load_tree(path):
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)
    nodes = data["nodes"]
    by_id = {nd["id"]: nd for nd in nodes}
    adj = {i: set() for i in by_id}
    for e in data["edges"]:
        adj[e["a"]].add(e["b"])
        adj[e["b"]].add(e["a"])
    return {"nodes": nodes, "by_id": by_id, "adj": adj,
            "edges": data["edges"], "meta": data, "path": path}


def new_state(tree_path):
    return {"tree": tree_path, "points": 0.0, "cores": 0,
            "inventory": [], "unlocked": [ROOT_ID]}


def load_state(path):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def save_state(state, path):
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(state, fh, indent=2, ensure_ascii=False)


# --- core helpers ----------------------------------------------------------

def fmt(n):
    return f"{n:,.2f}"


def node_cost(tree, nid):
    return 10.0 ** tree["by_id"][nid]["rarity"]


def visible(tree, unlocked):
    adj = tree["adj"]
    vis = set()
    for u in unlocked:
        vis.update(adj[u])
    vis.difference_update(unlocked)
    return sorted(vis)


def hop_distances(tree, unlocked):
    """BFS over the full graph from the unlocked set. Returns (dist, prev)."""
    adj = tree["adj"]
    dist, prev = {}, {}
    q = deque()
    for u in unlocked:
        dist[u] = 0
        q.append(u)
    while q:
        a = q.popleft()
        for b in adj[a]:
            if b not in dist:
                dist[b] = dist[a] + 1
                prev[b] = a
                q.append(b)
    return dist, prev


def distance3(a, b):
    return math.dist(a["pos"], b["pos"])


def _pay(state, tree, nid):
    if state["cores"] < 1:
        raise UsageError("not enough cores (award a ticket first)")
    cost = node_cost(tree, nid)
    if state["points"] < cost:
        raise UsageError(
            f"not enough points: need {fmt(cost)}, have {fmt(state['points'])}")
    state["cores"] -= 1
    state["points"] -= cost


def _unlock(state, nid, extra=None):
    state["unlocked"].extend([nid] if extra is None else [nid] + extra)
    state["unlocked"] = sorted(set(state["unlocked"]))


class UsageError(Exception):
    pass


# --- ticket parsing / awarding ---------------------------------------------

def parse_ticket(spec):
    """Parse a ticket spec like 'gold', 'gold skip2', 'item jump',
    'choice 3 jump ability', 'hop gold'. Returns (tier, kind, params).
    Tier is optional for special tickets (0 points, traversal only)."""
    toks = spec.lower().replace(",", " ").split()
    tier, kind = None, "plain"
    n, category = None, None
    i = 0
    while i < len(toks):
        t = toks[i]
        if t in TIER_POINTS:
            tier = t
        elif t in CATEGORIES:
            category = t
        elif t == "skip":
            kind = "skip"
            if i + 1 < len(toks) and toks[i + 1].isdigit():
                n = int(toks[i + 1])
                i += 1
        elif t.startswith("skip") and t[4:].isdigit():
            kind, n = "skip", int(t[4:])
        elif t == "hop":
            kind = "hop"
        elif t == "jump":
            if kind == "plain":
                kind = "jump"
        elif t == "choice":
            kind = "choice"
            if i + 1 < len(toks) and toks[i + 1].isdigit():
                n = int(toks[i + 1])
                i += 1
        elif t.startswith("choice") and t[6:].isdigit():
            kind, n = "choice", int(t[6:])
        else:
            raise UsageError(f"unrecognised ticket token: {t!r}")
        i += 1

    params = {}
    if kind == "skip":
        params["n"] = n or 1
    elif kind == "jump":
        if category is None:
            raise UsageError(
                f"jump ticket needs a category ({', '.join(CATEGORIES)})")
        params["category"] = category
    elif kind == "choice":
        params["n"] = n or 3
        params["category"] = category  # None = any category
    if tier is None and kind == "plain":
        raise UsageError("a plain ticket needs a tier "
                         f"({', '.join(TIER_POINTS)})")
    return tier, kind, params


def award(state, spec):
    tier, kind, params = parse_ticket(spec)
    state["cores"] += 1
    if tier is not None:
        state["points"] += TIER_POINTS[tier]
    if kind != "plain":
        ticket = {"kind": kind, "tier": tier}
        ticket.update(params)
        state["inventory"].append(ticket)
    return tier, kind, params


# --- unlocks ---------------------------------------------------------------

def unlock(state, tree, nid):
    """Normal unlock: node must be visible (adjacent to an unlocked node)."""
    if nid == ROOT_ID:
        raise UsageError("the root is free")
    if nid in state["unlocked"]:
        raise UsageError(f"node {nid} is already unlocked")
    if nid not in visible(tree, state["unlocked"]):
        raise UsageError(f"node {nid} is not visible (unlock its neighbours first)")
    _pay(state, tree, nid)
    _unlock(state, nid)


def unlock_skip(state, tree, nid, n=None):
    """Unlock a node up to n extra hops beyond the frontier."""
    if nid in state["unlocked"]:
        raise UsageError(f"node {nid} is already unlocked")
    dist, _ = hop_distances(tree, state["unlocked"])
    if nid not in dist:
        raise UsageError(f"node {nid} is not connected to the unlocked set")
    tickets = [t for t in state["inventory"] if t["kind"] == "skip"]
    pick = None
    if n is not None:
        pick = next((t for t in tickets if t["n"] == n), None)
        if pick is None:
            raise UsageError(f"no skip {n} ticket in inventory")
    else:
        pick = next((t for t in sorted(tickets, key=lambda t: t["n"])
                     if 1 + t["n"] >= dist[nid]), None)
        if pick is None:
            raise UsageError(
                f"no skip ticket reaches node {nid} ({dist[nid]} hops; "
                f"need 1+N >= {dist[nid]})")
    state["inventory"].remove(pick)
    _pay(state, tree, nid)
    _unlock(state, nid)


def _jump_candidates(tree, category, from_id, unlocked):
    adj = tree["adj"]
    if from_id not in unlocked:
        raise UsageError(f"chosen node {from_id} is not unlocked")
    cands = []
    for nd in tree["nodes"]:
        if nd["id"] == ROOT_ID:
            continue
        if category is not None and nd["file"] != category:
            continue
        if nd["id"] in unlocked or nd["id"] in adj[from_id]:
            continue
        cands.append((distance3(tree["by_id"][from_id], nd), nd))
    cands.sort(key=lambda c: (c[0], c[1]["id"]))
    return cands


def unlock_jump(state, tree, category, from_id, pick=0):
    """Jump / choice-N jump. pick is the 0-based index into the closest list.
    category may be None for category-less choice tickets. Returns the
    unlocked node id."""
    tickets = [t for t in state["inventory"]
               if t["kind"] in ("jump", "choice")
               and (t.get("category") is None or t.get("category") == category)]
    if not tickets:
        label = category or "any"
        raise UsageError(f"no {label} jump/choice ticket in inventory")
    ticket = tickets[0]
    eff_cat = category if category is not None else ticket.get("category")
    cands = _jump_candidates(tree, eff_cat, from_id, state["unlocked"])
    if not cands:
        raise UsageError(f"no unlockable {'nodes' if eff_cat is None else eff_cat}"
                         f" nodes not directly connected to node {from_id}")
    limit = ticket["n"] if ticket["kind"] == "choice" else 1
    cands = cands[:limit]
    if pick < 0 or pick >= len(cands):
        raise UsageError(f"pick {pick} out of range (0..{len(cands) - 1})")
    state["inventory"].remove(ticket)
    target = cands[pick][1]["id"]
    _pay(state, tree, target)
    _unlock(state, target)
    return target


def unlock_hop(state, tree, nid):
    """Unlock a distant node plus one free intermediate on the shortest path."""
    tickets = [t for t in state["inventory"] if t["kind"] == "hop"]
    if not tickets:
        raise UsageError("no hop ticket in inventory")
    if nid in state["unlocked"]:
        raise UsageError(f"node {nid} is already unlocked")
    dist, prev = hop_distances(tree, state["unlocked"])
    if nid not in dist:
        raise UsageError(f"node {nid} is not connected to the unlocked set")
    if dist[nid] < 2:
        raise UsageError(f"node {nid} is only {dist[nid]} hop(s) away; "
                         f"a hop ticket needs a node at least 2 hops out")
    path = [nid]
    cur = nid
    while cur in prev:
        cur = prev[cur]
        path.append(cur)
    path.reverse()  # seed ... nid
    intermediate = path[1]
    state["inventory"].remove(tickets[0])
    _pay(state, tree, nid)
    _unlock(state, nid, extra=[intermediate])


# --- CLI -------------------------------------------------------------------

def _visible_lines(tree, unlocked):
    rows = []
    for nid in visible(tree, unlocked):
        nd = tree["by_id"][nid]
        rows.append((nid, nd["name"], nd["rarity"], nd["file"],
                     nd["source"], node_cost(tree, nid)))
    return rows


def _prompt_choice(cands):
    for i, (d, nd) in enumerate(cands):
        print(f"  [{i}] {nd['id']}. {nd['name']} ({nd['file']}, "
              f"rarity {nd['rarity']}, cost {fmt(10.0 ** nd['rarity'])})")
    if sys.stdin.isatty():
        try:
            return int(input("choose: ").strip())
        except (EOFError, ValueError):
            raise UsageError("no valid choice given")
    raise UsageError("--pick is required when not interactive")


def build_parser():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    def add(name, **kw):
        return sub.add_parser(name, help=kw.pop("help", None), **kw)

    p = add("init", help="create a fresh player state")
    p.add_argument("state")
    p.add_argument("--tree", required=True)

    p = add("award", help="award one or more tickets")
    p.add_argument("state")
    p.add_argument("tickets", nargs="+")

    p = add("state", help="show wallet, cores, inventory and unlocked nodes")
    p.add_argument("state")

    p = add("visible", help="list unlockable nodes and costs")
    p.add_argument("state")

    p = add("unlock", help="normal unlock of a visible node")
    p.add_argument("state")
    p.add_argument("node", type=int)

    p = add("skip", help="unlock with a skip ticket")
    p.add_argument("state")
    p.add_argument("node", type=int)
    p.add_argument("--n", type=int, help="skip distance (default: smallest sufficient)")

    p = add("jump", help="jump / choice-N jump (category optional for choice tickets)")
    p.add_argument("state")
    p.add_argument("category", nargs="?", default=None, choices=CATEGORIES,
                   help="target category (omit for a category-less choice ticket)")
    p.add_argument("--from", dest="from_id", type=int, required=True)
    p.add_argument("--pick", type=int, help="0-based candidate (required for choice tickets)")

    p = add("hop", help="unlock with a hop ticket")
    p.add_argument("state")
    p.add_argument("node", type=int)
    return ap


def main(argv=None):
    ap = build_parser()
    args = ap.parse_args(argv)

    if args.cmd == "init":
        os.makedirs(os.path.dirname(os.path.abspath(args.state)), exist_ok=True)
        save_state(new_state(args.tree), args.state)
        print(f"created {args.state} (root free, unlocked)")
        return 0

    state = load_state(args.state)
    tree = load_tree(state["tree"])

    if args.cmd == "award":
        for spec in args.tickets:
            tier, kind, params = award(state, spec)
            pts = TIER_POINTS.get(tier, 0)
            extra = f" [{kind}]" if kind != "plain" else ""
            print(f"awarded {tier or 'tierless'}{extra}: +1 core, "
                  f"+{fmt(pts)} pts")
    elif args.cmd == "state":
        print(f"tree: {tree['path']}")
        print(f"points: {fmt(state['points'])}   cores: {state['cores']}")
        print(f"unlocked: {len(state['unlocked'])} node(s)")
        print("inventory:")
        for i, t in enumerate(state["inventory"]):
            print(f"  [{i}] {t['tier']} {t['kind']} "
                  f"({', '.join(f'{k}={v}' for k, v in t.items() if k not in ('kind', 'tier'))})")
        print("visible:")
        for nid, name, r, f, src, cost in _visible_lines(tree, state["unlocked"]):
            print(f"  {nid}. {name} [{f} | {src}] rarity {r} cost {fmt(cost)}")
    elif args.cmd == "visible":
        for nid, name, r, f, src, cost in _visible_lines(tree, state["unlocked"]):
            print(f"{nid}. {name} [{f} | {src}] rarity {r} cost {fmt(cost)}")
    elif args.cmd == "unlock":
        unlock(state, tree, args.node)
        print(f"unlocked {args.node}. {tree['by_id'][args.node]['name']}")
    elif args.cmd == "skip":
        unlock_skip(state, tree, args.node, args.n)
        print(f"unlocked {args.node}. {tree['by_id'][args.node]['name']} (skip)")
    elif args.cmd == "jump":
        if args.pick is None:
            tickets = [t for t in state["inventory"]
                       if t["kind"] in ("jump", "choice")
                       and (t.get("category") is None
                            or t.get("category") == args.category)]
            if not tickets:
                raise UsageError("no jump/choice ticket in inventory")
            if tickets[0]["kind"] == "choice":
                eff = args.category or tickets[0].get("category")
                cands = _jump_candidates(tree, eff, args.from_id,
                                         state["unlocked"])[:tickets[0]["n"]]
                args.pick = _prompt_choice(cands)
            else:
                args.pick = 0
        target = unlock_jump(state, tree, args.category, args.from_id, args.pick)
        print(f"jumped to {tree['by_id'][target]['file']} node "
              f"{target}. {tree['by_id'][target]['name']}")
    elif args.cmd == "hop":
        unlock_hop(state, tree, args.node)
        print(f"unlocked {args.node}. {tree['by_id'][args.node]['name']} (hop)")

    save_state(state, args.state)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except UsageError as e:
        print(f"error: {e}", file=sys.stderr)
        sys.exit(1)
