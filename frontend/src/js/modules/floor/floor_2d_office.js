/**
 * @module floor/floor_2d_office.js
 * @description AgentFloor Top-Down 2D Blueprint Office Renderer.
 * Main animation loop (`renderOfficeCanvas`) delegating 3D/HD Loft or drawing the
 * 2D blueprint architecture, walls, props, and workstation desks.
 *
 * Part of the AgentFloor canvas subsystem (concatenated globally by frontend/build.py).
 */

function renderOfficeCanvas() {
  animFrame++;
  if (floorViewMode === '3d' || floorViewMode === 'iso') {
    renderIsoFloor(ctx);
    requestAnimationFrame(renderOfficeCanvas);
    return;
  }
  if (floorViewMode === 'hd_loft') {
    renderHdPixelLoft(ctx);
    requestAnimationFrame(renderOfficeCanvas);
    return;
  }
  const th = FLOOR_THEMES[activeFloorTheme] || FLOOR_THEMES.cyberpunk;

  // 0. Always clear full un-transformed viewport first so 2.5D/3D never leaves ghost corners!
  const isHdLoft = (floorViewMode === 'hd_loft');
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#060913';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Subtle architectural backdrop grid in 2.5D diorama mode
  if (floorViewMode !== '2d' && !isHdLoft) {
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.06)';
    ctx.lineWidth = 1;
    for (let gx = 0; gx < canvas.width; gx += 32) {
      ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, canvas.height); ctx.stroke();
    }
    for (let gy = 0; gy < canvas.height; gy += 32) {
      ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(canvas.width, gy); ctx.stroke();
    }
    // Perspective mode badge in top-right corner of viewport
    ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
    ctx.fillRect(canvas.width - 178, 10, 168, 22);
    ctx.strokeStyle = '#a855f7';
    ctx.lineWidth = 1;
    ctx.strokeRect(canvas.width - 178, 10, 168, 22);
    ctx.fillStyle = '#d8b4fe';
    ctx.font = 'bold 9px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('📐 2.5D ISOMETRIC VIEW', canvas.width - 94, 21);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
  }
  ctx.restore();

  ctx.save();
  if (floorViewMode === '2.5d') {
    ctx.translate(520, 266);
    ctx.transform(0.88, 0.03, -0.10, 0.80, 0, 0);
    ctx.translate(-520, -266);
  }

  // Draw 3D / 2.5D Extruded Diorama Foundation Slab beneath floor
  if (floorViewMode !== '2d' && !isHdLoft) {
    const slabDepth = floorViewMode === '3d' ? 22 : 14;
    // Drop shadow under diorama slab
    ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
    ctx.fillRect(18, 24, canvas.width - 12, canvas.height - 8);

    // South extruded cliff face
    ctx.fillStyle = floorViewMode === '3d' ? '#1e293b' : '#0f172a';
    ctx.beginPath();
    ctx.moveTo(10, canvas.height - 10);
    ctx.lineTo(canvas.width - 10, canvas.height - 10);
    ctx.lineTo(canvas.width - 10 + slabDepth * 0.5, canvas.height - 10 + slabDepth);
    ctx.lineTo(10 + slabDepth * 0.5, canvas.height - 10 + slabDepth);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = th.wallBorder;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // East extruded cliff face
    ctx.fillStyle = floorViewMode === '3d' ? '#0f172a' : '#090d16';
    ctx.beginPath();
    ctx.moveTo(canvas.width - 10, 10);
    ctx.lineTo(canvas.width - 10 + slabDepth * 0.5, 10 + slabDepth);
    ctx.lineTo(canvas.width - 10 + slabDepth * 0.5, canvas.height - 10 + slabDepth);
    ctx.lineTo(canvas.width - 10, canvas.height - 10);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Voxel stepped bedrock layers in 3D mode
    if (floorViewMode === '3d') {
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.2)';
      ctx.lineWidth = 1;
      for (let vx = 20; vx < canvas.width - 10; vx += 40) {
        ctx.beginPath();
        ctx.moveTo(vx, canvas.height - 10);
        ctx.lineTo(vx + slabDepth * 0.5, canvas.height - 10 + slabDepth);
        ctx.stroke();
      }
    }
  }

  // 1. Floor Base Color & Texture
  if (isHdLoft) {
    // Rich Staggered Hardwood / Textured Loft Floor Planks
    ctx.fillStyle = th.floorBase;
    ctx.fillRect(10, 10, canvas.width - 20, canvas.height - 20);
    const plankH = 16;
    const plankW = 64;
    for (let py = 10, row = 0; py < canvas.height - 10; py += plankH, row++) {
      // Alternating subtle plank shade
      ctx.fillStyle = (row % 2 === 0) ? 'rgba(255, 255, 255, 0.025)' : 'rgba(0, 0, 0, 0.08)';
      ctx.fillRect(10, py, canvas.width - 20, plankH);
      // Horizontal plank seam
      ctx.strokeStyle = th.floorTile;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(10, py);
      ctx.lineTo(canvas.width - 10, py);
      ctx.stroke();
      // Staggered vertical plank joints
      const offset = (row % 2) * (plankW / 2);
      for (let px = 10 + offset; px < canvas.width - 10; px += plankW) {
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px, Math.min(py + plankH, canvas.height - 10));
        ctx.stroke();
      }
    }
  } else {
    ctx.fillStyle = th.floorBase;
    ctx.fillRect(10, 10, canvas.width - 20, canvas.height - 20);

    // Floor Tile Seams
    ctx.strokeStyle = th.floorTile;
    ctx.lineWidth = floorViewMode === '3d' ? 1.5 : 1;
    const tileSize = 40;
    for (let x = 10; x < canvas.width - 10; x += tileSize) {
      ctx.beginPath(); ctx.moveTo(x, 10); ctx.lineTo(x, canvas.height - 10); ctx.stroke();
    }
    for (let y = 10; y < canvas.height - 10; y += tileSize) {
      ctx.beginPath(); ctx.moveTo(10, y); ctx.lineTo(canvas.width - 10, y); ctx.stroke();
    }
  }

  // Outer Office Border Wall
  ctx.strokeStyle = th.wallBorder;
  ctx.lineWidth = 8;
  ctx.strokeRect(10, 10, canvas.width - 20, canvas.height - 20);
  if (isHdLoft) {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(14, 14, canvas.width - 28, canvas.height - 28);
  }

  // --- ROOM 1: EXECUTIVE SUITE (Solaris Office - Top Left) ---
  // Carpet floor
  ctx.fillStyle = th.execCarpet;
  ctx.fillRect(20, 20, 260, 210);
  if (isHdLoft) {
    // Subtle ambient wall drop shadow inside Executive Suite
    ctx.fillStyle = 'rgba(0, 0, 0, 0.24)';
    ctx.fillRect(20, 20, 260, 10);
    // Bookshelf / Server rack along top-right wall of Exec Suite
    ctx.fillStyle = '#291d12';
    ctx.fillRect(225, 24, 48, 16);
    ctx.strokeStyle = '#78350f';
    ctx.lineWidth = 1;
    ctx.strokeRect(225, 24, 48, 16);
    ctx.fillStyle = '#38bdf8'; ctx.fillRect(230, 28, 8, 8);
    ctx.fillStyle = '#f59e0b'; ctx.fillRect(241, 28, 6, 8);
    ctx.fillStyle = '#10b981'; ctx.fillRect(250, 28, 10, 8);
  }
  // Office Walls
  drawWall(20, 230, 260, 8); // bottom wall
  drawWall(280, 20, 8, 160); // right wall (with door gap at 180..230)
  // Name plaque
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(32, 28, 186, 20);
  ctx.strokeStyle = th.execPlaqueBorder;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(32, 28, 186, 20);
  ctx.fillStyle = th.execPlaqueText;
  ctx.font = 'bold 8px monospace';

  const activeInstObj = (typeof availableInstances !== 'undefined' ? availableInstances : []).find(i => i.key === (typeof currentInstanceKey !== 'undefined' ? currentInstanceKey : 'agents_bs'));
  const activeFleetLabel = activeInstObj?.label || (typeof currentInstanceKey !== 'undefined' ? currentInstanceKey : 'FLEET');
  const leadAgent = (typeof agents !== 'undefined' && agents.length > 0) ? agents[0] : null;
  const plaqueText = leadAgent ? `🏛️ ${leadAgent.name.toUpperCase()} • COMMAND SUITE` : `🏛️ ${activeFleetLabel.toUpperCase()} • SUITE`;
  ctx.fillText(plaqueText, 40, 34);
  // Floor rug under desk
  ctx.fillStyle = th.execRug;
  ctx.fillRect(86, 78, 148, 104);
  if (isHdLoft) {
    // Woven rug border & inner geometric trim
    ctx.strokeStyle = th.execPlaqueBorder;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(90, 82, 140, 96);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 1;
    ctx.strokeRect(96, 88, 128, 84);
  }

  // --- ROOM 2: CONFERENCE & BRIEFING ROOM (Top Center) ---
  ctx.fillStyle = th.confCarpet;
  ctx.fillRect(320, 20, 420, 170);
  if (isHdLoft) {
    // Executive conference area rug beneath boardroom table
    ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
    ctx.fillRect(392, 88, 276, 84);
    ctx.strokeStyle = th.confBorder;
    ctx.lineWidth = 1;
    ctx.strokeRect(395, 91, 270, 78);
  }
  drawWall(320, 20, 8, 170); // left wall
  drawWall(740, 20, 8, 170); // right wall
  drawWall(320, 190, 160, 8); // bottom left wall
  drawWall(560, 190, 180, 8); // bottom right wall (doorway between 480..560)

  // Large Sleek Executive Mission Briefing Board (Cyber Glass Terminal)
  const wbX = 360, wbY = 24, wbW = 340, wbH = 62;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
  ctx.fillRect(wbX - 1, wbY + 1, wbW + 2, wbH + 2); // subtle drop shadow
  ctx.fillStyle = '#0b1324'; // sleek dark glass surface
  ctx.fillRect(wbX, wbY, wbW, wbH);
  ctx.strokeStyle = th.confBorder; // themed frame
  ctx.lineWidth = 2;
  ctx.strokeRect(wbX, wbY, wbW, wbH);

  // Top Header Strip
  ctx.fillStyle = '#070d19';
  ctx.fillRect(wbX, wbY, wbW, 18);
  ctx.fillStyle = '#38bdf8';
  ctx.font = 'bold 8.5px monospace';
  ctx.fillText('📡 MISSION BRIEFING BOARD', wbX + 12, wbY + 4);

  ctx.fillStyle = '#0284c7';
  ctx.font = '7.5px monospace';
  ctx.fillText('[🔍 CLICK TO INSPECT]', wbX + 215, wbY + 5);

  // Status indicator on board
  ctx.font = 'bold 8.5px monospace';
  if (isBriefingActive) {
    ctx.fillStyle = '#ef4444';
    ctx.fillText('🔴 ALL-HANDS MISSION BRIEFING IN SESSION', wbX + 12, wbY + 24);
  } else {
    ctx.fillStyle = '#10b981';
    ctx.fillText(`🟢 FLEET READY: ${activeFleetLabel.toUpperCase()}`, wbX + 12, wbY + 24);
  }

  // High-contrast clean summary text (Dynamic agent pipeline sequence)
  ctx.fillStyle = '#94a3b8';
  ctx.font = '7.5px monospace';
  const pipelineAgentsText = (typeof agents !== 'undefined' && agents.length > 0)
    ? `Workflow: ${agents.map(a => a.name).join(' ➔ ')}`
    : 'Standby • 0 active agents registered';
  ctx.fillText(pipelineAgentsText, wbX + 12, wbY + 38);

  // Schedule subtitle (Dynamic crons check)
  ctx.fillStyle = '#64748b';
  ctx.font = '7px monospace';
  const userTzName = (typeof getUserTzBadge === 'function') ? getUserTzBadge() : 'GMT+7';
  const activeCrons = (typeof cronJobsData !== 'undefined' && Array.isArray(cronJobsData)) ? cronJobsData : [];
  let schedText = 'Standby • Interactive Workstation';
  if (activeCrons.length > 0) {
    const firstCron = activeCrons[0];
    const nextTime = firstCron.next_run_at ? (typeof formatDateTimeInUserTz === 'function' ? formatDateTimeInUserTz(firstCron.next_run_at) : firstCron.next_run_at) : (firstCron.schedule || 'Scheduled');
    schedText = `Next: ${firstCron.name || 'Job'} (${nextTime})`;
  }
  ctx.fillText(schedText, wbX + 12, wbY + 49);

  // Cyber Marker / Console Tray at bottom
  ctx.fillStyle = '#1e293b';
  ctx.fillRect(wbX + 110, wbY + wbH, 120, 3.5);
  ctx.fillStyle = '#ef4444'; ctx.fillRect(wbX + 128, wbY + wbH - 1.5, 14, 2);
  ctx.fillStyle = '#38bdf8'; ctx.fillRect(wbX + 152, wbY + wbH - 1.5, 14, 2);
  ctx.fillStyle = '#10b981'; ctx.fillRect(wbX + 176, wbY + wbH - 1.5, 14, 2);

  // Boardroom Table & Chairs
  if (isHdLoft) {
    // Drop shadow under boardroom table
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.fillRect(408, 104, 244, 62);
    // Beveled Mahogany Table with Center Glass Conduit
    ctx.fillStyle = '#5c3a21';
    ctx.fillRect(410, 100, 240, 60);
    ctx.fillStyle = '#3e2723';
    ctx.fillRect(410, 154, 240, 6); // front beveled edge
    ctx.strokeStyle = '#a16207';
    ctx.lineWidth = 2;
    ctx.strokeRect(410, 100, 240, 60);
    // Center Dark Glass Tech Strip
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(435, 125, 190, 10);
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 0.8;
    ctx.strokeRect(435, 125, 190, 10);
    // Laptops & Notepads on Table
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(455, 106, 22, 14);
    ctx.fillStyle = '#38bdf8';
    ctx.fillRect(457, 108, 18, 10);
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(515, 106, 26, 15);
    ctx.fillStyle = '#10b981';
    ctx.fillRect(517, 108, 22, 11);
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(580, 140, 22, 12);
    ctx.fillStyle = '#a855f7';
    ctx.fillRect(582, 142, 18, 8);
  } else {
    ctx.fillStyle = '#5c3a21'; // Mahogany
    ctx.fillRect(410, 100, 240, 60);
    ctx.strokeStyle = '#85532f';
    ctx.lineWidth = 2;
    ctx.strokeRect(410, 100, 240, 60);
    // Laptop on table
    ctx.fillStyle = '#0284c7';
    ctx.fillRect(515, 115, 30, 18);
  }
  // Chairs around table
  [440, 490, 540, 590].forEach(cx => {
    drawOfficeChair(cx, 85, th.chairColor);
    drawOfficeChair(cx, 168, th.chairColor);
  });

  // --- ROOM 3: BREAK ROOM & KITCHENETTE (Right Side Top) ---
  ctx.fillStyle = th.breakCarpet;
  ctx.fillRect(800, 20, 220, 220);
  if (isHdLoft) {
    // Checkered Cafe Tile Floor Accent in Kitchenette Zone
    for (let kx = 810; kx < 1010; kx += 20) {
      for (let ky = 24; ky < 114; ky += 20) {
        if (((kx + ky) / 20) % 2 === 0) {
          ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
          ctx.fillRect(kx, ky, 20, 20);
        }
      }
    }
  }
  drawWall(800, 20, 8, 160); // left wall (door at 180..220)
  drawWall(800, 240, 220, 8); // bottom wall

  // Kitchen Counter & Sink
  ctx.fillStyle = isHdLoft ? '#475569' : '#334155';
  ctx.fillRect(820, 30, 180, 28);
  if (isHdLoft) {
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(820, 54, 180, 6); // counter front cabinet lip
    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = 1;
    ctx.strokeRect(820, 30, 180, 28);
  }
  ctx.fillStyle = '#94a3b8';
  ctx.fillRect(835, 34, 24, 16); // Sink
  ctx.fillStyle = '#38bdf8';
  ctx.fillRect(838, 37, 18, 10); // Water in sink
  ctx.fillStyle = '#f59e0b';
  ctx.fillRect(890, 26, 20, 20); // Espresso / Coffee machine
  if (isHdLoft) {
    ctx.fillStyle = '#78350f';
    ctx.fillRect(894, 32, 12, 10);
    // Animated coffee steam wisp
    const steamOffset = (animFrame % 40) * 0.25;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
    ctx.fillRect(898, 22 - steamOffset, 3, 3);
    ctx.fillRect(902, 19 - steamOffset * 0.8, 2, 2);
    // Coffee mugs on counter
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(922, 36, 6, 7);
    ctx.fillStyle = '#38bdf8';
    ctx.fillRect(932, 36, 6, 7);
  }
  // Water Cooler
  ctx.fillStyle = '#38bdf8';
  ctx.fillRect(960, 70, 20, 26); // Water jug
  if (isHdLoft) {
    ctx.fillStyle = '#bae6fd';
    ctx.fillRect(964, 74, 5, 16); // glass highlight
  }
  ctx.fillStyle = '#cbd5e1';
  ctx.fillRect(958, 96, 24, 30); // Cooler base
  // Break room lunch table
  if (isHdLoft) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.beginPath(); ctx.arc(892, 164, 28, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = isHdLoft ? '#92400e' : '#78350f';
  ctx.beginPath(); ctx.arc(890, 160, 26, 0, Math.PI * 2); ctx.fill();
  if (isHdLoft) {
    ctx.strokeStyle = '#d97706';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(890, 160, 26, 0, Math.PI * 2); ctx.stroke();
    // Coffee cups on round cafe table
    ctx.fillStyle = '#fef3c7';
    ctx.fillRect(882, 154, 6, 6);
    ctx.fillRect(894, 162, 6, 6);
  }
  drawOfficeChair(855, 160, '#475569');
  drawOfficeChair(925, 160, '#475569');

  // --- BL-AGF-11: ROOM 4: RESTROOM & BREAK ANNEX (Bottom Right: x: 820..1020, y: 380..520) ---
  ctx.fillStyle = th.restroomCarpet;
  ctx.fillRect(820, 380, 200, 140);

  // Ceramic Tile Grid in Restroom
  ctx.strokeStyle = th.restroomTile;
  ctx.lineWidth = 1;
  for (let rx = 820; rx < 1020; rx += 20) {
    ctx.beginPath(); ctx.moveTo(rx, 380); ctx.lineTo(rx, 520); ctx.stroke();
  }
  for (let ry = 380; ry < 520; ry += 20) {
    ctx.beginPath(); ctx.moveTo(820, ry); ctx.lineTo(1020, ry); ctx.stroke();
  }

  // Restroom Partition Walls
  drawWall(820, 380, 140, 8); // top wall (doorway at 960..1020)
  drawWall(820, 380, 8, 140); // left dividing wall

  // Restroom Entrance Plaque
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(830, 386, 110, 14);
  ctx.strokeStyle = '#a855f7';
  ctx.lineWidth = 1;
  ctx.strokeRect(830, 386, 110, 14);
  ctx.fillStyle = '#c084fc';
  ctx.font = 'bold 7px monospace';
  ctx.fillText('🚻 EXECUTIVE RESTROOM', 834, 390);

  // Two Privacy Stalls
  // Stall 1 (x: 835..885, y: 440..510)
  ctx.fillStyle = '#334155';
  ctx.fillRect(835, 440, 50, 70);
  ctx.strokeStyle = '#64748b';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(835, 440, 50, 70);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(850, 480, 20, 24); // porcelain toilet
  ctx.fillStyle = '#cbd5e1';
  ctx.fillRect(852, 474, 16, 7); // water tank

  // Stall 2 (x: 895..945, y: 440..510)
  ctx.fillStyle = '#334155';
  ctx.fillRect(895, 440, 50, 70);
  ctx.strokeStyle = '#64748b';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(895, 440, 50, 70);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(910, 480, 20, 24); // porcelain toilet
  ctx.fillStyle = '#cbd5e1';
  ctx.fillRect(912, 474, 16, 7); // water tank

  // Sink Counter, Basins & Mirror (x: 960..1010, y: 410..470)
  ctx.fillStyle = '#475569';
  ctx.fillRect(965, 415, 45, 60);
  ctx.fillStyle = '#38bdf8';
  ctx.fillRect(972, 422, 16, 12); // sink basin 1
  ctx.fillRect(972, 445, 16, 12); // sink basin 2
  // Large Wall Mirror
  ctx.fillStyle = '#67e8f9';
  ctx.fillRect(1012, 418, 3, 54);

  // Potted plants
  drawPlant(990, 190);
  drawPlant(250, 480);
  drawPlant(40, 480);
  drawPlant(805, 510);
  if (isHdLoft) {
    drawPlant(302, 42);
    drawPlant(762, 42);
  }

  // --- BULLPEN OFFICE DESKS & AGENT SPRITES ---
  if (!agents || agents.length === 0) {
    // Draw 6 available Bullpen desks in standby mode
    for (let i = 0; i < 6; i++) {
      const slot = WORKSTATION_SLOTS[i + 1] || { x: 380 + (i % 3) * 150, y: 390 };
      const dx = slot.x;
      const dy = slot.y;
      ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
      ctx.fillRect(dx - 38, dy - 8, 76, 32);
      ctx.fillStyle = '#334155';
      ctx.fillRect(dx - 36, dy - 12, 72, 30);
      ctx.strokeStyle = '#475569';
      ctx.lineWidth = 1;
      ctx.strokeRect(dx - 36, dy - 12, 72, 30);
      // Standby monitor
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(dx - 18, dy - 24, 36, 16);
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(dx - 16, dy - 22, 32, 12);
    }

    // Center floor empty fleet banner
    ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
    ctx.fillRect(320, 310, 420, 60);
    ctx.strokeStyle = '#06b6d4';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(320, 310, 420, 60);
    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 12px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`FLEET: ${(currentInstanceKey || 'ACTIVE').toUpperCase()} • 0 ACTIVE AGENTS`, 530, 333);
    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px monospace';
    ctx.fillText('12 Bullpen Workstations Wired & Ready for Deployment', 530, 352);
  } else {
    renderOfficeDesks();
    agents.forEach(a => {
      updateAgentSimulation(a);
      renderAgentSprite(a);
    });
  }

  ctx.restore();
  requestAnimationFrame(renderOfficeCanvas);
}

