/**
 * @module floor/floor_iso_loft.js
 * @description AgentFloor HD Pixel Loft Scene Composer.
 * Renders the full 2:1 isometric Kairosoft/Habbo-style cutaway tech loft floor,
 * room zones, depth-sorted props, and animated chibi agents (`renderHdPixelLoft`).
 *
 * Part of the AgentFloor canvas subsystem (concatenated globally by frontend/build.py).
 */

function renderHdPixelLoft(ctx) {
  const th = FLOOR_THEMES[activeFloorTheme] || FLOOR_THEMES.techloft;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  // 1. Deep Night Backdrop
  ctx.fillStyle = '#0a0e17';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Four Isometric Floor Corners
  const cTop   = toLoftIso(0, 0);       // (420, 52)
  const cRight = toLoftIso(1040, 0);    // (1015, 284)
  const cBot   = toLoftIso(1040, 540);  // (620, 502)
  const cLeft  = toLoftIso(0, 540);     // (25, 270)

  // 2. Foundation Drop Shadow & 3D Beveled Wooden Slab Skirt
  ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
  ctx.beginPath();
  ctx.moveTo(cLeft.x, cLeft.y + 18);
  ctx.lineTo(cBot.x, cBot.y + 24);
  ctx.lineTo(cRight.x, cRight.y + 18);
  ctx.lineTo(cTop.x, cTop.y + 10);
  ctx.closePath();
  ctx.fill();

  const slabH = 15;
  // Front-Left Wooden Slab Face (cLeft -> cBot)
  ctx.fillStyle = '#5c381b';
  ctx.strokeStyle = '#1f1107';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(cLeft.x, cLeft.y);
  ctx.lineTo(cBot.x, cBot.y);
  ctx.lineTo(cBot.x, cBot.y + slabH);
  ctx.lineTo(cLeft.x, cLeft.y + slabH);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Front-Right Wooden Slab Face (cBot -> cRight)
  ctx.fillStyle = '#442811';
  ctx.beginPath();
  ctx.moveTo(cBot.x, cBot.y);
  ctx.lineTo(cRight.x, cRight.y);
  ctx.lineTo(cRight.x, cRight.y + slabH);
  ctx.lineTo(cBot.x, cBot.y + slabH);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // 3. Diagonal Isometric Hardwood Plank Floor (Bullpen Base)
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(cTop.x, cTop.y);
  ctx.lineTo(cRight.x, cRight.y);
  ctx.lineTo(cBot.x, cBot.y);
  ctx.lineTo(cLeft.x, cLeft.y);
  ctx.closePath();
  ctx.clip();

  // Base warm oak fill
  const isCustomTheme = (activeFloorTheme !== 'techloft');
  ctx.fillStyle = isCustomTheme ? th.floorBase : '#986032';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // 42 Diagonal Isometric Plank Strips along u-axis
  const numPlanks = 42;
  const oakShades = ['#a56a38', '#965e30', '#8d562a', '#ac713f', '#9c6334'];
  for (let i = 0; i < numPlanks; i++) {
    const u0 = (i / numPlanks) * 1040;
    const u1 = ((i + 1) / numPlanks) * 1040;
    const a0 = toLoftIso(u0, 0);
    const a1 = toLoftIso(u1, 0);
    const b1 = toLoftIso(u1, 540);
    const b0 = toLoftIso(u0, 540);

    ctx.fillStyle = isCustomTheme
      ? ((i % 2 === 0) ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.08)')
      : oakShades[i % oakShades.length];
    ctx.beginPath();
    ctx.moveTo(a0.x, a0.y);
    ctx.lineTo(a1.x, a1.y);
    ctx.lineTo(b1.x, b1.y);
    ctx.lineTo(b0.x, b0.y);
    ctx.closePath();
    ctx.fill();

    // Diagonal Plank Seam Line
    ctx.strokeStyle = isCustomTheme ? th.floorTile : '#573216';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(a0.x, a0.y);
    ctx.lineTo(b0.x, b0.y);
    ctx.stroke();

    // Staggered Cross-Joints along each plank
    const joints = [((i * 137) % 320) + 90, ((i * 251) % 340) + 160];
    joints.forEach(vy => {
      const j0 = toLoftIso(u0, vy);
      const j1 = toLoftIso(u1, vy);
      ctx.beginPath();
      ctx.moveTo(j0.x, j0.y);
      ctx.lineTo(j1.x, j1.y);
      ctx.stroke();
    });
  }

  // --- DISTINCT ROOM FLOORING OVERLAYS (1:1 with Office Architecture) ---
  // (A) ROOM 1: SOLARIS EXECUTIVE SUITE FLOOR (u: 20..280, v: 20..230)
  const es0 = toLoftIso(20, 20);
  const es1 = toLoftIso(280, 20);
  const es2 = toLoftIso(280, 230);
  const es3 = toLoftIso(20, 230);
  ctx.fillStyle = '#2b1e17'; // rich dark walnut executive parquet
  ctx.beginPath();
  ctx.moveTo(es0.x, es0.y); ctx.lineTo(es1.x, es1.y); ctx.lineTo(es2.x, es2.y); ctx.lineTo(es3.x, es3.y);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#4a2c17';
  ctx.lineWidth = 1.2;
  ctx.stroke();

  // Executive Velvet Area Rug in Solaris Suite (u: 75..245, v: 65..195)
  const er0 = toLoftIso(75, 65);
  const er1 = toLoftIso(245, 65);
  const er2 = toLoftIso(245, 195);
  const er3 = toLoftIso(75, 195);
  ctx.fillStyle = '#42281a';
  ctx.beginPath();
  ctx.moveTo(er0.x, er0.y); ctx.lineTo(er1.x, er1.y); ctx.lineTo(er2.x, er2.y); ctx.lineTo(er3.x, er3.y);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#d97706';
  ctx.lineWidth = 1.2;
  ctx.stroke();

  // (B) ROOM 2: CONFERENCE WAR ROOM FLOOR (u: 320..740, v: 20..190)
  const cf0 = toLoftIso(320, 20);
  const cf1 = toLoftIso(740, 20);
  const cf2 = toLoftIso(740, 190);
  const cf3 = toLoftIso(320, 190);
  ctx.fillStyle = '#262f3d'; // slate navy boardroom carpet
  ctx.beginPath();
  ctx.moveTo(cf0.x, cf0.y); ctx.lineTo(cf1.x, cf1.y); ctx.lineTo(cf2.x, cf2.y); ctx.lineTo(cf3.x, cf3.y);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = 1;
  ctx.stroke();

  // (C) ROOM 3: BREAK ROOM & PANTRY / KITCHENETTE (u: 800..1020, v: 20..240)
  const pr0 = toLoftIso(800, 20);
  const pr1 = toLoftIso(1020, 20);
  const pr2 = toLoftIso(1020, 240);
  const pr3 = toLoftIso(800, 240);
  ctx.fillStyle = '#3f2e24';
  ctx.beginPath();
  ctx.moveTo(pr0.x, pr0.y); ctx.lineTo(pr1.x, pr1.y); ctx.lineTo(pr2.x, pr2.y); ctx.lineTo(pr3.x, pr3.y);
  ctx.closePath();
  ctx.fill();
  // Checkered Kitchen Tiles in Pantry Area (u: 820..1010, v: 24..140)
  for (let ku = 820; ku < 1000; ku += 36) {
    for (let kv = 24; kv < 130; kv += 26) {
      if (((ku + kv) % 2) === 0) {
        const kt0 = toLoftIso(ku, kv);
        const kt1 = toLoftIso(ku + 36, kv);
        const kt2 = toLoftIso(ku + 36, kv + 26);
        const kt3 = toLoftIso(ku, kv + 26);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.07)';
        ctx.beginPath();
        ctx.moveTo(kt0.x, kt0.y); ctx.lineTo(kt1.x, kt1.y); ctx.lineTo(kt2.x, kt2.y); ctx.lineTo(kt3.x, kt3.y);
        ctx.closePath();
        ctx.fill();
      }
    }
  }

  // (D) ROOM 4: EXECUTIVE RESTROOM & TOILET ANNEX (u: 820..1020, v: 380..520)
  const rr0 = toLoftIso(820, 380);
  const rr1 = toLoftIso(1020, 380);
  const rr2 = toLoftIso(1020, 520);
  const rr3 = toLoftIso(820, 520);
  ctx.fillStyle = '#1e293b'; // slate sanitary tiles
  ctx.beginPath();
  ctx.moveTo(rr0.x, rr0.y); ctx.lineTo(rr1.x, rr1.y); ctx.lineTo(rr2.x, rr2.y); ctx.lineTo(rr3.x, rr3.y);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#a855f7';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Restroom ceramic tile grid
  for (let ru = 820; ru < 1020; ru += 40) {
    const rl0 = toLoftIso(ru, 380);
    const rl1 = toLoftIso(ru, 520);
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(rl0.x, rl0.y); ctx.lineTo(rl1.x, rl1.y); ctx.stroke();
  }
  for (let rv = 380; rv < 520; rv += 30) {
    const rw0 = toLoftIso(820, rv);
    const rw1 = toLoftIso(1020, rv);
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(rw0.x, rw0.y); ctx.lineTo(rw1.x, rw1.y); ctx.stroke();
  }

  ctx.restore();

  // Crisp Floor Perimeter Outline
  ctx.strokeStyle = '#2b180a';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cTop.x, cTop.y);
  ctx.lineTo(cRight.x, cRight.y);
  ctx.lineTo(cBot.x, cBot.y);
  ctx.lineTo(cLeft.x, cLeft.y);
  ctx.closePath();
  ctx.stroke();

  // 4. Left Cutaway Wall: Panoramic Night-City Window Wall (cLeft -> cTop)
  const wallH = 48;
  ctx.fillStyle = '#242c38';
  ctx.strokeStyle = '#11161f';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(cLeft.x, cLeft.y);
  ctx.lineTo(cTop.x, cTop.y);
  ctx.lineTo(cTop.x, cTop.y - wallH);
  ctx.lineTo(cLeft.x, cLeft.y - wallH);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // 5 Panoramic Night-Sky Window Panes along the Left Wall
  for (let wi = 0; wi < 5; wi++) {
    const vStart = 45 + wi * 95;
    const vEnd = vStart + 78;
    const w0 = toLoftIso(0, vStart);
    const w1 = toLoftIso(0, vEnd);
    ctx.fillStyle = '#0e1d2f';
    ctx.strokeStyle = '#18202c';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(w0.x, w0.y - 8);
    ctx.lineTo(w1.x, w1.y - 8);
    ctx.lineTo(w1.x, w1.y - wallH + 6);
    ctx.lineTo(w0.x, w0.y - wallH + 6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Diagonal Glass Reflection Sheen
    ctx.fillStyle = 'rgba(125, 211, 252, 0.08)';
    ctx.beginPath();
    ctx.moveTo(w0.x - 8, w0.y - 10);
    ctx.lineTo(w0.x - 22, w0.y - 2);
    ctx.lineTo(w0.x - 10, w0.y - wallH + 10);
    ctx.lineTo(w0.x - 2, w0.y - wallH + 8);
    ctx.closePath();
    ctx.fill();
  }
  // Warm Wooden Windowsill along Left Wall
  ctx.strokeStyle = '#6e4220';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(cLeft.x, cLeft.y - 6);
  ctx.lineTo(cTop.x, cTop.y - 6);
  ctx.stroke();

  // 5. Back-Right Cutaway Wall: Cocoa-Umber Wall, Briefing Display, Bookshelf & Door (cTop -> cRight)
  ctx.fillStyle = '#3c2e27';
  ctx.strokeStyle = '#1c1411';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(cTop.x, cTop.y);
  ctx.lineTo(cRight.x, cRight.y);
  ctx.lineTo(cRight.x, cRight.y - wallH);
  ctx.lineTo(cTop.x, cTop.y - wallH);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Baseboard Molding on Right Wall
  ctx.strokeStyle = '#5c381b';
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  ctx.moveTo(cTop.x, cTop.y - 2);
  ctx.lineTo(cRight.x, cRight.y - 2);
  ctx.stroke();

  // (a) Interactive Isometric Mission Briefing Screen on Back-Right Wall (u = 360..660)
  const wb0 = toLoftIso(360, 0);
  const wb1 = toLoftIso(650, 0);
  ctx.fillStyle = '#0b1324';
  ctx.strokeStyle = isBriefingActive ? '#ef4444' : '#38bdf8';
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.moveTo(wb0.x, wb0.y - 10);
  ctx.lineTo(wb1.x, wb1.y - 10);
  ctx.lineTo(wb1.x, wb1.y - 40);
  ctx.lineTo(wb0.x, wb0.y - 40);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Briefing Board Status Dot & Label
  const wbMidX = (wb0.x + wb1.x) / 2;
  const wbMidY = (wb0.y + wb1.y) / 2 - 25;
  ctx.save();
  ctx.translate(wbMidX, wbMidY);
  ctx.rotate(Math.atan2(232, 595));
  ctx.fillStyle = isBriefingActive ? '#f87171' : '#34d399';
  ctx.font = 'bold 8.5px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(isBriefingActive ? '🔴 BRIEFING IN SESSION' : '📡 MISSION BRIEFING BOARD', 0, -3);
  ctx.fillStyle = '#94a3b8';
  ctx.font = '7px monospace';
  ctx.fillText('[CLICK TO INSPECT PIPELINE]', 0, 7);
  ctx.restore();

  // (b) 3D Isometric Wooden Bookshelf against Back-Right Wall (u = 740..875, matching Screenshot!)
  const bs0 = toLoftIso(740, 18);
  const bs1 = toLoftIso(875, 18);
  const bsH = 54;
  // Bookcase Back & Frame
  ctx.fillStyle = '#4a2912';
  ctx.strokeStyle = '#1f1006';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(bs0.x, bs0.y);
  ctx.lineTo(bs1.x, bs1.y);
  ctx.lineTo(bs1.x, bs1.y - bsH);
  ctx.lineTo(bs0.x, bs0.y - bsH);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // Left 3D Side Panel of Bookcase
  ctx.fillStyle = '#6e4020';
  ctx.beginPath();
  ctx.moveTo(bs0.x - 8, bs0.y + 4);
  ctx.lineTo(bs0.x, bs0.y);
  ctx.lineTo(bs0.x, bs0.y - bsH);
  ctx.lineTo(bs0.x - 8, bs0.y - bsH + 4);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // 3 Wooden Shelves + Colorful Pixel Books
  [14, 28, 42].forEach((shY, sIdx) => {
    ctx.strokeStyle = '#7c4b23';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(bs0.x, bs0.y - shY);
    ctx.lineTo(bs1.x, bs1.y - shY);
    ctx.stroke();
    // Books along shelf
    const bookColors = ['#ef4444', '#22c55e', '#3b82f6', '#f59e0b', '#e2e8f0', '#a855f7'];
    for (let bi = 0; bi < 6; bi++) {
      const t = (bi + 0.8) / 7.5;
      const bx = bs0.x + (bs1.x - bs0.x) * t;
      const by = bs0.y + (bs1.y - bs0.y) * t - shY;
      ctx.fillStyle = bookColors[(bi + sIdx * 2) % bookColors.length];
      ctx.fillRect(bx, by - 9, 4.5, 8);
      ctx.strokeStyle = '#1c1008';
      ctx.lineWidth = 0.8;
      ctx.strokeRect(bx, by - 9, 4.5, 8);
    }
  });

  // (c) Isometric Dark Office Door on Far Right Wall (u = 940..1015)
  const dr0 = toLoftIso(940, 0);
  const dr1 = toLoftIso(1010, 0);
  ctx.fillStyle = '#262f3d';
  ctx.strokeStyle = '#111827';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(dr0.x, dr0.y);
  ctx.lineTo(dr1.x, dr1.y);
  ctx.lineTo(dr1.x, dr1.y - 42);
  ctx.lineTo(dr0.x, dr0.y - 42);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // Silver Door Handle
  ctx.fillStyle = '#cbd5e1';
  ctx.fillRect(dr0.x + 8, dr0.y - 18, 5, 2.5);

  // --- ISOMETRIC INTERIOR PARTITION WALLS (Dividing Solaris Suite, Conference, Pantry, & Toilet) ---
  // Helper function to draw an isometric interior half-wall with dark outline & wooden top cap
  function drawIsoWall(uStart, vStart, uEnd, vEnd, wHeight = 28) {
    const pA = toLoftIso(uStart, vStart);
    const pB = toLoftIso(uEnd, vEnd);
    // Floor contact shadow
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(pA.x, pA.y); ctx.lineTo(pB.x, pB.y); ctx.stroke();
    // Wall front body
    ctx.fillStyle = '#3a2d24';
    ctx.strokeStyle = '#1a120c';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(pA.x, pA.y);
    ctx.lineTo(pB.x, pB.y);
    ctx.lineTo(pB.x, pB.y - wHeight);
    ctx.lineTo(pA.x, pA.y - wHeight);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Top wooden cap
    ctx.strokeStyle = '#85532f';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(pA.x, pA.y - wHeight);
    ctx.lineTo(pB.x, pB.y - wHeight);
    ctx.stroke();
  }

  // (1) Solaris Executive Suite Walls:
  // South Wall (u: 20..280, v: 230)
  drawIsoWall(20, 230, 280, 230, 26);
  // East Dividing Wall with open doorway (u: 280, v: 20..180) -> door open at 180..230
  drawIsoWall(280, 20, 280, 180, 26);

  // (2) Room 2 Conference Room Dividing Walls:
  // Left Wall (u: 320, v: 20..190)
  drawIsoWall(320, 20, 320, 190, 24);
  // Right Wall (u: 740, v: 20..190)
  drawIsoWall(740, 20, 740, 190, 24);
  // South Wall Left of Door (u: 320..480, v: 190)
  drawIsoWall(320, 190, 480, 190, 24);
  // South Wall Right of Door (u: 580..740, v: 190)
  drawIsoWall(580, 190, 740, 190, 24);

  // (3) Room 3 Pantry / Break Room Walls:
  // Left Wall with Door (u: 800, v: 20..180)
  drawIsoWall(800, 20, 800, 180, 24);
  // South Wall (u: 800..1020, v: 240)
  drawIsoWall(800, 240, 1020, 240, 24);

  // (4) Room 4 Restroom / Toilet Annex Walls:
  // Left Dividing Wall (u: 820, v: 380..520)
  drawIsoWall(820, 380, 820, 520, 24);
  // Top Wall with Doorway (u: 820..950, v: 380)
  drawIsoWall(820, 380, 950, 380, 24);

  // 6. Depth-Sorted Scene Drawables (Plants, Conference Tables, Desks, Water Cooler, Kitchen, Toilet, and Chibi Agents)
  const drawables = [];

  // (a) Perimeter & Cluster Terracotta Potted Plants
  const plantCoords = [
    { wx: 45, wy: 450 },    // Left window plant
    { wx: 250, wy: 215 },   // Solaris Suite doorway plant
    { wx: 45, wy: 70 },     // Top-left window corner plant
    { wx: 690, wy: 55 },    // Conference room plant
    { wx: 770, wy: 430 },   // Bullpen east plant
    { wx: 980, wy: 210 }    // Break room plant
  ];
  plantCoords.forEach(pt => {
    const iso = toLoftIso(pt.wx, pt.wy);
    drawables.push({
      depth: iso.sy,
      draw: () => drawLoftTerracottaPlant(ctx, iso.sx, iso.sy)
    });
  });

  // (b) Room 2 Conference Table & Chairs (Top-Center: wx=520, wy=110)
  const confIso = toLoftIso(520, 110);
  drawables.push({
    depth: confIso.sy - 14,
    draw: () => {
      drawLoftRollingChair(ctx, confIso.sx - 24, confIso.sy - 14, false);
      drawLoftRollingChair(ctx, confIso.sx + 14, confIso.sy - 20, false);
    }
  });
  drawables.push({
    depth: confIso.sy,
    draw: () => drawLoftConferenceTable(ctx, confIso.sx, confIso.sy)
  });
  drawables.push({
    depth: confIso.sy + 18,
    draw: () => {
      drawLoftRollingChair(ctx, confIso.sx - 36, confIso.sy + 14, true);
      drawLoftRollingChair(ctx, confIso.sx + 10, confIso.sy + 22, true);
    }
  });

  // (c) Room 3 Pantry / Break Room Kitchen Counter & Water Cooler (wx=910, wy=100)
  const kitchenIso = toLoftIso(910, 100);
  drawables.push({
    depth: kitchenIso.sy,
    draw: () => {
      ctx.save();
      // Kitchen Counter (Isometric bar)
      ctx.fillStyle = '#475569';
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 1.2;
      ctx.fillRect(kitchenIso.sx - 30, kitchenIso.sy - 10, 60, 18);
      ctx.strokeRect(kitchenIso.sx - 30, kitchenIso.sy - 10, 60, 18);
      ctx.fillStyle = '#64748b';
      ctx.fillRect(kitchenIso.sx - 30, kitchenIso.sy - 14, 60, 4); // counter lip
      // Espresso Machine & Rising Steam
      ctx.fillStyle = '#f59e0b';
      ctx.fillRect(kitchenIso.sx - 22, kitchenIso.sy - 24, 14, 14);
      ctx.strokeRect(kitchenIso.sx - 22, kitchenIso.sy - 24, 14, 14);
      const steamY = (animFrame % 40) * 0.25;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
      ctx.fillRect(kitchenIso.sx - 17, kitchenIso.sy - 28 - steamY, 3, 3);
      // Water Cooler with Blue Jug
      ctx.fillStyle = '#cbd5e1';
      ctx.fillRect(kitchenIso.sx + 12, kitchenIso.sy - 18, 14, 22);
      ctx.strokeRect(kitchenIso.sx + 12, kitchenIso.sy - 18, 14, 22);
      ctx.fillStyle = '#38bdf8';
      ctx.fillRect(kitchenIso.sx + 13, kitchenIso.sy - 34, 12, 16);
      ctx.strokeRect(kitchenIso.sx + 13, kitchenIso.sy - 34, 12, 16);
      ctx.restore();
    }
  });

  // Break Room Round Cafe Lunch Table (wx=890, wy=175)
  const cafeIso = toLoftIso(890, 175);
  drawables.push({
    depth: cafeIso.sy,
    draw: () => {
      ctx.save();
      ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
      ctx.beginPath(); ctx.ellipse(cafeIso.sx, cafeIso.sy + 8, 22, 11, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#92400e';
      ctx.strokeStyle = '#451a03';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.ellipse(cafeIso.sx, cafeIso.sy, 20, 10, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      // Coffee mugs on cafe table
      ctx.fillStyle = '#fef3c7'; ctx.fillRect(cafeIso.sx - 8, cafeIso.sy - 4, 4, 4);
      ctx.fillStyle = '#38bdf8'; ctx.fillRect(cafeIso.sx + 3, cafeIso.sy - 2, 4, 4);
      ctx.restore();
    }
  });

  // (d) Room 4 Restroom / Toilet Annex Amenities (wx=920, wy=450)
  const restIso = toLoftIso(920, 450);
  drawables.push({
    depth: restIso.sy,
    draw: () => {
      ctx.save();
      // Dual Privacy Stalls
      ctx.fillStyle = '#334155';
      ctx.strokeStyle = '#64748b';
      ctx.lineWidth = 1.2;
      ctx.fillRect(restIso.sx - 28, restIso.sy - 22, 24, 30);
      ctx.strokeRect(restIso.sx - 28, restIso.sy - 22, 24, 30);
      ctx.fillRect(restIso.sx + 2, restIso.sy - 22, 24, 30);
      ctx.strokeRect(restIso.sx + 2, restIso.sy - 22, 24, 30);
      // Porcelain Toilets
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(restIso.sx - 22, restIso.sy - 6, 12, 12);
      ctx.fillRect(restIso.sx + 8, restIso.sy - 6, 12, 12);
      // Restroom vanity sink & mirror
      ctx.fillStyle = '#475569';
      ctx.fillRect(restIso.sx + 30, restIso.sy - 16, 18, 20);
      ctx.fillStyle = '#38bdf8';
      ctx.fillRect(restIso.sx + 33, restIso.sy - 12, 12, 8);
      ctx.restore();
    }
  });

  // (e) Agent Workstations & Chibi Agent Sprites (Respects exact WORKSTATION_SLOTS coordinates!)
  if (agents && agents.length > 0) {
    agents.forEach((a, idx) => {
      updateAgentSimulation(a);

      // Workstation Desk at (a.homeX, a.homeY)
      const deskIso = toLoftIso(a.homeX, a.homeY);
      drawables.push({
        depth: deskIso.sy + 2,
        draw: () => drawLoftIsoDesk(ctx, deskIso.sx, deskIso.sy, a.state === 'working', idx)
      });

      // Agent Sprite at (a.x, a.y)
      const agIso = toLoftIso(a.x, a.y);
      // When seated at home desk, position slightly behind the desk monitor so the desk overlaps their lap naturally
      const atHome = (Math.hypot(a.x - a.homeX, a.y - a.homeY) < 8);
      const renderX = atHome ? deskIso.sx + 8 : agIso.sx;
      const renderY = atHome ? deskIso.sy - 10 : agIso.sy;
      drawables.push({
        depth: atHome ? (deskIso.sy - 2) : (agIso.sy + 4),
        draw: () => drawLoftChibiAgent(ctx, a, idx, renderX, renderY, atHome)
      });
    });
  }

  // Sort back-to-front by screen Y (`depth`) and render
  drawables.sort((a, b) => a.depth - b.depth);
  drawables.forEach(item => item.draw());

  ctx.restore();
}
