/**
 * @module floor/floor_themes_camera.js
 * @description AgentFloor Themes, Camera & Coordinate Projection.
 * Canvas context initialization, floor visual themes (`FLOOR_THEMES`), camera
 * rotation/view-mode state, and 2D/isometric screen-to-world coordinate transforms.
 *
 * Part of the AgentFloor canvas subsystem (concatenated globally by frontend/build.py).
 */

// --- Pixel Virtual Office Canvas Loop ---
const canvas = document.getElementById('officeCanvas');
const ctx = canvas.getContext('2d');
const tooltip = document.getElementById('canvas-tooltip');
let animFrame = 0;
let hoveredAgent = null;
let isBriefingActive = false;
let isConferenceActive = false;
let conferenceSpeaker = null;

const CONFERENCE_CHAIR_SLOTS = [
  { x: 440, y: 85 },
  { x: 490, y: 85 },
  { x: 540, y: 85 },
  { x: 590, y: 85 },
  { x: 440, y: 168 },
  { x: 490, y: 168 },
  { x: 540, y: 168 },
  { x: 590, y: 168 }
];

// --- BL-AGF-10: AgentFloor Thematic Styling Engine ---
const FLOOR_THEMES = {
  cyberpunk: {
    id: 'cyberpunk',
    name: 'Cyberpunk Dark',
    floorBase: '#0d131f',
    floorTile: '#152138',
    wallBorder: '#00f0ff',
    wallFill: '#1a2744',
    wallHighlight: '#00f0ff',
    execCarpet: '#111c30',
    execRug: '#0f172a',
    execPlaqueBorder: '#00f0ff',
    execPlaqueText: '#00f0ff',
    confCarpet: '#101a2c',
    confBorder: '#00f0ff',
    breakCarpet: '#121e33',
    restroomCarpet: '#0a192f',
    restroomTile: '#172a45',
    deskTop: '#1b2a4a',
    deskBorder: '#00f0ff',
    deskLead: '#0f3a40',
    chairColor: '#0c1b33',
    chairBack: '#00f0ff'
  },
  techloft: {
    id: 'techloft',
    name: 'Tech Loft Oak',
    floorBase: '#2a221b',
    floorTile: '#382e24',
    wallBorder: '#78350f',
    wallFill: '#451a03',
    wallHighlight: '#92400e',
    execCarpet: '#3b2f27',
    execRug: '#4d3d33',
    execPlaqueBorder: '#f59e0b',
    execPlaqueText: '#fbbf24',
    confCarpet: '#332921',
    confBorder: '#d97706',
    breakCarpet: '#3b2f27',
    restroomCarpet: '#242a2e',
    restroomTile: '#334155',
    deskTop: '#6d4525',
    deskBorder: '#8c5932',
    deskLead: '#451a03',
    chairColor: '#3f3027',
    chairBack: '#271f1a'
  },
  retro8bit: {
    id: 'retro8bit',
    name: 'Retro 8-Bit Arcade',
    floorBase: '#1a102f',
    floorTile: '#2e1c52',
    wallBorder: '#ec4899',
    wallFill: '#3b1d6b',
    wallHighlight: '#a855f7',
    execCarpet: '#241442',
    execRug: '#34195e',
    execPlaqueBorder: '#f43f5e',
    execPlaqueText: '#fb7185',
    confCarpet: '#22123d',
    confBorder: '#c084fc',
    breakCarpet: '#271545',
    restroomCarpet: '#151b36',
    restroomTile: '#263159',
    deskTop: '#4c1d95',
    deskBorder: '#a855f7',
    deskLead: '#581c87',
    chairColor: '#311459',
    chairBack: '#ec4899'
  },
  executive: {
    id: 'executive',
    name: 'Executive Penthouse',
    floorBase: '#1c1f24',
    floorTile: '#282d34',
    wallBorder: '#d4af37',
    wallFill: '#2a2f38',
    wallHighlight: '#fbbf24',
    execCarpet: '#19222c',
    execRug: '#1e2b38',
    execPlaqueBorder: '#d4af37',
    execPlaqueText: '#fef08a',
    confCarpet: '#1a232e',
    confBorder: '#eab308',
    breakCarpet: '#1f262f',
    restroomCarpet: '#1e293b',
    restroomTile: '#334155',
    deskTop: '#3b2818',
    deskBorder: '#d4af37',
    deskLead: '#2d1808',
    chairColor: '#1e293b',
    chairBack: '#d4af37'
  }
};

let activeFloorTheme = localStorage.getItem('nexusdesk_floor_theme_v2') || 'techloft';
let floorViewMode = localStorage.getItem('nexusdesk_floor_view_mode_v2') || 'hd_loft'; // 'hd_loft', '2d', '2.5d', '3d'
let currentIsoRot = parseInt(localStorage.getItem('nexusdesk_iso_rot') || '0', 10);
let cachedStaticBuffer = null;

// 2:1 Isometric Pixel Loft Projection (matches media_1794043231599_099d37e5.jpg)
function toLoftIso(wx, wy) {
  const u = wx / 1040;
  const v = wy / 540;
  const sx = 420 + u * 595 - v * 395;
  const sy = 52 + u * 232 + v * 218;
  return { x: sx, y: sy, sx, sy };
}

