/**
 * @module floor/floor_navigation_ai.js
 * @description AgentFloor Collision-Free Waypoint & Simulation AI.
 * Zone detection, A*-style doorway/corridor waypoint routing (`findWaypoints`),
 * idle autonomous agent state machine (`updateAgentSimulation`), and gossip.
 *
 * Part of the AgentFloor canvas subsystem (concatenated globally by frontend/build.py).
 */

// --- Collision-Free Waypoint Navigation (Doorways & Corridors) ---
function getOfficeZone(x, y) {
  if (x < 285 && y < 235) return 'EXECUTIVE';
  if (x >= 315 && x <= 745 && y < 195) return 'CONFERENCE';
  if (x >= 795 && y < 245) return 'BREAK_ROOM';
  if (x >= 815 && y >= 375) return 'RESTROOM';
  return 'BULLPEN';
}

// Helper to get nearest vertical aisle for Bullpen desks to avoid passing through desks
function getBullpenAisle(x) {
  if (x <= 400) return 305; // west aisle (between executive suite and desk 1/4)
  if (x <= 500) return 455; // center aisle 1 (between desk 1/4 and 2/5)
  if (x <= 630) return 605; // center aisle 2 (between desk 2/5 and 3/6)
  return 755; // east aisle (between desk 3/6 and restroom annex)
}

