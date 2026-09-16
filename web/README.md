# Web apps (static, no server needed)

Two single-purpose pages sharing `css/app.css` (mobile-first layout):

- `tree.html` — Chaos Tree: generate and play multiple named trees.
  Progress is saved per tree in `localStorage`; export/import moves a tree
  plus its progress as one JSON file (Python `chaos-tree` JSONs import too).
  Includes a canvas 3D view of visible nodes/connections, an SVG
  neighbour view for the selected node, and a sortable/filterable table
  of owned nodes. Trees are generated in-browser from
  `data/entries.js` (deterministic per seed; seeds are app-local, not
  identical to the Python generator's output for the same seed).
  The Trees tab offers copy (with progress) and fresh-clone (same
  parameters, new progress). Each tree records the data version it was
  generated with; a mismatch warns that regeneration may differ.
- `gacha.html` — Chaos Gacha roller with the same presets/odds as the
  desktop app, a ticket wallet, roll history, and history import/export.

Serve the `web/` directory over HTTP (e.g. `python3 -m http.server` inside
`web/`) and open `tree.html` / `gacha.html`. `entries.js` is loaded with a
plain `<script>` tag so the pages also work from `file://`.

## Refreshing the data bundle

After editing `gachafiles/*.txt`:

    python3 tools/export_web_data.py

## Tests

- `node tools/web_parity.cjs` — checks the JS engine against the Python
  engine (visibility, costs, meta derive, jump order, echo) and that the
  JS generator is deterministic and connected.
- The app shells boot headlessly under the DOM stub used during
  development (not committed); rerun `node --check web/js/*.js` after edits.
