    // --- TAB 3: Memory Vault & Agent Skills Studio (BL-OPS-09) ---
    let memoryStudioMode = 'files'; // 'files' | 'skills'
    let cachedWorkspaceFiles = [];
    let cachedAgentSkills = [];
    let activeSkillPath = '';
    let activeSkillLocked = false;
    let editorViewMode = 'edit'; // 'edit' | 'split' | 'preview'

    function switchMemoryStudioMode(mode) {
      memoryStudioMode = mode === 'skills' ? 'skills' : 'files';
      const btnFiles = document.getElementById('btn-mode-memory-files');
      const btnSkills = document.getElementById('btn-mode-skills-studio');
      const titleEl = document.getElementById('memory-explorer-title');
      const subEl = document.getElementById('memory-explorer-subtitle');
      const summaryBadge = document.getElementById('skills-studio-summary-badge');
      const lockBtn = document.getElementById('btn-skill-lock-toggle');
      const scopeBadge = document.getElementById('editor-scope-badge');
      const saveLabel = document.getElementById('btn-save-file-label');

      if (memoryStudioMode === 'skills') {
        if (btnSkills) btnSkills.className = 'px-3.5 py-1.5 rounded-lg bg-amber-900/60 border border-amber-500/80 text-xs font-mono text-amber-200 font-bold transition flex items-center gap-1.5 shadow-sm';
        if (btnFiles) btnFiles.className = 'px-3.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-xs font-mono text-slate-300 hover:text-cyan-300 transition flex items-center gap-1.5';
        if (titleEl) titleEl.innerText = 'SKILLS STUDIO';
        if (subEl) subEl.innerText = 'SKILL.MD & LOCKS';
        if (summaryBadge) summaryBadge.innerText = 'Mode: Agent Skills Studio (Operator Override Active)';
        if (lockBtn) lockBtn.classList.remove('hidden');
        if (scopeBadge) scopeBadge.classList.remove('hidden');
        if (saveLabel) saveLabel.innerText = 'Save Skill';
        loadAgentSkills(activeEditorAgent || (agents[0]?.id || 'solaris'));
      } else {
        if (btnFiles) btnFiles.className = 'px-3.5 py-1.5 rounded-lg bg-cyan-900/60 border border-cyan-500/80 text-xs font-mono text-cyan-200 font-bold transition flex items-center gap-1.5 shadow-sm';
        if (btnSkills) btnSkills.className = 'px-3.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-xs font-mono text-slate-300 hover:text-amber-300 transition flex items-center gap-1.5';
        if (titleEl) titleEl.innerText = 'MEMORY EXPLORER';
        if (subEl) subEl.innerText = 'WORKSPACE FILES';
        if (summaryBadge) summaryBadge.innerText = 'Mode: Workspace Memory Files';
        if (lockBtn) lockBtn.classList.add('hidden');
        if (scopeBadge) scopeBadge.classList.add('hidden');
        if (saveLabel) saveLabel.innerText = 'Save File';
        loadMemoryExplorer(activeEditorAgent || (agents[0]?.id || 'solaris'));
      }
    }

    function renderMemoryAgentPills(agentName) {
      const pillsContainer = document.getElementById('memory-agent-pills');
      if (!pillsContainer) return;
      pillsContainer.innerHTML = '';
      agents.forEach(a => {
        const isAct = (a.id === agentName);
        const clickHandler = memoryStudioMode === 'skills'
          ? `loadAgentSkills('${a.id}')`
          : `loadMemoryExplorer('${a.id}')`;
        pillsContainer.innerHTML += `
          <button onclick="${clickHandler}" class="px-2.5 py-1 rounded text-[11px] font-mono transition ${isAct ? 'bg-cyan-600 text-white font-bold' : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'}">
            ${a.name}
          </button>
        `;
      });
    }

    function extractClientGroundTruthTargets(rawText) {
      if (!rawText) return [];
      const seen = new Set();
      const results = [];
      const patterns = [
        { category: 'ENV / Account ID', regex: /\b(INSTAGRAM_ACCOUNT_ID(?:_\d+)?\s*=\s*\d+|\b1784\d{11,15}\b)/g },
        { category: 'Google Drive ID', regex: /\b(1[a-zA-Z0-9_-]{25,38})\b/g },
        { category: 'Filesystem Path', regex: /(\/home\/[a-zA-Z0-9_./-]+|~\/\.hermes\/[a-zA-Z0-9_./-]+)/g },
        { category: 'API Endpoint', regex: /(https?:\/\/[a-zA-Z0-9._/-]+)/g },
        { category: 'CLI Script', regex: /\b([a-zA-Z0-9_-]+\.py(?:\s+--[a-zA-Z0-9_-]+(?:\s+[a-zA-Z0-9_-]+)?)?)/g }
      ];

      patterns.forEach(({ category, regex }) => {
        let match;
        while ((match = regex.exec(rawText)) !== null) {
          const val = match[1].trim().replace(/[.,;)]+$/, '');
          if (val.length >= 5 && !seen.has(val)) {
            seen.add(val);
            results.push({ category, value: val });
          }
          if (results.length >= 24) break;
        }
      });
      return results;
    }

    function renderGroundTruthInspector(targets) {
      const countEl = document.getElementById('ground-truth-count');
      const pillsEl = document.getElementById('ground-truth-pills');
      if (!pillsEl) return;

      const list = Array.isArray(targets) ? targets : extractClientGroundTruthTargets(document.getElementById('editor-textarea')?.value || '');
      if (countEl) countEl.innerText = `${list.length} target(s) detected`;

      if (list.length === 0) {
        pillsEl.innerHTML = `<span class="text-[11px] font-mono text-slate-500">No external IDs, Drive folders, or script paths detected in current document.</span>`;
        return;
      }

      const badgeColors = {
        'ENV / Account ID': 'bg-rose-950/80 border-rose-700/80 text-rose-300',
        'Google Drive ID': 'bg-amber-950/80 border-amber-700/80 text-amber-300',
        'Filesystem Path': 'bg-cyan-950/80 border-cyan-700/80 text-cyan-300',
        'API Endpoint': 'bg-purple-950/80 border-purple-700/80 text-purple-300',
        'CLI Script': 'bg-emerald-950/80 border-emerald-700/80 text-emerald-300',
        'CLI Flag / Script': 'bg-emerald-950/80 border-emerald-700/80 text-emerald-300'
      };

      pillsEl.innerHTML = list.map(t => {
        const cls = badgeColors[t.category] || 'bg-slate-900 border-slate-700 text-slate-300';
        const safeVal = t.value.replace(/'/g, "\\'");
        return `
          <button type="button" onclick="highlightTargetInEditor('${safeVal}')" title="${t.category} — Click to locate & highlight in editor" class="px-2 py-0.5 rounded border text-[10px] font-mono flex items-center gap-1.5 hover:brightness-125 transition cursor-pointer ${cls}">
            <span class="opacity-70 text-[9px] uppercase">${t.category.split(' ')[0]}:</span>
            <span class="font-bold select-text">${t.value}</span>
          </button>
        `;
      }).join('');
    }

    function highlightTargetInEditor(targetStr) {
      const ta = document.getElementById('editor-textarea');
      if (!ta || !targetStr) return;
      if (ta.classList.contains('hidden')) {
        toggleEditorPreview();
      }
      const content = ta.value;
      const idx = content.indexOf(targetStr);
      if (idx !== -1) {
        ta.focus();
        ta.setSelectionRange(idx, idx + targetStr.length);
        // Approximate scroll to line
        const linesBefore = content.substring(0, idx).split('\n').length;
        const lineHeight = 18;
        ta.scrollTop = Math.max(0, (linesBefore - 5) * lineHeight);
      }
    }

    function onEditorContentChange() {
      const val = document.getElementById('editor-textarea')?.value || '';
      if (editorViewMode === 'split' || editorViewMode === 'preview') {
        const prev = document.getElementById('editor-preview');
        if (prev && typeof marked !== 'undefined') {
          prev.innerHTML = marked.parse(val);
        }
      }
      renderGroundTruthInspector(extractClientGroundTruthTargets(val));
    }

    function filterMemoryOrSkillsList(query) {
      const q = (query || '').trim().toLowerCase();
      if (memoryStudioMode === 'skills') {
        renderAgentSkillsList(activeEditorAgent, cachedAgentSkills.filter(s =>
          s.name.toLowerCase().includes(q) ||
          (s.description || '').toLowerCase().includes(q) ||
          (s.folder || '').toLowerCase().includes(q)
        ));
      } else {
        renderWorkspaceFilesList(activeEditorAgent, cachedWorkspaceFiles.filter(f =>
          f.path.toLowerCase().includes(q) || f.name.toLowerCase().includes(q)
        ));
      }
    }

    async function loadMemoryExplorer(agentName) {
      activeEditorAgent = agentName;
      if (memoryStudioMode === 'skills') {
        return loadAgentSkills(agentName);
      }
      renderMemoryAgentPills(agentName);

      const listContainer = document.getElementById('memory-file-list');
      listContainer.innerHTML = '<div class="text-slate-500 text-xs">Scanning workspace directory...</div>';

      try {
        const res = await fetch(`/api/agent/${encodeURIComponent(agentName)}/files`);
        const data = await res.json();
        if (!res.ok || !data || !Array.isArray(data.files)) {
          cachedWorkspaceFiles = [];
          listContainer.innerHTML = `<div class="text-amber-400 text-xs p-2 font-mono">${data?.detail || 'No files found or directory inaccessible.'}</div>`;
          return;
        }
        cachedWorkspaceFiles = data.files;
        renderWorkspaceFilesList(agentName, cachedWorkspaceFiles);

        if (cachedWorkspaceFiles.length > 0) {
          const preferred = cachedWorkspaceFiles.find(f => f.path === activeEditorFilePath) || cachedWorkspaceFiles[0];
          openMemoryFile(agentName, preferred.path);
        }
      } catch (e) {
        listContainer.innerHTML = `<div class="text-rose-400 text-xs p-2 font-mono">Failed to load files: ${e}</div>`;
      }
    }

    function renderWorkspaceFilesList(agentName, files) {
      const listContainer = document.getElementById('memory-file-list');
      if (!listContainer) return;
      listContainer.innerHTML = '';
      if (!files || files.length === 0) {
        listContainer.innerHTML = '<div class="text-slate-500 text-xs p-2 font-mono">No matching files found.</div>';
        return;
      }
      files.forEach(f => {
        const isSelected = (f.path === activeEditorFilePath);
        const safePath = f.path.replace(/'/g, "\\'");
        listContainer.innerHTML += `
          <div onclick="openMemoryFile('${agentName}', '${safePath}')" class="p-2 rounded border cursor-pointer transition flex justify-between items-center ${isSelected ? 'bg-slate-900 border-cyan-500 text-cyan-300' : 'bg-slate-950/60 border-slate-800/80 text-slate-300 hover:border-slate-700'}">
            <span class="truncate flex items-center gap-1.5">
              <span>${f.is_markdown ? '📄' : (f.is_code ? '⚡' : '📁')}</span>
              <span class="truncate">${f.path}</span>
            </span>
            <span class="text-[10px] text-slate-500 font-mono shrink-0 ml-2">${(f.size / 1024).toFixed(1)} KB</span>
          </div>
        `;
      });
    }

    async function openMemoryFile(agentName, filePath) {
      activeEditorAgent = agentName;
      activeEditorFilePath = filePath;
      renderWorkspaceFilesList(agentName, cachedWorkspaceFiles);

      document.getElementById('editor-filename').innerText = filePath.split('/').pop();
      const inst = (typeof currentInstanceKey !== 'undefined' && currentInstanceKey) ? currentInstanceKey : 'agents_bs';
      document.getElementById('editor-filepath').innerText = `/home/${inst}/workspace/${agents.find(x => x.id === agentName)?.workspace || agentName}/${filePath}`;

      try {
        const res = await fetch(`/api/agent/${encodeURIComponent(agentName)}/file?path=${encodeURIComponent(filePath)}`);
        const data = await res.json();
        const content = data.content || '';
        document.getElementById('editor-textarea').value = content;
        if (typeof marked !== 'undefined') {
          document.getElementById('editor-preview').innerHTML = marked.parse(content);
        }
        renderGroundTruthInspector(extractClientGroundTruthTargets(content));
      } catch (e) {
        document.getElementById('editor-textarea').value = 'Error opening file: ' + e;
      }
    }

    // --- SKILLS STUDIO FUNCTIONS (BL-OPS-09) ---
    async function loadAgentSkills(agentName) {
      activeEditorAgent = agentName || (agents[0]?.id || 'solaris');
      renderMemoryAgentPills(activeEditorAgent);

      const listContainer = document.getElementById('memory-file-list');
      listContainer.innerHTML = '<div class="text-slate-500 text-xs">Scanning global & profile SKILL.md definitions...</div>';

      try {
        const res = await fetch(`/api/agent/${encodeURIComponent(activeEditorAgent)}/skills`);
        const data = await res.json();
        if (!res.ok || !data || !Array.isArray(data.skills)) {
          cachedAgentSkills = [];
          listContainer.innerHTML = `<div class="text-amber-400 text-xs p-2 font-mono">${data?.detail || 'No skills discovered for this fleet.'}</div>`;
          return;
        }
        cachedAgentSkills = data.skills;
        renderAgentSkillsList(activeEditorAgent, cachedAgentSkills);

        if (cachedAgentSkills.length > 0) {
          const preferred = cachedAgentSkills.find(s => s.path === activeSkillPath) || cachedAgentSkills[0];
          openAgentSkill(activeEditorAgent, preferred.path);
        } else {
          listContainer.innerHTML = '<div class="text-slate-500 text-xs p-2 font-mono">No SKILL.md files found in ~/.hermes/skills for this fleet.</div>';
          document.getElementById('editor-textarea').value = '';
          renderGroundTruthInspector([]);
        }
      } catch (err) {
        listContainer.innerHTML = `<div class="text-rose-400 text-xs p-2 font-mono">Failed to load skills: ${err}</div>`;
      }
    }

    function renderAgentSkillsList(agentName, skills) {
      const listContainer = document.getElementById('memory-file-list');
      if (!listContainer) return;
      listContainer.innerHTML = '';
      if (!skills || skills.length === 0) {
        listContainer.innerHTML = '<div class="text-slate-500 text-xs p-2 font-mono">No matching skills found.</div>';
        return;
      }

      skills.forEach(s => {
        const isSelected = (s.path === activeSkillPath);
        const safePath = s.path.replace(/'/g, "\\'");
        const lockBadge = s.locked
          ? `<span class="px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-700 text-[9px] font-bold shrink-0" title="Locked (chmod ${s.readonly_mode}) — Protected from autonomous overwrite">🔒 LOCKED</span>`
          : `<span class="px-1.5 py-0.5 rounded bg-amber-950/70 text-amber-300 border border-amber-800/70 text-[9px] shrink-0" title="Auto-Evolve — Hermes can update this skill">🔓 AUTO</span>`;

        listContainer.innerHTML += `
          <div onclick="openAgentSkill('${agentName}', '${safePath}')" class="p-2.5 rounded-lg border cursor-pointer transition flex flex-col gap-1 ${isSelected ? 'bg-slate-900 border-amber-500 text-amber-200 shadow-md' : 'bg-slate-950/70 border-slate-800/80 text-slate-300 hover:border-slate-700'}">
            <div class="flex items-center justify-between gap-2">
              <span class="font-bold text-xs truncate flex items-center gap-1.5">
                <span>🛠️</span>
                <span class="truncate">${s.name}</span>
              </span>
              ${lockBadge}
            </div>
            <p class="text-[10px] text-slate-400 line-clamp-1">${s.description || 'Skill definition'}</p>
            <div class="flex items-center justify-between text-[9px] text-slate-500 pt-0.5">
              <span>${s.scope.toUpperCase()} • ${(s.size / 1024).toFixed(1)} KB</span>
              <span>🎯 ${s.targets_count || 0} target(s)</span>
            </div>
          </div>
        `;
      });
    }

    function updateSkillLockButtonUI(locked, readonlyMode = '') {
      activeSkillLocked = !!locked;
      const btn = document.getElementById('btn-skill-lock-toggle');
      const icon = document.getElementById('skill-lock-icon');
      const label = document.getElementById('skill-lock-label');
      const tidyBtn = document.getElementById('btn-skill-tidy-ai');
      if (tidyBtn) tidyBtn.classList.remove('hidden');

      if (!btn || !icon || !label) return;

      if (activeSkillLocked) {
        btn.className = 'px-3 py-1.5 rounded-lg border bg-emerald-950/90 border-emerald-600 text-emerald-300 hover:bg-emerald-900 text-xs font-mono font-bold transition flex items-center gap-1.5 cursor-pointer shadow-sm';
        icon.innerText = '🔒';
        label.innerText = `LOCKED (User Verified${readonlyMode ? ' • ' + readonlyMode : ''})`;
      } else {
        btn.className = 'px-3 py-1.5 rounded-lg border bg-amber-950/80 border-amber-700 text-amber-300 hover:bg-amber-900 text-xs font-mono font-bold transition flex items-center gap-1.5 cursor-pointer shadow-sm';
        icon.innerText = '🔓';
        label.innerText = 'AUTO-EVOLVE (Hermes Managed)';
      }
    }

    async function openAgentSkill(agentName, skillPath) {
      activeEditorAgent = agentName;
      activeSkillPath = skillPath;
      renderAgentSkillsList(agentName, cachedAgentSkills);

      try {
        const res = await fetch(`/api/agent/${encodeURIComponent(agentName)}/skill?path=${encodeURIComponent(skillPath)}`);
        const data = await res.json();
        if (!res.ok) {
          document.getElementById('editor-textarea').value = `Error loading skill: ${data.detail || 'Unknown error'}`;
          return;
        }
        document.getElementById('editor-filename').innerText = `${data.name} (SKILL.md)`;
        document.getElementById('editor-filepath').innerText = data.path;
        const scopeBadge = document.getElementById('editor-scope-badge');
        if (scopeBadge) {
          scopeBadge.innerText = data.locked ? `🔒 READ-ONLY (${data.readonly_mode || '0444'})` : '🔓 WRITABLE (0644)';
        }

        updateSkillLockButtonUI(data.locked, data.readonly_mode);
        const content = data.content || '';
        document.getElementById('editor-textarea').value = content;
        if (typeof marked !== 'undefined') {
          document.getElementById('editor-preview').innerHTML = marked.parse(content);
        }
        renderGroundTruthInspector(data.targets || extractClientGroundTruthTargets(content));
      } catch (err) {
        document.getElementById('editor-textarea').value = 'Error opening skill: ' + err;
      }
    }

    async function toggleActiveSkillLock() {
      if (memoryStudioMode !== 'skills' || !activeSkillPath) return;
      const newLockState = !activeSkillLocked;
      const inst = (typeof currentInstanceKey !== 'undefined' && currentInstanceKey) ? currentInstanceKey : 'agents_bs';

      try {
        const res = await fetch(`/api/agent/${encodeURIComponent(activeEditorAgent)}/skill/lock`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            path: activeSkillPath,
            locked: newLockState,
            instance: inst
          })
        });
        const data = await res.json();
        if (!res.ok) {
          return alert(`Failed to toggle skill lock: ${data.detail || 'Error'}`);
        }

        updateSkillLockButtonUI(data.locked, data.readonly_mode);
        if (data.content) {
          document.getElementById('editor-textarea').value = data.content;
          if (typeof marked !== 'undefined') {
            document.getElementById('editor-preview').innerHTML = marked.parse(data.content);
          }
        }
        const scopeBadge = document.getElementById('editor-scope-badge');
        if (scopeBadge) {
          scopeBadge.innerText = data.locked ? `🔒 READ-ONLY (${data.readonly_mode || '0444'})` : '🔓 WRITABLE (0644)';
        }

        // Update cached list state
        const item = cachedAgentSkills.find(s => s.path === activeSkillPath);
        if (item) {
          item.locked = data.locked;
          item.readonly_mode = data.readonly_mode;
          renderAgentSkillsList(activeEditorAgent, cachedAgentSkills);
        }

        const toast = document.getElementById('editor-save-toast');
        if (toast) {
          toast.innerText = data.locked ? '🔒 Skill Locked (chmod 0444)!' : '🔓 Skill Unlocked (Auto-Evolve)!';
          toast.classList.remove('hidden');
          setTimeout(() => toast.classList.add('hidden'), 3000);
        }
      } catch (err) {
        alert('Error toggling lock: ' + err);
      }
    }

    async function saveActiveFileContent() {
      const content = document.getElementById('editor-textarea').value;
      const toast = document.getElementById('editor-save-toast');
      const inst = (typeof currentInstanceKey !== 'undefined' && currentInstanceKey) ? currentInstanceKey : 'agents_bs';

      try {
        if (memoryStudioMode === 'skills') {
          if (!activeSkillPath) return alert('No active skill selected.');
          const res = await fetch(`/api/agent/${encodeURIComponent(activeEditorAgent)}/skill`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              path: activeSkillPath,
              content: content,
              instance: inst
            })
          });
          const data = await res.json();
          if (res.ok) {
            if (toast) {
              toast.innerText = data.locked ? 'Saved (Operator Override + Re-locked 0444)!' : 'Skill saved to disk!';
              toast.classList.remove('hidden');
              setTimeout(() => toast.classList.add('hidden'), 3500);
            }
            if (typeof marked !== 'undefined') {
              document.getElementById('editor-preview').innerHTML = marked.parse(content);
            }
            renderGroundTruthInspector(data.targets || extractClientGroundTruthTargets(content));
            await loadAgentSkills(activeEditorAgent);
          } else {
            alert(`Failed to save skill: ${data.detail || 'Validation error'}`);
          }
          return;
        }

        const res = await fetch(`/api/agent/${encodeURIComponent(activeEditorAgent)}/file`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: activeEditorFilePath, content, instance: inst })
        });
        if (res.ok) {
          if (toast) {
            toast.innerText = 'Saved to disk!';
            toast.classList.remove('hidden');
            setTimeout(() => toast.classList.add('hidden'), 3500);
          }
          if (typeof marked !== 'undefined') {
            document.getElementById('editor-preview').innerHTML = marked.parse(content);
          }
          renderGroundTruthInspector(extractClientGroundTruthTargets(content));
        } else {
          const err = await res.json();
          alert(`Failed to save file: ${err.detail || 'Unknown error'}`);
        }
      } catch (e) {
        alert('Error saving: ' + e);
      }
    }

    function toggleEditorPreview() {
      const wrapper = document.getElementById('editor-panes-wrapper');
      const ta = document.getElementById('editor-textarea');
      const prev = document.getElementById('editor-preview');
      const btn = document.getElementById('btn-preview-toggle');
      if (!ta || !prev || !wrapper) return;

      if (editorViewMode === 'edit') {
        editorViewMode = 'split';
        wrapper.className = 'flex-1 grid grid-cols-1 lg:grid-cols-2 gap-3 overflow-hidden relative min-h-[420px]';
        ta.classList.remove('hidden');
        prev.classList.remove('hidden');
        if (btn) btn.innerText = 'Full Preview';
      } else if (editorViewMode === 'split') {
        editorViewMode = 'preview';
        wrapper.className = 'flex-1 grid grid-cols-1 gap-3 overflow-hidden relative min-h-[420px]';
        ta.classList.add('hidden');
        prev.classList.remove('hidden');
        if (btn) btn.innerText = 'Edit Raw Code';
      } else {
        editorViewMode = 'edit';
        wrapper.className = 'flex-1 grid grid-cols-1 gap-3 overflow-hidden relative min-h-[420px]';
        ta.classList.remove('hidden');
        prev.classList.add('hidden');
        if (btn) btn.innerText = 'Split / Preview';
      }

      if (editorViewMode !== 'edit' && typeof marked !== 'undefined') {
        prev.innerHTML = marked.parse(ta.value);
      }
    }

    // --- AI SKILL TIDY & DEDUPLICATION WITH VISUAL DIFF (BL-AUTO-37) ---
    let pendingTidyResult = null;

    async function openSkillTidyModal() {
      if (!activeSkillPath || memoryStudioMode !== 'skills') {
        alert('Please select an active skill first in Skills Studio.');
        return;
      }

      const modal = document.getElementById('skill-tidy-modal');
      const sub = document.getElementById('skill-tidy-modal-sub');
      const diffContainer = document.getElementById('skill-tidy-diff-container');
      const warningsBox = document.getElementById('skill-tidy-warnings-box');
      const warningsList = document.getElementById('skill-tidy-warnings-list');
      const statOrig = document.getElementById('tidy-stat-orig');
      const statClean = document.getElementById('tidy-stat-clean');
      const statRed = document.getElementById('tidy-stat-reduction');

      if (!modal) return;
      sub.innerText = `Analyzing ${activeSkillPath}...`;
      diffContainer.innerHTML = '<div class="text-cyan-400 p-4">⏳ AI Architect is analyzing skill content, pruning duplicates & calculating unified diff...</div>';
      if (warningsBox) warningsBox.classList.add('hidden');
      modal.classList.remove('hidden');

      try {
        const inst = (typeof currentInstanceKey !== 'undefined' && currentInstanceKey) ? currentInstanceKey : 'agents_bs';
        const res = await fetch(`/api/agent/${encodeURIComponent(activeEditorAgent)}/skill/tidy`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: activeSkillPath, instance: inst })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || 'Failed to tidy skill');

        pendingTidyResult = data;
        sub.innerText = `Refactoring proposal for: ${data.skill_name || 'skill'}`;

        if (statOrig) statOrig.innerText = `${data.original_length} chars`;
        if (statClean) statClean.innerText = `${data.cleaned_length} chars`;
        const diffChars = data.original_length - data.cleaned_length;
        const pct = Math.round((diffChars / (data.original_length || 1)) * 100);
        if (statRed) statRed.innerText = `${diffChars >= 0 ? '-' : '+'}${Math.abs(diffChars)} chars (${pct}%)`;

        // Safety Linter Warnings
        if (data.lint_warnings && data.lint_warnings.length > 0) {
          warningsList.innerHTML = data.lint_warnings.map(w => `<li>${w}</li>`).join('');
          warningsBox.classList.remove('hidden');
        } else {
          warningsBox.classList.add('hidden');
        }

        // Colorize unified diff
        const rawDiff = data.diff || '(No text changes detected between original and cleaned output)';
        const coloredDiff = rawDiff.split('\n').map(line => {
          if (line.startsWith('+') && !line.startsWith('+++')) {
            return `<span class="text-emerald-400 font-bold">${escapeHtml(line)}</span>`;
          } else if (line.startsWith('-') && !line.startsWith('---')) {
            return `<span class="text-rose-400 font-bold bg-rose-950/40">${escapeHtml(line)}</span>`;
          } else if (line.startsWith('@@')) {
            return `<span class="text-cyan-300 font-bold">${escapeHtml(line)}</span>`;
          }
          return `<span class="text-slate-400">${escapeHtml(line)}</span>`;
        }).join('\n');

        diffContainer.innerHTML = coloredDiff;
      } catch (err) {
        diffContainer.innerHTML = `<div class="text-rose-400 p-4">Error running AI Tidy: ${err}</div>`;
      }
    }

    function closeSkillTidyModal() {
      const modal = document.getElementById('skill-tidy-modal');
      if (modal) modal.classList.add('hidden');
      pendingTidyResult = null;
    }

    async function applySkillTidyChanges() {
      if (!pendingTidyResult || !pendingTidyResult.cleaned_content || !activeSkillPath) return;

      const inst = (typeof currentInstanceKey !== 'undefined' && currentInstanceKey) ? currentInstanceKey : 'agents_bs';
      try {
        const res = await fetch(`/api/agent/${encodeURIComponent(activeEditorAgent)}/skill`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            path: activeSkillPath,
            content: pendingTidyResult.cleaned_content,
            instance: inst
          })
        });
        if (!res.ok) throw new Error('Failed to save cleaned skill');

        // Update local editor view
        const ta = document.getElementById('editor-textarea');
        if (ta) ta.value = pendingTidyResult.cleaned_content;
        const prev = document.getElementById('editor-preview');
        if (prev && typeof marked !== 'undefined') prev.innerHTML = marked.parse(pendingTidyResult.cleaned_content);

        const toast = document.getElementById('editor-save-toast');
        if (toast) {
          toast.innerText = '✨ AI Tidy Applied & Saved (.bak created)!';
          toast.classList.remove('hidden');
          setTimeout(() => toast.classList.add('hidden'), 4000);
        }

        closeSkillTidyModal();
        alert('Successfully applied refactored skill! Automatic timestamped backup was preserved on disk.');
      } catch (e) {
        alert('Failed to apply changes: ' + e);
      }
    }