// Wall drawing helper (with extruded 3D wall height in 2.5d / 3d modes & beveled architectural trim in hd_loft)
function drawWall(x, y, w, h) {
  if (floorViewMode === 'hd_loft') {
    const th = FLOOR_THEMES[activeFloorTheme] || FLOOR_THEMES.techloft;
    // Ambient floor shadow cast by interior wall
    ctx.fillStyle = 'rgba(0, 0, 0, 0.32)';
    ctx.fillRect(x + 2, y + 3, w, h + 3);
    // Beveled 3-layer wall body
    ctx.fillStyle = th.wallFill || '#334155';
    ctx.fillRect(x, y - 3, w, h + 3);
    // Top highlight trim
    ctx.fillStyle = th.wallHighlight || '#94a3b8';
    ctx.fillRect(x, y - 3, w, 2.5);
    // Crisp dark border
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y - 3, w, h + 3);
    return;
  }
  if (floorViewMode !== '2d') {
    const wallElev = floorViewMode === '3d' ? 12 : 7;
    // Extruded vertical wall face
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(x, y - wallElev, w, h + wallElev);
    // Top cap of wall
    ctx.fillStyle = '#475569';
    ctx.fillRect(x, y - wallElev, w, h);
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y - wallElev, w, h);
    return;
  }
  ctx.fillStyle = '#334155';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#475569';
  ctx.fillRect(x, y, Math.min(w, 2), h);
}

