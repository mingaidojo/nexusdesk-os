    // --- Model Library & Agent Memory Allocation Logic ---
    let agentMemorySpecsData = [];
    let modelLibraryData = [];

    async function updateReasoningOverride(modelName, value) {
      reasoningOverridesData[modelName] = value;
      const globalVal = document.getElementById('global-reasoning-select')?.value || 'none';
      try {
        await fetch('/api/config/reasoning', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            reasoning_effort: globalVal,
            reasoning_overrides: reasoningOverridesData
          })
        });
      } catch (e) {
        console.error('Failed to auto-save reasoning override:', e);
      }
    }

    async function updateGlobalReasoningEffort(effort) {
      try {
        const res = await fetch('/api/config/reasoning', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            reasoning_effort: effort,
            reasoning_overrides: reasoningOverridesData
          })
        });
        if (!res.ok) throw new Error(await res.text());
        const sel = document.getElementById('global-reasoning-select');
        if (sel) sel.value = effort;
      } catch (e) {
        alert('Failed to update global reasoning effort: ' + e);
      }
    }

    async function saveReasoningSettings() {
      const globalVal = document.getElementById('global-reasoning-select')?.value || 'none';
      try {
        const res = await fetch('/api/config/reasoning', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            reasoning_effort: globalVal,
            reasoning_overrides: reasoningOverridesData
          })
        });
        if (res.ok) alert('Reasoning settings successfully updated in config.yaml!');
        else alert('Failed to save reasoning settings.');
      } catch (e) {
        alert('Error: ' + e);
      }
    }

    async function loadAgentMemorySpecs() {
      try {
        const res = await fetch('/api/agents/memory-specs');
        const data = await res.json();
        agentMemorySpecsData = data.agents || [];
        renderAgentMemorySpecs();
      } catch (e) {
        console.error('Failed to load agent memory specs:', e);
      }
    }

    function renderAgentMemorySpecs() {
      const container = document.getElementById('agent-memory-specs-grid');
      if (!container) return;

      if (!agentMemorySpecsData.length) {
        container.innerHTML = '<div class="col-span-3 text-slate-500 text-xs font-mono p-4">No agent memory specs available.</div>';
        return;
      }

      container.innerHTML = agentMemorySpecsData.map(a => {
        const barWidth = Math.min(Math.max(a.utilization_percent, 1), 100);
        const barColor = a.health_color === 'emerald' ? 'bg-emerald-500' :
                         a.health_color === 'amber' ? 'bg-amber-500' : 'bg-rose-500';
        const textBadgeColor = a.health_color === 'emerald' ? 'bg-emerald-950 text-emerald-300 border-emerald-800' :
                               a.health_color === 'amber' ? 'bg-amber-950 text-amber-300 border-amber-800' : 'bg-rose-950 text-rose-300 border-rose-800';

        return `
          <div class="bg-slate-950 p-4 rounded-xl border border-slate-800 flex flex-col justify-between hover:border-slate-700 transition shadow-lg">
            <div>
              <div class="flex items-center justify-between mb-2">
                <strong class="text-xs text-slate-100 font-pixel flex items-center gap-1.5">
                  <span>🤖</span> <span>${a.name}</span>
                </strong>
                <span class="px-2 py-0.5 rounded text-[9px] font-mono font-bold border ${textBadgeColor}">
                  ${a.health} (${a.utilization_percent}%)
                </span>
              </div>

              <div class="text-[11px] font-mono text-slate-400 mb-2 truncate" title="${a.role}">
                ${a.role}
              </div>

              <!-- Memory Stats Pill -->
              <div class="bg-slate-900/80 p-2.5 rounded-lg border border-slate-800/80 space-y-1 text-[10px] font-mono mb-3">
                <div class="flex justify-between">
                  <span class="text-slate-500">Active Memory:</span>
                  <span class="text-slate-200 font-semibold">${a.total_kb} KB (~${a.estimated_tokens.toLocaleString()} tokens)</span>
                </div>
                <div class="flex justify-between">
                  <span class="text-slate-500">Model Context:</span>
                  <span class="text-cyan-400 font-semibold">${a.max_context_label}</span>
                </div>
                <div class="flex justify-between">
                  <span class="text-slate-500">Assigned Model:</span>
                  <span class="text-slate-300 truncate max-w-[150px]">${a.model}</span>
                </div>
              </div>

              <!-- Progress Bar -->
              <div class="space-y-1 mb-2.5">
                <div class="flex justify-between text-[9px] font-mono text-slate-400">
                  <span>Context Load</span>
                  <span>${a.estimated_tokens.toLocaleString()} / ${a.max_context.toLocaleString()} tokens</span>
                </div>
                <div class="w-full h-2 rounded-full bg-slate-900 overflow-hidden border border-slate-800">
                  <div class="h-full rounded-full ${barColor} transition-all duration-500" style="width: ${barWidth}%;"></div>
                </div>
              </div>

              <!-- Recommendation Banner -->
              <p class="text-[10px] font-mono text-slate-300 leading-snug bg-slate-900/40 p-2 rounded border border-slate-800/60 mb-3">
                ${a.recommendation}
              </p>
            </div>

            <!-- Quick Action Buttons -->
            <div class="grid grid-cols-2 gap-2 pt-2 border-t border-slate-800/80 text-xs font-semibold">
              <button onclick="openAgentModelModal('${a.name}')" class="py-1 px-2 rounded bg-cyan-950 hover:bg-cyan-900 text-cyan-300 border border-cyan-800/80 text-[10px] transition text-center flex items-center justify-center gap-1 font-mono">
                <span>⚙️</span> <span>Allocate Model</span>
              </button>
              <button onclick="openAgentMemory('${a.name.toLowerCase()}')" class="py-1 px-2 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[10px] transition text-center flex items-center justify-center gap-1 font-mono">
                <span>🧠</span> <span>Vault Notes</span>
              </button>
            </div>
          </div>
        `;
      }).join('');
    }

    async function loadModelLibrary() {
      try {
        const res = await fetch('/api/models/library');
        const data = await res.json();
        modelLibraryData = data.models || [];
        renderModelLibrary();
      } catch (e) {
        console.error('Failed to load model library:', e);
      }
    }

    function renderModelLibrary(filterQuery = '') {
      const container = document.getElementById('model-library-grid');
      if (!container) return;

      const q = (filterQuery || '').trim().toLowerCase();
      const items = modelLibraryData.filter(m => {
        if (!q) return true;
        return m.name.toLowerCase().includes(q) ||
               m.id.toLowerCase().includes(q) ||
               m.provider_label.toLowerCase().includes(q) ||
               m.category.toLowerCase().includes(q) ||
               m.max_context_label.toLowerCase().includes(q);
      });

      if (!items.length) {
        container.innerHTML = '<div class="col-span-2 text-slate-500 text-xs font-mono p-4">No matching models found.</div>';
        return;
      }

      container.innerHTML = items.map(m => {
        const providerBadgeColor =
          m.provider === 'abacus' ? 'bg-cyan-950 text-cyan-300 border-cyan-800' :
          m.provider === 'groq' ? 'bg-emerald-950 text-emerald-300 border-emerald-800' :
          m.provider === 'nvidia' ? 'bg-green-950 text-green-300 border-green-800' :
          m.provider === 'cloudflare' ? 'bg-amber-950 text-amber-300 border-amber-800' :
          'bg-purple-950 text-purple-300 border-purple-800';

        const currentEffort = reasoningOverridesData[m.id] || m.reasoning_effort || 'none';

        return `
          <div class="bg-slate-950 p-4 rounded-xl border border-slate-800 flex flex-col justify-between hover:border-slate-700 transition shadow-md">
            <div>
              <div class="flex items-start justify-between gap-2 mb-2">
                <div>
                  <div class="flex items-center gap-2 mb-0.5">
                    <span class="px-2 py-0.5 rounded text-[9px] font-mono font-bold border ${providerBadgeColor}">
                      ${m.provider_label}
                    </span>
                    <span class="text-[9px] text-slate-500 font-mono">${m.category}</span>
                  </div>
                  <h4 class="font-bold text-xs text-slate-100 font-mono">${m.name}</h4>
                  <span class="text-[10px] text-slate-500 font-mono block">${m.id}</span>
                </div>
                <div class="text-right shrink-0">
                  <span class="px-2 py-1 rounded-lg bg-cyan-950/70 border border-cyan-800 text-[10px] font-mono font-bold text-cyan-300 block">
                    ${m.max_context_label}
                  </span>
                  <span class="text-[9px] text-slate-500 font-mono mt-0.5 block">Out: ${m.max_output.toLocaleString()} tok</span>
                </div>
              </div>

              <p class="text-[11px] text-slate-400 font-mono mb-3 leading-relaxed">
                <strong class="text-slate-300">Best for:</strong> ${m.best_for}
              </p>
            </div>

            <div class="pt-2.5 border-t border-slate-800/80 flex items-center justify-between gap-3 text-xs font-mono">
              <div class="flex items-center gap-2">
                <span class="text-[10px] text-slate-500">Thinking Override:</span>
                <select onchange="updateReasoningOverride('${m.id}', this.value)" class="bg-slate-900 border border-slate-700 text-cyan-400 rounded px-2 py-1 text-[11px] focus:outline-none">
                  ${['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'].map(opt => `<option value="${opt}" ${opt === currentEffort ? 'selected' : ''}>${opt}</option>`).join('')}
                </select>
              </div>

              <button onclick="setAsGlobalDefaultModel('${m.id}')" class="px-2.5 py-1 rounded bg-slate-900 hover:bg-slate-800 border border-slate-800 text-[10px] text-slate-300 hover:text-white transition flex items-center gap-1">
                <span>🌐</span> <span>Set Global</span>
              </button>
            </div>
          </div>
        `;
      }).join('');
    }

    function filterModelLibrary(query) {
      renderModelLibrary(query);
    }

    async function setAsGlobalDefaultModel(modelId) {
      if (!confirm(`Set "${modelId}" as the system-wide Default Global Model?`)) return;
      try {
        const spec = modelLibraryData.find(x => x.id === modelId) || {};
        const res = await fetch('/api/config/global-model', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            default: modelId,
            provider: spec.provider || 'abacus'
          })
        });
        if (!res.ok) throw new Error(await res.text());
        alert(`Successfully updated default global model to ${modelId}!`);
        await loadModelsConfig();
      } catch (e) {
        alert('Failed to set global model: ' + e);
      }
    }

