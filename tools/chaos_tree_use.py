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
    bronze 50, silver 500, gold 5k, platinum 50k, diamond 500k,
    legendary 5M, mythical 50M, divine 500M, transcendent 5B.
    (points pool in the wallet, so higher rarities are reachable by
    combining several tickets)

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

Tree meta nodes: normal ability/item/trait entries carrying a (Tree) tag
and a (Meta:<key>:<value>) token in their description (stored in the JSON
'meta' field). While unlocked they grant an effect:
    sight:N        view locked nodes N extra connections away
    see-far        view locked nodes within SEE_FAR_DISTANCE of unlocked
                   nodes even if unconnected
    trace-name     allow the trace command against node names
    trace-desc     allow the trace command against descriptions
    reveal-full    permanently reveal the whole tree
    ticket-bonus:N every ticket awarded grants N% extra points (additive)
    reveal-temp    one use: reveal the full tree for 10 seconds
    lock-refund    one use: lock an unlocked node and refund core+points
    add-link:N     N uses: add an edge between two close unconnected nodes
    gacha:R        one use: randomly unlock a locked node with rarity <= R
Unlocking is adjacency-based: sight/reveal only let you SEE further; the
skip/jump/hop tickets are still how you travel.

Modes of use (CLI):
    init STATE --tree TREE.json          create a fresh player state
    award STATE TICKET [TICKET...]       award tickets (adds cores + points)
    state STATE                          show wallet, cores, inventory, nodes
    visible STATE                        list unlockable nodes and their costs
    unlock STATE NODE                    normal unlock (must be adjacent)
    skip STATE NODE [--n N]              unlock with a skip ticket
    jump STATE CATEGORY --from ID [--pick I]   jump / choice-N jump
    hop STATE NODE                       unlock with a hop ticket
    use STATE ACTION [ARGS]              lockrefund NODE | addlink A B |
                                         reveal | gacha
    trace STATE --name X [--n N]         trace routes to closest matches
           STATE --desc X [--n N]        (requires the matching trace node)