function drawPlant(x, y) {
  if (floorViewMode === '3d') {
    // Voxel blocky planter + cubic leaves
    ctx.fillStyle = '#78350f';
    ctx.fillRect(x - 9, y - 6, 18, 14);
    ctx.strokeStyle = '#451a03';
    ctx.lineWidth = 1;
    ctx.strokeRect(x - 9, y - 6, 18, 14);
    ctx.fillStyle = '#16a34a';
    ctx.fillRect(x - 11, y - 20, 22, 15);
    ctx.fillStyle = '#22c55e';
    ctx.fillRect(x - 8, y - 25, 16, 8);
    return;
  }
  if (floorViewMode === 'hd_loft') {
    // Drop shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.beginPath(); ctx.ellipse(x, y + 7, 11, 5, 0, 0, Math.PI * 2); ctx.fill();
    // Terracotta Rim Planter
    ctx.fillStyle = '#9a3412';
    ctx.fillRect(x - 8, y - 5, 16, 12);
    ctx.fillStyle = '#c2410c';
    ctx.fillRect(x - 10, y - 7, 20, 4);
    ctx.strokeStyle = '#431407';
    ctx.lineWidth = 1;
    ctx.strokeRect(x - 8, y - 5, 16, 12);
    // Multi-layered lush pixel foliage
    ctx.fillStyle = '#14532d';
    ctx.beginPath(); ctx.arc(x, y - 12, 12, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#16a34a';
    ctx.beginPath(); ctx.arc(x - 5, y - 14, 8, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(x + 5, y - 13, 8, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#4ade80';
    ctx.beginPath(); ctx.arc(x - 2, y - 17, 5, 0, Math.PI * 2); ctx.fill();
    return;
  }
  ctx.fillStyle = '#78350f';
  ctx.fillRect(x - 8, y - 6, 16, 14);
  ctx.fillStyle = '#16a34a';
  ctx.beginPath(); ctx.arc(x, y - 10, 12, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#15803d';
  ctx.beginPath(); ctx.arc(x - 4, y - 14, 8, 0, Math.PI * 2); ctx.fill();
}

function drawOfficeChair(x, y, color = '#334155') {
  if (floorViewMode === 'hd_loft') {
    // Chair caster shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.38)';
    ctx.beginPath(); ctx.ellipse(x, y + 6, 11, 5, 0, 0, Math.PI * 2); ctx.fill();
    // Armrests
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(x - 11, y - 5, 3, 10);
    ctx.fillRect(x + 8, y - 5, 3, 10);
    // Cushioned Seat
    ctx.fillStyle = color;
    ctx.fillRect(x - 8, y - 6, 16, 12);
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 1;
    ctx.strokeRect(x - 8, y - 6, 16, 12);
    // Ergonomic High Backrest with Lumbar Accent
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(x - 9, y - 11, 18, 6);
    ctx.fillStyle = '#475569';
    ctx.fillRect(x - 6, y - 10, 12, 2);
    return;
  }
  if (floorViewMode !== '2d') {
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(x - 9, y - 2, 18, 12);
  }
  ctx.fillStyle = color;
  ctx.fillRect(x - 8, y - 6, 16, 12);
  ctx.fillStyle = '#1e293b';
  ctx.fillRect(x - 10, y - 10, 20, 5); // backrest
}

// Office Desks Drawing
function renderOfficeDesks() {
  const isHdLoft = (floorViewMode === 'hd_loft');
  agents.forEach((a, idx) => {
    const dx = a.homeX;
    const dy = a.homeY;

    // Shadow beneath desk
    ctx.fillStyle = isHdLoft ? 'rgba(0, 0, 0, 0.48)' : 'rgba(0, 0, 0, 0.42)';
    ctx.fillRect(dx - 40, dy - 6, 80, (floorViewMode !== '2d' || isHdLoft) ? 38 : 32);

    // 3D / 2.5D / HD Loft Extruded Desk Front Panel & Legs
    const th = FLOOR_THEMES[activeFloorTheme] || FLOOR_THEMES.techloft;
    if (floorViewMode !== '2d') {
      const deskDepth = floorViewMode === '3d' ? 11 : (isHdLoft ? 6 : 7);
      ctx.fillStyle = isHdLoft ? '#271709' : '#0f172a';
      ctx.fillRect(dx - 38, dy + 18, 76, deskDepth);
      ctx.strokeStyle = th.deskBorder;
      ctx.lineWidth = 1;
      ctx.strokeRect(dx - 38, dy + 18, 76, deskDepth);
      // Desk legs
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(dx - 35, dy + 18 + deskDepth, 5, 4);
      ctx.fillRect(dx + 30, dy + 18 + deskDepth, 5, 4);
    }

    // Warm wooden desk top (themed)
    ctx.fillStyle = (a.theme === 'orchestrator') ? th.deskLead : th.deskTop;
    ctx.fillRect(dx - 38, dy - 12, 76, 30);
    if (isHdLoft) {
      // Subtle wood grain & top bezel highlight
      ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.fillRect(dx - 37, dy - 11, 74, 3);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.14)';
      ctx.fillRect(dx - 37, dy + 14, 74, 3);
      // Desk Mat / Mousepad
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(dx - 20, dy - 8, 40, 18);
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.35)';
      ctx.lineWidth = 0.8;
      ctx.strokeRect(dx - 20, dy - 8, 40, 18);
    }
    ctx.strokeStyle = (a.theme === 'orchestrator') ? (th.id === 'cyberpunk' ? '#00f0ff' : '#f59e0b') : th.deskBorder;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(dx - 38, dy - 12, 76, 30);

    if (isHdLoft) {
      // Dual / Ultrawide Monitor Setup in HD Loft Mode
      // Left Monitor
      ctx.fillStyle = '#090d16';
      ctx.fillRect(dx - 29, dy - 25, 28, 16);
      ctx.fillStyle = (a.state === 'working') ? '#0284c7' : '#1e293b';
      ctx.fillRect(dx - 27, dy - 23, 24, 12);
      // Right Monitor
      ctx.fillStyle = '#090d16';
      ctx.fillRect(dx + 1, dy - 25, 28, 16);
      ctx.fillStyle = (a.state === 'working') ? '#0f172a' : '#1e293b';
      ctx.fillRect(dx + 3, dy - 23, 24, 12);

      if (a.state === 'working') {
        // Left screen IDE code lines
        ctx.fillStyle = '#7dd3fc';
        ctx.fillRect(dx - 25, dy - 21, 12, 1.5);
        ctx.fillStyle = '#f8fafc';
        ctx.fillRect(dx - 25, dy - 18, 18, 1.5);
        ctx.fillStyle = '#fde047';
        ctx.fillRect(dx - 25, dy - 15, 14, 1.5);
        // Right screen terminal / metrics
        ctx.fillStyle = '#34d399';
        ctx.fillRect(dx + 5, dy - 21, 16, 1.5);
        ctx.fillStyle = '#38bdf8';
        ctx.fillRect(dx + 5, dy - 18, 20, 1.5);
        ctx.fillStyle = '#c084fc';
        ctx.fillRect(dx + 5, dy - 15, 11, 1.5);
      }

      // Warm Desk Lamp on Left Corner & Coffee Mug on Right Corner
      ctx.fillStyle = '#fbbf24';
      ctx.fillRect(dx - 34, dy - 8, 5, 5);
      if (a.state === 'working') {
        ctx.fillStyle = 'rgba(251, 191, 36, 0.16)';
        ctx.beginPath(); ctx.arc(dx - 31, dy - 5, 10, 0, Math.PI * 2); ctx.fill();
      }
      // Ceramic Coffee Mug
      ctx.fillStyle = (idx % 2 === 0) ? '#f8fafc' : '#38bdf8';
      ctx.fillRect(dx + 26, dy - 4, 6, 7);
      ctx.fillStyle = '#451a03';
      ctx.fillRect(dx + 27, dy - 3, 4, 3);
    } else {
      // Classic Single Computer Monitor facing the chair
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(dx - 18, dy - 24, 36, 16);
      ctx.fillStyle = (a.state === 'working') ? '#38bdf8' : '#334155';
      ctx.fillRect(dx - 16, dy - 22, 32, 12); // screen glow
      // Screen text lines
      if (a.state === 'working') {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(dx - 12, dy - 18, 16, 2);
        ctx.fillRect(dx - 12, dy - 14, 22, 2);
      }
    }

    // Keyboard & Mouse
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(dx - 13, dy - 6, 22, 6);
    if (isHdLoft) {
      ctx.fillStyle = '#64748b';
      ctx.fillRect(dx - 11, dy - 5, 18, 1.5);
      ctx.fillRect(dx - 11, dy - 2.5, 15, 1.5);
      // Wireless mouse
      ctx.fillStyle = '#94a3b8';
      ctx.fillRect(dx + 12, dy - 5, 4, 5);
    }

    // Swivel chair behind desk
    drawOfficeChair(dx, dy + 22, th.chairColor);

    // Desk Station Label (Clean stationary marker at the floor)
    const engTag = (a.engine || 'hermes').substring(0, 3).toUpperCase();
    const labelY = (floorViewMode !== '2d' && !isHdLoft) ? dy + 36 : dy + 33;
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(dx - 35, labelY, 70, 12);
    ctx.strokeStyle = th.deskBorder;
    ctx.lineWidth = 1;
    ctx.strokeRect(dx - 35, labelY, 70, 12);
    ctx.font = 'bold 7px monospace';
    ctx.fillStyle = isHdLoft ? '#e2e8f0' : '#94a3b8';
    ctx.textAlign = 'center';
    ctx.fillText(`${a.name.toUpperCase()} [${engTag}]`, dx, labelY + 9);
  });

  // Render Dynamic Next Standby Workstation
  if (agents.length < WORKSTATION_SLOTS.length) {
    const nextSlot = WORKSTATION_SLOTS[agents.length];
    const dx = nextSlot.x, dy = nextSlot.y;
    // Shadow beneath desk
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.fillRect(dx - 38, dy - 8, 76, 32);
    // Desk top with amber standby border
    ctx.fillStyle = '#382515';
    ctx.fillRect(dx - 36, dy - 12, 72, 30);
    ctx.strokeStyle = '#d97706';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(dx - 36, dy - 12, 72, 30);
    // Computer Monitor facing the chair
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(dx - 18, dy - 24, 36, 16);
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(dx - 16, dy - 22, 32, 12);
    ctx.fillStyle = '#f59e0b';
    ctx.fillRect(dx - 8, dy - 17, 16, 2); // standby pulse line
    // Keyboard & Mouse
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(dx - 12, dy - 6, 24, 6);
    // Swivel chair behind desk
    drawOfficeChair(dx, dy + 22, '#1e293b');
    // Desk Station Label
    ctx.fillStyle = '#1c1917';
    ctx.fillRect(dx - 34, dy + 32, 68, 12);
    ctx.strokeStyle = '#78350f';
    ctx.lineWidth = 1;
    ctx.strokeRect(dx - 34, dy + 32, 68, 12);
    ctx.font = '7px monospace';
    ctx.fillStyle = '#fbbf24';
    ctx.textAlign = 'center';
    ctx.fillText(`DESK ${agents.length + 1}: STANDBY`, dx, dy + 41);
  }

  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
}
