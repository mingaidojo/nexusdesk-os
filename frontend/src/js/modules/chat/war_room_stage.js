/**
 * @module chat/war_room_stage.js
 * @description War Room Teams Stage Grid, Heartbeat Stopwatch & Manage Agents.
 * Controls MS Teams-style speaker tiles, pixel avatars, active speaker timer,
 * orchestrator/preset/WoW configuration, and agent invite/remove modals.
 *
 * Part of the Console & War Room chat subsystem (concatenated globally by frontend/build.py).
 */

// ==============================================================
// --- BL-CHAT-32 & BL-CHAT-33: MS TEAMS STAGE VIEW & AGENT AVATARS ---
// ==============================================================
let teamsStageActive = (typeof localStorage !== 'undefined' && localStorage.getItem('nexusdesk_warroom_stage_open') === 'true');
let activeSpeakingAgent = null;
let activeSpeakingRoomId = null;
let activeSpeakingEngine = null;
let speakerTimerInterval = null;
let speakerStartTime = 0;

window.toggleTeamsStageView = function() {
  teamsStageActive = !teamsStageActive;
  try {
    localStorage.setItem('nexusdesk_warroom_stage_open', teamsStageActive ? 'true' : 'false');
  } catch (e) {}

  const stage = document.getElementById('warroom-teams-stage');
  const btn = document.getElementById('btn-toggle-teams-stage');
  if (stage) stage.classList.toggle('hidden', !teamsStageActive);
  if (btn) {
    btn.classList.toggle('bg-cyan-600', teamsStageActive);
    btn.classList.toggle('text-white', teamsStageActive);
  }
  if (teamsStageActive) {
    renderTeamsStageGrid();
  }
};

