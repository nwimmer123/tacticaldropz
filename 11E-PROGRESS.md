# 11th Edition Conversion — Progress Log

Read this first when picking this back up. It's written so you don't have to re-derive anything from scratch or re-open the PDF to remember what's going on.

## The goal

Moving TacticalDropz from 10th-edition-style content (flat mission list, static objectives) to a new "11th edition" ruleset sourced from `Downloads/maps.pdf` (93 pages; page 8 is a legend, pages 9–53 are 45 map diagrams — 15 disposition pairings × 3 layouts each).

**Mission selection changes**: each side picks one of 5 Force Dispositions (Take and Hold, Purge the Foe, Disruption, Reconnaissance, Priority Assets). The pairing determines the mission; each pairing has 3 layout variants (A/B/C). The Force Disposition dual-picker UI is **not built yet** — deliberately deferred until enough real data exists to back it (see "What's NOT done" below).

## What's done and validated

**Page 9** (Take and Hold vs Take and Hold → "Battlefield Dominance", Layout A) is fully extracted, corrected against three rounds of your visual review, and wired into the real app as a new "11E" format entry.

Live in the repo right now:
- `data/terrain/11e/battlefieldDominance-A.json` — the real, app-consumed layout data.
- `data/terrain/svgDefs.json` — has 4 new icon entries: `objHomeRed`, `objHomeBlue`, `objCentral`, `objExpansion`.
- `script.js` — new `'11e'` format (desktop + mobile menus), `loadE11Layout()`, `drawE11Layout()`, `drawE11Path()`. Search for `11e`/`E11` in the file to find all of it. Still only loads the page-9 file hardcoded — the picker UI (item 4 below) is what will make it load any of the others.
- `scripts/11e/` — the Python extraction pipeline, kept in the repo (not a temp scratchpad) specifically so it survives between sessions. See "Pipeline scripts" below.

You confirmed the current in-app render looks correct (matches `scripts/11e/cache/compare_v3_reference.png`).

**All 45 map pages (9-53) are now extracted — the full 15-pairing × 3-layout matrix is done.** This happened across 3 batches in one session (10-13, 14-18, then 19-53 "run the rest" in full-auto mode per your instruction). All 45 files live in `data/terrain/11e/`, named `<dispositionA>-<dispositionB>-<layout>.json` except page 9's `battlefieldDominance-A.json` (predates the convention, deliberately left as-is — see below). Compare images for every page are in `scripts/11e/cache/compare_p9.png` (well, page 9's is `compare_v3_reference.png`) through `compare_p53.png`.

