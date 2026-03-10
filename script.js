// ─── Modal System ─────────────────────────────────────────────────────────────
function showModal({ title, body, input, inputValue, inputPlaceholder, buttons }) {
  return new Promise(resolve => {
    const overlay   = document.getElementById('modalOverlay');
    const titleEl   = document.getElementById('modalTitle');
    const bodyEl    = document.getElementById('modalBody');
    const inputEl   = document.getElementById('modalInput');
    const actionsEl = document.getElementById('modalActions');

    titleEl.innerHTML  = title || '';
    bodyEl.innerHTML   = body  || '';
    actionsEl.innerHTML = '';

    if (input) {
      inputEl.style.display = 'block';
      inputEl.value         = inputValue || '';
      inputEl.placeholder   = inputPlaceholder || '';
      setTimeout(() => { inputEl.focus(); inputEl.select(); }, 50);
    } else {
      inputEl.style.display = 'none';
    }

    buttons.forEach(btn => {
      const el = document.createElement('button');
      el.textContent = btn.label;
      el.className   = `modal-btn ${btn.style || 'modal-btn-secondary'}`;
      el.onclick = () => {
        overlay.style.display = 'none';
        resolve(btn.value !== undefined ? btn.value : (input ? inputEl.value : null));
      };
      actionsEl.appendChild(el);
    });

    inputEl.onkeydown = e => {
      if (e.key === 'Enter') {
        const primary = buttons.find(b => b.style === 'modal-btn-primary');
        if (primary) { overlay.style.display = 'none'; resolve(input ? inputEl.value : primary.value); }
      }
      if (e.key === 'Escape') { overlay.style.display = 'none'; resolve(null); }
    };

    overlay.style.display = 'flex';
  });
}

function modalConfirm(title, body, confirmLabel = 'Confirm', danger = false) {
  return showModal({ title, body, buttons: [
    { label: 'Cancel',      style: 'modal-btn-secondary', value: false },
    { label: confirmLabel,  style: danger ? 'modal-btn-danger' : 'modal-btn-primary', value: true }
  ]});
}

function modalPrompt(title, body, defaultValue = '', placeholder = '') {
  return showModal({ title, body, input: true, inputValue: defaultValue, inputPlaceholder: placeholder,
    buttons: [
      { label: 'Cancel', style: 'modal-btn-secondary', value: null },
      { label: 'OK',     style: 'modal-btn-primary' }
    ]});
}

function modalAlert(title, body) {
  return showModal({ title, body, buttons: [
    { label: 'OK', style: 'modal-btn-primary', value: true }
  ]});
}

function showModelsHelp() {
  showModal({
    title: '🪖 Place Models — How to Use',
    body: `
      <h4>Placing a group</h4>
      <ul>
        <li>Select base size and model count in the toolbar</li>
        <li>Switch to <strong>Place Models</strong> tool</li>
        <li><span class="shortcut">Click</span> empty space to drop a group</li>
      </ul>
      <h4>Selecting &amp; moving</h4>
      <ul>
        <li><span class="shortcut">Click</span> a base to select it (deselects others)</li>
        <li><span class="shortcut">Ctrl + click</span> to add/remove a base from selection</li>
        <li><span class="shortcut">Drag</span> a selected base to move the whole selection</li>
        <li><span class="shortcut">Click empty space</span> to deselect and exit edit mode</li>
      </ul>
      <h4>Editing</h4>
      <ul>
        <li><span class="shortcut">Right-click</span> a base (in edit mode) to remove it</li>
      </ul>
      <h4>Cohesion</h4>
      <ul>
        <li><span style="color:#64dc64">■</span> Green lines = all bases within 2" cohesion</li>
        <li><span style="color:#ff5050">■</span> Red lines = one or more bases out of cohesion</li>
      </ul>`,
    buttons: [{ label: 'Got it', style: 'modal-btn-primary', value: true }]
  });
}

