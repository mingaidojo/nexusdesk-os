/**
 * @module floor/floor_interactions.js
 * @description AgentFloor Sprites, Canvas Interactions, Briefings & Shouts.
 * 2D character sprite/speech rendering, canvas hover/click handlers, Inspector
 * drawer, Mission Briefing modal, Conference Room controls, and agent shouts.
 *
 * Part of the AgentFloor canvas subsystem (concatenated globally by frontend/build.py).
 */

// --- Render Pixel Character Sprites ---
function renderAgentSprite(a) {
  const isSelected = (selectedAgent === a);
  const isHovered = (hoveredAgent === a);
  const bob = (a.state === 'walking') ? Math.sin(animFrame * 0.25) * 2 : 0;
  const headY = a.y - 18 + bob;

  // Active Indicator Overhead Marker (Clean RPG style, no floor shadow circle)
  if (isSelected) {
    ctx.save();
    ctx.fillStyle = '#10b981';
    ctx.beginPath();
    ctx.moveTo(a.x - 4, headY - 14);
    ctx.lineTo(a.x + 4, headY - 14);
    ctx.lineTo(a.x, headY - 9);
    ctx.fill();
    ctx.restore();
  }

  // Conference Speaker Highlight Halo (Room 2 Boardroom)
  if (isConferenceActive && conferenceSpeaker && conferenceSpeaker.toLowerCase() === a.name.toLowerCase()) {
    ctx.save();
    ctx.strokeStyle = '#06b6d4';
    ctx.lineWidth = 2.5;
    ctx.shadowColor = '#06b6d4';
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.arc(a.x, a.y + 4, 18, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  if (floorViewMode === '3d') {
    // --- BL-AGF-13: Minecraft / Voxel Cubic Sprite Renderer ---
    // Blocky Voxel Body
    ctx.fillStyle = a.shirtColor || a.color;
    ctx.fillRect(a.x - 8, headY + 6, 16, 12);
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 1;
    ctx.strokeRect(a.x - 8, headY + 6, 16, 12);

    // Blocky Voxel Head (Cubic Steve/Alex proportions)
    ctx.fillStyle = '#fbcfe8'; // skin tone
    ctx.fillRect(a.x - 8, headY - 10, 16, 16);
    ctx.strokeRect(a.x - 8, headY - 10, 16, 16);

    // Blocky Hair Helmet
    ctx.fillStyle = a.hairColor || '#3b2010';
    ctx.fillRect(a.x - 9, headY - 12, 18, 7);
    ctx.fillRect(a.x - 9, headY - 5, 4, 6);

    // Pixel Eyes
    if (a.state === 'sleeping') {
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(a.x - 5, headY - 2, 3, 1);
      ctx.fillRect(a.x + 2, headY - 2, 3, 1);
    } else {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(a.x - 6, headY - 3, 4, 3);
      ctx.fillRect(a.x + 2, headY - 3, 4, 3);
      ctx.fillStyle = '#2563eb'; // blue Steve pupil
      ctx.fillRect(a.x - 4, headY - 2, 2, 2);
      ctx.fillRect(a.x + 2, headY - 2, 2, 2);
    }

    // Voxel Hands
    if (a.state === 'working') {
      const tap = (animFrame % 14 < 7) ? 2 : 0;
      ctx.fillStyle = '#fbcfe8';
      ctx.fillRect(a.x - 7, headY + 16 + tap, 4, 4);
      ctx.fillRect(a.x + 3, headY + 16 + (2 - tap), 4, 4);
    } else if (a.state === 'playing_phone') {
      ctx.fillStyle = '#38bdf8';
      ctx.fillRect(a.x - 3, headY + 12, 6, 8);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(a.x - 2, headY + 13, 4, 6);
    }
  } else if (floorViewMode === 'hd_loft') {
    // --- BL-EVO-37: Detailed Pixel Loft (HD) Character Avatar Renderer ---
    const nameSeed = (a.name || 'A').charCodeAt(0) + ((a.name || 'A').charCodeAt(1) || 0);
    const skinPalette = ['#fde6d8', '#f5cba7', '#f9d5b5', '#e5b887'];
    const skinCol = skinPalette[nameSeed % skinPalette.length];
    const shirtCol = a.shirtColor || a.color || '#0284c7';
    const hairCol = a.hairColor || '#271709';

    // Subtle character ground shadow when walking
    if (a.state === 'walking' || a.state === 'gossiping' || a.state === 'briefing') {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
      ctx.beginPath();
      ctx.ellipse(a.x, a.y + 5, 9, 4, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // Animated legs when walking
    if (a.state === 'walking') {
      const stride = Math.sin(animFrame * 0.35) * 2.5;
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(a.x - 5, headY + 17 + stride, 4, 5);
      ctx.fillRect(a.x + 1, headY + 17 - stride, 4, 5);
    }

    // Torso / Jacket with 1px pixel-art dark outline & collar/lanyard detail
    ctx.fillStyle = '#090d16';
    ctx.fillRect(a.x - 9, headY + 6, 18, 13);
    ctx.fillStyle = shirtCol;
    ctx.fillRect(a.x - 8, headY + 7, 16, 11);
    // Inner shirt & collar V-neck / tie
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(a.x - 3, headY + 7, 6, 4);
    ctx.fillStyle = (a.theme === 'orchestrator') ? '#f59e0b' : '#38bdf8';
    ctx.fillRect(a.x - 1, headY + 9, 2, 6); // tie / lanyard badge

    // Neck & Head with crisp dark pixel outline
    ctx.fillStyle = '#090d16';
    ctx.fillRect(a.x - 8, headY - 7, 16, 15);
    ctx.fillStyle = skinCol;
    ctx.fillRect(a.x - 7, headY - 6, 14, 13);
    // Subtle cheek blush / shading
    ctx.fillStyle = 'rgba(244, 63, 94, 0.22)';
    ctx.fillRect(a.x - 6, headY + 2, 3, 2);
    ctx.fillRect(a.x + 3, headY + 2, 3, 2);

    // Multi-layered Pixel Hair & Crown Highlight
    ctx.fillStyle = '#090d16';
    ctx.fillRect(a.x - 9, headY - 10, 18, 6);
    ctx.fillStyle = hairCol;
    ctx.fillRect(a.x - 8, headY - 9, 16, 5);
    ctx.fillRect(a.x - 8, headY - 5, 3, 6); // left sideburn/locks
    ctx.fillRect(a.x + 5, headY - 5, 3, 5); // right sideburn/locks
    // Hair crown highlight
    ctx.fillStyle = 'rgba(255, 255, 255, 0.18)';
    ctx.fillRect(a.x - 5, headY - 8, 9, 1.5);

    // Expressive Pixel Eyes & Optional Glasses / Headset
    if (a.state === 'sleeping') {
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(a.x - 5, headY, 3, 1.5);
      ctx.fillRect(a.x + 2, headY, 3, 1.5);
    } else {
      // Sclera + pupils
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(a.x - 5, headY - 1, 3, 3);
      ctx.fillRect(a.x + 2, headY - 1, 3, 3);
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(a.x - 4, headY, 2, 2);
      ctx.fillRect(a.x + 2, headY, 2, 2);
    }

    // Accessories: Tech Glasses or Comms Headset
    if (nameSeed % 3 === 0) {
      // Rimless / Cyber Glasses
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 1;
      ctx.strokeRect(a.x - 6, headY - 2, 5, 4);
      ctx.strokeRect(a.x + 1, headY - 2, 5, 4);
      ctx.fillStyle = '#38bdf8';
      ctx.fillRect(a.x - 1, headY - 1, 2, 1);
    } else if (nameSeed % 3 === 1) {
      // Operator Headset Mic
      ctx.fillStyle = '#10b981';
      ctx.fillRect(a.x - 9, headY - 2, 2, 5);
      ctx.fillRect(a.x - 8, headY + 3, 4, 1.5);
    }

    // Hands on keyboard / smartphone
    if (a.state === 'working') {
      const tap = (animFrame % 12 < 6) ? 1.5 : 0;
      ctx.fillStyle = skinCol;
      ctx.fillRect(a.x - 7, headY + 14 + tap, 4, 4);
      ctx.fillRect(a.x + 3, headY + 14 + (1.5 - tap), 4, 4);
    } else if (a.state === 'playing_phone') {
      ctx.fillStyle = '#38bdf8';
      ctx.fillRect(a.x - 3, headY + 11, 6, 8);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(a.x - 2, headY + 12, 4, 6);
    }
  } else {
    // Body / Shoulders
    ctx.fillStyle = a.shirtColor || a.color;
    ctx.fillRect(a.x - 7, headY + 8, 14, 10);

    // Head / Skin
    ctx.fillStyle = '#fbcfe8'; // skin tone
    ctx.fillRect(a.x - 6, headY - 4, 12, 12);

    // Detailed Hair
    ctx.fillStyle = a.hairColor;
    ctx.fillRect(a.x - 7, headY - 8, 14, 6);
    ctx.fillRect(a.x - 7, headY - 4, 3, 5); // sideburns

    // Face Eyes
    ctx.fillStyle = '#0f172a';
    if (a.state === 'sleeping') {
      // Closed eyes
      ctx.fillRect(a.x - 4, headY + 2, 3, 1);
      ctx.fillRect(a.x + 1, headY + 2, 3, 1);
    } else {
      ctx.fillRect(a.x - 4, headY + 1, 2, 2);
      ctx.fillRect(a.x + 2, headY + 1, 2, 2);
    }

    // Hands on desk / holding phone
    if (a.state === 'working') {
      const tap = (animFrame % 14 < 7) ? 1 : 0;
      ctx.fillStyle = '#fbcfe8';
      ctx.fillRect(a.x - 6, headY + 14 + tap, 3, 3);
      ctx.fillRect(a.x + 3, headY + 14 + (1 - tap), 3, 3);
    } else if (a.state === 'playing_phone') {
      // Smartphone in hand with screen glow
      ctx.fillStyle = '#38bdf8';
      ctx.fillRect(a.x - 3, headY + 12, 6, 8);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(a.x - 2, headY + 13, 4, 6);
    }
  }

  // BEHAVIOR PARTICLES OVERHEAD:
  if (a.state === 'sleeping') {
    // Floating z z Z (stays firmly at desk!)
    ctx.font = '9px monospace';
    ctx.fillStyle = '#c084fc';
    const zOff = (animFrame % 70) * 0.35;
    ctx.fillText('z', a.x + 8, headY - 12 - zOff);
    ctx.fillText('Z', a.x + 14, headY - 18 - zOff);
  } else if (a.state === 'whistling') {
    ctx.font = '10px sans-serif';
    ctx.fillStyle = '#f472b6';
    ctx.fillText('♪ ♫', a.x + 8, headY - 10 + Math.sin(animFrame * 0.1) * 3);
  }

  // AGENT NAME LABEL (Sleek floating pill in hd_loft, outlined text in 2d)
  ctx.save();
  ctx.font = 'bold 9px Inter, -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const nameY = a.y + 11 + (a.state === 'walking' ? bob : 0);
  if (floorViewMode === 'hd_loft') {
    const pillW = Math.max(ctx.measureText(a.name).width + 16, 40);
    const pillX = a.x - pillW / 2;
    ctx.fillStyle = 'rgba(9, 13, 22, 0.85)';
    ctx.fillRect(pillX, nameY - 1, pillW, 13);
    ctx.strokeStyle = isSelected ? '#10b981' : (isHovered ? '#38bdf8' : 'rgba(148, 163, 184, 0.35)');
    ctx.lineWidth = 1;
    ctx.strokeRect(pillX, nameY - 1, pillW, 13);
    // Live status dot inside pill
    ctx.fillStyle = (a.state === 'working') ? '#10b981' : (a.state === 'sleeping' ? '#a855f7' : '#38bdf8');
    ctx.beginPath();
    ctx.arc(pillX + 5.5, nameY + 5.5, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = isSelected ? '#34d399' : (isHovered ? '#38bdf8' : '#f8fafc');
    ctx.fillText(a.name, a.x + 3, nameY + 1);
  } else {
    // Dark stroke outline for perfect contrast on any floor tile
    ctx.strokeStyle = '#050811';
    ctx.lineWidth = 3;
    ctx.strokeText(a.name, a.x, nameY);
    // Color-coded agent name fill
    ctx.fillStyle = isSelected ? '#34d399' : (isHovered ? '#38bdf8' : '#f8fafc');
    ctx.fillText(a.name, a.x, nameY);
  }
  ctx.restore();

  // SPEECH / STATUS BUBBLE ("SHOUT") (High-contrast pixel pill with category badge & pointer)
  if (a.dialogue) {
    ctx.save();
    ctx.font = '9px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Category styling
    const cat = a.dialogueCategory || 'info';
    let bubbleBg = '#ffffff';
    let strokeColor = '#1e293b';
    let textColor = '#0f172a';
    let badgeBg = '#e2e8f0';
    let badgeText = '#475569';
    let badgeLabel = '';

    if (cat === 'task_start') {
      bubbleBg = '#f0fdf4';
      strokeColor = '#16a34a';
      badgeBg = '#dcfce7';
      badgeText = '#15803d';
      badgeLabel = 'RUN';
    } else if (cat === 'task_complete') {
      bubbleBg = '#ecfeff';
      strokeColor = '#0891b2';
      badgeBg = '#cffafe';
      badgeText = '#0e7490';
      badgeLabel = 'DONE';
    } else if (cat === 'critical') {
      bubbleBg = '#fff1f2';
      strokeColor = '#e11d48';
      badgeBg = '#ffe4e6';
      badgeText = '#be123c';
      badgeLabel = 'ALERT';
    }

    const textWidth = ctx.measureText(a.dialogue).width;
    const badgeW = badgeLabel ? 32 : 0;
    const bubbleW = Math.max(textWidth + (badgeLabel ? 36 : 18), 42);
    const bubbleH = 20;
    const bx = a.x - (bubbleW / 2);
    const by = headY - 28;

    // Shadow for elevated speech bubble
    ctx.shadowColor = 'rgba(0, 0, 0, 0.25)';
    ctx.shadowBlur = 4;
    ctx.shadowOffsetY = 2;

    // Bubble body with dark outline
    ctx.fillStyle = bubbleBg;
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 1.5;
    if (typeof ctx.roundRect === 'function') {
      ctx.beginPath();
      ctx.roundRect(bx, by, bubbleW, bubbleH, 5);
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.fillRect(bx, by, bubbleW, bubbleH);
      ctx.strokeRect(bx, by, bubbleW, bubbleH);
    }

    ctx.shadowColor = 'transparent';

    // Pointer triangle
    ctx.beginPath();
    ctx.moveTo(a.x - 4, by + bubbleH);
    ctx.lineTo(a.x, by + bubbleH + 5);
    ctx.lineTo(a.x + 4, by + bubbleH);
    ctx.fillStyle = bubbleBg;
    ctx.fill();
    ctx.strokeStyle = strokeColor;
    ctx.stroke();

    // Optional Category Badge
    let textStartX = a.x;
    if (badgeLabel) {
      const bbx = bx + 4;
      const bby = by + 3.5;
      ctx.fillStyle = badgeBg;
      ctx.fillRect(bbx, bby, badgeW - 6, 13);
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = 0.8;
      ctx.strokeRect(bbx, bby, badgeW - 6, 13);
      ctx.fillStyle = badgeText;
      ctx.font = 'bold 7px monospace';
      ctx.fillText(badgeLabel, bbx + ((badgeW - 6) / 2), bby + 6.5);
      textStartX = bx + badgeW + ((bubbleW - badgeW) / 2) - 4;
    }

    // Speech text
    ctx.fillStyle = textColor;
    ctx.font = 'bold 9px monospace';
    ctx.fillText(a.dialogue, textStartX, by + (bubbleH / 2));
    ctx.restore();
  }
}

// Helper: Navigate directly to 1-on-1 Chat with a specific agent (BL-AGF-19)
function openDirectChatWithAgent(agentOrName) {
  let target = null;
  if (typeof agentOrName === 'string') {
    target = agents.find(a => a.name.toLowerCase() === agentOrName.toLowerCase() || a.id === agentOrName.toLowerCase());
  } else {
    target = agentOrName;
  }
  if (target && typeof selectAgent === 'function') {
    selectAgent(target);
  }
  if (typeof switchMainTab === 'function') {
    switchMainTab('console');
  }
  if (typeof switchConsoleMode === 'function') {
    switchConsoleMode('direct');
  }
  setTimeout(() => {
    const inputEl = document.getElementById('chat-text-input');
    if (inputEl) inputEl.focus();
  }, 60);
}

// Canvas click & hover
canvas.addEventListener('mousemove', (e) => {
  const rect = canvas.getBoundingClientRect();
  const coords = getCanvasFloorCoords(e);
  const mouseX = coords.x;
  const mouseY = coords.y;

  let found = null;
  agents.forEach(a => {
    if (Math.hypot(mouseX - a.x, mouseY - a.y) < 35 || Math.hypot(mouseX - a.homeX, mouseY - a.homeY) < 35) found = a;
  });

  hoveredAgent = found;

  // Check Whiteboard hover: x in [360, 700], y in [24, 86]
  const isOverWhiteboard = (mouseX >= 360 && mouseX <= 700 && mouseY >= 24 && mouseY <= 86);

  // Check Conference Table (Room 2) hover: x in [400, 660], y in [95, 175]
  const isOverConferenceTable = (mouseX >= 400 && mouseX <= 660 && mouseY >= 95 && mouseY <= 175);

  // Check Restroom Annex (Room 4) hover: x in [820, 1020], y in [380, 520]
  const isOverRestroom = (mouseX >= 820 && mouseX <= 1020 && mouseY >= 380 && mouseY <= 520);

  // Check Dynamic Standby Workstation hover
  const standbySlot = (agents.length < WORKSTATION_SLOTS.length) ? WORKSTATION_SLOTS[agents.length] : null;
  const isOverStandby = standbySlot && (Math.hypot(mouseX - standbySlot.x, mouseY - standbySlot.y) < 35);

  if (found) {
    canvas.style.cursor = 'pointer';
    tooltip.style.left = `${e.clientX - rect.left + 15}px`;
    tooltip.style.top = `${e.clientY - rect.top - 20}px`;
    tooltip.innerHTML = `<strong>💬 ${found.name} [${(found.engine || 'hermes').toUpperCase()}]</strong> • ${found.role} [${found.state.toUpperCase()}] • <span class="text-emerald-400">Click for 1-on-1 Chat</span>`;
    tooltip.classList.remove('hidden');
  } else if (isOverConferenceTable) {
    canvas.style.cursor = 'pointer';
    tooltip.style.left = `${e.clientX - rect.left + 15}px`;
    tooltip.style.top = `${e.clientY - rect.top - 20}px`;
    tooltip.innerHTML = `<strong>👥 ROOM 2: CONFERENCE WAR ROOM</strong> • Click table to convene multi-agent session`;
    tooltip.classList.remove('hidden');
  } else if (isOverWhiteboard) {
    canvas.style.cursor = 'pointer';
    tooltip.style.left = `${e.clientX - rect.left + 15}px`;
    tooltip.style.top = `${e.clientY - rect.top - 20}px`;
    tooltip.innerHTML = `<strong>📡 MISSION BRIEFING BOARD</strong> • Click to inspect pipeline sequence & triggers`;
    tooltip.classList.remove('hidden');
  } else if (isOverRestroom) {
    canvas.style.cursor = 'pointer';
    tooltip.style.left = `${e.clientX - rect.left + 15}px`;
    tooltip.style.top = `${e.clientY - rect.top - 20}px`;
    tooltip.innerHTML = `<strong>🚻 ROOM 4: RESTROOM & BREAK ANNEX</strong> • Click to view sanitary & wellness amenities`;
    tooltip.classList.remove('hidden');
  } else if (isOverStandby) {
    canvas.style.cursor = 'pointer';
    tooltip.style.left = `${e.clientX - rect.left + 15}px`;
    tooltip.style.top = `${e.clientY - rect.top - 20}px`;
    tooltip.innerHTML = `<strong>WORKSTATION #${agents.length + 1} (STANDBY)</strong> • Click to deploy new agent`;
    tooltip.classList.remove('hidden');
  } else {
    canvas.style.cursor = 'default';
    tooltip.classList.add('hidden');
  }
});

canvas.addEventListener('mouseleave', () => {
  hoveredAgent = null;
  canvas.style.cursor = 'default';
  tooltip.classList.add('hidden');
});

// Canvas object click handler
canvas.addEventListener('click', (e) => {
  const coords = getCanvasFloorCoords(e);
  const mouseX = coords.x;
  const mouseY = coords.y;

  // 0. Priority: Agent Desk / Sprite click -> Direct 1-on-1 Chat (BL-AGF-19)
  if (hoveredAgent) {
    showCanvasInspector('agent', {
      agentName: hoveredAgent.name,
      title: `${hoveredAgent.name.toUpperCase()} WORKSTATION [${(hoveredAgent.engine || 'hermes').toUpperCase()}]`,
      subtitle: `${hoveredAgent.role} • Desk Slot [${hoveredAgent.homeX}, ${hoveredAgent.homeY}]`,
      icon: '💻',
      badge: hoveredAgent.state.toUpperCase(),
      items: [
        { label: 'Agent Name', val: hoveredAgent.name },
        { label: 'Engine', val: (hoveredAgent.engine || 'hermes').toUpperCase() },
        { label: 'System Role', val: hoveredAgent.role },
        { label: 'State', val: hoveredAgent.state },
        { label: 'Workspace Path', val: `/home/${currentInstanceKey || 'agents_bs'}/workspace/${hoveredAgent.id}` },
        { label: 'Theme Tag', val: hoveredAgent.theme || 'custom' },
        { label: 'Desk Coordinates', val: `X:${hoveredAgent.homeX} Y:${hoveredAgent.homeY}` }
      ]
    });
    openDirectChatWithAgent(hoveredAgent);
    return;
  }

  // 1. Room 1: Command Suite Plaque / Office Area click
  if (mouseX >= 20 && mouseX <= 280 && mouseY >= 20 && mouseY <= 230) {
    const activeInstObj = (typeof availableInstances !== 'undefined' ? availableInstances : []).find(i => i.key === (typeof currentInstanceKey !== 'undefined' ? currentInstanceKey : 'agents_bs'));
    const leadAgent = (typeof agents !== 'undefined' && agents.length > 0) ? agents[0] : null;
    showCanvasInspector('room', {
      title: leadAgent ? `${leadAgent.name.toUpperCase()} COMMAND SUITE` : 'EXECUTIVE COMMAND SUITE',
      subtitle: `Fleet: ${(activeInstObj?.label || currentInstanceKey || 'Active Fleet').toUpperCase()} • Room 1`,
      icon: '🏛️',
      badge: 'COMMAND NODE',
      items: [
        { label: 'Fleet ID', val: currentInstanceKey || 'agents_bs' },
        { label: 'Lead Agent', val: leadAgent ? `${leadAgent.name} (${leadAgent.role})` : 'Standby' },
        { label: 'Security Domain', val: activeInstObj?.badge || 'PROD' },
        { label: 'Agents Count', val: agents.length ? `${agents.length} active agent(s)` : '0 agents' },
        { label: 'Server Port', val: 'FastAPI :9200' },
        { label: 'Cluster Mode', val: 'Multi-Tenant Local Host' }
      ]
    });
    return;
  }

  // 1b. Room 4: Restroom & Break Annex click
  if (mouseX >= 820 && mouseX <= 1020 && mouseY >= 380 && mouseY <= 520) {
    showCanvasInspector('room', {
      title: 'EXECUTIVE RESTROOM & BREAK ANNEX',
      subtitle: 'Wellness Wing • Room 4 (Sanitary & Hygiene)',
      icon: '🚻',
      badge: 'HYGIENE AMENITY',
      items: [
        { label: 'Partition', val: 'Two Privacy Stalls (Porcelain)' },
        { label: 'Vanity', val: 'Dual Basin Sink Counter & Mirrors' },
        { label: 'Tile Palette', val: 'Ceramic Grid Flooring' },
        { label: 'Usage Mode', val: 'Idle agent occasional handwash' },
        { label: 'Coordinates', val: 'X: 820..1020, Y: 380..520' }
      ]
    });
    return;
  }

  // 2. Whiteboard click
  if (mouseX >= 360 && mouseX <= 700 && mouseY >= 24 && mouseY <= 86) {
    openMissionBriefingModal();
    return;
  }

  // 2b. Conference Table (Room 2) click -> Open Multi-Agent War Room & Gather Agents
  if (mouseX >= 400 && mouseX <= 660 && mouseY >= 95 && mouseY <= 175) {
    if (typeof switchMainTab === 'function') switchMainTab('console');
    if (typeof switchConsoleMode === 'function') switchConsoleMode('warroom');
    gatherAgentsToConferenceTable();
    return;
  }

  // 3. Dynamic Standby Desk click -> Deploy Agent Modal
  const standbySlot = (agents.length < WORKSTATION_SLOTS.length) ? WORKSTATION_SLOTS[agents.length] : null;
  if (standbySlot && Math.hypot(mouseX - standbySlot.x, mouseY - standbySlot.y) < 35) {
    openCreateAgentModal();
    return;
  }
});

// Inspector Drawer UI Controller
let lastInspectorData = null;

function showCanvasInspector(type, data) {
  lastInspectorData = data;
  const drawer = document.getElementById('canvas-inspector-drawer');
  if (!drawer) return;

  const titleEl = document.getElementById('inspector-title');
  const subEl = document.getElementById('inspector-subtitle');
  const badgeEl = document.getElementById('inspector-badge');
  const iconEl = document.getElementById('inspector-icon');
  const contentEl = document.getElementById('inspector-content');

  if (titleEl) titleEl.innerText = data.title;
  if (subEl) subEl.innerText = data.subtitle;
  if (badgeEl) badgeEl.innerText = data.badge;
  if (iconEl) iconEl.innerText = data.icon;

  if (contentEl) {
    const itemsHtml = (data.items || []).map(item => `
      <div class="bg-slate-950/80 p-2.5 rounded-lg border border-slate-800 flex flex-col gap-0.5">
        <span class="text-[10px] text-slate-500 uppercase tracking-wider">${item.label}</span>
        <span class="text-xs text-slate-200 font-mono select-text break-all font-semibold">${item.val}</span>
      </div>
    `).join('');

    const actionsHtml = (type === 'agent' && data.agentName) ? `
      <div class="col-span-full flex flex-wrap items-center gap-2 pt-1">
        <button type="button" onclick="openDirectChatWithAgent('${data.agentName}')" class="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-mono font-semibold flex items-center gap-1.5 transition cursor-pointer shadow-sm">
          <span>💬</span> <span>1-on-1 Chat with ${data.agentName}</span>
        </button>
        <button type="button" onclick="openEditAgentModal('${data.agentName}')" class="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 text-xs font-mono font-semibold flex items-center gap-1.5 transition cursor-pointer">
          <span>⚙️</span> <span>Configure Desk &amp; Station</span>
        </button>
      </div>
    ` : '';

    contentEl.innerHTML = itemsHtml + actionsHtml;
  }

  drawer.classList.remove('hidden');
}

function closeInspectorDrawer() {
  const drawer = document.getElementById('canvas-inspector-drawer');
  if (drawer) drawer.classList.add('hidden');
}

function copyInspectorDetails() {
  if (!lastInspectorData) return;
  const lines = [
    `=== ${lastInspectorData.title} ===`,
    `${lastInspectorData.subtitle}`,
    `Badge: ${lastInspectorData.badge}`,
    ...(lastInspectorData.items || []).map(i => `${i.label}: ${i.val}`)
  ];
  const text = lines.join('\n');
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.getElementById('inspector-copy-btn');
    if (btn) {
      const original = btn.innerHTML;
      btn.innerHTML = '<span>✅</span> <span>Copied!</span>';
      setTimeout(() => { btn.innerHTML = original; }, 2000);
    }
  }).catch(err => {
    console.error('Clipboard copy failed:', err);
  });
}

// Mission Briefing Dashboard Modal controls
function openMissionBriefingModal() {
  const modal = document.getElementById('mission-briefing-modal');
  if (!modal) return;
  const tzName = (typeof getUserTzBadge === 'function') ? getUserTzBadge() : 'GMT+7';
  const tzEl = document.getElementById('briefing-user-time');
  if (tzEl) tzEl.innerText = `Daily at 08:00 AM (${tzName})`;

  // Dynamic Title & Badge
  const activeInstObj = (typeof availableInstances !== 'undefined' ? availableInstances : []).find(i => i.key === (typeof currentInstanceKey !== 'undefined' ? currentInstanceKey : 'agents_bs'));
  const activeFleetLabel = activeInstObj?.label || (typeof currentInstanceKey !== 'undefined' ? currentInstanceKey : 'FLEET');
  const titleEl = document.getElementById('briefing-pipeline-title');
  const badgeEl = document.getElementById('briefing-pipeline-badge');
  if (titleEl) titleEl.innerText = `PIPELINE READY: ${activeFleetLabel.toUpperCase()}`;

  const activeCrons = (typeof cronJobsData !== 'undefined' && Array.isArray(cronJobsData)) ? cronJobsData : [];
  if (badgeEl) badgeEl.innerText = activeCrons.length > 0 ? 'AUTOMATED' : 'INTERACTIVE';

  // Dynamic Server Schedule
  const serverEl = document.getElementById('briefing-server-time');
  if (serverEl) {
    if (activeCrons.length > 0) {
      const firstCron = activeCrons[0];
      serverEl.innerText = `${firstCron.name || 'Job'} (${firstCron.schedule || 'Scheduled'})`;
    } else {
      serverEl.innerText = 'Standby • Interactive Workstation';
    }
  }

  // Dynamic Pipeline Stages Grid
  const stagesContainer = document.getElementById('briefing-pipeline-stages');
  if (stagesContainer) {
    if (!agents || agents.length === 0) {
      stagesContainer.innerHTML = `
        <div class="col-span-full py-4 text-slate-500 font-mono text-center">
          No active agents in ${activeFleetLabel}. Standby workstations ready.
        </div>
      `;
    } else {
      const stageBorders = [
        'border-cyan-800/60',
        'border-purple-800/60',
        'border-pink-800/60',
        'border-amber-800/60',
        'border-sky-800/60',
        'border-emerald-800/60'
      ];
      const stageColors = [
        'text-cyan-400',
        'text-purple-400',
        'text-pink-400',
        'text-amber-400',
        'text-sky-400',
        'text-emerald-400'
      ];
      stagesContainer.className = `grid grid-cols-1 sm:grid-cols-${Math.min(Math.max(agents.length, 1), 6)} gap-2 text-center`;
      stagesContainer.innerHTML = agents.map((a, idx) => {
        const borderCls = stageBorders[idx % stageBorders.length];
        const textCls = stageColors[idx % stageColors.length];
        return `
          <div class="bg-slate-900/90 p-2.5 rounded-lg border ${borderCls}">
            <span class="text-[9px] ${textCls} font-bold block mb-1">STAGE ${idx + 1}</span>
            <strong class="text-white text-xs block">${a.name}</strong>
            <span class="text-[9px] text-slate-400 truncate block">${a.role}</span>
          </div>
        `;
      }).join('');
    }
  }

  modal.classList.remove('hidden');
}

function closeMissionBriefingModal() {
  const modal = document.getElementById('mission-briefing-modal');
  if (modal) modal.classList.add('hidden');
}

// Briefing Simulation
function triggerBriefingSimulation() {
  isBriefingActive = true;
  document.getElementById('floor-activity-status').innerText = 'BRIEFING IN PROGRESS: All hands assembled at Whiteboard';

  const lead = agents.length > 0 ? agents[0] : null;
  if (lead) {
    navigateAgentTo(lead, 375, 78, 'briefing', 'All-hands review at the board!');
    lead.dialogueTimer = 240;
  }

  const meetingSpots = [
    { x: 440, y: 168 }, { x: 490, y: 168 }, { x: 540, y: 168 }, { x: 590, y: 168 },
    { x: 440, y: 82 }
  ];
  agents.slice(1).forEach((a, idx) => {
    const spot = meetingSpots[idx] || { x: 490, y: 168 };
    navigateAgentTo(a, spot.x, spot.y, 'briefing', 'Heading to board');
    a.dialogueTimer = 180;
  });

  setTimeout(() => {
    isBriefingActive = false;
    document.getElementById('floor-activity-status').innerText = 'Briefing finished. Returning to workstations.';
    agents.forEach(a => {
      navigateAgentTo(a, a.homeX, a.homeY, 'working', 'Returning to desk');
    });
  }, 10000);
}

function triggerGossipSimulation() {
  if (!agents || agents.length === 0) return;
  const candidates = agents.slice().sort(() => Math.random() - 0.5);
  const count = Math.min(candidates.length, Math.random() < 0.5 ? 1 : 2);
  const chosen = candidates.slice(0, count);
  const spots = [
    { x: 918, y: 95, msg: 'Heading to water cooler' },
    { x: 945, y: 110, msg: 'Grabbing a cold drink' }
  ];
  chosen.forEach((ag, idx) => {
    const spot = spots[idx] || spots[0];
    navigateAgentTo(ag, spot.x, spot.y, 'gossiping', spot.msg);
  });
  const names = chosen.map(a => a.name).join(' & ');
  const statusEl = document.getElementById('floor-activity-status');
  if (statusEl) statusEl.innerText = `[BREAK ROOM]: ${names} visiting pantry & water cooler.`;
}

// BL-AGF-11: Trigger Restroom Handwash Simulation
function triggerRestroomBreak() {
  if (!agents || agents.length === 0) return;
  const candidates = agents.slice().sort(() => Math.random() - 0.5);
  const count = Math.min(candidates.length, Math.random() < 0.5 ? 1 : 2);
  const chosen = candidates.slice(0, count);
  const spots = [
    { x: 900, y: 470, msg: '< handwash break' },
    { x: 970, y: 440, msg: 'Washing hands 🧼' }
  ];
  chosen.forEach((ag, idx) => {
    const spot = spots[idx] || spots[0];
    navigateAgentTo(ag, spot.x, spot.y, 'restroom', spot.msg);
  });
  const names = chosen.map(a => a.name).join(' & ');
  const statusEl = document.getElementById('floor-activity-status');
  if (statusEl) statusEl.innerText = `[WELLNESS BREAK]: ${names} visiting Executive Restroom Annex.`;
}

function resetAllToWork() {
  isConferenceActive = false;
  conferenceSpeaker = null;
  isBriefingActive = false;
  document.getElementById('floor-activity-status').innerText = 'All agents ordered to workstations.';
  agents.forEach(a => {
    a.inConference = false;
    navigateAgentTo(a, a.homeX, a.homeY, 'working', '< heading back to desk');
  });
}

// --- BL-CHAT-18: Room 2 Conference War Room Live Choreography ---
function gatherAgentsToConferenceTable(targetList = null) {
  isConferenceActive = true;
  const participating = targetList || agents.slice(0, 8);
  participating.forEach((ag, idx) => {
    if (idx < CONFERENCE_CHAIR_SLOTS.length) {
      const chair = CONFERENCE_CHAIR_SLOTS[idx];
      ag.inConference = true;
      navigateAgentTo(ag, chair.x, chair.y, 'conferencing', 'Joining War Room...');
    }
  });
  const statusEl = document.getElementById('floor-activity-status');
  if (statusEl) {
    statusEl.innerText = `[ROOM 2 CONVENED]: Autonomous agents seated around mahogany conference table.`;
  }
}

function dismissAgentsFromConferenceTable() {
  if (!isConferenceActive) return;
  isConferenceActive = false;
  conferenceSpeaker = null;
  agents.forEach(ag => {
    if (ag.inConference) {
      ag.inConference = false;
      navigateAgentTo(ag, ag.homeX, ag.homeY, 'working', 'Returning to desk');
    }
  });
  const statusEl = document.getElementById('floor-activity-status');
  if (statusEl) {
    statusEl.innerText = `[ROOM 2 DISMISSED]: Agents returning to primary workstations.`;
  }
}

function setConferenceSpeaker(agentName, dialogueText = null) {
  conferenceSpeaker = agentName;
  const speakerAg = agents.find(a => a.name.toLowerCase() === agentName.toLowerCase());
  if (speakerAg) {
    speakerAg.state = 'working';
    if (dialogueText) {
      speakerAg.dialogue = dialogueText.length > 55 ? dialogueText.slice(0, 52) + '...' : dialogueText;
      speakerAg.dialogueTimer = 360;
    }
  }
}

// --- BL-AGF-14: Real-time Agent Situational "Say/Shout" Speech Bubbles & Voice Announcements ---
let shoutsAudioMode = localStorage.getItem('nexusdesk_shouts_audio') || 'all'; // 'all', 'critical', 'muted'

function updateShoutsFilterUI() {
  const lbl = document.getElementById('shouts-filter-label');
  const icon = document.getElementById('shouts-filter-icon');
  if (!lbl || !icon) return;
  if (shoutsAudioMode === 'all') {
    lbl.innerText = 'ALL';
    lbl.className = 'font-bold text-emerald-400';
    icon.innerText = '🔊';
  } else if (shoutsAudioMode === 'critical') {
    lbl.innerText = 'CRITICAL ONLY';
    lbl.className = 'font-bold text-amber-400';
    icon.innerText = '⚠️';
  } else {
    lbl.innerText = 'MUTED';
    lbl.className = 'font-bold text-slate-500';
    icon.innerText = '🔇';
  }
}

function cycleShoutsAudioMode() {
  if (shoutsAudioMode === 'all') shoutsAudioMode = 'critical';
  else if (shoutsAudioMode === 'critical') shoutsAudioMode = 'muted';
  else shoutsAudioMode = 'all';

  localStorage.setItem('nexusdesk_shouts_audio', shoutsAudioMode);
  updateShoutsFilterUI();
}

function handleAgentShout(data) {
  if (!data || !data.agent) return;
  const agentName = data.agent;
  const message = data.message || '';
  const category = data.category || 'info';
  const durationSec = data.duration || 7;
  const announceTts = data.announce_tts !== false;

  // 1. Locate agent character sprite on canvas
  const targetAgent = agents.find(a => a.name.toLowerCase() === agentName.toLowerCase());
  if (targetAgent) {
    targetAgent.dialogue = message;
    targetAgent.dialogueCategory = category;
    // ~60 frames per second on canvas loop
    targetAgent.dialogueTimer = durationSec * 60;
  }

  // 2. Audio Voice Announcement (Only for ambient canvas background alerts, NEVER when user is actively inside Console or War Room to avoid mic bleed)
  const isChatCompletionShout = category === 'task_complete' || (data.message && data.message.startsWith('Task complete:'));
  const isUserInChatConsole = (typeof activeTab !== 'undefined' && activeTab === 'console');
  const shouldSpeak = (
    announceTts &&
    !isChatCompletionShout &&
    !isUserInChatConsole &&
    (shoutsAudioMode === 'all' || (shoutsAudioMode === 'critical' && category === 'critical'))
  );

  if (shouldSpeak && typeof speakWithAgentVoice === 'function') {
    const spokenAgent = targetAgent || {
      name: agentName,
      voice: { pitch: 1.0, rate: 1.0, voiceName: '' }
    };
    speakWithAgentVoice(spokenAgent, message);
  }

  // 3. Activity feed update on floor status line
  const statusEl = document.getElementById('floor-activity-status');
  if (statusEl) {
    statusEl.innerText = `[${agentName.toUpperCase()} SHOUT]: "${message}"`;
    setTimeout(() => {
      if (statusEl.innerText.includes(agentName.toUpperCase())) {
        statusEl.innerText = 'Normal operations • All agents on duty';
      }
    }, durationSec * 1000);
  }
}

// Initialize shouts filter, theme selector, and view modes state on load
if (typeof window !== 'undefined') {
  window.addEventListener('DOMContentLoaded', () => {
    updateShoutsFilterUI();
    const selTheme = document.getElementById('select-floor-theme');
    if (selTheme) selTheme.value = activeFloorTheme;
    updateViewModeUI();
  });
}
