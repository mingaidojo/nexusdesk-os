/**
 * @module chat/direct_chat.js
 * @description 1-on-1 Direct Chat Console & Per-Agent Model Catalog.
 * Manages engine model catalogs, Quick Model Picker, agent card selection,
 * 1-on-1 console chat submission (`sendConsoleChat`), and transcript reset.
 *
 * Part of the Console & War Room chat subsystem (concatenated globally by frontend/build.py).
 */

// --- TAB 2: Console & Bi-Directional Chat & Voices ---
const ENGINE_BADGE_STYLES = {
  hermes: 'bg-emerald-950/80 text-emerald-300 border-emerald-700/60',
  claude: 'bg-amber-950/80 text-amber-300 border-amber-700/60',
  agy: 'bg-sky-950/80 text-sky-300 border-sky-700/60',
  opencode: 'bg-purple-950/80 text-purple-300 border-purple-700/60',
  codex: 'bg-teal-950/80 text-teal-300 border-teal-700/60'
};

// BL-MOD-31: Dynamic Per-Engine Model Catalog Cache
window.engineModelsCatalog = {
  agy: [
    { id: 'gemini-3.8-flash-medium', label: 'Gemini 3.8 Flash (Medium)', badge: 'DEFAULT' },
    { id: 'gemini-3.8-flash-high', label: 'Gemini 3.8 Flash (High)', badge: 'REASONING' },
    { id: 'gemini-3.8-flash-low', label: 'Gemini 3.8 Flash (Low)', badge: 'SPEED' },
    { id: 'gemini-4-argon-medium', label: 'Gemini 4 Argon (Medium)', badge: 'FRONTIER' },
    { id: 'gemini-4-argon-high', label: 'Gemini 4 Argon (High)', badge: 'FRONTIER' },
    { id: 'gemini-4-argon-low', label: 'Gemini 4 Argon (Low)', badge: 'FAST' },
    { id: 'claude-sonnet-5-5-medium', label: 'Claude Sonnet 5.5 (Medium)', badge: 'CODING' },
    { id: 'claude-sonnet-5-5-high', label: 'Claude Sonnet 5.5 (High)', badge: 'REASONING' },
    { id: 'claude-opus-5-5-medium', label: 'Claude Opus 5.5 (Medium)', badge: 'HEAVY' },
    { id: 'claude-opus-5-5-high', label: 'Claude Opus 5.5 (High)', badge: 'HEAVY' },
    { id: 'gpt-oss-120b-medium', label: 'GPT-OSS 120B (Medium)', badge: 'OPEN' }
  ],
  claude: [
    { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (Primary)', badge: 'DEFAULT' },
    { id: 'sonnet', label: 'Claude Sonnet (Latest Alias)', badge: 'ALIAS' },
    { id: 'opus', label: 'Claude Opus (Latest Frontier)', badge: 'FRONTIER' },
    { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', badge: 'HEAVY' },
    { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5 (Fast)', badge: 'SPEED' }
  ],
  opencode: [
    { id: 'opencode/deepseek-v4.1-flash-free', label: 'DeepSeek V4.1 Flash Free', badge: 'DEFAULT' },
    { id: 'opencode/big-pickle', label: 'Big Pickle', badge: 'FREE' },
    { id: 'opencode/flint-40b-free', label: 'Flint 40B Free', badge: 'FREE' },
    { id: 'opencode/glm-5.3-flash-free', label: 'GLM - 5.3 - Flash Free', badge: 'FREE' },
    { id: 'opencode/mimo-v2.6-flash-free', label: 'MiMo - V2.6 - Flash Free', badge: 'FREE' },
    { id: 'opencode/nemotron-3-ultra-free', label: 'Nemotron 3 Ultra Free', badge: 'FREE' },
    { id: 'opencode/nemotron-3.5-lightning-free', label: 'Nemotron 3.5 Lightning Free', badge: 'FREE' },
    { id: 'opencode/nemotron-3.5-super-vl-free', label: 'Nemotron 3.5 Super VL Free', badge: 'FREE' },
    { id: 'opencode/beam-free', label: 'Beam Free', badge: 'FREE' }
  ],
  codex: [
    { id: 'gpt-5.3-codex', label: 'GPT-5.3 Codex', badge: 'DEFAULT' },
    { id: 'gpt-5.4', label: 'GPT-5.4 Flagship', badge: 'FRONTIER' },
    { id: 'gpt-5.4-mini', label: 'GPT-5.4 Mini', badge: 'SPEED' },
    { id: 'o3', label: 'OpenAI o3 Reasoning', badge: 'REASONING' },
    { id: 'o4-mini', label: 'OpenAI o4-mini', badge: 'REASONING' },
    { id: 'gpt-4.1', label: 'GPT-4.1', badge: 'STABLE' },
    { id: 'gpt-4o', label: 'GPT-4o', badge: 'STABLE' }
  ],
  hermes: [
    { id: 'nvidia/nemotron-3-ultra-550b-a55b', label: 'Nemotron 3 Ultra 550B', badge: 'DEFAULT' },
    { id: 'deepseek-ai/deepseek-v4.1-flash', label: 'DeepSeek V4.1 Flash', badge: 'FAST' },
    { id: 'nvidia/nemotron-3-super-120b-a12b', label: 'Nemotron 3 Super 120B', badge: 'BALANCED' },
    { id: 'abacus/gemini-3.8-flash', label: 'Gemini 3.8 Flash (Abacus)', badge: 'FAST' },
    { id: 'abacus/claude-sonnet-5', label: 'Claude Sonnet 5 (Abacus)', badge: 'CODING' },
    { id: 'abacus/gpt-5.4', label: 'GPT-5.4 (Abacus)', badge: 'FRONTIER' },
    { id: 'abacus/qwen3.8-max', label: 'Qwen 3.8 Max (Abacus)', badge: 'CODING' },
    { id: 'openrouter/auto', label: 'OpenRouter Auto', badge: 'AUTO' },
    { id: 'poolside/laguna-s-2.1:free', label: 'Poolside Laguna S 2.1 (Free)', badge: 'FREE' }
  ]
};
window.engineDefaultsMap = {
  hermes: 'poolside/laguna-s-2.1:free',
  agy: 'gemini-3.8-flash-medium',
  claude: 'claude-sonnet-5-5',
  opencode: 'opencode/deepseek-v4.1-flash-free',
  codex: 'gpt-5.3-codex'
};

window.loadEngineModelsCatalog = async function(forceRefresh = false) {
  try {
    const res = await fetch(`/api/models/engine-catalog${forceRefresh ? '?refresh=true' : ''}`);
    if (res.ok) {
      const data = await res.json();
      if (data.engines) window.engineModelsCatalog = data.engines;
      if (data.defaults) window.engineDefaultsMap = data.defaults;
      if (selectedAgent) populateDirectChatModelSelector(selectedAgent);
      if (typeof renderWarRoomParticipantsRibbon === 'function') renderWarRoomParticipantsRibbon();
    }
  } catch (e) {
    console.warn('Using fallback engine model catalog:', e);
  }
};
setTimeout(() => { window.loadEngineModelsCatalog(); }, 400);

window.formatShortModelName = function(modelId, eng) {
  if (!modelId) {
    const fallback = window.engineDefaultsMap[(eng || 'hermes').toLowerCase()] || 'default';
    return window.formatShortModelName(fallback, eng);
  }
  let s = String(modelId).trim();
  if (s.includes('/')) s = s.split('/').pop();
  s = s.replace(/:free$/i, '');
  if (s.length > 22) s = s.slice(0, 20) + '…';
  return s;
};

window.populateDirectChatModelSelector = function(agent) {
  const sel = document.getElementById('chat-agent-model-select');
  if (!sel || !agent) return;
  const eng = (agent.engine || 'hermes').toLowerCase();
  const catalog = window.engineModelsCatalog[eng] || window.engineModelsCatalog.hermes || [];
  const cfgMatch = (typeof agentConfigsData !== 'undefined' && Array.isArray(agentConfigsData))
    ? agentConfigsData.find(x => x.name.toLowerCase() === agent.name.toLowerCase())
    : null;
  const currentModel = agent.model || cfgMatch?.model || window.engineDefaultsMap[eng] || '';

  sel.innerHTML = '';
  const seen = new Set();
  if (currentModel) {
    const inCat = catalog.find(m => m.id.toLowerCase() === currentModel.toLowerCase());
    if (!inCat) {
      const opt = document.createElement('option');
      opt.value = currentModel;
      const shortLbl = window.formatShortModelName ? window.formatShortModelName(currentModel, eng) : currentModel;
      opt.textContent = shortLbl;
      opt.title = currentModel;
      opt.selected = true;
      sel.appendChild(opt);
      seen.add(currentModel.toLowerCase());
    }
  }

  catalog.forEach(m => {
    if (seen.has(m.id.toLowerCase())) return;
    seen.add(m.id.toLowerCase());
    const opt = document.createElement('option');
    opt.value = m.id;
    const shortLbl = window.formatShortModelName ? window.formatShortModelName(m.id, eng) : m.id;
    opt.textContent = `${shortLbl}${m.badge ? ' [' + m.badge + ']' : ''}`;
    opt.title = m.id;
    if (currentModel && m.id.toLowerCase() === currentModel.toLowerCase()) {
      opt.selected = true;
    }
    sel.appendChild(opt);
  });
};

window.changeDirectChatAgentModel = async function(newModel) {
  if (!newModel || !selectedAgent) return;
  const agentName = selectedAgent.name;
  const eng = (selectedAgent.engine || 'hermes').toLowerCase();
  const activeInstance = (typeof currentInstanceKey !== 'undefined' && currentInstanceKey)
    ? currentInstanceKey
    : (localStorage.getItem('nexusdesk_instance') || 'agents_bs');

  selectedAgent.model = newModel;
  const agInList = agents.find(a => a.name.toLowerCase() === agentName.toLowerCase());
  if (agInList) agInList.model = newModel;

  try {
    const res = await fetch('/api/config/agent-model', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agent_name: agentName,
        model: newModel,
        engine: eng,
        instance: activeInstance
      })
    });
    if (res.ok) {
      renderConsoleAgentCards();
      if (typeof loadWarRoomParticipants === 'function') loadWarRoomParticipants();
      if (typeof loadModelsConfig === 'function') loadModelsConfig();
      if (typeof loadEngineModelsCatalog === 'function') loadEngineModelsCatalog(true);
    }
  } catch (e) {
    console.error('Failed to persist direct chat model change:', e);
  }
};