**Review depth by batch, so you know how much scrutiny each page actually got:**
- Page 9: 3 rounds of your visual correction — fully validated, this is the reference.
- Pages 10-13: you reviewed the compare images yourself; found and we fixed the bezier-curve-flattening bug (gotcha #10).
- Pages 14-18: I self-checked all 5 compare images; you confirmed "all good."
- Pages 19-53 (35 pages, run in full-auto mode, no per-page approval): I checked the extraction ran clean (no exceptions), ran a statistical sanity check across every page's feature/piece/objective/zone counts (see below — everything landed in the same tight range as the already-validated pages, no outliers), confirmed no new/unclassified terrain-piece sprite shapes turned up across 52 new raster xrefs, and spot-checked 6 compare images by eye (page 21 — first-ever Priority Assets page; pages 24, 36, 45, 51 — the four new "mirror" pairings where a disposition faces itself; page 53 — the last page). **You have not personally looked at pages 19-53 (except the 6 I mention above weren't shown to you either — I checked them myself, not you).** Worth a skim of a few compare images if you want the same confidence level as batches 1-2, especially since this is the batch where 3 brand-new dispositions (Reconnaissance's B/C layouts, Priority Assets entirely) appear for the first time.

**Sanity-check numbers across all 44 batch-pipeline pages** (page 9 excluded, different pipeline run): `features` = 16 and `pieces` = 30 on every single page, no exceptions. `objectives` = 5 or 6 depending on layout (consistent with the validated pattern). Board size clustered tightly (~42-45in × ~56-61in). Zone point counts varied (4/5/9/53+21) reflecting genuinely different zone shapes (rectangle/pentagon/complex polygon/bezier-curved) — no zero-point or degenerate zones.

**The 15 disposition pairings and their mission names** (Take and Hold's own name always listed first when it's a participant):
| Pairing | Mission (side A) | Mission (side B) |
|---|---|---|
| Take and Hold vs Take and Hold | Battlefield Dominance | (same) |
| Take and Hold vs Purge the Foe | Immovable Object | Unstoppable Force |
| Take and Hold vs Disruption | Determined Acquisition | Death Trap |
| Take and Hold vs Reconnaissance | Purge and Secure | Reconnaissance Sweep |
| Take and Hold vs Priority Assets | Inescapable Dominion | Secure Asset |
| Purge the Foe vs Purge the Foe | Meatgrinder | (same) |
| Purge the Foe vs Disruption | Punishment | Delaying Action |
| Purge the Foe vs Reconnaissance | Consecrate | Triangulation |
| Purge the Foe vs Priority Assets | Destroyer's Wrath | Vital Link |
| Disruption vs Disruption | Outmanoeuvre | (same) |
| Disruption vs Reconnaissance | Smoke and Mirrors | Surveil the Foe |
| Disruption vs Priority Assets | Locate and Deny | Extract Relic |
| Reconnaissance vs Reconnaissance | Gather Intel | (same) |
| Reconnaissance vs Priority Assets | Search and Scour | Vanguard Operation |
| Priority Assets vs Priority Assets | Sabotage | (same) |

This table is exactly the source data `data/dispositionMissions.json` (item 3 in "What's NOT done" below) needs to encode — it just needs pulling out of the 45 JSON files' `missions` arrays into one lookup table.

No new terrain-piece sprite shapes turned up across the entire remaining 35-page run (52 new raster xrefs total between pages 19-53, all either correctly auto-excluded as thumbnails/badges or confirmed re-embedded copies of already-known dense/light pieces). The physical terrain kit's sprite library appears to be genuinely fixed/shared across all 45 layouts — a strong sign the auto-classifier (gotcha in `02_extract_page.py`'s docstring) will keep working without hand-holding if more pages are ever added.

**Schema change in the batch-1 files** (page 9's file predates this, wasn't touched): `missionName`/`missionId` (singular) replaced with a `missions` array of `{disposition, missionId, missionName}`, one entry per side. Forced by page 12/13: the two sides have *different* mission names for the same physical board ("Immovable Object" vs "Unstoppable Force") — a singular field would've silently picked one and lost the other. Nothing consumes this schema yet (script.js only loads the page-9 stub), so this was a free change, not a breaking one.

**Filename convention established**: `<dispositionIdA>-<dispositionIdB>-<layout>.json`, left/right in the order they appear on the page. Page 9's `battlefieldDominance-A.json` doesn't follow this (named after the mission instead of the disposition pairing) and was deliberately left alone rather than renamed — a cleanup task if you want consistency later, not done.

## Pipeline scripts (`scripts/11e/`)

Six scripts now. The originals (`02_extract_page9_layoutA.py`, `03_flatten_for_app.py`) are kept as the validated page-9 reference implementation — their color signatures and transform math are unchanged, just copied into the generalized versions. **Use the generalized ones (02, 03, 04) for any further batches:**
1. `01_extract_sprites.py` — pulls unique raster terrain-piece sprites from given PDF pages into `cache/sprites_raw/`, builds `cache/contact_sheet.png` so you can eyeball dense (green) vs light (yellow) classification. Cumulative — safe to re-run with new page ranges, it skips sprites already cached. `PAGES` list at the top is edited per batch (0-indexed; last run covered all of 9-53).
2. `02_extract_page9_layoutA.py` — validated page-9-only reference, unchanged, kept for history.
3. `02_extract_page.py` — **generalized**, this is the one to run for new batches. `extract_page(doc, page_idx)` works for any page: mission/disposition/layout metadata is read from the page's own text, and dense/light terrain-piece xrefs are auto-classified per page from pixel stats instead of hand-typed (see module docstring for the thresholds — validated stable across all 45 pages now, no manual DENSE_XREFS/LIGHT_XREFS set to maintain). Also contains the bezier-curve tessellation (gotcha #10) and the zone-polygon `buffer(0)` repair (gotcha #11). Edit `PAGES` at the bottom (0-indexed) and run; writes `cache/p{N}-raw.json`, `cache/p{N}-sprites.json`, `cache/p{N}-render.png` per page (N = 1-indexed page number).
4. `03_flatten_for_app.py` — validated page-9-only reference, unchanged, kept for history.
5. `03_flatten_batch.py` — **generalized**, reads `cache/p{N}-raw.json` + `cache/p{N}-sprites.json`, writes to `data/terrain/11e/<dispA>-<dispB>-<layout>.json`. Edit `PAGES` at the bottom (1-indexed) and run.
6. `04_compare.py` — **new this session**, promoted from the ad hoc inline compare-image code. Renders the real PDF page and pastes it next to `cache/p{N}-render.png`, writes `cache/compare_p{N}.png`. Edit `PAGES` at the bottom (0-indexed) and run.