// ─── Place Models State ───────────────────────────────────────────────────────
// Base sizes in inches (diameter)
// Each entry: { w, h } in mm. Ovals have w != h.
const BASE_SIZES = [
  { key:'25',     w:25,  h:25  },
  { key:'28',     w:28,  h:28  },
  { key:'32',     w:32,  h:32  },
  { key:'40',     w:40,  h:40  },
  { key:'50',     w:50,  h:50  },
  { key:'60',     w:60,  h:60  },
  { key:'60x35',  w:60,  h:35  },
  { key:'70',     w:70,  h:70  },
  { key:'75x42',  w:75,  h:42  },
  { key:'80',     w:80,  h:80  },
  { key:'90',     w:90,  h:90  },
  { key:'90x52',  w:90,  h:52  },
  { key:'100',    w:100, h:100 },
  { key:'105x70', w:105, h:70  },
  { key:'120x92', w:120, h:92  },
  { key:'130',    w:130, h:130 },
  { key:'150x95', w:150, h:95  },
  { key:'160',    w:160, h:160 },
  { key:'170x105',w:170, h:105 },
];
function getBaseSize(key) {
  return BASE_SIZES.find(b => b.key === key) || { w:32, h:32 };
}
function mmToIn(mm) { return mm / 25.4; }
function mmToPx(mm) { return mmToIn(mm) * IPX; }

// A "modelGroup" drawing: { type:'modelGroup', label, color, bases:[{x,y}], baseSizeKey, baseRotation, locked }
// bases are CENTER positions in canvas pixels

let modelsSelectedBases = new Set(); // indices into the active modelGroup being edited
let modelsEditingIndex  = null;      // drawings[] index of group in edit mode
let modelsDragStart     = null;      // {x,y} canvas point where drag started
let modelsDragging      = false;

function updateRotationVisibility() {
  const key = document.getElementById('baseSize')?.value || '';
  const isOval = key.includes('x');
  const rotEl = document.getElementById('baseRotation');
  if (rotEl) {
    rotEl.style.display = isOval ? 'inline-block' : 'none';
    if (!isOval) rotEl.value = '0';
  }
}

function setModelCount(n) {
  document.getElementById('modelCount').value = n;
  // highlight quick-select buttons
  document.querySelectorAll('.count-btn').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.textContent) === n);
  });
}

function buildModelGrid(centerX, centerY, count, wPx, hPx) {
  const gap   = 2;
  const stepX = wPx + gap;
  const stepY = hPx + gap;
  const cols  = Math.ceil(Math.sqrt(count));
  const rows  = Math.ceil(count / cols);
  const startX = centerX - (cols * stepX - gap) / 2 + wPx / 2;
  const startY = centerY - (rows * stepY - gap) / 2 + hPx / 2;
  const bases = [];
  for (let i = 0; i < count; i++) {
    bases.push({ x: startX + (i % cols) * stepX, y: startY + Math.floor(i / cols) * stepY });
  }
  return bases;
}

function getBaseAtPoint(group, x, y) {
  const sz  = getBaseSize(group.baseSizeKey || String(group.baseSizeMm || 32));
  const rot = (group.baseRotation || 0) * Math.PI / 180;
  const rw  = mmToPx(sz.w) / 2;
  const rh  = mmToPx(sz.h) / 2;
  for (let i = group.bases.length - 1; i >= 0; i--) {
    const b  = group.bases[i];
    const dx = x - b.x, dy = y - b.y;
    // Rotate point into base-local space
    const lx = dx * Math.cos(-rot) - dy * Math.sin(-rot);
    const ly = dx * Math.sin(-rot) + dy * Math.cos(-rot);
    if ((lx*lx)/(rw*rw) + (ly*ly)/(rh*rh) <= 1) return i;
  }
  return -1;
}

function checkCohesion(group) {
  const sz  = getBaseSize(group.baseSizeKey || String(group.baseSizeMm || 32));
  const cohesionPx = 2 * IPX + mmToPx(Math.max(sz.w, sz.h));
  return group.bases.every((b, i) =>
    group.bases.some((b2, j) => j !== i && Math.hypot(b.x - b2.x, b.y - b2.y) <= cohesionPx)
  );
}

