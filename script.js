// ─── Constants ────────────────────────────────────────────────────────────────
const IPX = 15; // inches to pixels: 1" = 15px
// Board: 60" x 48" = 900px x 720px

// ─── WTC Piece Library ────────────────────────────────────────────────────────
// All dimensions in inches. Arm lengths derived from official 2025/2026 WTC pack.
// Footprint: 12"x6". Internal ruin: 9"x5". Wall thickness: 1.3" (33mm lower floor).
// VERIFY: armLong, armShort, wallThickness against physical pieces if rendering looks off.
const WTC_PIECES = {
  wtc_three_storey: {
    label: '3-Storey Ruin',
    armLong: 9,          // inches along long edge  — VERIFY
    armShort: 5,         // inches along short edge — VERIFY
    wallThickness: 1.3,  // inches (33mm)           — VERIFY
    fillColor: 'rgba(60,80,100,0.75)',
    strokeColor: 'rgba(120,160,200,0.9)',
    wallColor: 'rgba(80,110,140,0.95)'
  },
  wtc_two_storey: {
    label: '2-Storey Ruin',
    armLong: 9,
    armShort: 5,
    wallThickness: 1.3,
    fillColor: 'rgba(60,80,100,0.6)',
    strokeColor: 'rgba(120,160,200,0.75)',
    wallColor: 'rgba(80,110,140,0.85)'
  },
  wtc_container: {
    label: 'Container',
    fillColor: 'rgba(80,100,60,0.75)',
    strokeColor: 'rgba(140,180,100,0.9)'
  },
  wtc_prototype: {
    label: 'Prototype Ruin',
    fillColor: 'rgba(100,80,60,0.6)',
    strokeColor: 'rgba(180,140,100,0.75)'
  }
};

// ─── State ────────────────────────────────────────────────────────────────────
const canvas = document.getElementById('battlefield');
const ctx = canvas.getContext('2d');

let currentTool = 'draw';
let currentColor = '#00ff00';
let currentMission = null;
let currentTerrainFormat = 'gw'; // 'gw' | 'wtc' | 'uktc'
let currentLayoutIndex = 0;

let deployments = [];
let gwLayouts = 8; // GW uses image-based layouts l1-l8
let wtcData = null;
let uktcData = null;
let currentWtcLayout = null;

let drawings = [];
let currentPoints = [];
let measurePoints = [];
let isDrawing = false;
let drawingHintShown = false;
let hintElement = null;

let selectedUnit = null;
let isDragging = false;
let dragOffset = { x: 0, y: 0 };

// GW terrain images
const terrainImages = [];
let gwImagesLoaded = 0;

// ─── Boot ─────────────────────────────────────────────────────────────────────
async function init() {
  await loadDeployments();
  await loadWtcTerrain();
  await loadUktcTerrain();
  loadGwImages();
  buildNav();
  buildMissionSidebar();
  bindToolbar();
  bindCanvas();
  resizeCanvas();
  drawScene();
}

