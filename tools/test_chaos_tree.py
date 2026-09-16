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
    assert sum(1 for e in edges if e["a"] == 0) == 3  # 3 starting options
    stats = gt.compute_stats(nodes, edges, targets)
    assert stats["root"]["children"] == [e["b"] for e in edges if e["a"] == 0]
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
    target = cands[pick_idx][1]["id"]
    while cu.node_cost(tree, target) > st["points"]:
        cu.main(["award", state_path, "gold"])
        st = cu.load_state(state_path)
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
    P = lambda x, y: [x * 10, y * 10, 0.0]
    nodes = [
        {"id": 0, "name": "Origin", "rarity": 0, "file": "__root__",
         "source": "", "description": "", "pos": P(0, 0)},
        {"id": 1, "name": "Twig", "rarity": 0.2, "file": "ability",
         "source": "Generic", "description": "plain", "pos": P(0.10, 0)},
        {"id": 2, "name": "Sight +1", "rarity": 2.0, "file": "meta",
         "source": "Generic", "description": "(Meta:sight:1)", "pos": P(0.15, 0)},
        {"id": 3, "name": "Prosperity +10", "rarity": 2.0, "file": "meta",
         "source": "Generic", "description": "(Meta:ticket-bonus:10)", "pos": P(0.20, 0)},
        {"id": 4, "name": "Undo", "rarity": 3.0, "file": "meta",
         "source": "Generic", "description": "(Meta:lock-refund)", "pos": P(0.25, 0)},
        {"id": 5, "name": "Graft", "rarity": 3.0, "file": "meta",
         "source": "Generic", "description": "(Meta:add-link:3)", "pos": P(0.30, 0)},
        {"id": 6, "name": "Roll", "rarity": 3.0, "file": "meta",
         "source": "Generic", "description": "(Meta:gacha:5)", "pos": P(0.35, 0)},
        {"id": 7, "name": "Flame Soul", "rarity": 1.0, "file": "ability",
         "source": "Generic", "description": "a fire spirit", "pos": P(0.40, 0)},
        {"id": 8, "name": "Firebrand", "rarity": 1.2, "file": "ability",
         "source": "Generic", "description": "flame grows", "pos": P(0.12, 0.1)},
        {"id": 9, "name": "TraceName", "rarity": 2.5, "file": "meta",
         "source": "Generic", "description": "(Meta:trace-name)", "pos": P(0.18, 0.12)},
        {"id": 10, "name": "Glimpse", "rarity": 3.0, "file": "meta",
         "source": "Generic", "description": "(Meta:reveal-temp)", "pos": P(0.24, 0.14)},
        {"id": 11, "name": "Omni", "rarity": 1.0, "file": "meta",
         "source": "Generic", "description": "(Meta:reveal-full)", "pos": P(0.30, 0.16)},
        {"id": 12, "name": "FarSight", "rarity": 3.0, "file": "meta",
         "source": "Generic", "description": "(Meta:see-far)", "pos": P(0.17, 0.05)},
        {"id": 13, "name": "TraceDesc", "rarity": 3.0, "file": "meta",
         "source": "Generic", "description": "(Meta:trace-desc)", "pos": P(0.20, 0.16)},
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


def test_meta2():
    P = lambda x, y: [x * 10, y * 10, 0.0]
    nodes = [
        {"id": 0, "name": "Origin", "rarity": 0, "file": "__root__",
         "source": "", "description": "", "pos": P(0, 0)},
        {"id": 1, "name": "Twig", "rarity": 0.2, "file": "ability",
         "source": "Generic", "description": "plain", "pos": P(0.1, 0)},
        {"id": 2, "name": "Echo", "rarity": 3.0, "file": "ability",
         "source": "Generic", "description": "(Meta:echo)", "pos": P(0.2, 0)},
        {"id": 3, "name": "Survey", "rarity": 3.0, "file": "ability",
         "source": "Generic", "description": "(Meta:survey:1)", "pos": P(0.3, 0)},
        {"id": 4, "name": "Compass", "rarity": 3.0, "file": "ability",
         "source": "Generic", "description": "(Meta:compass)", "pos": P(0.4, 0)},
        {"id": 5, "name": "GreaterRoll", "rarity": 3.0, "file": "item",
         "source": "Generic", "description": "(Meta:gacha:5-7)", "pos": P(0.5, 0)},
        {"id": 6, "name": "Duplicate", "rarity": 3.0, "file": "item",
         "source": "Generic", "description": "(Meta:duplicate:5)", "pos": P(0.6, 0)},
        {"id": 7, "name": "Lifeline", "rarity": 3.0, "file": "item",
         "source": "Generic", "description": "(Meta:lifeline)", "pos": P(0.7, 0)},
        {"id": 8, "name": "Recall", "rarity": 3.0, "file": "item",
         "source": "Generic", "description": "(Meta:recall)", "pos": P(0.8, 0)},
        {"id": 9, "name": "RootPact", "rarity": 3.0, "file": "trait",
         "source": "Generic", "description": "(Meta:root-pact)", "pos": P(0.9, 0)},
        {"id": 10, "name": "Shuffle", "rarity": 3.0, "file": "item",
         "source": "Generic", "description": "(Meta:shuffle)", "pos": P(1.0, 0)},
        {"id": 11, "name": "Swap", "rarity": 3.0, "file": "item",
         "source": "Generic", "description": "(Meta:swap)", "pos": P(1.1, 0)},
        {"id": 12, "name": "Reshuffle", "rarity": 3.0, "file": "item",
         "source": "Generic", "description": "(Meta:reshuffle)", "pos": P(1.2, 0)},
        {"id": 13, "name": "CatSight", "rarity": 3.0, "file": "ability",
         "source": "Generic", "description": "(Meta:sight-cat:ability:1)",
         "pos": P(1.3, 0)},
        {"id": 14, "name": "A-Gold", "rarity": 6.0, "file": "ability",
         "source": "Fate", "description": "plain", "pos": P(1.4, 0)},
        {"id": 15, "name": "A-Low", "rarity": 8.0, "file": "ability",
         "source": "Fate", "description": "plain", "pos": P(1.5, 0)},
        {"id": 16, "name": "B-Gold", "rarity": 1.0, "file": "ability",
         "source": "Fate", "description": "plain", "pos": P(0.3, 0.1)},
        {"id": 17, "name": "C-Norm", "rarity": 1.5, "file": "ability",
         "source": "MHA", "description": "plain", "pos": P(0.4, 0.1)},
        {"id": 18, "name": "D-Norm", "rarity": 2.0, "file": "ability",
         "source": "Generic", "description": "plain", "pos": P(0.5, 0.1)},
        {"id": 19, "name": "E-Far", "rarity": 3.0, "file": "ability",
         "source": "MHA", "description": "plain", "pos": P(0.6, 0.1)},
        {"id": 20, "name": "C-Fate", "rarity": 2.0, "file": "ability",
         "source": "Fate", "description": "plain", "pos": P(0.7, 0.1)},
        {"id": 22, "name": "FarA", "rarity": 1.1, "file": "ability",
         "source": "Generic", "description": "plain", "pos": P(0.8, 0.1)},
    ]
    edges = [(0, 1), (1, 2), (2, 3), (3, 4), (4, 5), (5, 6), (6, 7),
             (7, 8), (8, 9), (9, 10), (10, 11), (11, 12), (12, 13),
             (13, 14), (14, 15), (1, 16), (16, 17), (17, 18), (17, 19),
             (19, 22), (16, 20), (0, 16)]
    tree = make_tree(nodes, edges)

    # echo doubles the next awarded ticket
    st = cu.new_state("<synthetic>")
    st["unlocked"] = [0, 1, 2]
    assert cu.view_state(tree, st)["echo"] == 1
    cu.award(st, "bronze", 0, echo=True)
    assert abs(st["points"] - 100) < 1e-9 and st["echo_used"] == 1
    cu.award(st, "bronze")
    assert abs(st["points"] - 150) < 1e-9

    # survey names only, one extra connection out
    st = cu.new_state("<synthetic>")
    st["unlocked"] = [0, 1, 2, 3]
    surv = cu.survey_names(tree, st["unlocked"], cu.view_state(tree, st))
    assert surv == [(5, "GreaterRoll"), (17, "C-Norm"), (20, "C-Fate")]
    assert all(i not in [s[0] for s in surv] for i in (4, 16))  # visible ones skipped

    # compass: trace by source
    st = cu.new_state("<synthetic>")
    st["unlocked"] = [0, 1, 2, 3, 4]
    res = cu.trace(tree, st, "source", "mha")
    assert res and res[0][1]["id"] == 17
    st2 = cu.new_state("<synthetic>")
    st2["unlocked"] = [0, 1]
    assert "compass" in expect_error(cu.trace, tree, st2, "source", "mha")

    # category sight: ability nodes two connections out
    st = cu.new_state("<synthetic>")
    st["unlocked"] = [0, 1, 13]
    meta = cu.view_state(tree, st)
    base = set(cu.visible(tree, [0, 1, 13]))
    assert 15 not in base
    assert 15 in cu.visible(tree, [0, 1, 13], meta)

    # gacha range 5-7 picks only in-band nodes
    st = cu.new_state("<synthetic>")
    st["unlocked"] = [0, 1, 2, 3, 4, 5]
    assert cu.view_state(tree, st)["gacha_max"] == 7
    target = cu.use_gacha(st, tree)
    assert target["id"] == 14

    # duplicate: same source, non-Generic, rarity capped
    st = cu.new_state("<synthetic>")
    st["unlocked"] = [0, 1, 2, 3, 4, 5, 6, 16]
    target = cu.use_duplicate(st, tree)
    assert target["id"] == 20
    assert "charge" in expect_error(cu.use_duplicate, st, tree)

    # lifeline: free frontier unlock
    st = cu.new_state("<synthetic>")
    st["unlocked"] = [0, 1, 7]
    cu.use_lifeline(st, tree, 16)
    assert 16 in st["unlocked"]
    assert st["cores"] == 0 and st["points"] == 0

    # recall: undo the most recent unlock
    st = cu.new_state("<synthetic>")
    st["unlocked"] = [0, 1, 8]
    st["history"] = [1, 8]
    st["points"], st["cores"] = 100.0, 1
    nid = cu.use_recall(st, tree)
    assert nid == 8 and 8 not in st["unlocked"]
    assert st["cores"] == 2 and abs(st["points"] - 1100) < 1e-9  # +10^3 refund

    # root pact halves root-adjacent unlock cost
    st = cu.new_state("<synthetic>")
    st["unlocked"] = [0, 1, 9]
    assert cu._node_cost_for(st, tree, 16) == 5.0
    st["points"], st["cores"] = 100.0, 1
    cu.unlock(st, tree, 16)
    assert abs(st["points"] - 95.0) < 1e-9

    # shuffle: swap with a not-visible similar-rarity node
    st = cu.new_state("<synthetic>")
    st["unlocked"] = [0, 1, 10]
    b = cu.use_shuffle(st, tree, 16)
    assert b == 22
    assert 17 in tree["adj"][22] and 19 in tree["adj"][16]
    assert st["swaps"] == [[16, 22]]

    # swap: two visible locked nodes of your choice
    tree = make_tree(nodes, edges)
    st = cu.new_state("<synthetic>")
    st["unlocked"] = [0, 1, 11]
    cu.use_swap(st, tree, 2, 16)
    assert 17 in tree["adj"][2] and 3 in tree["adj"][16]
    assert st["swaps"] == [[2, 16]]

    # reshuffle: unlimited, costs a quarter of the node's cost
    tree = make_tree(nodes, edges)
    st = cu.new_state("<synthetic>")
    st["unlocked"] = [0, 1, 12]
    st["points"] = 100.0
    cost, b = cu.use_reshuffle(st, tree, 16)
    assert b == 22 and abs(cost - 2.5) < 1e-9
    assert abs(st["points"] - 97.5) < 1e-9
    assert "meta_used" not in st or st["meta_used"].get("reshuffle", 0) == 0

    print("meta2-node tests passed")


if __name__ == "__main__":
    main()
    test_meta()
    test_meta2()