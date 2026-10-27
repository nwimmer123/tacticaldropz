"""
11e conversion pipeline — step 1: sprite catalog.

Extracts unique raster image XObjects (terrain piece art) from the given PDF
pages, saves each as a properly-alpha-composited PNG (base image + its PDF
soft-mask — do NOT use fitz.Pixmap(doc, xref) directly, it drops the alpha;
use doc.extract_image() for both the base and the smask and composite with
PIL), and builds a labeled contact sheet so you can eyeball which sprites are
green (dense/wall-blocking) vs yellow (light/non-blocking) terrain pieces vs.
other art (disposition badges, background textures — safe to ignore, see
PROGRESS.md for what those looked like on page 9).

Usage: edit PAGES below to the 0-indexed PDF pages you want to scan (a
disposition pairing's 3 layout pages, e.g. [n, n+1, n+2]), then run. Sprites
are reused across many pages, so scanning a few pages at a time and comparing
against the running cache/sprites_raw folder is enough to catch new ones —
you don't need to re-scan pages whose sprites you've already classified.
"""
import fitz
from PIL import Image, ImageDraw
import io
import os

PDF_PATH = os.environ.get("E11_PDF", os.path.join(os.path.dirname(__file__), "..", "..", "newLayouts.pdf"))  # old Downloads/maps.pdf is gone
CACHE_DIR = os.environ.get("E11_CACHE", os.path.join(os.path.dirname(__file__), "cache"))
SPRITE_DIR = os.path.join(CACHE_DIR, "sprites_raw")
os.makedirs(SPRITE_DIR, exist_ok=True)

PAGES = [p - 1 for p in range(*(lambda a, b: (a, b + 1))(*map(int, os.environ.get("E11_PAGES", "19-53").split("-"))))]  # 0-indexed; E11_PAGES="first-last" (1-indexed)

doc = fitz.open(PDF_PATH)

seen = {}
for pno in PAGES:
    page = doc[pno]
    for img in page.get_image_info(xrefs=True):
        xref = img.get("xref")
        path = os.path.join(SPRITE_DIR, f"xref{xref}.png")
        if xref in seen or os.path.exists(path):
            continue
        try:
            info = doc.extract_image(xref)
            base = Image.open(io.BytesIO(info["image"])).convert("RGBA")
            smask_xref = info.get("smask")
            if smask_xref:
                sinfo = doc.extract_image(smask_xref)
                mask = Image.open(io.BytesIO(sinfo["image"])).convert("L")
                if mask.size != base.size:
                    mask = mask.resize(base.size)
                base.putalpha(mask)
            base.save(path)
        except Exception as e:
            print("skip", xref, e)
            continue
        seen[xref] = {"path": path, "w": base.width, "h": base.height, "first_page": pno + 1}

print(f"new unique sprites this run: {len(seen)}")
for xref, info in sorted(seen.items(), key=lambda kv: -(kv[1]["w"] * kv[1]["h"])):
    print(xref, info["w"], info["h"], "first_page=" + str(info["first_page"]))

# Rebuild the contact sheet from EVERYTHING in sprites_raw so far (cumulative across runs)
all_files = sorted(os.listdir(SPRITE_DIR))
cell, pad, cols = 140, 30, 8
rows = (len(all_files) + cols - 1) // cols
sheet = Image.new("RGB", (cols * cell, rows * (cell + pad)), (60, 60, 60))
draw = ImageDraw.Draw(sheet)
for i, fname in enumerate(all_files):
    r, c = divmod(i, cols)
    im = Image.open(os.path.join(SPRITE_DIR, fname)).convert("RGBA")
    im.thumbnail((cell - 10, cell - 10))
    bg = Image.new("RGBA", (cell - 10, cell - 10), (90, 90, 90, 255))
    ox, oy = (cell - 10 - im.width) // 2, (cell - 10 - im.height) // 2
    bg.paste(im, (ox, oy), im)
    sheet.paste(bg, (c * cell + 5, r * (cell + pad) + 5))
    draw.text((c * cell + 5, r * (cell + pad) + cell - 5), fname.replace(".png", ""), fill=(255, 255, 0))
sheet_path = os.path.join(CACHE_DIR, "contact_sheet.png")
sheet.save(sheet_path)
print("contact sheet (cumulative):", sheet_path)
print("Total sprites cached so far:", len(all_files))
