"""
11e conversion pipeline — step 7: visual validation for 06_add_area_rects.py.

Renders each layout's areas from their (already-validated, untouched) `d`
path in grey, with the new cornerPoints field overlaid in red on top -- so
you can see directly, per layout, whether the computed corners actually
line up with the real shape. This is a self-contained check against data
already trusted (the `d` paths were validated per-page against the source
PDF earlier in the pipeline and are not touched by 06_add_area_rects.py) --
it validates the new rectangle math specifically, not the original
extraction, and doesn't need the PDF open to do that.

Writes one PNG per layout file to cache/rectcheck_<layout-filename>.png.
"""
import json
import os
from PIL import Image, ImageDraw

DATA_DIR = os.environ.get("E11_DATA", r"C:\Users\nxw05\Projects\tacticaldropz\data\terrain\11e")
CACHE_DIR = os.environ.get("E11_CACHE", os.path.join(os.path.dirname(__file__), "cache"))
PX_PER_IN = 12


def parse_area_path(d):
    tokens = d.split()
    pts = []
    i = 0
    while i < len(tokens):
        if tokens[i] in ("M", "L"):
            pts.append((float(tokens[i + 1]), float(tokens[i + 2])))
            i += 3
        else:
            i += 1
    return pts


def render(path, out_path):
    with open(path) as f:
        data = json.load(f)
    bw, bh = data["boardWidth"], data["boardHeight"]
    W, H = int(bw * PX_PER_IN), int(bh * PX_PER_IN)
    img = Image.new("RGB", (W, H), (230, 230, 225))
    draw = ImageDraw.Draw(img)

    for area in data.get("areas", []):
        pts = [(x * PX_PER_IN, y * PX_PER_IN) for x, y in parse_area_path(area["d"])]
        if len(pts) >= 3:
            draw.polygon(pts, fill=(150, 150, 150), outline=(20, 20, 20))
        rc = area.get("cornerPoints")
        if rc:
            rpts = [(x * PX_PER_IN, y * PX_PER_IN) for x, y in rc]
            draw.polygon(rpts, outline=(230, 30, 30), width=2)
            for x, y in rpts:
                r = 3
                draw.ellipse([x - r, y - r, x + r, y + r], fill=(230, 30, 30))

    img.save(out_path)


if __name__ == "__main__":
    files = sorted(f for f in os.listdir(DATA_DIR) if f.endswith(".json"))
    for fname in files:
        out = os.path.join(CACHE_DIR, f"rectcheck_{fname.replace('.json', '.png')}")
        render(os.path.join(DATA_DIR, fname), out)
        print("wrote", out)
    print(f"done -- {len(files)} images in {CACHE_DIR}")
