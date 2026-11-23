'use strict';

/** Three-tone voxel facet lighting constants (skylight, ambient bounce, shadow) */
const FACE = { top: 1.0, left: 0.86, right: 0.64 };

/**
 * Rotate discrete grid cell coordinates clockwise in 90-degree steps.
 * Grid dimensions swap when rot is odd (1 or 3).
 */
function rotateCell(x, y, rot, w, h) {
  switch (((rot % 4) + 4) % 4) {
    case 0: return { x, y };
    case 1: return { x: h - 1 - y, y: x };
    case 2: return { x: w - 1 - x, y: h - 1 - y };
    default: return { x: y, y: w - 1 - x };
  }
}

/**
 * Project grid (x, y, z) into 2:1 isometric screen coordinates.
 * sx = (rx - ry) * (tw / 2) + ox
 * sy = (rx + ry) * (th / 2) - (z * zh) + oy
 */
function project(x, y, z, cam, w, h) {
  const r = rotateCell(x, y, cam.rot, w, h);
  return {
    rx: r.x,
    ry: r.y,
    sx: (r.x - r.y) * (cam.tw / 2) + cam.ox,
    sy: (r.x + r.y) * (cam.th / 2) - (z * cam.zh) + cam.oy
  };
}

/**
 * Multiply hex color by factor k (0..1) for facet shading.
 */
function shade(hex, k) {
  const cleanHex = hex.startsWith('#') ? hex.slice(1) : hex;
  const n = parseInt(cleanHex.length === 3 ? cleanHex.split('').map(c => c + c).join('') : cleanHex, 16);
  const c = (v) => Math.min(255, Math.max(0, Math.round(v * k))).toString(16).padStart(2, '0');
  return '#' + c((n >> 16) & 255) + c((n >> 8) & 255) + c(n & 255);
}

/**
 * Draw a single 3D shaded voxel cube with three visible facets.
 * (sx, sy) represents the top-center vertex of the top face.
 */
function drawVoxelCube(ctx, sx, sy, color, cam) {
  const hw = cam ? cam.tw / 2 : 24;
  const hh = cam ? cam.th / 2 : 12;
  const d = cam ? cam.zh : 18;

  const poly = (pts, fill) => {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  };

  // Left Face (Ambient)
  poly([[sx - hw, sy], [sx, sy + hh], [sx, sy + hh + d], [sx - hw, sy + d]], shade(color, FACE.left));
  // Right Face (Shadow)
  poly([[sx + hw, sy], [sx, sy + hh], [sx, sy + hh + d], [sx + hw, sy + d]], shade(color, FACE.right));
  // Top Face (Direct Skylight)
  poly([[sx, sy - hh], [sx + hw, sy], [sx, sy + hh], [sx - hw, sy]], shade(color, FACE.top));
}

/**
 * Draw an arbitrary isometric 3D box (cuboid) at top-center anchor (sx, sy).
 */
function drawIsoBox(ctx, sx, sy, hw, hh, d, color) {
  const poly = (pts, fill) => {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  };

  // Left Face (Front-left)
  poly([
    [sx - hw, sy],
    [sx, sy + hh],
    [sx, sy + hh + d],
    [sx - hw, sy + d]
  ], shade(color, FACE.left));

  // Right Face (Side-right)
  poly([
    [sx, sy + hh],
    [sx + hw, sy],
    [sx + hw, sy + d],
    [sx, sy + hh + d]
  ], shade(color, FACE.right));

  // Top Face (Direct Skylight)
  poly([
    [sx, sy - hh],
    [sx + hw, sy],
    [sx, sy + hh],
    [sx - hw, sy]
  ], shade(color, FACE.top));
}

/**
 * Draw a pattern patch onto the Left Face (front) of an isometric box.
 */
function drawLeftPatch(ctx, sx, sy, hw, hh, d, u0, u1, v0, v1, color) {
  const p = (u, v) => [sx + (u - 1) * hw, sy + u * hh + v * d];
  const pts = [p(u0, v0), p(u1, v0), p(u1, v1), p(u0, v1)];
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
  ctx.fillStyle = shade(color, FACE.left);
  ctx.fill();
}

/**
 * Draw a pattern patch onto the Right Face (side) of an isometric box.
 */
function drawRightPatch(ctx, sx, sy, hw, hh, d, s0, s1, v0, v1, color) {
  const p = (s, v) => [sx + s * hw, sy + (1 - s) * hh + v * d];
  const pts = [p(s0, v0), p(s1, v0), p(s1, v1), p(s0, v1)];
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
  ctx.fillStyle = shade(color, FACE.right);
  ctx.fill();
}

/**
 * Draw a pattern patch onto the Top Face of an isometric box.
 */
function drawTopPatch(ctx, sx, sy, hw, hh, u0, u1, s0, s1, color) {
  const p = (u, s) => [sx + (u + s - 1) * hw, sy + (u - s) * hh];
  const pts = [p(u0, s0), p(u1, s0), p(u1, s1), p(u0, s1)];
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
  ctx.fillStyle = shade(color, FACE.top);
  ctx.fill();
}

// =============================================================================
// MINECRAFT FURNITURE BUILD HACKS
// =============================================================================

/**
 * 1. Minecraft Water Cooler:
 * Quartz cabinet base + drip tray + red/blue taps + side cup dispenser +
 * upside-down 5-gallon blue stained glass water jug with air bubble.
 */
