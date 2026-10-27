"""
11e conversion pipeline — step 2, GENERALIZED (supersedes 02_extract_page9_layoutA.py
for batch work, going forward). That script is kept in the repo as the validated
page-9 reference — its color signatures, "real vector paths not bounding boxes"
approach, objective-cluster classification, and rotation-transform math are all
reused here unchanged; only the page-9-specific hardcoding was lifted into
parameters/auto-detection. Read 11E-PROGRESS.md before touching this.

What's now automatic instead of hand-typed per page:
  - mission/disposition/layout metadata — read from the page's own text (see
    extract_page_meta below; positions are stable across pages, verified for
    pages 9-13: dispositions at y=139.5, mission names at y=186.9, layout at
    y=229.2 -- confirmed identical template across all 5 pages checked).
  - dense vs light terrain-piece classification — auto-detected per page from
    the cached sprite PNG's own pixel stats (see classify_piece_xrefs below),
    instead of a hand-maintained DENSE_XREFS/LIGHT_XREFS set. Validated against
    the original hand-classified page-9 set (all 14 xrefs matched) plus the
    two new xrefs introduced on pages 12-13 (5519, 5558 -- same physical piece
    re-embedded under a new xref, confirmed dense both by eye and by stats).
  - excluding decorative art (disposition badges, board-preview thumbnails,
    grid-texture backgrounds) from the piece set — these have either far more
    non-transparent pixels than any real piece sprite (thumbnails/backgrounds,
    npix > 15000) or far higher pixel-color variance (badges, colorstd > 45).
    Real terrain pieces across pages 9-13 range npix 1225-13118, colorstd
    18-36 -- there's a clean gap on both sides, see scratch analysis in
    11E-PROGRESS.md if this ever needs re-validating on later pages.

Run 01_extract_sprites.py first (with PAGES covering the target pages) so
cache/sprites_raw/ has the PNGs this script reads/vectorizes.
"""
import fitz, math, json, re, statistics, os
import numpy as np
import cv2
from PIL import Image, ImageDraw
from shapely.geometry import Polygon, box as shapely_box
from shapely.ops import unary_union

PDF_PATH = os.environ.get("E11_PDF", os.path.join(os.path.dirname(__file__), "..", "..", "newLayouts.pdf"))  # old Downloads/maps.pdf is gone
CACHE_DIR = os.environ.get("E11_CACHE", os.path.join(os.path.dirname(__file__), "cache"))
SPRITE_DIR = os.path.join(CACHE_DIR, "sprites_raw")

RED_FILL = (0.6179598569869995, 0.03996337950229645, 0.05568017065525055)
BLUE_FILL = (0.0, 0.2406042516231537, 0.40836194157600403)
GREY_AREA_FILL = (0.8202029466629028, 0.8260013461112976, 0.8322880864143143)
BADGE_FILL = (0.0, 0.45178911089897156, 0.3776302635669708)
OBJ_TEAL = BADGE_FILL
OBJ_TEAL2 = (0.1283436268568039, 0.5709162950515747, 0.5179675221443176)

PIECE_NPIX_MAX = 15000  # real pieces top out at 13118; thumbnails/backgrounds start at 20500
PIECE_COLORSTD_MAX = 45  # real pieces top out at ~36; badges run 82-84


def close(c1, c2, tol=0.02):
    if c1 is None or c2 is None:
        return False
    return all(abs(a - b) < tol for a, b in zip(c1, c2))


def slugify(name):
    words = re.sub(r"[^A-Za-z0-9 ]", "", name).split()
    return words[0].lower() + "".join(w.capitalize() for w in words[1:])


def path_points(dr):
    pts = []
    for it in dr.get("items", []):
        kind = it[0]
        if kind == "l":
            p0, p1 = it[1], it[2]
            if not pts:
                pts.append((p0.x, p0.y))
            pts.append((p1.x, p1.y))
        elif kind == "c":
            # Cubic bezier -- some deployment-zone boundaries use real arcs (seen on
            # page 13's zone cut), not just straight edges. Tessellate into enough
            # line segments to preserve the curve shape (schema stores straight-line
            # polygon vertices by design, see 11E-PROGRESS.md gotcha on setup mode).
            p0, p1, p2, p3 = it[1], it[2], it[3], it[4]
            if not pts:
                pts.append((p0.x, p0.y))
            N = 16
            for i in range(1, N + 1):
                t = i / N
                mt = 1 - t
                x = mt**3 * p0.x + 3 * mt**2 * t * p1.x + 3 * mt * t**2 * p2.x + t**3 * p3.x
                y = mt**3 * p0.y + 3 * mt**2 * t * p1.y + 3 * mt * t**2 * p2.y + t**3 * p3.y
                pts.append((x, y))
        elif kind == "re":
            r = it[1]
            pts.extend([(r.x0, r.y0), (r.x1, r.y0), (r.x1, r.y1), (r.x0, r.y1)])
    return pts


