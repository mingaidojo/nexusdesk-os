/**
 * @module chat/war_room_rooms.js
 * @description War Room Room Lifecycle & Participants Ribbon.
 * Handles new room creation modal, room listing/loading, effective participant
 * resolution, and participant ribbon rendering.
 *
 * Part of the Console & War Room chat subsystem (concatenated globally by frontend/build.py).
 */

function toggleNewRoomDropdown() {
  const modal = document.getElementById('modal-new-room-picker');
  if (modal) {
    modal.classList.remove('hidden');
    return;
  }
  const dd = document.getElementById('new-room-dropdown');
  if (!dd) return;
  dd.classList.toggle('hidden');
}

function closeNewRoomModal() {
  const modal = document.getElementById('modal-new-room-picker');
  if (modal) modal.classList.add('hidden');
  const dd = document.getElementById('new-room-dropdown');
  if (dd) dd.classList.add('hidden');
}

function createNewDirectChatTabPrompt() {
  closeNewRoomModal();

  const agentListStr = (typeof agents !== 'undefined' && Array.isArray(agents) && agents.length > 0)
    ? agents.map(a => a.name).join(', ')
    : 'Solaris, Claude, Scribe, Pylon';

  const chosen = prompt(`Enter Agent name for new 1-on-1 Chat Tab:\nAvailable: ${agentListStr}`, (selectedAgent ? selectedAgent.name : 'Solaris'));
  if (!chosen || !chosen.trim()) return;
  const cleanName = chosen.trim();

  const existing = consoleTabs.find(t => t.type === 'direct' && t.agent && t.agent.toLowerCase() === cleanName.toLowerCase());
  if (existing) {
    activateConsoleTab(existing.id);
    return;
  }

  const newTabId = 'tab-direct-' + Date.now();
  const newTab = {
    id: newTabId,
    type: 'direct',
    title: `1-on-1: ${cleanName}`,
    agent: cleanName,
    closable: true
  };
  consoleTabs.push(newTab);
  activateConsoleTab(newTabId);
}

let globalConferencePool = [];

async function fetchGlobalConferencePool(forceRefresh = false) {
  if (!forceRefresh && Array.isArray(globalConferencePool) && globalConferencePool.length > 0) {
    return globalConferencePool;
  }
  try {
    // Explicitly request general conference panel to get complete 11-agent fleet
    const res = await fetch('/api/war-room/participants?room_id=general');
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.participants) && data.participants.length > 0) {
        globalConferencePool = data.participants;
        return globalConferencePool;
      }
    }
  } catch (e) {
    console.warn('Could not fetch global conference pool:', e);
  }
  // Fallback to active agents in memory if available
  if (typeof agents !== 'undefined' && Array.isArray(agents) && agents.length > 0) {
    return agents;
  }
  return globalConferencePool.length > 0 ? globalConferencePool : getEffectiveWarRoomParticipants();
}

async function createNewWarRoomTabPrompt() {
  closeNewRoomModal();
  const modal = document.getElementById('modal-create-warroom');
  if (!modal) {
    // Fallback if modal element is missing
    const name = prompt('Enter a name or topic for the new War Room:', `Discussion ${consoleTabs.filter(t => t.type === 'warroom').length + 1}`);
    if (!name || !name.trim()) return;
    await executeCreateWarRoomRequest(name.trim(), name.trim(), ['solaris', 'claude', 'agy']);
    return;
  }

  const nameInput = document.getElementById('create-warroom-name-input');
  const topicInput = document.getElementById('create-warroom-topic-input');
  const searchInput = document.getElementById('create-warroom-search-input');
  const nextNum = consoleTabs.filter(t => t.type === 'warroom').length + 1;
  if (nameInput) nameInput.value = `Discussion ${nextNum}`;
  if (topicInput) topicInput.value = '';
  if (searchInput) searchInput.value = '';

  modal.classList.remove('hidden');
  if (nameInput) {
    setTimeout(() => { nameInput.focus(); nameInput.select(); }, 50);
  }

  const pool = await fetchGlobalConferencePool(true);
  renderCreateWarRoomParticipantsList(pool, ['solaris', 'claude', 'agy']);
}