function drawMinecraftWaterCooler(ctx, sx, sy) {
  const base_hw = 8, base_hh = 4, base_d = 16;
  drawIsoBox(ctx, sx, sy - 16, base_hw, base_hh, base_d, '#e2e8f0');

  // Recessed drip tray on Left Face
  drawLeftPatch(ctx, sx, sy - 16, base_hw, base_hh, base_d, 0.25, 0.75, 0.25, 0.60, '#334155');

  // Spout / Taps (Cold blue and Hot red spigots)
  drawLeftPatch(ctx, sx, sy - 16, base_hw, base_hh, base_d, 0.35, 0.48, 0.20, 0.32, '#0284c7');
  drawLeftPatch(ctx, sx, sy - 16, base_hw, base_hh, base_d, 0.52, 0.65, 0.20, 0.32, '#ef4444');

  // Cup dispenser cylinder on Right Face
  drawRightPatch(ctx, sx, sy - 16, base_hw, base_hh, base_d, 0.70, 0.90, 0.15, 0.85, '#94a3b8');
  drawRightPatch(ctx, sx, sy - 16, base_hw, base_hh, base_d, 0.72, 0.88, 0.20, 0.80, '#ffffff');

  // 5-Gallon Water Jug on top
  const jug_hw = 6.5, jug_hh = 3.25, jug_d = 14;
  const jug_sy = sy - 32;

  // Blue bottle collar
  drawIsoBox(ctx, sx, sy - 30, 4, 2, 3, '#0284c7');

  // Transparent light blue glass bottle body
  drawIsoBox(ctx, sx, jug_sy, jug_hw, jug_hh, jug_d, '#38bdf8');

  // Glass sheen and water reflections
  drawLeftPatch(ctx, sx, jug_sy, jug_hw, jug_hh, jug_d, 0.15, 0.35, 0.15, 0.85, '#bae6fd');
  drawTopPatch(ctx, sx, jug_sy, jug_hw, jug_hh, 0.2, 0.8, 0.2, 0.8, '#e0f2fe');
  drawLeftPatch(ctx, sx, jug_sy, jug_hw, jug_hh, jug_d, 0.55, 0.75, 0.40, 0.55, '#0284c7');
}

/**
 * 2. Minecraft Toilet:
 * Quartz bowl with water basin inside + iron trapdoor seat rim +
 * upright quartz cistern tank + metallic flush lever on side.
 */
function drawMinecraftToilet(ctx, sx, sy) {
  // Toilet Bowl (White quartz base with indented basin)
  const bowl_hw = 7, bowl_hh = 3.5, bowl_d = 10;
  drawIsoBox(ctx, sx, sy - 10, bowl_hw, bowl_hh, bowl_d, '#ffffff');

  // Blue water inside the bowl
  drawTopPatch(ctx, sx, sy - 10, bowl_hw, bowl_hh, 0.20, 0.80, 0.20, 0.80, '#0284c7');

  // Silver / Iron trapdoor seat rim
  drawTopPatch(ctx, sx, sy - 10, bowl_hw, bowl_hh, 0.10, 0.90, 0.10, 0.20, '#cbd5e1');
  drawTopPatch(ctx, sx, sy - 10, bowl_hw, bowl_hh, 0.10, 0.90, 0.80, 0.90, '#cbd5e1');
  drawTopPatch(ctx, sx, sy - 10, bowl_hw, bowl_hh, 0.10, 0.20, 0.10, 0.90, '#cbd5e1');
  drawTopPatch(ctx, sx, sy - 10, bowl_hw, bowl_hh, 0.80, 0.90, 0.10, 0.90, '#cbd5e1');

  // Toilet Tank (Cistern standing at back)
  const tank_hw = 7, tank_hh = 3.5, tank_d = 14;
  const tank_sx = sx + 3.5;
  const tank_sy = sy - 20;
  drawIsoBox(ctx, tank_sx, tank_sy, tank_hw, tank_hh, tank_d, '#f8fafc');

  // Tank lid highlight
  drawTopPatch(ctx, tank_sx, tank_sy, tank_hw, tank_hh, 0, 1, 0, 1, '#ffffff');

  // Silver flush lever on side
  drawRightPatch(ctx, tank_sx, tank_sy, tank_hw, tank_hh, tank_d, 0.20, 0.45, 0.20, 0.35, '#94a3b8');
  drawRightPatch(ctx, tank_sx, tank_sy, tank_hw, tank_hh, tank_d, 0.45, 0.75, 0.30, 0.45, '#64748b');
}

/**
 * 3. Minecraft Office Workstation Desk with Computer Setup:
 * Polished dark wood slab + legs/drawers + CPU tower with glowing LED +
 * flat-screen monitor with code glow + pressure plate keyboard + mouse button + coffee mug.
 */