window.openQuickModelPickerModal = function(agentName, engine, currentModel, fleetKey, roomId) {
  const modal = document.getElementById('modal-quick-model-picker');
  if (!modal) return;
  const eng = (engine || 'hermes').toLowerCase();
  document.getElementById('quick-model-picker-agent').value = agentName;
  document.getElementById('quick-model-picker-engine').value = eng;
  document.getElementById('quick-model-picker-fleet').value = fleetKey || (typeof currentInstanceKey !== 'undefined' ? currentInstanceKey : 'agents_bs');

  const effectiveRoomId = roomId || (currentConsoleMode === 'warroom' ? (activeWarRoomId || 'general') : null);
  const isSpecificWarRoom = effectiveRoomId && effectiveRoomId !== 'general';

  // BL-WAR-24: Populate War Room Specialists Switcher Tabs Bar
  const agentsBar = document.getElementById('quick-model-picker-agents-bar');
  const agentTabsContainer = document.getElementById('quick-model-picker-agent-tabs');
  if (agentsBar && agentTabsContainer) {
    const roomParts = getEffectiveWarRoomParticipants();
    if (isSpecificWarRoom && Array.isArray(roomParts) && roomParts.length > 1) {
      agentsBar.classList.remove('hidden');
      agentTabsContainer.innerHTML = '';
      roomParts.forEach(p => {
        const pEng = (p.engine || 'hermes').toLowerCase();
        const pColor = p.color || '#06b6d4';
        const isActiveAgent = p.name.toLowerCase() === agentName.toLowerCase();
        const tabBtn = document.createElement('button');
        tabBtn.type = 'button';
        tabBtn.className = `px-2 py-1 rounded-lg border text-xs font-mono font-bold flex items-center gap-1.5 transition cursor-pointer shrink-0 ${
          isActiveAgent
            ? 'bg-cyan-950 border-cyan-500 text-cyan-200 shadow-sm'
            : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
        }`;
        tabBtn.innerHTML = `
          <span class="w-2 h-2 rounded-full" style="background: ${pColor}"></span>
          <span>${p.name}</span>
          <span class="text-[8px] uppercase opacity-75">[${pEng}]</span>
        `;
        tabBtn.onclick = () => {
          window.openQuickModelPickerModal(p.name, pEng, p.model, p.fleet, effectiveRoomId);
        };
        agentTabsContainer.appendChild(tabBtn);
      });
    } else {
      agentsBar.classList.add('hidden');
    }
  }

  // Hide any previous feedback message
  const fb = document.getElementById('quick-model-picker-feedback');
  if (fb) fb.classList.add('hidden');

  const scopeBox = document.getElementById('quick-model-picker-scope-box');
  const radioRoom = document.getElementById('quick-model-scope-room');
  const radioGlobal = document.getElementById('quick-model-scope-global');
  const roomScopeLabel = document.getElementById('quick-model-scope-room-label');

  if (scopeBox) {
    if (isSpecificWarRoom) {
      scopeBox.classList.remove('hidden');
      if (roomScopeLabel) {
        const currentTab = consoleTabs.find(t => t.roomId === effectiveRoomId);
        const roomName = currentTab ? currentTab.title.replace('War Room: ', '') : effectiveRoomId;
        roomScopeLabel.innerText = `This Room Only (${roomName})`;
      }
      if (radioRoom) radioRoom.checked = true;
    } else {
      scopeBox.classList.add('hidden');
      if (radioGlobal) radioGlobal.checked = true;
    }
  }

  document.getElementById('quick-model-picker-title').innerText = `SWITCH LLM: ${agentName.toUpperCase()}`;
  document.getElementById('quick-model-picker-subtitle').innerText = `EXECUTION ENGINE: [${eng.toUpperCase()}] • ACTIVE: ${currentModel || 'default'}`;
  document.getElementById('quick-model-picker-custom').value = currentModel || '';

  const listEl = document.getElementById('quick-model-picker-list');
  listEl.innerHTML = '';
  const catalog = window.engineModelsCatalog[eng] || window.engineModelsCatalog.hermes || [];

  catalog.forEach(m => {
    const isCurrent = currentModel && m.id.toLowerCase() === currentModel.toLowerCase();
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.onclick = () => selectQuickModelForAgent(m.id);
    btn.className = `w-full text-left p-2.5 rounded-xl border transition flex items-center justify-between gap-2 cursor-pointer ${
      isCurrent
        ? 'bg-cyan-950/80 border-cyan-500 text-cyan-200 shadow-sm'
        : 'bg-slate-900/90 hover:bg-slate-800 border-slate-800 text-slate-200'
    }`;
    btn.innerHTML = `
      <div class="min-w-0 flex-1">
        <div class="font-bold text-xs font-mono truncate ${isCurrent ? 'text-cyan-300' : 'text-slate-100'}">${m.id}</div>
        <div class="text-[10px] text-slate-400 truncate mt-0.5">${m.label || ''}</div>
      </div>
      <div class="flex items-center gap-1.5 shrink-0">
        ${m.badge ? `<span class="px-1.5 py-0.5 rounded text-[9px] font-bold bg-slate-950 border border-slate-700 text-cyan-400">${m.badge}</span>` : ''}
        ${isCurrent ? '<span class="text-emerald-400 font-bold text-xs">✓</span>' : ''}
      </div>
    `;
    listEl.appendChild(btn);
  });

  modal.classList.remove('hidden');
};

