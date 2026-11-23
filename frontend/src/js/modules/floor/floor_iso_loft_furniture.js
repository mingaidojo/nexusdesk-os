/**
 * @module floor/floor_iso_loft_furniture.js
 * @description AgentFloor HD Pixel Loft Furniture & Chibi Sprite Primitives.
 * 2:1 isometric pixel-art drawing primitives for rolling chairs, plants,
 * desks, conference tables, and chibi agent avatars (`drawLoft*`).
 *
 * Part of the AgentFloor canvas subsystem (concatenated globally by frontend/build.py).
 */

// --- BL-EVO-37: True 2:1 Isometric 32-Bit Pixel-Art Loft Renderer (Kairosoft / Habbo Style) ---
function drawLoftRollingChair(ctx, sx, sy, facingBack = false) {
  ctx.save();
  // Caster floor shadow
  ctx.fillStyle = 'rgba(0, 0, 0, 0.36)';
  ctx.beginPath();
  ctx.ellipse(sx, sy + 12, 12, 6, 0, 0, Math.PI * 2);
  ctx.fill();

  // 5-Star Wheeled Base & Center Pneumatic Cylinder
  ctx.strokeStyle = '#181f2c';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(sx, sy + 4); ctx.lineTo(sx, sy + 11);
  ctx.moveTo(sx - 9, sy + 11); ctx.lineTo(sx + 9, sy + 11);
  ctx.moveTo(sx - 6, sy + 8); ctx.lineTo(sx + 6, sy + 14);
  ctx.moveTo(sx + 6, sy + 8); ctx.lineTo(sx - 6, sy + 14);
  ctx.stroke();
  // Little caster wheel dots
  ctx.fillStyle = '#0f172a';
  [[-9, 11], [9, 11], [-6, 14], [6, 14], [0, 13]].forEach(([wx, wy]) => {
    ctx.fillRect(sx + wx - 1.5, sy + wy - 1, 3, 2.5);
  });

  // Sculpted Seat Cushion (Isometric rounded diamond)
  ctx.fillStyle = '#2d3748';
  ctx.strokeStyle = '#111827';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(sx - 11, sy - 2, 22, 9, 4);
  ctx.fill();
  ctx.stroke();

  // Armrests
  ctx.fillStyle = '#1e293b';
  ctx.fillRect(sx - 12, sy - 6, 3, 7);
  ctx.fillRect(sx + 9, sy - 6, 3, 7);

  // High Curved Backrest
  if (facingBack) {
    // Backrest in front/side (facing toward desk away from camera)
    ctx.fillStyle = '#334155';
    ctx.beginPath();
    ctx.roundRect(sx - 10, sy - 15, 20, 13, 5);
    ctx.fill();
    ctx.stroke();
    // Backrest vertical spine seam
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(sx, sy - 13);
    ctx.lineTo(sx, sy - 4);
    ctx.stroke();
  } else {
    // Backrest behind seat (facing toward table/camera)
    ctx.fillStyle = '#3b475c';
    ctx.beginPath();
    ctx.roundRect(sx - 10, sy - 16, 20, 13, 5);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(sx - 7, sy - 14, 14, 3);
  }
  ctx.restore();
}