// ─── Data Loading ─────────────────────────────────────────────────────────────
async function loadDeployments() {
  try {
    const res = await fetch('data/deployments.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    deployments = await res.json();
    console.log(`Loaded ${deployments.length} deployments from JSON`);
  } catch (e) {
    console.warn('Could not load deployments.json, using built-in data.', e);
    deployments = FALLBACK_DEPLOYMENTS;
  }
  currentMission = deployments[0] || null;
}

// ─── Fallback Deployment Data (used if fetch fails) ───────────────────────────
const FALLBACK_DEPLOYMENTS = [
  {
    id: 'tippingPoint', name: 'Tipping Point',
    zones: [
      { player: 1, color: 'rgba(255,107,107,0.25)', stroke: 'rgba(255,107,107,0.6)',
        points: [[0,0],[12,0],[12,24],[20,24],[20,48],[0,48]] },
      { player: 2, color: 'rgba(78,205,196,0.25)', stroke: 'rgba(78,205,196,0.6)',
        points: [[40,0],[60,0],[60,48],[48,48],[48,24],[40,24]] }
    ],
    objectives: [{x:22,y:10},{x:30,y:24},{x:38,y:38},{x:14,y:34},{x:46,y:14}]
  },
  {
    id: 'hammerAnvil', name: 'Hammer and Anvil',
    zones: [
      { player: 1, color: 'rgba(255,107,107,0.25)', stroke: 'rgba(255,107,107,0.6)',
        points: [[0,0],[18,0],[18,48],[0,48]] },
      { player: 2, color: 'rgba(78,205,196,0.25)', stroke: 'rgba(78,205,196,0.6)',
        points: [[42,0],[60,0],[60,48],[42,48]] }
    ],
    objectives: [{x:30,y:6},{x:30,y:24},{x:30,y:42},{x:10,y:24},{x:50,y:24}]
  },
  {
    id: 'searchDestroy', name: 'Search and Destroy',
    zones: [
      { player: 1, color: 'rgba(255,107,107,0.25)', stroke: 'rgba(255,107,107,0.6)',
        points: [[30,0],[60,0],[60,24],[39,24],[30,15]] },
      { player: 2, color: 'rgba(78,205,196,0.25)', stroke: 'rgba(78,205,196,0.6)',
        points: [[0,24],[21,24],[30,33],[30,48],[0,48]] }
    ],
    objectives: [{x:14,y:10},{x:14,y:38},{x:30,y:24},{x:46,y:10},{x:46,y:38}]
  },
  {
    id: 'crucibleBattle', name: 'Crucible of Battle',
    zones: [
      { player: 1, color: 'rgba(255,107,107,0.25)', stroke: 'rgba(255,107,107,0.6)',
        points: [[0,0],[30,48],[0,48]] },
      { player: 2, color: 'rgba(78,205,196,0.25)', stroke: 'rgba(78,205,196,0.6)',
        points: [[30,0],[60,0],[60,48]] }
    ],
    objectives: [{x:20,y:8},{x:30,y:24},{x:40,y:40},{x:14,y:38},{x:46,y:10}]
  },
  {
    id: 'sweepingEngage', name: 'Sweeping Engagement',
    zones: [
      { player: 1, color: 'rgba(255,107,107,0.25)', stroke: 'rgba(255,107,107,0.6)',
        points: [[0,0],[60,0],[60,14],[30,14],[30,8],[0,8]] },
      { player: 2, color: 'rgba(78,205,196,0.25)', stroke: 'rgba(78,205,196,0.6)',
        points: [[0,34],[30,34],[30,40],[60,40],[60,48],[0,48]] }
    ],
    objectives: [{x:10,y:18},{x:30,y:24},{x:50,y:30},{x:42,y:6},{x:18,y:42}]
  },
  {
    id: 'dawnWar', name: 'Dawn of War',
    zones: [
      { player: 1, color: 'rgba(255,107,107,0.25)', stroke: 'rgba(255,107,107,0.6)',
        points: [[0,0],[60,0],[60,12],[0,12]] },
      { player: 2, color: 'rgba(78,205,196,0.25)', stroke: 'rgba(78,205,196,0.6)',
        points: [[0,36],[60,36],[60,48],[0,48]] }
    ],
    objectives: [{x:10,y:24},{x:30,y:24},{x:50,y:24},{x:30,y:6},{x:30,y:42}]
  }
];

async function loadWtcTerrain() {
  try {
    const res = await fetch('data/terrain/wtc-terrain.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    wtcData = await res.json();
    console.log(`Loaded WTC terrain: ${Object.keys(wtcData.missions || {}).length} missions`);
  } catch (e) {
    console.warn('Could not load wtc-terrain.json', e);
    wtcData = { format: 'wtc', name: 'WTC', missions: {
      hammerAnvil:   { name: 'Hammer and Anvil',    layouts: [{ id: 'ha_1', name: 'Layout 1', pieces: [] }] },
      tippingPoint:  { name: 'Tipping Point',        layouts: [{ id: 'tp_1', name: 'Layout 1', pieces: [] }] },
      searchDestroy: { name: 'Search and Destroy',   layouts: [{ id: 'sd_1', name: 'Layout 1', pieces: [] }] },
      crucibleBattle:{ name: 'Crucible of Battle',   layouts: [{ id: 'cb_1', name: 'Layout 1', pieces: [] }] },
      sweepingEngage:{ name: 'Sweeping Engagement',  layouts: [{ id: 'se_1', name: 'Layout 1', pieces: [] }] },
      dawnWar:       { name: 'Dawn of War',          layouts: [{ id: 'dw_1', name: 'Layout 1', pieces: [] }] }
    }};
  }
}

async function loadUktcTerrain() {
  try {
    const res = await fetch('data/terrain/uktc-terrain.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    uktcData = await res.json();
  } catch (e) {
    console.warn('Could not load uktc-terrain.json', e);
    uktcData = { format: 'uktc', name: 'UKTC', layouts: [{ id: 'placeholder', name: 'No layouts loaded', pieces: [] }] };
  }
}

function loadGwImages() {
  for (let i = 1; i <= 8; i++) {
    const img = new Image();
    img.onload = img.onerror = () => {
      gwImagesLoaded++;
      if (gwImagesLoaded === 8 && currentTerrainFormat === 'gw') drawScene();
    };
    img.src = `layouts/l${i}.png`;
    terrainImages[i - 1] = img;
  }
}

// ─── Nav / UI Build ───────────────────────────────────────────────────────────
function buildNav() {
  const nav = document.getElementById('topNav');
  nav.innerHTML = '';

  // App title
  const title = document.createElement('span');
  title.className = 'nav-title';
  title.textContent = 'TacticalDropz';
  nav.appendChild(title);

  const spacer = document.createElement('div');
  spacer.style.flex = '1';
  nav.appendChild(spacer);

  // Terrain Set dropdown
  const terrainLabel = document.createElement('span');
  terrainLabel.className = 'nav-label';
  terrainLabel.textContent = 'Terrain:';
  nav.appendChild(terrainLabel);

  const terrainSelect = document.createElement('select');
  terrainSelect.className = 'nav-select';
  terrainSelect.id = 'terrainFormatSelect';
  [
    { value: 'gw', label: 'GW' },
    { value: 'wtc', label: 'WTC' },
    { value: 'uktc', label: 'UKTC (coming soon)' }
  ].forEach(opt => {
    const o = document.createElement('option');
    o.value = opt.value;
    o.textContent = opt.label;
    terrainSelect.appendChild(o);
  });
  terrainSelect.onchange = () => selectTerrainFormat(terrainSelect.value);
  nav.appendChild(terrainSelect);

  // Layout dropdown
  const layoutLabel = document.createElement('span');
  layoutLabel.className = 'nav-label';
  layoutLabel.textContent = 'Layout:';
  nav.appendChild(layoutLabel);

  const layoutSelect = document.createElement('select');
  layoutSelect.className = 'nav-select';
  layoutSelect.id = 'layoutSelect';
  nav.appendChild(layoutSelect);
  layoutSelect.onchange = () => selectLayout(parseInt(layoutSelect.value));

  populateLayoutDropdown();

  // About link
  const about = document.createElement('a');
  about.href = 'about.html';
  about.className = 'nav-link';
  about.textContent = 'About';
  nav.appendChild(about);

  // Feedback link
  const feedback = document.createElement('a');
  feedback.href = 'mailto:nwimmer123@yahoo.com?subject=TacticalDropz Feedback';
  feedback.className = 'nav-link';
  feedback.textContent = '📧 Feedback';
  nav.appendChild(feedback);
}

function getWtcMissionLayouts() {
  if (!wtcData || !wtcData.missions) {
    console.warn('getWtcMissionLayouts: wtcData or wtcData.missions missing', wtcData);
    return null;
  }
  const missionId = currentMission ? currentMission.id : null;
  if (!missionId) {
    console.warn('getWtcMissionLayouts: currentMission is null');
    return null;
  }
  const missionData = wtcData.missions[missionId];
  if (!missionData) {
    console.warn(`getWtcMissionLayouts: no mission data for id "${missionId}". Available keys:`, Object.keys(wtcData.missions));
  }
  return missionData ? missionData.layouts : null;
}

function populateLayoutDropdown() {
  const sel = document.getElementById('layoutSelect');
  sel.innerHTML = '';

  if (currentTerrainFormat === 'gw') {
    for (let i = 1; i <= 8; i++) {
      const o = document.createElement('option');
      o.value = i - 1;
      o.textContent = `Layout ${i}`;
      sel.appendChild(o);
    }
  } else if (currentTerrainFormat === 'wtc' && wtcData) {
    const layouts = getWtcMissionLayouts();
    if (layouts && layouts.length) {
      layouts.forEach((layout, i) => {
        const o = document.createElement('option');
        o.value = i;
        o.textContent = layout.name;
        sel.appendChild(o);
      });
    } else {
      const o = document.createElement('option');
      o.value = 0;
      o.textContent = 'No WTC layouts for this mission';
      sel.appendChild(o);
    }
  } else if (currentTerrainFormat === 'uktc' && uktcData) {
    uktcData.layouts.forEach((layout, i) => {
      const o = document.createElement('option');
      o.value = i;
      o.textContent = layout.name;
      sel.appendChild(o);
    });
  }

  currentLayoutIndex = 0;
  sel.value = 0;
}

function buildMissionSidebar() {
  const sidebar = document.getElementById('leftSidebar');
  sidebar.innerHTML = '<div class="sidebar-header">Mission</div>';
  deployments.forEach(mission => {
    const opt = document.createElement('div');
    opt.className = `deploy-option ${mission === currentMission ? 'active' : ''}`;
    opt.textContent = mission.name;
    opt.dataset.id = mission.id;
    opt.onclick = () => selectMission(mission.id);
    sidebar.appendChild(opt);
  });
}

function bindToolbar() {
  document.querySelectorAll('[data-tool]').forEach(btn => {
    btn.onclick = () => selectTool(btn.dataset.tool);
  });
  document.querySelectorAll('.color-swatch').forEach(swatch => {
    swatch.onclick = () => selectColor(swatch.dataset.color);
  });
}

function bindCanvas() {
  canvas.addEventListener('mousedown', handleMouseDown);
  canvas.addEventListener('mousemove', handleMouseMove);
  canvas.addEventListener('dblclick', handleDoubleClick);
  canvas.addEventListener('mouseup', handleMouseUp);
  canvas.addEventListener('mouseleave', handleMouseUp);
}

// ─── Selection Handlers ───────────────────────────────────────────────────────
function selectTerrainFormat(format) {
  currentTerrainFormat = format;
  currentLayoutIndex = 0;
  populateLayoutDropdown();
  drawScene();
}

function selectLayout(index) {
  currentLayoutIndex = index;
  drawScene();
}

function selectMission(id) {
  currentMission = deployments.find(d => d.id === id);
  document.querySelectorAll('.deploy-option').forEach(o => {
    o.classList.toggle('active', o.dataset.id === id);
  });
  // WTC terrain is mission-specific — repopulate layout dropdown
  if (currentTerrainFormat === 'wtc') populateLayoutDropdown();
  drawScene();
}

function selectTool(tool) {
  currentTool = tool;
  currentPoints = [];
  measurePoints = [];
  hideDrawingHint();
  document.querySelectorAll('[data-tool]').forEach(b => b.classList.remove('active'));
  const btn = document.querySelector(`[data-tool="${tool}"]`);
  if (btn) btn.classList.add('active');
  drawScene();
}

function selectColor(color) {
  currentColor = color;
  document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
  const sw = document.querySelector(`[data-color="${color}"]`);
  if (sw) sw.classList.add('active');
}

// ─── Coordinate Helpers ───────────────────────────────────────────────────────
function i2p(inches) { return inches * IPX; }
function p2i(px) { return px / IPX; }

// Convert an array of [x,y] inch pairs to pixel {x,y} objects
function inchPointsToPx(pts) {
  return pts.map(([x, y]) => ({ x: i2p(x), y: i2p(y) }));
}

// ─── WTC L-Shape Geometry ─────────────────────────────────────────────────────
// Given four corners (in pixels, clockwise from TL) and a facing compass point,
// returns the 6 polygon points (in pixels) of the L-shape wall footprint.
// The facing indicates which corner of the bounding rect the solid L corner sits in.
//
// corners: [TL, TR, BR, BL] as {x,y} pixel objects (after any rotation, but since
// we store actual grid coords, they come in as axis-aligned for now)
//
// We treat corners[0]=TL, [1]=TR, [2]=BR, [3]=BL.
// facing NW → solid corner at TL (corners[0])
// facing NE → solid corner at TR (corners[1])
// facing SE → solid corner at BR (corners[2])
// facing SW → solid corner at BL (corners[3])

function buildLPolygon(corners, facing, pieceType) {
  const lib = WTC_PIECES[pieceType];
  if (!lib || !lib.armLong) return null;

  // corners in order: provide as [[x,y],...] in inches, we get px here
  const [TL, TR, BR, BL] = corners; // {x,y} in pixels

  // Edge vectors
  const topLen    = dist(TL, TR);
  const leftLen   = dist(TL, BL);

  const t = lib.wallThickness * IPX; // wall thickness in px
  const aL = lib.armLong * IPX;      // arm along long edge
  const aS = lib.armShort * IPX;     // arm along short edge

  // Unit vectors along each edge from the solid corner
  function unitVec(from, to) {
    const d = dist(from, to);
    return { x: (to.x - from.x) / d, y: (to.y - from.y) / d };
  }

  function addVec(pt, vec, len) {
    return { x: pt.x + vec.x * len, y: pt.y + vec.y * len };
  }

  // Determine which corner is solid and the two edges emanating from it
  // longEdge goes along the longer dimension, shortEdge along the shorter
  let solidCorner, longNeighbor, shortNeighbor;

  const isWide = topLen >= leftLen; // true if top edge is the long edge

  switch (facing) {
    case 'NW':
      solidCorner  = TL;
      longNeighbor  = isWide ? TR : BL;
      shortNeighbor = isWide ? BL : TR;
      break;
    case 'NE':
      solidCorner  = TR;
      longNeighbor  = isWide ? TL : BR;
      shortNeighbor = isWide ? BR : TL;
      break;
    case 'SE':
      solidCorner  = BR;
      longNeighbor  = isWide ? BL : TR;
      shortNeighbor = isWide ? TR : BL;
      break;
    case 'SW':
      solidCorner  = BL;
      longNeighbor  = isWide ? BR : TL;
      shortNeighbor = isWide ? TL : BR;
      break;
    default:
      return null;
  }

  const uvLong  = unitVec(solidCorner, longNeighbor);
  const uvShort = unitVec(solidCorner, shortNeighbor);

  // 6 points of the L (clockwise from solid corner):
  // P0: solidCorner
  // P1: along long arm, full length
  // P2: inward by wall thickness
  // P3: back toward solid corner along inner long edge, to where short arm ends
  // P4: inward along short arm at inner depth
  // P5: along short arm, full length from solid corner

  const P0 = solidCorner;
  const P1 = addVec(P0, uvLong, aL);
  const P2 = addVec(P1, uvShort, t);
  const P3 = addVec(P0, uvLong, t); // move along long by wall thickness to find inner corner junction
  const P4 = addVec(P3, uvShort, aS - t); // this completes the inner corner
  const P5 = addVec(P0, uvShort, aS);

  // Hmm — let me use a cleaner formulation:
  // The L shape has an outer path along two arms and an inner concave corner.
  // Outer: solidCorner -> end of long arm -> (turn inward t) -> inner long -> inner corner -> inner short -> end of short arm -> solidCorner

  const outerLongEnd   = addVec(P0, uvLong,  aL);
  const outerShortEnd  = addVec(P0, uvShort, aS);
  const innerLongEnd   = addVec(outerLongEnd,  uvShort, t);
  const innerShortEnd  = addVec(outerShortEnd, uvLong,  t);
  const innerCorner    = addVec(P0, uvLong, t);
  const innerCornerFull = addVec(innerCorner, uvShort, t);

  return [P0, outerLongEnd, innerLongEnd, innerShortEnd, outerShortEnd];
  // Note: this gives a 5-point L (no inner corner detail needed for top-down view)
  // For a cleaner L with visible inner corner:
}

// Cleaner L polygon — 6 points
function buildLPolygonClean(cornersPx, facing, pieceType) {
  const lib = WTC_PIECES[pieceType];
  if (!lib || !lib.armLong) return null;

  const [TL, TR, BR, BL] = cornersPx;
  const topLen  = dist(TL, TR);
  const leftLen = dist(TL, BL);
  const isWide  = topLen >= leftLen;

  const t  = lib.wallThickness * IPX;
  const aL = lib.armLong  * IPX;
  const aS = lib.armShort * IPX;

  function uv(from, to) {
    const d = dist(from, to);
    return { x: (to.x - from.x) / d, y: (to.y - from.y) / d };
  }
  function av(pt, vec, len) {
    return { x: pt.x + vec.x * len, y: pt.y + vec.y * len };
  }

  let C, longN, shortN;
  switch (facing) {
    case 'NW': C = TL; longN = isWide ? TR : BL; shortN = isWide ? BL : TR; break;
    case 'NE': C = TR; longN = isWide ? TL : BR;  shortN = isWide ? BR : TL; break;
    case 'SE': C = BR; longN = isWide ? BL : TR;  shortN = isWide ? TR : BL; break;
    case 'SW': C = BL; longN = isWide ? BR : TL;  shortN = isWide ? TL : BR; break;
    default: return null;
  }

  const uvL = uv(C, longN);
  const uvS = uv(C, shortN);

  // 6 outer points of L walking clockwise from solid corner:
  const p0 = C;                          // solid corner
  const p1 = av(C,  uvL, aL);            // end of long arm (outer)
  const p2 = av(p1, uvS, t);             // end of long arm (inner)
  const p3 = av(av(C, uvL, t), uvS, t);  // inner corner junction
  const p4 = av(av(C, uvS, aS), uvL, t); // end of short arm (inner)
  const p5 = av(C,  uvS, aS);            // end of short arm (outer)

  return [p0, p1, p2, p3, p4, p5];
}

function dist(a, b) {
  return Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
}

// Convert piece corners from inches to px {x,y} objects
// corners stored as [[x,y],[x,y],[x,y],[x,y]] clockwise from TL
function cornersToPx(corners) {
  return corners.map(([x, y]) => ({ x: i2p(x), y: i2p(y) }));
}

// ─── LOS Intersection ─────────────────────────────────────────────────────────
// Test if segment (p1->p2) intersects segment (p3->p4), return t param or null
function segmentIntersect(p1, p2, p3, p4) {
  const d1 = { x: p2.x - p1.x, y: p2.y - p1.y };
  const d2 = { x: p4.x - p3.x, y: p4.y - p3.y };
  const cross = d1.x * d2.y - d1.y * d2.x;
  if (Math.abs(cross) < 1e-10) return null; // parallel
  const t = ((p3.x - p1.x) * d2.y - (p3.y - p1.y) * d2.x) / cross;
  const u = ((p3.x - p1.x) * d1.y - (p3.y - p1.y) * d1.x) / cross;
  if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return t;
  return null;
}

// Given a LOS ray from start to end, find the nearest intersection with all
// WTC terrain piece bounding rectangles. Returns the clipped endpoint.
function clipLosToTerrain(start, end) {
  if (currentTerrainFormat !== 'wtc') return end;

  const layoutData = getWtcLayoutData();
  if (!layoutData || !layoutData.pieces.length) return end;

  let minT = 1;

  layoutData.pieces.forEach(piece => {
    const corners = cornersToPx(piece.corners);
    // Bounding rect edges: TL-TR, TR-BR, BR-BL, BL-TL
    const edges = [
      [corners[0], corners[1]],
      [corners[1], corners[2]],
      [corners[2], corners[3]],
      [corners[3], corners[0]]
    ];
    edges.forEach(([a, b]) => {
      const t = segmentIntersect(start, end, a, b);
      if (t !== null && t > 0.001 && t < minT) minT = t;
    });
  });

  return {
    x: start.x + (end.x - start.x) * minT,
    y: start.y + (end.y - start.y) * minT
  };
}

function getWtcLayoutData() {
  if (!wtcData) return null;
  const layouts = getWtcMissionLayouts();
  if (!layouts) return null;
  return layouts[currentLayoutIndex] || null;
}

// ─── Draw Scene ───────────────────────────────────────────────────────────────
function drawScene() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  drawBackground();
  drawGrid();
  drawDeploymentZones();
  drawObjectives();
  drawTerrain();
  drawUserDrawings();
  drawInProgressPoints();
}

function drawBackground() {
  if (currentTerrainFormat === 'gw') {
    const img = terrainImages[currentLayoutIndex];
    if (img && img.complete && img.naturalWidth > 0) {
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      return;
    }
  }
  // Blank board for WTC / UKTC / GW image not loaded
  ctx.fillStyle = '#1a2030';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function drawGrid() {
  // 1" grid = 15px
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 0.5;
  for (let x = 0; x <= canvas.width; x += IPX) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
  }
  for (let y = 0; y <= canvas.height; y += IPX) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
  }
  // 6" major grid lines slightly brighter
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 0.75;
  for (let x = 0; x <= canvas.width; x += IPX * 6) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
  }
  for (let y = 0; y <= canvas.height; y += IPX * 6) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
  }
}