def extract_page_meta(page):
    """Pull disposition names (L/R), mission names (L/R), and layout letter from
    the page's own text. Positions verified stable across pages 9-13."""
    d = page.get_text("dict")
    spans = []
    for b in d["blocks"]:
        for l in b.get("lines", []):
            for s in l.get("spans", []):
                t = s["text"].strip()
                if t:
                    spans.append((round(s["bbox"][1], 1), round(s["bbox"][0], 1), t))

    def find(y_target, x_max, tol=1.0):
        cands = [t for y, x, t in spans if abs(y - y_target) < tol and x < x_max]
        return cands[0] if cands else None

    def find_right(y_target, x_min, tol=1.0):
        cands = [t for y, x, t in spans if abs(y - y_target) < tol and x >= x_min]
        return cands[0] if cands else None

    disp_l = find(139.5, 300)
    disp_r = find_right(139.5, 300)
    mission_l = find(186.9, 300)
    mission_r = find_right(186.9, 300)
    layout_span = next((t for y, x, t in spans if abs(y - 229.2) < 1.0), None)
    layout = layout_span.replace("LAYOUT", "").strip() if layout_span else "?"

    return {
        "dispositions": [disp_l, disp_r],
        "dispositionIds": [slugify(disp_l), slugify(disp_r)],
        "missionNames": [mission_l, mission_r],
        "missionIds": [slugify(mission_l), slugify(mission_r)],
        "layout": layout,
    }


def classify_piece_xrefs(page):
    """Auto-detect which of this page's own embedded raster xrefs are actual
    terrain-piece art (as opposed to badges/thumbnails/backgrounds), and split
    them dense vs light. See module docstring for the thresholds' provenance."""
    dense, light = set(), set()
    for img in page.get_image_info(xrefs=True):
        xref = img.get("xref")
        path = os.path.join(SPRITE_DIR, f"xref{xref}.png")
        if not os.path.exists(path):
            continue
        im = np.array(Image.open(path).convert("RGBA"))
        alpha = im[:, :, 3]
        mask = alpha > 30
        npix = int(mask.sum())
        if npix == 0 or npix > PIECE_NPIX_MAX:
            continue
        px = im[:, :, :3][mask].astype(float)
        mean = px.mean(axis=0)
        colorstd = px.std(axis=0).mean()
        if colorstd > PIECE_COLORSTD_MAX:
            continue
        if mean[1] > mean[0] and mean[2] > 40:
            dense.add(xref)
        elif mean[0] > mean[1]:
            light.add(xref)
    return dense, light


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


def extract_page(doc, page_idx):
    """Returns (layout_dict, sprites_dict) for one 0-indexed PDF page, following
    the exact validated page-9 methodology (see module + 02_extract_page9_layoutA.py
    docstrings for why each step works the way it does)."""
    page = doc[page_idx]
    meta = extract_page_meta(page)
    dense_xrefs, light_xrefs = classify_piece_xrefs(page)
    all_terrain_xrefs = dense_xrefs | light_xrefs
    print(f"  page {page_idx+1}: {meta['dispositions']} -> {meta['missionNames']} Layout {meta['layout']}"
          f" | {len(dense_xrefs)} dense, {len(light_xrefs)} light piece xrefs")

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
    pt_per_inch = statistics.median(ratios)

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
    board_w_in = (board_x1 - board_x0) / pt_per_inch
    board_h_in = (board_y1 - board_y0) / pt_per_inch

    def pt_to_in(px, py):
        return (round((px - board_x0) / pt_per_inch, 3), round((py - board_y0) / pt_per_inch, 3))

    zones = [
        {"player": 1, "points": [list(pt_to_in(x, y)) for x, y in red_pts]},
        {"player": 2, "points": [list(pt_to_in(x, y)) for x, y in blue_pts]},
    ]

    area_drawings = []
    for dr in drawings:
        if close(dr.get("fill"), GREY_AREA_FILL):
            r = dr.get("rect")
            if r and r.width > 15 and r.height > 15:
                area_drawings.append(dr)

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
            "boundingIn": (round(r.width / pt_per_inch, 2), round(r.height / pt_per_inch, 2)),
        })

    pieces = []
    for xref in all_terrain_xrefs:
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
                "terrainType": "dense" if xref in dense_xrefs else "light",
                "featureId": f"{badge_labels[best_i]['label']}_{best_i}" if badge_labels else None,
                "x": ix, "y": iy,
                "w": round(w_pt / pt_per_inch, 3), "h": round(h_pt / pt_per_inch, 3),
                "rot": round(rot, 1),
            })
    for i, p in enumerate(pieces):
        p["id"] = f"p{i+1}"

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
            for name, col in [("red", RED_FILL), ("blue", BLUE_FILL), ("teal", OBJ_TEAL), ("teal2", OBJ_TEAL2)]:
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

    sprites = {}
    for xref in all_terrain_xrefs:
        pts, w, h = vectorize_sprite(xref)
        sprites[f"x{xref}"] = {"points": pts, "viewW": w, "viewH": h,
                                "terrainType": "dense" if xref in dense_xrefs else "light"}

    layout = {
        "edition": "11e",
        "sourcePage": page_idx + 1,
        "dispositions": meta["dispositionIds"],
        "dispositionLabels": meta["dispositions"],
        "missions": [
            {"disposition": meta["dispositionIds"][0], "missionId": meta["missionIds"][0], "missionName": meta["missionNames"][0]},
            {"disposition": meta["dispositionIds"][1], "missionId": meta["missionIds"][1], "missionName": meta["missionNames"][1]},
        ],
        "layout": meta["layout"],
        "boardWidth": round(board_w_in, 2), "boardHeight": round(board_h_in, 2),
        "zones": zones, "noMansLand": [],
        "features": [{"id": f["id"], "label": f["label"], "area": f["area"]} for f in features],
        "pieces": pieces, "objectives": objectives,
    }

    # no-man's-land (board minus both zones), same as validated page-9 approach
    board_poly = shapely_box(board_x0, board_y0, board_x1, board_y1)
    red_poly = Polygon(red_pts)
    blue_poly = Polygon(blue_pts)
    if not red_poly.is_valid:
        red_poly = red_poly.buffer(0)
    if not blue_poly.is_valid:
        blue_poly = blue_poly.buffer(0)
    nml_poly = board_poly.difference(unary_union([red_poly, blue_poly]))
    if nml_poly.geom_type == "Polygon":
        nml_coords = list(nml_poly.exterior.coords)[:-1]
    else:
        nml_coords = list(max(nml_poly.geoms, key=lambda g: g.area).exterior.coords)[:-1]
    layout["noMansLand"] = [list(pt_to_in(x, y)) for x, y in nml_coords]

    return layout, sprites, features, zones, pieces, objectives