function fromLoftIso(rawX, rawY) {
  const dx = rawX - 420;
  const dy = rawY - 52;
  const det = 595 * 218 - (-395) * 232; // 221350
  const u = (218 * dx + 395 * dy) / det;
  const v = (595 * dy - 232 * dx) / det;
  return {
    x: Math.max(0, Math.min(1040, u * 1040)),
    y: Math.max(0, Math.min(540, v * 540))
  };
}

function invalidateIsoBuffer() {
  cachedStaticBuffer = null;
}

function rotateIsoCamera() {
  currentIsoRot = ((currentIsoRot || 0) + 1) % 4;
  localStorage.setItem('nexusdesk_iso_rot', currentIsoRot);
  invalidateIsoBuffer();
  updateViewModeUI();
}

function changeFloorTheme(themeKey) {
  if (FLOOR_THEMES[themeKey]) {
    activeFloorTheme = themeKey;
    localStorage.setItem('nexusdesk_floor_theme_v2', themeKey);
    localStorage.setItem('nexusdesk_floor_theme', themeKey);
    invalidateIsoBuffer();
    const sel = document.getElementById('select-floor-theme');
    if (sel) sel.value = themeKey;
  }
}

function setFloorViewMode(mode) {
  if (['hd_loft', '2d', '2.5d', '3d', 'iso'].includes(mode)) {
    floorViewMode = (mode === 'iso') ? '3d' : mode;
    localStorage.setItem('nexusdesk_floor_view_mode_v2', floorViewMode);
    localStorage.setItem('nexusdesk_floor_view_mode', floorViewMode);
    invalidateIsoBuffer();
    updateViewModeUI();
  }
}

function updateViewModeUI() {
  const selView = document.getElementById('select-floor-view-mode');
  if (selView && ['hd_loft', '2d', '3d'].includes(floorViewMode)) {
    selView.value = floorViewMode;
  }

  const b2d = document.getElementById('btn-view-2d');
  const b25d = document.getElementById('btn-view-25d');
  const b3d = document.getElementById('btn-view-3d');
  const bRot = document.getElementById('btn-iso-rotate');

  [b2d, b25d, b3d].filter(Boolean).forEach(b => {
    b.className = 'px-2 py-1 rounded text-[10px] font-mono font-bold transition text-slate-400 hover:text-white cursor-pointer';
  });

  if (floorViewMode === '2d' || floorViewMode === 'hd_loft') {
    if (b2d) b2d.className = 'px-2 py-1 rounded text-[10px] font-mono font-bold transition bg-cyan-950 text-cyan-300 border border-cyan-700/80 cursor-pointer';
    if (bRot) bRot.classList.add('hidden');
  } else if (floorViewMode === '2.5d') {
    if (b25d) b25d.className = 'px-2 py-1 rounded text-[10px] font-mono font-bold transition bg-purple-950 text-purple-300 border border-purple-700/80 cursor-pointer';
    if (bRot) bRot.classList.add('hidden');
  } else {
    if (b3d) b3d.className = 'px-2 py-1 rounded text-[10px] font-mono font-bold transition bg-amber-950 text-amber-300 border border-amber-700/80 cursor-pointer';
    if (bRot) {
      bRot.classList.remove('hidden');
      bRot.textContent = `🔄 ${(currentIsoRot || 0) * 90}°`;
    }
  }
}

// Map screen mouse event to floor world coordinates (accounts for hd_loft / 2.5D / 3D transforms)
function getCanvasFloorCoords(e) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const rawX = (e.clientX - rect.left) * scaleX;
  const rawY = (e.clientY - rect.top) * scaleY;

  if (floorViewMode === '2d') {
    return { x: rawX, y: rawY };
  }

  if (floorViewMode === 'hd_loft') {
    return fromLoftIso(rawX, rawY);
  }

  if (floorViewMode === '3d' || floorViewMode === 'iso') {
    // Analytical inverse of 2:1 isometric projection:
    // sx = (rx - ry) * (tw / 2) + ox
    // sy = (rx + ry) * (th / 2) - (z * zh) + oy (with z = 0 ground plane)
    const cam = { rot: currentIsoRot || 0, ox: 520, oy: 140, tw: 48, th: 24, zh: 18 };
    const w = 16, h = 16;
    const dx = (rawX - cam.ox) / (cam.tw / 2);
    const dy = (rawY - cam.oy) / (cam.th / 2);
    const rx = (dx + dy) / 2;
    const ry = (dy - dx) / 2;

    let gx, gy;
    switch (((cam.rot % 4) + 4) % 4) {
      case 0: gx = rx; gy = ry; break;
      case 1: gx = ry; gy = h - 1 - rx; break;
      case 2: gx = w - 1 - rx; gy = h - 1 - ry; break;
      default: gx = w - 1 - ry; gy = rx; break;
    }

    return {
      x: Math.max(0, Math.min(1040, (gx / (w - 1)) * 1040)),
      y: Math.max(0, Math.min(540, (gy / (h - 1)) * 540))
    };
  }

  const cx = 520, cy = 266;
  const dx = rawX - cx;
  const dy = rawY - cy;

  if (floorViewMode === '2.5d') {
    // Forward transform: x' = cx + 0.88*x - 0.10*y, y' = cy + 0.03*x + 0.80*y
    const a = 0.88, b = 0.03, c = -0.10, d = 0.80;
    const det = a * d - b * c;
    return {
      x: cx + (d * dx - c * dy) / det,
      y: cy + (-b * dx + a * dy) / det
    };
  }

  return { x: rawX, y: rawY };
}