function drawDeploymentZones() {
  if (!currentMission) return;
  currentMission.zones.forEach(zone => {
    const pts = inchPointsToPx(zone.points);
    ctx.beginPath();
    pts.forEach((pt, i) => i === 0 ? ctx.moveTo(pt.x, pt.y) : ctx.lineTo(pt.x, pt.y));
    ctx.closePath();
    ctx.fillStyle = zone.color;
    ctx.fill();
    ctx.strokeStyle = zone.stroke;
    ctx.lineWidth = 2;
    ctx.stroke();
  });
}

function drawObjectives() {
  if (!currentMission) return;
  currentMission.objectives.forEach(obj => {
    const x = i2p(obj.x);
    const y = i2p(obj.y);
    const r = i2p(3); // 3" objective radius
    ctx.strokeStyle = '#ff3333';
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 6]);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    // Center dot
    ctx.fillStyle = '#ff3333';
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill();
  });
}

function drawTerrain() {
  if (currentTerrainFormat === 'gw') return; // GW uses background image

  let layoutData = null;
  if (currentTerrainFormat === 'wtc') layoutData = getWtcLayoutData();
  else if (currentTerrainFormat === 'uktc' && uktcData) {
    layoutData = uktcData.layouts[currentLayoutIndex] || null;
  }
  if (!layoutData || !layoutData.pieces.length) return;

  layoutData.pieces.forEach(piece => drawTerrainPiece(piece));
}