All four generalized scripts (01, 02, 03, 04) are on the project's permission allowlist (`.claude/settings.json`) as exact-match commands — running them via `cd scripts/11e && python 0N_*.py` no longer prompts for approval, since it's always the same fixed, already-reviewed script (only the `PAGES` list inside changes between batches). Ad hoc `python -c "..."` one-off diagnostics are deliberately **not** allowlisted — wildcarding interpreter execution would be equivalent to blanket-approving arbitrary code, so those still prompt each time, by design.

`cache/` also has `sprites.json` (page-9-only sprite library) / `p{N}-sprites.json` (per-page, batch pipeline), the raw pre-flatten JSONs, and the render/compare PNGs.

**Dependencies installed** (user-level `pip install --user`, confirmed with you each time): `pymupdf`, `opencv-python-headless`, `numpy`, `shapely`, `Pillow`.

## Hard-won gotchas (read before re-deriving any of this)

These are all documented inline in the scripts too, but the short version:

1. **Zones are stepped, not rectangles.** Deployment zones in the PDF are genuine polygons (e.g. 20" deep on part of the board, ~12" deep past the centerline) — extract the drawing's real `items` path, never just its bounding `rect`.
2. **Area-terrain is a separate vector layer, not the raster sprites.** The grey jagged-edge rectangles (fill `≈(0.82,0.83,0.83)`, near-black stroke) are vector paths, distinct from the green/yellow raster wall/rubble art. Their bounding sizes match the physical terrain kit's catalog (confirmed against user-supplied dimensions like "7×11.5 rectangle"). Don't go looking for them in `sprites_raw/` — they're not there.
3. **Sprite color must be verified by eye, not assumed from shape.** A fence-shaped sprite can be either dense or light — one (`x5464`) looked like it should be dense but was yellow in the raw art. Always check `cache/contact_sheet.png`.
4. **Objective icons are vector-drawn too**, classified by fill-color signature + size, restricted to points strictly inside the board bounds — the "Attacker's/Defender's Battlefield Edge" marker icons just outside the board share the same red/blue fill and will show up as false-positive objectives otherwise (this happened once — 7 "objectives" instead of 5).
5. **Rotation transform**: local sprite pixel `(px,py)` → board-inch offset is `lx=((px/vw)-0.5)*w`, `ly=((py/vh)-0.5)*h`, then a **standard** rotation matrix, then **add** to the piece center. No axis flips anywhere — a previous version had a spurious double-flip that rotated every piece 180° from correct.
6. **The PDF page is portrait; the app board is landscape.** Every page's extraction needs the 90° rotation `(x,y) → (y, boardWidth - x)` applied at flatten time (a proper rotation, not a mirror, so wall/piece orientations stay correct) — see `03_flatten_for_app.py`.
7. **Feature letters (CD/AB/EF/GH) are real PDF text**, not baked into images — usable directly for proximity-matching pieces/areas to their feature group.
8. **The pt→inch scale is NOT constant across pages.** It's derived per-page by pairing each `N"` text label with its nearest thin dimension line and taking the median ratio. Page 9 came out to ~7.7155 pt/inch — don't hardcode this for other pages, recompute it each time.
9. **Terrain LOS design (not built, but schema supports it)**: green (dense) pieces double as the actual wall/LOS-blocking geometry — no separate wall-tracing needed. The rule (for a future feature, documented for whoever builds it): a model **outside** a terrain feature is blocked by that feature's whole `area` polygon as if solid; a model **inside** is blocked only by the dense pieces it/the sightline actually crosses.
10. **Deployment-zone edges can be real bezier curves, not just straight lines** — found by you on page 13 (an arc "cut" into the zone boundary) and it turned out page 11 had the same thing, just subtler. The old `path_points()` only kept a curve's start/end point (`'c'` item → 2 points), silently flattening every arc into a straight chord. Fixed in `02_extract_page.py` by tessellating each cubic bezier into 16 line segments (De Casteljau-style sampling) — this recurs on multiple layouts sharing this deployment pattern, so don't assume a page's zones are all straight lines just because earlier pages in the batch were.
11. **Near-degenerate diagonal zone polygons can trip Shapely's strict validity check.** Page 16 hit a `GEOSException: TopologyException` computing no-man's-land (board minus zones) — a diagonal zone edge produced a ~0.1pt sliver that Shapely flagged as a self-intersection. Fixed with `.buffer(0)` on the zone polygon before the union/difference if `is_valid` is false (standard Shapely repair trick for exactly this).

