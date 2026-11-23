/**
 * @module floor/floor_iso_blocks.js
 * @description AgentFloor Voxel / Isometric 2.5D-3D Block Renderer.
 * Builds architectural office voxel geometry (`buildIsoOfficeBlocks`) and renders
 * the depth-sorted 2.5D/3D block office floor (`renderIsoFloor`) with global bindings.
 *
 * Part of the AgentFloor canvas subsystem (concatenated globally by frontend/build.py).
 */

// Build the static office floor voxel layout (1:1 with 2D architectural blueprint)
function buildIsoOfficeBlocks(th) {
  const blocks = [];
  const furniture = [];
  const w = 16, h = 16;

  // 1. Floor Tiles at z = 0
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let color = th.floorBase || '#0d131f';
      if (x <= 4 && y <= 6) {
        color = th.execCarpet || '#111c30';
      } else if (x >= 5 && x <= 11 && y <= 5) {
        color = th.confCarpet || '#101a2c';
      } else if (x >= 12 && y <= 7) {
        color = th.breakCarpet || '#121e33';
      } else if (x >= 12 && y >= 11) {
        color = th.restroomTile || '#172a45';
      } else if ((x + y) % 2 === 1) {
        color = th.floorTile || '#152138';
      }
      blocks.push({ x, y, z: 0, color });
    }
  }

  // 2. Perimeter Walls at z = 1
  const wallCol = th.wallFill || '#1e293b';
  for (let x = 0; x < w; x++) blocks.push({ x, y: 0, z: 1, color: wallCol });
  for (let y = 1; y < h; y++) blocks.push({ x: 0, y, z: 1, color: wallCol });
  for (let y = 1; y < h; y++) blocks.push({ x: 15, y, z: 1, color: wallCol });
  for (let x = 1; x < 15; x++) blocks.push({ x, y: 15, z: 1, color: wallCol });

  // 3. Room Interior Partition Walls (Aligned with 2D Doorways & Corridor at y = 6)
  // Executive Suite (Room 1): South wall at y = 6, East wall at x = 4 with door at y = 5
  for (let x = 1; x <= 4; x++) blocks.push({ x, y: 6, z: 1, color: wallCol });
  for (let y = 1; y <= 4; y++) blocks.push({ x: 4, y, z: 1, color: wallCol });
  // Doorway at x = 4, y = 5 is OPEN to corridor

  // Conference Room (Room 2): Left wall x = 5, Right wall x = 11, South wall at y = 5
  for (let y = 1; y <= 5; y++) blocks.push({ x: 5, y, z: 1, color: wallCol });
  for (let y = 1; y <= 5; y++) blocks.push({ x: 11, y, z: 1, color: wallCol });
  blocks.push({ x: 6, y: 5, z: 1, color: wallCol });
  blocks.push({ x: 9, y: 5, z: 1, color: wallCol });
  blocks.push({ x: 10, y: 5, z: 1, color: wallCol });
  // Double doorway at x = 7..8, y = 5 is OPEN (connects to hallway y = 6)

  // Whiteboard / Terminal screen on North Wall of Room 2
  blocks.push({ x: 7, y: 1, z: 1, color: '#38bdf8' });
  blocks.push({ x: 8, y: 1, z: 1, color: '#0f172a' });
  blocks.push({ x: 9, y: 1, z: 1, color: '#10b981' });

  // Break Room (Room 3): Left wall at x = 12 with door at y = 5..6, South wall at y = 7
  for (let y = 1; y <= 4; y++) blocks.push({ x: 12, y, z: 1, color: wallCol });
  // Doorway at x = 12, y = 5..6 is OPEN (connects to hallway y = 6)
  for (let x = 12; x <= 14; x++) blocks.push({ x, y: 7, z: 1, color: wallCol });

  // Restroom Annex (Room 4): Left wall at x = 12, Top wall at y = 11 with door at x = 14
  for (let y = 11; y <= 14; y++) blocks.push({ x: 12, y, z: 1, color: wallCol });
  blocks.push({ x: 13, y: 11, z: 1, color: wallCol });
  // Doorway at x = 14, y = 11 is OPEN

  // 4. Authentic Minecraft Furniture Suite (1:1 with 2D Layout)
  // (a) Executive Suite (Room 1 - Solaris Command Suite: exactly 1 Desk for Solaris!)
  furniture.push({
    type: 'desk',
    x: 2.3,
    y: 2.7,
    z: 1,
    woodColor: th.deskLead || '#2d1808',
    screenWorking: true
  });
  furniture.push({
    type: 'chair',
    x: 2.3,
    y: 3.5,
    z: 1,
    color: th.chairColor || '#1e293b'
  });
  furniture.push({
    type: 'plant',
    x: 1.2,
    y: 5.0,
    z: 1
  });

  // (b) Conference War Room (Room 2)
  furniture.push({
    type: 'conference_table',
    x: 8.0,
    y: 3.0,
    z: 1
  });
  // 6 conference chairs around the table (matches 2D)
  const confChairSlots = [
    { x: 6.8, y: 2.2 }, { x: 8.0, y: 2.2 }, { x: 9.2, y: 2.2 },
    { x: 6.8, y: 3.8 }, { x: 8.0, y: 3.8 }, { x: 9.2, y: 3.8 }
  ];
  confChairSlots.forEach(slot => {
    furniture.push({
      type: 'chair',
      x: slot.x,
      y: slot.y,
      z: 1,
      color: '#334155'
    });
  });

  // (c) Break Room Kitchen (Room 3)
  blocks.push({ x: 12, y: 1, z: 1, color: '#334155' });
  blocks.push({ x: 13, y: 1, z: 1, color: '#334155' });
  blocks.push({ x: 14, y: 1, z: 1, color: '#475569' });
  furniture.push({
    type: 'coffee',
    x: 12.8,
    y: 1.5,
    z: 1
  });
  furniture.push({
    type: 'cooler',
    x: 13.8,
    y: 2.6,
    z: 1
  });
  furniture.push({
    type: 'plant',
    x: 14.0,
    y: 5.0,
    z: 1
  });

  // (d) Restroom Annex (Room 4)
  furniture.push({
    type: 'sink',
    x: 14.1,
    y: 12.0,
    z: 1
  });
  furniture.push({
    type: 'toilet',
    x: 12.4,
    y: 13.3,
    z: 1
  });
  furniture.push({
    type: 'toilet',
    x: 13.3,
    y: 13.3,
    z: 1
  });

  // (e) Bullpen Workstations: Exactly 6 Desks (Row 1 at y = 7.0, Row 2 at y = 11.0)
  const bullpenWorkstations = [
    // Row 1 (Scribe, Chorusius, Lore)
    { x: 5.5, y: 7.0 }, { x: 7.6, y: 7.0 }, { x: 9.8, y: 7.0 },
    // Row 2 (Chroma, Pylon, Standby Desk 7)
    { x: 5.5, y: 11.0 }, { x: 7.6, y: 11.0 }, { x: 9.8, y: 11.0 }
  ];

  bullpenWorkstations.forEach(d => {
    furniture.push({
      type: 'desk',
      x: d.x,
      y: d.y,
      z: 1,
      woodColor: th.deskTop || '#5c3d24',
      screenWorking: true
    });
    furniture.push({
      type: 'chair',
      x: d.x,
      y: d.y + 0.6,
      z: 1,
      color: th.chairColor || '#334155'
    });
  });

  // (f) Decorative Potted Plants (1:1 with 2D floor layout)
  furniture.push({ type: 'plant', x: 1.2, y: 14.0, z: 1 });  // 2D: (40, 480)
  furniture.push({ type: 'plant', x: 3.6, y: 14.0, z: 1 });  // 2D: (250, 480)
  furniture.push({ type: 'plant', x: 11.6, y: 14.2, z: 1 }); // 2D: (805, 510)

  return { blocks, furniture };
}