function drawMinecraftWorkstation(ctx, sx, sy, opts = {}) {
  const top_hw = 20, top_hh = 10, top_d = 4;
  const desk_y = sy - 14;

  // CPU Tower underneath on right side
  const cpu_hw = 4, cpu_hh = 2, cpu_d = 12;
  drawIsoBox(ctx, sx + 12, sy - 12, cpu_hw, cpu_hh, cpu_d, '#0f172a');
  drawLeftPatch(ctx, sx + 12, sy - 12, cpu_hw, cpu_hh, cpu_d, 0.2, 0.8, 0.15, 0.25, '#38bdf8');
  drawLeftPatch(ctx, sx + 12, sy - 12, cpu_hw, cpu_hh, cpu_d, 0.2, 0.8, 0.40, 0.85, '#1e293b');

  // Left desk legs (dark oak trapdoor panel)
  const leg_hw = 2.5, leg_hh = 1.25, leg_d = 13;
  drawIsoBox(ctx, sx - 16, sy - 13, leg_hw, leg_hh, leg_d, '#382312');
  drawIsoBox(ctx, sx - 6, sy - 8, leg_hw, leg_hh, leg_d, '#382312');

  // Main Desktop Slab
  drawIsoBox(ctx, sx, desk_y, top_hw, top_hh, top_d, opts.woodColor || '#5c3d24');
  drawTopPatch(ctx, sx, desk_y, top_hw, top_hh, 0.0, 1.0, 0.48, 0.52, '#482f1b');

  // Computer Setup
  // 1. Monitor Stand
  drawIsoBox(ctx, sx, desk_y - 4, 3, 1.5, 3, '#1e293b');

  // 2. Flat-Screen Monitor
  const mon_hw = 10, mon_hh = 5, mon_d = 11;
  const mon_y = desk_y - 12;
  drawIsoBox(ctx, sx, mon_y, mon_hw, mon_hh, mon_d, '#0f172a');

  // Glowing screen on Left Face
  const isWorking = opts.screenWorking !== false;
  const screenColor = isWorking ? '#0284c7' : '#1e293b';
  drawLeftPatch(ctx, sx, mon_y, mon_hw, mon_hh, mon_d, 0.10, 0.90, 0.10, 0.90, screenColor);
  if (isWorking) {
    drawLeftPatch(ctx, sx, mon_y, mon_hw, mon_hh, mon_d, 0.20, 0.65, 0.25, 0.38, '#38bdf8');
    drawLeftPatch(ctx, sx, mon_y, mon_hw, mon_hh, mon_d, 0.20, 0.80, 0.48, 0.60, '#ffffff');
    drawLeftPatch(ctx, sx, mon_y, mon_hw, mon_hh, mon_d, 0.20, 0.50, 0.70, 0.82, '#4ade80');
  }

  // 3. Pressure Plate Keyboard
  drawTopPatch(ctx, sx, desk_y, top_hw, top_hh, 0.30, 0.65, 0.55, 0.80, '#475569');
  drawTopPatch(ctx, sx, desk_y, top_hw, top_hh, 0.32, 0.63, 0.57, 0.78, '#64748b');

  // 4. Mouse Button
  drawTopPatch(ctx, sx, desk_y, top_hw, top_hh, 0.72, 0.82, 0.60, 0.72, '#334155');

  // 5. Coffee Mug / Flower Pot
  drawIsoBox(ctx, sx - 13, desk_y - 4, 2, 1, 3.5, '#9a3412');
  drawTopPatch(ctx, sx - 13, desk_y - 4, 2, 1, 0.2, 0.8, 0.2, 0.8, '#3e2010');
}

/**
 * 4. Minecraft Office Chair:
 * Caster wheel base + upholstered seat cushion + armrests + tall backrest.
 */
function drawMinecraftOfficeChair(ctx, sx, sy, color = '#334155') {
  drawIsoBox(ctx, sx, sy - 4, 4, 2, 4, '#0f172a');
  drawIsoBox(ctx, sx, sy - 8, 7, 3.5, 4, color);
  drawLeftPatch(ctx, sx, sy - 8, 7, 3.5, 4, 0.0, 0.15, 0.0, 1.0, '#1e293b');

  const back_sx = sx + 2.5;
  const back_sy = sy - 18;
  drawIsoBox(ctx, back_sx, back_sy, 6, 3, 10, color);
  drawLeftPatch(ctx, back_sx, back_sy, 6, 3, 10, 0.1, 0.9, 0.1, 0.9, shade(color, 1.15));
}

/**
 * 5. Minecraft Potted Plant:
 * Terracotta clay pot with azalea / fern shrub on top.
 */
function drawMinecraftPlant(ctx, sx, sy) {
  const pot_hw = 5, pot_hh = 2.5, pot_d = 7;
  drawIsoBox(ctx, sx, sy - 7, pot_hw, pot_hh, pot_d, '#9a3412');
  drawTopPatch(ctx, sx, sy - 7, pot_hw, pot_hh, 0, 1, 0, 1, '#b45309');
  drawTopPatch(ctx, sx, sy - 7, pot_hw, pot_hh, 0.25, 0.75, 0.25, 0.75, '#451a03');

  const l1_hw = 8, l1_hh = 4, l1_d = 8;
  drawIsoBox(ctx, sx, sy - 17, l1_hw, l1_hh, l1_d, '#16a34a');
  drawTopPatch(ctx, sx, sy - 17, l1_hw, l1_hh, 0.2, 0.8, 0.2, 0.8, '#22c55e');

  const l2_hw = 5.5, l2_hh = 2.75, l2_d = 6;
  drawIsoBox(ctx, sx, sy - 24, l2_hw, l2_hh, l2_d, '#15803d');
  drawTopPatch(ctx, sx, sy - 24, l2_hw, l2_hh, 0.3, 0.7, 0.3, 0.7, '#4ade80');
}