## Edition selector + My/Opponent Disposition picker UI (built this session)

The app's left sidebar and mobile hamburger menu now have a top-level
**Edition** section (11th / 10th, 11th is default) above the rest of the nav:

- **Edition = 10th**: Format (GW/WTC/UKTC, the temporary "11E" entry is gone)
  → Mission → Layout(1-8), unchanged from before.
- **Edition = 11th**: **My Disposition** → **Opponent Disposition** →
  **Layout (A/B/C)** → a read-only Mission readout showing your side's
  mission name once resolvable. The map only loads once all three
  selections are made (picking a disposition pair doesn't auto-load Layout A
  — you have to explicitly pick a layout letter too).

Implementation, all in `script.js` unless noted:
- New state: `currentEdition`, `myDisposition`, `oppDisposition`,
  `e11LayoutLetter`, `dispositionMissions` (the loaded manifest).
  `currentTerrainFormat` is back to being purely `'gw'|'wtc'|'uktc'` — 11e is
  no longer a Format value anywhere, it's its own Edition.
- `loadE11Layout()` now resolves the actual file path via
  `findDispositionPairing(myDisposition, oppDisposition)` against the
  manifest, instead of a hardcoded filename.
- `buildE11PickerSections(container, headerClass, optionClass, elementTag, rebuildFn)`
  and `buildE11LayoutGrid(container)` are shared between the desktop sidebar
  (`buildMissionSidebar()`) and mobile menu (`buildMobileMenu()`) — the one
  piece of shared-abstraction code among what's otherwise a codebase
  convention of duplicating desktop/mobile nav blocks.
- `drawBackground()`/`drawDeploymentZones()`/`drawObjectives()`/`drawScene()`
  all switched their old `currentTerrainFormat === '11e'` gates to
  `currentEdition === '11e'` — this was required, not cosmetic:
  `currentTerrainFormat` stays at its last gw/wtc/uktc value even while
  Edition is 11th now, so without this the old format's background art would
  paint underneath the 11e board every frame.
- New `data/dispositionMissions.json` manifest (15 pairings × mission names
  per side × per-layout file paths), generated by
  `scripts/11e/05_build_disposition_manifest.py` from the 45 files in
  `data/terrain/11e/`. Absorbs page 9's filename irregularity (its
  `battlefieldDominance-A.json` name, and its older singular
  `missionId`/`missionName` schema predating the `missions[]` array) without
  needing to rename or migrate that file.
- Design call confirmed with you: renders **as-stored**, no mirroring. If
  "My Disposition" is the side-B entry in a pairing's file, your zone may
  render red or blue depending on which disposition you picked — this
  matches the already-validated extraction data exactly.

**Save/Load Deployment (Pro cloud-save) wired up for 11e** (a follow-up gap
the user caught, then found the actual backend lives in this repo too —
`backend/functions/deployments/index.mjs`, an AWS Lambda over DynamoDB):