function drawLoftTerracottaPlant(ctx, sx, sy) {
  ctx.save();
  // Floor shadow
  ctx.fillStyle = 'rgba(0, 0, 0, 0.38)';
  ctx.beginPath();
  ctx.ellipse(sx, sy + 9, 14, 7, 0, 0, Math.PI * 2);
  ctx.fill();

  // Terracotta Pot Body (Tapered cylinder)
  ctx.fillStyle = '#9c4a28';
  ctx.strokeStyle = '#2b1308';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(sx - 10, sy - 5);
  ctx.lineTo(sx - 7, sy + 8);
  ctx.quadraticCurveTo(sx, sy + 11, sx + 7, sy + 8);
  ctx.lineTo(sx + 10, sy - 5);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Terracotta Upper Rim & Dark Soil
  ctx.fillStyle = '#b45732';
  ctx.beginPath();
  ctx.ellipse(sx, sy - 5, 11, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#3b2314';
  ctx.beginPath();
  ctx.ellipse(sx, sy - 5, 8.5, 3.5, 0, 0, Math.PI * 2);
  ctx.fill();

  // Woody Stem
  ctx.strokeStyle = '#5c381b';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(sx, sy - 5);
  ctx.lineTo(sx, sy - 18);
  ctx.stroke();

  // Lush Multi-Frond Pixel Ficus Leaves
  const fronds = [
    { dx: -11, dy: -15, rx: 9, ry: 5, ang: -0.4, col: '#15803d' },
    { dx: 11, dy: -15, rx: 9, ry: 5, ang: 0.4, col: '#15803d' },
    { dx: -8, dy: -22, rx: 10, ry: 5, ang: -0.25, col: '#16a34a' },
    { dx: 9, dy: -22, rx: 10, ry: 5, ang: 0.25, col: '#16a34a' },
    { dx: 0, dy: -27, rx: 7, ry: 10, ang: 0, col: '#22c55e' },
    { dx: -4, dy: -18, rx: 7, ry: 4, ang: -0.1, col: '#4ade80' },
    { dx: 5, dy: -19, rx: 7, ry: 4, ang: 0.15, col: '#4ade80' }
  ];
  ctx.strokeStyle = '#0c2e17';
  ctx.lineWidth = 1.2;
  fronds.forEach(f => {
    ctx.fillStyle = f.col;
    ctx.beginPath();
    ctx.ellipse(sx + f.dx, sy + f.dy, f.rx, f.ry, f.ang, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  });
  ctx.restore();
}

function drawLoftIsoDesk(ctx, sx, sy, isWorking, variantIdx) {
  ctx.save();
  // Isometric basis vectors for the desk top
  // Along u (down-right): (+34, +14), Along v (down-left): (-22, +11)
  const tx = sx - 6, ty = sy - 16;
  const p0 = { x: tx, y: ty };                           // Top-Back
  const p1 = { x: tx + 44, y: ty + 18 };                 // Right
  const p2 = { x: tx + 44 - 26, y: ty + 18 + 13 };       // Bottom-Front
  const p3 = { x: tx - 26, y: ty + 13 };                 // Left

  // Floor Drop Shadow
  ctx.fillStyle = 'rgba(0, 0, 0, 0.38)';
  ctx.beginPath();
  ctx.moveTo(p0.x - 2, p0.y + 18);
  ctx.lineTo(p1.x + 2, p1.y + 18);
  ctx.lineTo(p2.x + 2, p2.y + 20);
  ctx.lineTo(p3.x - 2, p3.y + 20);
  ctx.closePath();
  ctx.fill();

  // Left Steel Leg / Side Panel (under p3 -> p0)
  ctx.fillStyle = '#4a2c14';
  ctx.strokeStyle = '#1c1008';
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.moveTo(p3.x, p3.y);
  ctx.lineTo(p3.x + 6, p3.y + 3);
  ctx.lineTo(p3.x + 6, p3.y + 19);
  ctx.lineTo(p3.x, p3.y + 16);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Under-Desk Modesty Back Panel
  ctx.fillStyle = '#5c3719';
  ctx.beginPath();
  ctx.moveTo(p3.x + 6, p3.y + 2);
  ctx.lineTo(p2.x - 10, p2.y - 4);
  ctx.lineTo(p2.x - 10, p2.y + 10);
  ctx.lineTo(p3.x + 6, p3.y + 14);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Right 2-Drawer Wooden Cabinet (under p2 -> p1)
  ctx.fillStyle = '#754621'; // front-left drawer face
  ctx.beginPath();
  ctx.moveTo(p2.x - 14, p2.y - 6);
  ctx.lineTo(p2.x, p2.y);
  ctx.lineTo(p2.x, p2.y + 16);
  ctx.lineTo(p2.x - 14, p2.y + 10);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // Drawer seam & dark pixel handle pulls
  ctx.beginPath();
  ctx.moveTo(p2.x - 14, p2.y + 2);
  ctx.lineTo(p2.x, p2.y + 8);
  ctx.stroke();
  ctx.fillStyle = '#1c1008';
  ctx.fillRect(p2.x - 9, p2.y - 1, 4, 1.5);
  ctx.fillRect(p2.x - 9, p2.y + 6, 4, 1.5);

  // Right Cabinet Side Face (p2 -> p1)
  ctx.fillStyle = '#583316';
  ctx.beginPath();
  ctx.moveTo(p2.x, p2.y);
  ctx.lineTo(p1.x, p1.y);
  ctx.lineTo(p1.x, p1.y + 16);
  ctx.lineTo(p2.x, p2.y + 16);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Desk Tabletop 3D Lip (4px thick beveled oak edge)
  ctx.fillStyle = '#7c4b23';
  ctx.beginPath();
  ctx.moveTo(p3.x, p3.y);
  ctx.lineTo(p2.x, p2.y);
  ctx.lineTo(p1.x, p1.y);
  ctx.lineTo(p1.x, p1.y + 4);
  ctx.lineTo(p2.x, p2.y + 4);
  ctx.lineTo(p3.x, p3.y + 4);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Isometric Oak Tabletop Surface
  ctx.fillStyle = '#a46838';
  ctx.beginPath();
  ctx.moveTo(p0.x, p0.y);
  ctx.lineTo(p1.x, p1.y);
  ctx.lineTo(p2.x, p2.y);
  ctx.lineTo(p3.x, p3.y);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Subtle Wood Grain Line on Tabletop
  ctx.strokeStyle = 'rgba(67, 36, 15, 0.35)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(p0.x - 8, p0.y + 5);
  ctx.lineTo(p1.x - 8, p1.y + 5);
  ctx.stroke();

  // --- Isometric Angled Keyboard & Mouse ---
  const kx = sx - 8, ky = sy + 1;
  ctx.fillStyle = '#d6d3d1';
  ctx.strokeStyle = '#1e293b';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(kx, ky);
  ctx.lineTo(kx + 16, ky + 6.5);
  ctx.lineTo(kx + 12, ky + 9.5);
  ctx.lineTo(kx - 4, ky + 3);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // Mouse beside keyboard
  ctx.fillStyle = '#e7e5e4';
  ctx.beginPath();
  ctx.ellipse(kx + 19, ky + 9, 3, 2, 0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // --- Isometric 3D Retro-Modern CRT/LCD Monitor (Matching Screenshot!) ---
  const mx = sx + 2, my = sy - 7;
  // Monitor Stand Base
  ctx.fillStyle = '#94a3b8';
  ctx.strokeStyle = '#1e293b';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.ellipse(mx, my + 6, 7, 3.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // Monitor Rear 3D Casing Box (Beige/Silver)
  ctx.fillStyle = '#a8a29e';
  ctx.beginPath();
  ctx.moveTo(mx - 6, my - 14);
  ctx.lineTo(mx + 12, my - 7);
  ctx.lineTo(mx + 12, my + 2);
  ctx.lineTo(mx - 6, my - 5);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // Monitor Front Frame (Angled toward seated agent)
  ctx.fillStyle = '#d6d3d1';
  ctx.beginPath();
  ctx.moveTo(mx - 11, my - 11);
  ctx.lineTo(mx + 7, my - 4);
  ctx.lineTo(mx + 7, my + 7);
  ctx.lineTo(mx - 11, my);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // Monitor Top Bevel
  ctx.fillStyle = '#e7e5e4';
  ctx.beginPath();
  ctx.moveTo(mx - 11, my - 11);
  ctx.lineTo(mx - 6, my - 14);
  ctx.lineTo(mx + 12, my - 7);
  ctx.lineTo(mx + 7, my - 4);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // Monitor Right Side Bevel
  ctx.fillStyle = '#78716c';
  ctx.beginPath();
  ctx.moveTo(mx + 7, my - 4);
  ctx.lineTo(mx + 12, my - 7);
  ctx.lineTo(mx + 12, my + 2);
  ctx.lineTo(mx + 7, my + 7);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Glowing Screen Face (Blue/Green IDE Display)
  ctx.fillStyle = isWorking ? ((variantIdx % 2 === 0) ? '#3b82f6' : '#16a34a') : '#1e293b';
  ctx.beginPath();
  ctx.moveTo(mx - 9, my - 8.5);
  ctx.lineTo(mx + 5, my - 3);
  ctx.lineTo(mx + 5, my + 4.5);
  ctx.lineTo(mx - 9, my - 1);
  ctx.closePath();
  ctx.fill();
  if (isWorking) {
    // Tiny pixel code lines on angled screen
    ctx.strokeStyle = '#e0f2fe';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(mx - 7, my - 6); ctx.lineTo(mx + 1, my - 3);
    ctx.moveTo(mx - 7, my - 3.5); ctx.lineTo(mx + 3, my + 0.5);
    ctx.stroke();
  }

  // --- Desk Accessories (Books, Mini Desk Plant, or Green Mug matching Screenshot) ---
  if (variantIdx % 3 === 0) {
    // Mini potted succulent on top-left corner of desk
    const px = p3.x + 11, py = p3.y - 2;
    ctx.fillStyle = '#b45309';
    ctx.fillRect(px - 4, py - 2, 8, 6);
    ctx.strokeRect(px - 4, py - 2, 8, 6);
    ctx.fillStyle = '#22c55e';
    ctx.beginPath(); ctx.arc(px, py - 5, 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  } else if (variantIdx % 3 === 1) {
    // Colorful book stack + green thermos mug
    const bx = p3.x + 10, by = p3.y - 1;
    ['#ef4444', '#22c55e', '#3b82f6'].forEach((bcol, bi) => {
      ctx.fillStyle = bcol;
      ctx.fillRect(bx + bi * 3.5, by - 5, 3.5, 8);
      ctx.strokeRect(bx + bi * 3.5, by - 5, 3.5, 8);
    });
    // Green mug on right corner
    ctx.fillStyle = '#15803d';
    ctx.fillRect(p1.x - 12, p1.y - 3, 5, 7);
    ctx.strokeRect(p1.x - 12, p1.y - 3, 5, 7);
  } else {
    // Sleek Secondary Flat-Panel Monitor on right side of desk
    const fx = p1.x - 14, fy = p1.y - 6;
    ctx.fillStyle = '#334155';
    ctx.beginPath();
    ctx.moveTo(fx - 6, fy - 8);
    ctx.lineTo(fx + 6, fy - 3);
    ctx.lineTo(fx + 6, fy + 5);
    ctx.lineTo(fx - 6, fy);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

function drawLoftConferenceTable(ctx, sx, sy) {
  ctx.save();
  // Large Isometric Mahogany Table with Rounded Corners & 2 Pedestal Legs
  // Table spans u-vector (+52, +21) and v-vector (-66, +36)
  const p0 = { x: sx + 10, y: sy - 28 };
  const p1 = { x: sx + 64, y: sy - 6 };
  const p2 = { x: sx - 6, y: sy + 32 };
  const p3 = { x: sx - 60, y: sy + 10 };

  // Floor Shadow
  ctx.fillStyle = 'rgba(0, 0, 0, 0.38)';
  ctx.beginPath();
  ctx.moveTo(p0.x, p0.y + 18);
  ctx.lineTo(p1.x + 4, p1.y + 18);
  ctx.lineTo(p2.x, p2.y + 22);
  ctx.lineTo(p3.x - 4, p3.y + 18);
  ctx.closePath();
  ctx.fill();

  // Cylindrical Dark Wood Pedestal Legs underneath
  ctx.fillStyle = '#3e2411';
  ctx.strokeStyle = '#1a0e06';
  ctx.lineWidth = 1.5;
  ctx.fillRect(sx - 24, sy + 2, 12, 16);
  ctx.strokeRect(sx - 24, sy + 2, 12, 16);
  ctx.fillRect(sx + 12, sy - 6, 12, 16);
  ctx.strokeRect(sx + 12, sy - 6, 12, 16);

  // 3D Beveled Side Skirt (6px deep)
  ctx.fillStyle = '#633919';
  ctx.beginPath();
  ctx.moveTo(p3.x, p3.y);
  ctx.lineTo(p2.x, p2.y);
  ctx.lineTo(p1.x, p1.y);
  ctx.lineTo(p1.x, p1.y + 6);
  ctx.lineTo(p2.x, p2.y + 6);
  ctx.lineTo(p3.x, p3.y + 6);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Tabletop Surface
  ctx.fillStyle = '#8f5629';
  ctx.beginPath();
  ctx.moveTo(p0.x, p0.y);
  ctx.lineTo(p1.x, p1.y);
  ctx.lineTo(p2.x, p2.y);
  ctx.lineTo(p3.x, p3.y);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Open Silver Isometric Laptop 1 (Left side of table)
  const lx1 = sx - 22, ly1 = sy + 2;
  ctx.fillStyle = '#cbd5e1';
  ctx.strokeStyle = '#1e293b';
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.moveTo(lx1, ly1);
  ctx.lineTo(lx1 + 12, ly1 + 5);
  ctx.lineTo(lx1 + 5, ly1 + 9);
  ctx.lineTo(lx1 - 7, ly1 + 4);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // Laptop 1 upright screen back
  ctx.fillStyle = '#94a3b8';
  ctx.beginPath();
  ctx.moveTo(lx1 - 7, ly1 + 4);
  ctx.lineTo(lx1 + 5, ly1 + 9);
  ctx.lineTo(lx1 + 5, ly1 - 1);
  ctx.lineTo(lx1 - 7, ly1 - 6);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Open Silver Isometric Laptop 2 (Center-Right with Glowing Cyan/Green Screen)
  const lx2 = sx - 2, ly2 = sy + 9;
  ctx.fillStyle = '#cbd5e1';
  ctx.beginPath();
  ctx.moveTo(lx2, ly2);
  ctx.lineTo(lx2 + 12, ly2 + 5);
  ctx.lineTo(lx2 + 5, ly2 + 9);
  ctx.lineTo(lx2 - 7, ly2 + 4);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#e2e8f0';
  ctx.beginPath();
  ctx.moveTo(lx2, ly2);
  ctx.lineTo(lx2 + 12, ly2 + 5);
  ctx.lineTo(lx2 + 12, ly2 - 5);
  ctx.lineTo(lx2, ly2 - 10);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#38bdf8';
  ctx.beginPath();
  ctx.moveTo(lx2 + 1.5, ly2 - 8);
  ctx.lineTo(lx2 + 10.5, ly2 - 4);
  ctx.lineTo(lx2 + 10.5, ly2 + 3);
  ctx.lineTo(lx2 + 1.5, ly2 - 1);
  ctx.closePath();
  ctx.fill();

  // Teal & Brown Briefing Book Stack on Right End of Table
  ctx.fillStyle = '#0f766e';
  ctx.fillRect(sx + 16, sy - 6, 13, 8);
  ctx.strokeRect(sx + 16, sy - 6, 13, 8);
  ctx.fillStyle = '#fef3c7';
  ctx.fillRect(sx + 17, sy - 1, 11, 2.5);
  ctx.restore();
}

function drawLoftChibiAgent(ctx, a, idx, sx, sy, seatedBehindDesk = true) {
  ctx.save();
  const isSelected = (selectedAgent === a);
  const isHovered = (hoveredAgent === a);
  const bob = (a.state === 'walking') ? Math.sin(animFrame * 0.25) * 2.5 : 0;

  // Distinct Chibi Character Profiles matching media_1794043231599_099d37e5.jpg
  const profiles = [
    { skin: '#a66d46', hair: '#231710', jacket: '#78522b', inner: '#f8fafc', tie: '#1e293b', style: 'short_exec', dot: '#facc15' },
    { skin: '#f5cba7', hair: '#9a5b32', jacket: '#7f3b4a', inner: '#fef2f2', tie: '#be123c', style: 'long_parted', dot: '#38bdf8' },
    { skin: '#9c623e', hair: '#1e1b18', jacket: '#475569', inner: '#e2e8f0', tie: '#84cc16', style: 'headphones', dot: '#4ade80' },
    { skin: '#e8be9e', hair: '#272736', jacket: '#5b4b8a', inner: '#ede9fe', tie: '#8b5cf6', style: 'tousled', dot: '#38bdf8' },
    { skin: '#b87b52', hair: '#7e22ce', jacket: '#2c6e7a', inner: '#cffafe', tie: '#06b6d4', style: 'twin_buns', dot: '#4ade80' },
    { skin: '#f2c6a0', hair: '#5c3419', jacket: '#2d6a4f', inner: '#ecfdf5', tie: '#10b981', style: 'glasses', dot: '#4ade80' }
  ];
  const prof = profiles[idx % profiles.length];

  // Draw Chair Backrest & Base behind agent if seated
  if (a.state !== 'walking') {
    drawLoftRollingChair(ctx, sx, sy + 4, false);
  } else {
    // Walking shadow + animated feet
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.beginPath();
    ctx.ellipse(sx, sy + 9, 10, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    const stride = Math.sin(animFrame * 0.35) * 3;
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(sx - 5, sy + 1 + stride, 4, 6);
    ctx.fillRect(sx + 1, sy + 1 - stride, 4, 6);
  }

  const cy = sy - 8 + bob;

  // Conference Speaker Highlight Halo
  if (isConferenceActive && conferenceSpeaker && conferenceSpeaker.toLowerCase() === a.name.toLowerCase()) {
    ctx.save();
    ctx.strokeStyle = '#06b6d4';
    ctx.lineWidth = 2.5;
    ctx.shadowColor = '#06b6d4';
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.ellipse(sx, sy + 4, 18, 10, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // 1. Torso / Tailored Blazer & Arms (with crisp dark pixel-art outline)
  ctx.fillStyle = prof.jacket;
  ctx.strokeStyle = '#140f0b';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(sx - 9, cy + 1, 18, 13, 4);
  ctx.fill();
  ctx.stroke();

  // Inner Shirt Collar & Tie / Lanyard
  ctx.fillStyle = prof.inner;
  ctx.beginPath();
  ctx.moveTo(sx - 4, cy + 1);
  ctx.lineTo(sx + 4, cy + 1);
  ctx.lineTo(sx, cy + 7);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = prof.tie;
  ctx.fillRect(sx - 1, cy + 4, 2, 6);

  // Animated Hands typing or resting
  const tap = (a.state === 'working' && animFrame % 12 < 6) ? 1.5 : 0;
  ctx.fillStyle = prof.skin;
  ctx.fillRect(sx - 8, cy + 10 + tap, 4, 4);
  ctx.fillRect(sx + 4, cy + 10 + (1.5 - tap), 4, 4);
  ctx.strokeRect(sx - 8, cy + 10 + tap, 4, 4);
  ctx.strokeRect(sx + 4, cy + 10 + (1.5 - tap), 4, 4);

  // 2. Chibi Rounded Head (18x16px)
  const hx = sx, hy = cy - 9;
  ctx.fillStyle = prof.skin;
  ctx.beginPath();
  ctx.roundRect(hx - 9, hy - 8, 18, 16, 6);
  ctx.fill();
  ctx.stroke();

  // Subtle Cheek Blush
  ctx.fillStyle = 'rgba(244, 63, 94, 0.22)';
  ctx.fillRect(hx - 7, hy + 2, 3, 2);
  ctx.fillRect(hx + 4, hy + 2, 3, 2);

  // 3. Large Expressive Anime-Pixel Eyes
  if (a.state === 'sleeping') {
    ctx.fillStyle = '#1c1917';
    ctx.fillRect(hx - 6, hy, 4, 1.5);
    ctx.fillRect(hx + 2, hy, 4, 1.5);
  } else {
    // Sclera
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(hx - 6, hy - 1.5, 4, 4.5);
    ctx.fillRect(hx + 2, hy - 1.5, 4, 4.5);
    // Dark Iris
    ctx.fillStyle = '#140f0b';
    ctx.fillRect(hx - 5, hy - 1, 3, 4);
    ctx.fillRect(hx + 2.5, hy - 1, 3, 4);
    // Specular 1px White Gleam
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(hx - 5, hy - 1, 1.5, 1.5);
    ctx.fillRect(hx + 2.5, hy - 1, 1.5, 1.5);
    // Eyebrows
    ctx.fillStyle = prof.hair;
    ctx.fillRect(hx - 6, hy - 3.5, 4, 1.2);
    ctx.fillRect(hx + 2, hy - 3.5, 4, 1.2);
  }

  // 4. Distinctive Hairstyles & Accessories
  ctx.fillStyle = prof.hair;
  ctx.strokeStyle = '#140f0b';
  ctx.lineWidth = 1.4;

  if (prof.style === 'twin_buns') {
    // Purple Twin Side Buns (Pylon style!)
    ctx.beginPath();
    ctx.arc(hx - 9, hy - 6, 4.5, 0, Math.PI * 2);
    ctx.arc(hx + 9, hy - 6, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  // Main Hair Crown & Bangs
  ctx.beginPath();
  ctx.roundRect(hx - 10, hy - 10, 20, 7, 5);
  ctx.fill();
  ctx.stroke();

  if (prof.style === 'long_parted') {
    // Shoulder-length side locks framing face (Scribe style!)
    ctx.fillRect(hx - 10, hy - 5, 3.5, 12);
    ctx.strokeRect(hx - 10, hy - 5, 3.5, 12);
    ctx.fillRect(hx + 6.5, hy - 5, 3.5, 12);
    ctx.strokeRect(hx + 6.5, hy - 5, 3.5, 12);
  } else {
    // Sideburns
    ctx.fillRect(hx - 10, hy - 5, 3, 6);
    ctx.fillRect(hx + 7, hy - 5, 3, 6);
  }

  // Hair Crown Specular Highlight
  ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
  ctx.fillRect(hx - 5, hy - 8.5, 10, 2);

  if (prof.style === 'headphones') {
    // Studio Over-Ear Headphones (Chroma style!)
    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.arc(hx, hy - 2, 10.5, Math.PI, 0);
    ctx.stroke();
    ctx.fillStyle = '#475569';
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 1.2;
    ctx.fillRect(hx - 12, hy - 3, 3.5, 6);
    ctx.strokeRect(hx - 12, hy - 3, 3.5, 6);
    ctx.fillRect(hx + 8.5, hy - 3, 3.5, 6);
    ctx.strokeRect(hx + 8.5, hy - 3, 3.5, 6);
  } else if (prof.style === 'glasses') {
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 1;
    ctx.strokeRect(hx - 7, hy - 2, 5.5, 4.5);
    ctx.strokeRect(hx + 1.5, hy - 2, 5.5, 4.5);
  }

  // 5. Overhead Sleep / Whistle Particles
  if (a.state === 'sleeping') {
    ctx.font = 'bold 9px monospace';
    ctx.fillStyle = '#c084fc';
    const zOff = (animFrame % 70) * 0.3;
    ctx.fillText('z', hx + 11, hy - 10 - zOff);
    ctx.fillText('Z', hx + 17, hy - 16 - zOff);
  } else if (a.state === 'whistling') {
    ctx.font = '10px sans-serif';
    ctx.fillStyle = '#f472b6';
    ctx.fillText('♪ ♫', hx + 11, hy - 10 + Math.sin(animFrame * 0.1) * 3);
  }

  // 6. Floating Dark Pill Nameplate OVERHEAD (`• Solaris`, `• Scribe`, etc.)
  ctx.font = 'bold 10px Inter, -apple-system, sans-serif';
  const labelW = Math.max(ctx.measureText(a.name).width + 22, 52);
  const pillX = hx - labelW / 2;
  const pillY = hy - 28;

  ctx.fillStyle = 'rgba(13, 18, 26, 0.90)';
  ctx.strokeStyle = isSelected ? '#10b981' : (isHovered ? '#38bdf8' : 'rgba(148, 163, 184, 0.35)');
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.roundRect(pillX, pillY, labelW, 16, 6);
  ctx.fill();
  ctx.stroke();

  // Status Dot inside pill
  ctx.fillStyle = (a.state === 'sleeping') ? '#c084fc' : prof.dot;
  ctx.beginPath();
  ctx.arc(pillX + 8, pillY + 8, 2.6, 0, Math.PI * 2);
  ctx.fill();

  // Agent Name Text
  ctx.fillStyle = isSelected ? '#34d399' : (isHovered ? '#38bdf8' : '#f1f5f9');
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(a.name, pillX + 14, pillY + 8.5);

  // 7. Speech / Status Shout Bubble (if active)
  if (a.dialogue) {
    ctx.font = 'bold 9px monospace';
    const bw = Math.max(ctx.measureText(a.dialogue).width + 16, 48);
    const bx = hx - bw / 2;
    const by = pillY - 23;
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(bx, by, bw, 18, 5);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#0f172a';
    ctx.textAlign = 'center';
    ctx.fillText(a.dialogue, hx, by + 9.5);
  }

  ctx.restore();
}