/**
 * 6. Minecraft Restroom Sink & Mirror:
 * Quartz vanity + cauldron water basin + metallic tap + ice/glass mirror with reflections.
 */
function drawMinecraftSink(ctx, sx, sy) {
  const van_hw = 9, van_hh = 4.5, van_d = 14;
  drawIsoBox(ctx, sx, sy - 14, van_hw, van_hh, van_d, '#cbd5e1');
  drawTopPatch(ctx, sx, sy - 14, van_hw, van_hh, 0.2, 0.8, 0.2, 0.8, '#334155');
  drawTopPatch(ctx, sx, sy - 14, van_hw, van_hh, 0.3, 0.7, 0.3, 0.7, '#0284c7');

  drawIsoBox(ctx, sx + 2, sy - 18, 2, 1, 4, '#94a3b8');

  const mir_hw = 8, mir_hh = 4, mir_d = 16;
  const mir_sx = sx + 4.5;
  const mir_sy = sy - 34;
  drawIsoBox(ctx, mir_sx, mir_sy, mir_hw, mir_hh, mir_d, '#67e8f9');
  drawLeftPatch(ctx, mir_sx, mir_sy, mir_hw, mir_hh, mir_d, 0.1, 0.9, 0.1, 0.9, '#a5f3fc');
  drawLeftPatch(ctx, mir_sx, mir_sy, mir_hw, mir_hh, mir_d, 0.2, 0.4, 0.2, 0.6, '#ffffff');
  drawLeftPatch(ctx, mir_sx, mir_sy, mir_hw, mir_hh, mir_d, 0.5, 0.7, 0.4, 0.8, '#ffffff');
}

/**
 * 7. Minecraft Conference Table & Laptops (Boardroom):
 */
function drawMinecraftConferenceTable(ctx, sx, sy) {
  const t_hw = 34, t_hh = 17, t_d = 6;
  drawIsoBox(ctx, sx, sy - 16, t_hw, t_hh, t_d, '#5c3a21');
  drawTopPatch(ctx, sx, sy - 16, t_hw, t_hh, 0.05, 0.95, 0.05, 0.95, '#6d4527');

  // Laptops open on table
  // Laptop 1
  drawIsoBox(ctx, sx - 10, sy - 23, 4, 2, 1.5, '#0f172a');
  drawIsoBox(ctx, sx - 10, sy - 27, 4, 2, 4, '#0284c7');
  drawLeftPatch(ctx, sx - 10, sy - 27, 4, 2, 4, 0.2, 0.8, 0.2, 0.8, '#38bdf8');

  // Laptop 2
  drawIsoBox(ctx, sx + 10, sy - 23, 4, 2, 1.5, '#0f172a');
  drawIsoBox(ctx, sx + 10, sy - 27, 4, 2, 4, '#0284c7');
  drawLeftPatch(ctx, sx + 10, sy - 27, 4, 2, 4, 0.2, 0.8, 0.2, 0.8, '#38bdf8');
}

/**
 * 8. Minecraft Coffee Espresso Machine (Kitchen counter):
 */
function drawMinecraftCoffeeMachine(ctx, sx, sy) {
  const m_hw = 6, m_hh = 3, m_d = 10;
  drawIsoBox(ctx, sx, sy - 10, m_hw, m_hh, m_d, '#1e293b');
  drawLeftPatch(ctx, sx, sy - 10, m_hw, m_hh, m_d, 0.2, 0.8, 0.15, 0.30, '#f59e0b');
  drawLeftPatch(ctx, sx, sy - 10, m_hw, m_hh, m_d, 0.3, 0.7, 0.50, 0.85, '#3b2010'); // coffee pot
}

// =============================================================================
// MINECRAFT STEVE & ALEX 4-DIRECTIONAL AGENT RENDERER
// =============================================================================

/**
 * Draw an authentic 4-directional Minecraft Steve or Alex character figure
 * with dynamic leg/arm swing walk cycle and direction-aware rendering.
 */