function drawTerrainPiece(piece) {
  const lib = WTC_PIECES[piece.shape];
  if (!lib) return;

  const cornersPx = cornersToPx(piece.corners);
  const [TL, TR, BR, BL] = cornersPx;

  // Draw bounding rectangle (terrain footprint — used for LOS)
  ctx.beginPath();
  ctx.moveTo(TL.x, TL.y);
  ctx.lineTo(TR.x, TR.y);
  ctx.lineTo(BR.x, BR.y);
  ctx.lineTo(BL.x, BL.y);
  ctx.closePath();
  ctx.fillStyle = lib.fillColor;
  ctx.fill();
  ctx.strokeStyle = lib.strokeColor;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Draw L-shape overlay for ruin types
  if (piece.facing && lib.wallColor) {
    const lPts = buildLPolygonClean(cornersPx, piece.facing, piece.shape);
    if (lPts) {
      ctx.beginPath();
      lPts.forEach((pt, i) => i === 0 ? ctx.moveTo(pt.x, pt.y) : ctx.lineTo(pt.x, pt.y));
      ctx.closePath();
      ctx.fillStyle = lib.wallColor;
      ctx.fill();
      ctx.strokeStyle = lib.strokeColor;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  // Label
  if (lib.label) {
    const cx = (TL.x + TR.x + BR.x + BL.x) / 4;
    const cy = (TL.y + TR.y + BR.y + BL.y) / 4;
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(lib.label, cx, cy);
  }
}

function drawUserDrawings() {
  drawings.forEach(drawing => {
    if (drawing.type === 'unit') drawUnit(drawing);
    else if (drawing.type === 'measure') drawMeasure(drawing);
    else if (drawing.type === 'sight') drawSight(drawing);
    else if (drawing.type === 'label') drawLabel(drawing);
  });
}

function drawUnit(drawing) {
  ctx.strokeStyle = drawing.color;
  ctx.lineWidth = 3;
  ctx.beginPath();
  drawing.points.forEach((pt, i) => i === 0 ? ctx.moveTo(pt.x, pt.y) : ctx.lineTo(pt.x, pt.y));
  ctx.closePath();
  ctx.stroke();

  if (drawing.label) {
    const cx = drawing.points.reduce((s, p) => s + p.x, 0) / drawing.points.length;
    const cy = drawing.points.reduce((s, p) => s + p.y, 0) / drawing.points.length;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    const tw = ctx.measureText(drawing.label).width;
    ctx.fillRect(cx - tw / 2 - 4, cy - 8, tw + 8, 18);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(drawing.label, cx, cy + 1);
  }
}

function drawMeasure(drawing) {
  const { start, end } = drawing;
  ctx.strokeStyle = '#ff8800';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.lineTo(end.x, end.y);
  ctx.stroke();

  const dx = end.x - start.x, dy = end.y - start.y;
  const inches = (Math.sqrt(dx * dx + dy * dy) / IPX).toFixed(1);
  const mx = (start.x + end.x) / 2, my = (start.y + end.y) / 2;

  ctx.fillStyle = 'rgba(0,0,0,0.75)';
  ctx.fillRect(mx - 26, my - 12, 52, 22);
  ctx.fillStyle = '#ff8800';
  ctx.font = 'bold 13px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${inches}"`, mx, my + 1);

  [start, end].forEach(pt => {
    ctx.fillStyle = '#ff8800';
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, 5, 0, Math.PI * 2);
    ctx.fill();
  });
}

function drawSight(drawing) {
  const { start, end } = drawing;
  ctx.strokeStyle = '#00aaff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.lineTo(end.x, end.y);
  ctx.stroke();

  const blocked = end._clipped;
  if (blocked) {
    ctx.fillStyle = '#ff3333';
    ctx.beginPath();
    ctx.arc(end.x, end.y, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 9px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('✕', end.x, end.y);
  }

  [start, end].forEach(pt => {
    ctx.fillStyle = '#00aaff';
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, 5, 0, Math.PI * 2);
    ctx.fill();
  });
}

function drawLabel(drawing) {
  ctx.font = '14px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const tw = ctx.measureText(drawing.text).width;
  ctx.fillStyle = 'rgba(0,0,0,0.8)';
  ctx.fillRect(drawing.x - tw / 2 - 8, drawing.y - 14, tw + 16, 28);
  ctx.fillStyle = '#fff';
  ctx.fillText(drawing.text, drawing.x, drawing.y);
}

function drawInProgressPoints() {
  if (currentPoints.length === 0 || currentTool !== 'draw') return;
  ctx.strokeStyle = currentColor;
  ctx.lineWidth = 2;
  ctx.beginPath();
  currentPoints.forEach((pt, i) => i === 0 ? ctx.moveTo(pt.x, pt.y) : ctx.lineTo(pt.x, pt.y));
  ctx.stroke();
  currentPoints.forEach(pt => {
    ctx.fillStyle = currentColor;
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, 4, 0, Math.PI * 2);
    ctx.fill();
  });
}