window.closeQuickModelPickerModal = function() {
  const modal = document.getElementById('modal-quick-model-picker');
  if (modal) modal.classList.add('hidden');
};

window.applyCustomQuickModel = function() {
  const val = document.getElementById('quick-model-picker-custom')?.value?.trim();
  if (!val) return;
  selectQuickModelForAgent(val);
};

window.selectQuickModelForAgent = async function(modelId) {
  const agentName = document.getElementById('quick-model-picker-agent')?.value;
  const eng = document.getElementById('quick-model-picker-engine')?.value || 'hermes';
  const fleetKey = document.getElementById('quick-model-picker-fleet')?.value || 'agents_bs';
  const fb = document.getElementById('quick-model-picker-feedback');
  if (!agentName || !modelId) return;

  const scopeRadio = document.querySelector('input[name="quick-model-scope"]:checked');
  const selectedScope = scopeRadio ? scopeRadio.value : 'room';
  const effectiveRoomId = (currentConsoleMode === 'warroom') ? (activeWarRoomId || 'general') : 'general';
  const applyRoomScope = (selectedScope === 'room' && effectiveRoomId !== 'general');

  try {
    if (applyRoomScope) {
      // BL-WAR-23: Save per-room model override
      const res = await fetch(`/api/war-room/rooms/${encodeURIComponent(effectiveRoomId)}/agent-model`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          room_id: effectiveRoomId,
          agent_name: agentName,
          model: modelId,
          scope: 'room'
        })
      });
      if (res.ok) {
        if (Array.isArray(warRoomParticipants)) {
          const wp = warRoomParticipants.find(p => p.name.toLowerCase() === agentName.toLowerCase() || p.id.toLowerCase() === agentName.toLowerCase());
          if (wp) {
            wp.model = modelId;
            wp.is_room_model = true;
          }
        }
        // BL-WAR-24: Show immediate in-modal visual confirmation
        if (fb) {
          const currentTab = consoleTabs.find(t => t.roomId === effectiveRoomId);
          const roomName = currentTab ? currentTab.title.replace('War Room: ', '') : effectiveRoomId;
          fb.className = 'mx-3.5 mt-2 px-3 py-2 rounded-xl border border-emerald-500/80 bg-emerald-950/80 text-emerald-300 text-xs font-mono font-bold flex items-center justify-between';
          fb.innerHTML = `<span>✓ Saved! <strong>${agentName}</strong> is now set to <code>${modelId}</code> in <em>${roomName}</em></span><span class="text-xs">✓</span>`;
          fb.classList.remove('hidden');
        }
        document.getElementById('quick-model-picker-subtitle').innerText = `EXECUTION ENGINE: [${eng.toUpperCase()}] • ACTIVE: ${modelId} [ROOM]`;
        renderWarRoomParticipantsRibbon();
        renderTeamsStageGrid();
        // Automatically close modal after 650ms so user clearly sees the confirmation
        setTimeout(() => {
          closeQuickModelPickerModal();
        }, 650);
      } else {
        const err = await res.json().catch(() => ({}));
        alert('Failed to update room model: ' + (err.detail || res.statusText));
      }
    } else {
      // Global specialist override
      const res = await fetch('/api/config/agent-model', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agent_name: agentName,
          model: modelId,
          engine: eng,
          instance: fleetKey
        })
      });
      if (res.ok) {
        // Update local state
        const ag = agents.find(a => a.name.toLowerCase() === agentName.toLowerCase());
        if (ag) ag.model = modelId;
        if (selectedAgent && selectedAgent.name.toLowerCase() === agentName.toLowerCase()) {
          selectedAgent.model = modelId;
          populateDirectChatModelSelector(selectedAgent);
        }
        if (Array.isArray(warRoomParticipants)) {
          const wp = warRoomParticipants.find(p => p.name.toLowerCase() === agentName.toLowerCase() || p.id.toLowerCase() === agentName.toLowerCase());
          if (wp) {
            wp.model = modelId;
            wp.is_room_model = false;
          }
        }
        // BL-WAR-24: Show immediate in-modal visual confirmation
        if (fb) {
          fb.className = 'mx-3.5 mt-2 px-3 py-2 rounded-xl border border-indigo-500/80 bg-indigo-950/80 text-indigo-300 text-xs font-mono font-bold flex items-center justify-between';
          fb.innerHTML = `<span>✓ Global Default saved for <strong>${agentName}</strong>: <code>${modelId}</code></span><span class="text-xs">✓</span>`;
          fb.classList.remove('hidden');
        }
        document.getElementById('quick-model-picker-subtitle').innerText = `EXECUTION ENGINE: [${eng.toUpperCase()}] • ACTIVE: ${modelId} [GLOBAL]`;
        renderConsoleAgentCards();
        renderWarRoomParticipantsRibbon();
        renderTeamsStageGrid();
        if (typeof loadModelsConfig === 'function') loadModelsConfig();
        if (typeof loadEngineModelsCatalog === 'function') loadEngineModelsCatalog(true);
        if (typeof loadWarRoomParticipants === 'function') loadWarRoomParticipants();
        setTimeout(() => {
          closeQuickModelPickerModal();
        }, 650);
      } else {
        alert('Failed to update global model.');
      }
    }
  } catch (e) {
    alert('Failed to update model: ' + e);
  }
};

