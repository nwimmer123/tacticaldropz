"""
format-json.py — compact JSON formatter for TacticalDropz data files.

Keeps coordinate arrays [[x,y],[x,y]...] and {x,y} objects on single lines,
while leaving everything else nicely indented.

Usage:
    python format-json.py data/deployments.json
    python format-json.py data/terrain/wtc-terrain.json
    python format-json.py data/deployments.json data/terrain/wtc-terrain.json
"""

import json, re, sys

def compact(raw):
    # Compact [number, number] coordinate pairs
    raw = re.sub(r'\[\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\]', r'[\1,\2]', raw)
    # Compact arrays of coordinate pairs onto one line
    raw = re.sub(
        r'\[\s*(\[[-\d.,]+\](?:\s*,\s*\[[-\d.,]+\])*)\s*\]',
        lambda m: '[' + re.sub(r'\s+', '', m.group(1)) + ']',
        raw
    )
    # Compact {"x": n, "y": n} objective objects
    raw = re.sub(
        r'\{\s*"x":\s*(-?[\d.]+)\s*,\s*"y":\s*(-?[\d.]+)\s*\}',
        r'{"x":\1,"y":\2}',
        raw
    )
    return raw

def format_file(path):
    with open(path, 'r') as f:
        data = json.load(f)
    raw = json.dumps(data, indent=2)
    raw = compact(raw)
    json.loads(raw)  # verify still valid JSON
    with open(path, 'w') as f:
        f.write(raw)
    print(f"Formatted: {path}")

if __name__ == '__main__':
    files = sys.argv[1:]
    if not files:
        # Default: format all known data files
        files = [
            'data/deployments.json',
            'data/terrain/wtc-terrain.json',
            'data/terrain/uktc-terrain.json'
        ]
    for path in files:
        try:
            format_file(path)
        except Exception as e:
            print(f"Error formatting {path}: {e}")
