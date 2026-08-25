"""
Extract the unit -> base size table from scripts/11e/cache/bases.pdf (pages 55-93)
using word bounding boxes (not pdftotext -layout, which mis-shifts rows on this PDF)
to reconstruct rows and split the UNIT / BASE SIZE columns reliably.
"""
import fitz  # PyMuPDF
import json
import re
import sys

PDF_PATH = "scripts/11e/cache/bases.pdf"
FIRST_PAGE = 55  # 1-indexed, inclusive
LAST_PAGE = 93   # 1-indexed, inclusive

doc = fitz.open(PDF_PATH)

def group_lines(words, y_tol=2.0):
    """Group words into visual lines by y0 proximity, sorted top-to-bottom then left-to-right."""
    words = sorted(words, key=lambda w: (round(w[1] / y_tol), w[0]))
    lines = []
    cur_y = None
    cur = []
    for w in words:
        y = w[1]
        if cur_y is None or abs(y - cur_y) <= y_tol:
            cur.append(w)
            cur_y = y if cur_y is None else cur_y
        else:
            lines.append(cur)
            cur = [w]
            cur_y = y
    if cur:
        lines.append(cur)
    return lines

def split_columns(line_words):
    """Given words on one line (sorted by x), split into (left_text, right_text) at the largest x-gap."""
    line_words = sorted(line_words, key=lambda w: w[0])
    if len(line_words) < 2:
        return (line_words[0][4] if line_words else "", "")
    gaps = []
    for i in range(1, len(line_words)):
        gap = line_words[i][0] - line_words[i - 1][2]
        gaps.append((gap, i))
    gaps.sort(reverse=True)
    split_idx = gaps[0][1]
    left = " ".join(w[4] for w in line_words[:split_idx])
    right = " ".join(w[4] for w in line_words[split_idx:])
    return (left.strip(), right.strip())

VALUE_RE = re.compile(
    r"^(hull|unique"
    r"|(large|small)\s+flying\s+base"
    r"|\d+(\.\d+)?mm(\s*x\s*\d+(\.\d+)?mm)?(\s*oval base)?"
    r"|\d+(\.\d+)?\s*x\s*\d+(\.\d+)?mm(\s*oval base)?)$",
    re.IGNORECASE,
)

def looks_like_value(s):
    return bool(VALUE_RE.match(s.strip()))

results = {}  # faction -> [ {unit, base} ]
current_faction = None
unresolved = []  # rows we couldn't confidently parse, for review

for pno in range(FIRST_PAGE - 1, LAST_PAGE):
    page = doc[pno]
    words = page.get_text("words")  # (x0,y0,x1,y1,text,block,line,word)
    if not words:
        continue
    lines = group_lines(words)

    for lw in lines:
        full_text = " ".join(w[4] for w in sorted(lw, key=lambda w: w[0]))
        stripped = full_text.strip()

        if not stripped:
            continue

        leftmost_word = sorted(lw, key=lambda w: w[0])[0][4]
        if leftmost_word.upper() in ("UNIT", "BASE"):
            # Column header row ("UNIT" / "BASE SIZE") — never a faction name, never reset faction
            continue
        if stripped.isdigit() and len(stripped) <= 3:
            # standalone page number
            continue
        if stripped.upper() == stripped and len(lw) <= 6 and not any(ch.isdigit() for ch in stripped):
            # ALL-CAPS short line with no digits = faction / sub-section header
            current_faction = stripped
            results.setdefault(current_faction, [])
            continue

        left, right = split_columns(lw)
        if not left:
            continue

        if current_faction is None:
            unresolved.append((pno + 1, full_text))
            continue

        if right and looks_like_value(right):
            results[current_faction].append({"unit": left, "base": right})
        else:
            # Couldn't confidently split — flag for manual review
            unresolved.append((pno + 1, full_text))

with open("scripts/11e/cache/base_sizes_extracted.json", "w", encoding="utf-8") as f:
    json.dump(results, f, indent=2, ensure_ascii=False)

with open("scripts/11e/cache/base_sizes_unresolved.txt", "w", encoding="utf-8") as f:
    for pno, txt in unresolved:
        f.write(f"p{pno}: {txt}\n")

total_units = sum(len(v) for v in results.values())
print(f"Factions: {len(results)}  Units: {total_units}  Unresolved lines: {len(unresolved)}")