function selectAgent(agent) {
  if (!agent) return;
  selectedAgent = agent;
  const nameEl = document.getElementById('chat-agent-name');
  const roleEl = document.getElementById('chat-agent-role');
  const avatarEl = document.getElementById('chat-agent-avatar');
  if (nameEl) nameEl.innerText = agent.name;
  if (roleEl) roleEl.innerText = agent.role || 'Specialist Agent';
  if (avatarEl) {
    avatarEl.innerText = (agent.name && agent.name.length) ? agent.name[0] : 'A';
    avatarEl.style.borderColor = agent.color || '#10b981';
    avatarEl.style.color = agent.color || '#10b981';
  }
  if (agent.voice) {
    const rp = document.getElementById('range-pitch');
    const vp = document.getElementById('val-pitch');
    const rr = document.getElementById('range-rate');
    const vr = document.getElementById('val-rate');
    if (rp && agent.voice.pitch !== undefined) rp.value = agent.voice.pitch;
    if (vp && agent.voice.pitch !== undefined) vp.innerText = agent.voice.pitch;
    if (rr && agent.voice.rate !== undefined) rr.value = agent.voice.rate;
    if (vr && agent.voice.rate !== undefined) vr.innerText = agent.voice.rate;
  }

  const eng = (agent.engine || 'hermes').toLowerCase();
  const engEl = document.getElementById('chat-agent-engine');
  if (engEl) {
    engEl.innerText = `[${eng.toUpperCase()}]`;
    engEl.className = `text-[9px] font-mono px-1.5 py-0.5 rounded font-bold uppercase border ${ENGINE_BADGE_STYLES[eng] || ENGINE_BADGE_STYLES.hermes}`;
  }

  // Sync active state badge
  const stateBadge = document.getElementById('chat-agent-state');
  if (stateBadge) {
    const st = (agent.state || 'ready').toLowerCase();
    if (st === 'working') {
      stateBadge.innerText = 'WORKING';
      stateBadge.className = 'text-[8.5px] sm:text-[9px] font-mono px-1.5 sm:px-2 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-800 animate-pulse shrink-0';
    } else {
      stateBadge.innerText = 'READY';
      stateBadge.className = 'text-[8.5px] sm:text-[9px] font-mono px-1.5 sm:px-2 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-800 shrink-0';
    }
  }

  populateDirectChatModelSelector(agent);
  renderConsoleAgentCards();
  loadChatMessages(agent.name);

  if (typeof consoleTabs !== 'undefined') {
    const defaultTab = consoleTabs.find(t => t.id === 'tab-direct-default');
    if (defaultTab) {
      defaultTab.title = '1-on-1';
      defaultTab.agent = agent.name;
    }
    if (typeof renderConsoleTabs === 'function') renderConsoleTabs();
  }
}