window.closeCreateWarRoomModal = function() {
  const modal = document.getElementById('modal-create-warroom');
  if (modal) modal.classList.add('hidden');
};

let cachedCreateWarRoomPool = [];

function renderCreateWarRoomParticipantsList(pool, defaultSelectedIds = ['solaris', 'claude', 'agy']) {
  const container = document.getElementById('create-warroom-participants-list');
  if (!container) return;
  container.innerHTML = '';
  cachedCreateWarRoomPool = Array.isArray(pool) ? pool : [];

  if (!cachedCreateWarRoomPool.length) {
    container.innerHTML = '<p class="text-xs text-slate-400 font-mono py-4 col-span-2 text-center">No specialists discovered.</p>';
    return;
  }

  const selSet = new Set((defaultSelectedIds || []).map(x => x.toLowerCase()));

  cachedCreateWarRoomPool.forEach(p => {
    const pid = (p.id || p.name || '').toLowerCase();
    const isChecked = selSet.has(pid) || selSet.has((p.name || '').toLowerCase());
    const eng = (p.engine || 'hermes').toLowerCase();
    const engStyle = ENGINE_BADGE_STYLES[eng] || ENGINE_BADGE_STYLES.hermes;
    const color = p.color || '#06b6d4';
    const fleetLbl = p.fleet || 'agents_bs';

    const row = document.createElement('label');
    row.dataset.agentName = (p.name || '').toLowerCase();
    row.dataset.agentEngine = eng;
    row.dataset.agentRole = (p.role || '').toLowerCase();
    row.className = `create-warroom-agent-card flex items-center gap-2 p-2 rounded-lg border cursor-pointer select-none text-xs transition ${isChecked ? 'border-cyan-600/80 bg-slate-900 shadow-sm' : 'border-slate-800 bg-slate-900/60 hover:border-slate-700'}`;
    row.innerHTML = `
      <input type="checkbox" value="${p.id || p.name.toLowerCase()}" data-fleet="${fleetLbl}" data-engine="${eng}" onchange="updateCreateWarRoomSelectionCount()" class="create-warroom-cb rounded text-cyan-600 focus:ring-cyan-500 accent-cyan-500 cursor-pointer" ${isChecked ? 'checked' : ''} />
      <div class="w-5 h-5 rounded flex items-center justify-center text-[9px] font-pixel font-bold shrink-0" style="background: ${color}22; border: 1px solid ${color}; color: ${color};">${p.name[0]}</div>
      <div class="flex-1 min-w-0">
        <div class="text-slate-100 font-bold font-mono text-[11px] truncate flex items-center gap-1">
          <span>${p.name}</span>
          <span class="text-[8px] text-slate-400 font-normal">(${fleetLbl})</span>
        </div>
        <div class="text-[9px] text-slate-400 font-mono truncate">${p.role || 'Specialist'}</div>
      </div>
      <span class="text-[8px] font-mono px-1.5 py-0.5 rounded font-bold uppercase border shrink-0 ${engStyle}">[${eng.toUpperCase()}]</span>
    `;
    container.appendChild(row);
  });

  updateCreateWarRoomSelectionCount();
}

window.filterCreateWarRoomAgents = function(query) {
  const q = (query || '').toLowerCase().trim();
  const cards = document.querySelectorAll('.create-warroom-agent-card');
  cards.forEach(card => {
    const name = card.dataset.agentName || '';
    const engine = card.dataset.agentEngine || '';
    const role = card.dataset.agentRole || '';
    const matches = !q || name.includes(q) || engine.includes(q) || role.includes(q);
    card.classList.toggle('hidden', !matches);
  });
};

