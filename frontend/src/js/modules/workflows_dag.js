/**
 * @module workflows_dag.js
 * @description Workflows & Cron-Bridged DAG Visual Canvas / Master-Detail Manager.
 * Loads bridged and manual workflows, renders interactive SVG DAG node graphs,
 * supports filtering/search, node editing, and manual workflow execution.
 *
 * Concatenated globally by frontend/build.py.
 */

    let allWorkflowsData = [];
    let selectedWorkflowId = null;
    let workflowViewMode = localStorage.getItem('nexusdesk_wf_view_mode') || 'master_detail';
    let workflowSearchQuery = '';
    let workflowFilterCategory = 'all'; // 'all', 'bridged', 'manual'
    let workflowCollapsedMap = {};

    function filterWorkflowsByEngine(cat) {
      workflowFilterCategory = cat;
      ['all', 'bridged', 'manual'].forEach(k => {
        const btn = document.getElementById(`btn-wf-filter-${k}`);
        if (!btn) return;
        const isActive = (k === cat);
        if (isActive) {
          btn.className = 'px-2.5 py-1 rounded text-[11px] font-semibold transition bg-cyan-950 text-cyan-300 border border-cyan-800 shadow-sm cursor-pointer';
        } else {
          btn.className = 'px-2.5 py-1 rounded text-[11px] font-semibold transition text-slate-400 hover:text-slate-200 border border-transparent hover:border-slate-800 cursor-pointer';
        }
      });
      renderWorkflowsView();
    }

    function switchWorkflowViewMode(mode) {
      workflowViewMode = mode;
      localStorage.setItem('nexusdesk_wf_view_mode', mode);

      const btnMaster = document.getElementById('btn-wf-view-master');
      const btnWide = document.getElementById('btn-wf-view-wide');
      const masterContainer = document.getElementById('workflows-master-detail-container');
      const wideContainer = document.getElementById('workflows-wide-container');

      if (mode === 'master_detail') {
        if (btnMaster) {
          btnMaster.className = 'px-2.5 py-1 rounded text-[11px] font-semibold transition flex items-center gap-1.5 bg-cyan-950 text-cyan-300 border border-cyan-800 shadow-sm cursor-pointer';
        }
        if (btnWide) {
          btnWide.className = 'px-2.5 py-1 rounded text-[11px] font-semibold transition flex items-center gap-1.5 text-slate-400 hover:text-slate-200 cursor-pointer';
        }
        if (masterContainer) masterContainer.classList.remove('hidden');
        if (wideContainer) wideContainer.classList.add('hidden');
      } else {
        if (btnMaster) {
          btnMaster.className = 'px-2.5 py-1 rounded text-[11px] font-semibold transition flex items-center gap-1.5 text-slate-400 hover:text-slate-200 cursor-pointer';
        }
        if (btnWide) {
          btnWide.className = 'px-2.5 py-1 rounded text-[11px] font-semibold transition flex items-center gap-1.5 bg-cyan-950 text-cyan-300 border border-cyan-800 shadow-sm cursor-pointer';
        }
        if (masterContainer) masterContainer.classList.add('hidden');
        if (wideContainer) wideContainer.classList.remove('hidden');
      }

      renderWorkflowsView();
    }

    function handleWorkflowSearch(query) {
      workflowSearchQuery = (query || '').trim().toLowerCase();
      const clearBtn = document.getElementById('wf-search-clear');
      if (clearBtn) {
        if (workflowSearchQuery) clearBtn.classList.remove('hidden');
        else clearBtn.classList.add('hidden');
      }
      renderWorkflowsView();
    }

    function clearWorkflowSearch() {
      const input = document.getElementById('wf-search-input');
      if (input) input.value = '';
      handleWorkflowSearch('');
    }

    function toggleWorkflowCollapse(wfId) {
      workflowCollapsedMap[wfId] = !workflowCollapsedMap[wfId];
      renderWideCardsView(getFilteredWorkflows());
    }

    function selectWorkflowDetail(wfId) {
      selectedWorkflowId = wfId;
      renderMasterDetailView(getFilteredWorkflows());

      // Auto-scroll on smaller screens so the operator sees the DAG detail immediately
      if (window.innerWidth < 1024) {
        const stageEl = document.getElementById('wf-detail-stage');
        if (stageEl) {
          stageEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }
    }

    function getFilteredWorkflows() {
      // Update filter counter chips
      const totalCount = allWorkflowsData.length;
      const bridgedCount = allWorkflowsData.filter(w => !!w.linked_cron).length;
      const manualCount = totalCount - bridgedCount;

      const cntAll = document.getElementById('count-wf-all');
      if (cntAll) cntAll.innerText = totalCount;
      const cntBridged = document.getElementById('count-wf-bridged');
      if (cntBridged) cntBridged.innerText = bridgedCount;
      const cntManual = document.getElementById('count-wf-manual');
      if (cntManual) cntManual.innerText = manualCount;

      return allWorkflowsData.filter(wf => {
        // Category filtering
        const isBridged = !!wf.linked_cron;
        if (workflowFilterCategory === 'bridged' && !isBridged) return false;
        if (workflowFilterCategory === 'manual' && isBridged) return false;

        // Search text filtering
        if (workflowSearchQuery) {
          const nameMatch = (wf.name || '').toLowerCase().includes(workflowSearchQuery);
          const descMatch = (wf.description || '').toLowerCase().includes(workflowSearchQuery);
          const idMatch = (wf.id || '').toLowerCase().includes(workflowSearchQuery);
          const stepMatch = (wf.steps || []).some(s => 
            (s.agent || '').toLowerCase().includes(workflowSearchQuery) ||
            (s.action || '').toLowerCase().includes(workflowSearchQuery) ||
            (s.skill || '').toLowerCase().includes(workflowSearchQuery)
          );
          return nameMatch || descMatch || idMatch || stepMatch;
        }
        return true;
      });
    }

    function renderWorkflowsView() {
      const filtered = getFilteredWorkflows();
      if (workflowViewMode === 'master_detail') {
        renderMasterDetailView(filtered);
      } else {
        renderWideCardsView(filtered);
      }
    }

    function renderMasterDetailView(workflows) {
      const rosterEl = document.getElementById('wf-roster-sidebar');
      const stageEl = document.getElementById('wf-detail-stage');
      if (!rosterEl || !stageEl) return;

      if (workflows.length === 0) {
        rosterEl.innerHTML = '<div class="p-4 text-center text-slate-500 font-mono text-xs">No workflows match query.</div>';
        stageEl.innerHTML = '<div class="p-8 text-center text-slate-500 font-mono text-xs">No workflow selected.</div>';
        return;
      }

      // Default select first item if none or invalid
      if (!selectedWorkflowId || !workflows.some(w => w.id === selectedWorkflowId)) {
        selectedWorkflowId = workflows[0].id;
      }

      // Render Left Roster Items
      let rosterHtml = '';
      workflows.forEach((wf, idx) => {
        const isSelected = wf.id === selectedWorkflowId;
        const agents = Array.from(new Set((wf.steps || []).map(s => s.agent || 'Agent')));
        const stepsCount = (wf.steps || []).length;
        const activeClass = isSelected
          ? 'bg-cyan-950/60 border-cyan-700/90 shadow-md ring-1 ring-cyan-500/30'
          : 'bg-slate-900/60 border-slate-800 hover:border-slate-700/80 hover:bg-slate-900';

        const agentChips = agents.map(a => 
          `<span class="px-1.5 py-0.2 rounded bg-slate-950 border border-slate-800 text-[10px] text-slate-300 font-mono">${a}</span>`
        ).join(' ');
        const profileMap = {
          free_fast: { label: '🆓⚡ Free→Eco', cls: 'text-emerald-300 border-emerald-800/80 bg-emerald-950/60' },
          economical: { label: '💰 Economical', cls: 'text-amber-300 border-amber-800/80 bg-amber-950/60' },
          strict_json: { label: '🧩 Strict JSON', cls: 'text-violet-300 border-violet-800/80 bg-violet-950/60' },
          agent_default: { label: '🤖 Fleet', cls: 'text-slate-400 border-slate-800 bg-slate-950' }
        };
        const profInfo = profileMap[wf.model_profile || 'agent_default'] || profileMap.agent_default;

        rosterHtml += `
          <div onclick="selectWorkflowDetail('${wf.id}')" class="p-3 rounded-xl border ${activeClass} transition cursor-pointer flex flex-col gap-1.5">
            <div class="flex items-start justify-between gap-1.5">
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-1.5">
                  <span class="text-cyan-400 font-mono text-[10px] font-bold">#${idx + 1}</span>
                  <strong class="text-xs font-bold text-slate-100 font-mono truncate block">${wf.name}</strong>
                </div>
                <p class="text-[11px] text-slate-400 line-clamp-1 mt-0.5">${wf.description || 'No description'}</p>
              </div>
              <div class="flex flex-col items-end gap-1 shrink-0">
                <span class="px-1.5 py-0.5 rounded bg-slate-950 text-cyan-300 font-mono text-[9px] font-bold border border-slate-800">${stepsCount} STEPS</span>
                <span class="px-1.5 py-0.2 rounded border font-mono text-[9px] ${profInfo.cls}">${profInfo.label}</span>
              </div>
            </div>
            <div class="flex flex-wrap items-center gap-1 mt-0.5">
              ${agentChips}
            </div>
          </div>
        `;
      });
      rosterEl.innerHTML = rosterHtml;

      // Render Selected Workflow Detail DAG
      const wf = workflows.find(w => w.id === selectedWorkflowId);
      if (!wf) return;

      const formatWorkflowStepActionHtml = (rawAction) => {
        const text = String(rawAction || '').trim();
        if (!text) return '<p class="text-slate-400 text-xs italic">No instructions provided.</p>';

        const esc = (s) => s
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');

        const styleInlineTokens = (escapedStr) => {
          // Highlight file paths (/home/..., /tmp/..., deliverables/...) and inline backticked code
          let out = escapedStr.replace(/`([^`]+)`/g, '<code class="bg-slate-950 text-cyan-300 px-1.5 py-0.5 rounded border border-slate-800 font-mono text-[11px] break-all">$1</code>');
          out = out.replace(/(^|[\s(:])((?:\/[a-zA-Z0-9._\-*{}]+)+)/g, '$1<code class="bg-slate-950 text-sky-300 px-1.5 py-0.5 rounded border border-slate-800/90 font-mono text-[11px] break-all">$2</code>');
          out = out.replace(/(^|\s)(@[a-zA-Z0-9._\-]+)/g, '$1<span class="text-cyan-300 font-semibold font-mono text-[11px]">$2</span>');
          return out;
        };

        // Split on inline "STEP N ..." markers if present
        const stepSplitRe = /(?=(?:^|\s)STEP\s+\d+\b)/g;
        const rawSections = text.split(stepSplitRe).map(s => s.trim()).filter(Boolean);

        if (rawSections.length > 1 || /^STEP\s+\d+\b/i.test(text)) {
          return `<div class="space-y-2.5 mt-2 min-w-0">` + rawSections.map((sec) => {
            const hdrMatch = sec.match(/^(STEP\s+\d+(?:\s+[A-Z0-9&/_+\-]+)*)\s*[:.\-]\s*([\s\S]*)$/i);
            const title = hdrMatch ? hdrMatch[1].trim() : 'STEP';
            const body = hdrMatch ? hdrMatch[2].trim() : sec;
            const sentences = body
              .split(/(?<=[.!?])\s+(?=[A-Z0-9/])/)
              .map(x => x.trim())
              .filter(Boolean);
            const bodyHtml = sentences.length > 1
              ? `<ul class="space-y-1.5 list-disc pl-4 text-slate-200 font-sans text-[12.5px] leading-relaxed">${sentences.map(line => `<li class="break-words [overflow-wrap:anywhere]">${styleInlineTokens(esc(line))}</li>`).join('')}</ul>`
              : `<p class="text-slate-200 font-sans text-[12.5px] leading-relaxed break-words [overflow-wrap:anywhere]">${styleInlineTokens(esc(body))}</p>`;

            return `
              <div class="rounded-lg bg-slate-950/75 border border-slate-800/90 p-2.5 sm:p-3 min-w-0 overflow-hidden">
                <div class="inline-flex items-center px-2 py-0.5 rounded bg-slate-800/90 border border-slate-700/80 text-cyan-300 font-mono text-[10px] font-bold uppercase tracking-wider mb-2">${esc(title)}</div>
                ${bodyHtml}
              </div>
            `;
          }).join('') + `</div>`;
        }

        // Standard multi-sentence prompt: render in clean sans with wrapped paths
        const paragraphs = text.split(/\n+/).map(p => p.trim()).filter(Boolean);
        return `<div class="space-y-1.5 mt-2 pl-1 sm:pl-7 min-w-0">` +
          paragraphs.map(p => `<p class="text-slate-200 font-sans text-[12.5px] leading-relaxed break-words [overflow-wrap:anywhere]">${styleInlineTokens(esc(p))}</p>`).join('') +
          `</div>`;
      };

      const steps = wf.steps || [];
      let stepsHtml = '';
      steps.forEach((s, idx) => {
        const isLast = (idx === steps.length - 1);
        const skillBadge = s.skill ? `
          <button onclick="event.stopPropagation(); openStepSkillPreview('${s.agent || 'solaris'}', '${s.skill}')" class="px-2 py-0.5 rounded bg-amber-950/80 border border-amber-800 text-amber-300 font-mono text-[10px] hover:bg-amber-900 transition flex items-center gap-1 cursor-pointer" title="View bound live skill">
            <span>🛠️</span> <span>${s.skill}</span>
          </button>
        ` : '';

        stepsHtml += `
          <div id="wf-step-${wf.id}-${s.order}" class="relative bg-slate-900/90 p-3.5 rounded-xl border border-slate-800 text-xs shadow-sm transition-all duration-300 min-w-0 overflow-hidden">
            <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-1.5">
              <span class="flex items-center gap-2 min-w-0">
                <span class="w-5 h-5 rounded-full bg-emerald-950 border border-emerald-600 flex items-center justify-center text-[10px] text-emerald-400 font-bold font-mono shrink-0">${s.order}</span>
                <strong class="text-white text-sm font-bold font-sans truncate">${s.agent}</strong>
              </span>
              <div class="flex items-center gap-1.5 flex-wrap">
                ${skillBadge}
                ${s.approval_required ? '<span class="text-[9px] px-2 py-0.5 rounded bg-amber-950 border border-amber-800 text-amber-300 font-mono font-bold">✋ HUMAN APPROVAL GATE</span>' : ''}
                <span class="text-[9px] text-slate-400 px-1.5 py-0.5 rounded bg-slate-950 border border-slate-800 font-mono" title="Step Execution Timeout">⏱️ ${s.timeout_seconds || wf.timeout_seconds || 300}s</span>
                <span class="wf-step-badge text-[10px] text-cyan-400 px-2 py-0.5 rounded bg-cyan-950/80 border border-cyan-800 font-mono font-bold">STEP ${s.order}</span>
              </div>
            </div>
            ${formatWorkflowStepActionHtml(s.action)}
          </div>
        `;

        if (!isLast) {
          stepsHtml += `
            <div class="flex justify-center items-center py-1">
              <div class="flex items-center gap-2 px-3 py-0.5 rounded-full bg-emerald-950/40 border border-emerald-900/60 text-emerald-400 text-xs font-bold shadow-sm">
                <span class="h-2 w-0.5 bg-emerald-500 block"></span>
                <svg class="w-3.5 h-3.5 animate-bounce" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 14l-7 7m0 0l-7-7m7 7V3"/></svg>
                <span class="text-[10px] text-emerald-400 tracking-wider font-mono">HANDOVER ARTIFACTS</span>
              </div>
            </div>
          `;
        }
      });

      // Engine & Cron Bridge header badges
      const cronBridgeBadge = wf.linked_cron ? `
        <div class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-indigo-950/70 border border-indigo-700/80 text-indigo-300 text-[11px] font-mono">
          <span>⏰</span> <span>Cron: <strong>${wf.linked_cron.cron_name}</strong> (${wf.linked_cron.schedule_human || wf.linked_cron.schedule_expr})</span>
          <button onclick="if(typeof switchMainTab === 'function') switchMainTab('crons')" class="ml-1 text-cyan-400 hover:text-cyan-200 underline font-bold" title="Open Crons Table">
            Inspect Cron ➔
          </button>
        </div>
      ` : `
        <div class="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 text-slate-400 text-[11px] font-mono">
          <span>⚡</span> <span>Trigger: Manual UI Only</span>
        </div>
      `;

      stageEl.innerHTML = `
        <div class="flex flex-col gap-3">
          <!-- Stage Header -->
          <div class="flex flex-col sm:flex-row sm:items-start justify-between gap-3 pb-3 border-b border-slate-800/80">
            <div>
              <div class="flex items-center gap-2 flex-wrap">
                <span class="px-2 py-0.5 rounded bg-cyan-950 border border-cyan-800 text-cyan-300 font-mono text-xs font-bold flex items-center gap-1">
                  <span>🔀</span> <span>NEXUSDESK DAG</span>
                </span>
                <span class="px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-400 font-mono text-xs font-bold">${wf.id}</span>
                <h3 class="text-sm sm:text-base font-bold text-white font-mono">${wf.name}</h3>
              </div>
              <p class="text-xs text-slate-300 mt-1">${wf.description || 'No description provided.'}</p>
              <div class="mt-2 flex items-center gap-2 flex-wrap">
                ${cronBridgeBadge}
              </div>
            </div>
            <div class="flex items-center gap-2 shrink-0">
              <button onclick="triggerWorkflowPipeline('${wf.id}', this)" class="px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-mono text-xs font-bold transition flex items-center justify-center shadow-md cursor-pointer" title="Run Pipeline">
                <span>▶</span>
              </button>
              <button onclick="openEditWorkflowModal('${wf.id}')" class="px-2 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-cyan-300 border border-slate-700 text-xs font-semibold transition" title="Edit Workflow">
                ✏️
              </button>
              <button onclick="deleteWorkflow('${wf.id}')" class="px-2 py-1.5 rounded-lg bg-rose-950/80 hover:bg-rose-900 text-rose-300 border border-rose-900/60 text-xs font-semibold transition" title="Delete Workflow">
                🗑
              </button>
            </div>
          </div>

          <!-- Expansive DAG Steps Stack -->
          <div class="flex flex-col gap-1.5 mt-1">
            ${stepsHtml}
          </div>
        </div>
      `;
    }

    function renderWideCardsView(workflows) {
      const container = document.getElementById('workflows-wide-container');
      if (!container) return;

      if (workflows.length === 0) {
        container.innerHTML = '<div class="col-span-full p-8 text-center text-slate-500 font-mono text-xs">No workflows match query.</div>';
        return;
      }

      let cardsHtml = '';
      workflows.forEach((wf, wfIdx) => {
        const wfNumber = wfIdx + 1;
        const isCollapsed = !!workflowCollapsedMap[wf.id];
        const steps = wf.steps || [];

        let stepsHtml = '';
        steps.forEach((s, idx) => {
          const isLast = (idx === steps.length - 1);
          const skillBadge = s.skill ? `
            <button onclick="event.stopPropagation(); openStepSkillPreview('${s.agent || 'solaris'}', '${s.skill}')" class="px-1.5 py-0.2 rounded bg-amber-950/70 border border-amber-800/80 text-amber-300 font-mono text-[9px] hover:bg-amber-900 transition flex items-center gap-1 cursor-pointer" title="View bound live skill">
              <span>🛠️</span> <span>${s.skill}</span>
            </button>
          ` : '';

          stepsHtml += `
            <div id="wf-step-${wf.id}-${s.order}" class="relative bg-slate-900/95 p-2.5 rounded-lg border border-slate-800 text-xs font-mono shadow-sm transition-all duration-300">
              <div class="flex items-center justify-between mb-1 gap-1">
                <span class="flex items-center gap-2">
                  <span class="w-4 h-4 rounded-full bg-emerald-950 border border-emerald-700 flex items-center justify-center text-[9px] text-emerald-400 font-bold">${s.order}</span>
                  <strong class="text-white text-xs font-bold font-sans">${s.agent}</strong>
                </span>
                <div class="flex items-center gap-1.5">
                  ${skillBadge}
                  ${s.approval_required ? '<span class="text-[8px] px-1 py-0.2 rounded bg-amber-950 border border-amber-800 text-amber-300 font-mono font-bold">✋ GATE</span>' : ''}
                  <span class="text-[8px] text-slate-400 px-1 py-0.2 rounded bg-slate-950 border border-slate-800 font-mono" title="Step Execution Timeout">⏱️ ${s.timeout_seconds || wf.timeout_seconds || 300}s</span>
                  <span class="wf-step-badge text-[9px] text-cyan-400 px-1.5 py-0.2 rounded bg-cyan-950/60 border border-cyan-800 font-mono">STEP ${s.order}</span>
                </div>
              </div>
              <p class="text-slate-300 text-[11px] leading-relaxed pl-6">${s.action}</p>
            </div>
          `;
          if (!isLast) {
            stepsHtml += `
              <div class="flex justify-center items-center py-0.5">
                <div class="flex items-center gap-1.5 text-emerald-400 text-xs font-bold">
                  <span class="h-2.5 w-0.5 bg-emerald-500/60 block"></span>
                  <svg class="w-3.5 h-3.5 animate-bounce" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 14l-7 7m0 0l-7-7m7 7V3"/></svg>
                  <span class="text-[9px] text-emerald-400 tracking-wider font-mono">HANDOVER</span>
                </div>
              </div>
            `;
          }
        });

        // Engine & Cron indicator for wide cards
        const cronBridgeCard = wf.linked_cron ? `
          <div class="mt-2 inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-indigo-950/70 border border-indigo-700/80 text-indigo-300 text-[10px] font-mono">
            <span>⏰</span> <span>Scheduled by: <strong>${wf.linked_cron.cron_name}</strong></span>
          </div>
        ` : '';

        cardsHtml += `
          <div class="bg-slate-950 p-4 rounded-xl border border-slate-800 flex flex-col justify-between shadow-lg hover:border-slate-700 transition">
            <div>
              <div class="flex items-start justify-between gap-2.5 mb-2">
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-1.5 flex-wrap">
                    <span class="px-1.5 py-0.5 rounded bg-cyan-950 border border-cyan-800 text-cyan-300 font-mono text-[9px] font-bold">🔀 DAG</span>
                    <span class="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 text-cyan-400 font-mono text-[10px] font-bold">#${wfNumber}</span>
                    <strong class="text-xs font-bold text-slate-100 block font-mono truncate">${wf.name}</strong>
                  </div>
                  <p class="text-[11px] text-slate-400 mt-0.5 line-clamp-2">${wf.description}</p>
                  ${cronBridgeCard}
                </div>
                <div class="flex items-center gap-1.5 flex-shrink-0">
                  <button onclick="toggleWorkflowCollapse('${wf.id}')" class="px-2 py-0.5 rounded bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700 text-[11px] font-mono transition cursor-pointer" title="Collapse/Expand Steps">
                    ${isCollapsed ? `▶ Expand (${steps.length})` : '▼ Collapse'}
                  </button>
                  <button onclick="triggerWorkflowPipeline('${wf.id}', this)" class="px-2 py-0.5 rounded bg-emerald-950 hover:bg-emerald-900 text-emerald-300 border border-emerald-800 text-[11px] font-semibold transition flex items-center gap-1 cursor-pointer" title="Test / Trigger Workflow">
                    <span>▶ Run</span>
                  </button>
                  <button onclick="openEditWorkflowModal('${wf.id}')" class="px-2 py-0.5 rounded bg-slate-900 hover:bg-slate-800 text-cyan-300 border border-slate-700 text-[11px] font-semibold transition" title="Edit Workflow">
                    ✏️ Edit
                  </button>
                  <button onclick="deleteWorkflow('${wf.id}')" class="px-1.5 py-0.5 rounded bg-rose-950/80 hover:bg-rose-900 text-rose-300 border border-rose-900/60 text-[11px] font-semibold transition" title="Delete Workflow">
                    🗑
                  </button>
                </div>
              </div>
              <div class="flex flex-col gap-1 mt-2.5 ${isCollapsed ? 'hidden' : ''}">
                ${stepsHtml}
              </div>
            </div>
          </div>
        `;
      });

      container.innerHTML = cardsHtml;
    }

    async function loadWorkflowsDAG() {
      try {
        const res = await fetch('/api/workflows');
        const data = await res.json();
        allWorkflowsData = data.workflows || [];

        // Also fetch crons count to keep counters in sync
        let cronCount = 0;
        let activeCount = 0;
        let disabledCount = 0;
        try {
          const cRes = await fetch('/api/crons');
          const cData = await cRes.json();
          cronJobsData = cData.jobs || [];
          cronCount = cronJobsData.length;
          activeCount = cronJobsData.filter(j => j.enabled !== false).length;
          disabledCount = cronCount - activeCount;
        } catch (_) {}

        updateAutomationCounts(cronCount, activeCount, disabledCount, allWorkflowsData.length);
        switchWorkflowViewMode(workflowViewMode);
      } catch (e) {
        console.error('Failed to load workflows:', e);
      }
    }

    function openCreateWorkflowModal() {
      document.getElementById('modal-wf-id').value = '';
      document.getElementById('modal-wf-title').innerText = 'CREATE WORKFLOW PIPELINE';
      document.getElementById('modal-wf-name').value = '';
      document.getElementById('modal-wf-desc').value = '';
      const timeoutSelect = document.getElementById('modal-wf-timeout');
      if (timeoutSelect) timeoutSelect.value = '300';
      const profileSelect = document.getElementById('modal-wf-model-profile');
      if (profileSelect) profileSelect.value = 'free_fast';
      currentWorkflowSteps = [
        { order: 1, agent: 'Solaris', action: 'Initiate pipeline and assign responsibilities', timeout_seconds: 300 },
        { order: 2, agent: 'Lore', action: 'Research scripture accuracy and theological context', timeout_seconds: 300 }
      ];
      renderModalWorkflowSteps();
      document.getElementById('workflow-modal').classList.remove('hidden');
    }

    async function openEditWorkflowModal(wfId) {
      try {
        const res = await fetch('/api/workflows');
        const data = await res.json();
        const wf = (data.workflows || []).find(w => w.id === wfId);
        if (!wf) return alert('Workflow not found.');
        document.getElementById('modal-wf-id').value = wf.id;
        document.getElementById('modal-wf-title').innerText = `EDIT WORKFLOW: ${wf.name}`;
        document.getElementById('modal-wf-name').value = wf.name || '';
        document.getElementById('modal-wf-desc').value = wf.description || '';
        const timeoutSelect = document.getElementById('modal-wf-timeout');
        if (timeoutSelect) timeoutSelect.value = String(wf.timeout_seconds || 300);
        const profileSelect = document.getElementById('modal-wf-model-profile');
        if (profileSelect) profileSelect.value = wf.model_profile || 'agent_default';
        currentWorkflowSteps = JSON.parse(JSON.stringify(wf.steps || []));
        renderModalWorkflowSteps();
        document.getElementById('workflow-modal').classList.remove('hidden');
      } catch (e) {
        alert('Error loading workflow: ' + e);
      }
    }

    function closeWorkflowModal() {
      document.getElementById('workflow-modal').classList.add('hidden');
    }

    function renderModalWorkflowSteps() {
      const container = document.getElementById('modal-wf-steps-list');
      if (!container) return;
      container.innerHTML = '';
      const agentOptions = ['Solaris', 'Lore', 'Chroma', 'Chorusius', 'Scribe', 'Pylon'];

      currentWorkflowSteps.forEach((s, idx) => {
        s.order = idx + 1;
        container.innerHTML += `
          <div class="bg-slate-950 p-2.5 rounded-lg border border-slate-800 flex flex-col gap-2 text-xs">
            <div class="flex items-center gap-2">
              <span class="w-6 h-6 rounded-full bg-emerald-950 border border-emerald-800 text-emerald-400 font-bold flex items-center justify-center flex-shrink-0 text-[10px]">${s.order}</span>
              <select onchange="currentWorkflowSteps[${idx}].agent = this.value" class="bg-slate-900 border border-slate-700 text-cyan-300 font-mono text-xs rounded px-2 py-1.5 focus:outline-none flex-shrink-0">
                ${agentOptions.map(opt => `<option value="${opt}" ${opt.toLowerCase() === (s.agent || '').toLowerCase() ? 'selected' : ''}>${opt}</option>`).join('')}
              </select>
              <input type="text" value="${s.action || ''}" onchange="currentWorkflowSteps[${idx}].action = this.value" placeholder="Action description..." class="flex-1 min-w-0 bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-white font-mono text-xs focus:outline-none" />
              <div class="flex items-center gap-1 flex-shrink-0">
                <button type="button" onclick="moveWorkflowStepRow(${idx}, -1)" ${idx === 0 ? 'disabled class="opacity-30 p-1 text-slate-500"' : 'class="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300"'} title="Move Up">▲</button>
                <button type="button" onclick="moveWorkflowStepRow(${idx}, 1)" ${idx === currentWorkflowSteps.length - 1 ? 'disabled class="opacity-30 p-1 text-slate-500"' : 'class="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300"'} title="Move Down">▼</button>
                <button type="button" onclick="removeWorkflowStepRow(${idx})" class="p-1 rounded bg-rose-950 text-rose-400 hover:bg-rose-900 border border-rose-900" title="Delete Step">🗑</button>
              </div>
            </div>
            <!-- Optional Skill, Timeout & Approval Gate Binding -->
            <div class="flex items-center justify-between gap-2 pl-8 flex-wrap">
              <div class="flex items-center gap-1.5 flex-1 min-w-[170px]">
                <span class="text-[10px] font-mono text-amber-400">🛠️ Skill:</span>
                <input type="text" value="${s.skill || ''}" onchange="currentWorkflowSteps[${idx}].skill = this.value.trim()" placeholder="e.g. dailydose-devotion-workflow" class="flex-1 bg-slate-900/80 border border-slate-800 rounded px-2 py-1 text-amber-200 font-mono text-[11px] focus:outline-none focus:border-amber-600" />
              </div>
              <div class="flex items-center gap-1.5">
                <span class="text-[10px] font-mono text-slate-400">⏱️ Timeout:</span>
                <select onchange="currentWorkflowSteps[${idx}].timeout_seconds = parseInt(this.value)" class="bg-slate-900 border border-slate-800 text-slate-300 font-mono text-[11px] rounded px-1.5 py-1 focus:outline-none cursor-pointer">
                  <option value="60" ${s.timeout_seconds === 60 ? 'selected' : ''}>60s (1m)</option>
                  <option value="180" ${s.timeout_seconds === 180 ? 'selected' : ''}>180s (3m)</option>
                  <option value="300" ${(s.timeout_seconds === 300 || !s.timeout_seconds) ? 'selected' : ''}>300s (5m default)</option>
                  <option value="600" ${s.timeout_seconds === 600 ? 'selected' : ''}>600s (10m)</option>
                  <option value="720" ${s.timeout_seconds === 720 ? 'selected' : ''}>720s (12m)</option>
                </select>
              </div>
              <div class="flex items-center gap-1.5">
                <span class="text-[10px] font-mono text-slate-400">⚡ Model:</span>
                <select onchange="currentWorkflowSteps[${idx}].model = this.value || undefined" class="bg-slate-900 border border-slate-800 text-slate-300 font-mono text-[11px] rounded px-1.5 py-1 focus:outline-none cursor-pointer">
                  <option value="" ${!s.model ? 'selected' : ''}>Inherit Profile</option>
                  <option value="groq/openai/gpt-oss-120b" ${s.model === 'groq/openai/gpt-oss-120b' ? 'selected' : ''}>Groq GPT-OSS 120B (Free)</option>
                  <option value="cloudflare/@cf/meta/llama-3.3-70b-instruct-fp8-fast" ${s.model === 'cloudflare/@cf/meta/llama-3.3-70b-instruct-fp8-fast' ? 'selected' : ''}>CF Llama 3.3 70B (Free)</option>
                  <option value="abacus/gemini-3.8-flash" ${s.model === 'abacus/gemini-3.8-flash' ? 'selected' : ''}>Gemini 3.8 Flash (Eco)</option>
                  <option value="abacus/gpt-4.1-mini" ${s.model === 'abacus/gpt-4.1-mini' ? 'selected' : ''}>GPT-4.1 Mini (Eco)</option>
                </select>
              </div>
              <label class="flex items-center gap-1.5 cursor-pointer text-[10px] font-mono text-cyan-300 bg-slate-900 px-2 py-1 rounded border border-slate-800">
                <input type="checkbox" ${s.approval_required ? 'checked' : ''} onchange="currentWorkflowSteps[${idx}].approval_required = this.checked" class="rounded bg-slate-950 border-slate-700 text-cyan-500" />
                <span>✋ Gate</span>
              </label>
            </div>
          </div>
        `;
      });
    }

    function addWorkflowStepRow() {
      currentWorkflowSteps.push({
        order: currentWorkflowSteps.length + 1,
        agent: 'Solaris',
        action: 'Execute verification check and publish payload'
      });
      renderModalModalSteps();
    }

    function renderModalModalSteps() {
      renderModalWorkflowSteps();
    }

    function removeWorkflowStepRow(idx) {
      if (currentWorkflowSteps.length <= 1) return alert('Workflow must have at least one step.');
      currentWorkflowSteps.splice(idx, 1);
      renderModalWorkflowSteps();
    }

    function moveWorkflowStepRow(idx, dir) {
      const target = idx + dir;
      if (target < 0 || target >= currentWorkflowSteps.length) return;
      const tmp = currentWorkflowSteps[idx];
      currentWorkflowSteps[idx] = currentWorkflowSteps[target];
      currentWorkflowSteps[target] = tmp;
      renderModalWorkflowSteps();
    }

    async function submitSaveWorkflow() {
      const id = document.getElementById('modal-wf-id').value.trim();
      const name = document.getElementById('modal-wf-name').value.trim();
      const desc = document.getElementById('modal-wf-desc').value.trim();
      const timeoutVal = parseInt(document.getElementById('modal-wf-timeout')?.value || '300');
      const modelProfile = document.getElementById('modal-wf-model-profile')?.value || 'free_fast';

      if (!name) return alert('Please enter a workflow name.');
      if (currentWorkflowSteps.length === 0) return alert('Workflow must have at least one step.');

      // Sync any uncommitted input changes
      const inputs = document.querySelectorAll('#modal-wf-steps-list input[type="text"]');
      inputs.forEach((inp, i) => {
        if (currentWorkflowSteps[i]) currentWorkflowSteps[i].action = inp.value;
      });

      const payload = {
        name,
        description: desc,
        timeout_seconds: timeoutVal,
        model_profile: modelProfile,
        steps: currentWorkflowSteps.map((s, i) => ({
          order: i + 1,
          agent: s.agent,
          action: s.action,
          skill: s.skill || undefined,
          model: s.model || undefined,
          timeout_seconds: s.timeout_seconds ? parseInt(s.timeout_seconds) : timeoutVal,
          approval_required: !!s.approval_required
        }))
      };

      try {
        if (id) {
          const res = await fetch(`/api/workflows/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          if (!res.ok) throw new Error('Failed to update workflow');
        } else {
          const res = await fetch('/api/workflows/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          if (!res.ok) throw new Error('Failed to create workflow');
        }
        closeWorkflowModal();
        loadWorkflowsDAG();
      } catch (e) {
        alert('Error saving workflow: ' + e);
      }
    }

    async function deleteWorkflow(wfId) {
      if (!confirm(`Are you sure you want to delete workflow "${wfId}"?`)) return;
      try {
        const res = await fetch(`/api/workflows/${wfId}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('Failed to delete');
        loadWorkflowsDAG();
      } catch (e) {
        alert('Error deleting workflow: ' + e);
      }
    }



    // Step Skill Inspection Drawer (BL-AUTO-35)
    async function openStepSkillPreview(agentName, skillId) {
      const modal = document.getElementById('step-skill-modal');
      const title = document.getElementById('step-skill-modal-title');
      const sub = document.getElementById('step-skill-modal-subtitle');
      const pathEl = document.getElementById('step-skill-path');
      const badgeEl = document.getElementById('step-skill-badge');
      const contentEl = document.getElementById('step-skill-content');

      if (!modal) return;
      currentViewingSkillAgent = agentName || 'solaris';
      title.innerText = `SKILL: ${skillId}`;
      sub.innerText = `Bound to ${agentName} step • Live from disk`;
      contentEl.innerText = 'Reading latest SKILL.md from host disk...';
      modal.classList.remove('hidden');

      try {
        // Fetch agent skills list to find absolute path
        const resList = await fetch(`/api/agent/${encodeURIComponent(currentViewingSkillAgent)}/skills`);
        const dataList = await resList.json();
        const skillObj = (dataList.skills || []).find(s =>
          s.name?.toLowerCase() === skillId.toLowerCase() ||
          s.folder?.toLowerCase() === skillId.toLowerCase() ||
          s.path?.toLowerCase().includes(skillId.toLowerCase())
        );

        if (!skillObj) {
          contentEl.innerText = `Skill "${skillId}" referenced in workflow step, but not found in ~/.hermes/skills or profiles/${currentViewingSkillAgent}/skills.`;
          pathEl.innerText = skillId;
          badgeEl.className = 'px-2 py-0.5 rounded bg-rose-950 text-rose-400 border border-rose-900 text-[10px] font-bold';
          badgeEl.innerText = 'NOT FOUND';
          currentViewingSkillPath = '';
          return;
        }

        currentViewingSkillPath = skillObj.path;
        pathEl.innerText = skillObj.path;
        badgeEl.className = skillObj.locked
          ? 'px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-700 text-[10px] font-bold'
          : 'px-2 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-800 text-[10px] font-bold';
        badgeEl.innerText = skillObj.locked ? '🔒 LOCKED' : '🔓 AUTO-EVOLVING';

        // Load detail
        const resDetail = await fetch(`/api/agent/${encodeURIComponent(currentViewingSkillAgent)}/skill?path=${encodeURIComponent(skillObj.path)}`);
        const detail = await resDetail.json();
        contentEl.innerText = detail.content || '(Empty skill content)';
      } catch (err) {
        contentEl.innerText = `Error loading skill content: ${err}`;
      }
    }

    function closeStepSkillModal() {
      const modal = document.getElementById('step-skill-modal');
      if (modal) modal.classList.add('hidden');
    }

    function openSkillInVault() {
      closeStepSkillModal();
      if (typeof switchMainTab === 'function') {
        switchMainTab('memory');
        if (currentViewingSkillPath && typeof openAgentSkill === 'function') {
          setTimeout(() => {
            if (typeof switchMemoryStudioMode === 'function') switchMemoryStudioMode('skills');
            openAgentSkill(currentViewingSkillAgent, currentViewingSkillPath);
          }, 250);
        }
      }
    }

    // BL-AUTO-39: 1-Click File Inspection from Cron Prompts
    function inspectCronReferencedFile(agentName, filePath) {
      if (typeof switchMainTab === 'function') {
        switchMainTab('memory');
        setTimeout(() => {
          if (typeof switchMemoryStudioMode === 'function') switchMemoryStudioMode('files');
          if (typeof openMemoryFile === 'function') {
            openMemoryFile(agentName || 'solaris', filePath);
          }
        }, 250);
      }
    }

    // --- WORKFLOW RUNNER MONITOR & INSPECTOR (BL-AUTO-36) ---
    let currentActiveRunId = null;

    async function loadWorkflowRunsHistory() {
      const tbody = document.getElementById('workflow-runs-table-body');
      if (!tbody) return;

      try {
        const res = await fetch('/api/workflows/runs?limit=15');
        const data = await res.json();
        const runs = data.runs || [];
        tbody.innerHTML = '';

        if (runs.length === 0) {
          tbody.innerHTML = '<tr><td colspan="6" class="py-3 text-center text-slate-500">No active or historical workflow runs recorded yet.</td></tr>';
          return;
        }

        runs.forEach(r => {
          let statusBadge = '';
          if (r.status === 'running') {
            statusBadge = '<span class="px-2 py-0.5 rounded text-[9px] font-bold bg-cyan-950 text-cyan-300 border border-cyan-800 animate-pulse">⚡ RUNNING</span>';
          } else if (r.status === 'paused_for_approval') {
            statusBadge = '<span class="px-2 py-0.5 rounded text-[9px] font-bold bg-amber-950 text-amber-300 border border-amber-800 animate-bounce">✋ WAITING APPROVAL</span>';
          } else if (r.status === 'completed') {
            statusBadge = '<span class="px-2 py-0.5 rounded text-[9px] font-bold bg-emerald-950 text-emerald-300 border border-emerald-800">✅ COMPLETED</span>';
          } else if (r.status === 'cancelled') {
            statusBadge = '<span class="px-2 py-0.5 rounded text-[9px] font-bold bg-slate-900 text-slate-400 border border-slate-800">CANCELLED</span>';
          } else {
            statusBadge = '<span class="px-2 py-0.5 rounded text-[9px] font-bold bg-rose-950 text-rose-300 border border-rose-800">FAILED</span>';
          }

          const startedTime = r.started_at ? new Date(r.started_at).toLocaleTimeString() : '--';
          const durationStr = r.duration_seconds ? `${r.duration_seconds}s` : (r.status === 'running' ? 'In progress...' : '--');

          const isCronTrigger = String(r.trigger_source || '').startsWith('cron_');
          const triggerBadge = isCronTrigger
            ? `<div class="flex items-center gap-1 font-mono text-[9px]">
                 <span class="px-1.5 py-0.2 rounded bg-indigo-950 text-indigo-300 border border-indigo-800">⏰ CRON</span>
                 <span class="text-slate-400">${r.trigger_source}</span>
               </div>`
            : `<div class="flex items-center gap-1 font-mono text-[9px]">
                 <span class="px-1.5 py-0.2 rounded bg-slate-900 text-slate-400 border border-slate-800">⚡ MANUAL</span>
               </div>`;

          tbody.innerHTML += `
            <tr class="hover:bg-slate-900/60 transition cursor-pointer" onclick="openWorkflowRunInspectModal('${r.run_id}')">
              <td class="py-2 px-2.5 font-bold text-cyan-400 text-[11px]">${r.run_id}</td>
              <td class="py-2 px-3 text-white font-semibold">${r.workflow_name || r.workflow_id}</td>
              <td class="py-2 px-2.5">${triggerBadge}</td>
              <td class="py-2 px-3">${statusBadge}</td>
              <td class="py-2 px-3 text-emerald-400">${durationStr}</td>
              <td class="py-2 px-3 text-slate-400">${startedTime}</td>
              <td class="py-2 px-3 text-right">
                <button onclick="event.stopPropagation(); openWorkflowRunInspectModal('${r.run_id}')" class="px-2 py-0.5 rounded bg-slate-900 hover:bg-slate-800 text-cyan-300 border border-slate-700 text-[11px] font-semibold transition cursor-pointer">
                  🔍 Inspect
                </button>
              </td>
            </tr>
          `;
        });
      } catch (e) {
        tbody.innerHTML = `<tr><td colspan="7" class="py-3 text-center text-rose-400 font-mono text-xs">Error loading runs: ${e}</td></tr>`;
      }
    }

    async function openWorkflowRunInspectModal(runId) {
      const modal = document.getElementById('workflow-run-inspect-modal');
      const title = document.getElementById('run-inspect-modal-title');
      const sub = document.getElementById('run-inspect-modal-subtitle');
      const stEl = document.getElementById('run-inspect-status');
      const engineEl = document.getElementById('run-inspect-engine');
      const durEl = document.getElementById('run-inspect-duration');
      const trigEl = document.getElementById('run-inspect-trigger');
      const startEl = document.getElementById('run-inspect-started');
      const timeline = document.getElementById('run-inspect-steps-timeline');

      if (!modal) return;
      title.innerText = `RUN: ${runId}`;
      timeline.innerHTML = '<div class="text-slate-500 font-mono text-xs">Loading run execution timeline...</div>';
      modal.classList.remove('hidden');

      try {
        const res = await fetch(`/api/workflows/runs/${runId}`);
        const data = await res.json();
        const r = data.run;
        if (!r) {
          timeline.innerHTML = '<div class="text-rose-400 font-mono text-xs">Run record not found.</div>';
          return;
        }

        sub.innerText = `${r.workflow_name || r.workflow_id} • Step ${r.current_step_order || 1} of ${r.total_steps || 1}`;
        stEl.innerHTML = r.status.toUpperCase();
        stEl.className = r.status === 'completed' ? 'font-bold text-emerald-400' : (r.status === 'running' ? 'font-bold text-cyan-400 animate-pulse' : 'font-bold text-amber-400');
        if (engineEl) {
          engineEl.innerHTML = `<span class="text-cyan-300 font-mono text-xs">🔀 ${r.execution_engine_label || 'NexusDesk DAG'}</span>`;
        }
        durEl.innerText = r.duration_seconds ? `${r.duration_seconds}s` : (r.status === 'running' ? 'Running...' : '--');
        trigEl.innerText = (r.trigger_source || 'manual').toUpperCase();
        startEl.innerText = r.started_at ? new Date(r.started_at).toLocaleTimeString() : '--';

        timeline.innerHTML = '';
        const history = r.steps_history || [];
        if (history.length === 0) {
          timeline.innerHTML = '<div class="text-slate-500 font-mono text-xs">No completed steps recorded yet.</div>';
          return;
        }

        history.forEach((step, idx) => {
          timeline.innerHTML += `
            <div class="bg-slate-950 p-3 rounded-xl border border-slate-800 font-mono space-y-1.5">
              <div class="flex items-center justify-between">
                <span class="flex items-center gap-2">
                  <span class="w-5 h-5 rounded-full bg-emerald-950 border border-emerald-700 text-emerald-300 font-bold flex items-center justify-center text-[10px]">${step.order}</span>
                  <strong class="text-xs text-white font-sans">${step.agent}</strong>
                  ${step.skill ? `<span class="text-[9px] text-amber-400 px-1.5 py-0.2 rounded bg-amber-950/70 border border-amber-800">🛠️ ${step.skill}</span>` : ''}
                </span>
                <span class="text-emerald-400 font-bold text-[10px]">⏱️ ${step.duration_seconds || 0}s</span>
              </div>
              <p class="text-slate-300 text-xs pl-7">${step.action}</p>
              ${step.output_preview ? `
                <div class="mt-2 pl-7">
                  <div class="text-[10px] text-slate-500 uppercase tracking-wider mb-0.5">Agent Output Preview</div>
                  <pre class="bg-slate-900/90 border border-slate-800/80 rounded-lg p-2 text-slate-300 text-[11px] whitespace-pre-wrap max-h-32 overflow-y-auto custom-scrollbar">${step.output_preview}</pre>
                </div>
              ` : ''}
            </div>
          `;
        });
      } catch (err) {
        timeline.innerHTML = `<div class="text-rose-400 font-mono text-xs">Failed to load run details: ${err}</div>`;
      }
    }

    function closeWorkflowRunInspectModal() {
      const modal = document.getElementById('workflow-run-inspect-modal');
      if (modal) modal.classList.add('hidden');
    }

    async function submitApprovalDecision(approved) {
      if (!currentActiveRunId) return;
      try {
        if (approved) {
          const res = await fetch(`/api/workflows/runs/${currentActiveRunId}/approve`, { method: 'POST' });
          if (!res.ok) throw new Error('Approval endpoint failed');
          alert('Gate approved! Resuming next workflow step.');
        } else {
          const res = await fetch(`/api/workflows/runs/${currentActiveRunId}/cancel`, { method: 'POST' });
          if (!res.ok) throw new Error('Cancellation failed');
          alert('Workflow run cancelled.');
        }
        document.getElementById('workflow-approval-banner')?.classList.add('hidden');
        loadWorkflowRunsHistory();
      } catch (e) {
        alert('Error submitting decision: ' + e);
      }
    }

    // Direct workflow trigger via runner (BL-AUTO-36 & BL-EVO-33)
    async function triggerWorkflowPipeline(wfId, btnElement = null) {
      const origHtml = btnElement ? btnElement.innerHTML : '';
      if (btnElement) {
        btnElement.innerHTML = `<span class="animate-spin inline-block">⚙️</span> <span>Starting...</span>`;
        btnElement.disabled = true;
      }
      const banner = document.getElementById('runner-active-status-pill');
      if (banner) {
        banner.innerText = `Starting pipeline...`;
        banner.className = 'text-[10px] font-mono px-2 py-0.5 rounded bg-amber-950 border border-amber-800 text-amber-300 animate-pulse';
      }

      const activeInst = (typeof currentInstanceKey !== 'undefined' && currentInstanceKey)
        ? currentInstanceKey
        : (localStorage.getItem('nexusdesk_instance') || 'agents_bs');

      try {
        const res = await fetch(`/api/workflows/${encodeURIComponent(wfId)}/trigger?instance=${encodeURIComponent(activeInst)}`, {
          method: 'POST'
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.detail || data.message || `HTTP ${res.status}`);
        }
        currentActiveRunId = data.run_id;
        if (banner) {
          banner.innerText = `Running (${data.name || wfId})`;
          banner.className = 'text-[10px] font-mono px-2 py-0.5 rounded bg-cyan-950 border border-cyan-800 text-cyan-300 animate-pulse';
        }
        loadWorkflowRunsHistory();

        // BL-EVO-33: Immediately open the Live Runner Monitor modal for instant visual feedback
        if (typeof openWorkflowRunInspectModal === 'function' && data.run_id) {
          openWorkflowRunInspectModal(data.run_id);
        }
      } catch (e) {
        alert('Failed to trigger workflow: ' + e);
        if (banner) {
          banner.innerText = 'Idle';
          banner.className = 'text-[10px] font-mono px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-400';
        }
      } finally {
        if (btnElement) {
          btnElement.innerHTML = origHtml;
          btnElement.disabled = false;
        }
      }
    }
    window.triggerWorkflowPipeline = triggerWorkflowPipeline;

    // WebSocket event dispatcher for live runner status (BL-AUTO-36)
    function handleWorkflowWebSocketEvent(payload) {
      const type = payload.type;
      const data = payload.data || {};
      const statusPill = document.getElementById('runner-active-status-pill');

      if (type === 'workflow_run_started') {
        currentActiveRunId = data.run_id;
        if (statusPill) {
          statusPill.innerText = `Active: ${data.workflow_name || data.workflow_id}`;
          statusPill.className = 'text-[10px] font-mono px-2 py-0.5 rounded bg-cyan-950 border border-cyan-800 text-cyan-300 animate-pulse';
        }
        loadWorkflowRunsHistory();
      } else if (type === 'workflow_step_status') {
        // Highlight active step in workflow card
        const wfId = data.workflow_id;
        const stepNum = data.step_order;
        const stepStatus = data.status;

        const stepEl = document.getElementById(`wf-step-${wfId}-${stepNum}`);
        if (stepEl) {
          if (stepStatus === 'active') {
            stepEl.className = 'relative bg-cyan-950/90 p-2.5 rounded-lg border-2 border-cyan-400 text-xs font-mono shadow-md animate-pulse';
          } else if (stepStatus === 'completed') {
            stepEl.className = 'relative bg-emerald-950/70 p-2.5 rounded-lg border border-emerald-500 text-xs font-mono shadow-sm';
            const badge = stepEl.querySelector('.wf-step-badge');
            if (badge) badge.innerHTML = `✅ STEP ${stepNum} (${data.duration || 0}s)`;
          }
        }
        loadWorkflowRunsHistory();
      } else if (type === 'workflow_approval_gate') {
        currentActiveRunId = data.run_id;
        const banner = document.getElementById('workflow-approval-banner');
        const runIdEl = document.getElementById('approval-gate-run-id');
        const descEl = document.getElementById('approval-gate-desc');
        if (banner && runIdEl && descEl) {
          runIdEl.innerText = data.run_id;
          descEl.innerText = data.prompt || `Approval required for ${data.agent} before Step ${data.step_order}`;
          banner.classList.remove('hidden');
        }
        if (statusPill) {
          statusPill.innerText = `Paused (Approval Required)`;
          statusPill.className = 'text-[10px] font-mono px-2 py-0.5 rounded bg-amber-950 border border-amber-800 text-amber-300 animate-bounce';
        }
        loadWorkflowRunsHistory();
      } else if (type === 'workflow_run_completed' || type === 'workflow_run_failed') {
        if (statusPill) {
          if (type === 'workflow_run_completed') {
            statusPill.innerText = `Completed (${data.total_duration || 0}s)`;
            statusPill.className = 'text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-950 border border-emerald-800 text-emerald-300';
          } else {
            statusPill.innerText = `Failed: Step ${data.failed_step || '?'}`;
            statusPill.className = 'text-[10px] font-mono px-2 py-0.5 rounded bg-rose-950 border border-rose-800 text-rose-300';
          }
        }
        document.getElementById('workflow-approval-banner')?.classList.add('hidden');
        loadWorkflowRunsHistory();
      }
    }

    // --- AI WORKFLOW ARCHITECT (BL-AUTO-37) ---
    let currentAIDraftedWorkflow = null;

    function openAIWorkflowArchitectModal() {
      const modal = document.getElementById('ai-workflow-modal');
      const input = document.getElementById('ai-workflow-directive');
      const resBox = document.getElementById('ai-workflow-result-box');
      const applyBtn = document.getElementById('btn-apply-ai-wf');

      if (!modal) return;
      if (input) input.value = '';
      if (resBox) resBox.classList.add('hidden');
      if (applyBtn) applyBtn.classList.add('hidden');
      currentAIDraftedWorkflow = null;
      modal.classList.remove('hidden');
    }

    function closeAIWorkflowArchitectModal() {
      const modal = document.getElementById('ai-workflow-modal');
      if (modal) modal.classList.add('hidden');
    }

    async function generateAIWorkflowDraft() {
      const directive = document.getElementById('ai-workflow-directive')?.value.trim();
      const btn = document.getElementById('btn-generate-ai-wf');
      const resBox = document.getElementById('ai-workflow-result-box');
      const card = document.getElementById('ai-wf-preview-card');
      const stepsCountEl = document.getElementById('ai-wf-steps-count');
      const applyBtn = document.getElementById('btn-apply-ai-wf');

      if (!directive) return alert('Please describe the task or process you want the agents to automate.');

      const originalBtnText = btn.innerHTML;
      btn.innerHTML = '<span>⏳ Synthesizing with AI...</span>';
      btn.disabled = true;

      try {
        const res = await fetch('/api/workflows/ai/draft', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ directive })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || 'Failed to synthesize workflow');

        currentAIDraftedWorkflow = data.workflow;
        const wf = data.workflow;

        let stepsPreviewHtml = '';
        (wf.steps || []).forEach((s, idx) => {
          stepsPreviewHtml += `
            <div class="flex items-start gap-2 text-xs bg-slate-900/90 p-2 rounded-lg border border-slate-800">
              <span class="w-5 h-5 rounded-full bg-cyan-950 border border-cyan-700 text-cyan-300 font-bold flex items-center justify-center text-[10px] shrink-0">${s.order}</span>
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-1.5 font-bold text-white text-xs">
                  <span>${s.agent}</span>
                  ${s.skill ? `<span class="text-[9px] text-amber-300 font-mono px-1.5 py-0.2 rounded bg-amber-950 border border-amber-800">🛠️ ${s.skill}</span>` : ''}
                </div>
                <div class="text-[11px] text-slate-300 mt-0.5">${s.action}</div>
              </div>
            </div>
          `;
        });

        card.innerHTML = `
          <div class="border-b border-slate-800 pb-2">
            <strong class="text-white text-sm block">${wf.name}</strong>
            <span class="text-slate-400 text-[11px] block mt-0.5">${wf.description || ''}</span>
          </div>
          <div class="space-y-1.5 mt-2">
            ${stepsPreviewHtml}
          </div>
        `;

        if (stepsCountEl) stepsCountEl.innerText = `${wf.steps?.length || 0} Sequential Steps`;
        resBox.classList.remove('hidden');
        applyBtn.classList.remove('hidden');
      } catch (e) {
        alert('AI Architect Error: ' + e);
      } finally {
        btn.innerHTML = originalBtnText;
        btn.disabled = false;
      }
    }

    async function applyAIWorkflowDraft() {
      if (!currentAIDraftedWorkflow) return;
      try {
        const res = await fetch('/api/workflows/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(currentAIDraftedWorkflow)
        });
        if (!res.ok) throw new Error('Failed to save synthesized workflow');
        closeAIWorkflowArchitectModal();
        loadWorkflowsDAG();
        alert(`Successfully added pipeline: "${currentAIDraftedWorkflow.name}"!`);
      } catch (e) {
        alert('Error saving synthesized workflow: ' + e);
      }
    }