def render_reconstruction(layout, sprites, features, zones, pieces, objectives, out_path, px_per_in=15):
    board_w_in, board_h_in = layout["boardWidth"], layout["boardHeight"]
    W, H = int(board_w_in * px_per_in), int(board_h_in * px_per_in)
    img = Image.new("RGB", (W, H), (230, 230, 225))
    draw = ImageDraw.Draw(img, "RGBA")

    for z in zones:
        color = (200, 40, 40, 130) if z["player"] == 1 else (30, 110, 160, 130)
        pts = [(x * px_per_in, y * px_per_in) for x, y in z["points"]]
        draw.polygon(pts, fill=color)

    for feat in features:
        pts = [(x * px_per_in, y * px_per_in) for x, y in feat["area"]]
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
            lx = ((px / vw) - 0.5) * p["w"]
            ly = ((py / vh) - 0.5) * p["h"]
            rx = lx * math.cos(rot) - ly * math.sin(rot)
            ry = lx * math.sin(rot) + ly * math.cos(rot)
            out_pts.append(((p["x"] + rx) * px_per_in, (p["y"] + ry) * px_per_in))
        color = (20, 120, 90, 255) if p["terrainType"] == "dense" else (200, 160, 30, 255)
        draw.polygon(out_pts, fill=color)

    obj_colors = {"home": (220, 50, 50), "central": (20, 140, 110), "expansion": (20, 140, 110)}
    for o in objectives:
        cx, cy = o["x"] * px_per_in, o["y"] * px_per_in
        col = obj_colors[o["type"]]
        if o["type"] == "home" and o["owner"] == 2:
            col = (40, 90, 150)
        draw.ellipse([cx - 8, cy - 8, cx + 8, cy + 8], fill=col + (255,), outline=(255, 255, 255, 255), width=2)

    img.save(out_path)
    return img


if __name__ == "__main__":
    doc = fitz.open(PDF_PATH)
    PAGES = [p - 1 for p in range(*(lambda a, b: (a, b + 1))(*map(int, os.environ.get("E11_PAGES", "19-53").split("-"))))]  # 0-indexed; E11_PAGES="first-last" (1-indexed)
    for pidx in PAGES:
        layout, sprites, features, zones, pieces, objectives = extract_page(doc, pidx)
        slug = f"p{pidx+1}"
        with open(os.path.join(CACHE_DIR, f"{slug}-raw.json"), "w") as fp:
            json.dump(layout, fp, indent=2)
        with open(os.path.join(CACHE_DIR, f"{slug}-sprites.json"), "w") as fp:
            json.dump(sprites, fp, indent=1)
        render_reconstruction(layout, sprites, features, zones, pieces, objectives,
                               os.path.join(CACHE_DIR, f"{slug}-render.png"))
        print(f"  -> wrote {slug}-raw.json, {slug}-sprites.json, {slug}-render.png")
