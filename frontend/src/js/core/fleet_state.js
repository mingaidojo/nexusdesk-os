    // --- Adaptive Multi-Instance Fleet State & Management ---
    let isAgentTurnInFlight = false;
    let currentInstanceKey = localStorage.getItem('nexusdesk_instance') || 'agents_bs';
    let availableInstances = [];

    function toggleFleetDropdown() {
      const menu = document.getElementById('fleet-dropdown-menu');
      if (menu) menu.classList.toggle('hidden');
    }

    // Close fleet dropdown if clicked outside
    document.addEventListener('click', (e) => {
      const wrapper = document.getElementById('fleet-selector-wrapper');
      const menu = document.getElementById('fleet-dropdown-menu');
      if (menu && !menu.classList.contains('hidden') && wrapper && !wrapper.contains(e.target)) {
        menu.classList.add('hidden');
      }
    });

    async function loadInstances() {
      try {
        const res = await fetch('/api/instances');
        if (res.ok) {
          const data = await res.json();
          availableInstances = data.instances || [];
          
          // Verify currentInstanceKey is still valid
          const currentInst = availableInstances.find(i => i.key === currentInstanceKey) || availableInstances[0];
          if (currentInst) {
            currentInstanceKey = currentInst.key;
            localStorage.setItem('nexusdesk_instance', currentInst.key);
            await loadFleetAgents(currentInst.key);
          }

          renderFleetUI(currentInst);
        }
      } catch (err) {
        console.error('Failed to load instances:', err);
      }
    }

    function renderFleetUI(currentInst) {
      if (!currentInst) return;
      
      const isCurrentOnline = currentInst.is_online !== undefined 
        ? currentInst.is_online 
        : Object.values(currentInst.engines || {}).some(e => e.daemon_running);

      // Update header button
      const labelEl = document.getElementById('current-fleet-label');
      const dotEl = document.getElementById('current-fleet-dot');
      if (labelEl) labelEl.innerText = currentInst.label || currentInst.key;
      if (dotEl) {
        dotEl.className = isCurrentOnline ? 'w-2 h-2 rounded-full bg-emerald-400' : 'w-2 h-2 rounded-full bg-slate-500';
      }

      // Update sidebar indicator
      const sLabel = document.getElementById('sidebar-fleet-label');
      const sBadge = document.getElementById('sidebar-fleet-badge');
      const sDot = document.getElementById('sidebar-fleet-dot');
      if (sLabel) sLabel.innerText = `FLEET: ${(currentInst.label || currentInst.key).toUpperCase()}`;
      if (sBadge) sBadge.innerText = currentInst.badge || 'ACTIVE';
      if (sDot) {
        sDot.className = isCurrentOnline ? 'w-2 h-2 rounded-full bg-emerald-400 shrink-0' : 'w-2 h-2 rounded-full bg-slate-500 shrink-0';
      }

      // Render dropdown items
      const optionsContainer = document.getElementById('fleet-dropdown-options');
      const badgeCount = document.getElementById('fleet-count-badge');
      if (badgeCount) badgeCount.innerText = `${availableInstances.length} Fleets`;

      if (optionsContainer) {
        optionsContainer.innerHTML = availableInstances.map(inst => {
          const isSelected = inst.key === currentInstanceKey;
          const isOnline = inst.is_online !== undefined 
            ? inst.is_online 
            : Object.values(inst.engines || {}).some(e => e.daemon_running);
          const statusDot = isOnline ? 'bg-emerald-400' : 'bg-slate-600';

          const activeEngines = Object.values(inst.engines || {})
            .filter(e => e.daemon_running)
            .map(e => (e.id || '').toUpperCase());

          let subtext = '';
          if (isOnline) {
            if (inst.agent_count > 0) {
              subtext = `${inst.agent_count} agents • ${inst.user}`;
            } else if (activeEngines.length > 0) {
              subtext = `${activeEngines.join('/')} online • ${inst.user}`;
            } else {
              subtext = `Online • ${inst.user}`;
            }
          } else {
            if (inst.agent_count > 0) {
              subtext = `${inst.agent_count} agents • Standby`;
            } else if (inst.has_hermes_config) {
              subtext = `0 agents • ${inst.user}`;
            } else {
              subtext = `Standby • ${inst.user}`;
            }
          }

          const engineBadges = inst.engines ? Object.values(inst.engines)
            .filter(e => e.daemon_running || e.installed)
            .map(e => `<span class="px-1 py-0.2 rounded text-[8px] font-mono uppercase ${e.daemon_running ? 'bg-emerald-950 text-emerald-400 border border-emerald-800' : 'bg-slate-900 text-slate-500 border border-slate-800'}" title="${e.name} (${e.daemon_running ? 'running' : 'inactive'})">${e.id}</span>`)
            .join(' ') : '';
          return `
            <button onclick="switchFleetInstance('${inst.key}')" class="w-full px-3 py-2 text-left hover:bg-slate-800/80 flex items-center justify-between transition cursor-pointer ${isSelected ? 'bg-slate-800/60 font-semibold' : ''}">
              <div class="flex items-center gap-2 min-w-0">
                <span class="w-2 h-2 rounded-full ${statusDot} shrink-0"></span>
                <div class="truncate">
                  <div class="text-slate-200 text-xs font-mono truncate">${inst.label}</div>
                  <div class="text-[10px] text-slate-400 font-mono">${subtext}</div>
                  ${engineBadges ? `<div class="flex items-center gap-1 mt-1">${engineBadges}</div>` : ''}
                </div>
              </div>
              <div class="flex items-center gap-1.5 shrink-0">
                <span class="px-1.5 py-0.5 rounded text-[9px] font-bold ${isSelected ? 'bg-emerald-950 text-emerald-300 border border-emerald-800' : 'bg-slate-900 text-slate-400 border border-slate-800'}">${inst.badge}</span>
                ${isSelected ? '<span class="text-emerald-400 text-xs font-bold">✓</span>' : ''}
              </div>
            </button>
          `;
        }).join('') + `
          <div class="p-2 border-t border-slate-800/80 mt-1 bg-slate-950/60">
            <button type="button" onclick="initializeCurrentFleet()" class="w-full py-1.5 px-2.5 rounded-lg bg-emerald-950/80 hover:bg-emerald-900 text-emerald-300 border border-emerald-700/80 text-[10px] font-mono flex items-center justify-center gap-1.5 transition">
              <span>🚀</span> <span>Deploy / Initialize Active Fleet</span>
            </button>
          </div>
        `;
      }
    }

    async function initializeCurrentFleet() {
      const inst = currentInstanceKey || localStorage.getItem('nexusdesk_instance') || 'agents_bs';
      toggleFleetDropdown();
      try {
        const res = await fetch(`/api/fleet/initialize?instance=${encodeURIComponent(inst)}`, {
          method: 'POST'
        });
        const data = await res.json();
        if (res.ok) {
          alert(`✅ Fleet workspace successfully deployed for ${data.user} (${data.instance})!\nCreated/verified paths:\n${(data.created_paths || []).join('\n') || 'All workspaces intact.'}`);
          await loadInstances();
          await loadModelsConfig();
        } else {
          alert(`⚠️ Fleet deployment error: ${data.detail || 'Failed to initialize workspace'}`);
        }
      } catch (err) {
        alert('⚠️ Network error deploying fleet: ' + err);
      }
    }

    // Handcrafted personas for known specialists (BL-AGENT-19)
    const KNOWN_PERSONA_PRESETS = {
      solaris: {
        role: 'Lead orchestrator & router',
        workspace: 'orchestrator',
        x: 160, y: 130, homeX: 160, homeY: 130, targetX: 160, targetY: 130,
        speed: 0.9,
        color: '#10b981',
        theme: 'orchestrator',
        hairColor: '#1e293b',
        shirtColor: '#0f172a',
        voice: { pitch: 0.85, rate: 1.0, gender: 'male', voiceName: '' }
      },
      scribe: {
        role: 'Customer care & ticket triage',
        workspace: 'support_tickets',
        x: 380, y: 250, homeX: 380, homeY: 250, targetX: 380, targetY: 250,
        speed: 0.85,
        color: '#38bdf8',
        theme: 'support',
        hairColor: '#451a03',
        shirtColor: '#0284c7',
        voice: { pitch: 1.15, rate: 0.95, gender: 'female', voiceName: '' }
      },
      chorusius: {
        role: 'Community & devotions broadcaster',
        workspace: 'community_drafts',
        x: 530, y: 250, homeX: 530, homeY: 250, targetX: 530, targetY: 250,
        speed: 0.9,
        color: '#f59e0b',
        theme: 'broadcast',
        hairColor: '#d97706',
        shirtColor: '#b45309',
        voice: { pitch: 1.05, rate: 1.0, gender: 'male', voiceName: '' }
      },
      lore: {
        role: 'Theology & scripture research',
        workspace: 'theology_research',
        x: 680, y: 250, homeX: 680, homeY: 250, targetX: 680, targetY: 250,
        speed: 0.8,
        color: '#a855f7',
        theme: 'theology',
        hairColor: '#94a3b8',
        shirtColor: '#6b21a8',
        voice: { pitch: 0.95, rate: 0.9, gender: 'male', voiceName: '' }
      },
      chroma: {
        role: 'Creative director & visuals',
        workspace: 'creative_assets',
        x: 380, y: 390, homeX: 380, homeY: 390, targetX: 380, targetY: 390,
        speed: 0.9,
        color: '#ec4899',
        theme: 'creative',
        hairColor: '#db2777',
        shirtColor: '#9d174d',
        voice: { pitch: 1.25, rate: 1.05, gender: 'female', voiceName: '' }
      },
      pylon: {
        role: 'Sysadmin & VPS health',
        workspace: 'sys_logs',
        x: 530, y: 390, homeX: 530, homeY: 390, targetX: 530, targetY: 390,
        speed: 0.95,
        color: '#6366f1',
        theme: 'sysadmin',
        hairColor: '#1e293b',
        shirtColor: '#3730a3',
        voice: { pitch: 0.8, rate: 1.15, gender: 'male', voiceName: '' }
      }
    };

    const PROCEDURAL_PALETTES = [
      { color: '#10b981', theme: 'emerald', hairColor: '#1e293b', shirtColor: '#064e3b' },
      { color: '#38bdf8', theme: 'sky', hairColor: '#451a03', shirtColor: '#0369a1' },
      { color: '#f59e0b', theme: 'amber', hairColor: '#d97706', shirtColor: '#b45309' },
      { color: '#a855f7', theme: 'purple', hairColor: '#94a3b8', shirtColor: '#6b21a8' },
      { color: '#ec4899', theme: 'pink', hairColor: '#db2777', shirtColor: '#9d174d' },
      { color: '#6366f1', theme: 'indigo', hairColor: '#1e293b', shirtColor: '#3730a3' },
      { color: '#14b8a6', theme: 'teal', hairColor: '#292524', shirtColor: '#0f766e' },
      { color: '#f97316', theme: 'orange', hairColor: '#78350f', shirtColor: '#c2410c' }
    ];

    async function loadFleetAgents(instKey) {
      try {
        const res = await fetch('/api/fleet');
        if (!res.ok) return;
        const data = await res.json();
        const inst = data[instKey] || data[currentInstanceKey];
        if (!inst) return;

        const rawAgents = inst.agents || [];
        if (rawAgents.length > 0) {
          agents = rawAgents.map((a, idx) => {
            const lowerName = a.name.toLowerCase().trim();
            const preset = KNOWN_PERSONA_PRESETS[lowerName];
            const slot = WORKSTATION_SLOTS[idx % WORKSTATION_SLOTS.length];
            const proc = PROCEDURAL_PALETTES[idx % PROCEDURAL_PALETTES.length];
            const eng = (a.engine || 'hermes').toLowerCase();

            if (preset) {
              return {
                id: lowerName.replace(/[^a-z0-9]/g, '_'),
                name: a.name,
                role: preset.role || a.role || 'Specialist Agent',
                engine: eng,
                model: a.model || '',
                color: preset.color,
                theme: preset.theme,
                hairColor: preset.hairColor,
                shirtColor: preset.shirtColor,
                speed: preset.speed || 0.9,
                x: preset.x,
                y: preset.y,
                homeX: preset.homeX,
                homeY: preset.homeY,
                targetX: preset.targetX,
                targetY: preset.targetY,
                state: 'working',
                stateTimer: Math.floor(Math.random() * 500) + 2000,
                dialogue: `Stationed at ${inst.label || instKey}`,
                dialogueTimer: 180,
                dialogueCategory: 'info',
                voice: preset.voice || { pitch: 1.0, rate: 1.0, voiceName: '' }
              };
            }

            return {
              id: lowerName.replace(/[^a-z0-9]/g, '_'),
              name: a.name,
              role: a.role || 'Specialist Agent',
              engine: eng,
              model: a.model || '',
              color: proc.color,
              theme: proc.theme,
              hairColor: proc.hairColor,
              shirtColor: proc.shirtColor,
              speed: 0.88,
              x: slot.x,
              y: slot.y,
              homeX: slot.x,
              homeY: slot.y,
              targetX: slot.x,
              targetY: slot.y,
              state: 'idle',
              stateTimer: Math.floor(Math.random() * 300) + 200,
              dialogue: `Connected to ${inst.label || instKey}`,
              dialogueTimer: 180,
              dialogueCategory: 'info',
              voice: { pitch: 1.0, rate: 1.0, voiceName: '' }
            };
          });
        } else {
          agents = [];
        }
      } catch (err) {
        console.error('Failed to load fleet agents:', err);
      }
    }

    async function switchFleetInstance(instKey) {
      if (instKey === currentInstanceKey) {
        toggleFleetDropdown();
        return;
      }
      currentInstanceKey = instKey;
      localStorage.setItem('nexusdesk_instance', instKey);
      toggleFleetDropdown();

      const target = availableInstances.find(i => i.key === instKey) || {
        key: instKey,
        label: instKey,
        user: instKey,
        badge: 'ACTIVE',
        is_online: false,
        has_hermes_config: false
      };
      renderFleetUI(target);

      // Reconnect WebSocket immediately to stream new fleet events
      if (typeof initWebSocket === 'function') {
        initWebSocket();
      }

      // Refresh all views for new instance without throwing on missing metrics
      try {
        await loadFleetAgents(instKey);
        await Promise.allSettled([
          loadModelsConfig(instKey),
          loadToolsAndMcpHub(),
          loadCrons(),
          loadWorkflows(),
          syncLiveHermesAgentActivity()
        ]);

        // Invalidate 3D voxel buffer so AgentFloor immediately redraws for the new fleet
        if (typeof invalidateIsoBuffer === 'function') {
          invalidateIsoBuffer();
        }
        if (typeof renderOfficeCanvas === 'function') {
          renderOfficeCanvas();
        }
        if (typeof renderFleetRoster === 'function') {
          renderFleetRoster();
        }
        if (typeof renderConsoleAgentCards === 'function') {
          renderConsoleAgentCards();
        }
        if (typeof loadWarRoomParticipants === 'function') {
          loadWarRoomParticipants();
        }

        if (agents && agents.length > 0) {
          selectAgent(agents[0]);
        } else {
          selectedAgent = null;
          const chatTitle = document.getElementById('chat-agent-name');
          const chatRole = document.getElementById('chat-agent-role');
          const chatCards = document.getElementById('console-agent-cards');
          const chatFeed = document.getElementById('chat-messages');
          if (chatTitle) chatTitle.innerText = 'No Active Agent';
          if (chatRole) chatRole.innerText = '0 agents in this fleet';
          if (chatCards) chatCards.innerHTML = '<div class="p-4 text-xs text-slate-500 font-mono text-center">No agents registered in fleet</div>';
          if (chatFeed) chatFeed.innerHTML = '<div class="p-8 text-xs text-slate-500 font-mono text-center">Select or deploy an agent to begin chatting.</div>';
        }
      } catch (e) {
        console.error('Error refreshing fleet instance:', e);
      }
    }

    let _lastFleetSyncTime = 0;
    async function syncAllFleetState(isManual = false) {
      const now = Date.now();
      if (!isManual && (now - _lastFleetSyncTime < 4000)) return;
      _lastFleetSyncTime = now;

      const iconEl = document.getElementById('header-sync-icon');
      const toastEl = document.getElementById('header-sync-toast');
      if (iconEl) iconEl.classList.add('animate-spin');

      try {
        await Promise.allSettled([
          loadInstances(),
          typeof loadModelsConfig === 'function' ? loadModelsConfig() : Promise.resolve(),
          typeof loadToolsAndMcpHub === 'function' ? loadToolsAndMcpHub() : Promise.resolve(),
          typeof loadCrons === 'function' ? loadCrons() : Promise.resolve(),
          typeof loadWorkflows === 'function' ? loadWorkflows() : Promise.resolve(),
          typeof syncLiveHermesAgentActivity === 'function' ? syncLiveHermesAgentActivity() : Promise.resolve()
        ]);

        if (activeTab === 'memory' && typeof activeEditorAgent !== 'undefined' && activeEditorAgent) {
          if (typeof memoryStudioMode !== 'undefined' && memoryStudioMode === 'skills' && typeof loadAgentSkills === 'function') {
            await loadAgentSkills(activeEditorAgent);
          } else if (typeof loadMemoryExplorer === 'function') {
            await loadMemoryExplorer(activeEditorAgent);
          }
        } else if (activeTab === 'roster' && typeof renderFleetRoster === 'function') {
          renderFleetRoster();
        }

        if (isManual && toastEl) {
          toastEl.classList.remove('hidden');
          setTimeout(() => toastEl.classList.add('hidden'), 2200);
        }
      } catch (err) {
        console.error('Fleet state sync failed:', err);
      } finally {
        if (iconEl) setTimeout(() => iconEl.classList.remove('animate-spin'), 350);
      }
    }

    // --- Application State ---
    let activeTab = 'floor';
    let selectedAgent = null;
    let audioResponseEnabled = localStorage.getItem('nexusdesk_audio_response') !== 'false';
    let handsFreeVoiceActive = false;
    let fallbackChainData = [];
    let reasoningOverridesData = {};
    let cronJobsData = [];
    let activeEditorAgent = 'solaris';
    let activeEditorFilePath = 'memory/MEMORY.md';
    let availableBrowserVoices = [];

    // Architectural Workstation Coordinates on Office Canvas (BL-AGF-12: Multi-Team Fleet Expansion & Dual-Orchestrator)
    const WORKSTATION_SLOTS = [
      { x: 160, y: 130, name: 'Executive Suite (Lead Orchestrator)', zone: 'EXECUTIVE', wing: 'Executive Suite' },
      { x: 380, y: 250, name: 'Main Bullpen Desk 1', zone: 'BULLPEN', wing: 'Main Operations' },
      { x: 530, y: 250, name: 'Main Bullpen Desk 2', zone: 'BULLPEN', wing: 'Main Operations' },
      { x: 680, y: 250, name: 'Main Bullpen Desk 3', zone: 'BULLPEN', wing: 'Main Operations' },
      { x: 380, y: 390, name: 'Main Bullpen Desk 4', zone: 'BULLPEN', wing: 'Main Operations' },
      { x: 530, y: 390, name: 'Main Bullpen Desk 5', zone: 'BULLPEN', wing: 'Main Operations' },
      { x: 680, y: 390, name: 'Main Bullpen Desk 6', zone: 'BULLPEN', wing: 'Main Operations' },
      { x: 120, y: 360, name: 'West Wing Station 7', zone: 'BULLPEN', wing: 'Engineering Lab' },
      { x: 220, y: 360, name: 'West Wing Station 8', zone: 'BULLPEN', wing: 'Engineering Lab' },
      { x: 120, y: 470, name: 'West Wing Station 9', zone: 'BULLPEN', wing: 'Engineering Lab' },
      { x: 220, y: 470, name: 'West Wing Station 10', zone: 'BULLPEN', wing: 'Engineering Lab' },
      { x: 380, y: 480, name: 'South Bay Station 11', zone: 'BULLPEN', wing: 'Innovation Hub' },
      { x: 530, y: 480, name: 'South Bay Station 12', zone: 'BULLPEN', wing: 'Innovation Hub' },
      { x: 680, y: 480, name: 'South Bay Station 13', zone: 'BULLPEN', wing: 'Innovation Hub' },
      { x: 740, y: 360, name: 'East Annex Station 14', zone: 'BULLPEN', wing: 'Creative Wing' }
    ];

    function syncDynamicAgentsToFloor(cfgList) {
      if (!cfgList || !cfgList.length) {
        agents.length = 0;
        if (typeof renderFleetRoster === 'function') renderFleetRoster();
        if (typeof renderConsoleAgentCards === 'function') renderConsoleAgentCards();
        return;
      }
      const themeColors = {
        orchestrator: '#10b981',
        developer: '#38bdf8',
        devops: '#6366f1',
        analyst: '#14b8a6',
        security: '#f43f5e',
        operations: '#f59e0b',
        creative: '#a855f7',
        // Legacy compatibility
        support: '#38bdf8',
        broadcast: '#f59e0b',
        theology: '#a855f7',
        sysadmin: '#6366f1',
        custom: '#14b8a6'
      };

      const updated = [];
      cfgList.forEach((cfg, idx) => {
        const aid = (cfg.name || '').toLowerCase();
        const slot = WORKSTATION_SLOTS[idx] || { x: 380 + (idx % 3) * 150, y: 480, name: `Station ${idx+1}`, zone: 'BULLPEN' };
        let existing = agents.find(a => a.id === aid);
        const color = cfg.color || themeColors[cfg.theme] || '#06b6d4';

        if (existing) {
          existing.name = cfg.name;
          existing.role = cfg.role || existing.role;
          existing.engine = cfg.engine || existing.engine || 'hermes';
          existing.homeX = slot.x;
          existing.homeY = slot.y;
          if (cfg.color) existing.color = cfg.color;
          if (cfg.theme) existing.theme = cfg.theme;
          if (cfg.voice_gender) existing.voice.gender = cfg.voice_gender;
          if (cfg.voice_pitch !== undefined) existing.voice.pitch = cfg.voice_pitch;
          if (cfg.voice_rate !== undefined) existing.voice.rate = cfg.voice_rate;
          updated.push(existing);
        } else {
          updated.push({
            id: aid,
            name: cfg.name,
            role: cfg.role || 'Autonomous Specialist',
            engine: cfg.engine || 'hermes',
            workspace: cfg.name.toLowerCase(),
            x: slot.x,
            y: slot.y,
            homeX: slot.x,
            homeY: slot.y,
            targetX: slot.x,
            targetY: slot.y,
            speed: 0.9,
            color: color,
            theme: cfg.theme || 'custom',
            hairColor: '#334155',
            shirtColor: color,
            state: 'working',
            stateTimer: 2800,
            dialogue: null,
            dialogueTimer: 0,
            voice: {
              pitch: cfg.voice_pitch !== undefined ? cfg.voice_pitch : 1.0,
              rate: cfg.voice_rate !== undefined ? cfg.voice_rate : 1.0,
              gender: cfg.voice_gender || 'female',
              voiceName: ''
            }
          });
        }
      });

      agents.length = 0;
      agents.push(...updated);

      // Ensure selectedAgent is active in current fleet
      if (agents.length > 0) {
        if (!selectedAgent || !agents.some(a => a.id === selectedAgent.id)) {
          selectAgent(agents[0]);
        } else if (typeof populateDirectChatModelSelector === 'function') {
          populateDirectChatModelSelector(selectedAgent);
        }
      }

      if (typeof renderFleetRoster === 'function') renderFleetRoster();
      if (typeof renderConsoleAgentCards === 'function') renderConsoleAgentCards();
      if (typeof renderWarRoomParticipantsRibbon === 'function') renderWarRoomParticipantsRibbon();
      if (typeof renderWarRoomMentionHelpers === 'function') renderWarRoomMentionHelpers();
      if (typeof populateRoundTablePanelists === 'function') populateRoundTablePanelists();
    }