function drawModelGroup(group, isEditing) {
  const sz  = getBaseSize(group.baseSizeKey || String(group.baseSizeMm || 32));
  const rw  = mmToPx(sz.w) / 2;
  const rh  = mmToPx(sz.h) / 2;
  const rot = (group.baseRotation || 0) * Math.PI / 180;
  const inCohesion = group.bases.length <= 1 || checkCohesion(group);
  const ringColor  = inCohesion ? 'rgba(100,220,100,0.7)' : 'rgba(255,80,80,0.8)';

  group.bases.forEach((b, i) => {
    const isSelected = isEditing && modelsSelectedBases.has(i);

    // Base fill
    ctx.beginPath();
    ctx.ellipse(b.x, b.y, rw, rh, rot, 0, Math.PI * 2);
    ctx.fillStyle = group.color + (isSelected ? 'ff' : 'aa');
    ctx.fill();

    // Base stroke
    ctx.strokeStyle = isSelected ? '#fff' : group.color;
    ctx.lineWidth   = isSelected ? 2.5 : 1.5;
    ctx.stroke();
  });

  // Cohesion ring — convex hull approximation: just draw lines between nearest neighbors
  if (group.bases.length > 1) {
    ctx.strokeStyle = ringColor;
    ctx.lineWidth   = 1.5;
    ctx.setLineDash([4, 3]);
    group.bases.forEach((b, i) => {
      // Find nearest neighbor
      let minD = Infinity, nearest = null;
      group.bases.forEach((b2, j) => {
        if (j === i) return;
        const d = Math.hypot(b.x - b2.x, b.y - b2.y);
        if (d < minD) { minD = d; nearest = b2; }
      });
      if (nearest) {
        ctx.beginPath();
        ctx.moveTo(b.x, b.y);
        ctx.lineTo(nearest.x, nearest.y);
        ctx.stroke();
      }
    });
    ctx.setLineDash([]);
  }

  // Label (center of mass)
  if (group.label) {
    const cx = group.bases.reduce((s, b) => s + b.x, 0) / group.bases.length;
    const cy = group.bases.reduce((s, b) => s + b.y, 0) / group.bases.length;
    const minY = Math.min(...group.bases.map(b => b.y)) - Math.max(rw,rh) - 14;
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const tw = ctx.measureText(group.label).width;
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillRect(cx - tw / 2 - 5, minY - 9, tw + 10, 18);
    ctx.fillStyle = group.color;
    ctx.fillText(group.label, cx, minY);
  }

  // Edit mode indicator
  if (isEditing) {
    const minX = Math.min(...group.bases.map(b => b.x)) - Math.max(rw,rh) - 6;
    const minY2 = Math.min(...group.bases.map(b => b.y)) - Math.max(rw,rh) - 6;
    const maxX = Math.max(...group.bases.map(b => b.x)) + Math.max(rw,rh) + 6;
    const maxY2 = Math.max(...group.bases.map(b => b.y)) + Math.max(rw,rh) + 6;
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(minX, minY2, maxX - minX, maxY2 - minY2);
    ctx.setLineDash([]);
  }
}

// ─── Constants ────────────────────────────────────────────────────────────────
const IPX = 15; // inches to pixels: 1" = 15px
// Board: 60" x 44" = 900px x 660px

// Sort an array of 4 {x,y} corner points geometrically into [TL, TR, BR, BL]
// ─── State ────────────────────────────────────────────────────────────────────
const canvas = document.getElementById('battlefield');
const ctx = canvas.getContext('2d');

let currentTool = 'draw';
let currentColor = '#00ff00';
let currentMission = null;
let currentTerrainFormat = 'gw'; // 'gw' | 'wtc' | 'uktc'
let currentLayoutIndex = 0;

let deployments = [];

let drawings = [];
let currentPoints = [];
let measurePoints = [];
let drawingHintShown = false;
let hintElement = null;

let selectedUnit = null;
let isDragging = false;
let dragOffset = { x: 0, y: 0 };

