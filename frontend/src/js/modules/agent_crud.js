    // --- Agent Station CRUD & Onboarding Logic ---
    function setCrudColor(color, theme) {
      document.getElementById('modal-crud-color').value = color;
      document.getElementById('modal-crud-theme').value = theme;
      const buttons = document.querySelectorAll('#crud-color-picker button');
      buttons.forEach(btn => {
        const isMatch = btn.getAttribute('onclick').includes(color);
        btn.classList.toggle('ring-2', isMatch);
        btn.classList.toggle('ring-white', isMatch);
      });
    }

    function renderCrudEngineModelPicks(engineId) {
      const container = document.getElementById('modal-crud-engine-picks');
      if (!container) return;
      const eng = (engineId || 'hermes').toLowerCase();
      const catalog = (window.engineModelsCatalog && window.engineModelsCatalog[eng])
        ? window.engineModelsCatalog[eng]
        : [];
      if (!catalog.length) return;
      container.innerHTML = catalog.map(m => {
        const safeId = m.id.replace(/'/g, "\\'");
        const shortLbl = window.formatShortModelName ? window.formatShortModelName(m.id, eng) : m.id;
        return `<button type="button" onclick="document.getElementById('modal-crud-model').value='${safeId}'" class="px-1.5 py-0.5 rounded bg-slate-900 hover:bg-cyan-950 border border-slate-800 hover:border-cyan-600 text-[10px] text-cyan-300 font-mono transition cursor-pointer" title="${m.label || m.id}">${shortLbl}</button>`;
      }).join('');
    }

    window.onCrudEngineChange = function(engineId) {
      const eng = (engineId || 'hermes').toLowerCase();
      renderCrudEngineModelPicks(eng);
      const modelInput = document.getElementById('modal-crud-model');
      const defModel = (window.engineDefaultsMap && window.engineDefaultsMap[eng]) || 'abacus/gemini-3.8-flash';
      if (modelInput) {
        modelInput.value = defModel;
      }
    };

    function openCreateAgentModal() {
      document.getElementById('modal-crud-title').innerText = 'DEPLOY NEW SPECIALIST AGENT';
      document.getElementById('modal-crud-mode').value = 'create';
      document.getElementById('modal-crud-orig-name').value = '';
      
      const nameInput = document.getElementById('modal-crud-name');
      nameInput.value = '';
      nameInput.removeAttribute('readonly');
      nameInput.classList.remove('opacity-60');

      const engineSelect = document.getElementById('modal-crud-engine');
      if (engineSelect) engineSelect.value = 'hermes';
      renderCrudEngineModelPicks('hermes');

      document.getElementById('modal-crud-role').value = '';
      document.getElementById('modal-crud-model').value = 'abacus/gemini-3.8-flash';
      document.getElementById('modal-crud-fallback').value = '';
      setCrudColor('#10b981', 'orchestrator');
      document.getElementById('modal-crud-voice-gender').value = 'female';
      document.getElementById('modal-crud-voice-pitch').value = '1.0';
      document.getElementById('crud-pitch-val').innerText = '1.0';
      document.getElementById('modal-crud-voice-rate').value = '1.0';
      document.getElementById('crud-rate-val').innerText = '1.0';
      document.getElementById('modal-crud-prompt').value = '';

      document.getElementById('modal-crud-decommission-btn').classList.add('hidden');
      document.getElementById('modal-crud-submit-btn').innerHTML = '<span>🚀</span> <span>Deploy New Agent</span>';

      document.getElementById('agent-crud-modal').classList.remove('hidden');
      const createScrollEl = document.querySelector('#agent-crud-modal .overflow-y-auto');
      if (createScrollEl) createScrollEl.scrollTop = 0;
    }

    function openEditAgentModal(agentName) {
      const cfg = (agentConfigsData || []).find(a => a.name.toLowerCase() === agentName.toLowerCase());
      const ag = agents.find(a => a.name.toLowerCase() === agentName.toLowerCase());

      document.getElementById('modal-crud-title').innerText = `EDIT AGENT STATION: ${agentName.toUpperCase()}`;
      document.getElementById('modal-crud-mode').value = 'edit';
      document.getElementById('modal-crud-orig-name').value = agentName;

      const nameInput = document.getElementById('modal-crud-name');
      nameInput.value = agentName;
      nameInput.removeAttribute('readonly');
      nameInput.classList.remove('opacity-60');

      const resolvedEng = (cfg?.engine || ag?.engine || 'hermes').toLowerCase();
      const engineSelect = document.getElementById('modal-crud-engine');
      if (engineSelect) engineSelect.value = resolvedEng;
      renderCrudEngineModelPicks(resolvedEng);

      document.getElementById('modal-crud-role').value = cfg?.role || ag?.role || '';
      document.getElementById('modal-crud-model').value = cfg?.model || ag?.model || (window.engineDefaultsMap && window.engineDefaultsMap[resolvedEng]) || '';
      const fbs = cfg?.fallback_models || (cfg?.fallback_model ? [cfg.fallback_model] : []);
      document.getElementById('modal-crud-fallback').value = fbs[0] || '';
      setCrudColor(ag?.color || '#10b981', ag?.theme || 'orchestrator');

      const v = ag?.voice || {};
      document.getElementById('modal-crud-voice-gender').value = v.gender || 'female';
      document.getElementById('modal-crud-voice-pitch').value = v.pitch !== undefined ? v.pitch : 1.0;
      document.getElementById('crud-pitch-val').innerText = v.pitch !== undefined ? v.pitch : 1.0;
      document.getElementById('modal-crud-voice-rate').value = v.rate !== undefined ? v.rate : 1.0;
      document.getElementById('crud-rate-val').innerText = v.rate !== undefined ? v.rate : 1.0;
      document.getElementById('modal-crud-prompt').value = cfg?.system_prompt || '';

      document.getElementById('modal-crud-decommission-btn').classList.remove('hidden');
      document.getElementById('modal-crud-submit-btn').innerHTML = '<span>💾</span> <span>Save Agent Settings</span>';

      document.getElementById('agent-crud-modal').classList.remove('hidden');
      const editScrollEl = document.querySelector('#agent-crud-modal .overflow-y-auto');
      if (editScrollEl) editScrollEl.scrollTop = 0;
    }

    function closeAgentCrudModal() {
      document.getElementById('agent-crud-modal').classList.add('hidden');
    }

    async function submitSaveAgent() {
      const mode = document.getElementById('modal-crud-mode').value;
      const origName = document.getElementById('modal-crud-orig-name').value;
      const name = document.getElementById('modal-crud-name').value.trim();
      const role = document.getElementById('modal-crud-role').value.trim();
      const engine = document.getElementById('modal-crud-engine')?.value || 'hermes';
      const model = document.getElementById('modal-crud-model').value.trim();
      const fallback = document.getElementById('modal-crud-fallback').value.trim();
      const color = document.getElementById('modal-crud-color').value;
      const theme = document.getElementById('modal-crud-theme').value;
      const voiceGender = document.getElementById('modal-crud-voice-gender').value;
      const voicePitch = parseFloat(document.getElementById('modal-crud-voice-pitch').value);
      const voiceRate = parseFloat(document.getElementById('modal-crud-voice-rate').value);
      const prompt = document.getElementById('modal-crud-prompt').value.trim();
      const activeInstance = (typeof currentInstanceKey !== 'undefined' && currentInstanceKey) ? currentInstanceKey : 'agents_bs';

      if (!name) return alert('Agent Name is required.');
      if (!role) return alert('Role & Responsibility is required.');
      if (!model) return alert('Primary LLM Model is required.');

      try {
        if (mode === 'create') {
          const res = await fetch('/api/agents/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: name,
              role: role,
              engine: engine,
              model: model,
              fallback_model: fallback || null,
              fallback_models: fallback ? [fallback] : [],
              color: color,
              theme: theme,
              voice_gender: voiceGender,
              voice_pitch: voicePitch,
              voice_rate: voiceRate,
              system_prompt: prompt,
              instance: activeInstance
            })
          });
          if (!res.ok) {
            const err = await res.json();
            return alert(`Deployment error: ${err.detail || 'Failed to create agent'}`);
          }
          alert(`Agent '${name}' successfully provisioned and deployed to workstation!`);
        } else {
          const updatePayload = {
            role: role,
            engine: engine,
            model: model,
            fallback_model: fallback || null,
            fallback_models: fallback ? [fallback] : [],
            color: color,
            theme: theme,
            voice_gender: voiceGender,
            voice_pitch: voicePitch,
            voice_rate: voiceRate,
            system_prompt: prompt || null,
            instance: activeInstance
          };
          if (name.toLowerCase() !== origName.toLowerCase()) {
            updatePayload.new_name = name;
          }

          const res = await fetch(`/api/agents/${encodeURIComponent(origName)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updatePayload)
          });
          if (!res.ok) {
            const err = await res.json();
            return alert(`Update error: ${err.detail || 'Failed to update agent'}`);
          }
          const successMsg = updatePayload.new_name
            ? `Agent '${origName}' renamed to '${name}' and updated in config.yaml!`
            : `Workstation changes for '${origName}' saved to config.yaml!`;
          alert(successMsg);
        }

        closeAgentCrudModal();
        await loadModelsConfig();
        loadFleetMetrics();
        if (activeTab === 'roster') renderFleetRoster();
      } catch (e) {
        alert('Error: ' + e);
      }
    }

    async function decommissionCurrentAgent() {
      const origName = document.getElementById('modal-crud-orig-name').value;
      if (!origName) return;

      const confirmed = confirm(`Are you sure you want to decommission '${origName}' from the fleet?\n\nIts workspace and memories will be SAFELY ARCHIVED with a timestamp in the workspace folder. No data will be lost.`);
      if (!confirmed) return;

      const activeInstance = (typeof currentInstanceKey !== 'undefined' && currentInstanceKey) ? currentInstanceKey : 'agents_bs';
      try {
        const res = await fetch(`/api/agents/${encodeURIComponent(origName)}?instance=${encodeURIComponent(activeInstance)}`, { method: 'DELETE' });
        if (!res.ok) {
          const err = await res.json();
          return alert(`Decommission error: ${err.detail || 'Failed to decommission agent'}`);
        }
        alert(`Agent '${origName}' decommissioned. Workstation cleared and workspace archived.`);
        closeAgentCrudModal();
        await loadModelsConfig();
        loadFleetMetrics();
        if (activeTab === 'roster') renderFleetRoster();
      } catch (e) {
        alert('Error: ' + e);
      }
    }