function findWaypoints(startX, startY, destX, destY) {
  const startZone = getOfficeZone(startX, startY);
  const destZone = getOfficeZone(destX, destY);

  // --- CASE 1: WITHIN SAME ZONE ---
  if (startZone === destZone) {
    if (startZone === 'CONFERENCE') {
      // Conference table obstacle: x: 410..650, y: 100..160
      if ((startY < 95 && destY > 165) || (startY > 165 && destY < 95)) {
        const bypassX = (Math.min(startX, destX) <= 530) ? 365 : 685;
        return [
          { x: bypassX, y: startY < 95 ? 80 : 175 },
          { x: bypassX, y: startY < 95 ? 175 : 80 },
          { x: destX, y: destY }
        ];
      }
    } else if (startZone === 'BREAK_ROOM') {
      if ((startY > 150 && destY < 120) || (startY < 120 && destY > 150)) {
        return [
          { x: 840, y: startY > 150 ? 205 : 110 },
          { x: 840, y: startY > 150 ? 110 : 205 },
          { x: destX, y: destY }
        ];
      }
    } else if (startZone === 'BULLPEN') {
      if (Math.abs(startX - destX) > 15 || Math.abs(startY - destY) > 15) {
        const startAisle = getBullpenAisle(startX);
        const destAisle = getBullpenAisle(destX);
        const startRowY = startY < 330 ? 280 : 340;
        const destRowY = destY < 330 ? 280 : 340;
        const wpsSame = [];
        if (Math.abs(startY - startRowY) > 8) wpsSame.push({ x: startX, y: startRowY });
        wpsSame.push({ x: startAisle, y: startRowY });
        if (startAisle !== destAisle || startRowY !== destRowY) {
          wpsSame.push({ x: startAisle, y: 220 });
          wpsSame.push({ x: destAisle, y: 220 });
          wpsSame.push({ x: destAisle, y: destRowY });
        }
        wpsSame.push({ x: destX, y: destRowY });
        wpsSame.push({ x: destX, y: destY });
        return wpsSame;
      }
    }
    return [{ x: destX, y: destY }];
  }

  const wps = [];

  // --- PHASE 1: EXIT START ZONE ONTO MAIN HALLWAY (y = 220) ---
  let hallwayX = startX;
  if (startZone === 'EXECUTIVE') {
    if (startY < 180) wps.push({ x: startX, y: 185 }); // step south of desk
    wps.push({ x: 275, y: 205 }); // step inside executive door
    wps.push({ x: 305, y: 220 }); // step onto main hallway
    hallwayX = 305;
  } else if (startZone === 'CONFERENCE') {
    if (startY < 100) {
      const bypassX = (startX <= 530) ? 365 : 685;
      wps.push({ x: bypassX, y: 80 });
      wps.push({ x: bypassX, y: 175 });
    }
    wps.push({ x: 520, y: 185 });
    wps.push({ x: 520, y: 220 });
    hallwayX = 520;
  } else if (startZone === 'BREAK_ROOM') {
    if (startY < 130) {
      wps.push({ x: 840, y: 110 });
      wps.push({ x: 840, y: 205 });
    }
    wps.push({ x: 805, y: 205 });
    wps.push({ x: 775, y: 220 });
    hallwayX = 775;
  } else if (startZone === 'RESTROOM') {
    wps.push({ x: 980, y: 400 });
    wps.push({ x: 980, y: 360 }); // exit doorway
    wps.push({ x: 775, y: 320 }); // cross corridor
    wps.push({ x: 775, y: 220 }); // main hallway
    hallwayX = 775;
  } else if (startZone === 'BULLPEN') {
    const aisleX = getBullpenAisle(startX);
    if (startY < 330) {
      wps.push({ x: startX, y: 280 }); // step south into row 1 walkway behind desk
      wps.push({ x: aisleX, y: 280 }); // walk along walkway to aisle
      wps.push({ x: aisleX, y: 220 }); // walk north along aisle to hallway
      hallwayX = aisleX;
    } else {
      wps.push({ x: startX, y: 340 }); // step into row 2 walkway
      wps.push({ x: aisleX, y: 340 }); // walk to aisle
      wps.push({ x: aisleX, y: 220 }); // walk north along aisle to hallway
      hallwayX = aisleX;
    }
  }

  // --- PHASE 2 & 3: TRAVERSE MAIN HALLWAY & ENTER DESTINATION ZONE ---
  if (destZone === 'EXECUTIVE') {
    if (Math.abs(hallwayX - 305) > 5) wps.push({ x: 305, y: 220 });
    wps.push({ x: 275, y: 205 });
    if (destY < 180) wps.push({ x: destX, y: 185 });
    wps.push({ x: destX, y: destY });
  } else if (destZone === 'CONFERENCE') {
    if (Math.abs(hallwayX - 520) > 5) wps.push({ x: 520, y: 220 });
    wps.push({ x: 520, y: 185 });
    if (destY < 100) {
      const bypassX = (destX <= 530) ? 365 : 685;
      wps.push({ x: bypassX, y: 175 });
      wps.push({ x: bypassX, y: 80 });
    }
    wps.push({ x: destX, y: destY });
  } else if (destZone === 'BREAK_ROOM') {
    if (Math.abs(hallwayX - 775) > 5) wps.push({ x: 775, y: 220 });
    wps.push({ x: 805, y: 205 });
    if (destY < 130) {
      wps.push({ x: 840, y: 205 });
      wps.push({ x: 840, y: 110 });
    }
    wps.push({ x: destX, y: destY });
  } else if (destZone === 'RESTROOM') {
    if (Math.abs(hallwayX - 775) > 5) wps.push({ x: 775, y: 220 });
    wps.push({ x: 775, y: 320 });
    wps.push({ x: 980, y: 360 }); // approach doorway
    wps.push({ x: 980, y: 400 }); // enter doorway
    wps.push({ x: destX, y: destY });
  } else if (destZone === 'BULLPEN') {
    const destAisle = getBullpenAisle(destX);
    if (Math.abs(hallwayX - destAisle) > 5) wps.push({ x: destAisle, y: 220 });
    if (destY < 330) {
      wps.push({ x: destAisle, y: 280 }); // walk down aisle to row 1 walkway
      wps.push({ x: destX, y: 280 });     // walk along walkway to desk column
      wps.push({ x: destX, y: destY });   // step north into desk chair
    } else {
      wps.push({ x: destAisle, y: 340 }); // walk down aisle to row 2 walkway
      wps.push({ x: destX, y: 340 });     // walk along walkway to desk column
      wps.push({ x: destX, y: destY });   // step into desk chair
    }
  }

  return wps;
}

