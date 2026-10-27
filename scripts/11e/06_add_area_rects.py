"""
11e conversion pipeline — step 6, post-process: adds a precomputed oriented
bounding rectangle to every area in every already-generated
data/terrain/11e/*.json file.

Why this exists: area shapes are raw per-page vector traces (see
02_extract_page.py's path_points()), not instanced from a shared template +
transform the way pieces are (see 03_flatten_batch.py's
piece_to_absolute_points, which rotates a shared local sprite outline into
place) -- PDFs give us a placement matrix for embedded images (pieces) but
not for vector paths (areas), so there's no cheap "this area's real corners
are X" available from the source data itself. Client-side heuristics tried
in the app (turn-angle filtering, line intersection between long edges,
plain axis-aligned bounding box) were all defeated by things that turned out
to be genuine, intentional features of the source art: small decorative
nubs on otherwise-straight edges, and pieces placed at a real angle on the
page (confirmed one area's true orientation sits at ~104 degrees).

Approach (settled after several iterations, see git history for the ones
that didn't hold up):
  1. angle: the direction of the single LONGEST edge segment in the shape.
     Tried rotating calipers (angle that minimizes enclosing area over every
     convex-hull edge) first -- it's the textbook answer, but a small
     chamfer/bevel hull edge can occasionally beat the true edge on minimum
     *area* even though it's obviously not the real orientation, throwing
     the whole rectangle off by a few degrees (confirmed on a real shape:
     picked 3.8 degrees off vertical, visibly wrong over a 10" span). The
     longest raw edge is never a tessellation/bevel artifact -- those are
     all under an inch -- so it's a more robust orientation signal.
  2. per-side position: independently, for each of the 4 sides, the
     position with the most total inches of nearly-parallel boundary behind
     it (not just the extreme point) -- a real edge is backed by most of
     that side's length; a decorative nub is a short local wiggle that
     can't out-total it. Tried a uniform inward shrink of all 4 sides first
     -- wrong, because one nub on a single side forced the same margin onto
     every side, needlessly eating into clean sides that had no nub at all.
  3. safety net: verify the result is fully contained in the true polygon
     (every corner inside, no polygon edge cuts through it) -- placing
     models "hugging the edge" of physical terrain means a rectangle that
     pokes past the real silhouette anywhere would misclassify a model
     standing in that gap as being on top of the terrain. If step 2 leaves
     a corner just outside, nudge the whole rectangle inward (uniformly,
     small steps) until verified contained. This is now a rare correction,
     not the primary mechanism.

Computed ONCE here rather than re-derived from the dense tessellated path
every time the page loads in the browser -- bake the answer into the data,
the same way piece corners are just rotate+translate math against
already-known geometry.

This only ADDS a new `rectCorners` field ([[x,y] x4], same board-inch space
as `d`) to each area. It does not touch `d` (still the exact silhouette,
kept for on-canvas rendering so the map keeps its current look) or anything
else in the file. Safe to re-run -- overwrites rectCorners idempotently,
touches nothing else.
"""
import json
import math
import os

DATA_DIR = os.environ.get("E11_DATA", r"C:\Users\nxw05\Projects\tacticaldropz\data\terrain\11e")


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


def longest_edge_angle(pts):
    n = len(pts)
    best_len, best_angle = -1, 0.0
    for i in range(n):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % n]
        length = math.hypot(x2 - x1, y2 - y1)
        if length > best_len:
            best_len, best_angle = length, math.atan2(y2 - y1, x2 - x1)
    return best_angle


def find_runs(rpts, axis):
    """Contiguous (path-adjacent) runs of nearly-axis-parallel edges sitting
    at a stable position, in the rotated frame. axis=1 groups nearly
    horizontal edges by their y (for top/bottom sides), axis=0 groups nearly
    vertical edges by their x (for left/right sides). Returns
    [(position, run_length), ...]."""
    n = len(rpts)
    runs = []
    cur_pos_sum = cur_len = 0.0
    cur_count = 0
    for i in range(n):
        x1, y1 = rpts[i]
        x2, y2 = rpts[(i + 1) % n]
        dx, dy = x2 - x1, y2 - y1
        length = math.hypot(dx, dy)
        qualifies, pos = False, None
        if length > 1e-6:
            if axis == 1 and abs(dy) < 0.3 * length:
                pos, qualifies = (y1 + y2) / 2, True
            elif axis == 0 and abs(dx) < 0.3 * length:
                pos, qualifies = (x1 + x2) / 2, True
        if qualifies and cur_count > 0 and abs(pos - cur_pos_sum / cur_count) < 0.2:
            cur_pos_sum += pos
            cur_len += length
            cur_count += 1
        elif qualifies:
            if cur_count > 0:
                runs.append((cur_pos_sum / cur_count, cur_len))
            cur_pos_sum, cur_len, cur_count = pos, length, 1
        else:
            if cur_count > 0:
                runs.append((cur_pos_sum / cur_count, cur_len))
            cur_pos_sum = cur_len = 0.0
            cur_count = 0
    if cur_count > 0:
        runs.append((cur_pos_sum / cur_count, cur_len))
    return runs