// Helper: Generate an authentic AgentFloor Pixel Bust Avatar
function createAgentPixelAvatar(agentName, themeColor, hairColor, shirtColor) {
  const cvs = document.createElement('canvas');
  cvs.width = 36;
  cvs.height = 36;
  const ctx = cvs.getContext('2d');
  ctx.imageRendering = 'pixelated';

  const hc = hairColor || '#392113';
  const sc = shirtColor || themeColor || '#06b6d4';
  const skin = '#fbcfe8';

  // Background subtle circular badge
  ctx.fillStyle = `${themeColor}22`;
  ctx.beginPath();
  ctx.arc(18, 18, 17, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = `${themeColor}66`;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Body / Shoulders
  ctx.fillStyle = sc;
  ctx.fillRect(9, 23, 18, 12);
  // Collar / Tie / Accent
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(16, 23, 4, 12);

  // Head / Skin
  ctx.fillStyle = skin;
  ctx.fillRect(11, 10, 14, 13);

  // Hair
  ctx.fillStyle = hc;
  ctx.fillRect(10, 6, 16, 6);
  ctx.fillRect(10, 10, 3, 6); // left sideburn
  ctx.fillRect(23, 10, 3, 4); // right sideburn

  // Pixel Eyes & Glasses/Visor (Specialized per archetype)
  const lower = (agentName || '').toLowerCase();
  if (lower === 'solaris') {
    // Solaris emerald cyber visor
    ctx.fillStyle = '#10b981';
    ctx.fillRect(12, 14, 12, 3);
    ctx.fillStyle = '#6ee7b7';
    ctx.fillRect(14, 15, 4, 1);
  } else if (lower === 'claude') {
    // Claude architect amber glasses
    ctx.fillStyle = '#f59e0b';
    ctx.strokeRect(12.5, 13.5, 4, 3);
    ctx.strokeRect(18.5, 13.5, 4, 3);
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(14, 14, 1, 1);
    ctx.fillRect(20, 14, 1, 1);
  } else if (lower === 'agy') {
    // Agy sky cyber optics
    ctx.fillStyle = '#0284c7';
    ctx.fillRect(13, 13, 3, 3);
    ctx.fillRect(19, 13, 3, 3);
    ctx.fillStyle = '#38bdf8';
    ctx.fillRect(14, 14, 1, 1);
    ctx.fillRect(20, 14, 1, 1);
  } else {
    // Default crisp pixel eyes
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(13, 14, 2, 2);
    ctx.fillRect(20, 14, 2, 2);
  }

  return cvs;
}

function renderTeamsStageGrid() {
  const stage = document.getElementById('warroom-teams-stage');
  const grid = document.getElementById('warroom-teams-grid');
  if (!grid) return;
  if (stage) stage.classList.toggle('hidden', !teamsStageActive);

  grid.innerHTML = '';
  const participants = getEffectiveWarRoomParticipants();

  // 1. Operator Tile (Min with operator headset avatar)
  const userTile = document.createElement('div');
  userTile.className = 'relative flex flex-col items-center justify-center p-2 rounded-xl bg-slate-900 border border-emerald-600/60 shadow-md h-24 overflow-hidden transition-all';

  const userCanvas = createAgentPixelAvatar('Operator Min', '#10b981', '#1e293b', '#064e3b');
  userTile.innerHTML = `
    <div class="relative w-10 h-10 rounded-full overflow-hidden flex items-center justify-center shadow">
    </div>
    <div class="mt-1 flex flex-col items-center max-w-full px-1">
      <span class="text-[11px] font-bold text-emerald-300 font-mono tracking-tight leading-none">Min (Operator)</span>
      <span class="text-[8.5px] font-mono text-emerald-500 mt-0.5">HUMAN COMMAND</span>
    </div>
    <span class="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-emerald-400"></span>
  `;
  userTile.children[0].appendChild(userCanvas);
  grid.appendChild(userTile);

  // 2. Participant Agent Tiles with AgentFloor pixel avatar
  const targetRoomForTiles = activeWarRoomId || 'general';
  const activeSpeakersMap = (typeof activeSpeakersByRoom !== 'undefined') ? activeSpeakersByRoom.get(targetRoomForTiles) : null;
  participants.forEach(p => {
    const eng = (p.engine || 'hermes').toLowerCase();
    const color = p.color || '#06b6d4';
    const isSpeaking = Boolean(
      (activeSpeakersMap && activeSpeakersMap.has(p.name.toLowerCase())) ||
      (activeSpeakingAgent && activeSpeakingAgent.toLowerCase() === p.name.toLowerCase())
    );
    const liveAgent = (typeof agents !== 'undefined' && Array.isArray(agents))
      ? agents.find(a => a.name.toLowerCase() === p.name.toLowerCase())
      : null;
    const isWorking = (liveAgent && liveAgent.state === 'working') || isSpeaking;

    const tile = document.createElement('div');
    const borderCls = isSpeaking
      ? 'border-2 border-cyan-400 shadow-[0_0_15px_rgba(6,182,212,0.4)] bg-cyan-950/40 animate-pulse'
      : isWorking
      ? 'border border-amber-500/80 bg-amber-950/20'
      : 'border border-slate-800 bg-slate-900/90';

    tile.className = `relative flex flex-col items-center justify-center p-2 rounded-xl ${borderCls} shadow-md h-24 overflow-hidden transition-all`;

    const hairColor = liveAgent?.hairColor || (p.theme === 'amber' ? '#d97706' : p.theme === 'pink' ? '#db2777' : '#1e293b');
    const shirtColor = liveAgent?.shirtColor || color;
    const avatarCanvas = createAgentPixelAvatar(p.name, color, hairColor, shirtColor);
    const currentModel = p.model || liveAgent?.model || window.engineDefaultsMap[eng] || '';
    const shortModel = formatShortModelName(currentModel, eng);
    const safeName = p.name.replace(/'/g, "\\'");
    const safeModel = (currentModel || '').replace(/'/g, "\\'");
    const safeFleet = (p.fleet || 'agents_bs').replace(/'/g, "\\'");

    const hasRoomModel = Boolean(p.is_room_model);
    const modelBadgeLabel = hasRoomModel ? `[RM] ${shortModel}` : shortModel;
    const modelBtnBorder = hasRoomModel 
      ? 'border-amber-500/90 text-amber-300 bg-amber-950/60 hover:bg-amber-900/80 hover:border-amber-400' 
      : 'border-slate-800 text-cyan-300 bg-slate-950/90 hover:bg-cyan-950 hover:border-cyan-600';

    tile.innerHTML = `
      <div class="relative w-9 h-9 rounded-full flex items-center justify-center shadow">
        ${isSpeaking ? '<span class="absolute -bottom-1 -right-1 text-[10px] z-10">🎙️</span>' : ''}
      </div>
      <div class="mt-0.5 flex flex-col items-center max-w-full px-1">
        <span class="text-[10.5px] font-bold font-mono tracking-tight leading-none truncate max-w-full" style="color: ${color}">${p.name}</span>
        <button type="button" onclick="openQuickModelPickerModal('${safeName}', '${eng}', '${safeModel}', '${safeFleet}')" class="mt-0.5 px-1.5 py-0.2 rounded border ${modelBtnBorder} text-[8px] font-mono truncate max-w-[110px] cursor-pointer transition" title="${hasRoomModel ? 'Room-Scoped LLM: ' + currentModel : 'Default LLM: ' + currentModel}">
          🧠 ${modelBadgeLabel} ▾
        </button>
      </div>
      <span class="absolute top-1.5 right-1.5 w-2 h-2 rounded-full ${isSpeaking ? 'bg-cyan-400 animate-ping' : isWorking ? 'bg-amber-400 animate-pulse' : 'bg-slate-600'}"></span>
    `;
    tile.children[0].appendChild(avatarCanvas);
    grid.appendChild(tile);
  });
}

// --- BL-CHAT-33, BL-WAR-50, BL-EVO-25, BL-EVO-31 + Parallel Swarm Multi-Speaker Tracking ---
let activeSpeakerTimeoutSec = 2700;
let activeSpeakerLiveActivity = '';
const activeSpeakersByRoom = new Map(); // Map<roomId, Map<agentLower, { agent, engine, startedAt, timeoutSec, activity }>>
const REASONING_PHASES = [
  'Parsing directive & room context...',
  'Formulating architectural synthesis...',
  'Cross-referencing fleet knowledge & files...',
  'Executing CLI tools & codebase inspection...',
  'Evaluating recommendations & parameters...',
  'Drafting executive summary takeaway...',
  'Finalizing high-signal response...'
];

function _syncPrimarySpeakerFromMap(roomId) {
  const rid = roomId || activeWarRoomId || 'general';
  const rMap = activeSpeakersByRoom.get(rid);
  if (rMap && rMap.size > 0) {
    const first = rMap.values().next().value;
    activeSpeakingAgent = first.agent;
    activeSpeakingEngine = first.engine;
    activeSpeakingRoomId = rid;
    activeSpeakerTimeoutSec = first.timeoutSec || 2700;
    activeSpeakerLiveActivity = first.activity || '';
    speakerStartTime = first.startedAt || Date.now();
  } else {
    if (!activeSpeakingRoomId || activeSpeakingRoomId === rid) {
      activeSpeakingAgent = null;
      activeSpeakingRoomId = null;
      activeSpeakingEngine = null;
      activeSpeakerLiveActivity = '';
    }
  }
}

function startSpeakerHeartbeat(agentName, engine, roomId = null, timeoutSeconds = 2700, swarmPhase = '') {
  const rid = roomId || activeWarRoomId || 'general';
  let rMap = activeSpeakersByRoom.get(rid);
  if (!rMap) {
    rMap = new Map();
    activeSpeakersByRoom.set(rid, rMap);
  }
  const key = String(agentName || 'routing').toLowerCase().trim();
  // Remove synthetic placeholder once a real agent starts speaking
  if (key !== 'routing directive...' && rMap.has('routing directive...')) {
    rMap.delete('routing directive...');
  }
  const prev = rMap.get(key);
  rMap.set(key, {
    agent: agentName,
    engine: engine || prev?.engine || '',
    color: prev?.color || '#06b6d4',
    startedAt: prev?.startedAt || Date.now(),
    timeoutSec: (typeof timeoutSeconds === 'number' && timeoutSeconds >= 30) ? timeoutSeconds : (prev?.timeoutSec || 2700),
    activity: prev?.activity || '',
    swarmPhase: swarmPhase || prev?.swarmPhase || '',
    intent: prev?.intent || '',
    understanding: prev?.understanding || '',
    planSteps: Array.isArray(prev?.planSteps) ? prev.planSteps : [],
    preflightGate: Boolean(prev?.preflightGate),
    manualReviewOnly: Boolean(prev?.manualReviewOnly),
    preflightDeadlineMs: prev?.preflightDeadlineMs || 0,
    preflightTotalSec: prev?.preflightTotalSec || 10,
    steps: Array.isArray(prev?.steps) ? prev.steps : []
  });
  _syncPrimarySpeakerFromMap(rid);
  syncSpeakerBannerVisibility();
  renderLiveWorkingCards(rid);

  if (speakerTimerInterval) clearInterval(speakerTimerInterval);
  speakerTimerInterval = setInterval(() => {
    updateSpeakerTimerDisplay();
    renderLiveWorkingCards();
  }, 1000);

  if (teamsStageActive) renderTeamsStageGrid();
}

function updateLiveAgentIntent(data) {
  if (!data || !data.agent) return;
  const msgRoom = data.room_id || 'general';
  const key = String(data.agent).toLowerCase().trim();
  let rMap = activeSpeakersByRoom.get(msgRoom);
  if (!rMap || !rMap.has(key)) {
    startSpeakerHeartbeat(data.agent, data.engine || 'hermes', msgRoom, 2700, data.swarm_phase || '');
    rMap = activeSpeakersByRoom.get(msgRoom);
  }
  const entry = rMap?.get(key);
  if (entry) {
    if (data.intent) entry.intent = String(data.intent).trim();
    if (data.understanding) entry.understanding = String(data.understanding).trim();
    if (Array.isArray(data.plan_steps) && data.plan_steps.length > 0) {
      entry.planSteps = data.plan_steps.map(s => String(s || '').trim()).filter(Boolean);
    }
    if (data.color) entry.color = data.color;
    if (data.swarm_phase) entry.swarmPhase = data.swarm_phase;
    if (typeof data.preflight_gate === 'boolean') {
      entry.preflightGate = data.preflight_gate;
      entry.manualReviewOnly = Boolean(data.manual_review_only);
      const cdSec = Number(data.countdown_seconds || 0);
      entry.preflightTotalSec = cdSec > 0 ? cdSec : 10;
      entry.preflightDeadlineMs = (data.preflight_gate && cdSec > 0) ? (Date.now() + cdSec * 1000) : 0;
    }
  }
  if (msgRoom === (activeWarRoomId || 'general')) {
    renderLiveWorkingCards(msgRoom);
    updateSpeakerTimerDisplay();
  }
}

function resolveLivePreflightGate(data) {
  if (!data) return;
  const msgRoom = data.room_id || 'general';
  const key = String(data.agent || '').toLowerCase().trim();
  const rMap = activeSpeakersByRoom.get(msgRoom);
  if (rMap && rMap.has(key)) {
    const entry = rMap.get(key);
    entry.preflightGate = false;
    entry.preflightDeadlineMs = 0;
  }
  if (msgRoom === (activeWarRoomId || 'general')) {
    renderLiveWorkingCards(msgRoom);
    updateSpeakerTimerDisplay();
  }
}
window.resolveLivePreflightGate = resolveLivePreflightGate;

async function sendWarRoomPreflightDecision(roomId, agentName, action) {
  const targetRoom = roomId || activeWarRoomId || 'general';
  const key = String(agentName || '').toLowerCase().trim();
  const rMap = activeSpeakersByRoom.get(targetRoom);
  if (rMap && rMap.has(key)) {
    const entry = rMap.get(key);
    entry.preflightGate = false;
    entry.preflightDeadlineMs = 0;
  }
  renderLiveWorkingCards(targetRoom);

  if (action === 'hold') {
    const input = document.getElementById('warroom-text-input');
    if (input) {
      const prefix = `@${agentName} `;
      if (!input.value.trim().toLowerCase().startsWith(prefix.toLowerCase())) {
        input.value = prefix + input.value.trim();
      }
      input.focus();
      if (typeof autoResizeTextarea === 'function') autoResizeTextarea(input);
    }
  }

  try {
    await fetch('/api/war-room/preflight/decision', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        room_id: targetRoom,
        agent: agentName,
        action: action || 'proceed'
      })
    });
  } catch (e) {
    console.warn('Preflight decision request failed:', e);
  }
}
window.sendWarRoomPreflightDecision = sendWarRoomPreflightDecision;

function renderLiveWorkingCards(roomId = null) {
  const targetRoom = activeWarRoomId || 'general';
  if (roomId && roomId !== targetRoom) return;
  const container = document.getElementById('warroom-conversation');
  if (!container) return;

  const rMap = activeSpeakersByRoom.get(targetRoom);
  const realSpeakers = rMap
    ? Array.from(rMap.values()).filter(sp => sp.agent && sp.agent.toLowerCase() !== 'routing directive...')
    : [];
  const activeKeys = new Set(realSpeakers.map(sp => sp.agent.toLowerCase().trim()));

  // Remove stale live working cards for finished agents
  container.querySelectorAll('[data-live-agent-card]').forEach(el => {
    if (!activeKeys.has(el.getAttribute('data-live-agent-card'))) {
      el.remove();
    }
  });

  if (realSpeakers.length === 0) return;
  const now = Date.now();
  const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const nearBottom = (container.scrollHeight - container.scrollTop - container.clientHeight) < 180;

  realSpeakers.forEach(sp => {
    const key = sp.agent.toLowerCase().trim();
    let card = container.querySelector(`[data-live-agent-card="${key}"]`);
    const isNew = !card;
    if (!card) {
      card = document.createElement('div');
      card.setAttribute('data-live-agent-card', key);
      card.className = 'flex gap-3 items-start my-1';
      container.appendChild(card);
    } else if (card.nextElementSibling) {
      // Keep live working card anchored below any newly arrived messages
      container.appendChild(card);
    }

    let remCountdownSec = 0;
    if (sp.preflightGate && !sp.manualReviewOnly && sp.preflightDeadlineMs > 0) {
      remCountdownSec = Math.max(0, Math.ceil((sp.preflightDeadlineMs - now) / 1000));
      if (remCountdownSec <= 0) {
        sp.preflightGate = false;
      }
    }

    const elapsedSec = Math.floor((now - (sp.startedAt || now)) / 1000);
    const eng = (sp.engine || 'hermes').toLowerCase();
    const engStyle = (typeof ENGINE_BADGE_STYLES !== 'undefined' && ENGINE_BADGE_STYLES[eng])
      ? ENGINE_BADGE_STYLES[eng]
      : 'bg-cyan-950 text-cyan-300 border-cyan-700';
    const color = sp.color || '#06b6d4';

    let phaseBadge = '';
    if (sp.preflightGate) {
      if (sp.manualReviewOnly) {
        phaseBadge = '<span class="text-[8.5px] font-mono px-1.5 py-0.5 rounded-full bg-amber-950/90 text-amber-200 border border-amber-500/80 font-bold animate-pulse">⏸️ AWAITING PLAN APPROVAL</span>';
      } else {
        phaseBadge = `<span class="text-[8.5px] font-mono px-1.5 py-0.5 rounded-full bg-amber-950/90 text-amber-200 border border-amber-500/80 font-bold animate-pulse">🧭 PRE-FLIGHT PLAN · Proceeding in ${remCountdownSec}s</span>`;
      }
    } else if (sp.swarmPhase === 'plan') {
      phaseBadge = '<span class="text-[8.5px] font-mono px-1.5 py-0.5 rounded-full bg-purple-950/90 text-purple-300 border border-purple-600/80 font-bold">👑 PLANNING</span>';
    } else if (sp.swarmPhase === 'synthesis') {
      phaseBadge = '<span class="text-[8.5px] font-mono px-1.5 py-0.5 rounded-full bg-amber-950/90 text-amber-300 border border-amber-600/80 font-bold">🎯 SYNTHESIZING</span>';
    } else {
      phaseBadge = '<span class="text-[8.5px] font-mono px-1.5 py-0.5 rounded-full bg-cyan-950/90 text-cyan-300 border border-cyan-600/70 font-bold animate-pulse">⚡ WORKING</span>';
    }

    const safeRid = String(targetRoom).replace(/'/g, "\\'");
    const safeAg = String(sp.agent).replace(/'/g, "\\'");

    let intentBlock = '';
    if (sp.understanding || (Array.isArray(sp.planSteps) && sp.planSteps.length > 0)) {
      const undHtml = sp.understanding
        ? `<div class="mb-1.5">
             <div class="text-[10px] font-mono font-bold text-amber-300 uppercase tracking-wider flex items-center gap-1 mb-0.5">
               <span>🎯</span><span>Assignment Understanding</span>
             </div>
             <div class="text-xs text-slate-100 leading-relaxed font-sans pl-1">${esc(sp.understanding)}</div>
           </div>`
        : '';
      const planListHtml = (Array.isArray(sp.planSteps) && sp.planSteps.length > 0)
        ? `<div class="mb-1">
             <div class="text-[10px] font-mono font-bold text-cyan-300 uppercase tracking-wider flex items-center gap-1 mb-0.5">
               <span>📋</span><span>Execution Action Plan</span>
             </div>
             <ol class="list-decimal list-inside space-y-0.5 text-[11.5px] text-slate-200 font-sans pl-1">
               ${sp.planSteps.map(step => `<li class="leading-snug">${esc(step)}</li>`).join('')}
             </ol>
           </div>`
        : '';

      let gateControlsHtml = '';
      if (sp.preflightGate) {
        const pct = sp.manualReviewOnly
          ? 100
          : Math.max(5, Math.min(100, Math.round((remCountdownSec / (sp.preflightTotalSec || 10)) * 100)));
        const timerHint = sp.manualReviewOnly
          ? '⏸️ Review Plan is active — waiting for your confirmation before proceeding'
          : `⏱ Auto-proceeding with this action plan in ${remCountdownSec}s if no changes requested`;
        gateControlsHtml = `
          <div class="mt-2 pt-1.5 border-t border-amber-700/50 flex flex-col gap-1.5">
            <div class="w-full h-1 rounded-full bg-slate-800 overflow-hidden">
              <div class="h-full bg-amber-400 transition-all duration-700" style="width: ${pct}%"></div>
            </div>
            <div class="flex items-center justify-between gap-2 flex-wrap">
              <span class="text-[10px] font-mono text-amber-200/90">${esc(timerHint)}</span>
              <div class="flex items-center gap-1.5">
                <button type="button" onclick="sendWarRoomPreflightDecision('${safeRid}', '${safeAg}', 'proceed')"
                        class="px-2.5 py-0.5 rounded bg-emerald-700 hover:bg-emerald-600 text-white border border-emerald-500 text-[10.5px] font-mono font-bold cursor-pointer transition shadow-sm">
                  ⚡ Proceed Now
                </button>
                <button type="button" onclick="sendWarRoomPreflightDecision('${safeRid}', '${safeAg}', 'hold')"
                        class="px-2.5 py-0.5 rounded bg-amber-950/90 hover:bg-amber-900 text-amber-200 border border-amber-600/80 text-[10.5px] font-mono font-semibold cursor-pointer transition">
                  ⏸️ Hold &amp; Adjust
                </button>
              </div>
            </div>
          </div>
        `;
      }

      const boxBorder = sp.preflightGate ? 'border-amber-500/70 bg-amber-950/20' : 'border-cyan-800/60 bg-slate-950/60';
      intentBlock = `
        <div class="p-2 rounded-lg border ${boxBorder} mb-1.5">
          ${undHtml}
          ${planListHtml}
          ${gateControlsHtml}
        </div>
      `;
    } else if (sp.intent) {
      intentBlock = `<div class="text-xs text-slate-100 leading-relaxed font-sans mb-1.5">${esc(sp.intent)}</div>`;
    } else {
      intentBlock = `<div class="text-[11px] text-slate-400 font-mono italic mb-1.5">Synthesizing assignment understanding &amp; action plan...</div>`;
    }

    const stepsHtml = (Array.isArray(sp.steps) && sp.steps.length > 0)
      ? `<div class="space-y-0.5 pt-1.5 border-t border-slate-800/80 font-mono text-[10px] text-cyan-300/90">${sp.steps.slice(-4).map((st, idx, arr) => `
          <div class="flex items-center gap-1.5 ${idx === arr.length - 1 ? 'text-cyan-200 font-semibold' : 'text-slate-400'}">
            <span class="text-[9px] text-slate-500 shrink-0">${esc(st.t)}</span>
            <span class="truncate">${esc(st.text)}</span>
          </div>`).join('')}</div>`
      : '';

    const cardBorder = sp.preflightGate ? 'border-amber-500/80' : 'border-cyan-700/60';
    card.innerHTML = `
      <div class="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-pixel font-bold flex-shrink-0 shadow-md mt-0.5 animate-pulse"
           style="background: ${color}22; border: 1.5px solid ${color}; color: ${color};">
        ${esc(sp.agent[0] || 'A')}
      </div>
      <div class="bg-slate-900/90 border ${cardBorder} px-3.5 py-2.5 rounded-xl text-xs max-w-[92%] sm:max-w-[88%] text-slate-200 shadow-lg backdrop-blur-sm">
        <div class="flex items-center justify-between gap-3 mb-1.5 border-b border-slate-800/80 pb-1">
          <div class="flex items-center gap-2 flex-wrap">
            <strong class="text-xs font-pixel" style="color: ${color}">${esc(sp.agent)}</strong>
            <span class="text-[8px] font-mono px-1.5 py-0.2 rounded font-bold uppercase border ${engStyle}">[${esc(eng.toUpperCase())}]</span>
            ${phaseBadge}
          </div>
          <span class="text-[10px] font-mono text-cyan-400 shrink-0">⏱ ${formatSpeakerDuration(elapsedSec)}</span>
        </div>
        ${intentBlock}
        ${stepsHtml}
      </div>
    `;

    if (isNew && nearBottom) {
      container.scrollTop = container.scrollHeight;
    }
  });
}

function sanitizeSpeakerActivity(text) {
  return String(text || '')
    .replace(/\s*\(\d+s\)(\s*\.\.\.)?$/i, (_, dots) => (dots ? '...' : ''))
    .trim();
}

function formatSpeakerDuration(sec) {
  const s = Math.max(0, Math.floor(sec || 0));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}m ${rem}s`;
}

function updateLiveSpeakerActivity(data) {
  if (!data) return;
  const msgRoom = data.room_id || 'general';
  if (data.agent) {
    const rMap = activeSpeakersByRoom.get(msgRoom);
    const key = data.agent.toLowerCase().trim();
    if (!rMap || !rMap.has(key)) {
      startSpeakerHeartbeat(data.agent, data.engine || 'hermes', msgRoom, 2700);
    }
    const entry = activeSpeakersByRoom.get(msgRoom)?.get(key);
    if (entry && data.activity) {
      const cleanAct = sanitizeSpeakerActivity(data.activity);
      entry.activity = cleanAct;
      if (!Array.isArray(entry.steps)) entry.steps = [];
      const lastStep = entry.steps[entry.steps.length - 1];
      if (cleanAct && (!lastStep || lastStep.text !== cleanAct)) {
        const elSec = Math.floor((Date.now() - (entry.startedAt || Date.now())) / 1000);
        entry.steps.push({ t: formatSpeakerDuration(elSec), text: cleanAct });
        if (entry.steps.length > 8) entry.steps.shift();
      }
    }
  }
  if (msgRoom !== (activeWarRoomId || 'general')) return;
  if (data.activity) activeSpeakerLiveActivity = sanitizeSpeakerActivity(data.activity);
  renderLiveWorkingCards(msgRoom);
  updateSpeakerTimerDisplay();
}

function syncSpeakerBannerVisibility() {
  const banner = document.getElementById('warroom-status-banner');
  if (!banner) return;
  const targetRoom = activeWarRoomId || 'general';
  const rMap = activeSpeakersByRoom.get(targetRoom);
  const isCurrentRoomSpeaking = Boolean((rMap && rMap.size > 0) || (activeSpeakingAgent && activeSpeakingRoomId === targetRoom));

  if (isCurrentRoomSpeaking) {
    banner.classList.remove('hidden');
    updateSpeakerTimerDisplay();
  } else {
    banner.classList.add('hidden');
  }
}

function updateSpeakerTimerDisplay() {
  const banner = document.getElementById('warroom-status-banner');
  const statusText = document.getElementById('warroom-status-text');
  const timerEl = document.getElementById('warroom-status-timer');
  const modeLbl = document.getElementById('warroom-status-mode-label');
  const chipsEl = document.getElementById('warroom-status-speakers');
  const targetRoom = activeWarRoomId || 'general';
  const rMap = activeSpeakersByRoom.get(targetRoom);
  const speakers = rMap ? Array.from(rMap.values()) : [];

  if (speakers.length === 0) {
    if (typeof isAgentTurnInFlight !== 'undefined' && isAgentTurnInFlight) {
      if (banner) banner.classList.remove('hidden');
      if (chipsEl) chipsEl.classList.add('hidden');
    } else {
      if (banner) banner.classList.add('hidden');
      if (chipsEl) chipsEl.classList.add('hidden');
      return;
    }
  }

  const now = Date.now();
  const primary = speakers[0] || {
    agent: activeSpeakingAgent || 'Conference Room',
    engine: activeSpeakingEngine || '',
    startedAt: speakerStartTime || now,
    timeoutSec: activeSpeakerTimeoutSec || 2700,
    activity: activeSpeakerLiveActivity || ''
  };
  const elapsedSec = Math.floor((now - primary.startedAt) / 1000);
  const ceilingSec = primary.timeoutSec || 2700;

  if (timerEl) {
    const remainingSec = Math.max(0, ceilingSec - elapsedSec);
    timerEl.innerText = `${formatSpeakerDuration(remainingSec)} left`;
    timerEl.title = `Time remaining before ${ceilingSec}s timeout (${remainingSec}s left)`;
    if (remainingSec <= 30) {
      timerEl.className = 'text-[10px] text-rose-300 font-mono bg-rose-950/80 px-1.5 py-0.2 rounded border border-rose-600/70 animate-pulse shrink-0';
    } else {
      timerEl.className = 'text-[10px] text-cyan-400/80 font-mono bg-cyan-900/60 px-1.5 py-0.2 rounded border border-cyan-600/50 shrink-0';
    }
  }

  if (speakers.length >= 2) {
    if (statusText) {
      statusText.innerText = `⚡ Parallel Swarm Active (${speakers.length} agents running concurrently)`;
    }
    if (modeLbl) modeLbl.innerText = 'SWARM PARALLEL';
    if (chipsEl) {
      chipsEl.classList.remove('hidden');
      const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      chipsEl.innerHTML = speakers.map(sp => {
        const spElapsed = Math.floor((now - sp.startedAt) / 1000);
        const phaseIdx = Math.min(Math.floor(spElapsed / 4), REASONING_PHASES.length - 1);
        const act = sanitizeSpeakerActivity(sp.activity) || REASONING_PHASES[phaseIdx];
        const engTag = sp.engine ? ` [${sp.engine.toUpperCase()}]` : '';
        return `
          <span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-slate-950/90 border border-cyan-600/50 text-[10px] font-mono text-cyan-200 max-w-full" title="${esc(sp.agent)}${esc(engTag)}: ${esc(act)}">
            <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shrink-0"></span>
            <strong class="text-white shrink-0">${esc(sp.agent)}</strong>
            <span class="text-cyan-400/80 truncate max-w-[160px] hidden sm:inline">${esc(act)}</span>
            <span class="text-slate-400 shrink-0">· ${formatSpeakerDuration(spElapsed)}</span>
          </span>
        `;
      }).join('');
    }
    return;
  }

  if (chipsEl) {
    chipsEl.classList.add('hidden');
    chipsEl.innerHTML = '';
  }
  if (modeLbl) {
    const spPhase = (primary.swarmPhase || '').toLowerCase();
    if (spPhase === 'plan') {
      modeLbl.innerText = '👑 PHASE 1: PLANNING';
      modeLbl.className = 'text-[9px] uppercase tracking-wider text-purple-300 font-bold font-mono shrink-0';
    } else if (spPhase === 'synthesis') {
      modeLbl.innerText = '🎯 PHASE 3: SYNTHESIZING';
      modeLbl.className = 'text-[9px] uppercase tracking-wider text-amber-300 font-bold font-mono shrink-0';
    } else {
      modeLbl.innerText = 'ACTIVE REASONING';
      modeLbl.className = 'text-[9px] uppercase tracking-wider text-cyan-400 font-bold font-mono shrink-0';
    }
  }

  // BL-EVO-27 & BL-UI-63: Strip redundant backend (Xs) telemetry so banner shows strictly 1 elapsed + 1 countdown timer
  const phaseIdx = Math.min(Math.floor(elapsedSec / 4), REASONING_PHASES.length - 1);
  const cleanLiveActivity = sanitizeSpeakerActivity(primary.activity || activeSpeakerLiveActivity);
  const currentActivity = cleanLiveActivity || REASONING_PHASES[phaseIdx];
  if (statusText) {
    const engLabel = primary.engine ? ` [${primary.engine.toUpperCase()}]` : '';
    const agLabel = primary.agent || 'Conference Room';
    statusText.innerText = `${agLabel}${engLabel}: ${currentActivity} · ${formatSpeakerDuration(elapsedSec)}`;
  }
}

function stopSpeakerHeartbeat(roomId = null, agentName = null) {
  const rid = roomId || activeSpeakingRoomId || activeWarRoomId || 'general';
  const rMap = activeSpeakersByRoom.get(rid);
  if (rMap) {
    if (!agentName || String(agentName).toLowerCase() === 'all') {
      rMap.clear();
    } else {
      rMap.delete(String(agentName).toLowerCase().trim());
    }
    if (rMap.size === 0) {
      activeSpeakersByRoom.delete(rid);
    }
  }
  _syncPrimarySpeakerFromMap(rid);

  // Check if ANY room still has active speakers before stopping the shared interval
  let anyActive = false;
  for (const m of activeSpeakersByRoom.values()) {
    if (m.size > 0) { anyActive = true; break; }
  }
  if (!anyActive && speakerTimerInterval) {
    clearInterval(speakerTimerInterval);
    speakerTimerInterval = null;
  }

  syncSpeakerBannerVisibility();
  renderLiveWorkingCards(rid);
  if (!activeSpeakersByRoom.has(rid)) {
    const card = document.getElementById('warroom-inline-live-activity');
    if (card) card.remove();
  }
  if (teamsStageActive) renderTeamsStageGrid();
}

window.openInviteAgentModal = async function() {
  const modal = document.getElementById('modal-invite-agent');
  if (!modal) return;
  modal.classList.remove('hidden');

  const activeList = document.getElementById('manage-agents-active-list');
  const availList = document.getElementById('invite-agent-list');
  if (activeList && !activeList.children.length) {
    activeList.innerHTML = '<div class="py-2 text-center text-[10px] font-mono text-slate-500">Loading active participants...</div>';
  }
  if (availList && !availList.children.length) {
    availList.innerHTML = '<div class="py-2 text-center text-[10px] font-mono text-slate-500">Loading fleet agents...</div>';
  }

  // Only await catalog if not yet loaded; otherwise render immediately and refresh in background
  const hasCatalog = window.engineModelsCatalog && Object.keys(window.engineModelsCatalog).length > 0;
  if (!hasCatalog && typeof window.loadEngineModelsCatalog === 'function') {
    await window.loadEngineModelsCatalog(false);
  }
  await renderManageAgentsModal();

  if (hasCatalog && typeof window.loadEngineModelsCatalog === 'function') {
    window.loadEngineModelsCatalog(true).then(() => {
      if (!modal.classList.contains('hidden')) {
        renderManageAgentsModal();
      }
    }).catch(() => {});
  }
};

window.renderManageAgentsModal = async function() {
  const activeList = document.getElementById('manage-agents-active-list');
  const availList = document.getElementById('invite-agent-list');
  const activeCount = document.getElementById('manage-agents-active-count');
  const availCount = document.getElementById('manage-agents-available-count');

  try {
    const targetRoom = activeWarRoomId || 'general';

    // Fetch room metadata, room participants, and global fleet pool in parallel
    const [roomRes, res, allFleetAgents] = await Promise.all([
      fetch('/api/war-room/rooms').catch(() => null),
      fetch(`/api/war-room/participants?room_id=${encodeURIComponent(targetRoom)}`).catch(() => null),
      fetchGlobalConferencePool(true).catch(() => [])
    ]);

    // Load Room info to get designated orchestrator and domain preset / WoW rules (BL-WAR-42 & BL-WAR-43)
    let currentRoomOrchestrator = null;
    let currentRoomPreset = 'general_conference';
    let currentRoomWoW = '';
    try {
      if (roomRes && roomRes.ok) {
        const rData = await roomRes.json();
        const thisRoom = (rData.rooms || []).find(r => r.id === targetRoom);
        if (thisRoom) {
          if (thisRoom.orchestrator) currentRoomOrchestrator = thisRoom.orchestrator;
          if (thisRoom.preset) currentRoomPreset = thisRoom.preset;
          if (thisRoom.wow_rules) currentRoomWoW = thisRoom.wow_rules;
        }
      }
    } catch (_) {}

    // Populate Domain Preset & WoW Rules in modal (BL-WAR-43)
    const presetSelect = document.getElementById('manage-agents-preset-select');
    const presetBadge = document.getElementById('manage-agents-preset-badge');
    const wowTextarea = document.getElementById('manage-agents-wow-text');
    if (presetSelect) presetSelect.value = currentRoomPreset || 'general_conference';
    if (presetBadge) {
      const pName = (currentRoomPreset || 'GENERAL').replace(/_/g, ' ').toUpperCase();
      presetBadge.innerText = pName;
    }
    if (wowTextarea && !wowTextarea._userEditing) {
      wowTextarea.value = currentRoomWoW || '';
    }

    // Parse fresh participants from backend to ensure immediate, accurate display
    let currentRoomParts = [];
    if (res && res.ok) {
      const data = await res.json();
      if (Array.isArray(data.participants)) {
        currentRoomParts = data.participants;
        warRoomParticipants = data.participants;
        const currentTab = consoleTabs.find(t => t.roomId === targetRoom);
        if (currentTab) currentTab.participants = data.participants.map(p => p.name.toLowerCase());
        renderWarRoomParticipantsRibbon();
        renderTeamsStageGrid();
      }
    }
    if (currentRoomParts.length === 0) {
      currentRoomParts = getEffectiveWarRoomParticipants();
    }

    // Render Orchestrator Selector (BL-WAR-42)
    const orchSelect = document.getElementById('manage-agents-orch-select');
    const orchBadge = document.getElementById('manage-agents-orch-badge');
    if (orchSelect) {
      let orchOpts = '<option value="">Default (System Dispatcher / Solaris)</option>';
      currentRoomParts.forEach(p => {
        const isSel = currentRoomOrchestrator && p.name.toLowerCase() === currentRoomOrchestrator.toLowerCase();
        orchOpts += `<option value="${p.name}" ${isSel ? 'selected' : ''}>👑 ${p.name} (${p.engine.toUpperCase()})</option>`;
      });
      orchSelect.innerHTML = orchOpts;
    }
    if (orchBadge) {
      if (currentRoomOrchestrator) {
        orchBadge.innerText = `👑 ${currentRoomOrchestrator.toUpperCase()} ACTIVE`;
        orchBadge.className = 'text-[8.5px] font-mono px-1.5 py-0.5 rounded font-bold uppercase bg-amber-950/90 text-amber-300 border border-amber-600';
      } else {
        orchBadge.innerText = 'SYSTEM DEFAULT';
        orchBadge.className = 'text-[8.5px] font-mono px-1.5 py-0.5 rounded font-bold uppercase bg-slate-900 text-slate-400 border border-slate-700';
      }
    }

    const currentNames = new Set(currentRoomParts.map(p => (p.name || p.id || '').toLowerCase()));

    // Render Active Participants Section
    if (activeList) {
      activeList.innerHTML = '';
      if (activeCount) activeCount.innerText = currentRoomParts.length;

      currentRoomParts.forEach(p => {
        const eng = (p.engine || 'hermes').toLowerCase();
        const engStyle = ENGINE_BADGE_STYLES[eng] || ENGINE_BADGE_STYLES.hermes;
        const canRemove = currentRoomParts.length > 1;
        const liveAgent = (typeof agents !== 'undefined' && Array.isArray(agents))
          ? agents.find(a => a.name.toLowerCase() === p.name.toLowerCase())
          : null;
        const currentModel = p.model || liveAgent?.model || (window.engineDefaultsMap ? window.engineDefaultsMap[eng] : '') || '';
        const catalog = (window.engineModelsCatalog && window.engineModelsCatalog[eng]) ? window.engineModelsCatalog[eng] : [];
        const hasRoomModel = Boolean(p.is_room_model);

        const isOrch = Boolean(currentRoomOrchestrator && p.name.toLowerCase() === currentRoomOrchestrator.toLowerCase());
        const shortCurrentLbl = window.formatShortModelName
          ? window.formatShortModelName(currentModel, eng)
          : (currentModel || 'Default');
        const safeNameAttr = p.name.replace(/'/g, "\\'");
        const safeModelAttr = String(currentModel || '').replace(/"/g, '&quot;');
        const row = document.createElement('div');
        row.className = `w-full flex items-center justify-between p-2 rounded-xl ${isOrch ? 'bg-amber-950/20 border-amber-500/50' : 'bg-slate-900/90 border-slate-800'} border text-left gap-2 transition`;
        row.innerHTML = `
          <div class="flex items-center gap-2.5 min-w-0 flex-1">
            <div class="w-6 h-6 rounded-lg bg-slate-800 border ${isOrch ? 'border-amber-500 text-amber-400' : 'border-slate-700 text-emerald-400'} flex items-center justify-center text-[10px] font-pixel shrink-0" style="color: ${isOrch ? '#f59e0b' : (p.color || '#10b981')}; border-color: ${isOrch ? '#f59e0b' : (p.color || '#334155')}">
              ${isOrch ? '👑' : p.name[0]}
            </div>
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-1.5 flex-wrap">
                <strong class="${isOrch ? 'text-amber-200' : 'text-white'} text-xs font-mono">${p.name}</strong>
                ${isOrch ? '<span class="text-[7.5px] font-mono px-1 py-0.2 rounded font-bold uppercase bg-amber-950 text-amber-300 border border-amber-600">[ORCHESTRATOR]</span>' : ''}
                <span class="text-[7.5px] font-mono px-1 py-0.2 rounded font-bold uppercase border ${engStyle}">[${eng.toUpperCase()}]</span>
                ${hasRoomModel ? '<span class="text-[7.5px] font-mono px-1 py-0.2 rounded font-bold uppercase bg-amber-950/80 text-amber-300 border border-amber-700/80" title="Room-specific model override active">[ROOM]</span>' : ''}
              </div>
              <span class="text-[9.5px] text-slate-400 truncate block">${p.role || 'Specialist Agent'}</span>
            </div>
          </div>

          <!-- Inline Custom NexusDesk Model Picker (Option A: Room-Scoped) -->
          <div class="flex items-center gap-1.5 shrink-0">
            <button type="button"
              data-model="${safeModelAttr}"
              onclick="openWarRoomModelPopover(this, '${safeNameAttr}', '${eng}')"
              title="Select Room LLM for ${p.name} (${safeModelAttr || 'Default'})"
              class="flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-mono rounded-lg bg-slate-950/90 border ${hasRoomModel ? 'border-amber-500/80 text-amber-300' : 'border-slate-700/90 text-cyan-300'} hover:border-cyan-400 hover:bg-slate-900 focus:outline-none transition cursor-pointer max-w-[155px] sm:max-w-[195px] shadow-inner">
              <span class="text-[10px] shrink-0">🧠</span>
              <span data-model-label class="truncate">${String(shortCurrentLbl).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</span>
              <span class="text-[8px] text-slate-400 shrink-0 ml-0.5">▾</span>
            </button>

            <button type="button" ${canRemove ? `onclick="executeRemoveAgent(this, '${safeNameAttr}')"` : 'disabled'} class="px-2 py-1 rounded text-[10px] font-mono font-bold transition shrink-0 ${canRemove ? 'bg-rose-950/80 hover:bg-rose-900 text-rose-300 border border-rose-800 cursor-pointer' : 'bg-slate-900 text-slate-600 border border-slate-800 cursor-not-allowed'}" title="${canRemove ? `Dismiss ${p.name} from room` : 'Minimum 1 agent required in room'}">
              ✕ Remove
            </button>
          </div>
        `;
        activeList.appendChild(row);
      });
    }

    // Filter Global Conference Pool for Available Fleet Section
    const availableToInvite = (Array.isArray(allFleetAgents) ? allFleetAgents : []).filter(a => {
      const nameMatch = currentNames.has((a.name || '').toLowerCase());
      const idMatch = currentNames.has((a.id || '').toLowerCase());
      return !nameMatch && !idMatch;
    });

    if (availList) {
      availList.innerHTML = '';
      if (availCount) availCount.innerText = availableToInvite.length;

      if (availableToInvite.length === 0) {
        availList.innerHTML = '<div class="py-3 text-center"><span class="text-base block mb-0.5">🎉</span><p class="text-xs text-slate-400 font-mono">All known cross-fleet specialists are currently in this conference.</p></div>';
      } else {
        availableToInvite.forEach(a => {
          const eng = (a.engine || 'hermes').toLowerCase();
          const engStyle = ENGINE_BADGE_STYLES[eng] || ENGINE_BADGE_STYLES.hermes;
          const fleetLbl = a.fleet || 'agents_bs';
          const row = document.createElement('div');
          row.className = 'w-full flex items-center justify-between p-2 rounded-xl bg-slate-900/90 hover:bg-slate-800/80 border border-slate-800 text-left transition';
          row.innerHTML = `
            <div class="flex items-center gap-2.5 min-w-0">
              <div class="w-6 h-6 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center text-[10px] font-pixel text-emerald-400 shrink-0" style="color: ${a.color || '#10b981'}; border-color: ${a.color || '#334155'}">
                ${a.name[0]}
              </div>
              <div class="min-w-0">
                <div class="flex items-center gap-1.5">
                  <strong class="text-white text-xs font-mono">${a.name}</strong>
                  <span class="text-[7.5px] font-mono px-1 py-0.2 rounded font-bold uppercase border ${engStyle}">[${eng.toUpperCase()}]</span>
                  <span class="text-[8.5px] font-mono text-slate-500">(${fleetLbl})</span>
                </div>
                <span class="text-[9.5px] text-slate-400 truncate block">${a.role || 'Specialist Agent'}</span>
              </div>
            </div>
            <button type="button" onclick="executeInviteAgent(this, '${a.name.replace(/'/g, "\\'")}')" class="px-2 py-1 rounded text-[10px] font-mono font-bold bg-emerald-950/80 hover:bg-emerald-900 text-emerald-300 border border-emerald-700/80 cursor-pointer transition shrink-0" title="Add ${a.name} to room">
              🤖 Add +
            </button>
          `;
          availList.appendChild(row);
        });
      }
    }
  } catch (err) {
    if (availList) availList.innerHTML = `<div class="py-3 text-center text-rose-400 text-xs font-mono">Failed to load specialists: ${err.message}</div>`;
  }
};

window.closeInviteAgentModal = function() {
  if (typeof window.closeNexusModelPopover === 'function') window.closeNexusModelPopover();
  const modal = document.getElementById('modal-invite-agent');
  if (modal) modal.classList.add('hidden');
};

window.executeInviteAgent = async function(btnEl, agentName) {
  if (btnEl) {
    btnEl.disabled = true;
    btnEl.innerText = 'Adding...';
  }
  try {
    const targetRoom = activeWarRoomId || 'general';
    const res = await fetch('/api/war-room/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ room_id: targetRoom, agent_name: agentName })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Failed to add agent');

    // Immediately re-render modal with fresh participant data
    await renderManageAgentsModal();
  } catch (e) {
    alert('Error adding agent: ' + e.message);
    if (btnEl) {
      btnEl.disabled = false;
      btnEl.innerText = '🤖 Add +';
    }
  }
};

window.changeWarRoomOrchestrator = async function(selectedAgent) {
  const targetRoom = activeWarRoomId || 'general';
  try {
    const res = await fetch(`/api/war-room/rooms/${encodeURIComponent(targetRoom)}/orchestrator`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        room_id: targetRoom,
        orchestrator: selectedAgent || null
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Failed to update orchestrator');

    // Refresh Manage Agents modal UI to reflect active badges
    await renderManageAgentsModal();
  } catch (err) {
    alert('Error setting room orchestrator: ' + err.message);
  }
};

window.clearWarRoomOrchestrator = async function() {
  await window.changeWarRoomOrchestrator('');
};

// ==============================================================
// BL-WAR-43: DOMAIN PRESET & WAY OF WORKING (WoW) HANDLERS
// ==============================================================
const PRESET_DEFAULT_WOW_SAMPLES = {
  coding_sprint: "# Collaborative Coding Sprint — Way of Working (WoW) Rules\n1. Test-Driven Verification: Run tests or syntax checks before declaring tasks done.\n2. Minimal surgical diffs: Preserve existing unrelated code.\n3. Phase Tagging: Prefix technical headers with [PROPOSAL], [IMPLEMENTATION], [QA_REVIEW], or [VERDICT].\n4. Fast 1-Turn Async Task Delegation: Heavy suites (>15s) delegate via <async_task>.",
  deep_research: "# Deep Multi-Perspective Research — Way of Working (WoW) Rules\n1. Evidence-Graded Sourcing: Grade confidence and cite sources.\n2. Quantitative First: Deliverable datasets (CSVs/Tables) saved in deliverables/.\n3. Devil's Advocate Gate: Actively challenge assumptions.\n4. No Relabeling: Never relabel partial or unmeasured data.",
  security_audit: "# SRE & Security Red-Teaming — Way of Working (WoW) Rules\n1. Dual-Team Protocol: Blue builds configs; Red probes race conditions & perms.\n2. Phase Tagging: [PROPOSAL], [IMPLEMENTATION], [QA_REVIEW], or [VERDICT].\n3. Immediate Fail-Fast on anomalous conditions.",
  executive_advisory: "# Executive Board & Pitch Deck — Way of Working (WoW) Rules\n1. Action Titles: Every slide/table must lead with a conclusive takeaway.\n2. Consulting Polish: Formatting, tables, and financial metrics adhere to board standards.\n3. Alignment: Decks and workbooks must match inventory counts.",
  general_conference: "# General Conference — Way of Working (WoW) Rules\n1. Concise Executive Summary in <executive_summary>.\n2. Tag peers explicitly with @Agent when delegating.\n3. Delegate heavy work (>15s or >3 items) via <async_task>."
};

window.onManageAgentsPresetChange = function(presetId) {
  const badge = document.getElementById('manage-agents-preset-badge');
  if (badge) {
    badge.innerText = (presetId || 'GENERAL').replace(/_/g, ' ').toUpperCase();
  }
  const wowText = document.getElementById('manage-agents-wow-text');
  if (wowText && !wowText.value.trim()) {
    wowText.value = PRESET_DEFAULT_WOW_SAMPLES[presetId] || '';
  }
};

window.resetRoomWoWToPresetDefault = function() {
  const presetSelect = document.getElementById('manage-agents-preset-select');
  const pid = presetSelect ? presetSelect.value : 'general_conference';
  const wowText = document.getElementById('manage-agents-wow-text');
  if (wowText) {
    wowText.value = PRESET_DEFAULT_WOW_SAMPLES[pid] || '';
    wowText._userEditing = false;
  }
};

window.saveRoomPresetAndWoW = async function() {
  const targetRoom = activeWarRoomId || 'general';
  const presetSelect = document.getElementById('manage-agents-preset-select');
  const wowText = document.getElementById('manage-agents-wow-text');
  const preset = presetSelect ? presetSelect.value : 'general_conference';
  const wowRules = wowText ? wowText.value.trim() : '';

  try {
    const res = await fetch(`/api/war-room/rooms/${encodeURIComponent(targetRoom)}/preset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        room_id: targetRoom,
        preset: preset,
        wow_rules: wowRules
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Failed to save preset and WoW rules');
    alert(`✅ Updated room to preset "${preset.replace(/_/g, ' ').toUpperCase()}" with active WoW rules.`);
    if (wowText) wowText._userEditing = false;
    await renderManageAgentsModal();
  } catch (err) {
    alert('Error updating preset/WoW rules: ' + err.message);
  }
};

const MODEL_BADGE_STYLES = {
  DEFAULT: 'bg-emerald-950/90 text-emerald-300 border-emerald-700/70',
  FRONTIER: 'bg-amber-950/90 text-amber-300 border-amber-700/70',
  REASONING: 'bg-purple-950/90 text-purple-300 border-purple-700/70',
  HEAVY: 'bg-rose-950/90 text-rose-300 border-rose-700/70',
  FAST: 'bg-sky-950/90 text-sky-300 border-sky-700/70',
  SPEED: 'bg-sky-950/90 text-sky-300 border-sky-700/70',
  LIVE: 'bg-cyan-950/90 text-cyan-300 border-cyan-700/70',
  FREE: 'bg-teal-950/90 text-teal-300 border-teal-700/70',
  CODING: 'bg-indigo-950/90 text-indigo-300 border-indigo-700/70',
  OPEN: 'bg-slate-800 text-slate-300 border-slate-600',
  CUSTOM: 'bg-slate-800 text-slate-300 border-slate-600'
};

let _activeModelPopoverCleanup = null;

window.closeNexusModelPopover = function() {
  const existing = document.getElementById('nexus-model-popover');
  if (existing) existing.remove();
  if (_activeModelPopoverCleanup) {
    _activeModelPopoverCleanup();
    _activeModelPopoverCleanup = null;
  }
};

window.openWarRoomModelPopover = function(triggerBtn, agentName, engine) {
  const existing = document.getElementById('nexus-model-popover');
  if (existing && existing._triggerBtn === triggerBtn) {
    window.closeNexusModelPopover();
    return;
  }
  window.closeNexusModelPopover();

  const eng = (engine || 'hermes').toLowerCase();
  const currentModel = (triggerBtn?.dataset?.model || '').trim();
  const rawCatalog = (window.engineModelsCatalog && window.engineModelsCatalog[eng]) ? window.engineModelsCatalog[eng] : [];
  const items = rawCatalog.map(m => ({ ...m }));
  if (currentModel && !items.some(m => m.id.toLowerCase() === currentModel.toLowerCase())) {
    items.unshift({ id: currentModel, label: currentModel, provider: 'Custom', badge: 'CUSTOM' });
  }
  if (items.length === 0) {
    items.push({ id: currentModel || 'default', label: currentModel || 'Default', provider: eng.toUpperCase(), badge: 'DEFAULT' });
  }

  const pop = document.createElement('div');
  pop.id = 'nexus-model-popover';
  pop._triggerBtn = triggerBtn;
  pop.className = 'nexus-popover-menu fixed z-[9999] w-[320px] sm:w-[360px] overflow-hidden flex flex-col';

  const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const engBadgeCls = ENGINE_BADGE_STYLES[eng] || ENGINE_BADGE_STYLES.hermes;

  pop.innerHTML = `
    <div class="px-3 py-2 border-b border-slate-800/90 bg-[#0f1621] flex items-center justify-between gap-2">
      <div class="flex items-center gap-1.5 min-w-0">
        <span class="text-xs">🧠</span>
        <span class="text-[11px] font-mono font-bold text-slate-200 truncate">${esc(agentName)}</span>
        <span class="text-[8px] font-mono px-1.5 py-0.5 rounded font-bold uppercase border ${engBadgeCls}">${esc(eng.toUpperCase())}</span>
      </div>
      <span class="text-[9px] font-mono text-slate-500">${items.length} models</span>
    </div>
    ${items.length > 6 ? `
      <div class="px-2.5 py-1.5 border-b border-slate-800/80 bg-slate-950/70">
        <input id="nexus-model-search" type="text" placeholder="Filter models (e.g. neon, opus, flash)..." class="w-full px-2.5 py-1 text-[11px] font-mono bg-slate-900/90 border border-slate-700/80 rounded-lg text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500/80" />
      </div>
    ` : ''}
    <div id="nexus-model-list" class="max-h-64 overflow-y-auto custom-scrollbar p-1.5 space-y-0.5"></div>
  `;

  document.body.appendChild(pop);

  const listEl = pop.querySelector('#nexus-model-list');
  const renderItems = (filterText = '') => {
    const q = filterText.trim().toLowerCase();
    const filtered = q
      ? items.filter(m =>
          (m.id || '').toLowerCase().includes(q) ||
          (m.label || '').toLowerCase().includes(q) ||
          (m.badge || '').toLowerCase().includes(q)
        )
      : items;

    if (filtered.length === 0) {
      listEl.innerHTML = '<div class="py-4 text-center text-[10.5px] font-mono text-slate-500">No matching models.</div>';
      return;
    }

    listEl.innerHTML = '';
    filtered.forEach(m => {
      const isSelected = currentModel && m.id.toLowerCase() === currentModel.toLowerCase();
      const badgeCls = MODEL_BADGE_STYLES[(m.badge || '').toUpperCase()] || 'bg-slate-800 text-slate-400 border-slate-700';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg text-left transition cursor-pointer ${
        isSelected
          ? 'bg-cyan-950/60 border border-cyan-500/40 text-cyan-100'
          : 'hover:bg-slate-800/80 border border-transparent text-slate-200'
      }`;
      btn.innerHTML = `
        <div class="flex items-start gap-2 min-w-0 flex-1">
          <span class="text-[11px] mt-0.5 shrink-0 ${isSelected ? 'text-cyan-400 font-bold' : 'text-transparent'}">✓</span>
          <div class="min-w-0 flex-1">
            <div class="text-[11px] font-medium leading-snug ${isSelected ? 'text-cyan-200' : 'text-slate-100'}">${esc(m.label || m.id)}</div>
            <div class="text-[9.5px] font-mono text-slate-500 truncate">${esc(m.id)}</div>
          </div>
        </div>
        ${m.badge ? `<span class="text-[8px] font-mono px-1.5 py-0.5 rounded font-bold uppercase border shrink-0 ${badgeCls}">${esc(m.badge)}</span>` : ''}
      `;
      btn.addEventListener('click', () => {
        window.closeNexusModelPopover();
        window.changeWarRoomAgentModel(triggerBtn, agentName, eng, m.id);
      });
      listEl.appendChild(btn);
    });
  };

  renderItems('');

  // Position cleanly within viewport
  const rect = triggerBtn.getBoundingClientRect();
  const popW = Math.min(360, window.innerWidth - 16);
  pop.style.width = `${popW}px`;
  const popH = Math.min(pop.offsetHeight || 320, window.innerHeight - 24);
  const left = Math.max(8, Math.min(rect.right - popW, window.innerWidth - popW - 8));
  const spaceBelow = window.innerHeight - rect.bottom - 12;
  const top = (spaceBelow >= Math.min(popH, 220) || spaceBelow >= rect.top)
    ? Math.min(rect.bottom + 6, window.innerHeight - popH - 8)
    : Math.max(8, rect.top - popH - 6);
  pop.style.left = `${left}px`;
  pop.style.top = `${top}px`;

  const searchInput = pop.querySelector('#nexus-model-search');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => renderItems(e.target.value));
    setTimeout(() => searchInput.focus(), 20);
  }

  const onDocClick = (e) => {
    if (!pop.contains(e.target) && !triggerBtn.contains(e.target)) {
      window.closeNexusModelPopover();
    }
  };
  const onKeyDown = (e) => {
    if (e.key === 'Escape') window.closeNexusModelPopover();
  };
  setTimeout(() => {
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKeyDown);
  }, 0);

  _activeModelPopoverCleanup = () => {
    document.removeEventListener('mousedown', onDocClick);
    document.removeEventListener('keydown', onKeyDown);
  };
};

window.changeWarRoomAgentModel = async function(selectEl, agentName, engine, explicitModel = null) {
  const newModel = explicitModel || (selectEl ? selectEl.value : '');
  if (!agentName || !newModel) return;

  const targetRoom = activeWarRoomId || 'general';
  if (selectEl) selectEl.disabled = true;

  try {
    const res = await fetch(`/api/war-room/rooms/${encodeURIComponent(targetRoom)}/agent-model`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        room_id: targetRoom,
        agent_name: agentName,
        model: newModel,
        scope: 'room'
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Failed to update model');

    // Update trigger button dataset & visible label if custom button
    if (selectEl && selectEl.dataset) {
      selectEl.dataset.model = newModel;
      selectEl.title = `Select Room LLM for ${agentName} (${newModel})`;
      const lblEl = selectEl.querySelector('[data-model-label]');
      if (lblEl) {
        lblEl.innerText = window.formatShortModelName ? window.formatShortModelName(newModel, engine) : newModel;
      }
    }

    // Update local memory participants
    if (Array.isArray(warRoomParticipants)) {
      const wp = warRoomParticipants.find(p => p.name.toLowerCase() === agentName.toLowerCase() || p.id.toLowerCase() === agentName.toLowerCase());
      if (wp) {
        wp.model = newModel;
        wp.is_room_model = (targetRoom !== 'general');
      }
    }

    // Re-render war room ribbon and stage avatars
    renderWarRoomParticipantsRibbon();
    renderTeamsStageGrid();

    // Visual flash confirmation on trigger element
    if (selectEl) {
      selectEl.classList.remove('border-slate-700/90', 'border-amber-500/80');
      selectEl.classList.add('border-emerald-500', 'text-emerald-300');
      setTimeout(() => {
        if (selectEl) {
          selectEl.disabled = false;
          selectEl.classList.remove('border-emerald-500', 'text-emerald-300');
          selectEl.classList.add(targetRoom !== 'general' ? 'border-amber-500/80' : 'border-slate-700/90');
        }
      }, 600);
    }
  } catch (err) {
    alert('Error changing agent model: ' + err.message);
    if (selectEl) selectEl.disabled = false;
  }
};

window.executeRemoveAgent = async function(btnEl, agentName) {
  if (btnEl) {
    btnEl.disabled = true;
    btnEl.innerText = 'Removing...';
  }
  try {
    const targetRoom = activeWarRoomId || 'general';
    const res = await fetch('/api/war-room/remove-agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ room_id: targetRoom, agent_name: agentName })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Failed to remove agent');

    // Immediately re-render modal with fresh participant data
    await renderManageAgentsModal();
  } catch (e) {
    alert('Error removing agent: ' + e.message);
    if (btnEl) {
      btnEl.disabled = false;
      btnEl.innerText = '✕ Remove';
    }
  }
};

function insertWarRoomMention(name) {
  const input = document.getElementById('warroom-text-input');
  if (!input) return;
  const mention = `@${name} `;
  if (!input.value.toLowerCase().includes(`@${name.toLowerCase()}`)) {
    input.value = input.value ? `${input.value.trim()} ${mention}` : mention;
  }
  const popover = document.getElementById('warroom-mention-popover');
  if (popover) popover.classList.add('hidden');
  input.focus();
}
