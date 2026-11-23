    function formatLocationBadge(loc) {
      if (!loc) return 'Desk #1';
      return loc
        .replace('Executive Suite', 'Suite')
        .replace('Main Operations', 'Ops')
        .replace('Bullpen Desk', 'Bullpen')
        .replace('Slot ', '#');
    }

    function formatModelDisplay(modelName) {
      if (!modelName) return 'Default';
      const clean = modelName.replace(/\s*\(Default\)$/i, '');
      const parts = clean.split('/');
      const base = parts[parts.length - 1];
      if (/nemotron.*340b/i.test(base)) return 'Nemotron 340B';
      if (/gpt-oss-120b/i.test(base)) return 'GPT-OSS 120B';
      if (/llama-3\.3-70b/i.test(base)) return 'Llama 3.3 70B';
      if (/deepseek-v3/i.test(base)) return 'DeepSeek-V3';
      if (/deepseek-v4/i.test(base)) return 'DeepSeek-V4.1';
      if (/claude-3-7-sonnet/i.test(base)) return 'Claude 3.7';
      if (/claude-3-5-sonnet/i.test(base)) return 'Claude 3.5';
      if (/claude-sonnet-5/i.test(base) || /claude-opus-5/i.test(base)) return 'Claude Sonnet 5.5';
      if (/gemini-3\.8-flash/i.test(base) || /gemini.*3\.8/i.test(base)) return 'Gemini 3.8 Flash';
      if (/gemini-4/i.test(base) || /argon/i.test(base)) return 'Gemini 4.0';
      if (/mimo-v2\.6-flash/i.test(base) || /mimo.*flash/i.test(base)) return 'Mimo Flash (Free)';
      if (/laguna/i.test(base)) return 'Laguna S-2.1';
      return base.length > 17 ? base.slice(0, 15) + '…' : base;
    }

    // --- Agent Fleet Roster Renderer (Tidy Display & Clean Station Config) ---
    function renderFleetRoster() {
      const container = document.getElementById('roster-grid');
      if (!container) return;

      if (!agents || agents.length === 0) {
        container.innerHTML = `
          <div class="col-span-full bg-[#0d1424] border border-cyan-800/60 rounded-2xl p-8 text-center shadow-xl">
            <span class="text-3xl block mb-3">🏢</span>
            <h3 class="font-bold text-base text-slate-100 font-pixel mb-1">NO AGENTS REGISTERED IN ${(currentInstanceKey || 'CURRENT').toUpperCase()} FLEET</h3>
            <p class="text-xs text-slate-400 font-mono mb-5 max-w-md mx-auto">This instance is active and connected, but has 0 agents in config.yaml. 12 Bullpen workstations are ready for immediate onboarding.</p>
            <button onclick="openCreateAgentModal()" class="px-5 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold font-mono transition shadow-md inline-flex items-center gap-2">
              <span>➕</span> <span>Deploy First Agent to Cluster</span>
            </button>
          </div>
        `;
        return;
      }

      const standbyIndex = agents.length;
      const standbySlot = (standbyIndex < WORKSTATION_SLOTS.length) ? WORKSTATION_SLOTS[standbyIndex] : null;

      const fullRoster = [
        ...agents.map((a, idx) => {
          const slot = WORKSTATION_SLOTS[idx];
          return {
            ...a,
            isAssigned: true,
            location: slot ? `${slot.wing || 'Bullpen'} • Slot ${idx + 1}` : `Bullpen Desk #${idx + 1}`
          };
        })
      ];

      if (standbySlot) {
        fullRoster.push({
          id: `desk_${standbyIndex + 1}`,
          name: `Workstation #${standbyIndex + 1}`,
          role: 'Available Workstation Slot',
          color: '#f59e0b',
          isAssigned: false,
          location: `Bullpen Desk #${standbyIndex + 1} (Available)`,
          state: 'standby'
        });
      }

      container.innerHTML = fullRoster.map(agent => {
        if (!agent.isAssigned) {
          return `
            <div class="bg-[#0c1220] border-2 border-dashed border-amber-600/40 hover:border-amber-500/70 rounded-2xl p-5 flex flex-col justify-between transition-all duration-200 shadow-xl relative overflow-hidden group">
              <div class="absolute top-0 left-0 right-0 h-1 bg-amber-500/60 shadow-[0_0_8px_rgba(245,158,11,0.3)]"></div>
              <div>
                <div class="flex items-center justify-between gap-2 mb-3 pt-1">
                  <span class="px-2.5 py-0.5 rounded-md bg-amber-950/80 border border-amber-700/80 text-[9px] text-amber-300 font-mono font-bold uppercase tracking-wider shrink-0 flex items-center gap-1.5">
                    <span class="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse"></span>
                    STANDBY • AVAILABLE
                  </span>
                  <span class="text-[10px] text-slate-400 font-mono bg-slate-900/90 px-2.5 py-0.5 rounded-md border border-slate-800/90 shrink-0 whitespace-nowrap">DESK #${standbyIndex + 1}</span>
                </div>
                <div class="flex items-start gap-3 mb-3.5">
                  <div class="w-12 h-12 rounded-xl bg-amber-950/40 border border-amber-600/40 flex items-center justify-center text-xl text-amber-400 font-bold shrink-0 shadow-inner group-hover:scale-105 transition-transform">🖥️</div>
                  <div class="min-w-0 flex-1">
                    <h3 class="font-bold text-sm text-slate-100 font-sans tracking-tight">WORKSTATION #${standbyIndex + 1}</h3>
                    <p class="text-[11px] text-amber-300/80 font-mono mt-1 leading-relaxed line-clamp-2 min-h-[34px]">Reserved for fleet expansion &amp; specialist deployment.</p>
                  </div>
                </div>
                <div class="bg-[#080d18]/90 p-3 rounded-xl border border-slate-800/90 mb-4 space-y-2 font-mono text-[11px]">
                  <div class="flex justify-between items-center text-slate-400">
                    <span class="text-slate-500 text-[10px] uppercase tracking-wider">Wiring</span>
                    <span class="text-amber-300/90 font-medium text-[10px]">Ready for Connection</span>
                  </div>
                  <div class="flex justify-between items-center text-slate-400">
                    <span class="text-slate-500 text-[10px] uppercase tracking-wider">Zone</span>
                    <span class="text-slate-300 text-[10px]">${standbySlot?.wing || 'Main Operations'}</span>
                  </div>
                  <div class="flex justify-between items-center text-slate-400">
                    <span class="text-slate-500 text-[10px] uppercase tracking-wider">Capacity</span>
                    <span class="text-slate-300 text-[10px]">1 Autonomous Hermes Agent</span>
                  </div>
                </div>
              </div>
              <div class="pt-3 border-t border-slate-800/80">
                <button type="button" onclick="openCreateAgentModal()" class="w-full py-2.5 px-3 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-mono font-bold transition flex items-center justify-center gap-2 shadow-md cursor-pointer whitespace-nowrap">
                  <span>➕</span> <span>Deploy Agent to Desk #${standbyIndex + 1}</span>
                </button>
              </div>
            </div>
          `;
        }

        const modelMatch = (agentConfigsData || []).find(cfg => cfg.name.toLowerCase() === agent.id.toLowerCase() || cfg.name.toLowerCase() === agent.name.toLowerCase());
        const engKey = (agent.engine || modelMatch?.engine || 'hermes').toLowerCase();
        const defaultResolved = (window.engineDefaultsMap && window.engineDefaultsMap[engKey]) || globalModelConfig?.default || 'deepseek-ai/DeepSeek-V4.1-Flash';
        const rawModel = agent.model || modelMatch?.model || defaultResolved;
        const modelName = rawModel;
        const safeName = agent.name.replace(/'/g, "\\'");
        const safeModel = String(rawModel).replace(/'/g, "\\'");
        const safeFleet = (typeof currentInstanceKey !== 'undefined' && currentInstanceKey) ? currentInstanceKey : 'agents_bs';
        const engineStyles = {
          hermes: 'bg-emerald-950/80 text-emerald-300 border-emerald-700/60 shadow-[0_0_8px_rgba(16,185,129,0.15)]',
          claude: 'bg-amber-950/80 text-amber-300 border-amber-700/60 shadow-[0_0_8px_rgba(245,158,11,0.15)]',
          agy: 'bg-sky-950/80 text-sky-300 border-sky-700/60 shadow-[0_0_8px_rgba(56,189,248,0.15)]',
          opencode: 'bg-purple-950/80 text-purple-300 border-purple-700/60 shadow-[0_0_8px_rgba(168,85,247,0.15)]',
          codex: 'bg-teal-950/80 text-teal-300 border-teal-700/60 shadow-[0_0_8px_rgba(20,184,166,0.15)]'
        };
        const engBadge = `<span class="px-2 py-0.5 rounded text-[9px] font-mono font-bold uppercase border ${engineStyles[engKey] || engineStyles.hermes}">[${engKey.toUpperCase()}]</span>`;

        let statusDotClass = 'bg-emerald-400 shadow-[0_0_6px_#10b981]';
        let statusTextClass = 'text-emerald-400';
        if (agent.state === 'sleeping') {
          statusDotClass = 'bg-purple-400 shadow-[0_0_6px_#c084fc]';
          statusTextClass = 'text-purple-300';
        } else if (agent.state === 'error') {
          statusDotClass = 'bg-rose-400 shadow-[0_0_6px_#f43f5e]';
          statusTextClass = 'text-rose-400';
        } else if (agent.state === 'gossiping' || agent.state === 'restroom') {
          statusDotClass = 'bg-amber-400 shadow-[0_0_6px_#f59e0b]';
          statusTextClass = 'text-amber-300';
        } else if (agent.state === 'briefing' || agent.state === 'conferencing') {
          statusDotClass = 'bg-cyan-400 shadow-[0_0_6px_#06b6d4]';
          statusTextClass = 'text-cyan-300';
        }

        return `
          <div class="bg-[#0c1220] border border-slate-800/90 hover:border-slate-700/90 rounded-2xl p-5 flex flex-col justify-between transition-all duration-200 shadow-xl hover:shadow-2xl relative overflow-hidden group">
            <div class="absolute top-0 left-0 right-0 h-1" style="background: ${agent.color}; box-shadow: 0 0 12px ${agent.color}66;"></div>
            <div>
              <!-- Header Row: Category Badge, Engine Badge & Station Slot -->
              <div class="flex items-center justify-between gap-2 mb-3 pt-1">
                <div class="flex items-center gap-1.5 shrink-0">
                  <span class="px-2 py-0.5 rounded-md text-[9px] font-mono font-bold uppercase tracking-wider flex items-center gap-1.5 shrink-0" style="background: ${agent.color}18; color: ${agent.color}; border: 1px solid ${agent.color}40;">
                    <span class="w-1.5 h-1.5 rounded-full" style="background: ${agent.color}; box-shadow: 0 0 6px ${agent.color};"></span>
                    ${agent.theme.toUpperCase()}
                  </span>
                  ${engBadge}
                </div>
                <span class="text-[10px] text-slate-300 font-mono bg-slate-900/90 px-2.5 py-0.5 rounded-md border border-slate-800/90 shrink-0 font-medium whitespace-nowrap" title="${agent.location}">${formatLocationBadge(agent.location)}</span>
              </div>

              <!-- Identity Block: Avatar, Full Name & Role -->
              <div class="flex items-start gap-3 mb-3.5">
                <div onclick="openDirectChatWithAgent('${agent.name}')" class="w-12 h-12 rounded-xl flex items-center justify-center font-bold text-lg shadow-inner group-hover:scale-105 transition-transform shrink-0 cursor-pointer font-sans" style="background: ${agent.color}1f; color: ${agent.color}; border: 1px solid ${agent.color}55; box-shadow: 0 0 12px ${agent.color}1a;">
                  ${agent.name[0]}
                </div>
                <div class="min-w-0 flex-1">
                  <h3 onclick="openDirectChatWithAgent('${agent.name}')" class="font-bold text-sm text-slate-100 hover:text-emerald-400 transition font-sans truncate cursor-pointer tracking-tight" title="${agent.name}">${agent.name}</h3>
                  <p class="text-[11px] text-slate-400 font-mono mt-1 leading-relaxed line-clamp-2 min-h-[34px]" title="${agent.role}">
                    ${agent.role}
                  </p>
                </div>
              </div>

              <!-- Spec Matrix (Engine, Model, Workspace, Status) -->
              <div class="bg-[#080d18]/90 p-3 rounded-xl border border-slate-800/90 mb-4 space-y-2 font-mono text-[11px]">
                <div class="flex justify-between items-center gap-2">
                  <span class="text-slate-500 text-[10px] uppercase tracking-wider shrink-0">Engine</span>
                  <span class="text-slate-200 uppercase font-bold text-[10px] bg-slate-900/90 px-2 py-0.5 rounded border border-slate-800">${engKey}</span>
                </div>
                <div class="flex justify-between items-center gap-2">
                  <span class="text-slate-500 text-[10px] uppercase tracking-wider shrink-0">Model</span>
                  <button type="button" onclick="openQuickModelPickerModal('${safeName}', '${engKey}', '${safeModel}', '${safeFleet}')" class="text-cyan-300 hover:text-cyan-200 font-medium truncate max-w-[165px] bg-slate-900/90 hover:bg-cyan-950/80 px-2 py-0.5 rounded border border-slate-800 hover:border-cyan-600 text-right text-[10px] cursor-pointer transition flex items-center gap-1" title="Active LLM: ${modelName} — Click to switch">
                    <span>🧠</span>
                    <span class="truncate">${formatModelDisplay(modelName)}</span>
                    <span class="text-[8px] text-slate-400">▾</span>
                  </button>
                </div>
                <div class="flex justify-between items-center gap-2">
                  <span class="text-slate-500 text-[10px] uppercase tracking-wider shrink-0">Workspace</span>
                  <span class="text-slate-300 truncate max-w-[160px] bg-slate-900/90 px-2 py-0.5 rounded border border-slate-800 text-right text-[10px]" title="/workspace/${agent.workspace || agent.id}">/ws/${agent.workspace || agent.id}</span>
                </div>
                <div class="flex justify-between items-center gap-2">
                  <span class="text-slate-500 text-[10px] uppercase tracking-wider shrink-0">Status</span>
                  <span class="${statusTextClass} capitalize font-semibold flex items-center gap-1.5 text-[10px] shrink-0">
                    <span class="w-1.5 h-1.5 rounded-full ${statusDotClass}"></span>
                    ${agent.state || 'active'}
                  </span>
                </div>
              </div>
            </div>

            <!-- Tidy Two-Tier Action Menu -->
            <div class="pt-3 border-t border-slate-800/80 flex flex-col gap-2">
              <button type="button" onclick="openDirectChatWithAgent('${agent.name}')" class="w-full py-2 px-3 rounded-lg bg-emerald-950/60 hover:bg-emerald-900/90 border border-emerald-700/60 hover:border-emerald-500/80 text-emerald-300 hover:text-emerald-200 text-xs font-mono font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer shadow-sm group/btn whitespace-nowrap" title="Open 1-on-1 Direct Chat with ${agent.name}">
                <span>💬</span>
                <span>1-on-1 Chat</span>
                <span class="text-emerald-400/60 group-hover/btn:translate-x-1 transition-transform">→</span>
              </button>
              <div class="grid grid-cols-2 gap-2">
                <button type="button" onclick="openAgentMemory('${agent.id}')" class="py-1.5 px-2 rounded-lg bg-slate-900/90 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 text-slate-300 hover:text-white text-[11px] font-mono font-medium flex items-center justify-center gap-1.5 transition cursor-pointer shadow-sm whitespace-nowrap" title="View workspace memory & notes">
                  <span>🧠</span> <span>Memory</span>
                </button>
                <button type="button" onclick="openEditAgentModal('${agent.name}')" title="Configure agent prompt, model & workstation settings" class="py-1.5 px-2 rounded-lg bg-slate-900/90 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 text-slate-300 hover:text-cyan-300 text-[11px] font-mono font-medium flex items-center justify-center gap-1.5 transition cursor-pointer shadow-sm whitespace-nowrap">
                  <span>⚙️</span> <span>Configure</span>
                </button>
              </div>
            </div>
          </div>
        `;
      }).join('');
    }

    function openAgentMemory(agentId) {
      activeEditorAgent = agentId;
      switchMainTab('memory');
      loadMemoryExplorer(agentId);
    }