- Client (`script.js`): `saveDeployment()`'s payload now includes
  `layoutEdition` (`'11e'`/`'10e'`, distinct from the pre-existing `edition`
  field which is the *army list's* rules edition — different concept,
  same-ish name, don't confuse them) plus
  `myDisposition`/`oppDisposition`/`e11LayoutLetter` when saved under 11th
  edition. `loadDeployment()` branches on `dep.layoutEdition` — missing/absent
  means the save predates this feature and is treated as 10th (backward
  compatible with all 12 existing records). `renderDeploymentsList()`'s meta
  line now shows the disposition matchup + layout letter for 11e saves
  instead of a blank mission field.
- **Backend (`backend/functions/deployments/index.mjs`), POST handler**: this
  turned out to be load-bearing, not just a nice-to-have. The handler
  destructures a fixed field list from the request body (no `...body`
  spread) — my new client fields would've been silently dropped without this
  change. Worse, `mission` was a hard-required field (`400` if missing), and
  11e never sets `currentMission`, so **11e saves would have been rejected
  outright** by the live API pre-fix. Now: `mission` is only required when
  `layoutEdition !== '11e'`; `myDisposition`+`oppDisposition` are required
  instead when it is. New fields added to the `PutCommand` `Item`, and to the
  list endpoint's `ProjectionExpression` (list view has an explicit
  allowlist too, separate from the single-item `GET`). `schemaVersion`
  bumped `1.0` → `1.1`. DynamoDB is schemaless, so this is purely additive —
  the 12 existing 10th-edition records are untouched.
- **`PUT /deployments/{deploymentId}` (update) was NOT touched** — grepped
  `script.js` and confirmed nothing calls it (`saveDeployment()` only ever
  POSTs a new record; there's no "edit saved deployment" UI). If that's ever
  built for 11e, PUT needs the same `layoutEdition`/`myDisposition`/etc.
  fields added then.
- **Not deployed.** This is live Lambda code — I only edited the file
  locally, same as everything else this session. You said you need to push
  to the real site to test against the actual AWS DynamoDB table; the
  client-side 11e save/load won't actually work end-to-end until this
  Lambda is deployed (right now, a save attempt from 11th edition would 400
  against the currently-live version of this function).

**Not yet done / not verified this session**: no browser was available to
click through the new UI end-to-end (syntax-checked with `node --check`,
manifest validated as JSON with all 45 referenced files confirmed to exist
on disk, and all `currentTerrainFormat === '11e'` gates confirmed
grep-clean — but nobody has actually loaded the page and clicked buttons
yet). Worth a manual pass: boot state, picking a same-vs-same pairing,
switching Edition back and forth and confirming prior 11e selections
persist, and the mobile hamburger menu specifically.

## What's NOT done yet (in order)

1. **Manual browser verification of the new picker UI** (see note directly above).
2. **Spot-check a few of pages 19-53 yourself** if you want them at the same confidence level as pages 9-18 — see the "Review depth by batch" note above for exactly what has/hasn't had human eyes on it. Not blocking, just a gap to know about.
3. ~~Extract all 45 pages~~ — **done**, all 15 pairings × 3 layouts are in `data/terrain/11e/`.
4. ~~Generalize `02_extract_page9_layoutA.py` and `03_flatten_for_app.py`~~ — **done**, see `02_extract_page.py` / `03_flatten_batch.py` / `04_compare.py` in "Pipeline scripts" above.
5. ~~`data/dispositionMissions.json`~~ — **done**, see above.
6. ~~The Force Disposition dual-picker UI~~ — **done**, see above (pending manual verification, item 1).
7. **LOS raycasting feature itself** — schema supports it (see gotcha #9) but no rendering/logic exists yet.
8. **Corner-coordinate "setup mode"** — also schema-supported (straight-line polygon vertices, not smooth curves) but not built.
9. **Cleanup**: rename `battlefieldDominance-A.json` to `takeAndHold-takeAndHold-A.json` for filename consistency with the other 44 (optional, cosmetic — the manifest builder already absorbs this irregularity, so it's no longer blocking anything, purely cosmetic now).

## Untracked files

Everything above (`data/terrain/11e/`, `data/dispositionMissions.json`, `scripts/11e/`, the `svgDefs.json` additions, the `script.js`/`styles.css` changes, `.claude/settings.json`) is sitting as local changes/new files — nothing has been committed. Check `git status` and commit when ready.
