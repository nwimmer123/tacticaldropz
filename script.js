// ─── API Config ───────────────────────────────────────────────────────────────
const API_URL = 'https://7mszujxl65.execute-api.us-west-2.amazonaws.com/prod';

async function apiCall(method, path, body = null, requiresAuth = false) {
  const headers = { 'Content-Type': 'application/json' };
  if (requiresAuth) {
    const token = localStorage.getItem('td_access_token');
    if (!token) throw new Error('Not authenticated');
    headers['Authorization'] = token;
  }
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// ─── Auth State ───────────────────────────────────────────────────────────────
let currentUser = null; // { userId, email, subscriptionStatus, displayName }

function isLoggedIn()  { return !!currentUser; }
function isPro()       { return currentUser?.subscriptionStatus === 'pro' || currentUser?.subscriptionStatus === 'pro_trial'; }
function getToken()    { return localStorage.getItem('td_access_token'); }

async function loadCurrentUser() {
  const token = localStorage.getItem('td_access_token');
  if (!token) { console.log('[Auth] No token found'); return; }
  try {
    const user = await apiCall('GET', '/users/profile', null, true);
    currentUser = user;
    console.log('[Auth] Logged in as:', user.email, '| Status:', user.subscriptionStatus);
  } catch (e) {
    console.log('[Auth] Token invalid, clearing:', e.message);
    localStorage.removeItem('td_access_token');
    localStorage.removeItem('td_refresh_token');
    currentUser = null;
  }
}

function logout() {
  localStorage.removeItem('td_access_token');
  localStorage.removeItem('td_refresh_token');
  currentUser = null;
  updateNavAuth();
  updateSaveLoadButtons();
}

// ─── Auth Modal ───────────────────────────────────────────────────────────────
let _pendingVerifyEmail = null;

function openAuthModal(tab = 'login') {
  document.getElementById('authModalOverlay').style.display = 'flex';
  switchAuthTab(tab);
  clearAuthError();
}

function closeAuthModal() {
  document.getElementById('authModalOverlay').style.display = 'none';
  clearAuthError();
  _pendingVerifyEmail = null;
}

function switchAuthTab(tab) {
  document.getElementById('loginForm').style.display  = tab === 'login'  ? 'block' : 'none';
  document.getElementById('signupForm').style.display = tab === 'signup' ? 'block' : 'none';
  document.getElementById('verifyForm').style.display = 'none';
  document.getElementById('loginTab').classList.toggle('active',  tab === 'login');
  document.getElementById('signupTab').classList.toggle('active', tab === 'signup');
  clearAuthError();
}

function showAuthError(msg) {
  const el = document.getElementById('authError');
  el.innerHTML = msg;
  el.style.display = 'block';
}

function clearAuthError() {
  const el = document.getElementById('authError');
  if (el) el.style.display = 'none';
}

async function submitLogin() {
  const email    = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  if (!email || !password) return showAuthError('Email and password required.');

  try {
    const data = await apiCall('POST', '/users/signin', { email, password });
    localStorage.setItem('td_access_token',  data.accessToken);
    localStorage.setItem('td_refresh_token', data.refreshToken);
    await loadCurrentUser();
    closeAuthModal();
    updateNavAuth();
    updateSaveLoadButtons();
    if (window.location.search.includes('subscribed=true')) {
      await loadCurrentUser();
      updateNavAuth();
      window.history.replaceState({}, '', '/');
    }
  } catch (e) {
    const msg = e.message || '';
    if (msg.includes('UserNotFoundException') || msg.includes('User does not exist') || msg.includes('user does not exist')) {
      showAuthError('No account found with that email address.');
    } else if (msg.includes('NotAuthorizedException') || msg.includes('Invalid email or password') || msg.includes('Incorrect username or password')) {
      showAuthError(`Incorrect password. <a href="#" onclick="sendPasswordReset(event)" style="color:#4ecdc4">Reset password?</a>`);
    } else if (msg.includes('UserNotConfirmedException') || msg.includes('verify')) {
      showAuthError('Please verify your email before logging in. Check your inbox.');
    } else {
      showAuthError('Login failed. Please try again.');
    }
  }
}

async function sendPasswordReset(e) {
  e.preventDefault();
  const email = document.getElementById('loginEmail').value.trim();
  if (!email) return showAuthError('Enter your email address above first.');
  try {
    await apiCall('POST', '/users/forgot-password', { email });
    showAuthError('✅ Password reset email sent. Check your inbox.');
    document.getElementById('authError').style.color = '#64dc64';
  } catch (err) {
    showAuthError('Could not send reset email. Please try again.');
  }
}

async function submitSignup() {
  const email    = document.getElementById('signupEmail').value.trim();
  const password = document.getElementById('signupPassword').value;
  if (!email || !password) return showAuthError('Email and password required.');

  try {
    await apiCall('POST', '/users/signup', { email, password });
    _pendingVerifyEmail = email;
    // Show verify form
    document.getElementById('signupForm').style.display = 'none';
    document.getElementById('verifyForm').style.display = 'block';
    clearAuthError();
  } catch (e) {
    showAuthError(e.message);
  }
}

async function submitVerify() {
  const code = document.getElementById('verifyCode').value.trim();
  if (!code) return showAuthError('Enter the verification code from your email.');

  try {
    await apiCall('POST', '/users/verify', { email: _pendingVerifyEmail, code });
    // Auto-login after verify
    showAuthError('✅ Email verified! You can now log in.');
    document.getElementById('authError').style.background = 'rgba(100,220,100,0.1)';
    document.getElementById('authError').style.borderColor = 'rgba(100,220,100,0.3)';
    document.getElementById('authError').style.color = '#64dc64';
    document.getElementById('authError').style.display = 'block';
    setTimeout(() => switchAuthTab('login'), 1500);
  } catch (e) {
    showAuthError(e.message);
  }
}

async function goPro() {
  if (!isLoggedIn()) {
    // Show a dedicated Go Pro modal — not the generic auth modal
    const result = await showModal({
      title: '⚡ Go Pro — $5/month',
      body: `<p style="margin-bottom:12px;">Save deployments, store army lists, and unlock all Pro features.</p>
             <p>Create a free account to get started — no credit card required until you subscribe.</p>`,
      buttons: [
        { label: 'Log In',    style: 'modal-btn-secondary', value: 'login'  },
        { label: 'Sign Up',   style: 'modal-btn-primary',   value: 'signup' },
        { label: 'Cancel',    style: 'modal-btn-secondary', value: null     },
      ]
    });
    if (result === 'login')  openAuthModal('login');
    if (result === 'signup') openAuthModal('signup');
    return;
  }
  try {
    const data = await apiCall('POST', '/stripe/create-checkout', {}, true);
    window.location.href = data.url;
  } catch (e) {
    modalAlert('Error', e.message);
  }
}

async function openBillingPortal() {
  try {
    const data = await apiCall('POST', '/stripe/create-portal', {}, true);
    window.location.href = data.url;
  } catch (e) {
    modalAlert('Error', e.message);
  }
}

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
    title: '🎯 Place Models — How to Use',
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
// shape: 'circle' | 'oval' | 'rectangle'
const BASE_SIZES = [
  { key:'25',      w:25,  h:25,  shape:'circle'    },
  { key:'28',      w:28,  h:28,  shape:'circle'    },
  { key:'32',      w:32,  h:32,  shape:'circle'    },
  { key:'40',      w:40,  h:40,  shape:'circle'    },
  { key:'50',      w:50,  h:50,  shape:'circle'    },
  { key:'60',      w:60,  h:60,  shape:'circle'    },
  { key:'60x35o',  w:60,  h:35,  shape:'oval'      },
  { key:'70',      w:70,  h:70,  shape:'circle'    },
  { key:'75x42o',  w:75,  h:42,  shape:'oval'      },
  { key:'80',      w:80,  h:80,  shape:'circle'    },
  { key:'90',      w:90,  h:90,  shape:'circle'    },
  { key:'90x52o',  w:90,  h:52,  shape:'oval'      },
  { key:'100',     w:100, h:100, shape:'circle'    },
  { key:'105x70o', w:105, h:70,  shape:'oval'      },
  { key:'105x70r', w:105, h:70,  shape:'rectangle' },
  { key:'120x92o', w:120, h:92,  shape:'oval'      },
  { key:'120x92r', w:120, h:92,  shape:'rectangle' },
  { key:'130',     w:130, h:130, shape:'circle'    },
  { key:'150x95o', w:150, h:95,  shape:'oval'      },
  { key:'150x95r', w:150, h:95,  shape:'rectangle' },
  { key:'160',     w:160, h:160, shape:'circle'    },
  { key:'170x105o',w:170, h:105, shape:'oval'      },
  { key:'170x105r',w:170, h:105, shape:'rectangle' },
];

function getBaseSize(key) {
  return BASE_SIZES.find(b => b.key === key) || { w:32, h:32, shape:'circle' };
}
function mmToIn(mm) { return mm / 25.4; }
function mmToPx(mm) { return mmToIn(mm) * IPX; }

// Shape SVG icons for the picker
const SHAPE_SVGS = {
  circle:    `<svg width="18" height="18" viewBox="0 0 18 18"><circle cx="9" cy="9" r="7" fill="none" stroke="currentColor" stroke-width="2"/></svg>`,
  oval:      `<svg width="22" height="16" viewBox="0 0 22 16"><ellipse cx="11" cy="8" rx="9" ry="5.5" fill="none" stroke="currentColor" stroke-width="2"/></svg>`,
  rectangle: `<svg width="22" height="16" viewBox="0 0 22 16"><rect x="2" y="2" width="18" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="2"/></svg>`,
};

// A "modelGroup" drawing: { type:'modelGroup', label, color, bases:[{x,y}], baseSizeKey, shape, baseRotation, locked }
// bases are CENTER positions in canvas pixels

let modelsSelectedBases = new Set(); // indices into the active modelGroup being edited
let modelsEditingIndex  = null;      // drawings[] index of group in edit mode
let modelsDragStart     = null;      // {x,y} canvas point where drag started
let modelsDragging      = false;
let modelsRotating      = false;  // true when dragging rotation handle
let modelsRotateAnchor  = null;   // {x,y} center of anchor base
let modelsRotateStart   = null;   // starting angle of drag

function updateSizeDropdown(pickerEl, sizeEl) {
  const activeBtn = pickerEl?.querySelector('.shape-btn.active');
  const shape     = activeBtn?.dataset.shape || 'circle';

  const filtered = BASE_SIZES.filter(b => b.shape === shape);

  sizeEl.innerHTML = '';
  filtered.forEach(bs => {
    const opt    = document.createElement('option');
    opt.value    = bs.key;
    const dimStr = bs.w === bs.h ? `${bs.w}mm` : `${bs.w}×${bs.h}mm`;
    opt.textContent = dimStr;
    sizeEl.appendChild(opt);
  });

  // Custom option
  const customOpt = document.createElement('option');
  customOpt.value = 'custom';
  customOpt.textContent = 'Custom...';
  sizeEl.appendChild(customOpt);

  const preferred = filtered.find(b => b.key === '32') || filtered[0];
  if (preferred) sizeEl.value = preferred.key;

  // Show rotation dropdown for oval and rectangle
  const rotEl = document.getElementById('baseRotation');
  if (rotEl) rotEl.style.display = (shape === 'oval' || shape === 'rectangle') ? 'inline-block' : 'none';

  // Handle custom selection
  sizeEl.onchange = () => {
    if (sizeEl.value === 'custom') handleCustomBaseSize(sizeEl, pickerEl);
  };
}

async function handleCustomBaseSize(sizeEl, pickerEl) {
  const activeBtn = pickerEl?.querySelector('.shape-btn.active');
  const shape     = activeBtn?.dataset.shape || 'circle';

  let prompt;
  if (shape === 'circle') {
    prompt = await modalPrompt('Custom Base Size', 'Enter diameter in mm (e.g. 45):', '', '45');
  } else {
    prompt = await modalPrompt('Custom Base Size', 'Enter dimensions in mm as W×H (e.g. 80×52):', '', '80×52');
  }

  if (!prompt || !prompt.trim()) {
    // Revert to first valid option
    const first = sizeEl.querySelector('option:not([value="custom"])');
    if (first) sizeEl.value = first.value;
    return;
  }

  const input = prompt.trim().replace('x', '×');
  let w, h, key;

  if (shape === 'circle') {
    w = parseInt(input);
    h = w;
    if (isNaN(w) || w <= 0) { modalAlert('Invalid', 'Please enter a number.'); sizeEl.value = sizeEl.options[0].value; return; }
    key = `custom_${w}c`;
  } else {
    const parts = input.split('×').map(p => parseInt(p.trim()));
    if (parts.length !== 2 || isNaN(parts[0]) || isNaN(parts[1])) {
      modalAlert('Invalid', 'Please enter dimensions as W×H e.g. 80×52.');
      sizeEl.value = sizeEl.options[0].value;
      return;
    }
    [w, h] = parts;
    const suffix = shape === 'oval' ? 'o' : 'r';
    key = `custom_${w}x${h}${suffix}`;
  }

  // Add to BASE_SIZES if not already there
  if (!BASE_SIZES.find(b => b.key === key)) {
    BASE_SIZES.push({ key, w, h, shape });
  }

  // Add option to dropdown and select it
  const existing = sizeEl.querySelector(`option[value="${key}"]`);
  if (!existing) {
    const opt = document.createElement('option');
    opt.value = key;
    const dimStr = w === h ? `${w}mm` : `${w}×${h}mm`;
    opt.textContent = `${dimStr} ✱`;
    // Insert before Custom...
    const customOpt = sizeEl.querySelector('option[value="custom"]');
    sizeEl.insertBefore(opt, customOpt);
  }
  sizeEl.value = key;
}

function buildShapePicker(currentShape, onShapeChange) {
  const picker = document.createElement('div');
  picker.className = 'shape-picker';

  ['circle', 'oval', 'rectangle'].forEach(shape => {
    const btn = document.createElement('button');
    btn.className   = 'shape-btn' + (shape === currentShape ? ' active' : '');
    btn.dataset.shape = shape;
    btn.title       = shape.charAt(0).toUpperCase() + shape.slice(1);
    btn.innerHTML   = SHAPE_SVGS[shape];
    btn.onclick = () => {
      picker.querySelectorAll('.shape-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      if (onShapeChange) onShapeChange(shape, picker);
    };
    picker.appendChild(btn);
  });

  return picker;
}

function initToolbarShapePicker() {
  const pickerEl = document.getElementById('shapePicker');
  const sizeEl   = document.getElementById('baseSize');
  if (!pickerEl || !sizeEl) return;

  // Build shape buttons
  pickerEl.innerHTML = '';
  ['circle', 'oval', 'rectangle'].forEach(shape => {
    const btn = document.createElement('button');
    btn.className   = 'shape-btn' + (shape === 'circle' ? ' active' : '');
    btn.dataset.shape = shape;
    btn.title       = shape.charAt(0).toUpperCase() + shape.slice(1);
    btn.innerHTML   = SHAPE_SVGS[shape];
    btn.onclick = () => {
      pickerEl.querySelectorAll('.shape-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      updateSizeDropdown(pickerEl, sizeEl);
    };
    pickerEl.appendChild(btn);
  });

  // Populate sizes for default shape (circle)
  updateSizeDropdown(pickerEl, sizeEl);
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
  const sz       = getBaseSize(group.baseSizeKey || String(group.baseSizeMm || 32));
  const shape    = group.shape || sz.shape || 'circle';
  const groupRot = (group.baseRotation || 0) * Math.PI / 180;
  const rw       = mmToPx(sz.w) / 2;
  const rh       = mmToPx(sz.h) / 2;
  for (let i = group.bases.length - 1; i >= 0; i--) {
    const b   = group.bases[i];
    const rot = (b.rot !== undefined) ? b.rot : groupRot;
    const dx  = x - b.x, dy = y - b.y;
    const lx  = dx * Math.cos(-rot) - dy * Math.sin(-rot);
    const ly  = dx * Math.sin(-rot) + dy * Math.cos(-rot);
    if (shape === 'rectangle') {
      if (Math.abs(lx) <= rw && Math.abs(ly) <= rh) return i;
    } else {
      if ((lx*lx)/(rw*rw) + (ly*ly)/(rh*rh) <= 1) return i;
    }
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
  const sz       = getBaseSize(group.baseSizeKey || String(group.baseSizeMm || 32));
  const shape    = group.shape || sz.shape || 'circle';
  const rw       = mmToPx(sz.w) / 2;
  const rh       = mmToPx(sz.h) / 2;
  const groupRot = (group.baseRotation || 0) * Math.PI / 180;
  const inCohesion = group.bases.length <= 1 || checkCohesion(group);
  const ringColor  = inCohesion ? 'rgba(100,220,100,0.7)' : 'rgba(255,80,80,0.8)';

  group.bases.forEach((b, i) => {
    const isSelected = isEditing && modelsSelectedBases.has(i);
    const rot = (b.rot !== undefined) ? b.rot : groupRot;

    ctx.beginPath();
    if (shape === 'rectangle') {
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(rot);
      ctx.rect(-rw, -rh, rw * 2, rh * 2);
      ctx.restore();
    } else {
      ctx.ellipse(b.x, b.y, rw, rh, rot, 0, Math.PI * 2);
    }
    ctx.fillStyle = group.color + (isSelected ? 'ff' : 'aa');
    ctx.fill();
    ctx.strokeStyle = isSelected ? '#fff' : group.color;
    ctx.lineWidth   = isSelected ? 2.5 : 1.5;
    ctx.stroke();
  });

  // Cohesion ring
  if (group.bases.length > 1) {
    ctx.strokeStyle = ringColor;
    ctx.lineWidth   = 1.5;
    ctx.setLineDash([4, 3]);
    group.bases.forEach((b, i) => {
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

  // Label
  if (group.label) {
    // Label drawn separately in drawModelGroupLabel for correct z-order
  }

  // Edit mode indicator + rotation handle
  if (isEditing) {
    const minX  = Math.min(...group.bases.map(b => b.x)) - Math.max(rw, rh) - 6;
    const minY2 = Math.min(...group.bases.map(b => b.y)) - Math.max(rw, rh) - 6;
    const maxX  = Math.max(...group.bases.map(b => b.x)) + Math.max(rw, rh) + 6;
    const maxY2 = Math.max(...group.bases.map(b => b.y)) + Math.max(rw, rh) + 6;
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(minX, minY2, maxX - minX, maxY2 - minY2);
    ctx.setLineDash([]);

    // Rotation handle — oval and rectangle only
    if (isRotatable(group) && modelsSelectedBases.size > 0) {
      const handle = getRotationHandle(group);
      if (handle) {
        const lastSel = [...modelsSelectedBases].at(-1);
        const b = group.bases[lastSel];

        // Stem line
        ctx.strokeStyle = 'rgba(255,200,0,0.8)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(b.x, b.y);
        ctx.lineTo(handle.x, handle.y);
        ctx.stroke();
        ctx.setLineDash([]);

        // Handle circle
        ctx.beginPath();
        ctx.arc(handle.x, handle.y, 8, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,200,0,0.9)';
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Arrow icon
        ctx.font = '10px sans-serif';
        ctx.fillStyle = '#000';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('↻', handle.x, handle.y);
      }
    }
  }
}

function drawModelGroupLabel(group, isEditing) {
  if (!group.label) return;
  const sz  = getBaseSize(group.baseSizeKey || '32');
  const rw  = mmToPx(sz.w) / 2;
  const rh  = mmToPx(sz.h) / 2;
  const cx  = group.bases.reduce((s, b) => s + b.x, 0) / group.bases.length;
  const minY = Math.min(...group.bases.map(b => b.y)) - Math.max(rw, rh) - 14;

  ctx.font = '11px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const tw = ctx.measureText(group.label).width;
  const lx = cx - tw / 2 - 5;
  const ly = minY - 9;
  const lw = tw + 10;
  const lh = 18;
  const r  = 4;

  ctx.fillStyle = 'rgba(0,0,0,0.50)';
  ctx.beginPath();
  ctx.moveTo(lx + r, ly);
  ctx.lineTo(lx + lw - r, ly);
  ctx.arcTo(lx + lw, ly, lx + lw, ly + r, r);
  ctx.lineTo(lx + lw, ly + lh - r);
  ctx.arcTo(lx + lw, ly + lh, lx + lw - r, ly + lh, r);
  ctx.lineTo(lx + r, ly + lh);
  ctx.arcTo(lx, ly + lh, lx, ly + lh - r, r);
  ctx.lineTo(lx, ly + r);
  ctx.arcTo(lx, ly, lx + r, ly, r);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = group.color;
  ctx.fillText(group.label, cx, minY);
}

// ─── Constants ────────────────────────────────────────────────────────────────
const IPX = 15; // inches to pixels: 1" = 15px
// Board: 60" x 44" = 900px x 660px

// Sort an array of 4 {x,y} corner points geometrically into [TL, TR, BR, BL]
// ─── State ────────────────────────────────────────────────────────────────────
const canvas = document.getElementById('battlefield');
const ctx = canvas.getContext('2d');

let currentTool = 'models';
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

// ─── Army List State ──────────────────────────────────────────────────────────
let importedList     = null;  // { faction, detachment, edition, units[] }
let stagingUnits     = [];    // units not yet placed on board
let draggingPill     = null;  // { unit, pillEl } currently being dragged from staging

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
  updateHsToggle(document.getElementById('leftSidebar'));
  updateHsToggle(document.getElementById('mobileMenu'));
}

// ─── Army List Import ─────────────────────────────────────────────────────────

const CATEGORY_COLORS = {
  character:  '#e94560',  // red
  battleline: '#4ecdc4',  // teal
  vehicle:    '#4e8ccd',  // blue
  monster:    '#9b59b6',  // purple
  transport:  '#e67e22',  // orange
  other:      '#f1c40f',  // yellow
};

const CATEGORY_HEADERS = new Set([
  'characters', 'character', 'battleline', 'infantry',
  'vehicles', 'vehicle', 'monsters', 'monster',
  'dedicated transports', 'transport', 'fortifications',
  'allied units', 'other datasheets', 'epic heroes',
]);

function normalizeFaction(str) {
  return str.toLowerCase().trim().replace(/\s+/g, '-');
}

function inferCategory(unitName) {
  const n = unitName.toLowerCase();
  if (/lord|captain|lieutenant|master|sorcerer|daemon prince|warlord|hero|prime|tyrant|patriarch|magus|aun\'va|shadowsun/.test(n)) return 'character';
  if (/squad|warriors|marines|brethren|boys|boyz|troops|cultists|guardsmen|bloodletters|daemonettes|plaguebearers|horrors/.test(n)) return 'battleline';
  if (/tank|predator|rhino|land raider|transport|razorback|chimera|devilfish|wave serpent|trukk/.test(n)) return 'transport';
  if (/dreadnought|knight|titan|riptide|morkanaut|gorkanaut|tyrannofex|hive|carnifex|maulerfiend|defiler/.test(n)) return 'monster';
  if (/vehicle|walker|sentinel|warwalker|helbrute/.test(n)) return 'vehicle';
  return 'other';
}

function inferBaseSize(unitName, category) {
  const n = unitName.toLowerCase();
  // Vehicles on rectangular bases
  if (/land raider|land raider crusader|predator|vindicator|rhino|razorback|chimera|leman russ|trukk|devilfish|hammerhead|wave serpent|ghost ark|doomsday ark/.test(n)) return '105x70r';
  if (/repulsor|impulsor|brutalis|redemptor/.test(n)) return '120x92r';
  if (/knight|titan|gorkanaut|morkanaut/.test(n)) return '170x105r';
  // Monsters/large creatures on ovals
  if (/carnifex|tyrannofex|hive tyrant|tervigon/.test(n)) return '120x92o';
  if (/dreadnought|riptide|helbrute|defiler|maulerfiend|daemon prince/.test(n)) return '90x52o';
  if (/obliterator|gravis|terminator|crisis/.test(n)) return '40';
  // Bikes/cavalry on ovals
  if (/biker|bike|cavalry|rider|horseman|jetbike/.test(n)) return '75x42o';
  // Characters
  if (category === 'character') return '40';
  // Battleline infantry
  if (category === 'battleline') return '32';
  return '32';
}

// ── New Recruit Short Format parser ──────────────────────────────────────────
// Line 1: "Faction - SubFaction - Detachment"
// Units:  "[N]x Unit Name (pts)" or "Unit Name (pts)"

function parseNewRecruit(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  if (lines.length === 0) return null;

  let faction = 'Unknown', detachment = null, edition = '10th';
  const units = [];

  // First line: faction/detachment header
  const headerMatch = lines[0].match(/^(.+?)\s*-\s*(.+?)\s*-\s*(.+)$/);
  if (headerMatch) {
    faction    = headerMatch[2].trim();
    detachment = headerMatch[3].trim();
  } else {
    faction = lines[0];
  }

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    // Skip total points line
    if (/^total\s*points?/i.test(line) || /^\d+\s*\/\s*\d+\s*pts/i.test(line)) continue;

    // "10x Unit Name (pts)" or "[10]x Unit Name (pts)" or "Unit Name (pts)"
    const unitMatch = line.match(/^(?:\[?(\d+)\]?x\s+)?(.+?)\s*\((\d+)\s*(?:pts?)?\).*$/i);
    if (unitMatch) {
      const count    = parseInt(unitMatch[1] || '1');
      const name     = unitMatch[2].trim();
      const points   = parseInt(unitMatch[3]);
      const category = inferCategory(name);
      units.push({
        unitId:   crypto.randomUUID(),
        name,
        count,
        points,
        category,
        baseSizeKey:     inferBaseSize(name, category),
        deploymentState: 'staging',
        warlord:         false,
        keywords:        [],
      });
    }
  }

  return units.length > 0 ? { faction, detachment, edition, units } : null;
}

// ── GW App Format parser ──────────────────────────────────────────────────────
// Line 1: army name, Line 2: faction
// Category headers to skip, units as "Unit Name (pts)"

function countModelsFromBlock(block) {
  // Logic: in GW App export, "• Nx Name" = a model entry.
  // Weapon/wargear lines immediately follow WITHOUT their own leading "•" at the same level,
  // OR are sub-bullets that come before the next top-level "•".
  // So: only count entries that start with "•" — the first token after • is the model count.
  // Then check: does the NEXT "•" entry come before any non-bulleted Nx line?
  // Simplest reliable rule: split on "•", each segment starts with the model entry.
  // First line of each segment = "Nx ModelName" — that's the model.
  // Remaining lines = weapons (ignore).

  const segments = block.split('•').map(s => s.trim()).filter(s => s.length > 0);
  let total = 0;
  for (const seg of segments) {
    // First token pattern: "Nx Something"
    const m = seg.match(/^(\d+)x\s+(.+?)(?:\s{2,}|$)/);
    if (m) {
      total += parseInt(m[1]);
    }
  }
  return total > 0 ? total : 1;
}

function parseGwApp(text) {
  const SECTION_HEADERS = [
    'CHARACTERS', 'BATTLELINE', 'DEDICATED TRANSPORTS', 'OTHER DATASHEETS',
    'FORTIFICATIONS', 'ALLIED UNITS', 'EPIC HEROES', 'VEHICLES', 'MONSTERS',
  ];

  const unitBlockRegex = /([A-Za-z][A-Za-z\s'\-]+?)\s*\((\d+)\s*points?\)(.*?)(?=(?:[A-Za-z][A-Za-z\s'\-]+?\s*\(\d+\s*points?\))|$)/gs;
  const blocks = [...text.matchAll(unitBlockRegex)];

  let faction = 'Unknown', detachment = null;
  const factionMatch = text.match(/(Grey Knights|Space Marines|Chaos Space Marines|Death Guard|Thousand Sons|World Eaters|Necrons|Tyranids|Orks|T'au Empire|Aeldari|Drukhari|Adeptus Mechanicus|Adeptus Custodes|Adepta Sororitas|Genestealer Cults|Imperial Knights|Chaos Knights|Leagues of Votann|Astra Militarum|Dark Angels|Blood Angels|Space Wolves)/i);
  if (factionMatch) faction = factionMatch[1];

  const detachMatch = text.match(/(Banishers|Anvil Siege Force|Spearhead Assault|First Brotherhood|Teleport Strike Force|Warpbane Brotherhood)\s*(?:CHARACTERS|BATTLELINE|•)/);
  if (detachMatch) detachment = detachMatch[1].trim();

  const units = [];

  for (const block of blocks) {
    const name   = block[1].trim();
    const points = parseInt(block[2]);
    const body   = block[3] || '';

    if (/^(strike force|patrol|battalion|vanguard|outrider|spearhead|exported|app version|\d+\s*\/\s*\d+)/i.test(name)) continue;
    if (SECTION_HEADERS.some(h => name.toUpperCase().includes(h))) continue;
    if (points > 2000) continue;

    const count    = countModelsFromBlock(body);
    const category = inferCategory(name);

    units.push({
      unitId:          crypto.randomUUID(),
      name,
      count,
      points,
      category,
      baseSizeKey:     inferBaseSize(name, category),
      deploymentState: 'staging',
      warlord:         false,
      keywords:        [],
    });
  }

  return units.length > 0 ? { faction, detachment, edition: '10th', units } : null;
}

function parseArmyList(text) {
  const nr = parseNewRecruit(text);
  if (nr && nr.units.length > 0) return nr;
  return parseGwApp(text);
}

// ─── Import Modal ─────────────────────────────────────────────────────────────

function openImportModal() {
  document.getElementById('importModalOverlay').style.display = 'flex';
  const ta = document.getElementById('importTextarea');
  ta.value = '';
  ta.focus();
  updateImportLineCount();
  ta.oninput = updateImportLineCount;
}

function closeImportModal() {
  document.getElementById('importModalOverlay').style.display = 'none';
}

function updateImportLineCount() {
  const ta    = document.getElementById('importTextarea');
  const lines = ta.value.split('\n').filter(l => l.trim()).length;
  document.getElementById('importLineCount').textContent = `${lines} lines · ${ta.value.length} chars`;
}

function parseAndImport() {
  const text = document.getElementById('importTextarea').value.trim();
  if (!text) return;

  const list = parseArmyList(text);
  if (!list || list.units.length === 0) {
    document.getElementById('importMeta').textContent = '⚠️ Could not parse list. Try New Recruit (Short) format.';
    return;
  }

  closeImportModal();
  openReviewModal(list);
}

// ─── Review Modal ─────────────────────────────────────────────────────────────

let pendingList = null;

function buildReviewRow(unit, i) {
  const tr = document.createElement('tr');
  tr.dataset.index = i;

  const sz           = getBaseSize(unit.baseSizeKey);
  const currentShape = unit.shape || sz.shape || 'circle';

  // Color dot
  const tdDot = document.createElement('td');
  const dot   = document.createElement('div');
  dot.className = 'unit-color-dot';
  dot.style.backgroundColor = CATEGORY_COLORS[unit.category] || '#aaa';
  dot.style.margin = '0 auto';
  tdDot.appendChild(dot);

  // Unit name
  const tdName = document.createElement('td');
  tdName.textContent = unit.name;
  tdName.style.fontSize = '12px';

  // Count input
  const tdCount    = document.createElement('td');
  const countInput = document.createElement('input');
  countInput.type  = 'number';
  countInput.min   = '1';
  countInput.max   = '30';
  countInput.value = unit.count;
  countInput.className    = 'review-input';
  countInput.dataset.field  = 'count';
  countInput.dataset.index  = i;
  tdCount.appendChild(countInput);

  // Shape picker (comes before size)
  const tdShape  = document.createElement('td');
  const pickerEl = buildShapePicker(currentShape, (newShape, picker) => {
    updateSizeDropdown(picker, sizeSelect);
  });
  pickerEl.dataset.field = 'shape';
  pickerEl.dataset.index = i;
  tdShape.appendChild(pickerEl);

  // Size dropdown — filtered by current shape
  const tdBase    = document.createElement('td');
  const sizeSelect = document.createElement('select');
  sizeSelect.className      = 'nav-select review-select';
  sizeSelect.dataset.field  = 'baseSizeKey';
  sizeSelect.dataset.index  = i;

  // Populate filtered by current shape
  BASE_SIZES.filter(b => b.shape === currentShape).forEach(bs => {
    const opt    = document.createElement('option');
    opt.value    = bs.key;
    const dimStr = bs.w === bs.h ? `${bs.w}mm` : `${bs.w}×${bs.h}mm`;
    opt.textContent = bs.key.startsWith('custom_') ? dimStr + ' ✱' : dimStr;
    if (bs.key === unit.baseSizeKey) opt.selected = true;
    sizeSelect.appendChild(opt);
  });

  // Custom option
  const customOpt = document.createElement('option');
  customOpt.value = 'custom';
  customOpt.textContent = 'Custom...';
  sizeSelect.appendChild(customOpt);

  sizeSelect.onchange = () => {
    if (sizeSelect.value === 'custom') {
      handleCustomBaseSize(sizeSelect, pickerEl).then(() => {
        // If a custom size was added, make sure it's in the dropdown
        if (sizeSelect.value !== 'custom') {
          const match = BASE_SIZES.find(b => b.key === sizeSelect.value);
          if (match) {
            pendingList.units[i].baseSizeKey = match.key;
            pendingList.units[i].shape = match.shape;
          }
        }
      });
    }
  };
  tdBase.appendChild(sizeSelect);

  // Confidence indicator
  const tdConf = document.createElement('td');
  tdConf.style.textAlign = 'center';
  const uncertain = unit.baseSizeKey === '32' && unit.category !== 'battleline';
  tdConf.innerHTML = uncertain
    ? '<span style="color:#f1c40f;font-size:13px;" title="Base size inferred — please verify">?</span>'
    : '<span style="color:#64dc64;font-size:13px;">✓</span>';

  tr.appendChild(tdDot);
  tr.appendChild(tdName);
  tr.appendChild(tdCount);
  tr.appendChild(tdShape);
  tr.appendChild(tdBase);
  tr.appendChild(tdConf);
  return tr;
}

function openReviewModal(list) {
  pendingList = list;
  const overlay = document.getElementById('reviewModalOverlay');
  const tbody   = document.getElementById('reviewTableBody');
  const title   = document.getElementById('reviewModalTitle');

  title.textContent = `${list.faction}${list.detachment ? ' · ' + list.detachment : ''} — Review Units`;
  tbody.innerHTML   = '';

  list.units.forEach((unit, i) => {
    tbody.appendChild(buildReviewRow(unit, i));
  });

  overlay.style.display = 'flex';
}

function closeReviewModal() {
  document.getElementById('reviewModalOverlay').style.display = 'none';
  pendingList = null;
}

function confirmReview() {
  if (!pendingList) return;

  document.querySelectorAll('#reviewTableBody tr').forEach(tr => {
    const i          = parseInt(tr.dataset.index);
    const countInput = tr.querySelector('[data-field="count"]');
    const sizeSelect = tr.querySelector('[data-field="baseSizeKey"]');
    const shapeActive = tr.querySelector('[data-field="shape"] .shape-btn.active');

    if (countInput) pendingList.units[i].count = parseInt(countInput.value) || 1;
    if (sizeSelect) {
      const match = BASE_SIZES.find(b => b.key === sizeSelect.value);
      if (match) {
        pendingList.units[i].baseSizeKey = match.key;
        pendingList.units[i].shape       = match.shape;
      }
    }
    // Shape from picker overrides if explicitly changed
    if (shapeActive) pendingList.units[i].shape = shapeActive.dataset.shape;
  });

  importedList = pendingList;
  stagingUnits = pendingList.units.map(u => ({ ...u, deploymentState: 'staging' }));
  localStorage.setItem('tacticaldropz_list', JSON.stringify(importedList));

  document.getElementById('reviewModalOverlay').style.display = 'none';
  pendingList = null;
  renderStagingArea();
}

// ─── Staging Area ─────────────────────────────────────────────────────────────

function renderStagingArea() {
  const container = document.getElementById('stagingUnits');
  const hint      = document.getElementById('stagingHint');
  const clearBtn  = document.getElementById('clearListBtn');
  container.innerHTML = '';

  if (!importedList || stagingUnits.length === 0) {
    hint.textContent = 'Import a list to begin — or place units directly on the board';
    clearBtn.style.display = 'none';
    return;
  }

  const totalPts = importedList.units.reduce((s, u) => s + u.points, 0);
  const remaining = stagingUnits.filter(u => u.deploymentState !== 'deployed').length;
  const total = stagingUnits.length;
  const deployedStr = remaining < total ? ` · ${total - remaining}/${total} deployed` : '';
  hint.textContent = `${importedList.faction}${importedList.detachment ? ' · ' + importedList.detachment : ''} · ${totalPts}pts${deployedStr}`;
  clearBtn.style.display = 'inline-block';

  stagingUnits.forEach(unit => {
    // Hide deployed units — they're on the board now
    if (unit.deploymentState === 'deployed') return;

    const pill = document.createElement('div');
    pill.className = 'staging-pill';
    pill.draggable = true;
    pill.dataset.unitId = unit.unitId;

    const color = CATEGORY_COLORS[unit.category] || CATEGORY_COLORS.other;

    const dot = document.createElement('div');
    dot.className = 'staging-pill-dot';
    dot.style.backgroundColor = color;

    const name = document.createElement('span');
    name.className = 'staging-pill-name';
    name.textContent = unit.name;

    const count = document.createElement('span');
    count.className = 'staging-pill-count';
    count.textContent = unit.count > 1 ? `×${unit.count}` : '';

    const base = document.createElement('span');
    base.className = 'staging-pill-base';
    base.textContent = unit.baseSizeKey + 'mm';

    pill.appendChild(dot);
    pill.appendChild(name);
    if (unit.count > 1) pill.appendChild(count);
    pill.appendChild(base);

    // Tags
    if (unit.warlord) {
      const tag = document.createElement('span');
      tag.className = 'staging-pill-tag';
      tag.textContent = 'WL';
      pill.appendChild(tag);
    }

    // Drag events
    pill.addEventListener('dragstart', e => {
      draggingPill = unit;
      pill.classList.add('dragging-pill');
      e.dataTransfer.effectAllowed = 'move';
      document.getElementById('canvasWrapper').classList.add('drop-active');
    });
    pill.addEventListener('dragend', () => {
      pill.classList.remove('dragging-pill');
      draggingPill = null;
      document.getElementById('canvasWrapper').classList.remove('drop-active');
    });

    container.appendChild(pill);
  });

  // Recalculate canvas after DOM reflow
  setTimeout(() => { resizeCanvas(); drawScene(); }, 50);
}

function setupCanvasDropZone() {
  const wrapper = document.getElementById('canvasWrapper');

  wrapper.addEventListener('dragover', e => {
    if (!draggingPill) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  });

  wrapper.addEventListener('drop', e => {
    e.preventDefault();
    if (!draggingPill) return;

    const rect   = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top)  * scaleY;

    placeUnitFromStaging(draggingPill, x, y);
    draggingPill = null;
    document.getElementById('canvasWrapper').classList.remove('drop-active');
  });
}

function placeUnitFromStaging(unit, x, y) {
  const sz    = getBaseSize(unit.baseSizeKey);
  const shape = unit.shape || sz.shape || 'circle';
  const count = unit.count;
  const wPx   = mmToPx(sz.w);
  const hPx   = mmToPx(sz.h);
  const bases  = buildModelGrid(x, y, count, wPx, hPx);
  const color  = CATEGORY_COLORS[unit.category] || currentColor;

  const group = {
    type:        'modelGroup',
    label:       unit.name,
    color,
    baseSizeKey: unit.baseSizeKey,
    shape,
    baseRotation: 0,
    bases,
    unitId:      unit.unitId,
    fromList:    true,
  };

  drawings.push(group);
  modelsEditingIndex = drawings.length - 1;
  modelsSelectedBases = new Set(bases.map((_, i) => i));

  // Auto-switch to models tool so user can immediately drag/edit
  if (currentTool !== 'models') selectTool('models');

  // Mark as deployed in staging
  unit.deploymentState = 'deployed';
  renderStagingArea();
  drawScene();
  updateUnitsList();
}

function returnUnitToStaging(unitId) {
  const unit = stagingUnits.find(u => u.unitId === unitId);
  if (unit) {
    unit.deploymentState = 'staging';
    renderStagingArea();
  }
}

function clearList() {
  modalConfirm('Clear List', 'Remove the imported list and all placed units from it?', 'Clear', true).then(ok => {
    if (!ok) return;
    // Remove all drawings that came from the list
    drawings = drawings.filter(d => !d.fromList);
    importedList = null;
    stagingUnits = [];
    localStorage.removeItem('tacticaldropz_list');
    renderStagingArea();
    drawScene();
    updateUnitsList();
  });
}

function restoreListFromStorage() {
  try {
    const saved = localStorage.getItem('tacticaldropz_list');
    if (saved) {
      importedList = JSON.parse(saved);
      stagingUnits = importedList.units.map(u => ({ ...u, deploymentState: 'staging' }));
      renderStagingArea();
    }
  } catch (e) { /* ignore */ }
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
async function init() {
  await loadDeployments();
  loadGwImages();
  await loadCurrentUser();   // load auth state before building nav
  buildNav();
  buildMissionSidebar();
  bindToolbar();
  bindCanvas();
  resizeCanvas();
  setupCanvasDropZone();
  restoreListFromStorage();
  initToolbarShapePicker();
  selectTool('models');
  updateSaveLoadButtons();
  drawScene();

  // Watch staging area height changes and resize canvas accordingly
  const stagingObserver = new ResizeObserver(() => { resizeCanvas(); drawScene(); });
  const stagingEl = document.getElementById('stagingArea');
  if (stagingEl) stagingObserver.observe(stagingEl);

  // Handle Stripe success/cancel redirect
  const params = new URLSearchParams(window.location.search);
  if (params.get('subscribed') === 'true') {
    await loadCurrentUser();
    updateNavAuth();
    window.history.replaceState({}, '', '/');
    if (isPro()) modalAlert('⚡ Welcome to Pro!', 'Your subscription is now active. Enjoy saved deployments and all Pro features!');
  }
  if (params.get('cancelled') === 'true') {
    window.history.replaceState({}, '', '/');
  }
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

  // About link
  const about = document.createElement('a');
  about.href = 'about.html';
  about.className = 'nav-link';
  about.textContent = 'About & Help';
  nav.appendChild(about);

  // Divider
  const d1 = document.createElement('div');
  d1.className = 'nav-divider';
  nav.appendChild(d1);

  // Feedback link
  const feedback = document.createElement('a');
  feedback.href = 'mailto:nwimmer123@yahoo.com?subject=TacticalDropz Feedback';
  feedback.className = 'nav-link';
  feedback.textContent = '📧 Feedback';
  nav.appendChild(feedback);

  // Divider before auth
  const d2 = document.createElement('div');
  d2.className = 'nav-divider';
  nav.appendChild(d2);

  // Auth buttons
  const authArea = document.createElement('div');
  authArea.id = 'navAuthArea';
  authArea.style.cssText = 'display:flex; gap:6px; align-items:center;';
  nav.appendChild(authArea);
  updateNavAuth();
}

function updateNavAuth() {
  const area = document.getElementById('navAuthArea');
  if (!area) return;
  area.innerHTML = '';

  if (!isLoggedIn()) {
    // Logged out — Login + Sign Up + Go Pro
    const loginBtn = document.createElement('button');
    loginBtn.className = 'nav-btn nav-btn-login';
    loginBtn.textContent = 'Log In';
    loginBtn.onclick = () => openAuthModal('login');

    const signupBtn = document.createElement('button');
    signupBtn.className = 'nav-btn nav-btn-signup';
    signupBtn.textContent = 'Sign Up';
    signupBtn.onclick = () => openAuthModal('signup');

    const proBtn = document.createElement('button');
    proBtn.className = 'nav-btn nav-btn-pro';
    proBtn.textContent = '⚡ Go Pro';
    proBtn.onclick = goPro;

    area.appendChild(loginBtn);
    area.appendChild(signupBtn);
    area.appendChild(proBtn);

  } else if (!isPro()) {
    // Logged in free — show email + Go Pro
    const emailSpan = document.createElement('span');
    emailSpan.className = 'nav-user-email';
    emailSpan.textContent = currentUser.email;
    emailSpan.onclick = () => modalConfirm('Account', `Logged in as ${currentUser.email}`, 'Log Out', false).then(ok => { if (ok) logout(); });

    const proBtn = document.createElement('button');
    proBtn.className = 'nav-btn nav-btn-pro';
    proBtn.textContent = '⚡ Go Pro — $5/mo';
    proBtn.onclick = goPro;

    area.appendChild(emailSpan);
    area.appendChild(proBtn);

  } else {
    // Pro user — email + PRO badge, click for account menu
    const pill = document.createElement('div');
    pill.className = 'nav-user-pill';

    const emailSpan = document.createElement('span');
    emailSpan.textContent = currentUser.email;

    const badge = document.createElement('span');
    badge.className = 'nav-pro-badge';
    badge.textContent = 'PRO';

    pill.appendChild(emailSpan);
    pill.appendChild(badge);
    pill.onclick = () => {
      showModal({
        title: 'Account',
        body: `<p>Logged in as <strong>${currentUser.email}</strong></p><p style="margin-top:8px;">Subscription: <strong style="color:#64dc64">Pro ⚡</strong></p>`,
        buttons: [
          { label: 'Manage Billing', style: 'modal-btn-secondary', value: 'billing' },
          { label: 'Log Out',        style: 'modal-btn-danger',    value: 'logout'  },
          { label: 'Close',          style: 'modal-btn-primary',   value: 'close'   },
        ]
      }).then(v => {
        if (v === 'logout')  logout();
        if (v === 'billing') openBillingPortal();
      });
    };

    area.appendChild(pill);
  }
}


function populateLayoutDropdown() {
  currentLayoutIndex = 0;
  buildLayoutGrid(document.getElementById('leftSidebar'));
  const mobileMenu = document.getElementById('mobileMenu');
  if (mobileMenu && mobileMenu.children.length > 0) {
    buildLayoutGrid(mobileMenu);
  }
}

function buildMissionSidebar() {
  const sidebar = document.getElementById('leftSidebar');
  sidebar.innerHTML = '';

  // ── FORMAT ──
  const fmtHeader = document.createElement('div');
  fmtHeader.className = 'sidebar-header';
  fmtHeader.textContent = 'Format';
  sidebar.appendChild(fmtHeader);

  const formats = [
    { value: 'gw',   label: 'GW' },
    { value: 'wtc',  label: 'WTC' },
    { value: 'uktc', label: 'UKTC (soon)' },
  ];
  formats.forEach(fmt => {
    const opt = document.createElement('div');
    opt.className = 'deploy-option' + (currentTerrainFormat === fmt.value ? ' active' : '');
    opt.dataset.format = fmt.value;
    opt.textContent = fmt.label;
    opt.onclick = () => {
      sidebar.querySelectorAll('[data-format]').forEach(o => o.classList.remove('active'));
      opt.classList.add('active');
      selectTerrainFormat(fmt.value);
      buildLayoutGrid(sidebar);
    };
    sidebar.appendChild(opt);
  });

  // ── MISSION ──
  const missionHeader = document.createElement('div');
  missionHeader.className = 'sidebar-header';
  missionHeader.textContent = 'Mission';
  sidebar.appendChild(missionHeader);

  deployments.forEach(mission => {
    const opt = document.createElement('div');
    opt.className = 'deploy-option' + (mission === currentMission ? ' active' : '');
    opt.textContent = mission.name;
    opt.dataset.id = mission.id;
    opt.onclick = () => {
      sidebar.querySelectorAll('[data-id]').forEach(o => o.classList.remove('active'));
      opt.classList.add('active');
      selectMission(mission.id);
      updateHsToggle(sidebar);
    };
    sidebar.appendChild(opt);
  });

  // ── LAYOUT ──
  const layoutHeader = document.createElement('div');
  layoutHeader.className = 'sidebar-header';
  layoutHeader.textContent = 'Layout';
  sidebar.appendChild(layoutHeader);

  const layoutGrid = document.createElement('div');
  layoutGrid.id = 'sidebarLayoutGrid';
  layoutGrid.className = 'sidebar-layout-grid';
  sidebar.appendChild(layoutGrid);
  buildLayoutGrid(sidebar);

  // ── OPTIONS / Hidden Supplies ──
  const hsWrapper = document.createElement('label');
  hsWrapper.id = 'hsToggleWrapper';
  hsWrapper.className = 'sidebar-hs-toggle';
  hsWrapper.style.display = 'none';

  const hsCb = document.createElement('input');
  hsCb.type = 'checkbox';
  hsCb.id   = 'hiddenSuppliesToggle';
  hsCb.style.cssText = 'width:14px; height:14px; cursor:pointer; accent-color:#e94560;';
  hsCb.onchange = () => { hiddenSupplies = hsCb.checked; loadWtcImage(); };

  const hsLbl = document.createElement('span');
  hsLbl.textContent = 'Hidden Supplies';

  hsWrapper.appendChild(hsCb);
  hsWrapper.appendChild(hsLbl);
  sidebar.appendChild(hsWrapper);

  updateHsToggle(sidebar);
}

function buildLayoutGrid(container) {
  const grid = container
    ? container.querySelector('.sidebar-layout-grid')
    : document.querySelector('.sidebar-layout-grid');
  if (!grid) return;
  grid.innerHTML = '';
  for (let i = 1; i <= 8; i++) {
    const btn = document.createElement('button');
    btn.className = 'layout-btn' + (currentLayoutIndex === i - 1 ? ' active' : '');
    btn.textContent = i;
    const idx = i - 1;
    btn.onclick = () => {
      grid.querySelectorAll('.layout-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectLayout(idx);
    };
    grid.appendChild(btn);
  }
}

function updateHsToggle(container) {
  const show = currentTerrainFormat === 'wtc' && currentMission?.id === 'hammerAnvil';

  // Update all HS toggles — sidebar and mobile
  ['hsToggleWrapper', 'mobileHsToggle'].forEach(id => {
    const wrapper = document.getElementById(id);
    if (!wrapper) return;
    wrapper.style.display = show ? 'flex' : 'none';
    if (!show) {
      hiddenSupplies = false;
      const cb = wrapper.querySelector('input[type="checkbox"]');
      if (cb) cb.checked = false;
    }
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
  const isMobileEvent = () => window.innerWidth < 768;

  canvas.addEventListener('mousedown',  e => { if (!isMobileEvent()) handleMouseDown(e); });
  canvas.addEventListener('mousemove',  e => { if (!isMobileEvent()) handleMouseMove(e); });
  canvas.addEventListener('dblclick',   e => { if (!isMobileEvent()) handleDoubleClick(e); });
  canvas.addEventListener('mouseup',    e => { if (!isMobileEvent()) handleMouseUp(e); });
  canvas.addEventListener('mouseleave', e => { if (!isMobileEvent()) handleMouseUp(e); });
  canvas.addEventListener('contextmenu', e => e.preventDefault());
}

// ─── Selection Handlers ───────────────────────────────────────────────────────
function selectTerrainFormat(format) {
  currentTerrainFormat = format;
  currentLayoutIndex = 0;
  if (format !== 'wtc') { wtcImage = null; wtcImageSrc = null; }
  populateLayoutDropdown();
  updateHsToggle(document.getElementById('leftSidebar'));
  updateHsToggle(document.getElementById('mobileMenu'));
  if (format === 'wtc') loadWtcImage();
  else drawScene();
}

function selectLayout(index) {
  currentLayoutIndex = index;
  // Update active state in sidebar grid
  document.querySelectorAll('.layout-btn').forEach((b, i) => {
    b.classList.toggle('active', i === index);
  });
  if (currentTerrainFormat === 'wtc') loadWtcImage();
  else drawScene();
}

function selectMission(id) {
  currentMission = deployments.find(d => d.id === id);
  document.querySelectorAll('[data-id]').forEach(o => {
    o.classList.toggle('active', o.dataset.id === id);
  });
  updateHsToggle(document.getElementById('leftSidebar'));
  updateHsToggle(document.getElementById('mobileMenu'));
  if (currentTerrainFormat === 'wtc') { populateLayoutDropdown(); loadWtcImage(); }
  else drawScene();
}

function selectTool(tool) {
  // Toggle off if clicking the already-active tool (except models, which is default)
  if (currentTool === tool && tool !== 'models') {
    tool = 'models';
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
    showDrawingHint('🎯 Click to place models · Click base to select · Ctrl+click multi-select · Drag to move');
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
  // Pass 1 — draw modelGroup labels first (bottom layer)
  drawings.forEach((drawing, i) => {
    if (drawing.type === 'modelGroup') drawModelGroupLabel(drawing, i === modelsEditingIndex);
  });

  // Pass 2 — draw everything else on top (bases always above labels)
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

function isRotatable(group) {
  const sz = getBaseSize(group.baseSizeKey || '32');
  return sz.shape === 'oval' || sz.shape === 'rectangle';
}

function getRotationHandle(group) {
  if (!isRotatable(group) || modelsSelectedBases.size === 0) return null;
  const sz   = getBaseSize(group.baseSizeKey);
  const rw   = mmToPx(sz.w) / 2;
  const rh   = mmToPx(sz.h) / 2;
  const lastSel  = [...modelsSelectedBases].at(-1);
  const b        = group.bases[lastSel];
  const groupRot = (group.baseRotation || 0) * Math.PI / 180;
  const rot      = (b.rot !== undefined) ? b.rot : groupRot;
  const handleDist = Math.max(rw, rh) + 18;
  return {
    x: b.x + Math.cos(rot - Math.PI / 2) * handleDist,
    y: b.y + Math.sin(rot - Math.PI / 2) * handleDist,
    baseIndex: lastSel,
    bx: b.x, by: b.y,
  };
}

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

  // Check rotation handle first (left click, edit mode)
  if (e.button === 0 && modelsEditingIndex !== null) {
    const group  = drawings[modelsEditingIndex];
    const handle = getRotationHandle(group);
    if (handle && Math.hypot(x - handle.x, y - handle.y) <= 10) {
      modelsRotating     = true;
      modelsRotateAnchor = { x: handle.bx, y: handle.by };
      modelsRotateStart  = Math.atan2(y - handle.by, x - handle.bx);
      return;
    }
  }

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
  const shape   = sz.shape || 'circle';
  const rot     = (shape === 'oval' || shape === 'rectangle')
                  ? parseInt(document.getElementById('baseRotation')?.value || '0') : 0;
  const count   = parseInt(document.getElementById('modelCount').value) || 1;
  const wPx     = mmToPx(rot === 90 ? sz.h : sz.w);
  const hPx     = mmToPx(rot === 90 ? sz.w : sz.h);
  const bases   = buildModelGrid(x, y, count, wPx, hPx);
  const label   = document.getElementById('unitName').value || 'Unit';
  const group   = { type: 'modelGroup', label, color: currentColor, baseSizeKey: sizeKey, shape, baseRotation: rot, bases };
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

  // Models rotation drag
  if (currentTool === 'models' && modelsRotating && modelsEditingIndex !== null) {
    const currentAngle = Math.atan2(y - modelsRotateAnchor.y, x - modelsRotateAnchor.x);
    const delta        = currentAngle - modelsRotateStart;
    modelsRotateStart  = currentAngle;
    const group    = drawings[modelsEditingIndex];
    const groupRot = (group.baseRotation || 0) * Math.PI / 180;
    modelsSelectedBases.forEach(bi => {
      const b   = group.bases[bi];
      const cur = (b.rot !== undefined) ? b.rot : groupRot;
      b.rot = cur + delta;
    });
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
  if (modelsRotating) {
    modelsRotating     = false;
    modelsRotateAnchor = null;
    modelsRotateStart  = null;
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

    // Status badge
    const badge = document.createElement('span');
    badge.className = 'unit-status-badge ' + (d.fromList ? 'deployed' : 'manual');
    badge.textContent = d.fromList ? '✓' : 'M';
    badge.title = d.fromList ? 'From imported list' : 'Manually placed';

    const del = document.createElement('span');
    del.textContent = '🗑️';
    del.className = 'unit-action-btn';
    del.title = 'Delete';
    del.onclick = ev => {
      ev.stopPropagation();
      modalConfirm('Delete Unit', `Delete "${d.label || 'Unit'}"?`, 'Delete', true).then(ok => {
        if (ok) {
          if (modelsEditingIndex === i) { modelsEditingIndex = null; modelsSelectedBases.clear(); }
          // Return to staging if from list
          if (d.fromList && d.unitId) returnUnitToStaging(d.unitId);
          drawings.splice(i, 1);
          drawScene();
          updateUnitsList();
        }
      });
    };

    item.appendChild(dot);
    item.appendChild(lbl);
    item.appendChild(badge);
    item.appendChild(del);

    // Left click — select all bases in this group
    item.onclick = ev => {
      if (ev.target === del) return;
      if (d.type === 'modelGroup') {
        modelsEditingIndex = i;
        modelsSelectedBases = new Set(d.bases.map((_, bi) => bi));
        selectTool('models');
        drawScene();
      }
    };

    // Right click — rename
    item.oncontextmenu = ev => {
      ev.preventDefault();
      modalPrompt('Rename Unit', 'Enter unit name:', d.label || 'Unit', 'Unit name...').then(n => {
        if (n !== null && n.trim()) { drawings[i].label = n.trim(); drawScene(); updateUnitsList(); }
      });
    };

    // Tooltip hint
    item.title = 'Click to select all • Right-click to rename';
    list.appendChild(item);
  });
}

// ─── Hints ────────────────────────────────────────────────────────────────────
function showDrawingHint(text) {
  if (window.innerWidth < 768) return;
  const wrapper = document.getElementById('canvasWrapper');
  if (!hintElement) {
    hintElement = document.createElement('div');
    hintElement.className = 'drawing-hint';

    const closeBtn = document.createElement('span');
    closeBtn.textContent = '✕';
    closeBtn.className = 'drawing-hint-close';
    closeBtn.onclick = (e) => {
      e.stopPropagation();
      hideDrawingHint();
      drawingHintShown = true;
    };
    hintElement.appendChild(closeBtn);

    const textSpan = document.createElement('span');
    hintElement.appendChild(textSpan);
    hintElement._textSpan = textSpan;

    wrapper.appendChild(hintElement);
  }
  (hintElement._textSpan || hintElement).textContent = text || '👆 Click to add points — Double-click to finish unit';
}

function hideDrawingHint() {
  if (hintElement) { hintElement.remove(); hintElement = null; }
}

function updateHintForTool() {
  hideDrawingHint();
  if (currentTool === 'models') {
    showDrawingHint('🎯 Click to place models · Click base to select · Ctrl+click multi-select · Drag to move');
  }
}

// ─── Save / Load (Pro Cloud) ──────────────────────────────────────────────────

function updateSaveLoadButtons() {
  const saveBtn = document.getElementById('saveBtn');
  const loadBtn = document.getElementById('loadBtn');
  if (!saveBtn || !loadBtn) return;
  const show = isPro();
  saveBtn.style.display = show ? 'inline-block' : 'none';
  loadBtn.style.display = show ? 'inline-block' : 'none';
}

async function saveDeployment() {
  if (!isPro()) return;

  const name = await modalPrompt('Save Deployment', 'Give this deployment a name:', '', 'e.g. WTC Round 1 vs Space Marines');
  if (!name || !name.trim()) return;

  try {
    const payload = {
      name:          name.trim(),
      mission:       currentMission?.id || null,
      faction:       importedList?.faction || null,
      terrainFormat: currentTerrainFormat,
      layoutIndex:   currentLayoutIndex,
      edition:       importedList?.edition || '10th',
      boardData:     drawings,
    };
    await apiCall('POST', '/deployments', payload, true);
    modalAlert('Saved!', `"${name.trim()}" has been saved to your account.`);
  } catch (e) {
    modalAlert('Error', 'Could not save deployment: ' + e.message);
  }
}

async function openDeploymentsModal() {
  if (!isPro()) return;
  document.getElementById('deploymentsModalOverlay').style.display = 'flex';
  const body = document.getElementById('deploymentsListBody');
  body.innerHTML = '<div class="deployments-loading">Loading...</div>';

  try {
    const data = await apiCall('GET', '/deployments', null, true);
    renderDeploymentsList(data.deployments || []);
  } catch (e) {
    body.innerHTML = `<div class="deployments-empty">Could not load deployments: ${e.message}</div>`;
  }
}

function closeDeploymentsModal() {
  document.getElementById('deploymentsModalOverlay').style.display = 'none';
}

function renderDeploymentsList(deployments) {
  const body = document.getElementById('deploymentsListBody');
  body.innerHTML = '';

  if (deployments.length === 0) {
    body.innerHTML = '<div class="deployments-empty">No saved deployments yet.<br>Use 💾 Save to save your first deployment.</div>';
    return;
  }

  // Sort by most recent first
  deployments.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

  deployments.forEach(dep => {
    const item = document.createElement('div');
    item.className = 'deployment-item';

    const icon = document.createElement('div');
    icon.className = 'deployment-item-icon';
    icon.textContent = '⚔️';

    const info = document.createElement('div');
    info.className = 'deployment-item-info';

    const name = document.createElement('div');
    name.className = 'deployment-item-name';
    name.textContent = dep.name;

    const meta = document.createElement('div');
    meta.className = 'deployment-item-meta';
    const date = new Date(dep.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const parts = [dep.mission, dep.faction, date].filter(Boolean);
    meta.textContent = parts.join(' · ');

    info.appendChild(name);
    info.appendChild(meta);

    const actions = document.createElement('div');
    actions.className = 'deployment-item-actions';

    const loadBtn = document.createElement('button');
    loadBtn.className = 'modal-btn modal-btn-primary';
    loadBtn.style.padding = '5px 12px';
    loadBtn.style.fontSize = '12px';
    loadBtn.textContent = 'Load';
    loadBtn.onclick = () => loadDeployment(dep.deploymentId);

    const delBtn = document.createElement('button');
    delBtn.className = 'modal-btn modal-btn-danger';
    delBtn.style.padding = '5px 12px';
    delBtn.style.fontSize = '12px';
    delBtn.textContent = '🗑️';
    delBtn.onclick = () => deleteDeployment(dep.deploymentId, dep.name, item);

    actions.appendChild(loadBtn);
    actions.appendChild(delBtn);

    item.appendChild(icon);
    item.appendChild(info);
    item.appendChild(actions);
    body.appendChild(item);
  });
}

async function loadDeployment(deploymentId) {
  try {
    const dep = await apiCall('GET', `/deployments/${deploymentId}`, null, true);

    if (dep.terrainFormat) selectTerrainFormat(dep.terrainFormat);
    if (dep.mission) selectMission(dep.mission);
    if (dep.layoutIndex !== undefined) selectLayout(dep.layoutIndex);
    drawings = dep.boardData || [];
    closeDeploymentsModal();
    drawScene();
    updateUnitsList();
  } catch (e) {
    modalAlert('Error', 'Could not load deployment: ' + e.message);
  }
}

async function deleteDeployment(deploymentId, name, itemEl) {
  const ok = await modalConfirm('Delete Deployment', `Delete "${name}"? This cannot be undone.`, 'Delete', true);
  if (!ok) return;
  try {
    await apiCall('DELETE', `/deployments/${deploymentId}`, null, true);
    itemEl.remove();
    const body = document.getElementById('deploymentsListBody');
    if (!body.children.length) {
      body.innerHTML = '<div class="deployments-empty">No saved deployments yet.</div>';
    }
  } catch (e) {
    modalAlert('Error', 'Could not delete deployment: ' + e.message);
  }
}

// ─── Clear ────────────────────────────────────────────────────────────────────
function clearCanvas() {
  modalConfirm('Clear Board', 'Remove all drawings from the board? Imported list units will return to staging.', 'Clear', true).then(ok => {
    if (ok) {
      // Return all list units to staging
      drawings.forEach(d => {
        if (d.fromList && d.unitId) returnUnitToStaging(d.unitId);
      });
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
  const isMobile = window.innerWidth < 768;
  if (isMobile) {
    const ratio = 900 / 660;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (vw / vh > ratio) {
      canvas.style.height = vh + 'px';
      canvas.style.width  = (vh * ratio) + 'px';
    } else {
      canvas.style.width  = vw + 'px';
      canvas.style.height = (vw / ratio) + 'px';
    }
    return;
  }
  const wrapper = document.getElementById('canvasWrapper');
  const W = wrapper.clientWidth - 8;
  const H = wrapper.clientHeight - 8;
  const ratio = 900 / 660;
  if (W / H > ratio) {
    canvas.style.height = H + 'px';
    canvas.style.width = (H * ratio) + 'px';
  } else {
    canvas.style.width = W + 'px';
    canvas.style.height = (W / ratio) + 'px';
  }
}

// ─── Mobile Hamburger Menu ────────────────────────────────────────────────────

function buildMobileMenu() {
  const menu = document.getElementById('mobileMenu');
  if (!menu) return;
  menu.innerHTML = '';

  // ── ACCOUNT ──
  const acctHeader = document.createElement('div');
  acctHeader.className = 'mobile-section-header';
  acctHeader.textContent = 'Account';
  menu.appendChild(acctHeader);

  if (!isLoggedIn()) {
    const loginBtn = document.createElement('button');
    loginBtn.className = 'mobile-menu-btn';
    loginBtn.textContent = '👤 Log In / Sign Up';
    loginBtn.onclick = () => { closeMobileMenu(); openAuthModal('login'); };
    menu.appendChild(loginBtn);

    const proBtn = document.createElement('button');
    proBtn.className = 'mobile-menu-btn mobile-pro-btn';
    proBtn.textContent = '⚡ Go Pro — $5/mo';
    proBtn.onclick = () => { closeMobileMenu(); goPro(); };
    menu.appendChild(proBtn);
  } else {
    const emailDiv = document.createElement('div');
    emailDiv.className = 'mobile-menu-email';
    emailDiv.textContent = currentUser.email;
    if (isPro()) {
      const badge = document.createElement('span');
      badge.className = 'nav-pro-badge';
      badge.textContent = 'PRO';
      badge.style.marginLeft = '6px';
      emailDiv.appendChild(badge);
    }
    menu.appendChild(emailDiv);

    if (!isPro()) {
      const proBtn = document.createElement('button');
      proBtn.className = 'mobile-menu-btn mobile-pro-btn';
      proBtn.textContent = '⚡ Go Pro — $5/mo';
      proBtn.onclick = () => { closeMobileMenu(); goPro(); };
      menu.appendChild(proBtn);
    }

    const logoutBtn = document.createElement('button');
    logoutBtn.className = 'mobile-menu-btn';
    logoutBtn.textContent = '🚪 Log Out';
    logoutBtn.onclick = () => { closeMobileMenu(); logout(); };
    menu.appendChild(logoutBtn);
  }

  // ── BOARD ──
  const boardHeader = document.createElement('div');
  boardHeader.className = 'mobile-section-header';
  boardHeader.textContent = 'Board';
  menu.appendChild(boardHeader);

  const aboutBtn = document.createElement('a');
  aboutBtn.href = 'about.html';
  aboutBtn.className = 'mobile-menu-btn';
  aboutBtn.style.textDecoration = 'none';
  aboutBtn.style.display = 'block';
  aboutBtn.textContent = '❓ About & Help';
  menu.appendChild(aboutBtn);

  const clearBtn = document.createElement('button');
  clearBtn.className = 'mobile-menu-btn';
  clearBtn.textContent = '🗑️ Clear Board';
  clearBtn.onclick = () => { closeMobileMenu(); clearCanvas(); };
  menu.appendChild(clearBtn);

  if (isPro()) {
    const saveBtn = document.createElement('button');
    saveBtn.className = 'mobile-menu-btn';
    saveBtn.textContent = '💾 Save Deployment';
    saveBtn.onclick = () => { closeMobileMenu(); saveDeployment(); };
    menu.appendChild(saveBtn);

    const loadBtn = document.createElement('button');
    loadBtn.className = 'mobile-menu-btn';
    loadBtn.textContent = '📂 My Deployments';
    loadBtn.onclick = () => { closeMobileMenu(); openDeploymentsModal(); };
    menu.appendChild(loadBtn);
  }

  // ── FORMAT ──
  const fmtHeader = document.createElement('div');
  fmtHeader.className = 'mobile-section-header';
  fmtHeader.textContent = 'Format';
  menu.appendChild(fmtHeader);

  [{ value: 'gw', label: 'GW' }, { value: 'wtc', label: 'WTC' }, { value: 'uktc', label: 'UKTC (soon)' }].forEach(fmt => {
    const btn = document.createElement('button');
    btn.className = 'mobile-menu-btn' + (currentTerrainFormat === fmt.value ? ' active' : '');
    btn.textContent = fmt.label;
    btn.dataset.format = fmt.value;
    btn.onclick = () => {
      menu.querySelectorAll('[data-format]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectTerrainFormat(fmt.value);
      buildLayoutGrid(menu);
      updateHsToggle(menu);
    };
    menu.appendChild(btn);
  });

  // ── MISSION ──
  const missionHeader = document.createElement('div');
  missionHeader.className = 'mobile-section-header';
  missionHeader.textContent = 'Mission';
  menu.appendChild(missionHeader);

  deployments.forEach(mission => {
    const btn = document.createElement('button');
    btn.className = 'mobile-menu-btn' + (mission === currentMission ? ' active' : '');
    btn.textContent = mission.name;
    btn.dataset.id = mission.id;
    btn.onclick = () => {
      menu.querySelectorAll('[data-id]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectMission(mission.id);
      updateHsToggle(menu);
    };
    menu.appendChild(btn);
  });

  // ── LAYOUT ──
  const layoutHeader = document.createElement('div');
  layoutHeader.className = 'mobile-section-header';
  layoutHeader.textContent = 'Layout';
  menu.appendChild(layoutHeader);

  const layoutGrid = document.createElement('div');
  layoutGrid.id = 'mobileLayoutGrid';
  layoutGrid.className = 'sidebar-layout-grid';
  menu.appendChild(layoutGrid);
  buildLayoutGrid(menu);

  // ── Hidden Supplies ──
  const hsWrapper = document.createElement('label');
  hsWrapper.id = 'mobileHsToggle';
  hsWrapper.className = 'sidebar-hs-toggle';
  hsWrapper.style.display = 'none';
  const hsCb = document.createElement('input');
  hsCb.type = 'checkbox';
  hsCb.style.cssText = 'width:14px; height:14px; cursor:pointer; accent-color:#e94560;';
  hsCb.onchange = () => { hiddenSupplies = hsCb.checked; loadWtcImage(); };
  const hsLbl = document.createElement('span');
  hsLbl.textContent = 'Hidden Supplies';
  hsWrapper.appendChild(hsCb);
  hsWrapper.appendChild(hsLbl);
  menu.appendChild(hsWrapper);
  updateHsToggle(menu);
}

function openMobileMenu() {
  buildMobileMenu();
  document.getElementById('mobileMenuOverlay').style.display = 'block';
  document.getElementById('mobileMenu').classList.add('open');
}

function closeMobileMenu() {
  document.getElementById('mobileMenuOverlay').style.display = 'none';
  document.getElementById('mobileMenu').classList.remove('open');
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
window.addEventListener('resize', () => { resizeCanvas(); drawScene(); });
init();