// GW terrain images
const terrainImages = [];
let gwImagesLoaded = 0;

// WTC terrain image (loaded on demand)
let wtcImage    = null;
let wtcImageSrc = null;
let hiddenSupplies = false;

function loadWtcImage() {
  if (currentTerrainFormat !== 'wtc' || !currentMission) { wtcImage = null; drawScene(); return; }
  const missionId = currentMission.id;
  const layout    = currentLayoutIndex + 1;
  const suffix    = hiddenSupplies ? 'HS' : '';
  const src       = `layouts/wtc/${missionId}/${layout}${suffix}.png`;
  if (src === wtcImageSrc && wtcImage) { drawScene(); return; }
  wtcImageSrc = src;
  wtcImage    = null;
  const img   = new Image();
  img.onload  = () => { wtcImage = img; drawScene(); };
  img.onerror = () => {
    if (hiddenSupplies) {
      const fbSrc = `layouts/wtc/${missionId}/${layout}.png`;
      const fb = new Image();
      fb.onload  = () => { wtcImage = fb; wtcImageSrc = fbSrc; drawScene(); };
      fb.onerror = () => { wtcImage = null; drawScene(); };
      fb.src = fbSrc;
    } else { wtcImage = null; drawScene(); }
  };
  img.src = src;
}