window.updateCreateWarRoomSelectionCount = function() {
  const cbs = Array.from(document.querySelectorAll('.create-warroom-cb'));
  const checkedCount = cbs.filter(cb => cb.checked).length;
  const badge = document.getElementById('create-warroom-selected-count');
  if (badge) {
    badge.innerText = `${checkedCount} selected`;
    badge.className = checkedCount >= 1
      ? 'px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800 text-[10px] font-mono font-bold'
      : 'px-2 py-0.5 rounded bg-rose-950 text-rose-300 border border-rose-800 text-[10px] font-mono font-bold';
  }
  cbs.forEach(cb => {
    const label = cb.closest('label');
    if (label) {
      if (cb.checked) {
        label.classList.add('border-cyan-600/80', 'bg-slate-900');
        label.classList.remove('border-slate-800', 'bg-slate-900/60');
      } else {
        label.classList.remove('border-cyan-600/80', 'bg-slate-900');
        label.classList.add('border-slate-800', 'bg-slate-900/60');
      }
    }
  });
};

window.selectCreateWarRoomPreset = function(preset) {
  const cbs = Array.from(document.querySelectorAll('.create-warroom-cb'));
  const coreIds = ['solaris', 'claude', 'agy'];
  const codingIds = ['claude', 'agy', 'opencode', 'codex'];

  cbs.forEach(cb => {
    const val = (cb.value || '').toLowerCase();
    const fleet = (cb.getAttribute('data-fleet') || '').toLowerCase();
    const eng = (cb.getAttribute('data-engine') || '').toLowerCase();

    if (preset === 'core') {
      cb.checked = coreIds.includes(val);
    } else if (preset === 'coding') {
      cb.checked = codingIds.includes(val) || ['claude', 'agy', 'opencode', 'codex'].includes(eng);
    } else if (preset === 'biblestory') {
      cb.checked = fleet === 'agents_bs';
    } else if (preset === 'all') {
      cb.checked = true;
    }
  });
  updateCreateWarRoomSelectionCount();
};

window.onCreateWarRoomDomainPresetChange = function(presetId) {
  const wtCb = document.getElementById('create-warroom-worktree-cb');
  if (presetId === 'coding_sprint') {
    if (wtCb) wtCb.checked = true;
    selectCreateWarRoomPreset('coding');
  } else if (presetId === 'deep_research') {
    if (wtCb) wtCb.checked = false;
    selectCreateWarRoomPreset('core');
  } else if (presetId === 'security_audit') {
    if (wtCb) wtCb.checked = false;
    const cbs = Array.from(document.querySelectorAll('.create-warroom-cb'));
    const secIds = ['pylon', 'claude', 'codex', 'solaris'];
    cbs.forEach(cb => { cb.checked = secIds.includes((cb.value || '').toLowerCase()); });
    updateCreateWarRoomSelectionCount();
  } else {
    if (wtCb) wtCb.checked = false;
    selectCreateWarRoomPreset('core');
  }
};

window.submitCreateWarRoomModal = async function() {
  const nameInput = document.getElementById('create-warroom-name-input');
  const topicInput = document.getElementById('create-warroom-topic-input');
  const presetSelect = document.getElementById('create-warroom-preset-select');
  const wtCb = document.getElementById('create-warroom-worktree-cb');

  const cleanName = (nameInput ? nameInput.value.trim() : '') || `Discussion ${consoleTabs.filter(t => t.type === 'warroom').length + 1}`;
  const cleanTopic = (topicInput ? topicInput.value.trim() : '') || cleanName;
  const presetId = presetSelect ? presetSelect.value : 'general_conference';
  const worktreeIso = wtCb ? !!wtCb.checked : false;

  const selectedParticipants = Array.from(document.querySelectorAll('.create-warroom-cb:checked')).map(cb => cb.value);
  if (selectedParticipants.length === 0) {
    alert('Please select at least 1 participant for the War Room.');
    return;
  }

  closeCreateWarRoomModal();
  await executeCreateWarRoomRequest(cleanName, cleanTopic, selectedParticipants, presetId, worktreeIso);
};

