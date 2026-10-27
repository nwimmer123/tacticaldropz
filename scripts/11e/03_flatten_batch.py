"""
11e conversion pipeline — step 3, GENERALIZED (supersedes 03_flatten_for_app.py
for batch work). Same math as the validated page-9 script (90-degree rotation
(x,y) -> (y, boardWidth - x), absolute-inch `d` path baking) — only the
input/output filenames and the mission-name shape are generalized.

Schema change from the page-9 file: `missionName`/`missionId` (singular) are
replaced with a `missions` array of {disposition, missionId, missionName},
one entry per side. Page 9-11 happen to have the same name on both sides
("Battlefield Dominance"), but pages 12-13 proved that's not always true
("Immovable Object" for the Take and Hold side vs "Unstoppable Force" for the
Purge the Foe side, same physical board) -- so the schema has to support two
names from the start rather than assuming they match. Nothing consumes this
schema yet (script.js only loads the hardcoded page-9 stub -- see
11E-PROGRESS.md item 4, the disposition-picker UI isn't built), so this is a
free schema change, not a breaking one.

Output filename convention: data/terrain/11e/<dispositionA>-<dispositionB>-<layout>.json
using the disposition IDs in left/right page order. NOTE: the already-committed
page 9 file (data/terrain/11e/battlefieldDominance-A.json) predates this
convention and was intentionally left as-is rather than renamed, since it's
already validated and this script doesn't touch it -- see 11E-PROGRESS.md for
the cleanup note.
"""
import json, math, os

CACHE_DIR = os.environ.get("E11_CACHE", os.path.join(os.path.dirname(__file__), "cache"))
OUT_DIR = os.environ.get("E11_DATA", r"C:\Users\nxw05\Projects\tacticaldropz\data\terrain\11e")


def rotate(pt, board_w):
    x, y = pt
    return (y, board_w - x)


def points_to_d(points, close=True):
    if not points:
        return ""
    parts = [f"M {points[0][0]:.3f} {points[0][1]:.3f}"]
    for x, y in points[1:]:
        parts.append(f"L {x:.3f} {y:.3f}")
    if close:
        parts.append("Z")
    return " ".join(parts)


def piece_to_absolute_points(piece, sprites):
    sp = sprites[piece["spriteRef"]]
    pts = sp["points"]
    vw, vh = sp["viewW"], sp["viewH"]
    rot = math.radians(piece["rot"])
    w, h = piece["w"], piece["h"]
    cx, cy = piece["x"], piece["y"]
    out = []
    for px, py in pts:
        lx = ((px / vw) - 0.5) * w
        ly = ((py / vh) - 0.5) * h
        rx = lx * math.cos(rot) - ly * math.sin(rot)
        ry = lx * math.sin(rot) + ly * math.cos(rot)
        out.append((cx + rx, cy + ry))
    return out


def flatten(layout, sprites):
    board_w = layout["boardWidth"]

    zones_out = []
    for z in layout["zones"]:
        color = "rgba(255,107,107,0.25)" if z["player"] == 1 else "rgba(78,205,196,0.25)"
        stroke = "rgba(255,107,107,0.6)" if z["player"] == 1 else "rgba(78,205,196,0.6)"
        rotated_pts = [list(rotate(pt, board_w)) for pt in z["points"]]
        zones_out.append({"player": z["player"], "color": color, "stroke": stroke, "points": rotated_pts})

    areas_out = []
    for feat in layout["features"]:
        rotated_area = [rotate(pt, board_w) for pt in feat["area"]]
        areas_out.append({"id": feat["id"], "label": feat["label"], "d": points_to_d(rotated_area)})

    pieces_out = []
    for p in layout["pieces"]:
        abs_pts = [rotate(pt, board_w) for pt in piece_to_absolute_points(p, sprites)]
        pieces_out.append({
            "id": p["id"], "featureId": p["featureId"], "terrainType": p["terrainType"],
            "d": points_to_d(abs_pts),
        })

    objectives_out = []
    for o in layout["objectives"]:
        rx, ry = rotate((o["x"], o["y"]), board_w)
        objectives_out.append({"id": o["id"], "type": o["type"], "owner": o["owner"], "x": rx, "y": ry})

    return {
        "dispositions": layout["dispositions"],
        "missions": layout["missions"],
        "layout": layout["layout"],
        "boardWidth": layout["boardHeight"],
        "boardHeight": layout["boardWidth"],
        "zones": zones_out,
        "areas": areas_out,
        "pieces": pieces_out,
        "objectives": objectives_out,
    }


if __name__ == "__main__":
    os.makedirs(OUT_DIR, exist_ok=True)
    PAGES = list(range(*(lambda a, b: (a, b + 1))(*map(int, os.environ.get("E11_PAGES", "19-53").split("-")))))  # 1-indexed; E11_PAGES="first-last"
    for pno in PAGES:
        with open(os.path.join(CACHE_DIR, f"p{pno}-raw.json")) as f:
            layout = json.load(f)
        with open(os.path.join(CACHE_DIR, f"p{pno}-sprites.json")) as f:
            sprites = json.load(f)
        out = flatten(layout, sprites)
        fname = f"{layout['dispositions'][0]}-{layout['dispositions'][1]}-{layout['layout']}.json"
        out_path = os.path.join(OUT_DIR, fname)
        with open(out_path, "w") as f:
            json.dump(out, f, indent=2)
        print(f"page {pno}: wrote {fname}  "
              f"(zones={len(out['zones'])} areas={len(out['areas'])} "
              f"pieces={len(out['pieces'])} objectives={len(out['objectives'])})")