def point_in_polygon(x, y, pts):
    inside = False
    n = len(pts)
    j = n - 1
    for i in range(n):
        xi, yi = pts[i]
        xj, yj = pts[j]
        if ((yi > y) != (yj > y)) and (x < (xj - xi) * (y - yi) / (yj - yi + 1e-12) + xi):
            inside = not inside
        j = i
    return inside


def seg_intersect(p1, p2, p3, p4):
    def ccw(a, b, c):
        return (c[1] - a[1]) * (b[0] - a[0]) - (b[1] - a[1]) * (c[0] - a[0])
    d1, d2 = ccw(p3, p4, p1), ccw(p3, p4, p2)
    d3, d4 = ccw(p1, p2, p3), ccw(p1, p2, p4)
    return ((d1 > 0) != (d2 > 0)) and ((d3 > 0) != (d4 > 0))


def rect_contained(rect, poly_pts, poly_edges):
    """True if the (convex, 4-corner) rect lies fully inside poly_pts --
    every corner inside, and no polygon edge cuts through a rect edge."""
    for p in rect:
        if not point_in_polygon(p[0], p[1], poly_pts):
            return False
    for i in range(4):
        r1, r2 = rect[i], rect[(i + 1) % 4]
        for e1, e2 in poly_edges:
            if seg_intersect(r1, r2, e1, e2):
                return False
    return True


def robust_rect_corners(pts):
    angle = longest_edge_angle(pts)
    c, s = math.cos(-angle), math.sin(-angle)
    rpts = [(x * c - y * s, x * s + y * c) for x, y in pts]

    rxs = [p[0] for p in rpts]
    rys = [p[1] for p in rpts]
    minx, maxx, miny, maxy = min(rxs), max(rxs), min(rys), max(rys)

    # For each side, the position backed by the LONGEST SINGLE CONTIGUOUS
    # run of nearly-parallel boundary -- not just the raw extreme point, and
    # not just "most total length nearby" either (tried that first: summing
    # length across every edge near a coordinate, regardless of where in the
    # path they occur, breaks on shapes with a long tessellated diagonal --
    # its many small segments jitter enough to be "locally near-vertical" or
    # "locally near-horizontal" by pure noise, and several *unrelated*
    # fragments from different points along that diagonal can coincidentally
    # land at nearly the same coordinate and sum to a deceptively large
    # total, even though none of them is anywhere near a real edge; confirmed
    # on a real shape where 3 disconnected fragments -- path indices 5, 8,
    # and 59 out of 68, nowhere near each other -- summed to more length than
    # the shape's one genuine edge). Requiring one CONTIGUOUS run (adjacent
    # in the path, not just numerically close) can't be fooled that way.
    horiz_runs = find_runs(rpts, axis=1)
    vert_runs = find_runs(rpts, axis=0)

    def best_in_range(runs, lo, hi, fallback):
        cands = [(v, tot) for v, tot in runs if lo <= v <= hi]
        return max(cands, key=lambda t: t[1])[0] if cands else fallback

    w, h, cap = maxx - minx, maxy - miny, 0.4
    top = best_in_range(horiz_runs, miny, miny + cap * h, miny)
    bottom = best_in_range(horiz_runs, maxy - cap * h, maxy, maxy)
    left = best_in_range(vert_runs, minx, minx + cap * w, minx)
    right = best_in_range(vert_runs, maxx - cap * w, maxx, maxx)

    c2, s2 = math.cos(angle), math.sin(angle)

    def rot_back(pt):
        x, y = pt
        return (x * c2 - y * s2, x * s2 + y * c2)

    rect = [rot_back((left, top)), rot_back((right, top)),
            rot_back((right, bottom)), rot_back((left, bottom))]

    # Safety net: verify full containment in the true polygon; if a corner
    # still pokes out, shrink the whole rectangle inward (toward its own
    # center, small uniform steps) until it's verified safe.
    poly_edges = [(pts[i], pts[(i + 1) % len(pts)]) for i in range(len(pts))]
    if rect_contained(rect, pts, poly_edges):
        return rect, 0.0

    cx = sum(p[0] for p in rect) / 4
    cy = sum(p[1] for p in rect) / 4
    span = max(w, h)
    max_margin = min(w, h) * 0.4
    m = 0.1
    while m <= max_margin:
        f = 1 - m / span
        shrunk = [(cx + (p[0] - cx) * f, cy + (p[1] - cy) * f) for p in rect]
        if rect_contained(shrunk, pts, poly_edges):
            return shrunk, m
        m += 0.1
    return rect, None  # no safe correction found -- ship the best-effort rect anyway, flagged


