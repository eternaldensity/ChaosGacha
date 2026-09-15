#!/usr/bin/env python3
"""Self-test for the Chaos Tree generator + usage engine.

Run from the repo root:
    python3 tools/test_chaos_tree.py
"""
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import generate_tree as gt      # noqa: E402
import chaos_tree_use as cu     # noqa: E402


def build_small_tree():
    tmp = tempfile.mkdtemp(prefix="chaos-tree-test-")
    path = os.path.join(tmp, "t.json")
    items = gt.load_entries(["ability"], None, None, set(), set(), True)
    params = {
        "radius": 1.0, "distance_variance": 0.15, "clustering": 0.4,
        "clusters": 2, "degree_dist": "poisson", "mean_degree": 2.0,
        "degree_min": 1, "degree_max": None, "rejoin_bias": 0.9,
        "link_falloff": 2.0, "max_link_distance": 0.6, "connect": True,
    }
    import random
    rng = random.Random(10)
    nodes, edges, targets = gt.generate_tree(items[:20], params, rng)
    nodes, edges = gt.add_root(nodes, edges)
    stats = gt.compute_stats(nodes, edges, targets)
    gt.save_tree(nodes, edges, stats, items[:20], params, 10, path)
    return tmp, path


def expect_error(fn, *a, **k):
    try:
        fn(*a, **k)
    except cu.UsageError as e:
        return str(e)
    raise AssertionError(f"expected UsageError from {fn.__name__}")


def main():
    tmp, tree_path = build_small_tree()
    tree = cu.load_tree(tree_path)
    by = tree["by_id"]
    n = len(tree["nodes"])
    state_path = os.path.join(tmp, "s.json")

    cu.main(["init", state_path, "--tree", tree_path])
    st = cu.load_state(state_path)
    assert st["unlocked"] == [cu.ROOT_ID]
    vis = cu.visible(tree, [cu.ROOT_ID])
    assert len(vis) >= 1
    first = vis[0]

    # award: plain tickets add cores + pooled points (bronze 50, x10 tiers)
    cu.main(["award", state_path, "bronze", "bronze", "silver", "gold"])
    st = cu.load_state(state_path)
    assert st["cores"] == 4
    assert abs(st["points"] - (50 + 50 + 500 + 5000)) < 1e-9
    assert st["inventory"] == []

    # normal unlock of a visible node, cost 10^rarity
    cost0 = 10.0 ** by[first]["rarity"]
    cu.main(["unlock", state_path, str(first)])
    st = cu.load_state(state_path)
    assert first in st["unlocked"]
    assert abs(st["points"] - (5600 - cost0)) < 1e-6
    assert st["cores"] == 3

    # award special tickets
    cu.main(["award", state_path, "gold", "skip2",
             "gold", "item jump",
             "silver", "hop"])
    st = cu.load_state(state_path)
    kinds = sorted(t["kind"] for t in st["inventory"])
    assert kinds == ["hop", "jump", "skip"], kinds

    # skip reaches a node 2 hops out (skip2 => 1+N = 3)
    dist, _ = cu.hop_distances(tree, st["unlocked"])
    target2 = min((i for i in range(n) if dist.get(i) == 2),
                  key=lambda i: 10.0 ** by[i]["rarity"])
    assert target2 is not None
    while cu.node_cost(tree, target2) > st["points"]:
        cu.main(["award", state_path, "gold"])
        st = cu.load_state(state_path)
    cu.main(["skip", state_path, str(target2)])
    st = cu.load_state(state_path)
    assert target2 in st["unlocked"]

    # hop unlocks a >=2-hop target plus one free intermediate
    dist, _ = cu.hop_distances(tree, st["unlocked"])
    thop = min((i for i in range(n) if dist.get(i) >= 2),
               key=lambda i: 10.0 ** by[i]["rarity"])
    assert thop is not None
    while cu.node_cost(tree, thop) > st["points"]:
        cu.main(["award", state_path, "gold"])
        st = cu.load_state(state_path)
    before = set(st["unlocked"])
    cu.main(["hop", state_path, str(thop)])
    st = cu.load_state(state_path)
    added = set(st["unlocked"]) - before
    assert len(added) == 2, added
    assert thop in added

    # jump auto-closest (plain category ticket)
    from_id = st["unlocked"][0]
    cu.main(["award", state_path, "bronze", "ability jump"])
    cu.main(["jump", state_path, "ability", "--from", str(from_id)])
    st = cu.load_state(state_path)

    # choice jump with explicit pick
    cu.main(["award", state_path, "silver", "choice 2 jump"])
    cands = cu._jump_candidates(tree, "ability", from_id, st["unlocked"])[:2]
    assert len(cands) >= 1
    pick_idx = 1 if len(cands) >= 2 else 0
    cu.main(["jump", state_path, "ability", "--from", str(from_id),
             "--pick", str(pick_idx)])
    st = cu.load_state(state_path)

    # error paths
    assert "root" in expect_error(cu.unlock, st, tree, cu.ROOT_ID)
    locked = set(st["unlocked"])
    notvis = next((i for i in range(n)
                   if i not in locked and i not in cu._frontier(tree, locked)), None)
    if notvis is not None:
        assert "not adjacent" in expect_error(cu.unlock, st, tree, notvis)
    st_poor = cu.new_state(tree_path)
    cu.award(st_poor, "bronze")
    vis_poor = cu.visible(tree, [cu.ROOT_ID])
    big = max(vis_poor, key=lambda i: 10.0 ** by[i]["rarity"])
    if 10.0 ** by[big]["rarity"] > 25:
        assert "points" in expect_error(cu.unlock, st_poor, tree, big)
    st_empty = cu.new_state(tree_path)
    assert "inventory" in expect_error(cu.unlock_jump, st_empty, tree,
                                       "ability", cu.ROOT_ID, 0)
    assert "inventory" in expect_error(cu.unlock_hop, st_empty, tree, first)

    # ticket parsing
    cases = [
        ("gold", ("gold", "plain", {})),
        ("gold skip2", ("gold", "skip", {"n": 2})),
        ("skip 3 silver", ("silver", "skip", {"n": 3})),
        ("item jump", (None, "jump", {"category": "item"})),
        ("gold item jump", ("gold", "jump", {"category": "item"})),
        ("choice 2 jump bronze", ("bronze", "choice", {"n": 2, "category": None})),
        ("hop", (None, "hop", {})),
        ("gold hop", ("gold", "hop", {})),
    ]
    for spec, (exp_tier, kind, params) in cases:
        tier, got_kind, got_params = cu.parse_ticket(spec)
        assert tier == exp_tier, (spec, tier)
        assert got_kind == kind, (spec, got_kind)
        assert got_params == params, (spec, got_params)

    cu.main(["state", state_path])
    print("all chaos-tree tests passed")