async function executeCreateWarRoomRequest(cleanName, cleanTopic, participantsList, presetId = 'general_conference', worktreeIso = false) {
  try {
    const res = await fetch('/api/war-room/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: cleanName,
        topic: cleanTopic,
        room_type: 'warroom',
        preset: presetId,
        worktree_isolation: worktreeIso,
        participants: participantsList
      })
    });
    const data = await res.json();
    const createdRoom = data.room || { id: 'room_' + Date.now(), name: cleanName };

    const newTabId = 'tab-warroom-' + createdRoom.id;
    const newTab = {
      id: newTabId,
      type: 'warroom',
      title: `War Room: ${createdRoom.name}`,
      roomId: createdRoom.id,
      closable: true
    };
    consoleTabs.push(newTab);
    activateConsoleTab(newTabId);
  } catch (e) {
    alert('Failed to create new War Room: ' + e);
  }
}

async function closeConsoleTab(tabId) {
  const tabIndex = consoleTabs.findIndex(t => t.id === tabId);
  if (tabIndex === -1) return;
  const tab = consoleTabs[tabIndex];
  if (!tab.closable) return;

  if (tab.type === 'warroom' && tab.roomId && tab.roomId !== 'general') {
    try {
      fetch(`/api/war-room/rooms/${encodeURIComponent(tab.roomId)}`, { method: 'DELETE' }).catch(() => {});
    } catch (_) {}
  }

  const wasActive = tab.id === activeConsoleTabId;
  consoleTabs.splice(tabIndex, 1);

  if (wasActive) {
    const fallback = consoleTabs[Math.max(0, tabIndex - 1)] || consoleTabs[0];
    if (fallback) {
      activateConsoleTab(fallback.id);
      return;
    }
  }
  renderConsoleTabs();
}

async function loadWarRoomRooms() {
  try {
    const res = await fetch('/api/war-room/rooms');
    const data = await res.json();
    if (data.rooms && Array.isArray(data.rooms)) {
      data.rooms.forEach(r => {
        const existing = consoleTabs.find(t => t.roomId === r.id);
        if (existing) {
          if (r.participants) existing.participants = r.participants;
        } else if (r.id !== 'general') {
          consoleTabs.push({
            id: 'tab-warroom-' + r.id,
            type: 'warroom',
            title: `War Room: ${r.name}`,
            roomId: r.id,
            participants: r.participants || null,
            closable: true
          });
        }
      });
      renderConsoleTabs();
    }
  } catch (e) {
    console.warn('Failed to load war room list:', e);
  }
}