// BL-UI-51: Option A Dropdown Switcher helpers
window.selectAgent = selectAgent;

window.toggleDirectAgentDropdown = function(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  const menu = document.getElementById('direct-agent-dropdown-menu');
  if (menu) {
    menu.classList.toggle('hidden');
  }
};

window.closeDirectAgentDropdown = function() {
  const menu = document.getElementById('direct-agent-dropdown-menu');
  if (menu && !menu.classList.contains('hidden')) {
    menu.classList.add('hidden');
  }
};

// Close dropdown on outside click (matching #direct-chat-more-menu-container pattern)
document.addEventListener('click', (e) => {
  if (!e.target.closest('#direct-agent-dropdown-wrapper')) {
    window.closeDirectAgentDropdown();
  }
});

function renderConsoleAgentCards() {
  // 1. BL-UI-51 Option A: Populate the Agent Dropdown Popover List
  const dropdownItems = document.getElementById('direct-agent-dropdown-items');
  const badgeCount = document.getElementById('direct-agent-count-badge');
  if (badgeCount && agents) {
    badgeCount.innerText = `${agents.length} AGENTS`;
  }
  if (dropdownItems) {
    dropdownItems.innerHTML = '';
    agents.forEach(a => {
      const isSel = (selectedAgent === a || (selectedAgent && (selectedAgent.name === a.name || selectedAgent.id === a.id)));
      const eng = (a.engine || 'hermes').toLowerCase();
      const shortModel = formatShortModelName(a.model, eng);
      const escapedId = (a.id || '').replace(/'/g, "\\'");
      const escapedName = (a.name || '').replace(/'/g, "\\'");

      dropdownItems.innerHTML += `
        <button type="button" onclick="selectAgent(agents.find(x => x.id === '${escapedId}' || x.name === '${escapedName}')); closeDirectAgentDropdown();"
                class="w-full text-left p-2 rounded-lg flex items-center justify-between gap-2 transition cursor-pointer ${isSel ? 'bg-emerald-950/80 border border-emerald-600/60 text-emerald-200' : 'bg-slate-950/70 hover:bg-slate-800/80 text-slate-300 border border-slate-800'}">
          <div class="flex items-center gap-2 min-w-0 flex-1">
            <div class="w-6 h-6 rounded flex items-center justify-center font-bold text-xs shrink-0 font-sans" style="background: ${a.color || '#10b981'}22; border: 1px solid ${a.color || '#10b981'}; color: ${a.color || '#10b981'};">
              ${a.name[0]}
            </div>
            <div class="min-w-0 flex-1">
              <div class="font-bold text-xs text-slate-100 truncate">${a.name}</div>
              <div class="text-[9px] text-cyan-400 font-mono truncate">🧠 ${shortModel}</div>
            </div>
          </div>
          <div class="flex items-center gap-1.5 shrink-0">
            <span class="px-1.5 py-0.5 rounded text-[8px] font-mono font-bold uppercase border leading-none ${ENGINE_BADGE_STYLES[eng] || ENGINE_BADGE_STYLES.hermes}">[${eng.toUpperCase()}]</span>
            ${isSel ? '<span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>' : ''}
          </div>
        </button>
      `;
    });
  }

  // Legacy container fallback if present
  const container = document.getElementById('console-agent-cards');
  if (container) {
    container.innerHTML = '';
    agents.forEach(a => {
      const isSel = (selectedAgent === a || (selectedAgent && (selectedAgent.name === a.name || selectedAgent.id === a.id)));
      const eng = (a.engine || 'hermes').toLowerCase();
      const shortModel = formatShortModelName(a.model, eng);
      const engBadge = `<span class="px-1.5 py-0.5 rounded text-[8px] font-mono font-bold uppercase border leading-none shrink-0 ${ENGINE_BADGE_STYLES[eng] || ENGINE_BADGE_STYLES.hermes}">[${eng.toUpperCase()}]</span>`;
      const statusBadge = `<span class="text-[8px] font-mono px-1.5 py-0.5 rounded leading-none shrink-0 whitespace-nowrap border ${a.state === 'working' ? 'bg-emerald-950/90 text-emerald-400 border-emerald-800' : 'bg-slate-900 text-slate-400 border-slate-700/80'}">${a.state.toUpperCase()}</span>`;
      const escapedId = (a.id || '').replace(/'/g, "\\'");
      container.innerHTML += `
        <div onclick="selectAgent(agents.find(x => x.id === '${escapedId}' || x.name === '${a.name.replace(/'/g, "\\'")}'))" class="p-2.5 rounded-lg border cursor-pointer transition flex justify-between items-center gap-2 ${isSel ? 'bg-slate-900 border-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.2)]' : 'bg-slate-950/70 border-slate-800 hover:border-slate-700'}">
          <div class="flex items-center gap-2.5 min-w-0 flex-1">
            <div class="w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs shrink-0 font-sans" style="background: ${a.color}22; border: 1px solid ${a.color}; color: ${a.color};">
              ${a.name[0]}
            </div>
            <div class="min-w-0 flex-1">
              <div class="text-xs font-bold text-slate-100 truncate tracking-tight" title="${a.name}">${a.name}</div>
              <div class="text-[9.5px] text-cyan-400/90 font-mono truncate" title="Active LLM: ${a.model || shortModel}">🧠 ${shortModel}</div>
            </div>
          </div>
          <div class="flex flex-col items-end justify-center gap-1 shrink-0">
            ${engBadge}
            ${statusBadge}
          </div>
        </div>
      `;
    });
  }
}

let currentChatHistory = [];
let currentWarRoomHistory = [];
let activeExportMode = 'warroom';
let activeDirectChatTimerInterval = null;

async function loadChatMessages(agentName) {
  const container = document.getElementById('chat-conversation');
  currentChatHistory = [];
  try {
    const inst = (typeof currentInstanceKey !== 'undefined' && currentInstanceKey) ? currentInstanceKey : (localStorage.getItem('nexusdesk_instance') || 'agents_bs');
    const res = await fetch(`/api/chat/history?agent=${encodeURIComponent(agentName)}&instance=${encodeURIComponent(inst)}`);
    const data = await res.json();
    container.innerHTML = '';
    if (data.messages && data.messages.length > 0) {
      currentChatHistory = data.messages;
      data.messages.forEach(m => appendChatMessage(m.sender, m.text, m.timestamp));
    } else {
      const welcome = `Online and at desk. Ready for directives.`;
      currentChatHistory.push({ sender: agentName, text: welcome, timestamp: Date.now() / 1000 });
      appendChatMessage(agentName, welcome);
    }
  } catch (e) {
    const fallback = `Ready.`;
    currentChatHistory.push({ sender: agentName, text: fallback, timestamp: Date.now() / 1000 });
    appendChatMessage(agentName, fallback);
  }
}

function appendChatMessage(sender, text, timestamp) {
  const container = document.getElementById('chat-conversation');
  const isUser = (sender.toLowerCase() === 'user');
  const bubble = document.createElement('div');
  bubble.className = `flex gap-2.5 items-start ${isUser ? 'justify-end' : ''}`;
  bubble._rawText = text;

  const tsVal = timestamp || Math.floor(Date.now() / 1000);
  const timeStr = (typeof window.formatNexusDateTime === 'function')
    ? window.formatNexusDateTime(tsVal, true)
    : new Date(tsVal * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  let execSummaryHtml = '';
  let bodyText = text;
  const summaryMatch = text.match(/<executive_summary>([\s\S]*?)<\/executive_summary>/i);
  if (summaryMatch && summaryMatch[1]) {
    const cleanSummary = summaryMatch[1].trim();
    execSummaryHtml = `
      <div class="mb-2 p-2.5 rounded-lg bg-cyan-950/70 border border-cyan-700/80 text-cyan-200 text-xs font-sans shadow-inner">
        <div class="flex items-center gap-1.5 text-[10px] font-mono text-cyan-400 font-bold uppercase tracking-wider mb-1">
          <span>🎙️</span> <span>EXECUTIVE TAKEAWAY</span>
        </div>
        <div class="leading-relaxed font-medium">${cleanSummary}</div>
      </div>
    `;
    bodyText = text.replace(/<executive_summary>[\s\S]*?<\/executive_summary>/gi, '').trim();
  }
  const preprocessed = prepareAgentMarkdownMedia(bodyText);
  const parsed = marked.parse(preprocessed);

  bubble.innerHTML = isUser ? `
    <div class="bg-emerald-950/80 border border-emerald-800 px-3.5 py-2.5 rounded-xl text-xs max-w-[92%] sm:max-w-[88%] text-emerald-100 shadow-md">
      <div class="flex items-center justify-between gap-3 mb-1 border-b border-emerald-800/60 pb-1">
        <strong class="text-emerald-400 block text-[10px] font-mono">${(window.nexusOperatorName || 'User').replace(/</g, '&lt;')}</strong>
        <div class="flex items-center gap-2">
          <span class="text-[9px] font-mono text-emerald-400/70">${timeStr}</span>
          <button type="button" onclick="copyMessageBubble(this)" class="btn-copy-msg px-1.5 py-0.5 rounded text-[10px] font-mono text-emerald-300/80 hover:text-emerald-100 hover:bg-emerald-900/60 transition flex items-center gap-1 cursor-pointer" title="Copy message text">
            <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>
            <span class="copy-lbl">Copy</span>
          </button>
        </div>
      </div>
      <div class="prose prose-invert prose-xs text-xs font-sans text-emerald-50 leading-relaxed">${parsed}</div>
    </div>
  ` : `
    <div class="w-7 h-7 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center text-xs text-cyan-400 font-pixel flex-shrink-0 mt-0.5">${sender[0]}</div>
    <div class="bg-slate-900 border border-slate-800 px-3.5 py-2.5 rounded-xl text-xs max-w-[92%] sm:max-w-[88%] text-slate-200 shadow-md">
      <div class="flex items-center justify-between gap-3 mb-1 border-b border-slate-800/80 pb-1">
        <strong class="text-cyan-400 block text-[10px] font-mono">${sender}</strong>
        <div class="flex items-center gap-2">
          <span class="text-[9px] font-mono text-slate-400">${timeStr}</span>
          <button type="button" onclick="copyMessageBubble(this)" class="btn-copy-msg px-1.5 py-0.5 rounded text-[10px] font-mono text-slate-400 hover:text-cyan-300 hover:bg-slate-800 transition flex items-center gap-1 cursor-pointer" title="Copy message text">
            <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>
            <span class="copy-lbl">Copy</span>
          </button>
        </div>
      </div>
      ${execSummaryHtml}
      <div class="prose prose-invert prose-xs text-xs font-sans text-slate-100 leading-relaxed">${parsed}</div>
      ${renderServerArtifactsPills(extractServerFilePaths(text))}
    </div>
  `;
  attachCodeBlockCopyButtons(bubble);
  if (typeof window.enhanceProseTables === 'function') {
    window.enhanceProseTables(bubble);
  }
  container.appendChild(bubble);
  container.scrollTop = container.scrollHeight;
}

// ==============================================================
// --- DIRECT 1-ON-1 CHAT DISPATCH & CLEARANCE ---
// ==============================================================

let biDirListenTimer = null;

async function sendConsoleChat() {
  const input = document.getElementById('chat-text-input');
  let text = input.value.trim();
  const attList = Array.isArray(activeChatAttachment.direct) ? activeChatAttachment.direct : [];
  if (!text && attList.length === 0) return;

  if (attList.length > 0) {
    const linkMd = formatBatchAttachmentsMarkdown(attList);
    const defaultHeader = attList.length === 1
      ? `[Attached File: ${attList[0].filename}]`
      : `[Attached ${attList.length} Files: ${attList.map(a => a.filename).join(', ')}]`;
    text = text ? `${text}${linkMd}` : `${defaultHeader}${linkMd}`;
    removeChatAttachment('direct');
  }

  const targetAgent = selectedAgent ? selectedAgent.name : 'Solaris';
  appendChatMessage('User', text);
  currentChatHistory.push({ sender: 'User', text: text, timestamp: Date.now() / 1000 });
  input.value = '';
  if (typeof autoResizeTextarea === 'function') autoResizeTextarea(input);

  isAgentTurnInFlight = true;
  window._directChatWasInterrupted = false;
  if (window._directChatAbortController) {
    try { window._directChatAbortController.abort(); } catch (e) {}
  }
  window._directChatAbortController = new AbortController();
  const directInterruptBtn = document.getElementById('btn-interrupt-console');
  if (directInterruptBtn) {
    directInterruptBtn.classList.remove('hidden');
    directInterruptBtn.classList.add('flex');
  }
  stopActiveVoiceRecognition();
  updateBiDirectionalVoiceUI('thinking');

  const stateBadge = document.getElementById('chat-agent-state');
  if (stateBadge) {
    stateBadge.innerText = 'THINKING...';
    stateBadge.className = 'text-[10px] font-mono px-2 py-0.5 rounded bg-amber-950 text-amber-400 border border-amber-800 animate-pulse';
  }

  // BL-WAR-50: Natural language timeout extraction for direct chat stopwatch
  const timeoutMatch = text.match(/(?:time-?out(?:\s+limit)?(?:\s+is)?|\bceiling\b:?|i\s+(?:can|will)\s+wait\s+(?:for|max)?|wait\s+for|max\s+wait)\s*[:=]?\s*(\d+)\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes)?\b/i);
  let directTimeoutSec = 2700;
  if (timeoutMatch) {
    const val = parseInt(timeoutMatch[1], 10);
    const unit = (timeoutMatch[2] || 's').toLowerCase();
    let total = unit.startsWith('m') ? val * 60 : val;
    if (total >= 30 && total <= 3600) {
      directTimeoutSec = total;
    }
  }

  // 1-on-1 Direct Chat Stopwatch & Timeout Countdown Banner (BL-CHAT-33 & BL-WAR-50)
  const chatBanner = document.getElementById('chat-status-banner');
  const chatStatusText = document.getElementById('chat-status-text');
  const chatTimerEl = document.getElementById('chat-status-timer');
  const chatStartTime = Date.now();

  if (activeDirectChatTimerInterval) {
    clearInterval(activeDirectChatTimerInterval);
    activeDirectChatTimerInterval = null;
  }

  if (chatBanner) chatBanner.classList.remove('hidden');
  if (chatStatusText) chatStatusText.innerText = `${targetAgent}: Executing directive...`;
  if (chatTimerEl) {
    chatTimerEl.innerText = `${directTimeoutSec}s left`;
    chatTimerEl.className = 'text-[10px] text-emerald-400/90 font-mono bg-emerald-900/60 px-1.5 py-0.2 rounded border border-emerald-600/50';
  }

  activeDirectChatTimerInterval = setInterval(() => {
    const elapsedSec = Math.floor((Date.now() - chatStartTime) / 1000);
    const remainingSec = Math.max(0, directTimeoutSec - elapsedSec);
    if (chatTimerEl) {
      chatTimerEl.innerText = `${remainingSec}s left`;
      if (remainingSec <= 30) {
        chatTimerEl.className = 'text-[10px] text-rose-300 font-mono bg-rose-950/80 px-1.5 py-0.2 rounded border border-rose-600/70 animate-pulse';
      } else {
        chatTimerEl.className = 'text-[10px] text-emerald-400/90 font-mono bg-emerald-900/60 px-1.5 py-0.2 rounded border border-emerald-600/50';
      }
    }
    if (chatStatusText) {
      const phaseIdx = Math.min(Math.floor(elapsedSec / 4), REASONING_PHASES.length - 1);
      chatStatusText.innerText = `${targetAgent}: ${REASONING_PHASES[phaseIdx]}`;
    }
  }, 1000);

  try {
    const activeInstance = (typeof currentInstanceKey !== 'undefined' && currentInstanceKey) ? currentInstanceKey : (localStorage.getItem('nexusdesk_instance') || 'agents_bs');
    const targetAgentObj = agents.find(a => a.name === targetAgent) || selectedAgent;
    const targetEngine = targetAgentObj?.engine || 'hermes';
    const selectedModelEl = document.getElementById('chat-agent-model-select');
    const activeModel = selectedModelEl?.value || targetAgentObj?.model || undefined;
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: window._directChatAbortController ? window._directChatAbortController.signal : undefined,
      body: JSON.stringify({
        agent: targetAgent,
        message: text,
        instance: activeInstance,
        engine: targetEngine,
        model: activeModel
      })
    });
    const data = await res.json();
    isAgentTurnInFlight = false;
    if (data.status === 'interrupted') {
      const intMsg = `⚡ Interrupted: ${targetAgent} turn aborted by operator.`;
      appendChatMessage('System', intMsg);
      currentChatHistory.push({ sender: 'System', text: intMsg, timestamp: Date.now() / 1000 });
      return;
    }
    if (!res.ok) {
      const errMsg = `⚠️ [Error ${res.status}] ${data.detail || 'Agent could not complete directive.'}`;
      appendChatMessage('System', errMsg);
      currentChatHistory.push({ sender: 'System', text: errMsg, timestamp: Date.now() / 1000 });
      if (handsFreeVoiceActive) scheduleBiDirectionalListen(1000);
      return;
    }
    let reply = data.reply || `Directive processed by ${targetAgent}.`;
    appendChatMessage(targetAgent, reply);
    currentChatHistory.push({ sender: targetAgent, text: reply, timestamp: Date.now() / 1000 });

    if ((audioResponseEnabled || handsFreeVoiceActive) && res.ok) {
      try {
        speakWithAgentVoice(selectedAgent || agents[0], reply);
      } catch (voiceErr) {
        console.warn('Voice playback non-blocking error:', voiceErr);
      }
    } else if (handsFreeVoiceActive) {
      scheduleBiDirectionalListen(900);
    }
  } catch (e) {
    isAgentTurnInFlight = false;
    if (window._directChatWasInterrupted || (e && e.name === 'AbortError')) {
      const intMsg = `⚡ Interrupted: ${targetAgent} turn aborted by operator.`;
      appendChatMessage('System', intMsg);
      currentChatHistory.push({ sender: 'System', text: intMsg, timestamp: Date.now() / 1000 });
    } else {
      const netErr = '⚠️ Network or server error contacting agent: ' + e;
      appendChatMessage('System', netErr);
      currentChatHistory.push({ sender: 'System', text: netErr, timestamp: Date.now() / 1000 });
      if (handsFreeVoiceActive) scheduleBiDirectionalListen(1200);
    }
  } finally {
    window._directChatAbortController = null;
    if (directInterruptBtn) {
      directInterruptBtn.classList.add('hidden');
      directInterruptBtn.classList.remove('flex');
    }
    if (activeDirectChatTimerInterval) {
      clearInterval(activeDirectChatTimerInterval);
      activeDirectChatTimerInterval = null;
    }
    if (chatBanner) chatBanner.classList.add('hidden');
    if (stateBadge) {
      stateBadge.innerText = 'READY';
      stateBadge.className = 'text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-800';
    }
  }
}

window.handleDirectChatInterruptClick = async function() {
  const targetAgent = selectedAgent ? selectedAgent.name : 'Solaris';
  const activeInstance = (typeof currentInstanceKey !== 'undefined' && currentInstanceKey)
    ? currentInstanceKey
    : (localStorage.getItem('nexusdesk_instance') || 'agents_bs');

  window._directChatWasInterrupted = true;
  if (window._directChatAbortController) {
    try { window._directChatAbortController.abort(); } catch (e) {}
  }

  const directInterruptBtn = document.getElementById('btn-interrupt-console');
  if (directInterruptBtn) {
    directInterruptBtn.classList.add('hidden');
    directInterruptBtn.classList.remove('flex');
  }

  try {
    await fetch('/api/chat/interrupt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent: targetAgent, instance: activeInstance })
    });
    if (typeof showToast === 'function') {
      showToast(`⚡ Interrupted ${targetAgent}.`);
    }
  } catch (e) {
    console.warn('Direct chat interrupt error:', e);
  }
};

async function clearCurrentChat(resetMemory = false) {
  const targetAgent = selectedAgent ? selectedAgent.name : 'Solaris';
  const promptMsg = resetMemory
    ? `HARD RESET: Completely purge persistent memory and session state for ${targetAgent}?\nThe agent will have zero recall of earlier discussions.`
    : `Clear chat display transcript for ${targetAgent}?`;
  if (!confirm(promptMsg)) return;
  const activeInstance = (typeof currentInstanceKey !== 'undefined' && currentInstanceKey) ? currentInstanceKey : (localStorage.getItem('nexusdesk_instance') || 'agents_bs');
  try {
    await fetch('/api/chat/clear', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent: targetAgent, instance: activeInstance, reset_memory: resetMemory })
    });
    const container = document.getElementById('chat-conversation');
    if (container) container.innerHTML = '';
    appendChatMessage(targetAgent, resetMemory ? `Session memory wiped clean. Ready for new directives.` : `Chat transcript cleared.`);
  } catch (e) {
    alert('Failed to clear memory: ' + e);
  }
}
