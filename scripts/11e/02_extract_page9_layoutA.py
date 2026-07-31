"""
11e conversion pipeline — step 2: page extraction (VALIDATED REFERENCE IMPLEMENTATION).

This is the exact script that produced the validated page9-layoutA-v2.json
(Take and Hold vs Take and Hold -> Battlefield Dominance, Layout A), after
three rounds of visual correction against the source PDF. Everything in it —
the color signatures, the "extract real vector paths not bounding boxes"
approach, the objective-cluster classification, the rotation-transform math —
is confirmed correct.

IT IS HARDCODED TO PAGE 9 (page = doc[8], DENSE_XREFS/LIGHT_XREFS from that
page's sprite catalog, mission/disposition/layout metadata written literally
at the bottom). To convert another page, this needs to become a function
parameterized by page index + dense/light xref sets + mission metadata, with
the mission/disposition/layout name pulled from the page's own text (they're
real extractable text, see get_text('dict') usage below for the pattern) —
that generalization is the first task for the next session, not done yet.
Read PROGRESS.md in the repo root before touching this.

Run 01_extract_sprites.py first (with PAGES covering this page) so
cache/sprites_raw/ has the PNGs this script vectorizes.
"""
import fitz, math, json, re, statistics, os
import numpy as np
import cv2
from PIL import Image, ImageDraw
from shapely.geometry import Polygon, box as shapely_box
from shapely.ops import unary_union

PDF_PATH = r"C:\Users\nxw05\Downloads\maps.pdf"
CACHE_DIR = os.path.join(os.path.dirname(__file__), "cache")
SPRITE_DIR = os.path.join(CACHE_DIR, "sprites_raw")

doc = fitz.open(PDF_PATH)
page = doc[8]  # page 9 (0-indexed) — HARDCODED, see module docstring

# Hand-classified from the contact sheet for pages 9-11. Verify by EYE against
# cache/contact_sheet.png for every new sprite on future pages — do not assume
# from shape (a fence-shaped sprite can be either color; x5464 looked like it
# should be dense but was actually yellow/light in the raw art).
DENSE_XREFS = {5462, 5466, 5470, 5472, 5474, 5476, 5486, 5488}
LIGHT_XREFS = {5468, 5464, 5478, 5480, 5482, 5484}
ALL_TERRAIN_XREFS = DENSE_XREFS | LIGHT_XREFS


def close(c1, c2, tol=0.02):
    if c1 is None or c2 is None:
        return False
    return all(abs(a - b) < tol for a, b in zip(c1, c2))


def path_points(dr):
    """Walk a drawing's items, flatten to an ordered list of (x,y) points (curve endpoints only)."""
    pts = []
    for it in dr.get("items", []):
        kind = it[0]
        if kind == "l":
            p0, p1 = it[1], it[2]
            if not pts:
                pts.append((p0.x, p0.y))
            pts.append((p1.x, p1.y))
        elif kind == "c":
            p0, p1, p2, p3 = it[1], it[2], it[3], it[4]
            if not pts:
                pts.append((p0.x, p0.y))
            pts.append((p3.x, p3.y))
        elif kind == "re":
            r = it[1]
            pts.extend([(r.x0, r.y0), (r.x1, r.y0), (r.x1, r.y1), (r.x0, r.y1)])
    return pts


# ---------- scale: pair each dimension label ("25\"" etc.) with its nearest thin
# dimension line and take the median pt/inch ratio. The PDF page itself is a
# plain 72pt/inch A4 canvas (confirmed via page.mediabox) — the MAP is drawn at
# its own arbitrary internal scale that must be read from the labels, and it
# WILL differ page to page, so this step must run per page, never assumed constant.
d = page.get_text("dict")
labels = []
for b in d["blocks"]:
    for l in b.get("lines", []):
        for s in l.get("spans", []):
            t = s["text"].strip()
            m = re.match(r'^([0-9]+(?:\.[0-9]+)?)"$', t)
            if m:
                labels.append((float(m.group(1)), s["bbox"]))

drawings = page.get_drawings()
lines = []
for dr in drawings:
    if dr.get("type") != "s":
        continue
    r = dr.get("rect")
    if not r:
        continue
    w, h = r.width, r.height
    if w < 1.5 and h > 5:
        lines.append(("v", r, h))
    elif h < 1.5 and w > 5:
        lines.append(("h", r, w))