function updateHsToggleVisibility() {
  const hsWrapper = document.getElementById('hsToggleWrapper');
  if (!hsWrapper) return;
  const show = currentTerrainFormat === 'wtc' && currentMission?.id === 'hammerAnvil';
  hsWrapper.style.display = show ? 'flex' : 'none';
  if (!show) {
    hiddenSupplies = false;
    const cb = document.getElementById('hiddenSuppliesToggle');
    if (cb) cb.checked = false;
  }
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
async function init() {
  await loadDeployments();
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
        points: [[0,0],[12,0],[12,22],[20,22],[20,44],[0,44]] },
      { player: 2, color: 'rgba(78,205,196,0.25)', stroke: 'rgba(78,205,196,0.6)',
        points: [[40,0],[60,0],[60,44],[48,44],[48,22],[40,22]] }
    ],
    objectives: [{x:22,y:10},{x:30,y:24},{x:38,y:38},{x:14,y:34},{x:46,y:14}]
  },
  {
    id: 'hammerAnvil', name: 'Hammer and Anvil',
    zones: [
      { player: 1, color: 'rgba(255,107,107,0.25)', stroke: 'rgba(255,107,107,0.6)',
        points: [[0,0],[18,0],[18,44],[0,44]] },
      { player: 2, color: 'rgba(78,205,196,0.25)', stroke: 'rgba(78,205,196,0.6)',
        points: [[42,0],[60,0],[60,44],[42,44]] }
    ],
    objectives: [{x:30,y:6},{x:30,y:24},{x:30,y:42},{x:10,y:24},{x:50,y:24}]
  },
  {
    id: 'searchDestroy', name: 'Search and Destroy',
    zones: [
      { player: 1, color: 'rgba(255,107,107,0.25)', stroke: 'rgba(255,107,107,0.6)',
        points: [[30,0],[60,0],[60,22],[39,22],[30,14]] },
      { player: 2, color: 'rgba(78,205,196,0.25)', stroke: 'rgba(78,205,196,0.6)',
        points: [[0,22],[21,22],[30,30],[30,44],[0,44]] }
    ],
    objectives: [{x:14,y:10},{x:14,y:38},{x:30,y:24},{x:46,y:10},{x:46,y:38}]
  },
  {
    id: 'crucibleBattle', name: 'Crucible of Battle',
    zones: [
      { player: 1, color: 'rgba(255,107,107,0.25)', stroke: 'rgba(255,107,107,0.6)',
        points: [[0,0],[30,44],[0,44]] },
      { player: 2, color: 'rgba(78,205,196,0.25)', stroke: 'rgba(78,205,196,0.6)',
        points: [[30,0],[60,0],[60,44]] }
    ],
    objectives: [{x:20,y:8},{x:30,y:24},{x:40,y:40},{x:14,y:38},{x:46,y:10}]
  },
  {
    id: 'sweepingEngage', name: 'Sweeping Engagement',
    zones: [
      { player: 1, color: 'rgba(255,107,107,0.25)', stroke: 'rgba(255,107,107,0.6)',
        points: [[0,0],[60,0],[60,13],[30,13],[30,7],[0,7]] },
      { player: 2, color: 'rgba(78,205,196,0.25)', stroke: 'rgba(78,205,196,0.6)',
        points: [[0,31],[30,31],[30,37],[60,37],[60,44],[0,44]] }
    ],
    objectives: [{x:10,y:18},{x:30,y:24},{x:50,y:30},{x:42,y:6},{x:18,y:42}]
  },
  {
    id: 'dawnWar', name: 'Dawn of War',
    zones: [
      { player: 1, color: 'rgba(255,107,107,0.25)', stroke: 'rgba(255,107,107,0.6)',
        points: [[0,0],[60,0],[60,11],[0,11]] },
      { player: 2, color: 'rgba(78,205,196,0.25)', stroke: 'rgba(78,205,196,0.6)',
        points: [[0,33],[60,33],[60,44],[0,44]] }
    ],
    objectives: [{x:10,y:24},{x:30,y:24},{x:50,y:24},{x:30,y:6},{x:30,y:42}]
  }
];

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

  // Hidden Supplies toggle (WTC + Hammer & Anvil only)
  const hsWrapper = document.createElement('label');
  hsWrapper.id = 'hsToggleWrapper';
  hsWrapper.style.cssText = 'display:none; align-items:center; gap:6px; cursor:pointer; font-size:13px; color:#aaa; white-space:nowrap;';
  const hsCb = document.createElement('input');
  hsCb.type = 'checkbox';
  hsCb.id   = 'hiddenSuppliesToggle';
  hsCb.style.cssText = 'width:15px; height:15px; cursor:pointer; accent-color:#e94560;';
  hsCb.onchange = () => { hiddenSupplies = hsCb.checked; loadWtcImage(); };
  const hsLbl = document.createElement('span');
  hsLbl.textContent = 'Hidden Supplies';
  hsWrapper.appendChild(hsCb);
  hsWrapper.appendChild(hsLbl);
  nav.appendChild(hsWrapper);

  // About link
  const about = document.createElement('a');
  about.href = 'about.html';
  about.className = 'nav-link';
  about.textContent = 'About/Help';
  nav.appendChild(about);

  // Feedback link
  const feedback = document.createElement('a');
  feedback.href = 'mailto:nwimmer123@yahoo.com?subject=TacticalDropz Feedback';
  feedback.className = 'nav-link';
  feedback.textContent = '📧 Feedback';
  nav.appendChild(feedback);
}

