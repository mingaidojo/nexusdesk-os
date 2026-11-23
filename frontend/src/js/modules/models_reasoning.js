    // --- TAB 4: Models, Fallback Chain & Reasoning ---
    let availableAgentsList = ['Solaris', 'Scribe', 'Pylon', 'Lore', 'Chroma', 'Chorusius'];
    let agentConfigsData = [];
    let globalModelConfig = { default: '', provider: '', base_url: '' };

    async function loadModelsConfig(targetInst) {
      try {
        const inst = targetInst || (typeof currentInstanceKey !== 'undefined' && currentInstanceKey) || localStorage.getItem('nexusdesk_instance') || 'agents_bs';
        const res = await fetch(`/api/config/models?instance=${encodeURIComponent(inst)}&_t=${Date.now()}`);
        const data = await res.json();
        availableAgentsList = data.available_agents || ['Solaris', 'Scribe', 'Pylon', 'Lore', 'Chroma', 'Chorusius'];
        agentConfigsData = data.agents || [];
        syncDynamicAgentsToFloor(agentConfigsData);
        fallbackChainData = data.fallback_providers || [];
        reasoningOverridesData = data.reasoning_overrides || {};

        if (data.global_model) {
          globalModelConfig = data.global_model;
          const gmDisplay = document.getElementById('global-model-name-display');
          if (gmDisplay) gmDisplay.innerText = data.global_model.default || 'deepseek-ai/DeepSeek-V4.1-Flash';
          const gmBadge = document.getElementById('global-model-provider-badge');
          if (gmBadge) gmBadge.innerText = (data.global_model.provider || 'abacus').toUpperCase();
        }

        renderAgentModelsGrid();
        renderFallbackChainRows();

        const globalSelect = document.getElementById('global-reasoning-select');
        if (globalSelect) globalSelect.value = data.reasoning_effort || 'none';

        await Promise.all([
          loadModelLibrary(),
          loadAgentMemorySpecs()
        ]);

      } catch (e) {
        console.error('Failed to load models config:', e);
      }
    }

    function isAgentInStep(fb, agentName) {
      if (!fb.agents || fb.agents.includes('all')) return true;
      return fb.agents.map(a => a.toLowerCase()).includes(agentName.toLowerCase());
    }

    function getActiveFallbackCountForAgent(agentName) {
      return fallbackChainData.filter(fb => isAgentInStep(fb, agentName)).length;
    }

    function renderAgentModelsGrid() {
      const agentsGrid = document.getElementById('model-agents-grid');
      if (!agentsGrid) return;
      agentsGrid.innerHTML = '';
      agentConfigsData.forEach(a => {
        const activeRoutesCount = getActiveFallbackCountForAgent(a.name);
        const fbs = a.fallback_models || (a.fallback_model ? [a.fallback_model] : []);
        const totalRoutes = fbs.length + activeRoutesCount;

        agentsGrid.innerHTML += `
          <div class="bg-slate-950 p-4 rounded-xl border border-slate-800 flex flex-col justify-between hover:border-slate-700 transition shadow-lg">
            <div>
              <div class="flex justify-between items-center mb-1.5">
                <strong class="text-sm text-slate-100 font-bold flex items-center gap-1.5">
                  <span class="w-2 h-2 rounded-full bg-emerald-400"></span>
                  <span>${a.name}</span>
                </strong>
                <span class="text-[10px] px-2 py-0.5 rounded bg-emerald-950/80 text-emerald-400 border border-emerald-800/80 font-mono font-semibold">ONLINE</span>
              </div>
              <p class="text-[11px] text-slate-400 mb-3 line-clamp-2">${a.role}</p>
              <div class="space-y-2 font-mono text-xs">
                <div class="bg-slate-900/60 p-2 rounded border border-slate-800/60">
                  <span class="text-slate-500 block text-[10px] font-semibold uppercase tracking-wider">Primary Model:</span>
                  <span class="text-cyan-300 font-semibold break-all text-[11px]">${a.model}</span>
                </div>
                <div class="bg-slate-900/60 p-2 rounded border border-slate-800/60">
                  <span class="text-slate-500 block text-[10px] font-semibold uppercase tracking-wider">Direct Failbacks (${fbs.length} of 4):</span>
                  ${fbs.length > 0 ? `
                    <div class="flex flex-col gap-1 mt-1">
                      ${fbs.map((m, i) => `
                        <div class="flex items-center gap-1.5 text-[10px]">
                          <span class="w-3.5 h-3.5 rounded-full bg-amber-950/80 border border-amber-800/80 text-amber-400 flex items-center justify-center font-bold text-[8px] shrink-0">#${i+1}</span>
                          <span class="text-amber-300 break-all truncate">${m}</span>
                        </div>
                      `).join('')}
                    </div>
                  ` : `
                    <span class="text-slate-500 italic text-[11px]">Inherits Global Default Chain</span>
                  `}
                </div>
                <div class="flex justify-between items-center px-1 text-[11px]">
                  <span class="text-slate-500">Total Failover Routes:</span>
                  <span class="text-emerald-400 font-semibold">${totalRoutes} Total (${fbs.length} Direct + ${activeRoutesCount} Global)</span>
                </div>
              </div>
            </div>
            <div class="mt-4 pt-3 border-t border-slate-800/80 flex">
              <button onclick="openAgentModelModal('${a.name}')" class="w-full py-2 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-xs font-semibold text-slate-200 hover:text-white flex items-center justify-center gap-1.5 transition">
                <span>✏️</span> <span>Edit Model & Fallback</span>
              </button>
            </div>
          </div>
        `;
      });
    }

    const MAX_FALLBACK_TIERS = 5;

    function renderFallbackChainRows() {
      const container = document.getElementById('fallback-chain-list');
      if (!container) return;
      container.innerHTML = '';

      // Enforce max tiers in state
      if (fallbackChainData.length > MAX_FALLBACK_TIERS) {
        fallbackChainData = fallbackChainData.slice(0, MAX_FALLBACK_TIERS);
      }

      // Update Add button status
      const addBtn = document.getElementById('btn-add-fallback-step') || document.querySelector('button[onclick="openAddFallbackModal()"]');
      if (addBtn) {
        if (fallbackChainData.length >= MAX_FALLBACK_TIERS) {
          addBtn.disabled = true;
          addBtn.classList.add('opacity-50', 'cursor-not-allowed');
          addBtn.classList.remove('hover:bg-cyan-600');
          addBtn.innerHTML = `<span>🔒 Max ${MAX_FALLBACK_TIERS} Tiers Reached</span>`;
        } else {
          addBtn.disabled = false;
          addBtn.classList.remove('opacity-50', 'cursor-not-allowed');
          addBtn.classList.add('hover:bg-cyan-600');
          addBtn.innerHTML = '<span>+ Add Fallback Tier</span>';
        }
      }

      if (fallbackChainData.length === 0) {
        container.innerHTML = '<div class="text-center py-6 text-slate-500 text-xs">No fallback failover providers configured. Click "+ Add Fallback Tier" to add one.</div>';
        return;
      }

      fallbackChainData.forEach((fb, idx) => {
        const isAll = !fb.agents || fb.agents.includes('all') || availableAgentsList.every(n => isAgentInStep(fb, n));
        
        container.innerHTML += `
          <div class="bg-slate-950 p-3.5 rounded-xl border border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs font-mono transition hover:border-slate-700">
            <div class="flex items-start md:items-center gap-3.5 flex-1 min-w-0">
              <span class="w-8 h-8 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-center font-bold text-emerald-400 text-xs flex-shrink-0 mt-0.5 md:mt-0 shadow-inner">#${idx + 1}</span>
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2.5 flex-wrap">
                  <strong class="text-white text-sm font-bold tracking-wide">${(fb.provider || '').toUpperCase()}</strong>
                  <span class="text-cyan-300 text-[11px] font-semibold bg-cyan-950/60 px-2 py-0.5 rounded border border-cyan-800/50">${fb.model}</span>
                  <span class="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-900 text-slate-300 border border-slate-800">Priority Tier ${idx + 1} of ${fallbackChainData.length}</span>
                </div>
                ${fb.base_url ? `<div class="text-slate-500 text-[10px] truncate max-w-lg mt-1 font-mono">${fb.base_url}</div>` : ''}
                
                <!-- Target Agents Interactive Pills -->
                <div class="mt-2.5 flex flex-wrap items-center gap-1.5">
                  <span class="text-slate-400 font-sans font-semibold text-[10px] uppercase tracking-wider mr-1">Applied to Agents:</span>
                  ${isAll ? `
                    <span class="px-2 py-0.5 rounded-full bg-emerald-950/80 text-emerald-300 border border-emerald-700/60 text-[10px] font-mono font-semibold flex items-center gap-1 shadow-sm">
                      <span>🌐</span> All Agents
                    </span>
                  ` : ''}
                  ${availableAgentsList.map(aName => {
                    const selected = isAgentInStep(fb, aName);
                    return `
                      <button type="button" onclick="toggleAgentForStep(${idx}, '${aName}')" 
                        class="px-2 py-0.5 rounded text-[10px] font-mono font-semibold transition flex items-center gap-1 ${
                          selected 
                            ? 'bg-cyan-950/90 text-cyan-300 border border-cyan-700/80 hover:bg-cyan-900/90 shadow-sm' 
                            : 'bg-slate-900/80 text-slate-500 border border-slate-800 hover:text-slate-300 hover:border-slate-700'
                        }" title="Click to toggle ${aName} on this fallback step">
                        <span>${selected ? '✓' : '+'}</span>
                        <span>${aName}</span>
                      </button>
                    `;
                  }).join('')}
                  <button type="button" onclick="toggleAllAgentsForStep(${idx})" 
                    class="px-2 py-0.5 rounded text-[10px] font-sans font-semibold transition text-slate-400 bg-slate-900 hover:bg-slate-800 hover:text-white border border-slate-800" 
                    title="Toggle all agents for this step">
                    ${isAll ? 'Select None' : 'Select All'}
                  </button>
                </div>
              </div>
            </div>
            
            <div class="flex items-center gap-2 self-end md:self-center flex-shrink-0 pt-2 md:pt-0 border-t md:border-t-0 border-slate-800/60 w-full md:w-auto justify-end">
              <!-- Tier Order Selector -->
              <div class="flex items-center gap-1 bg-slate-900/90 px-2 py-1 rounded border border-slate-800">
                <span class="text-slate-400 text-[10px] uppercase font-sans font-semibold">Tier:</span>
                <select onchange="reorderFallbackStep(${idx}, parseInt(this.value))" class="bg-slate-950 border border-slate-700 text-cyan-300 text-xs rounded px-1.5 py-0.5 font-mono cursor-pointer focus:outline-none" title="Set order priority tier">
                  ${Array.from({length: fallbackChainData.length}, (_, i) => `
                    <option value="${i}" ${idx === i ? 'selected' : ''}>${i + 1} (${i === 0 ? 'Highest' : (i === fallbackChainData.length - 1 ? 'Lowest' : 'Priority')})</option>
                  `).join('')}
                </select>
              </div>
              <button onclick="openEditFallbackModal(${idx})" class="px-2.5 py-1.5 rounded-lg bg-cyan-950 hover:bg-cyan-900 text-cyan-300 border border-cyan-800 text-xs font-sans font-semibold flex items-center gap-1 transition shadow-sm" title="Edit Provider, Model & Agents">
                <span>✏️</span> <span>Edit</span>
              </button>
              <button onclick="moveFallbackStep(${idx}, -1)" ${idx === 0 ? 'disabled class="opacity-30 p-1.5 px-2 rounded bg-slate-900 text-slate-500"' : 'class="p-1.5 px-2 rounded bg-slate-800 hover:bg-slate-700 text-slate-300"'} title="Move Up Priority">▲</button>
              <button onclick="moveFallbackStep(${idx}, 1)" ${idx === fallbackChainData.length - 1 ? 'disabled class="opacity-30 p-1.5 px-2 rounded bg-slate-900 text-slate-500"' : 'class="p-1.5 px-2 rounded bg-slate-800 hover:bg-slate-700 text-slate-300"'} title="Move Down Priority">▼</button>
              <button onclick="removeFallbackStep(${idx})" class="p-1.5 px-2 rounded bg-rose-950/80 text-rose-400 hover:bg-rose-900 border border-rose-900/60 ml-0.5 transition" title="Delete Step">🗑</button>
            </div>
          </div>
        `;
      });
    }

    function reorderFallbackStep(currentIndex, newIndex) {
      if (currentIndex === newIndex || newIndex < 0 || newIndex >= fallbackChainData.length) return;
      const item = fallbackChainData.splice(currentIndex, 1)[0];
      fallbackChainData.splice(newIndex, 0, item);
      renderFallbackChainRows();
      renderAgentModelsGrid();
      markFallbackChainUnsaved();
    }

    function toggleAgentForStep(index, agentName) {
      const fb = fallbackChainData[index];
      if (!fb) return;
      const isAll = !fb.agents || fb.agents.includes('all') || availableAgentsList.every(n => isAgentInStep(fb, n));
      
      let currentAgents = [];
      if (isAll) {
        currentAgents = [...availableAgentsList];
      } else {
        currentAgents = (fb.agents || []).map(a => a.toLowerCase());
      }

      const matchIdx = currentAgents.findIndex(a => a.toLowerCase() === agentName.toLowerCase());
      if (matchIdx >= 0) {
        currentAgents.splice(matchIdx, 1);
      } else {
        currentAgents.push(agentName);
      }

      if (availableAgentsList.every(a => currentAgents.map(x => x.toLowerCase()).includes(a.toLowerCase()))) {
        fb.agents = ['all'];
      } else {
        fb.agents = currentAgents;
      }

      renderFallbackChainRows();
      renderAgentModelsGrid();
      markFallbackChainUnsaved();
    }

    function toggleAllAgentsForStep(index) {
      const fb = fallbackChainData[index];
      if (!fb) return;
      const isAll = !fb.agents || fb.agents.includes('all') || availableAgentsList.every(n => isAgentInStep(fb, n));
      
      if (isAll) {
        fb.agents = [];
      } else {
        fb.agents = ['all'];
      }

      renderFallbackChainRows();
      renderAgentModelsGrid();
      markFallbackChainUnsaved();
    }

    function markFallbackChainUnsaved() {
      const btn = document.querySelector('button[onclick="saveFallbackChain()"]');
      if (btn) {
        btn.classList.add('animate-pulse', 'bg-amber-600');
        btn.classList.remove('bg-emerald-600');
        btn.innerText = '💾 Save Chain Changes *';
      }
    }

    function moveFallbackStep(index, direction) {
      const targetIndex = index + direction;
      if (targetIndex < 0 || targetIndex >= fallbackChainData.length) return;
      const temp = fallbackChainData[index];
      fallbackChainData[index] = fallbackChainData[targetIndex];
      fallbackChainData[targetIndex] = temp;
      renderFallbackChainRows();
      renderAgentModelsGrid();
      markFallbackChainUnsaved();
    }

    function removeFallbackStep(index) {
      if (!confirm('Are you sure you want to remove this fallback step from the failover sequence?')) return;
      fallbackChainData.splice(index, 1);
      renderFallbackChainRows();
      renderAgentModelsGrid();
      markFallbackChainUnsaved();
    }

    function populateModalAgentCheckboxes(selectedAgents) {
      const container = document.getElementById('modal-fb-agents-checkboxes');
      if (!container) return;
      container.innerHTML = '';
      const isAll = !selectedAgents || selectedAgents.includes('all') || availableAgentsList.every(n => selectedAgents.includes(n));

      availableAgentsList.forEach(aName => {
        const isChecked = isAll || (selectedAgents && selectedAgents.map(x => x.toLowerCase()).includes(aName.toLowerCase()));
        container.innerHTML += `
          <label class="flex items-center gap-2 p-1.5 rounded hover:bg-slate-900 cursor-pointer select-none">
            <input type="checkbox" name="modal-fb-agent-check" value="${aName}" ${isChecked ? 'checked' : ''} class="w-4 h-4 accent-cyan-500 rounded bg-slate-900 border-slate-700" />
            <span class="text-xs text-slate-200 font-mono font-medium">${aName}</span>
          </label>
        `;
      });
    }

    function toggleAllModalAgentCheckboxes() {
      const checkboxes = document.querySelectorAll('input[name="modal-fb-agent-check"]');
      const allChecked = Array.from(checkboxes).every(cb => cb.checked);
      checkboxes.forEach(cb => cb.checked = !allChecked);
    }

    function openAddFallbackModal() {
      if (fallbackChainData.length >= MAX_FALLBACK_TIERS) {
        alert(`Maximum of ${MAX_FALLBACK_TIERS} fallback tiers allowed. Please edit, reorder, or delete an existing step.`);
        return;
      }
      document.getElementById('modal-fb-index').value = '-1';
      document.getElementById('modal-fb-title').innerText = `ADD NEW FALLBACK STEP (MAX ${MAX_FALLBACK_TIERS} TIERS)`;
      document.getElementById('modal-fb-provider').value = '';
      document.getElementById('modal-fb-model').value = '';
      document.getElementById('modal-fb-baseurl').value = '';
      document.getElementById('modal-fb-submit-btn').innerText = 'Add Step to Chain';
      populateModalAgentCheckboxes(['all']);
      document.getElementById('fallback-modal').classList.remove('hidden');
    }

    function openEditFallbackModal(index) {
      const fb = fallbackChainData[index];
      if (!fb) return;
      document.getElementById('modal-fb-index').value = index;
      document.getElementById('modal-fb-title').innerText = `EDIT FALLBACK STEP #${index + 1}`;
      document.getElementById('modal-fb-provider').value = fb.provider || '';
      document.getElementById('modal-fb-model').value = fb.model || '';
      document.getElementById('modal-fb-baseurl').value = fb.base_url || '';
      document.getElementById('modal-fb-submit-btn').innerText = 'Save Step Changes';
      populateModalAgentCheckboxes(fb.agents || ['all']);
      document.getElementById('fallback-modal').classList.remove('hidden');
    }

    function closeAddFallbackModal() {
      document.getElementById('fallback-modal').classList.add('hidden');
    }

    function submitSaveFallbackStep() {
      const idx = parseInt(document.getElementById('modal-fb-index').value, 10);
      const provider = document.getElementById('modal-fb-provider').value.trim();
      const model = document.getElementById('modal-fb-model').value.trim();
      const baseUrl = document.getElementById('modal-fb-baseurl').value.trim();
      if (!provider || !model) return alert('Provider and model are required.');

      const checkedAgents = Array.from(document.querySelectorAll('input[name="modal-fb-agent-check"]:checked')).map(cb => cb.value);
      let agentsVal = checkedAgents;
      if (checkedAgents.length === availableAgentsList.length || checkedAgents.length === 0) {
        agentsVal = ['all'];
      }

      const stepData = { provider, model, agents: agentsVal };
      if (baseUrl) stepData.base_url = baseUrl;

      if (idx >= 0 && idx < fallbackChainData.length) {
        fallbackChainData[idx] = stepData;
      } else {
        fallbackChainData.push(stepData);
      }

      renderFallbackChainRows();
      renderAgentModelsGrid();
      markFallbackChainUnsaved();
      closeAddFallbackModal();
    }

    async function saveFallbackChain() {
      const btn = document.querySelector('button[onclick="saveFallbackChain()"]');
      try {
        if (btn) btn.innerText = 'Saving...';
        const res = await fetch('/api/config/fallback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fallback_providers: fallbackChainData })
        });
        if (res.ok) {
          alert('Fallback failover chain successfully updated and saved to config.yaml!');
          if (btn) {
            btn.classList.remove('animate-pulse', 'bg-amber-600');
            btn.classList.add('bg-emerald-600');
            btn.innerText = '💾 Save Chain to config.yaml';
          }
          await loadModelsConfig();
        } else {
          alert('Failed to save fallback chain.');
        }
      } catch (e) {
        alert('Error: ' + e);
      }
    }

    // Agent Model Edit Modal Logic (4 Fallback Tiers)
    function openAgentModelModal(agentName) {
      const a = agentConfigsData.find(x => x.name.toLowerCase() === agentName.toLowerCase())
        || (typeof agents !== 'undefined' && Array.isArray(agents) ? agents.find(x => x.name.toLowerCase() === agentName.toLowerCase()) : null);
      if (!a) return;
      const eng = (a.engine || 'hermes').toLowerCase();
      document.getElementById('modal-agent-name').value = a.name;
      document.getElementById('modal-agent-title').innerText = `EDIT MODEL & FAILBACK: ${a.name.toUpperCase()} [${eng.toUpperCase()}]`;
      document.getElementById('modal-agent-primary').value = a.model || '';

      // Populate engine-compatible quick picks (BL-MOD-31)
      const picksEl = document.getElementById('modal-agent-engine-picks');
      if (picksEl && window.engineModelsCatalog) {
        const cat = window.engineModelsCatalog[eng] || window.engineModelsCatalog.hermes || [];
        picksEl.innerHTML = `<span class="text-[10px] text-slate-500 mr-1 self-center">[${eng.toUpperCase()}] Picks:</span>` +
          cat.map(m => {
            const safeId = m.id.replace(/'/g, "\\'");
            const shortLbl = window.formatShortModelName ? window.formatShortModelName(m.id, eng) : m.id;
            return `<button type="button" onclick="document.getElementById('modal-agent-primary').value='${safeId}'" class="px-1.5 py-0.5 rounded bg-slate-900 hover:bg-cyan-950 border border-slate-800 hover:border-cyan-600 text-[10px] text-cyan-400 cursor-pointer transition" title="${m.label || m.id}">${shortLbl}</button>`;
          }).join('');
      }
      
      const fallbacks = (a.fallback_models && a.fallback_models.length > 0)
        ? a.fallback_models
        : (a.fallback_model ? [a.fallback_model] : []);

      document.getElementById('modal-agent-fb-1').value = fallbacks[0] || '';
      document.getElementById('modal-agent-fb-2').value = fallbacks[1] || '';
      document.getElementById('modal-agent-fb-3').value = fallbacks[2] || '';
      document.getElementById('modal-agent-fb-4').value = fallbacks[3] || '';

      document.getElementById('agent-model-modal').classList.remove('hidden');
    }

    function closeAgentModelModal() {
      document.getElementById('agent-model-modal').classList.add('hidden');
    }

    async function submitSaveAgentModel() {
      const agentName = document.getElementById('modal-agent-name').value;
      const model = document.getElementById('modal-agent-primary').value.trim();
      const fb1 = document.getElementById('modal-agent-fb-1').value.trim();
      const fb2 = document.getElementById('modal-agent-fb-2').value.trim();
      const fb3 = document.getElementById('modal-agent-fb-3').value.trim();
      const fb4 = document.getElementById('modal-agent-fb-4').value.trim();

      if (!model) return alert('Primary model cannot be empty.');

      const fallbackModels = [fb1, fb2, fb3, fb4].filter(m => m.length > 0);
      const activeInstance = (typeof currentInstanceKey !== 'undefined' && currentInstanceKey)
        ? currentInstanceKey
        : (localStorage.getItem('nexusdesk_instance') || 'agents_bs');

      try {
        const res = await fetch('/api/config/agent-model', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agent_name: agentName,
            model: model,
            fallback_models: fallbackModels,
            fallback_model: fallbackModels[0] || null,
            instance: activeInstance
          })
        });

        if (res.ok) {
          closeAgentModelModal();
          // Sync 1-on-1 Direct Chat and War Room state immediately without page reload
          if (typeof agents !== 'undefined' && Array.isArray(agents)) {
            const ag = agents.find(a => a.name.toLowerCase() === agentName.toLowerCase());
            if (ag) ag.model = model;
          }
          if (typeof selectedAgent !== 'undefined' && selectedAgent && selectedAgent.name.toLowerCase() === agentName.toLowerCase()) {
            selectedAgent.model = model;
            if (typeof populateDirectChatModelSelector === 'function') populateDirectChatModelSelector(selectedAgent);
          }
          if (typeof renderConsoleAgentCards === 'function') renderConsoleAgentCards();
          if (typeof loadEngineModelsCatalog === 'function') loadEngineModelsCatalog(true);
          if (typeof loadWarRoomParticipants === 'function') loadWarRoomParticipants();
          await loadModelsConfig();
          if (typeof loadFleetMetrics === 'function') loadFleetMetrics();
        } else {
          const err = await res.json();
          alert(`Failed to update agent model: ${err.detail || 'Unknown error'}`);
        }
      } catch (e) {
        alert('Error: ' + e);
      }
    }

    // Default Global Model Modal Logic
    function openEditGlobalModelModal() {
      if (globalModelConfig) {
        document.getElementById('modal-global-model-input').value = globalModelConfig.default || '';
        document.getElementById('modal-global-provider-input').value = globalModelConfig.provider || '';
        document.getElementById('modal-global-url-input').value = globalModelConfig.base_url || '';
      }
      document.getElementById('global-model-modal').classList.remove('hidden');
    }

    function closeEditGlobalModelModal() {
      document.getElementById('global-model-modal').classList.add('hidden');
    }

    async function submitSaveGlobalModel() {
      const defaultModel = document.getElementById('modal-global-model-input').value.trim();
      const provider = document.getElementById('modal-global-provider-input').value.trim();
      const baseUrl = document.getElementById('modal-global-url-input').value.trim();

      if (!defaultModel) return alert('Global default model cannot be empty.');

      try {
        const res = await fetch('/api/config/global-model', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            default: defaultModel,
            provider: provider || null,
            base_url: baseUrl || null
          })
        });

        if (res.ok) {
          alert('Successfully updated Default Global Model in config.yaml!');
          closeEditGlobalModelModal();
          await loadModelsConfig();
        } else {
          const err = await res.json();
          alert(`Failed to update global model: ${err.detail || 'Unknown error'}`);
        }
      } catch (e) {
        alert('Error: ' + e);
      }
    }