ratios = []
for val, bbox in labels:
    cx, cy = (bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2
    best, bestd = None, 1e9
    for orient, r, length in lines:
        rcx, rcy = (r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2
        dist = math.hypot(cx - rcx, cy - rcy)
        if dist < bestd:
            bestd, best = dist, length
    if best and bestd < 20:
        ratios.append(best / val)
PT_PER_INCH = statistics.median(ratios)
print(f"PT_PER_INCH = {PT_PER_INCH:.4f}")

# ---------- zones: REAL polygon paths, not bounding boxes (deployment zones are
# stepped/staggered, e.g. 20" deep on one side of center, ~12" on the other —
# a naive bounding-box read silently flattens this into a wrong plain rectangle) ----------
RED_FILL = (0.6179598569869995, 0.03996337950229645, 0.05568017065525055)
BLUE_FILL = (0.0, 0.2406042516231537, 0.40836194157600403)

zone_drawings = {"red": None, "blue": None}
for dr in drawings:
    r = dr.get("rect")
    if not r or r.width < 60 or r.height < 60:
        continue
    fill = dr.get("fill")
    if close(fill, RED_FILL):
        if zone_drawings["red"] is None or r.width * r.height > zone_drawings["red"].get("rect").width * zone_drawings["red"].get("rect").height:
            zone_drawings["red"] = dr
    elif close(fill, BLUE_FILL):
        if zone_drawings["blue"] is None or r.width * r.height > zone_drawings["blue"].get("rect").width * zone_drawings["blue"].get("rect").height:
            zone_drawings["blue"] = dr

red_pts = path_points(zone_drawings["red"])
blue_pts = path_points(zone_drawings["blue"])
red_rect = zone_drawings["red"].get("rect")
blue_rect = zone_drawings["blue"].get("rect")

board_x0 = min(red_rect.x0, blue_rect.x0)
board_x1 = max(red_rect.x1, blue_rect.x1)
board_y0 = red_rect.y0
board_y1 = blue_rect.y1
BOARD_W_IN = (board_x1 - board_x0) / PT_PER_INCH
BOARD_H_IN = (board_y1 - board_y0) / PT_PER_INCH
print(f"board = {BOARD_W_IN:.2f} x {BOARD_H_IN:.2f} in, red pts={len(red_pts)} blue pts={len(blue_pts)}")


def pt_to_in(px, py):
    return (round((px - board_x0) / PT_PER_INCH, 3), round((py - board_y0) / PT_PER_INCH, 3))


zones = [
    {"player": 1, "points": [list(pt_to_in(x, y)) for x, y in red_pts]},
    {"player": 2, "points": [list(pt_to_in(x, y)) for x, y in blue_pts]},
]

board_poly = shapely_box(board_x0, board_y0, board_x1, board_y1)
red_poly = Polygon(red_pts)
blue_poly = Polygon(blue_pts)
nml_poly = board_poly.difference(unary_union([red_poly, blue_poly]))
if nml_poly.geom_type == "Polygon":
    nml_coords = list(nml_poly.exterior.coords)[:-1]
else:
    nml_coords = list(max(nml_poly.geoms, key=lambda g: g.area).exterior.coords)[:-1]
no_mans_land = [list(pt_to_in(x, y)) for x, y in nml_coords]

# ---------- area-terrain: grey jagged polygons (fill ~#d1d3d4, near-black stroke).
# THESE ARE VECTOR PATHS, NOT RASTER SPRITES — do not go looking for them in
# sprites_raw/. Bounding-box sizes match the physical terrain-kit catalog
# (e.g. one measured 7.66"x11.62" against a "7x11.5" kit rectangle). ----------
GREY_AREA_FILL = (0.8202029466629028, 0.8260013461112976, 0.8322880864143372)
area_drawings = []
for dr in drawings:
    if close(dr.get("fill"), GREY_AREA_FILL):
        r = dr.get("rect")
        if r and r.width > 15 and r.height > 15:
            area_drawings.append(dr)
print(f"{len(area_drawings)} area-terrain polygons")

# ---------- feature-letter badges (teal circle + real text, e.g. "GH", "CD") ----------
BADGE_FILL = (0.0, 0.45178911089897156, 0.3776302635669708)
badges = []
for dr in drawings:
    if dr.get("type") != "fs":
        continue
    r = dr.get("rect")
    if r and close(dr.get("fill"), BADGE_FILL) and 14 < r.width < 20 and 14 < r.height < 20:
        badges.append(r)

text_spans = []
for b in d["blocks"]:
    for l in b.get("lines", []):
        for s in l.get("spans", []):
            t = s["text"].strip()
            if re.match(r'^[A-Z]{2}$', t):
                text_spans.append((t, s["bbox"]))

badge_labels = []
for r in badges:
    bcx, bcy = (r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2
    best, bestd = None, 1e9
    for t, bbox in text_spans:
        tcx, tcy = (bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2
        dd = math.hypot(bcx - tcx, bcy - tcy)
        if dd < bestd:
            bestd, best = dd, t
    badge_labels.append({"label": best, "x_pt": bcx, "y_pt": bcy})
print("feature badges:", [b["label"] for b in badge_labels])

# match each area polygon to nearest badge
features = []
for i, dr in enumerate(area_drawings):
    r = dr.get("rect")
    acx, acy = (r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2
    best_i, bestd = None, 1e9
    for bi, bl in enumerate(badge_labels):
        dd = math.hypot(acx - bl["x_pt"], acy - bl["y_pt"])
        if dd < bestd:
            bestd, best_i = dd, bi
    pts = path_points(dr)
    fid = f"{badge_labels[best_i]['label']}_{best_i}"
    features.append({
        "id": fid,
        "label": badge_labels[best_i]["label"],
        "area": [list(pt_to_in(x, y)) for x, y in pts],
        "boundingIn": (round(r.width / PT_PER_INCH, 2), round(r.height / PT_PER_INCH, 2)),
    })

for f in features:
    print(f["id"], "bbox_in=", f["boundingIn"], "npts=", len(f["area"]))

# ---------- terrain piece instances (decorative wall/light-terrain sprites) ----------
pieces = []
for xref in ALL_TERRAIN_XREFS:
    rects = page.get_image_rects(xref, transform=True)
    for r, m in rects:
        a, b_, c, dd, e, f = m
        w_pt = math.hypot(a, b_)
        h_pt = math.hypot(c, dd)
        rot = math.degrees(math.atan2(b_, a))
        cx = a * 0.5 + c * 0.5 + e
        cy = b_ * 0.5 + dd * 0.5 + f
        ix, iy = pt_to_in(cx, cy)
        best_i, bestd = None, 1e9
        for bi, bl in enumerate(badge_labels):
            ddist = math.hypot(cx - bl["x_pt"], cy - bl["y_pt"])
            if ddist < bestd:
                bestd, best_i = ddist, bi
        pieces.append({
            "spriteRef": f"x{xref}",
            "terrainType": "dense" if xref in DENSE_XREFS else "light",
            "featureId": f"{badge_labels[best_i]['label']}_{best_i}",
            "x": ix, "y": iy,
            "w": round(w_pt / PT_PER_INCH, 3), "h": round(h_pt / PT_PER_INCH, 3),
            "rot": round(rot, 1),
        })
for i, p in enumerate(pieces):
    p["id"] = f"p{i+1}"

# ---------- objectives: also vector-drawn (not sprites). IMPORTANT — the
# "Attacker's/Defender's Battlefield Edge" marker icons just OUTSIDE the board
# share the same red/blue fill colors as Home objectives and will show up as
# false positives if you don't filter candidates to inside the board bounds
# (this caused 7 "objectives" instead of 5 on the first attempt). ----------
OBJ_RED, OBJ_BLUE = RED_FILL, BLUE_FILL
OBJ_TEAL = (0.0, 0.45178911089897156, 0.3776302635669708)
OBJ_TEAL2 = (0.1283436268568039, 0.5709162950515747, 0.5179675221443176)
obj_candidates = []
for dr in drawings:
    if dr.get("type") != "f":
        continue
    r = dr.get("rect")
    if not r:
        continue
    cx, cy = (r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2
    if not (board_x0 < cx < board_x1 and board_y0 < cy < board_y1):
        continue
    if 20 < r.width < 36 and 20 < r.height < 36 and abs(r.width - r.height) < 2:
        for name, col in [("red", OBJ_RED), ("blue", OBJ_BLUE), ("teal", OBJ_TEAL), ("teal2", OBJ_TEAL2)]:
            if close(dr.get("fill"), col):
                obj_candidates.append((name, r))
clusters = []
for name, r in obj_candidates:
    cx, cy = (r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2
    placed = False
    for cl in clusters:
        if math.hypot(cx - cl["cx"], cy - cl["cy"]) < 10:
            cl["items"].append(name)
            placed = True
            break
    if not placed:
        clusters.append({"cx": cx, "cy": cy, "items": [name]})
objectives = []
for i, cl in enumerate(clusters):
    names = cl["items"]
    if "red" in names:
        otype, owner = "home", 1
    elif "blue" in names:
        otype, owner = "home", 2
    elif "teal" in names and "teal2" not in names:
        otype, owner = "central", None
    else:
        otype, owner = "expansion", None
    ix, iy = pt_to_in(cl["cx"], cl["cy"])
    objectives.append({"id": f"obj{i+1}", "type": otype, "owner": owner, "x": ix, "y": iy})
print(f"{len(objectives)} objectives")

# ---------- sprite vectorization (decorative art; also the LOS-wall geometry for
# dense pieces per the design — see PROGRESS.md). Straight-line polygons (not
# smooth curves) on purpose, so corner-coordinate future features have real vertices. ----------
def vectorize_sprite(xref):
    path = os.path.join(SPRITE_DIR, f"xref{xref}.png")
    im = Image.open(path).convert("RGBA")
    alpha = np.array(im)[:, :, 3]
    _, thresh = cv2.threshold(alpha, 10, 255, cv2.THRESH_BINARY)
    contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None, im.width, im.height
    biggest = max(contours, key=cv2.contourArea)
    eps = 0.01 * cv2.arcLength(biggest, True)
    approx = cv2.approxPolyDP(biggest, eps, True)
    pts = [(int(pt[0][0]), int(pt[0][1])) for pt in approx]
    return pts, im.width, im.height


sprites = {}
for xref in ALL_TERRAIN_XREFS:
    pts, w, h = vectorize_sprite(xref)
    sprites[f"x{xref}"] = {"points": pts, "viewW": w, "viewH": h,
                            "terrainType": "dense" if xref in DENSE_XREFS else "light"}

# ---------- assemble ----------
layout = {
    "edition": "11e", "dispositions": ["takeAndHold", "takeAndHold"],
    "missionId": "battlefieldDominance", "missionName": "Battlefield Dominance", "layout": "A",
    "boardWidth": round(BOARD_W_IN, 2), "boardHeight": round(BOARD_H_IN, 2),
    "zones": zones, "noMansLand": no_mans_land,
    "features": [{"id": f["id"], "label": f["label"], "area": f["area"]} for f in features],
    "pieces": pieces, "objectives": objectives,
}
with open(os.path.join(CACHE_DIR, "sprites.json"), "w") as fp:
    json.dump(sprites, fp, indent=1)
with open(os.path.join(CACHE_DIR, "page9-layoutA-v2.json"), "w") as fp:
    json.dump(layout, fp, indent=2)
print("wrote page9-layoutA-v2.json")

# ---------- render-back for visual comparison against the source PDF page ----------
PX_PER_IN = 15
W, H = int(BOARD_W_IN * PX_PER_IN), int(BOARD_H_IN * PX_PER_IN)
img = Image.new("RGB", (W, H), (230, 230, 225))
draw = ImageDraw.Draw(img, "RGBA")

for z in zones:
    color = (200, 40, 40, 130) if z["player"] == 1 else (30, 110, 160, 130)
    pts = [(x * PX_PER_IN, y * PX_PER_IN) for x, y in z["points"]]
    draw.polygon(pts, fill=color)

for feat in features:
    pts = [(x * PX_PER_IN, y * PX_PER_IN) for x, y in feat["area"]]
    if len(pts) >= 3:
        draw.polygon(pts, fill=(140, 140, 140, 200), outline=(20, 20, 20, 255))

for p in pieces:
    sp = sprites[p["spriteRef"]]
    pts = sp["points"]
    if not pts:
        continue
    vw, vh = sp["viewW"], sp["viewH"]
    rot = math.radians(p["rot"])
    out_pts = []
    for px, py in pts:
        # Corrected transform (was previously buggy — a double y-flip rotated
        # every piece 180deg from correct). No flips: local pixel space and
        # board space share the same y-down handedness.
        lx = ((px / vw) - 0.5) * p["w"]
        ly = ((py / vh) - 0.5) * p["h"]
        rx = lx * math.cos(rot) - ly * math.sin(rot)
        ry = lx * math.sin(rot) + ly * math.cos(rot)
        out_pts.append(((p["x"] + rx) * PX_PER_IN, (p["y"] + ry) * PX_PER_IN))
    color = (20, 120, 90, 255) if p["terrainType"] == "dense" else (200, 160, 30, 255)
    draw.polygon(out_pts, fill=color)

OBJ_COLORS = {"home": (220, 50, 50), "central": (20, 140, 110), "expansion": (20, 140, 110)}
for o in objectives:
    cx, cy = o["x"] * PX_PER_IN, o["y"] * PX_PER_IN
    col = OBJ_COLORS[o["type"]]
    if o["type"] == "home" and o["owner"] == 2:
        col = (40, 90, 150)
    draw.ellipse([cx - 8, cy - 8, cx + 8, cy + 8], fill=col + (255,), outline=(255, 255, 255, 255), width=2)

img.save(os.path.join(CACHE_DIR, "render_layoutA_v2.png"))
print("wrote render_layoutA_v2.png")