def make_tree(nodes, edges):
    by_id = {nd["id"]: nd for nd in nodes}
    adj = {i: set() for i in by_id}
    for a, b in edges:
        adj[a].add(b)
        adj[b].add(a)
    return {"nodes": nodes, "by_id": by_id, "adj": adj,
            "edges": [{"a": a, "b": b} for a, b in edges],
            "meta": {}, "path": "<synthetic>"}


def test_meta():
    P = lambda x, y: [x, y, 0.0]
    nodes = [
        {"id": 0, "name": "Origin", "rarity": 0, "file": "__root__",
         "source": "", "description": "", "pos": P(0, 0)},
        {"id": 1, "name": "Twig", "rarity": 0.2, "file": "ability",
         "source": "Generic", "description": "plain", "pos": P(0.10, 0)},
        {"id": 2, "name": "Sight +1", "rarity": 2.0, "file": "meta",
         "source": "System", "description": "(Meta:sight:1)", "pos": P(0.15, 0)},
        {"id": 3, "name": "Prosperity +10", "rarity": 2.0, "file": "meta",
         "source": "System", "description": "(Meta:ticket-bonus:10)", "pos": P(0.20, 0)},
        {"id": 4, "name": "Undo", "rarity": 3.0, "file": "meta",
         "source": "System", "description": "(Meta:lock-refund)", "pos": P(0.25, 0)},
        {"id": 5, "name": "Graft", "rarity": 3.0, "file": "meta",
         "source": "System", "description": "(Meta:add-link:3)", "pos": P(0.30, 0)},
        {"id": 6, "name": "Roll", "rarity": 3.0, "file": "meta",
         "source": "System", "description": "(Meta:gacha:5)", "pos": P(0.35, 0)},
        {"id": 7, "name": "Flame Soul", "rarity": 1.0, "file": "ability",
         "source": "Generic", "description": "a fire spirit", "pos": P(0.40, 0)},
        {"id": 8, "name": "Firebrand", "rarity": 1.2, "file": "ability",
         "source": "Generic", "description": "flame grows", "pos": P(0.12, 0.1)},
        {"id": 9, "name": "TraceName", "rarity": 2.5, "file": "meta",
         "source": "System", "description": "(Meta:trace-name)", "pos": P(0.18, 0.12)},
        {"id": 10, "name": "Glimpse", "rarity": 3.0, "file": "meta",
         "source": "System", "description": "(Meta:reveal-temp)", "pos": P(0.24, 0.14)},
        {"id": 11, "name": "Omni", "rarity": 1.0, "file": "meta",
         "source": "System", "description": "(Meta:reveal-full)", "pos": P(0.30, 0.16)},
        {"id": 12, "name": "FarSight", "rarity": 3.0, "file": "meta",
         "source": "System", "description": "(Meta:see-far)", "pos": P(0.17, 0.05)},
        {"id": 13, "name": "TraceDesc", "rarity": 3.0, "file": "meta",
         "source": "System", "description": "(Meta:trace-desc)", "pos": P(0.20, 0.16)},
    ]
    edges = [(0, 1), (1, 2), (2, 3), (3, 4), (4, 5), (5, 6), (6, 7),
             (2, 12), (8, 9), (9, 10), (10, 11), (9, 13)]
    tree = make_tree(nodes, edges)

    st = cu.new_state("<synthetic>")

    # sight reveals 2 hops but normal unlock still needs adjacency
    st["unlocked"] = [0, 1, 2]
    meta = cu.view_state(tree, st)
    assert meta["sight"] == 1
    base = cu.visible(tree, [0, 1, 2])
    assert 3 in base and 4 not in base
    assert 4 in cu.visible(tree, [0, 1, 2], meta)
    assert 4 not in cu._frontier(tree, [0, 1, 2])
    assert "not adjacent" in expect_error(cu.unlock, st, tree, 4)

    # ticket bonus (Prosperity +10%) is a percentage of the ticket's points
    st["unlocked"] = [0, 1, 2, 3]
    meta = cu.view_state(tree, st)
    assert meta["ticket_bonus"] == 10
    before = st["points"]
    st["cores"] = 0
    cu.award(st, "bronze", meta["ticket_bonus"])
    assert abs(st["points"] - (before + 55)) < 1e-9   # 50 * 1.10

    # lock and refund
    st["unlocked"] = [0, 1, 2, 3, 4]
    st["points"], st["cores"] = 0.0, 0
    assert cu.view_state(tree, st)["lock_refund"] == 1
    refund = cu.use_lock_refund(st, tree, 3)
    assert 3 not in st["unlocked"]
    assert abs(refund - 100) < 1e-9
    assert st["cores"] == 1 and abs(st["points"] - 100) < 1e-9
    assert "charge" in expect_error(cu.use_lock_refund, st, tree, 4)

    # graft a link between close unconnected nodes
    st["unlocked"] = [0, 1, 2, 3, 4, 5]
    d = cu.use_add_link(st, tree, 2, 8)
    assert 8 in tree["adj"][2] and st["added_links"] == [[2, 8]]
    assert "already connected" in expect_error(cu.use_add_link, st, tree, 2, 8)
    assert "too far" in expect_error(cu.use_add_link, st, tree, 1, 7)
    st["meta_used"]["add_link"] = 3
    assert "charge" in expect_error(cu.use_add_link, st, tree, 4, 8)

    # gacha roll unlocks a random node with rarity <= 5
    st = cu.new_state("<synthetic>")
    st["unlocked"] = [0, 1, 2, 3, 4, 5, 6]
    assert cu.view_state(tree, st)["gacha_max"] == 5
    before = set(st["unlocked"])
    target = cu.use_gacha(st, tree)
    nid = next(iter(set(st["unlocked"]) - before))
    assert target["id"] == nid and tree["by_id"][nid]["rarity"] <= 5
    assert "charge" in expect_error(cu.use_gacha, st, tree)

    # temporary reveal (Glimpse) shows everything for 10s
    st = cu.new_state("<synthetic>")
    st["unlocked"] = [0, 1, 2, 3, 4, 5, 6, 8, 9, 10]
    until = cu.use_reveal(st, tree)
    st["reveal_temp_until"] = until
    meta = cu.view_state(tree, st)
    assert set(cu.visible(tree, st["unlocked"], meta)) == {7, 11, 12, 13}

    # permanent reveal (Omnisight)
    st = cu.new_state("<synthetic>")
    st["unlocked"] = [0, 1, 2, 3, 4, 5, 6, 8, 9, 10, 11]
    meta = cu.view_state(tree, st)
    assert meta["reveal_full"]
    assert cu.visible(tree, st["unlocked"], meta) == [7, 12, 13]

    # far sight reveals unconnected nodes within range
    st = cu.new_state("<synthetic>")
    st["unlocked"] = [0, 1, 12]
    meta = cu.view_state(tree, st)
    assert meta["see_far"]
    assert 8 in cu.visible(tree, st["unlocked"], meta)
    assert 8 not in cu._frontier(tree, st["unlocked"])

    # trace by name / description
    st = cu.new_state("<synthetic>")
    st["unlocked"] = [0, 1, 2, 3, 4, 5, 6, 9, 13]
    res = cu.trace(tree, st, "name", "flame")
    assert res and res[0][1]["id"] == 7
    res = cu.trace(tree, st, "desc", "flame")
    assert res and res[0][1]["id"] == 8
    st2 = cu.new_state("<synthetic>")
    st2["unlocked"] = [0, 1]
    assert "ability" in expect_error(cu.trace, tree, st2, "name", "flame")
    print("meta-node tests passed")


if __name__ == "__main__":
    main()
    test_meta()