// Render floor in Pure 2.5D Dimetric/Isometric Voxel Engine
function renderIsoFloor(ctx) {
  const w = 16, h = 16;
  const th = FLOOR_THEMES[activeFloorTheme] || FLOOR_THEMES.cyberpunk;
  const camera = {
    rot: currentIsoRot || 0,
    ox: 520,
    oy: 140,
    tw: 48,
    th: 24,
    zh: 18
  };

  // 1. Maintain cached static buffer
  if (!cachedStaticBuffer) {
    const { blocks, furniture } = buildIsoOfficeBlocks(th);
    const staticScene = { w, h, camera, blocks, furniture };
    cachedStaticBuffer = buildStaticBuffer(staticScene, canvas.width, canvas.height);
  }

  // 2. Clear canvas with dark background
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#060913';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Subtle architectural grid
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.05)';
  ctx.lineWidth = 1;
  for (let gx = 0; gx < canvas.width; gx += 40) {
    ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, canvas.height); ctx.stroke();
  }
  for (let gy = 0; gy < canvas.height; gy += 40) {
    ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(canvas.width, gy); ctx.stroke();
  }

  // 3. Update dynamic agents simulations
  if (agents && agents.length > 0) {
    agents.forEach(a => updateAgentSimulation(a));
  }

  // 4. Map dynamic entities from agent state
  const entities = (agents || []).map(a => {
    const gx = Math.min(14.5, Math.max(1, (a.x / 1040) * 15));
    const gy = Math.min(14.5, Math.max(1, (a.y / 540) * 15));
    const isAlex = (a.model === 'alex') ||
      (a.name && a.name.toLowerCase().includes('alex')) ||
      (a.theme === 'creative' || a.theme === 'orchestrator');

    // Apply camera rotation offset to facing
    let agentFacing = a.facing || 'sw';
    if (currentIsoRot) {
      const order = ['se', 'sw', 'nw', 'ne'];
      const idx = order.indexOf(agentFacing);
      if (idx !== -1) {
        agentFacing = order[((idx + (currentIsoRot % 4)) % 4 + 4) % 4];
      }
    }

    return {
      id: a.name,
      x: gx,
      y: gy,
      z: 1,
      model: isAlex ? 'alex' : 'steve',
      facing: agentFacing,
      isWalking: a.state === 'walking' || a.state === 'briefing',
      walkPhase: a.walkPhase || 0,
      color: a.color || a.shirtColor || (isAlex ? '#5e8550' : '#00a3a7'),
      shirtColor: a.shirtColor || a.color || (isAlex ? '#5e8550' : '#00a3a7'),
      skinColor: a.skinColor || (isAlex ? '#efcbb0' : '#b87c55'),
      hairColor: a.hairColor || (isAlex ? '#d47432' : '#392113'),
      state: a.state || 'idle',
      name: a.name,
      theme: a.theme,
      rawAgent: a
    };
  });

  const scene = { w, h, camera, entities };

  // 5. Blit static buffer and render dynamic entities
  renderFrame(ctx, scene, cachedStaticBuffer);

  // 6. Draw agent labels and speech bubbles above voxel heads
  entities.forEach(ent => {
    const p = project(ent.x, ent.y, ent.z || 1, camera, w, h);
    const a = ent.rawAgent;

    // Agent Name Pill Tag
    ctx.font = 'bold 8px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const tagText = ent.name.toUpperCase();
    const tw = ctx.measureText(tagText).width + 8;
    ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
    ctx.fillRect(p.sx - tw / 2, p.sy - 64, tw, 12);
    ctx.strokeStyle = (hoveredAgent && hoveredAgent.name === ent.name) ? '#38bdf8' : 'rgba(56, 189, 248, 0.4)';
    ctx.lineWidth = 1;
    ctx.strokeRect(p.sx - tw / 2, p.sy - 64, tw, 12);
    ctx.fillStyle = (hoveredAgent && hoveredAgent.name === ent.name) ? '#38bdf8' : '#cbd5e1';
    ctx.fillText(tagText, p.sx, p.sy - 58);

    // Speech bubble if agent is talking
    if (a && a.dialogue) {
      ctx.save();
      const cat = a.dialogueCategory || 'info';
      let bubbleBg = '#ffffff';
      let strokeColor = '#1e293b';
      let textColor = '#0f172a';
      if (cat === 'task_start') {
        bubbleBg = '#f0fdf4'; strokeColor = '#16a34a';
      } else if (cat === 'task_complete') {
        bubbleBg = '#ecfeff'; strokeColor = '#0891b2';
      } else if (cat === 'critical') {
        bubbleBg = '#fff1f2'; strokeColor = '#e11d48'; textColor = '#be123c';
      }
      ctx.font = 'bold 8.5px monospace';
      const speechWidth = ctx.measureText(a.dialogue).width;
      const bw = Math.max(speechWidth + 14, 40);
      const bh = 18;
      const bx = p.sx - bw / 2;
      const by = p.sy - 88;

      ctx.fillStyle = bubbleBg;
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = 1.2;
      ctx.fillRect(bx, by, bw, bh);
      ctx.strokeRect(bx, by, bw, bh);

      ctx.beginPath();
      ctx.moveTo(p.sx - 3, by + bh);
      ctx.lineTo(p.sx, by + bh + 4);
      ctx.lineTo(p.sx + 3, by + bh);
      ctx.fillStyle = bubbleBg;
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = textColor;
      ctx.textAlign = 'center';
      ctx.fillText(a.dialogue, p.sx, by + bh / 2);
      ctx.restore();
    }
  });

  // 7. HUD Badges: Perspective Mode & Rotation Controls
  ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
  ctx.fillRect(canvas.width - 240, 10, 230, 24);
  ctx.strokeStyle = '#f59e0b';
  ctx.lineWidth = 1;
  ctx.strokeRect(canvas.width - 240, 10, 230, 24);
  ctx.fillStyle = '#fde68a';
  ctx.font = 'bold 9px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`🧊 3D VOXEL (ISO) • ROT ${(currentIsoRot || 0) * 90}°`, canvas.width - 125, 22);

  // Subtle compass indicator in top-left
  ctx.fillStyle = 'rgba(15, 23, 42, 0.75)';
  ctx.fillRect(10, 10, 110, 22);
  ctx.strokeStyle = '#38bdf8';
  ctx.strokeRect(10, 10, 110, 22);
  ctx.fillStyle = '#38bdf8';
  ctx.font = '8px monospace';
  const headings = ['NORTH-WEST', 'NORTH-EAST', 'SOUTH-EAST', 'SOUTH-WEST'];
  ctx.fillText(`🧭 CAM: ${headings[((currentIsoRot || 0) % 4 + 4) % 4]}`, 65, 21);

  ctx.restore();
}

// Expose helpers globally for DOM event handlers
window.setFloorViewMode = setFloorViewMode;
window.rotateIsoCamera = rotateIsoCamera;
window.invalidateIsoBuffer = invalidateIsoBuffer;