// ─── Canvas Event Handlers ────────────────────────────────────────────────────
function getCanvasPoint(e) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) * (canvas.width / rect.width),
    y: (e.clientY - rect.top) * (canvas.height / rect.height)
  };
}

function isPointInUnit(x, y, unit) {
  let inside = false;
  const pts = unit.points;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].x, yi = pts[i].y, xj = pts[j].x, yj = pts[j].y;
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi))
      inside = !inside;
  }
  return inside;
}

function handleMouseDown(e) {
  const { x, y } = getCanvasPoint(e);

  if (currentTool === 'draw') {
    for (let i = drawings.length - 1; i >= 0; i--) {
      if (drawings[i].type === 'unit' && isPointInUnit(x, y, drawings[i])) {
        selectedUnit = i;
        isDragging = true;
        const cx = drawings[i].points.reduce((s, p) => s + p.x, 0) / drawings[i].points.length;
        const cy = drawings[i].points.reduce((s, p) => s + p.y, 0) / drawings[i].points.length;
        dragOffset = { x: x - cx, y: y - cy };
        canvas.style.cursor = 'grabbing';
        return;
      }
    }
    if (currentPoints.length === 0 && !drawingHintShown) showDrawingHint();
    currentPoints.push({ x, y });
    drawScene();

  } else if (currentTool === 'measure') {
    if (measurePoints.length === 0) {
      measurePoints.push({ x, y });
    } else {
      drawings.push({ type: 'measure', start: measurePoints[0], end: { x, y } });
      measurePoints = [];
      drawScene();
    }

  } else if (currentTool === 'sight') {
    if (measurePoints.length === 0) {
      measurePoints.push({ x, y });
    } else {
      const start = measurePoints[0];
      const rawEnd = { x, y };
      const clippedEnd = clipLosToTerrain(start, rawEnd);
      const wasClipped = clippedEnd.x !== rawEnd.x || clippedEnd.y !== rawEnd.y;
      if (wasClipped) clippedEnd._clipped = true;
      drawings.push({ type: 'sight', start, end: clippedEnd });
      measurePoints = [];
      drawScene();
    }

  } else if (currentTool === 'label') {
    const text = prompt('Enter label text:');
    if (text) {
      drawings.push({ type: 'label', x, y, text });
      drawScene();
    }
  }
}

