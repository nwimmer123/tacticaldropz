"""
11e conversion pipeline — step 3: flatten to the app-ready schema
(VALIDATED REFERENCE IMPLEMENTATION for page 9 / Battlefield Dominance / Layout A).

Takes the raw extraction (cache/page9-layoutA-v2.json + cache/sprites.json) and
bakes sprite + placement into absolute-inch `d` path strings, matching the
existing ruins[].d convention already used in data/terrain/gw-l1.json — so
script.js can draw everything with a simple M/L/C/Z tokenizer and needs zero
new per-instance coordinate-transform code.

Also applies the 90-degree rotation: the PDF draws every map in portrait
(attacker at the printed page's "top"), but the app's board (like every other
format) is landscape, attacker on the left. (x,y) -> (y, boardWidth - x) is a
proper rotation (not a mirror), so piece/wall orientations stay correct after
rotating — verified against the app render.

HARDCODED to this one page's input/output filenames. To batch-convert other
pages, this needs to loop over each generated raw-extraction JSON and mission
id / layout letter to build its own output filename — not done yet, see
PROGRESS.md.
"""
import json, math, os

CACHE_DIR = os.path.join(os.path.dirname(__file__), "cache")
OUT_PATH = r"C:\Users\nxw05\Projects\tacticaldropz\data\terrain\11e\battlefieldDominance-A.json"

with open(os.path.join(CACHE_DIR, "page9-layoutA-v2.json")) as f:
    layout = json.load(f)
with open(os.path.join(CACHE_DIR, "sprites.json")) as f:
    sprites = json.load(f)

BOARD_W = layout["boardWidth"]


def rotate(pt):
    x, y = pt
    return (y, BOARD_W - x)


def points_to_d(points, close=True):
    if not points:
        return ""
    parts = [f"M {points[0][0]:.3f} {points[0][1]:.3f}"]
    for x, y in points[1:]:
        parts.append(f"L {x:.3f} {y:.3f}")
    if close:
        parts.append("Z")
    return " ".join(parts)


def piece_to_absolute_points(piece):
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


zones_out = []
for z in layout["zones"]:
    color = "rgba(255,107,107,0.25)" if z["player"] == 1 else "rgba(78,205,196,0.25)"
    stroke = "rgba(255,107,107,0.6)" if z["player"] == 1 else "rgba(78,205,196,0.6)"
    rotated_pts = [list(rotate(pt)) for pt in z["points"]]
    zones_out.append({"player": z["player"], "color": color, "stroke": stroke, "points": rotated_pts})

areas_out = []
for feat in layout["features"]:
    rotated_area = [rotate(pt) for pt in feat["area"]]
    areas_out.append({"id": feat["id"], "label": feat["label"], "d": points_to_d(rotated_area)})

pieces_out = []
for p in layout["pieces"]:
    abs_pts = [rotate(pt) for pt in piece_to_absolute_points(p)]
    pieces_out.append({
        "id": p["id"], "featureId": p["featureId"], "terrainType": p["terrainType"],
        "d": points_to_d(abs_pts),
    })

objectives_out = []
for o in layout["objectives"]:
    rx, ry = rotate((o["x"], o["y"]))
    objectives_out.append({"id": o["id"], "type": o["type"], "owner": o["owner"], "x": rx, "y": ry})

out = {
    "missionId": layout["missionId"],
    "missionName": layout["missionName"],
    "dispositions": layout["dispositions"],
    "layout": layout["layout"],
    "boardWidth": layout["boardHeight"],
    "boardHeight": layout["boardWidth"],
    "zones": zones_out,
    "areas": areas_out,
    "pieces": pieces_out,
    "objectives": objectives_out,
}

os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
with open(OUT_PATH, "w") as f:
    json.dump(out, f, indent=2)
print("wrote", OUT_PATH)
print("zones:", len(zones_out), "areas:", len(areas_out), "pieces:", len(pieces_out), "objectives:", len(objectives_out))