// Build guaranteed non-empty list of War Room participants (BL-WAR-16: Whitelist-enforced)
function getEffectiveWarRoomParticipants() {
  // BL-WAR-16: If in a specific room (not 'general'), strictly return warRoomParticipants for this room.
  // Do NOT fall back to the 12-agent fleet or uninvited specialists!
  if (activeWarRoomId && activeWarRoomId !== 'general') {
    if (Array.isArray(warRoomParticipants) && warRoomParticipants.length > 0) {
      return warRoomParticipants;
    }
    // If the room participants haven't finished loading over HTTP yet, check if tab has cached list
    const activeTab = consoleTabs.find(t => t.roomId === activeWarRoomId);
    if (activeTab && Array.isArray(activeTab.participants) && activeTab.participants.length > 0) {
      const names = new Set(activeTab.participants.map(n => n.toLowerCase()));
      const subset = (typeof agents !== 'undefined' && Array.isArray(agents))
        ? agents.filter(a => names.has(a.name.toLowerCase()) || names.has((a.id || '').toLowerCase()))
        : [];
      if (subset.length > 0) return subset;
    }
    // Return default boardroom panel while loading to prevent 12-agent flash
    return [
      { id: 'solaris', name: 'Solaris', role: 'Executive Chief of Staff & Strategic Orchestrator', engine: 'hermes', color: '#10b981', fleet: 'agents_bs' },
      { id: 'claude', name: 'Claude', role: 'Architect & Systems Engineering Specialist', engine: 'claude', color: '#f59e0b', fleet: 'freecoder' },
      { id: 'agy', name: 'Agy', role: 'Research & Antigravity Autonomy Specialist', engine: 'agy', color: '#0284c7', fleet: 'myvirtualcoder' }
    ];
  }

  const merged = [];
  const seen = new Set();

  // 1. Include backend-discovered participants if loaded
  if (Array.isArray(warRoomParticipants) && warRoomParticipants.length > 0) {
    warRoomParticipants.forEach(p => {
      const pid = (p.id || p.name || '').toLowerCase();
      if (pid && !seen.has(pid)) {
        seen.add(pid);
        merged.push(p);
      }
    });
  }

  // 2. Default fallback core boardroom panel (only used if room participants not yet loaded)
  const defaultSpecialists = [
    { id: 'solaris', name: 'Solaris', role: 'Executive Chief of Staff & Strategic Orchestrator', engine: 'hermes', color: '#10b981', fleet: 'agents_bs' },
    { id: 'claude', name: 'Claude', role: 'Architect & Systems Engineering Specialist', engine: 'claude', color: '#f59e0b', fleet: 'freecoder' },
    { id: 'agy', name: 'Agy', role: 'Research & Antigravity Autonomy Specialist', engine: 'agy', color: '#0284c7', fleet: 'myvirtualcoder' }
  ];
  defaultSpecialists.forEach(sp => {
    if (!seen.has(sp.id)) {
      seen.add(sp.id);
      merged.push(sp);
    }
  });

  return merged;
}

let warRoomParticipantsFetchController = null;

async function loadWarRoomParticipants() {
  const targetRoom = activeWarRoomId || 'general';
  if (warRoomParticipantsFetchController) {
    try { warRoomParticipantsFetchController.abort(); } catch (_) {}
  }
  warRoomParticipantsFetchController = new AbortController();

  try {
    const res = await fetch(`/api/war-room/participants?room_id=${encodeURIComponent(targetRoom)}`, {
      signal: warRoomParticipantsFetchController.signal
    });
    if (res.ok) {
      const data = await res.json();
      // Ensure response matches the active room (avoid race condition if user clicked another tab)
      if (targetRoom === (activeWarRoomId || 'general') && Array.isArray(data.participants)) {
        warRoomParticipants = data.participants;
        const currentTab = consoleTabs.find(t => t.roomId === targetRoom);
        if (currentTab) currentTab.participants = data.participants.map(p => p.name.toLowerCase());
      }
    }
  } catch (e) {
    if (e.name !== 'AbortError') {
      console.error('Failed to load war room participants:', e);
    }
  }

  renderWarRoomParticipantsRibbon();
  renderWarRoomMentionHelpers();
  populateRoundTablePanelists();
  renderTeamsStageGrid();
}