"""
import argparse
import json
import math
import os
import random
import re
import sys
import time
from collections import deque

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# --- editable tuning -------------------------------------------------------
TIER_POINTS = {
    "bronze": 50,
    "silver": 500,
    "gold": 5000,
    "platinum": 50000,
    "diamond": 500000,
    "legendary": 5000000,
    "mythical": 50000000,
    "divine": 500000000,
    "transcendent": 5000000000,
}
CATEGORIES = ["ability", "item", "skill", "trait", "familiar"]
ROOT_ID = 0
SEE_FAR_DISTANCE = 0.35     # sphere units; used by the Far Sight meta node
ADD_LINK_DISTANCE = 0.25    # sphere units; max span for Graft
TRACE_DEFAULT_N = 3
META_RE = re.compile(r"\(Meta:([^)]+)\)")


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
            "inventory": [], "unlocked": [ROOT_ID],
            "meta_used": {}, "added_links": [], "reveal_temp_until": 0}


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


def parse_meta(desc):
    """Extract (Meta:key:value) / (Meta:flag) tokens from a description."""
    out = []
    for m in META_RE.finditer(desc):
        key = m.group(1)
        if ":" in key:
            k, v = key.split(":", 1)
            try:
                v = int(v)
            except ValueError:
                pass
        else:
            k, v = key, True
        out.append((k, v))
    return out


def iter_meta(nd):
    """Meta tokens for a node: from the JSON 'meta' field if present, plus
    any (Meta:...) tokens left in the raw description (e.g. hand-made trees)."""
    for raw in nd.get("meta") or []:
        key = raw[5:] if raw.startswith("Meta:") else raw
        if ":" in key:
            k, v = key.split(":", 1)
            try:
                v = int(v)
            except ValueError:
                pass
        else:
            k, v = key, True
        yield k, v
    yield from parse_meta(nd["description"])


def derive_meta(tree, unlocked):
    """Capabilities granted by currently unlocked meta nodes."""
    meta = {"sight": 0, "see_far": False, "trace_name": False,
            "trace_desc": False, "reveal_full": False, "reveal_temp": False,
            "ticket_bonus": 0, "lock_refund": 0, "add_link": 0,
            "gacha": 0, "gacha_max": 0}
    for u in unlocked:
        nd = tree["by_id"][u]
        for k, v in iter_meta(nd):
            if k == "sight":
                meta["sight"] = max(meta["sight"], int(v))
            elif k == "see-far":
                meta["see_far"] = True
            elif k == "trace-name":
                meta["trace_name"] = True
            elif k == "trace-desc":
                meta["trace_desc"] = True
            elif k == "reveal-full":
                meta["reveal_full"] = True
            elif k == "reveal-temp":
                meta["reveal_temp"] = True
            elif k == "ticket-bonus":
                meta["ticket_bonus"] += int(v)
            elif k == "lock-refund":
                meta["lock_refund"] += 1
            elif k == "add-link":
                meta["add_link"] += int(v)
            elif k == "gacha":
                meta["gacha"] += 1
                meta["gacha_max"] = max(meta["gacha_max"], int(v))
    return meta


def view_state(tree, state):
    """Derived capabilities plus the temporary-reveal timestamp."""
    meta = derive_meta(tree, state["unlocked"])
    meta["reveal_temp_until"] = state.get("reveal_temp_until", 0)
    return meta


def _frontier(tree, unlocked):
    adj = tree["adj"]
    f = set()
    for u in unlocked:
        f.update(adj[u])
    f.difference_update(unlocked)
    return f


def visible(tree, unlocked, meta=None):
    """Locked nodes you can see. Base = neighbours of unlocked nodes; the
    sight/see-far/reveal meta nodes extend this."""
    meta = meta or {}
    now = time.time()
    if meta.get("reveal_full") or meta.get("reveal_temp_until", 0) >= now:
        return sorted(i for i in tree["by_id"] if i not in unlocked)
    adj = tree["adj"]
    sight = meta.get("sight", 0)
    if sight <= 0 and not meta.get("see_far"):
        vis = set()
        for u in unlocked:
            vis.update(adj[u])
        vis.difference_update(unlocked)
        return sorted(vis)
    dist, _ = hop_distances(tree, unlocked)
    vis = {i for i in dist if dist[i] <= 1 + sight and i not in unlocked}
    if meta.get("see_far"):
        for u in unlocked:
            unode = tree["by_id"][u]
            for nd in tree["nodes"]:
                if nd["id"] in unlocked or nd["id"] in vis:
                    continue
                if distance3(unode, nd) <= SEE_FAR_DISTANCE:
                    vis.add(nd["id"])
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


def award(state, spec, bonus_pct=0):
    tier, kind, params = parse_ticket(spec)
    state["cores"] += 1
    base = TIER_POINTS.get(tier, 0)
    state["points"] += base * (1.0 + bonus_pct / 100.0)
    if kind != "plain":
        ticket = {"kind": kind, "tier": tier}
        ticket.update(params)
        state["inventory"].append(ticket)
    return tier, kind, params


# --- unlocks ---------------------------------------------------------------

def unlock(state, tree, nid):
    """Normal unlock: node must be adjacent to an unlocked node."""
    if nid == ROOT_ID:
        raise UsageError("the root is free")
    if nid in state["unlocked"]:
        raise UsageError(f"node {nid} is already unlocked")
    if nid not in _frontier(tree, state["unlocked"]):
        raise UsageError(f"node {nid} is not adjacent to an unlocked node "
                         f"(use a skip/jump/hop ticket to reach it)")
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


# --- meta abilities ---------------------------------------------------------

def _used(state, key):
    return state["meta_used"].get(key, 0)


def apply_added_links(tree, state):
    for a, b in state.get("added_links", []):
        tree["adj"][a].add(b)
        tree["adj"][b].add(a)
    return tree


def use_lock_refund(state, tree, nid):
    """Lock an unlocked node and refund its core + points (single use)."""
    meta = derive_meta(tree, state["unlocked"])
    if _used(state, "lock_refund") >= meta["lock_refund"]:
        raise UsageError("no lock-refund charge left")
    if nid == ROOT_ID:
        raise UsageError("the root cannot be locked")
    if nid not in state["unlocked"]:
        raise UsageError(f"node {nid} is not unlocked")
    refund = node_cost(tree, nid)
    state["unlocked"].remove(nid)
    state["points"] += refund
    state["cores"] += 1
    state["meta_used"]["lock_refund"] = _used(state, "lock_refund") + 1
    return refund


def use_add_link(state, tree, a, b):
    """Add an edge between two close, unconnected nodes (limited uses)."""
    meta = derive_meta(tree, state["unlocked"])
    if _used(state, "add_link") >= meta["add_link"]:
        raise UsageError("no add-link charge left")
    if a == b or a == ROOT_ID or b == ROOT_ID:
        raise UsageError("links join two real nodes")
    if b in tree["adj"][a]:
        raise UsageError(f"nodes {a} and {b} are already connected")
    d = distance3(tree["by_id"][a], tree["by_id"][b])
    if d > ADD_LINK_DISTANCE:
        raise UsageError(f"nodes {a} and {b} are too far apart "
                         f"({fmt(d)} > {ADD_LINK_DISTANCE})")
    tree["adj"][a].add(b)
    tree["adj"][b].add(a)
    state["added_links"].append([a, b])
    state["meta_used"]["add_link"] = _used(state, "add_link") + 1
    return d


def use_reveal(state, tree):
    """Temporary full reveal (10 seconds)."""
    meta = derive_meta(tree, state["unlocked"])
    if not meta["reveal_temp"]:
        raise UsageError("you have no Glimpse (reveal) charge")
    state["reveal_temp_until"] = time.time() + 10
    return state["reveal_temp_until"]


def use_gacha(state, tree):
    """Randomly unlock a locked node with rarity <= R (single use)."""
    meta = derive_meta(tree, state["unlocked"])
    if _used(state, "gacha") >= meta["gacha"]:
        raise UsageError("no gacha charge left")
    eligible = [nd for nd in tree["nodes"]
                if nd["id"] != ROOT_ID and nd["id"] not in state["unlocked"]
                and nd["rarity"] <= meta["gacha_max"]]
    if not eligible:
        raise UsageError("no locked node with low enough rarity to roll")
    target = random.choice(eligible)
    _unlock(state, target["id"])
    state["meta_used"]["gacha"] = _used(state, "gacha") + 1
    return target


def trace(tree, state, field, x, n=TRACE_DEFAULT_N):
    """Trace routes to the n closest locked nodes whose name/description
    contains x. Returns a list of (dist, node, [path ids])."""
    meta = derive_meta(tree, state["unlocked"])
    cap = "trace_name" if field == "name" else "trace_desc"
    if not meta[cap]:
        raise UsageError(f"you lack the trace-by-{field} ability")
    x = x.lower()
    dist, prev = hop_distances(tree, state["unlocked"])
    matches = []
    for nd in tree["nodes"]:
        if nd["id"] == ROOT_ID or nd["id"] in state["unlocked"]:
            continue
        hay = nd["name"].lower() if field == "name" else nd["description"].lower()
        if x in hay and nd["id"] in dist:
            near = min((distance3(tree["by_id"][u], nd)
                        for u in state["unlocked"]), default=math.inf)
            matches.append((dist[nd["id"]], near, nd))
    matches.sort(key=lambda m: (m[0], m[1], m[2]["id"]))
    out = []
    for d, _near, nd in matches[:n]:
        path = [nd["id"]]
        cur = nd["id"]
        while cur in prev:
            cur = prev[cur]
            path.append(cur)
        path.reverse()
        out.append((d, nd, path))
    return out


# --- CLI -------------------------------------------------------------------

def _visible_lines(tree, unlocked, meta=None):
    rows = []
    for nid in visible(tree, unlocked, meta):
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

    p = add("use", help="use a meta ability (lockrefund/addlink/reveal/gacha)")
    p.add_argument("state")
    p.add_argument("action", choices=["lockrefund", "addlink", "reveal", "gacha"])
    p.add_argument("args", nargs="*", type=int, help="node ids")

    p = add("trace", help="trace routes to closest matching locked nodes")
    p.add_argument("state")
    p.add_argument("--name", help="match a substring in node names")
    p.add_argument("--desc", help="match a substring in descriptions")
    p.add_argument("--n", type=int, default=TRACE_DEFAULT_N,
                   help="number of matches to trace (default 3)")
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
    apply_added_links(tree, state)
    meta = view_state(tree, state)

    if args.cmd == "award":
        bonus_pct = meta["ticket_bonus"]
        for spec in args.tickets:
            tier, kind, params = award(state, spec, bonus_pct)
            pts = TIER_POINTS.get(tier, 0) * (1.0 + bonus_pct / 100.0)
            extra = f" [{kind}]" if kind != "plain" else ""
            print(f"awarded {tier or 'tierless'}{extra}: +1 core, "
                  f"+{fmt(pts)} pts")
    elif args.cmd == "state":
        print(f"tree: {tree['path']}")
        print(f"points: {fmt(state['points'])}   cores: {state['cores']}")
        print(f"unlocked: {len(state['unlocked'])} node(s)")
        meta_bits = [f"sight+{meta['sight']}"] if meta["sight"] else []
        if meta["see_far"]:
            meta_bits.append("see-far")
        if meta["trace_name"]:
            meta_bits.append("trace-name")
        if meta["trace_desc"]:
            meta_bits.append("trace-desc")
        if meta["reveal_full"]:
            meta_bits.append("reveal-full")
        if meta["ticket_bonus"]:
            meta_bits.append(f"ticket+{meta['ticket_bonus']}%")
        for key, label in (("lock_refund", "lock-refund"),
                           ("add_link", "add-link"), ("gacha", "gacha")):
            if meta[key]:
                left = meta[key] - state["meta_used"].get(key, 0)
                meta_bits.append(f"{label}x{left}")
        if meta["reveal_temp"] and state["reveal_temp_until"] <= time.time():
            meta_bits.append("reveal(10s)")
        print("meta: " + (", ".join(meta_bits) if meta_bits else "none"))
        print("inventory:")
        for i, t in enumerate(state["inventory"]):
            print(f"  [{i}] {t['tier']} {t['kind']} "
                  f"({', '.join(f'{k}={v}' for k, v in t.items() if k not in ('kind', 'tier'))})")
        print("visible:")
        for nid, name, r, f, src, cost in _visible_lines(tree, state["unlocked"], meta):
            print(f"  {nid}. {name} [{f} | {src}] rarity {r} cost {fmt(cost)}")
    elif args.cmd == "visible":
        for nid, name, r, f, src, cost in _visible_lines(tree, state["unlocked"], meta):
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
    elif args.cmd == "use":
        if args.action == "lockrefund":
            if len(args.args) != 1:
                raise UsageError("use lockrefund NODE")
            refund = use_lock_refund(state, tree, args.args[0])
            print(f"locked {args.args[0]} and refunded {fmt(refund)} pts + 1 core")
        elif args.action == "addlink":
            if len(args.args) != 2:
                raise UsageError("use addlink A B")
            d = use_add_link(state, tree, args.args[0], args.args[1])
            print(f"linked {args.args[0]} -- {args.args[1]} (span {fmt(d)})")
        elif args.action == "reveal":
            until = use_reveal(state, tree)
            print(f"full tree revealed for 10s (until {until:.0f})")
        elif args.action == "gacha":
            target = use_gacha(state, tree)
            print(f"rolled {target['id']}. {target['name']} "
                  f"({target['file']}, rarity {target['rarity']})")
    elif args.cmd == "trace":
        if args.name is None and args.desc is None:
            raise UsageError("trace needs --name X or --desc X")
        field = "name" if args.name is not None else "desc"
        x = args.name if args.name is not None else args.desc
        for d, nd, path in trace(tree, state, field, x, args.n):
            route = " -> ".join(
                f"{p}.{tree['by_id'][p]['name']}" for p in path)
            print(f"[{d} hop] {nd['id']}. {nd['name']} "
                  f"(rarity {nd['rarity']}) :: {route}")

    save_state(state, args.state)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except UsageError as e:
        print(f"error: {e}", file=sys.stderr)
        sys.exit(1)