function drawVoxelAgent(ctx, ent, cam, w, h) {
  const p = project(ent.x, ent.y, ent.z || 1, cam, w, h);
  const sx = p.sx;
  const sy = p.sy;

  const isAlex = ent.model === 'alex' ||
    (ent.name && ent.name.toLowerCase().includes('alex')) ||
    (ent.theme === 'creative' || ent.theme === 'orchestrator');

  const facing = ent.facing || 'sw'; // 'sw' | 'se' | 'ne' | 'nw'

  const skin = ent.skinColor || (isAlex ? '#efcbb0' : '#b87c55');
  const hair = ent.hairColor || (isAlex ? '#d47432' : '#392113');
  const hairDark = shade(hair, 0.75);
  const hairLight = isAlex ? '#ea8b43' : '#4d2e1b';
  const shirt = ent.shirtColor || ent.color || (isAlex ? '#5e8550' : '#00a3a7');
  const shirtDark = shade(shirt, 0.82);
  const shirtLight = isAlex ? '#739d63' : '#14b5ba';
  const pants = ent.pantsColor || (isAlex ? '#4c3523' : '#2b2c73');
  const boots = ent.bootsColor || (isAlex ? '#363437' : '#2b2b30');
  const eyeColor = isAlex ? '#1c5e23' : '#303b8e';
  const mouthColor = isAlex ? '#cb7d72' : '#4a2919';

  const isWalking = ent.isWalking || ent.state === 'walking' || ent.state === 'briefing';
  const walkPhase = ent.walkPhase || 0;
  const swing = isWalking ? Math.sin(walkPhase) * 3.5 : 0;
  const armAnim = (ent.state === 'working') ? 2.5 : 0;

  // 1. LEGS (Left Leg & Right Leg)
  const leg_hw = 3.6, leg_hh = 1.8, leg_d = 18;
  const ll_sx = sx - 3.8;
  const ll_sy = sy - 18 + swing;
  const rl_sx = sx + 3.8;
  const rl_sy = sy - 14.2 - swing;

  drawIsoBox(ctx, ll_sx, ll_sy, leg_hw, leg_hh, leg_d, pants);
  drawIsoBox(ctx, rl_sx, rl_sy, leg_hw, leg_hh, leg_d, pants);

  const bootV = isAlex ? 0.52 : 0.80;
  drawLeftPatch(ctx, ll_sx, ll_sy, leg_hw, leg_hh, leg_d, 0, 1, bootV, 1.0, boots);
  drawRightPatch(ctx, ll_sx, ll_sy, leg_hw, leg_hh, leg_d, 0, 1, bootV, 1.0, boots);
  drawLeftPatch(ctx, rl_sx, rl_sy, leg_hw, leg_hh, leg_d, 0, 1, bootV, 1.0, boots);
  drawRightPatch(ctx, rl_sx, rl_sy, leg_hw, leg_hh, leg_d, 0, 1, bootV, 1.0, boots);

  // 2. TORSO
  const t_sx = sx;
  const t_sy = sy - 34;
  const t_hw = 8.0, t_hh = 4.0, t_d = 16;
  drawIsoBox(ctx, t_sx, t_sy, t_hw, t_hh, t_d, shirt);

  if (facing === 'sw') {
    if (!isAlex) {
      drawLeftPatch(ctx, t_sx, t_sy, t_hw, t_hh, t_d, 0.32, 0.68, 0.0, 0.28, skin);
      drawLeftPatch(ctx, t_sx, t_sy, t_hw, t_hh, t_d, 0.40, 0.60, 0.28, 0.38, skin);
    } else {
      drawLeftPatch(ctx, t_sx, t_sy, t_hw, t_hh, t_d, 0.40, 0.60, 0.0, 0.18, skin);
      drawLeftPatch(ctx, t_sx, t_sy, t_hw, t_hh, t_d, 0.0, 1.0, 0.72, 0.86, '#283a1c');
      drawRightPatch(ctx, t_sx, t_sy, t_hw, t_hh, t_d, 0.0, 1.0, 0.72, 0.86, '#283a1c');
    }
  } else if (facing === 'se') {
    if (!isAlex) {
      drawRightPatch(ctx, t_sx, t_sy, t_hw, t_hh, t_d, 0.32, 0.68, 0.0, 0.28, skin);
      drawRightPatch(ctx, t_sx, t_sy, t_hw, t_hh, t_d, 0.40, 0.60, 0.28, 0.38, skin);
    } else {
      drawRightPatch(ctx, t_sx, t_sy, t_hw, t_hh, t_d, 0.40, 0.60, 0.0, 0.18, skin);
      drawRightPatch(ctx, t_sx, t_sy, t_hw, t_hh, t_d, 0.0, 1.0, 0.72, 0.86, '#283a1c');
      drawLeftPatch(ctx, t_sx, t_sy, t_hw, t_hh, t_d, 0.0, 1.0, 0.72, 0.86, '#283a1c');
    }
  } else if (isAlex) {
    drawLeftPatch(ctx, t_sx, t_sy, t_hw, t_hh, t_d, 0.0, 1.0, 0.72, 0.86, '#283a1c');
    drawRightPatch(ctx, t_sx, t_sy, t_hw, t_hh, t_d, 0.0, 1.0, 0.72, 0.86, '#283a1c');
  }

  // 3. ARMS
  const arm_hw = isAlex ? 3.0 : 3.6;
  const arm_hh = arm_hw * 0.5;
  const arm_d = 16;
  const la_sx = sx - t_hw - arm_hw * 0.5;
  const la_sy = sy - 34 + (isAlex ? 0.5 : 0) - swing + armAnim;
  const ra_sx = sx + t_hw + arm_hw * 0.5;
  const ra_sy = sy - 34 + arm_hh * 2 + swing - armAnim;

  drawIsoBox(ctx, la_sx, la_sy, arm_hw, arm_hh, arm_d, skin);
  drawIsoBox(ctx, la_sx, la_sy, arm_hw, arm_hh, arm_d * 0.36, shirt);
  drawLeftPatch(ctx, la_sx, la_sy, arm_hw, arm_hh, arm_d, 0, 1, 0.30, 0.36, shirtLight);

  drawIsoBox(ctx, ra_sx, ra_sy, arm_hw, arm_hh, arm_d, skin);
  drawIsoBox(ctx, ra_sx, ra_sy, arm_hw, arm_hh, arm_d * 0.36, shirt);
  drawRightPatch(ctx, ra_sx, ra_sy, arm_hw, arm_hh, arm_d, 0, 1, 0.30, 0.36, shirtLight);

  // 4. HEAD
  const h_sx = sx;
  const h_sy = sy - 51;
  const h_hw = 9.2, h_hh = 4.6, h_d = 16;

  drawIsoBox(ctx, h_sx, h_sy, h_hw, h_hh, h_d, skin);
  drawTopPatch(ctx, h_sx, h_sy, h_hw, h_hh, 0, 1, 0, 1, hair);
  drawTopPatch(ctx, h_sx, h_sy, h_hw, h_hh, 0.2, 0.8, 0.2, 0.8, hairDark);

  if (facing === 'sw') {
    // Face on Left Face, Side on Right Face
    if (!isAlex) {
      drawLeftPatch(ctx, h_sx, h_sy, h_hw, h_hh, h_d, 0.0, 1.0, 0.0, 0.22, hair);
      drawLeftPatch(ctx, h_sx, h_sy, h_hw, h_hh, h_d, 0.0, 0.42, 0.22, 0.32, hair);
      drawLeftPatch(ctx, h_sx, h_sy, h_hw, h_hh, h_d, 0.58, 1.0, 0.22, 0.32, hair);
      drawLeftPatch(ctx, h_sx, h_sy, h_hw, h_hh, h_d, 0.42, 0.58, 0.22, 0.26, hair);
      drawLeftPatch(ctx, h_sx, h_sy, h_hw, h_hh, h_d, 0.14, 0.26, 0.44, 0.56, '#ffffff');
      drawLeftPatch(ctx, h_sx, h_sy, h_hw, h_hh, h_d, 0.26, 0.38, 0.44, 0.56, eyeColor);
      drawLeftPatch(ctx, h_sx, h_sy, h_hw, h_hh, h_d, 0.62, 0.74, 0.44, 0.56, eyeColor);
      drawLeftPatch(ctx, h_sx, h_sy, h_hw, h_hh, h_d, 0.74, 0.86, 0.44, 0.56, '#ffffff');
      drawLeftPatch(ctx, h_sx, h_sy, h_hw, h_hh, h_d, 0.40, 0.60, 0.58, 0.68, '#8c5837');
      drawLeftPatch(ctx, h_sx, h_sy, h_hw, h_hh, h_d, 0.26, 0.74, 0.72, 0.88, mouthColor);
      drawLeftPatch(ctx, h_sx, h_sy, h_hw, h_hh, h_d, 0.38, 0.62, 0.72, 0.80, '#2c140a');

      drawRightPatch(ctx, h_sx, h_sy, h_hw, h_hh, h_d, 0.0, 1.0, 0.0, 0.36, hair);
      drawRightPatch(ctx, h_sx, h_sy, h_hw, h_hh, h_d, 0.45, 1.0, 0.36, 1.0, hair);
      drawRightPatch(ctx, h_sx, h_sy, h_hw, h_hh, h_d, 0.0, 0.45, 0.36, 0.80, skin);
    } else {
      drawLeftPatch(ctx, h_sx, h_sy, h_hw, h_hh, h_d, 0.0, 1.0, 0.0, 0.24, hair);
      drawLeftPatch(ctx, h_sx, h_sy, h_hw, h_hh, h_d, 0.0, 0.30, 0.24, 0.42, hair);
      drawLeftPatch(ctx, h_sx, h_sy, h_hw, h_hh, h_d, 0.30, 0.60, 0.24, 0.34, hairLight);
      drawLeftPatch(ctx, h_sx, h_sy, h_hw, h_hh, h_d, 0.60, 1.0, 0.24, 0.38, hair);
      drawLeftPatch(ctx, h_sx, h_sy, h_hw, h_hh, h_d, 0.16, 0.28, 0.44, 0.56, '#ffffff');
      drawLeftPatch(ctx, h_sx, h_sy, h_hw, h_hh, h_d, 0.28, 0.38, 0.44, 0.56, eyeColor);
      drawLeftPatch(ctx, h_sx, h_sy, h_hw, h_hh, h_d, 0.62, 0.72, 0.44, 0.56, eyeColor);
      drawLeftPatch(ctx, h_sx, h_sy, h_hw, h_hh, h_d, 0.72, 0.84, 0.44, 0.56, '#ffffff');
      drawLeftPatch(ctx, h_sx, h_sy, h_hw, h_hh, h_d, 0.38, 0.62, 0.76, 0.84, mouthColor);

      drawRightPatch(ctx, h_sx, h_sy, h_hw, h_hh, h_d, 0.0, 1.0, 0.0, 0.38, hair);
      drawRightPatch(ctx, h_sx, h_sy, h_hw, h_hh, h_d, 0.45, 1.0, 0.38, 1.0, hair);
      drawIsoBox(ctx, sx + 5.8, sy - 37, 2.6, 1.5, 9, hair);
    }
  } else if (facing === 'se') {
    // Face on Right Face, Side on Left Face
    if (!isAlex) {
      drawRightPatch(ctx, h_sx, h_sy, h_hw, h_hh, h_d, 0.0, 1.0, 0.0, 0.22, hair);
      drawRightPatch(ctx, h_sx, h_sy, h_hw, h_hh, h_d, 0.0, 0.42, 0.22, 0.32, hair);
      drawRightPatch(ctx, h_sx, h_sy, h_hw, h_hh, h_d, 0.58, 1.0, 0.22, 0.32, hair);
      drawRightPatch(ctx, h_sx, h_sy, h_hw, h_hh, h_d, 0.42, 0.58, 0.22, 0.26, hair);
      drawRightPatch(ctx, h_sx, h_sy, h_hw, h_hh, h_d, 0.14, 0.26, 0.44, 0.56, '#ffffff');
      drawRightPatch(ctx, h_sx, h_sy, h_hw, h_hh, h_d, 0.26, 0.38, 0.44, 0.56, eyeColor);
      drawRightPatch(ctx, h_sx, h_sy, h_hw, h_hh, h_d, 0.62, 0.74, 0.44, 0.56, eyeColor);
      drawRightPatch(ctx, h_sx, h_sy, h_hw, h_hh, h_d, 0.74, 0.86, 0.44, 0.56, '#ffffff');
      drawRightPatch(ctx, h_sx, h_sy, h_hw, h_hh, h_d, 0.40, 0.60, 0.58, 0.68, '#8c5837');
      drawRightPatch(ctx, h_sx, h_sy, h_hw, h_hh, h_d, 0.26, 0.74, 0.72, 0.88, mouthColor);
      drawRightPatch(ctx, h_sx, h_sy, h_hw, h_hh, h_d, 0.38, 0.62, 0.72, 0.80, '#2c140a');

      drawLeftPatch(ctx, h_sx, h_sy, h_hw, h_hh, h_d, 0.0, 1.0, 0.0, 0.36, hair);
      drawLeftPatch(ctx, h_sx, h_sy, h_hw, h_hh, h_d, 0.0, 0.55, 0.36, 1.0, hair);
      drawLeftPatch(ctx, h_sx, h_sy, h_hw, h_hh, h_d, 0.55, 1.0, 0.36, 0.80, skin);
    } else {
      drawRightPatch(ctx, h_sx, h_sy, h_hw, h_hh, h_d, 0.0, 1.0, 0.0, 0.24, hair);
      drawRightPatch(ctx, h_sx, h_sy, h_hw, h_hh, h_d, 0.70, 1.0, 0.24, 0.42, hair);
      drawRightPatch(ctx, h_sx, h_sy, h_hw, h_hh, h_d, 0.40, 0.70, 0.24, 0.34, hairLight);
      drawRightPatch(ctx, h_sx, h_sy, h_hw, h_hh, h_d, 0.0, 0.40, 0.24, 0.38, hair);
      drawRightPatch(ctx, h_sx, h_sy, h_hw, h_hh, h_d, 0.16, 0.28, 0.44, 0.56, '#ffffff');
      drawRightPatch(ctx, h_sx, h_sy, h_hw, h_hh, h_d, 0.28, 0.38, 0.44, 0.56, eyeColor);
      drawRightPatch(ctx, h_sx, h_sy, h_hw, h_hh, h_d, 0.62, 0.72, 0.44, 0.56, eyeColor);
      drawRightPatch(ctx, h_sx, h_sy, h_hw, h_hh, h_d, 0.72, 0.84, 0.44, 0.56, '#ffffff');
      drawRightPatch(ctx, h_sx, h_sy, h_hw, h_hh, h_d, 0.38, 0.62, 0.76, 0.84, mouthColor);

      drawLeftPatch(ctx, h_sx, h_sy, h_hw, h_hh, h_d, 0.0, 1.0, 0.0, 0.38, hair);
      drawLeftPatch(ctx, h_sx, h_sy, h_hw, h_hh, h_d, 0.0, 0.55, 0.38, 1.0, hair);
      drawIsoBox(ctx, sx - 5.8, sy - 37, 2.6, 1.5, 9, hair);
    }
  } else if (facing === 'ne') {
    // BACK of head on Left face, Side on Right face
    drawLeftPatch(ctx, h_sx, h_sy, h_hw, h_hh, h_d, 0, 1, 0, 1, hair);
    drawLeftPatch(ctx, h_sx, h_sy, h_hw, h_hh, h_d, 0.2, 0.8, 0.2, 0.8, hairDark);
    drawRightPatch(ctx, h_sx, h_sy, h_hw, h_hh, h_d, 0.0, 1.0, 0.0, 0.36, hair);
    drawRightPatch(ctx, h_sx, h_sy, h_hw, h_hh, h_d, 0.45, 1.0, 0.36, 1.0, hair);
    drawRightPatch(ctx, h_sx, h_sy, h_hw, h_hh, h_d, 0.0, 0.45, 0.36, 0.80, skin);
  } else {
    // BACK of head on Right face, Side on Left face (facing 'nw')
    drawRightPatch(ctx, h_sx, h_sy, h_hw, h_hh, h_d, 0, 1, 0, 1, hair);
    drawRightPatch(ctx, h_sx, h_sy, h_hw, h_hh, h_d, 0.2, 0.8, 0.2, 0.8, hairDark);
    drawLeftPatch(ctx, h_sx, h_sy, h_hw, h_hh, h_d, 0.0, 1.0, 0.0, 0.36, hair);
    drawLeftPatch(ctx, h_sx, h_sy, h_hw, h_hh, h_d, 0.0, 0.55, 0.36, 1.0, hair);
    drawLeftPatch(ctx, h_sx, h_sy, h_hw, h_hh, h_d, 0.55, 1.0, 0.36, 0.80, skin);
  }

  // Floating gem status indicator
  if (ent.state === 'error') {
    drawIsoBox(ctx, sx, sy - 72, 3.8, 1.9, 5, '#ef4444');
  } else if (ent.state === 'working') {
    drawIsoBox(ctx, sx, sy - 70, 3.2, 1.6, 4, '#10b981');
  }
}