function renderWarRoomParticipantsRibbon() {
  const container = document.getElementById('warroom-participants-chips');
  if (!container) return;
  container.innerHTML = '';

  // BL-CHAT-25: Direct Collective & Operator Omnidirectional Mention Chips at the start of Ribbon
  const specialTags = [
    { tag: 'everyone', label: '👥 @everyone', cls: 'bg-indigo-950/90 hover:bg-indigo-900 text-indigo-300 border-indigo-700/70 hover:border-indigo-500', title: 'Broadcast to all core War Room panelists' },
    { tag: 'everyagents', label: '🤖 @everyagents', cls: 'bg-purple-950/90 hover:bg-purple-900 text-purple-300 border-purple-700/70 hover:border-purple-500', title: 'Consult every active specialist agent in sequence' },
    { tag: 'user', label: '👤 @user', cls: 'bg-emerald-950/90 hover:bg-emerald-900 text-emerald-300 border-emerald-700/70 hover:border-emerald-500', title: 'Tag Human Operator (@user / @Min)' }
  ];

  specialTags.forEach(sp => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.onclick = () => insertWarRoomMention(sp.tag);
    chip.title = sp.title;
    chip.className = `px-2 py-0.5 rounded border text-[10px] font-mono font-bold transition flex items-center gap-1 cursor-pointer shrink-0 select-none ${sp.cls}`;
    chip.innerHTML = `<span>${sp.label}</span>`;
    container.appendChild(chip);
  });

  const sep = document.createElement('span');
  sep.className = 'text-slate-700 text-[10px] px-0.5 shrink-0 select-none';
  sep.innerText = '|';
  container.appendChild(sep);

  const participants = getEffectiveWarRoomParticipants();
  participants.forEach(p => {
    const eng = (p.engine || 'hermes').toLowerCase();
    const engStyle = ENGINE_BADGE_STYLES[eng] || ENGINE_BADGE_STYLES.hermes;
    const color = p.color || '#06b6d4';
    const liveAgent = (typeof agents !== 'undefined' && Array.isArray(agents))
      ? agents.find(a => a.name.toLowerCase() === p.name.toLowerCase())
      : null;
    const isWorking = liveAgent && liveAgent.state === 'working';
    const currentModel = p.model || liveAgent?.model || window.engineDefaultsMap[eng] || '';
    const shortModel = formatShortModelName(currentModel, eng);
    const safeName = p.name.replace(/'/g, "\\'");
    const safeModel = (currentModel || '').replace(/'/g, "\\'");
    const safeFleet = (p.fleet || 'agents_bs').replace(/'/g, "\\'");

    const chipGroup = document.createElement('div');
    chipGroup.className = 'inline-flex items-center rounded-lg bg-slate-900/95 border border-slate-800 hover:border-cyan-500/80 transition select-none shrink-0 shadow-sm overflow-hidden';

    const hasRoomModel = Boolean(p.is_room_model);
    const modelBadgeLabel = hasRoomModel ? `[RM] ${shortModel}` : shortModel;
    const modelBtnTitle = hasRoomModel 
      ? `Room-Specific LLM (${currentModel}) — Click to change`
      : `LLM: ${currentModel || 'Default'} — Click to customize`;
    const modelBtnBorder = hasRoomModel ? 'border-amber-500/80 text-amber-300' : 'border-slate-800 text-cyan-300';

    chipGroup.innerHTML = `
      <button type="button" onclick="insertWarRoomMention('${safeName}')" class="flex items-center gap-1.5 px-2 py-0.5 hover:bg-slate-800/90 cursor-pointer transition" title="${p.name} [${eng.toUpperCase()}] • ${p.role || 'Specialist'} • Click to insert @${p.name}">
        <span class="w-1.5 h-1.5 rounded-full ${isWorking ? 'bg-emerald-400 animate-pulse' : 'bg-emerald-500'} shrink-0"></span>
        <div class="w-3.5 h-3.5 rounded flex items-center justify-center text-[8.5px] font-pixel font-bold shrink-0" style="background: ${color}22; border: 1px solid ${color}; color: ${color};">
          ${p.name[0]}
        </div>
        <span class="text-slate-100 font-bold font-mono text-[10px]">${p.name}</span>
        <span class="text-[7.5px] font-mono px-1 py-0.2 rounded font-bold uppercase border ${engStyle}">[${eng.toUpperCase()}]</span>
      </button>
      <button type="button" onclick="openQuickModelPickerModal('${safeName}', '${eng}', '${safeModel}', '${safeFleet}')" class="px-1.5 py-0.5 border-l border-slate-800 bg-slate-950/80 hover:bg-cyan-950/80 text-[8.5px] font-mono ${modelBtnBorder} hover:text-cyan-200 flex items-center gap-0.5 cursor-pointer transition" title="${modelBtnTitle}">
        <span>🧠</span>
        <span class="max-w-[105px] truncate">${modelBadgeLabel}</span>
        <span class="text-[7px] text-slate-400">▾</span>
      </button>
    `;
    container.appendChild(chipGroup);
  });
}

let cachedBridgeChatAgents = [];

window.openWarRoomChatBridgeModal = async function() {
  const modal = document.getElementById('modal-warroom-chat-bridge');
  const agSel = document.getElementById('wr-bridge-agent-select');
  const allowCb = document.getElementById('wr-bridge-allow-broadcast');
  if (!modal || !agSel) return;
  try {
    const [caRes, rmRes] = await Promise.all([
      fetch('/api/chat-agents'),
      fetch('/api/war-room/rooms')
    ]);
    const caData = await caRes.json();
    const rmData = await rmRes.json();
    cachedBridgeChatAgents = caData.agents || [];
    const rid = (typeof activeWarRoomId !== 'undefined' && activeWarRoomId) ? activeWarRoomId : 'general';
    const room = (rmData.rooms || []).find(r => r.id === rid) || {};
    const curLink = (room.linked_chat_workspaces || [])[0] || null;

    agSel.innerHTML = cachedBridgeChatAgents.map(a =>
      `<option value="${a.id}" ${curLink && curLink.agent_id === a.id ? 'selected' : ''}>${a.name || a.id} (${a.id})</option>`
    ).join('');
    if (allowCb) allowCb.checked = Boolean(curLink && curLink.allow_group_broadcast);
    onWarRoomBridgeAgentChange(curLink ? curLink.scope_id : '');
    modal.classList.remove('hidden');
  } catch (e) {
    alert(`Failed to load Chat Agent workspaces: ${e.message}`);
  }
};

window.closeWarRoomChatBridgeModal = function() {
  document.getElementById('modal-warroom-chat-bridge')?.classList.add('hidden');
};

window.onWarRoomBridgeAgentChange = function(preselectScope = '') {
  const agId = document.getElementById('wr-bridge-agent-select')?.value;
  const scSel = document.getElementById('wr-bridge-scope-select');
  if (!scSel) return;
  const ag = cachedBridgeChatAgents.find(a => a.id === agId);
  const scopes = (ag && ag.subdata_scopes) || [];
  scSel.innerHTML = scopes.map(s =>
    `<option value="${s.id}" ${s.id === preselectScope ? 'selected' : ''}>${s.business_name || s.name || s.id} (${s.id})</option>`
  ).join('') || '<option value="">No workspaces found</option>';
};

window.saveWarRoomChatBridge = async function() {
  const rid = (typeof activeWarRoomId !== 'undefined' && activeWarRoomId) ? activeWarRoomId : 'general';
  const aid = document.getElementById('wr-bridge-agent-select')?.value || '';
  const sid = document.getElementById('wr-bridge-scope-select')?.value || '';
  const allowBcast = Boolean(document.getElementById('wr-bridge-allow-broadcast')?.checked);
  if (!aid || !sid) {
    alert('Select a valid Chat Agent and Sub-Data Workspace.');
    return;
  }
  const res = await fetch(`/api/war-room/rooms/${encodeURIComponent(rid)}/linked-workspaces`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      linked_chat_workspaces: [{ agent_id: aid, scope_id: sid, allow_group_broadcast: allowBcast }]
    })
  });
  const data = await res.json();
  if (!res.ok) {
    alert(`Save failed: ${data.detail || 'Error'}`);
    return;
  }
  closeWarRoomChatBridgeModal();
  alert(`Linked ${aid}/${sid} to War Room (${allowBcast ? 'WhatsApp broadcast enabled' : 'read/publish only'}).`);
};

window.clearWarRoomChatBridge = async function() {
  const rid = (typeof activeWarRoomId !== 'undefined' && activeWarRoomId) ? activeWarRoomId : 'general';
  await fetch(`/api/war-room/rooms/${encodeURIComponent(rid)}/linked-workspaces`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ linked_chat_workspaces: [] })
  });
  closeWarRoomChatBridgeModal();
};