def polygon_area(pts):
    a = 0.0
    for i in range(len(pts)):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % len(pts)]
        a += x1 * y2 - x2 * y1
    return abs(a) / 2


def point_line_distance(p, a, b):
    (x, y), (x1, y1), (x2, y2) = p, a, b
    dx, dy = x2 - x1, y2 - y1
    if dx == 0 and dy == 0:
        return math.hypot(x - x1, y - y1)
    t = max(0, min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)))
    return math.hypot(x - (x1 + t * dx), y - (y1 + t * dy))


def rdp(points, epsilon):
    """Ramer-Douglas-Peucker on an open polyline; points[0]/points[-1] are
    fixed endpoints."""
    if len(points) < 3:
        return points
    start, end = points[0], points[-1]
    max_dist, max_idx = -1, -1
    for i in range(1, len(points) - 1):
        d = point_line_distance(points[i], start, end)
        if d > max_dist:
            max_dist, max_idx = d, i
    if max_dist > epsilon:
        left = rdp(points[:max_idx + 1], epsilon)
        right = rdp(points[max_idx:], epsilon)
        return left[:-1] + right
    return [start, end]


# Some areas are genuinely irregular polygons -- not a rectangle, and not
# (like the earlier "two triangles forming one rectangle" case) two shapes
# that combine into one -- a rectangle can never represent these well no
# matter how the per-side detection is tuned (confirmed visually: two such
# shapes' bounding rectangles were 60-70% empty space around a narrow
# dart/wedge outline). For these, ship the actual simplified shape instead
# of forcing a rectangle. Same closed-polygon RDP idea as the rectangle path
# rejected (an open-line RDP doesn't handle a closed loop on its own): split
# at the two farthest-apart points into two open chains, simplify each,
# rejoin.
def simplify_closed_polygon(pts, epsilon):
    n = len(pts)
    if n < 4:
        return pts
    best_d, bi, bj = -1, 0, 1
    for i in range(n):
        xi, yi = pts[i]
        for j in range(i + 1, n):
            xj, yj = pts[j]
            d = (xi - xj) ** 2 + (yi - yj) ** 2
            if d > best_d:
                best_d, bi, bj = d, i, j
    chain1 = pts[bi:bj + 1]
    chain2 = pts[bj:] + pts[:bi + 1]
    s1 = rdp(chain1, epsilon)
    s2 = rdp(chain2, epsilon)
    return s1[:-1] + s2[:-1]


# Fill-ratio threshold for "is a rectangle even the right model for this
# shape" -- 0.75 sits comfortably above the ~0.63 ratio consistently seen on
# the known irregular/dart-shaped areas (same value on every occurrence
# across the dataset -- it's one reused design template, not a one-off) and
# comfortably below the ~0.9+ typical ratio on genuinely rectangular areas.
RECT_FIT_THRESHOLD = 0.75
SIMPLIFY_EPSILON = 0.5  # inches -- see 03/06 notes on the noise-vs-real-edge gap


def process_file(path):
    with open(path) as f:
        data = json.load(f)
    fallbacks, irregular = [], []
    for area in data.get("areas", []):
        pts = parse_area_path(area["d"])
        rect, margin = robust_rect_corners(pts)
        rect_area = polygon_area(rect)
        ratio = polygon_area(pts) / rect_area if rect_area > 0 else 0
        if ratio < RECT_FIT_THRESHOLD:
            corners = simplify_closed_polygon(pts, SIMPLIFY_EPSILON)
            irregular.append(area["id"])
        else:
            corners = rect
            if margin is None:
                fallbacks.append(area["id"])
        area["cornerPoints"] = [[round(x, 3), round(y, 3)] for x, y in corners]
        area.pop("rectCorners", None)
    if fallbacks:
        print(f"  (containment not verified, shipped best-effort rect: {fallbacks})")
    if irregular:
        print(f"  (not rectangular, shipped simplified polygon instead: {irregular})")
    with open(path, "w") as f:
        json.dump(data, f, indent=2)
    return len(data.get("areas", []))


if __name__ == "__main__":
    files = sorted(f for f in os.listdir(DATA_DIR) if f.endswith(".json"))
    total_areas = 0
    for fname in files:
        n = process_file(os.path.join(DATA_DIR, fname))
        total_areas += n
        print(f"{fname}: {n} areas")
    print(f"\ndone -- {len(files)} files, {total_areas} areas total")
