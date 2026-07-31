"""
11e conversion pipeline — step 5: build the disposition/mission lookup
manifest the app's UI reads at boot (data/dispositionMissions.json).

Scans every file in data/terrain/11e/*.json, groups them by disposition
pairing (dispositions[0], dispositions[1] as stored -- no reverse-order
duplicates exist, confirmed during extraction), and emits one entry per
pairing with the mission name for each side plus the exact file path for
each layout letter.

Handles a schema quirk: page 9's file (battlefieldDominance-A.json) predates
the `missions[]` array (see 03_flatten_for_app.py's output) and instead has
singular `missionId`/`missionName` -- synthesized into missionA/missionB here
so it slots into the same pairing entry as its siblings (which use the
`missions[]` schema and the `takeAndHold-takeAndHold-*.json` naming). This is
how the page-9 filename irregularity gets absorbed without renaming the file.

Run once (or whenever data/terrain/11e/ changes) and commit the output.
"""
import json, os, glob

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
LAYOUT_DIR = os.path.join(REPO_ROOT, "data", "terrain", "11e")
OUT_PATH = os.path.join(REPO_ROOT, "data", "dispositionMissions.json")

DISPOSITION_LABELS = {
    "takeAndHold": "Take and Hold",
    "purgeTheFoe": "Purge the Foe",
    "disruption": "Disruption",
    "reconnaissance": "Reconnaissance",
    "priorityAssets": "Priority Assets",
}

# Mission names come straight off the PDF page text, which prints them in
# ALL CAPS. Page 9's file is the one exception (hand-typed title case in the
# original validated script) -- title-case everything so display is
# consistent, keeping small connector words lowercase except as the first word.
SMALL_WORDS = {"and", "the", "of", "a", "an", "in", "on", "to"}


def title_case_mission(name):
    words = name.split(" ")
    out = []
    for i, w in enumerate(words):
        lw = w.lower()
        out.append(lw if (i > 0 and lw in SMALL_WORDS) else lw.capitalize())
    return " ".join(out)

pairings = {}  # (a, b) -> {missionA, missionB, layouts: {letter: path}}

for path in sorted(glob.glob(os.path.join(LAYOUT_DIR, "*.json"))):
    with open(path) as f:
        d = json.load(f)

    if "missions" in d:
        mission_a = {"id": d["missions"][0]["missionId"], "name": title_case_mission(d["missions"][0]["missionName"])}
        mission_b = {"id": d["missions"][1]["missionId"], "name": title_case_mission(d["missions"][1]["missionName"])}
    else:
        # page-9-style singular schema -- same mission name both sides, already title-cased
        mission_a = {"id": d["missionId"], "name": d["missionName"]}
        mission_b = {"id": d["missionId"], "name": d["missionName"]}

    a, b = d["dispositions"][0], d["dispositions"][1]
    key = (a, b)
    rel_path = "data/terrain/11e/" + os.path.basename(path)

    if key not in pairings:
        pairings[key] = {"a": a, "b": b, "missionA": mission_a, "missionB": mission_b, "layouts": {}}
    pairings[key]["layouts"][d["layout"]] = rel_path

manifest = {
    "dispositions": [{"id": k, "label": v} for k, v in DISPOSITION_LABELS.items()],
    "pairings": list(pairings.values()),
}

with open(OUT_PATH, "w") as f:
    json.dump(manifest, f, indent=2)

print(f"wrote {OUT_PATH}")
print(f"{len(manifest['pairings'])} pairings")
for p in manifest["pairings"]:
    layouts = sorted(p["layouts"].keys())
    print(f"  {p['a']:>16} vs {p['b']:<16} layouts={layouts} missionA={p['missionA']['name']!r} missionB={p['missionB']['name']!r}")