/**
 * Depth-sort queue combining static blocks, furniture, and dynamic entities.
 */
function sortQueue(scene) {
  const { w, h, camera } = scene;
  const q = [];
  for (const b of (scene.blocks || [])) q.push({ kind: 'block', item: b, o: 0 });
  for (const f of (scene.furniture || [])) q.push({ kind: 'furniture', item: f, o: 0 });
  for (const e of (scene.entities || [])) q.push({ kind: 'entity', item: e, o: 1 });
  for (const t of q) {
    const r = rotateCell(t.item.x, t.item.y, camera.rot, w, h);
    t.d = r.x + r.y;
  }
  q.sort((a, b) => a.d - b.d || (a.item.z || 0) - (b.item.z || 0) || a.o - b.o);
  return q.map(({ kind, item }) => ({ kind, item }));
}

/**
 * Bake static floor tiles, walls, and detailed Minecraft furniture to an offscreen buffer.
 */
function buildStaticBuffer(scene, width = 1040, height = 540) {
  let offscreen;
  if (typeof document !== 'undefined' && document.createElement) {
    offscreen = document.createElement('canvas');
    offscreen.width = width;
    offscreen.height = height;
  } else if (typeof OffscreenCanvas !== 'undefined') {
    offscreen = new OffscreenCanvas(width, height);
  } else {
    offscreen = { width, height, getContext: () => ({ beginPath(){}, moveTo(){}, lineTo(){}, closePath(){}, fill(){} }) };
  }
  const ctx = offscreen.getContext('2d');
  const { w, h, camera, blocks, furniture } = scene;

  // 1. Render all base floor tiles (z = 0) first in isometric depth order
  const floorBlocks = (blocks || []).filter(b => (b.z || 0) === 0).map(b => {
    const r = rotateCell(b.x, b.y, camera.rot, w, h);
    return { ...b, d: r.x + r.y };
  }).sort((a, b) => a.d - b.d);

  for (const b of floorBlocks) {
    const { sx, sy } = project(b.x, b.y, b.z, camera, w, h);
    drawVoxelCube(ctx, sx, sy, b.color, camera);
  }

  // 2. Combine and depth-sort elevated walls (z >= 1) and furniture together
  const elevated = [];
  for (const b of (blocks || [])) {
    if ((b.z || 0) > 0) {
      const r = rotateCell(b.x, b.y, camera.rot, w, h);
      elevated.push({ kind: 'block', item: b, d: r.x + r.y, z: b.z });
    }
  }
  for (const f of (furniture || [])) {
    const r = rotateCell(f.x, f.y, camera.rot, w, h);
    elevated.push({ kind: 'furniture', item: f, d: r.x + r.y, z: f.z || 1 });
  }

  elevated.sort((a, b) => a.d - b.d || a.z - b.z);

  for (const ent of elevated) {
    if (ent.kind === 'block') {
      const b = ent.item;
      const { sx, sy } = project(b.x, b.y, b.z, camera, w, h);
      drawVoxelCube(ctx, sx, sy, b.color, camera);
    } else {
      const f = ent.item;
      const { sx, sy } = project(f.x, f.y, f.z || 1, camera, w, h);
      switch (f.type) {
        case 'desk':
          drawMinecraftWorkstation(ctx, sx, sy, f);
          break;
        case 'chair':
          drawMinecraftOfficeChair(ctx, sx, sy, f.color || '#334155');
          break;
        case 'cooler':
          drawMinecraftWaterCooler(ctx, sx, sy);
          break;
        case 'toilet':
          drawMinecraftToilet(ctx, sx, sy);
          break;
        case 'sink':
          drawMinecraftSink(ctx, sx, sy);
          break;
        case 'plant':
          drawMinecraftPlant(ctx, sx, sy);
          break;
        case 'conference_table':
          drawMinecraftConferenceTable(ctx, sx, sy);
          break;
        case 'coffee':
          drawMinecraftCoffeeMachine(ctx, sx, sy);
          break;
      }
    }
  }

  return offscreen;
}

/**
 * Fast frame compositor: blits the cached static buffer then renders dynamic agent voxels.
 */
function renderFrame(ctx, scene, buffer) {
  if (buffer) {
    ctx.drawImage(buffer, 0, 0);
  }
  const { w, h, camera, entities } = scene;
  const sortedEntities = (entities || []).map(e => {
    const r = rotateCell(e.x, e.y, camera.rot, w, h);
    return { ...e, d: r.x + r.y };
  }).sort((a, b) => a.d - b.d || (a.z || 1) - (b.z || 1));

  for (const ent of sortedEntities) {
    drawVoxelAgent(ctx, ent, camera, w, h);
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    FACE, rotateCell, project, sortQueue, shade,
    drawVoxelCube, drawVoxelAgent, buildStaticBuffer, renderFrame,
    drawIsoBox, drawLeftPatch, drawRightPatch, drawTopPatch,
    drawMinecraftWaterCooler, drawMinecraftToilet, drawMinecraftWorkstation,
    drawMinecraftOfficeChair, drawMinecraftPlant, drawMinecraftSink,
    drawMinecraftConferenceTable, drawMinecraftCoffeeMachine
  };
}