function handleMouseMove(e) {
  const { x, y } = getCanvasPoint(e);

  if (isDragging && selectedUnit !== null) {
    const unit = drawings[selectedUnit];
    const cx = unit.points.reduce((s, p) => s + p.x, 0) / unit.points.length;
    const cy = unit.points.reduce((s, p) => s + p.y, 0) / unit.points.length;
    const dx = x - dragOffset.x - cx;
    const dy = y - dragOffset.y - cy;
    unit.points.forEach(pt => { pt.x += dx; pt.y += dy; });
    drawScene();
    return;
  }

  if (currentTool === 'draw' && !isDragging && currentPoints.length === 0) {
    let over = false;
    for (let i = drawings.length - 1; i >= 0; i--) {
      if (drawings[i].type === 'unit' && isPointInUnit(x, y, drawings[i])) { over = true; break; }
    }
    canvas.style.cursor = over ? 'grab' : 'crosshair';
  }

  if (measurePoints.length === 1 && (currentTool === 'measure' || currentTool === 'sight')) {
    drawScene();
    ctx.strokeStyle = currentTool === 'measure' ? 'rgba(255,136,0,0.5)' : 'rgba(0,170,255,0.5)';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(measurePoints[0].x, measurePoints[0].y);
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

function handleDoubleClick(e) {
  if (currentTool === 'draw' && currentPoints.length > 2) {
    const unitName = document.getElementById('unitName').value || 'Unit';
    drawings.push({ type: 'unit', points: [...currentPoints], color: currentColor, label: unitName });
    currentPoints = [];
    document.getElementById('unitName').value = '';
    drawingHintShown = true;
    hideDrawingHint();
    drawScene();
    updateUnitsList();
  }
}

function handleMouseUp() {
  if (isDragging) {
    isDragging = false;
    selectedUnit = null;
    canvas.style.cursor = 'crosshair';
    drawScene();
  }
}

// ─── Units List ───────────────────────────────────────────────────────────────
function updateUnitsList() {
  const list = document.getElementById('unitsList');
  list.innerHTML = '';
  drawings.forEach((d, i) => {
    if (d.type !== 'unit') return;
    const item = document.createElement('div');
    item.className = 'unit-item';

    const dot = document.createElement('div');
    dot.className = 'unit-color-dot';
    dot.style.backgroundColor = d.color;

    const lbl = document.createElement('span');
    lbl.textContent = d.label || 'Unit';
    lbl.style.flex = '1';

    const del = document.createElement('span');
    del.textContent = '🗑️';
    del.className = 'unit-action-btn';
    del.title = 'Delete';
    del.onclick = ev => {
      ev.stopPropagation();
      if (confirm(`Delete "${d.label || 'Unit'}"?`)) {
        drawings.splice(i, 1);
        drawScene();
        updateUnitsList();
      }
    };

    item.appendChild(dot);
    item.appendChild(lbl);
    item.appendChild(del);
    item.onclick = ev => {
      if (ev.target === del) return;
      const n = prompt('Edit unit name:', d.label || 'Unit');
      if (n !== null && n.trim()) { drawings[i].label = n.trim(); drawScene(); updateUnitsList(); }
    };
    list.appendChild(item);
  });
}

// ─── Hints ────────────────────────────────────────────────────────────────────
function showDrawingHint() {
  if (hintElement) return;
  const wrapper = document.getElementById('canvasWrapper');
  hintElement = document.createElement('div');
  hintElement.className = 'drawing-hint';
  hintElement.textContent = '👆 Click to add points — Double-click to finish unit';
  wrapper.appendChild(hintElement);
}

function hideDrawingHint() {
  if (hintElement) { hintElement.remove(); hintElement = null; }
}

// ─── Save / Load ──────────────────────────────────────────────────────────────
function savePlan() {
  const plan = {
    version: 2,
    mission: currentMission?.id,
    terrainFormat: currentTerrainFormat,
    layoutIndex: currentLayoutIndex,
    drawings
  };
  const blob = new Blob([JSON.stringify(plan, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const ts = new Date().toISOString().slice(0, 10);
  a.download = `tacticaldropz-${currentMission?.id || 'plan'}-${ts}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function loadPlan() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.onchange = e => {
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const plan = JSON.parse(ev.target.result);
        if (plan.mission) selectMission(plan.mission);
        if (plan.terrainFormat) {
          currentTerrainFormat = plan.terrainFormat;
          document.getElementById('terrainFormatSelect').value = plan.terrainFormat;
          populateLayoutDropdown();
        }
        if (plan.layoutIndex !== undefined) {
          currentLayoutIndex = plan.layoutIndex;
          document.getElementById('layoutSelect').value = plan.layoutIndex;
        }
        drawings = plan.drawings || [];
        drawScene();
        updateUnitsList();
      } catch (err) {
        alert('Error loading plan: ' + err.message);
      }
    };
    reader.readAsText(e.target.files[0]);
  };
  input.click();
}

// ─── Clear ────────────────────────────────────────────────────────────────────
function clearCanvas() {
  if (confirm('Clear all drawings?')) {
    drawings = [];
    currentPoints = [];
    measurePoints = [];
    drawingHintShown = false;
    hideDrawingHint();
    drawScene();
    updateUnitsList();
  }
}

// ─── Resize ───────────────────────────────────────────────────────────────────
function resizeCanvas() {
  const wrapper = document.getElementById('canvasWrapper');
  const W = wrapper.clientWidth - 40;
  const H = wrapper.clientHeight - 40;
  const ratio = 900 / 720;
  if (W / H > ratio) {
    canvas.style.height = H + 'px';
    canvas.style.width = (H * ratio) + 'px';
  } else {
    canvas.style.width = W + 'px';
    canvas.style.height = (W / ratio) + 'px';
  }
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
window.addEventListener('resize', () => { resizeCanvas(); drawScene(); });
init();