function populateLayoutDropdown() {
  const sel = document.getElementById('layoutSelect');
  sel.innerHTML = '';
  for (let i = 1; i <= 8; i++) {
    const o = document.createElement('option');
    o.value = i - 1;
    o.textContent = `Layout ${i}`;
    sel.appendChild(o);
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
  canvas.addEventListener('contextmenu', e => e.preventDefault());
}

// ─── Selection Handlers ───────────────────────────────────────────────────────
function selectTerrainFormat(format) {
  currentTerrainFormat = format;
  currentLayoutIndex = 0;
  if (format !== 'wtc') { wtcImage = null; wtcImageSrc = null; }
  populateLayoutDropdown();
  updateHsToggleVisibility();
  if (format === 'wtc') loadWtcImage();
  else drawScene();
}

function selectLayout(index) {
  currentLayoutIndex = index;
  if (currentTerrainFormat === 'wtc') loadWtcImage();
  else drawScene();
}

function selectMission(id) {
  currentMission = deployments.find(d => d.id === id);
  document.querySelectorAll('.deploy-option').forEach(o => {
    o.classList.toggle('active', o.dataset.id === id);
  });
  updateHsToggleVisibility();
  if (currentTerrainFormat === 'wtc') { populateLayoutDropdown(); loadWtcImage(); }
  else drawScene();
}

function selectTool(tool) {
  // Toggle off if clicking the already-active tool (except draw, which is default)
  if (currentTool === tool && tool !== 'draw') {
    tool = 'draw';
  }
  currentTool = tool;
  currentPoints = [];
  measurePoints = [];
  // Exit model edit mode when switching away
  if (tool !== 'models') {
    modelsEditingIndex = null;
    modelsSelectedBases.clear();
  }
  hideDrawingHint();
  document.querySelectorAll('[data-tool]').forEach(b => b.classList.remove('active'));
  const btn = document.querySelector(`[data-tool="${tool}"]`);
  if (btn) btn.classList.add('active');
  // Show hint for models tool
  if (tool === 'models') {
    showDrawingHint('🪖 Click to place models · Click base to select · Ctrl+click multi-select · Drag to move');
  }
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

// Convert an array of [x,y] inch pairs to pixel {x,y} objects
function inchPointsToPx(pts) {
  return pts.map(([x, y]) => ({ x: i2p(x), y: i2p(y) }));
}


// ─── Draw Scene ───────────────────────────────────────────────────────────────
function drawScene() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  drawBackground();
  drawGrid();
  drawDeploymentZones();
  drawObjectives();
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
  if (currentTerrainFormat === 'wtc' && wtcImage) {
    ctx.drawImage(wtcImage, 0, 0, canvas.width, canvas.height);
    return;
  }
  // Blank board
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
    ctx.beginPath();
    zone.points.forEach((pt, i) => {
      if (pt.arc) {
        const cx = i2p(pt.cx), cy = i2p(pt.cy), r = i2p(pt.r);
        const start = pt.startAngle * Math.PI / 180;
        const end   = pt.endAngle   * Math.PI / 180;
        ctx.arc(cx, cy, r, start, end, pt.ccw || false);
      } else {
        const x = i2p(pt[0]), y = i2p(pt[1]);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
    });
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
  if (currentTerrainFormat === 'wtc' && wtcImage) return;
  // 40mm base = 1.57" radius. Zone extends 3" from base edge = 4.57" total radius.
  const zoneR  = i2p(40 / 25.4 / 2 + 3); // ~4.57"
  const baseR  = i2p(40 / 25.4 / 2);      // ~0.79" (40mm model base)

  currentMission.objectives.forEach(obj => {
    const x = i2p(obj.x);
    const y = i2p(obj.y);

    // Outer zone — dashed red circle
    ctx.strokeStyle = '#ff3333';
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 6]);
    ctx.beginPath();
    ctx.arc(x, y, zoneR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // 40mm base — solid filled circle
    ctx.fillStyle = 'rgba(255,51,51,0.25)';
    ctx.beginPath();
    ctx.arc(x, y, baseR, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ff3333';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y, baseR, 0, Math.PI * 2);
    ctx.stroke();

    // Center dot
    ctx.fillStyle = '#ff3333';
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
  });
}


function drawUserDrawings() {
  drawings.forEach((drawing, i) => {
    if      (drawing.type === 'unit')       drawUnit(drawing);
    else if (drawing.type === 'measure')    drawMeasure(drawing);
    else if (drawing.type === 'sight')      drawSight(drawing);
    else if (drawing.type === 'label')      drawLabel(drawing);
    else if (drawing.type === 'modelGroup') drawModelGroup(drawing, i === modelsEditingIndex);
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

function clipLosToTerrain(start, end) { return end; }

function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq > 0 ? ((px - ax) * dx + (py - ay) * dy) / lenSq : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function handleMouseDown(e) {
  const { x, y } = getCanvasPoint(e);

  // Right-click on measure/sight/label: delete it
  if (e.button === 2 && (currentTool === 'measure' || currentTool === 'sight' || currentTool === 'label')) {
    for (let i = drawings.length - 1; i >= 0; i--) {
      const d = drawings[i];
      let hit = false;
      if ((d.type === 'measure' || d.type === 'sight') && d.start && d.end) {
        hit = distToSegment(x, y, d.start.x, d.start.y, d.end.x, d.end.y) < 10;
      } else if (d.type === 'label') {
        hit = Math.hypot(x - d.x, y - d.y) < 20;
      }
      if (hit) {
        drawings.splice(i, 1);
        measurePoints = [];
        drawScene();
        return;
      }
    }
    return;
  }

  if (currentTool === 'draw') {
    // Right-click: remove last in-progress point, or cancel if none
    if (e.button === 2) {
      if (currentPoints.length > 0) {
        currentPoints.pop();
        drawScene();
      }
      return;
    }
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
    modalPrompt('Add Label', 'Enter label text:', '', 'Label text...').then(text => {
      if (text && text.trim()) {
        drawings.push({ type: 'label', x, y, text: text.trim() });
        drawScene();
      }
    });

  } else if (currentTool === 'models') {
    handleModelsMouseDown(e, x, y);
  }
}

function handleModelsMouseDown(e, x, y) {

  // Right-click in edit mode: remove base
  if (e.button === 2 && modelsEditingIndex !== null) {
    const group = drawings[modelsEditingIndex];
    const bi = getBaseAtPoint(group, x, y);
      if (bi >= 0) {
      group.bases.splice(bi, 1);
      modelsSelectedBases.clear();
      if (group.bases.length === 0) {
        drawings.splice(modelsEditingIndex, 1);
        modelsEditingIndex = null;
      }
      drawScene();
      updateUnitsList();
    }
    return;
  }
  if (e.button !== 0) return;

  // Check if clicking on any modelGroup base
  for (let gi = drawings.length - 1; gi >= 0; gi--) {
    const d = drawings[gi];
    if (d.type !== 'modelGroup') continue;
    const bi = getBaseAtPoint(d, x, y);
      if (bi >= 0) {
      if (modelsEditingIndex !== gi) {
              modelsEditingIndex = gi;
        modelsSelectedBases = new Set([bi]);
        modelsDragStart = null;
      } else if (e.ctrlKey || e.metaKey) {
              if (modelsSelectedBases.has(bi)) modelsSelectedBases.delete(bi);
        else modelsSelectedBases.add(bi);
        modelsDragStart = null;
      } else if (modelsSelectedBases.has(bi)) {
              modelsDragStart = { x, y };
        modelsDragging  = false;
      } else {
              modelsSelectedBases = new Set([bi]);
        modelsDragStart = null;
      }
      drawScene();
      return;
    }
  }

  // Clicked empty space
  if (modelsEditingIndex !== null) {
      modelsEditingIndex = null;
    modelsSelectedBases.clear();
    drawScene();
    updateUnitsList();
  } else {
      placeModelGroup(x, y);
  }
}

function placeModelGroup(x, y) {
  const sizeKey = document.getElementById('baseSize').value;
  const sz      = getBaseSize(sizeKey);
  const rot     = parseInt(document.getElementById('baseRotation')?.value || '0');
  const count   = parseInt(document.getElementById('modelCount').value) || 1;
  const wPx = mmToPx(rot === 90 ? sz.h : sz.w);
  const hPx = mmToPx(rot === 90 ? sz.w : sz.h);
  const bases  = buildModelGrid(x, y, count, wPx, hPx);
  const label  = document.getElementById('unitName').value || 'Unit';
  const group  = { type: 'modelGroup', label, color: currentColor, baseSizeKey: sizeKey, baseRotation: rot, bases };
  drawings.push(group);
  modelsEditingIndex = drawings.length - 1;
  modelsSelectedBases = new Set(bases.map((_, i) => i));
  modelsDragStart = null;
  drawScene();
  updateUnitsList();
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

  // Models tool drag
  if (currentTool === 'models' && modelsDragStart && modelsEditingIndex !== null && modelsSelectedBases.size > 0) {
    const dx = x - modelsDragStart.x;
    const dy = y - modelsDragStart.y;
    if (!modelsDragging && Math.hypot(dx, dy) > 3) modelsDragging = true;
    if (modelsDragging) {
      const group = drawings[modelsEditingIndex];
      modelsSelectedBases.forEach(bi => {
        group.bases[bi].x += dx;
        group.bases[bi].y += dy;
      });
      modelsDragStart = { x, y };
      drawScene();
    }
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
  if (modelsDragStart) {
    modelsDragStart = null;
    modelsDragging  = false;
  }
}

// ─── Units List ───────────────────────────────────────────────────────────────
function updateUnitsList() {
  const list = document.getElementById('unitsList');
  if (!list) { console.error('[Units] unitsList element not found!'); return; }
  list.innerHTML = '';
  drawings.forEach((d, i) => {
    if (d.type !== 'unit' && d.type !== 'modelGroup') return;
      const item = document.createElement('div');
    item.className = 'unit-item';

    const dot = document.createElement('div');
    dot.className = 'unit-color-dot';
    dot.style.backgroundColor = d.color;

    const lbl = document.createElement('span');
    const suffix = d.type === 'modelGroup' ? ` (${d.bases.length}×${d.baseSizeKey || (d.baseSizeMm + 'mm')})` : '';
    lbl.textContent = (d.label || 'Unit') + suffix;
    lbl.style.flex = '1';
    lbl.style.fontSize = '12px';

    const del = document.createElement('span');
    del.textContent = '🗑️';
    del.className = 'unit-action-btn';
    del.title = 'Delete';
    del.onclick = ev => {
      ev.stopPropagation();
      modalConfirm('Delete Unit', `Delete "${d.label || 'Unit'}"?`, 'Delete', true).then(ok => {
        if (ok) {
          if (modelsEditingIndex === i) { modelsEditingIndex = null; modelsSelectedBases.clear(); }
          drawings.splice(i, 1);
          drawScene();
          updateUnitsList();
        }
      });
    };

    item.appendChild(dot);
    item.appendChild(lbl);
    item.appendChild(del);
    item.onclick = ev => {
      if (ev.target === del) return;
      modalPrompt('Edit Unit', 'Enter unit name:', d.label || 'Unit', 'Unit name...').then(n => {
        if (n !== null && n.trim()) { drawings[i].label = n.trim(); drawScene(); updateUnitsList(); }
      });
    };
    list.appendChild(item);
  });
}

// ─── Hints ────────────────────────────────────────────────────────────────────
function showDrawingHint(text) {
  const wrapper = document.getElementById('canvasWrapper');
  if (!hintElement) {
    hintElement = document.createElement('div');
    hintElement.className = 'drawing-hint';
    wrapper.appendChild(hintElement);
  }
  hintElement.textContent = text || '👆 Click to add points — Double-click to finish unit';
}

function hideDrawingHint() {
  if (hintElement) { hintElement.remove(); hintElement = null; }
}

function updateHintForTool() {
  hideDrawingHint();
  if (currentTool === 'models') {
    showDrawingHint('🪖 Click to place models · Click base to select · Ctrl+click multi-select · Drag to move');
  }
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
        modalAlert('Error Loading Plan', err.message);
      }
    };
    reader.readAsText(e.target.files[0]);
  };
  input.click();
}

// ─── Clear ────────────────────────────────────────────────────────────────────
function clearCanvas() {
  modalConfirm('Clear Board', 'Remove all drawings from the board?', 'Clear', true).then(ok => {
    if (ok) {
      drawings = [];
      currentPoints = [];
      measurePoints = [];
      modelsEditingIndex = null;
      modelsSelectedBases.clear();
      drawingHintShown = false;
      hideDrawingHint();
      drawScene();
      updateUnitsList();
    }
  });
}

// ─── Resize ───────────────────────────────────────────────────────────────────
function resizeCanvas() {
  const wrapper = document.getElementById('canvasWrapper');
  const W = wrapper.clientWidth - 40;
  const H = wrapper.clientHeight - 40;
  const ratio = 900 / 660;
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
