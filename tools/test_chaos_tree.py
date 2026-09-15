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

    # award: plain tickets add cores + pooled points
    cu.main(["award", state_path, "bronze", "bronze", "silver", "gold"])
    st = cu.load_state(state_path)
    assert st["cores"] == 4
    assert abs(st["points"] - (25 + 25 + 250 + 2500)) < 1e-9
    assert st["inventory"] == []

    # normal unlock of a visible node, cost 10^rarity
    cost0 = 10.0 ** by[first]["rarity"]
    cu.main(["unlock", state_path, str(first)])
    st = cu.load_state(state_path)
    assert first in st["unlocked"]
    assert abs(st["points"] - (2800 - cost0)) < 1e-6
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
                   if i not in locked and i not in cu.visible(tree, locked)), None)
    if notvis is not None:
        assert "not visible" in expect_error(cu.unlock, st, tree, notvis)
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


if __name__ == "__main__":
    main()