function computeFacing(vx, vy) {
  if (Math.abs(vx) < 0.01 && Math.abs(vy) < 0.01) return 'sw';
  if (Math.abs(vx) >= Math.abs(vy)) {
    return (vx > 0) ? 'se' : 'nw';
  } else {
    return (vy > 0) ? 'sw' : 'ne';
  }
}

function navigateAgentTo(agent, targetX, targetY, onCompleteState = 'gossiping', dialogue = null) {
  agent.isLiveActive = false; // prioritize navigation command
  if (agent.state === 'sleeping' || agent.state === 'playing_phone' || agent.state === 'whistling') {
    agent.state = 'working';
  }
  agent.waypoints = findWaypoints(agent.x, agent.y, targetX, targetY);
  agent.targetX = targetX;
  agent.targetY = targetY;
  agent.onCompleteState = onCompleteState;
  agent.state = 'walking';
  agent.walkPhase = agent.walkPhase || 0;
  if (agent.waypoints && agent.waypoints.length > 0) {
    const wp = agent.waypoints[0];
    agent.facing = computeFacing(wp.x - agent.x, wp.y - agent.y);
  }
  if (dialogue) {
    agent.dialogue = dialogue;
    agent.dialogueTimer = 180;
  }
}

// --- Autonomous Simulation Logic & Live Hermes Sync ---
function updateAgentSimulation(a) {
  // RULE -1: If seated in Conference War Room (Room 2), stay at conference chair!
  if (a.inConference) {
    if (a.state === 'walking' && a.waypoints && a.waypoints.length > 0) {
      const wp = a.waypoints[0];
      const dist = Math.hypot(wp.x - a.x, wp.y - a.y);
      if (dist > 2.5) {
        const stepX = ((wp.x - a.x) / dist) * a.speed;
        const stepY = ((wp.y - a.y) / dist) * a.speed;
        a.x += stepX;
        a.y += stepY;
        a.vx = stepX;
        a.vy = stepY;
        a.walkPhase = (a.walkPhase || 0) + 0.35;
        a.facing = computeFacing(stepX, stepY);
      } else {
        a.x = wp.x;
        a.y = wp.y;
        a.waypoints.shift();
      }
    } else {
      a.state = 'conferencing';
      a.walkPhase = 0;
      a.facing = (a.y < 130) ? 'se' : 'nw';
    }
    if (a.dialogueTimer > 0) a.dialogueTimer--;
    return;
  }

  // RULE 0: Live Hermes terminal / background activity OVERRIDES simulation completely!
  if (a.isLiveActive && a.state !== 'walking' && a.state !== 'briefing' && !a.inConference) {
    a.state = 'working';
    a.waypoints = [];
    a.x = a.homeX;
    a.y = a.homeY;
    a.targetX = a.homeX;
    a.targetY = a.homeY;
    a.walkPhase = 0;
    a.facing = 'nw';
    if (a.dialogueTimer > 0) a.dialogueTimer--;
    return;
  }

  // RULE 1: If sleeping, whistling, or playing phone, STAY AT DESK! NEVER WALK WHILE 'ZZZ'!
  if (a.state === 'sleeping' || a.state === 'playing_phone' || a.state === 'working') {
    a.waypoints = [];
    a.x = a.homeX;
    a.y = a.homeY;
    a.targetX = a.homeX;
    a.targetY = a.homeY;
    a.walkPhase = 0;
    a.facing = (a.state === 'whistling') ? 'sw' : 'nw';
  }

  // RULE 2: Movement interpolation using door & corridor waypoints
  if (a.state === 'walking' || a.state === 'briefing') {
    if (a.waypoints && a.waypoints.length > 0) {
      const wp = a.waypoints[0];
      const dist = Math.hypot(wp.x - a.x, wp.y - a.y);
      if (dist > 2.5) {
        const stepX = ((wp.x - a.x) / dist) * a.speed;
        const stepY = ((wp.y - a.y) / dist) * a.speed;
        a.x += stepX;
        a.y += stepY;
        a.vx = stepX;
        a.vy = stepY;
        a.walkPhase = (a.walkPhase || 0) + 0.35;
        a.facing = computeFacing(stepX, stepY);
      } else {
        a.x = wp.x;
        a.y = wp.y;
        a.waypoints.shift();
      }
    } else {
      // Arrived at destination
      a.walkPhase = 0;
      if (a.state === 'walking') {
        if (Math.hypot(a.x - a.homeX, a.y - a.homeY) < 5) {
          a.x = a.homeX;
          a.y = a.homeY;
          a.state = 'working';
          a.stateTimer = 2200 + Math.random() * 1500;
          a.dialogue = 'done! ✓';
          a.dialogueTimer = 180;
          a.facing = 'nw';
        } else {
          a.state = a.onCompleteState || 'gossiping';
          a.stateTimer = 1000 + Math.random() * 800;
          if (a.state === 'gossiping') {
            showRandomGossip(a);
            a.facing = 'sw';
          } else if (a.state === 'restroom') {
            a.dialogue = 'Washing hands 🧼';
            a.dialogueTimer = 240;
            a.facing = 'ne';
          }
        }
      }
    }
  }

  // RULE 3: Calm, extended state timers (NO fast jumping!)
  if (!isBriefingActive && a.state !== 'walking') {
    a.stateTimer--;
    if (a.stateTimer <= 0) {
      if (a.state === 'working') {
        // After working 45+ seconds, pick a calm break
        const rand = Math.random();
        if (rand < 0.28) {
          // Stroll to water cooler via doors & corridors
          navigateAgentTo(a, 930 + (Math.random() * 30 - 15), 120 + (Math.random() * 30 - 15), 'gossiping', '< heading to water cooler');
        } else if (rand < 0.42) {
          // BL-AGF-11: Visit restroom annex for quick handwash break
          navigateAgentTo(a, 980, 440, 'restroom', '< heading to restroom');
        } else if (rand < 0.65) {
          // Power snooze at desk (stays firmly at desk, no walking!)
          a.state = 'sleeping';
          a.waypoints = [];
          a.x = a.homeX; a.y = a.homeY;
          a.stateTimer = 1000 + Math.random() * 600;
          a.dialogue = null;
          a.walkPhase = 0;
          a.facing = 'nw';
        } else if (rand < 0.85) {
          // Checking phone at desk
          a.state = 'playing_phone';
          a.waypoints = [];
          a.x = a.homeX; a.y = a.homeY;
          a.stateTimer = 800 + Math.random() * 500;
          a.dialogue = '< checking phone';
          a.dialogueTimer = 180;
          a.walkPhase = 0;
          a.facing = 'nw';
        } else {
          // Whistling at desk
          a.state = 'whistling';
          a.waypoints = [];
          a.x = a.homeX; a.y = a.homeY;
          a.stateTimer = 700 + Math.random() * 400;
          a.dialogue = null;
          a.walkPhase = 0;
          a.facing = 'sw';
        }
      } else if (a.state === 'gossiping' || a.state === 'restroom') {
        // Finished water cooler or restroom break -> walk back to desk via doors & corridors
        navigateAgentTo(a, a.homeX, a.homeY, 'working', '< heading back to desk');
      } else {
        // Woke up / finished phone / whistling -> back to focused work
        a.state = 'working';
        a.waypoints = [];
        a.x = a.homeX; a.y = a.homeY;
        a.stateTimer = 2400 + Math.random() * 1200;
        a.dialogue = '< reading SPEC.md';
        a.dialogueTimer = 180;
        a.walkPhase = 0;
        a.facing = 'nw';
      }
    }
  }

  if (a.dialogueTimer > 0) {
    a.dialogueTimer--;
    if (a.dialogueTimer <= 0) a.dialogue = null;
  }
}

function showRandomGossip(a) {
  const phrases = [
    'Nous Ling-3.1-Flash is so fast!',
    'Min gave us persistent wiki memory!',
    'Latency dropped to 48ms!',
    'Did you see the new devotion carousel?',
    'Almost time for daily dose publish.'
  ];
  a.dialogue = phrases[Math.floor(Math.random() * phrases.length)];
  a.dialogueTimer = 300;
}
