"""
11e conversion pipeline — step 4: per-page compare image.

Renders the real PDF page (via page.get_pixmap) and pastes it side by side
with our reconstruction (cache/p{N}-render.png from 02_extract_page.py), so
you can visually validate a page without opening the source PDF. Was done ad
hoc inline for batches 1-2; promoted to a real script here per the note in
11E-PROGRESS.md so it's a stable, repeatable command going forward.

Requires cache/p{N}-render.png to already exist (run 02_extract_page.py first).
"""
import fitz
from PIL import Image
import os

PDF_PATH = r"C:\Users\nxw05\Downloads\maps.pdf"
CACHE_DIR = os.path.join(os.path.dirname(__file__), "cache")


def build_compare(doc, page_idx):
    pno = page_idx + 1
    page = doc[page_idx]
    pix = page.get_pixmap(matrix=fitz.Matrix(3, 3))
    ref_path = os.path.join(CACHE_DIR, f"p{pno}-pdfpage.png")
    pix.save(ref_path)
    ref_im = Image.open(ref_path)
    rec_im = Image.open(os.path.join(CACHE_DIR, f"p{pno}-render.png"))
    target_h = ref_im.height
    scale = target_h / rec_im.height
    rec_im2 = rec_im.resize((int(rec_im.width * scale), target_h))
    gap = 20
    combo = Image.new("RGB", (ref_im.width + gap + rec_im2.width, target_h), (255, 255, 255))
    combo.paste(ref_im, (0, 0))
    combo.paste(rec_im2, (ref_im.width + gap, 0))
    out = os.path.join(CACHE_DIR, f"compare_p{pno}.png")
    combo.save(out)
    return out


if __name__ == "__main__":
    doc = fitz.open(PDF_PATH)
    PAGES = list(range(18, 53))  # 0-indexed -- EDIT PER BATCH, keep in sync with 02/03
    for pidx in PAGES:
        out = build_compare(doc, pidx)
        print("wrote", out)
