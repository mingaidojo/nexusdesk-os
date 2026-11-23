    // =========================================================================
    // BL-WAR-15: Operator Inquiries Deck & Quick-Decision Matrix
    // =========================================================================
    let activeRoomInquiries = [];
    let inquiriesTrayCollapsed = false;

    function _escapeInqHtml(str) {
      if (!str) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    async function fetchRoomInquiries(roomId = activeWarRoomId) {
      const targetRoom = roomId || activeWarRoomId || 'general';
      try {
        const res = await fetch(`/api/war-room/inquiries?room_id=${encodeURIComponent(targetRoom)}`);
        if (!res.ok) return;
        const data = await res.json();
        activeRoomInquiries = data.inquiries || [];
        renderInquiriesDeck();
      } catch (e) {
        console.warn('Failed to fetch room inquiries:', e);
      }
    }

    function renderInquiriesDeck() {
      const deck = document.getElementById('warroom-inquiries-deck');
      const headerText = document.getElementById('warroom-inquiries-header');
      const body = document.getElementById('warroom-inquiries-body');
      if (!deck || !body) return;

      if (!activeRoomInquiries || activeRoomInquiries.length === 0) {
        deck.classList.add('hidden');
        return;
      }

      deck.classList.remove('hidden');
      const count = activeRoomInquiries.length;
      if (headerText) {
        headerText.innerText = `🔔 ${count} Decision${count > 1 ? 's' : ''} Pending from Agent${count > 1 ? 's' : ''}`;
      }

      body.innerHTML = '';
      activeRoomInquiries.forEach(inq => {
        const card = document.createElement('div');
        const color = inq.color || '#38bdf8';
        const st = String(inq.status || '').toLowerCase();
        const isErrStatus = (st === 'timeout' || st === 'failed');
        const borderCls = isErrStatus
          ? 'border-rose-700/80 bg-rose-950/25'
          : (st === 'completed' ? 'border-emerald-700/70 bg-slate-950/85' : 'border-slate-800 bg-slate-950/80');
        card.className = `p-2 rounded-lg border ${borderCls} flex flex-col gap-1.5 transition`;

        let statusBadgeHtml = '<span class="text-[9px] px-1.5 py-0.2 rounded bg-amber-950/90 text-amber-300 border border-amber-600/70 font-mono font-bold">❓ INPUT NEEDED</span>';
        if (st === 'timeout') {
          statusBadgeHtml = '<span class="text-[9px] px-1.5 py-0.2 rounded bg-rose-950 text-rose-200 border border-rose-500/80 font-mono font-bold">⏱️ TIMED OUT</span>';
        } else if (st === 'failed') {
          statusBadgeHtml = '<span class="text-[9px] px-1.5 py-0.2 rounded bg-rose-950 text-rose-200 border border-rose-500/80 font-mono font-bold">❌ TASK FAILED</span>';
        } else if (st === 'completed_with_blockers') {
          statusBadgeHtml = '<span class="text-[9px] px-1.5 py-0.2 rounded bg-amber-950 text-amber-200 border border-amber-500/80 font-mono font-bold">⚠️ BLOCKERS</span>';
        } else if (st === 'completed') {
          statusBadgeHtml = '<span class="text-[9px] px-1.5 py-0.2 rounded bg-emerald-950 text-emerald-200 border border-emerald-600/80 font-mono font-bold">✅ COMPLETED</span>';
        }

        // Header line: Agent badge, status badge, date+time, dismiss button
        const timeStr = inq.timestamp
          ? ((typeof window.formatNexusDateTime === 'function')
              ? window.formatNexusDateTime(inq.timestamp, false)
              : new Date(inq.timestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))
          : '';
        const chipsHtml = (inq.chips || []).map((chip, idx) => {
          const isObj = chip && typeof chip === 'object';
          const lbl = _escapeInqHtml(isObj ? (chip.label || chip.prompt || 'Action') : String(chip));
          const promptPreview = _escapeInqHtml(isObj ? (chip.prompt || chip.label || '') : String(chip));
          const safeInqId = String(inq.id || '').replace(/'/g, "\\'");
          const safeAg = String(inq.agent || '').replace(/'/g, "\\'");
          return `
          <button type="button" onclick="selectInquiryQuickChip('${safeInqId}', '${safeAg}', ${idx})"
                  title="Click to insert: @${_escapeInqHtml(inq.agent)} ${promptPreview}"
                  class="px-2 py-0.5 rounded bg-amber-950/80 hover:bg-amber-900 border border-amber-600/70 text-amber-200 text-[10px] font-mono font-medium transition cursor-pointer flex items-center gap-1">
            <span>⚡ ${lbl}</span>
          </button>
        `;
        }).join('');

        // BL-EVO-21: Render dedicated next step callout block if declared
        const nextStepHtml = inq.next_step ? `
          <div class="pl-3.5 pt-0.5">
            <div class="px-2 py-1.5 rounded bg-amber-500/10 border border-amber-500/30 flex items-start gap-1.5 text-[11px] font-mono">
              <span class="text-amber-400 font-bold shrink-0">👉 Proposed Next Step:</span>
              <span class="text-amber-200 font-medium select-text">${_escapeInqHtml(inq.next_step)}</span>
            </div>
          </div>
        ` : '';

        const qBorderCls = isErrStatus ? 'border-rose-500/70 text-rose-100' : 'border-amber-500/50 text-amber-100';
        card.innerHTML = `
          <div class="flex items-center justify-between text-[11px]">
            <div class="flex items-center gap-1.5 min-w-0 flex-wrap">
              <span class="w-2 h-2 rounded-full" style="background: ${color}"></span>
              <strong class="font-bold text-slate-200">${_escapeInqHtml(inq.agent)}</strong>
              <span class="text-[9.5px] px-1 rounded bg-slate-800 text-slate-400 font-mono">${_escapeInqHtml((inq.engine || '').toUpperCase())}</span>
              ${statusBadgeHtml}
              <span class="text-[9px] text-slate-500 font-mono">${timeStr}</span>
            </div>
            <button type="button" onclick="resolveInquiry('${String(inq.id || '').replace(/'/g, "\\'")}', '${String(inq.agent || '').replace(/'/g, "\\'")}')" class="text-[10px] text-slate-500 hover:text-rose-400 cursor-pointer font-mono" title="Dismiss this inquiry">✕</button>
          </div>
          <p class="text-xs font-mono leading-relaxed pl-3.5 border-l-2 ${qBorderCls} select-text">${_escapeInqHtml(inq.question)}</p>
          ${nextStepHtml}
          <div class="flex flex-wrap gap-1.5 pt-0.5 pl-3.5">
            ${chipsHtml}
          </div>
        `;
        body.appendChild(card);
      });
    }

    function toggleInquiriesTray() {
      const body = document.getElementById('warroom-inquiries-body');
      const btn = document.getElementById('btn-toggle-inquiries');
      if (!body) return;
      inquiriesTrayCollapsed = !inquiriesTrayCollapsed;
      if (inquiriesTrayCollapsed) {
        body.classList.add('hidden');
        if (btn) btn.innerText = 'Expand';
      } else {
        body.classList.remove('hidden');
        if (btn) btn.innerText = 'Collapse';
      }
    }

    async function resolveInquiry(inquiryId, agentName) {
      try {
        await fetch('/api/war-room/inquiries/resolve', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            room_id: activeWarRoomId || 'general',
            inquiry_id: inquiryId,
            agent: agentName
          })
        });
        activeRoomInquiries = activeRoomInquiries.filter(i => i.id !== inquiryId);
        renderInquiriesDeck();
      } catch (e) {
        console.warn('Failed to resolve inquiry:', e);
      }
    }

    async function resolveAllInquiries(e) {
      if (e && typeof e.stopPropagation === 'function') {
        e.stopPropagation();
      }
      // Optimistic UI clear immediately
      activeRoomInquiries = [];
      renderInquiriesDeck();
      try {
        await fetch('/api/war-room/inquiries/resolve', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            room_id: activeWarRoomId || 'general',
            inquiry_id: 'all'
          })
        });
      } catch (e) {
        console.warn('Failed to resolve all inquiries:', e);
      }
    }
    window.resolveAllInquiries = resolveAllInquiries;
    window.resolveInquiry = resolveInquiry;
    window.renderInquiriesDeck = renderInquiriesDeck;
    window.toggleInquiriesTray = toggleInquiriesTray;
    window.fetchRoomInquiries = fetchRoomInquiries;

    function selectInquiryQuickChip(inquiryId, agentName, chipIdxOrText) {
      const input = document.getElementById('warroom-text-input');
      if (!input) return;
      const targetInq = (activeRoomInquiries || []).find(i => i.id === inquiryId);
      let actionText = '';

      if (targetInq && Array.isArray(targetInq.chips) && typeof chipIdxOrText === 'number') {
        const chipItem = targetInq.chips[chipIdxOrText];
        if (chipItem && typeof chipItem === 'object') {
          actionText = chipItem.prompt || chipItem.label || '';
        } else if (chipItem !== undefined) {
          actionText = String(chipItem);
        }
      } else {
        actionText = String(chipIdxOrText || '');
      }

      // Backwards-compatible expansion for legacy string chips
      if (targetInq && targetInq.next_step && actionText.startsWith('Approve:')) {
        actionText = `Approved: proceed with ${targetInq.next_step}`;
      } else if (actionText === 'Specify Next Step') {
        actionText = 'For the next step, please: ';
      } else if (actionText === 'Review Deliverables') {
        actionText = 'Summarize and verify the generated deliverables and key metrics.';
      } else if (actionText === 'Revise') {
        actionText = 'Please revise the output: ';
      } else if (actionText === 'Acknowledge') {
        actionText = 'Proceed as you proposed.';
      } else if (actionText === 'Clarify') {
        actionText = 'Please clarify what specific decision or input you need from me.';
      }

      const formatted = `@${agentName} ${actionText}`;
      input.value = input.value ? `${input.value.trim()} • ${formatted}` : formatted;
      input.focus();
      if (typeof autoResizeTextarea === 'function') {
        autoResizeTextarea(input);
      }
      // Auto-resolve inquiry once answered
      resolveInquiry(inquiryId, agentName);
    }


    function playOperatorMentionChime() {
      try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = new AudioCtx();
        const now = ctx.currentTime;
        // Two-tone pleasant alert chime (E5 -> A5)
        [659.25, 880.0].forEach((freq, idx) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, now + idx * 0.14);
          gain.gain.setValueAtTime(0.08, now + idx * 0.14);
          gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.14 + 0.25);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(now + idx * 0.14);
          osc.stop(now + idx * 0.14 + 0.26);
        });
      } catch (e) {}
    }

    // BL-WAR-13: Shared War Room Sandbox Storage & Lifecycle Management
    async function loadWarRoomSandboxStats(roomId = activeWarRoomId) {
      const targetRoom = roomId || activeWarRoomId || 'general';
      const pill = document.getElementById('warroom-storage-pill');
      if (!pill) return;
      try {
        const res = await fetch(`/api/war-room/sandbox/stats?room_id=${encodeURIComponent(targetRoom)}`);
        if (res.ok) {
          const data = await res.json();
          const quotaLabel = (data.quota_mb >= 1024) ? `${Math.round(data.quota_mb / 1024)} GB` : `${data.quota_mb} MB`;
          pill.innerText = `${data.total_mb} MB / ${quotaLabel}`;
          pill.title = `Shared Sandbox: ${data.sandbox_path}\n• Deliverables: ${data.deliverables_mb} MB (${data.deliverables_count} files)\n• Scratch: ${data.scratch_mb} MB (${data.scratch_count} files)\nClick to inspect or archive room.`;
          const sidecarBtn = document.getElementById('btn-warroom-files-sidecar');
          if (sidecarBtn) {
            if (data.approaching_quota || data.quota_exceeded) {
              sidecarBtn.classList.add('border-amber-600', 'text-amber-200');
              sidecarBtn.classList.remove('border-sky-700/80', 'text-sky-300');
            } else {
              sidecarBtn.classList.remove('border-amber-600', 'text-amber-200');
              sidecarBtn.classList.add('border-sky-700/80', 'text-sky-300');
            }
          }
        }
      } catch (e) {
        console.warn('Failed to load sandbox stats:', e);
      }
    }

    async function openWarRoomSandboxModal() {
      const modal = document.getElementById('modal-warroom-sandbox');
      if (!modal) return;
      const targetRoom = activeWarRoomId || 'general';
      
      const pathEl = document.getElementById('sandbox-path-text');
      const totalEl = document.getElementById('sandbox-total-text');
      const delivEl = document.getElementById('sandbox-deliverables-text');
      const scratchEl = document.getElementById('sandbox-scratch-text');
      const barEl = document.getElementById('sandbox-usage-bar');
      const pctEl = document.getElementById('sandbox-usage-percent');

      modal.classList.remove('hidden');

      try {
        const res = await fetch(`/api/war-room/sandbox/stats?room_id=${encodeURIComponent(targetRoom)}`);
        if (res.ok) {
          const data = await res.json();
          if (pathEl) pathEl.innerText = data.sandbox_path;
          if (totalEl) totalEl.innerText = `${data.total_mb} MB / ${data.quota_mb} MB`;
          if (delivEl) delivEl.innerText = `${data.deliverables_mb} MB (${data.deliverables_count} files)`;
          if (scratchEl) scratchEl.innerText = `${data.scratch_mb} MB (${data.scratch_count} files)`;
          if (barEl) barEl.style.width = `${Math.min(100, Math.max(2, data.usage_percent))}%`;
          if (pctEl) pctEl.innerText = `${data.usage_percent}% used`;
        }
      } catch (e) {
        console.error('Failed to load modal sandbox stats:', e);
      }
    }

    function closeWarRoomSandboxModal() {
      const modal = document.getElementById('modal-warroom-sandbox');
      if (modal) modal.classList.add('hidden');
    }

    async function archiveActiveWarRoomSandbox() {
      const targetRoom = activeWarRoomId || 'general';
      if (!confirm(`Archive and compress deliverables for ${targetRoom}? Scratch files will be auto-pruned.`)) return;
      try {
        const res = await fetch('/api/war-room/sandbox/archive', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ room_id: targetRoom })
        });
        const data = await res.json();
        if (res.ok) {
          alert(`✅ Room archive created: ${data.archive_file} (${data.size_mb} MB)`);
          loadWarRoomSandboxStats(targetRoom);
          closeWarRoomSandboxModal();
        } else {
          alert(`⚠️ Failed to archive: ${data.detail || 'Unknown error'}`);
        }
      } catch (e) {
        alert('Error archiving sandbox: ' + e);
      }
    }

    async function pruneWarRoomScratchFiles() {
      const targetRoom = activeWarRoomId || 'general';
      if (!confirm(`🧹 Prune Scratch Files for room '${targetRoom}'?\n\nThis will purge all temporary execution logs, scratch caches, and scrape dumps.\nAll deliverables (.pdf, .html, .csv) will remain safe.`)) return;
      try {
        const res = await fetch('/api/war-room/sandbox/prune-scratch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ room_id: targetRoom })
        });
        const data = await res.json();
        if (res.ok) {
          alert(`✅ Scratch pruned! Deleted ${data.deleted_files} temporary files (${data.freed_mb} MB freed).`);
          loadWarRoomSandboxStats(targetRoom);
          loadWarRoomSandboxFiles(targetRoom);
          if (typeof openWarRoomSandboxModal === 'function') {
            const modal = document.getElementById('modal-warroom-sandbox');
            if (modal && !modal.classList.contains('hidden')) {
              openWarRoomSandboxModal();
            }
          }
        } else {
          alert(`⚠️ Failed to prune scratch files: ${data.detail || 'Unknown error'}`);
        }
      } catch (e) {
        alert('Error pruning scratch files: ' + e);
      }
    }

    // ==============================================================
    // --- BL-UI-50 & BL-EVO-20: IN-ROOM LIVE DELIVERABLES & SANDBOX FILE EXPLORER ---
    // ==============================================================
    let warRoomFilesSidecarOpen = false;
    let warRoomFilesCategory = 'all'; // 'all' | 'deliverables' | 'scratch'
    let warRoomFilesSearchQuery = '';
    let warRoomCachedFiles = [];
    let warRoomTotalDiskFiles = 0;
    let warRoomTotalStorageMb = 0;

    function fmtFileSize(bytes) {
      if (!bytes || bytes <= 0) return '0 B';
      const k = 1024;
      const sizes = ['B', 'KB', 'MB', 'GB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return (bytes / Math.pow(k, i)).toFixed(i === 0 ? 0 : 1) + ' ' + sizes[i];
    }

    function fmtFileTime(mtimeSec) {
      if (!mtimeSec) return '';
      if (typeof window.formatNexusDateTime === 'function') {
        return window.formatNexusDateTime(mtimeSec, false);
      }
      const d = new Date(mtimeSec * 1000);
      const pad = (n) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }

    function getFileIcon(ext) {
      const e = (ext || '').toLowerCase();
      if (['.pdf'].includes(e)) return '📕';
      if (['.pptx', '.ppt', '.key'].includes(e)) return '📊';
      if (['.docx', '.doc', '.odt'].includes(e)) return '📘';
      if (['.xlsx', '.xls', '.csv', '.tsv'].includes(e)) return '📈';
      if (['.py', '.sh', '.js', '.ts', '.html', '.css', '.json', '.sql'].includes(e)) return '💻';
      if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'].includes(e)) return '🖼️';
      if (['.zip', '.tar', '.gz', '.7z'].includes(e)) return '🗜️';
      if (['.md', '.txt', '.log'].includes(e)) return '📝';
      return '📄';
    }

    function toggleWarRoomFilesSidecar() {
      const sidecar = document.getElementById('warroom-files-sidecar');
      if (!sidecar) return;
      warRoomFilesSidecarOpen = !warRoomFilesSidecarOpen;
      if (warRoomFilesSidecarOpen) {
        sidecar.classList.remove('hidden');
        loadWarRoomSandboxFiles(activeWarRoomId || 'general');
      } else {
        sidecar.classList.add('hidden');
      }
    }

    function refreshWarRoomFilesSidecar() {
      loadWarRoomSandboxFiles(activeWarRoomId || 'general');
    }

    function setWarRoomFilesCategory(cat) {
      warRoomFilesCategory = cat;
      ['all', 'deliv', 'scratch'].forEach(c => {
        const btn = document.getElementById(`btn-sidecar-cat-${c}`);
        if (!btn) return;
        const active = (c === 'all' && cat === 'all') || (c === 'deliv' && cat === 'deliverables') || (c === 'scratch' && cat === 'scratch');
        if (active) {
          btn.className = 'flex-1 py-1 px-1.5 rounded bg-sky-950 text-sky-300 border border-sky-700 font-bold text-center cursor-pointer';
        } else {
          btn.className = 'flex-1 py-1 px-1.5 rounded bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800 text-center cursor-pointer';
        }
      });
      renderWarRoomFilesList();
    }

    function handleWarRoomFilesSearch(val) {
      warRoomFilesSearchQuery = (val || '').trim().toLowerCase();
      renderWarRoomFilesList();
    }

    async function loadWarRoomSandboxFiles(roomId = activeWarRoomId) {
      const targetRoom = roomId || activeWarRoomId || 'general';
      const countBadge = document.getElementById('warroom-files-count-badge');
      const sidecarBtn = document.getElementById('btn-warroom-files-sidecar');
      try {
        const [filesRes, statsRes] = await Promise.all([
          fetch(`/api/war-room/sandbox/files?room_id=${encodeURIComponent(targetRoom)}`),
          fetch(`/api/war-room/sandbox/stats?room_id=${encodeURIComponent(targetRoom)}`).catch(() => null)
        ]);

        if (filesRes.ok) {
          const data = await filesRes.json();
          warRoomCachedFiles = data.files || [];
          warRoomTotalDiskFiles = (typeof data.total_files === 'number') ? data.total_files : warRoomCachedFiles.length;

          if (statsRes && statsRes.ok) {
            const statsData = await statsRes.json();
            warRoomTotalStorageMb = statsData.total_mb || 0;
            // BL-EVO-22: Keep header storage pill in sync with live disk stats
            const storagePill = document.getElementById('warroom-storage-pill');
            if (storagePill) {
              const quotaLabel = (statsData.quota_mb >= 1024) ? `${Math.round(statsData.quota_mb / 1024)} GB` : `${statsData.quota_mb} MB`;
              storagePill.innerText = `${statsData.total_mb} MB / ${quotaLabel}`;
              storagePill.title = `Shared Sandbox: ${statsData.sandbox_path}\n• Deliverables: ${statsData.deliverables_mb} MB (${statsData.deliverables_count} files)\n• Scratch: ${statsData.scratch_mb} MB (${statsData.scratch_count} files)\nClick to inspect or archive room.`;
            }
            if (sidecarBtn) {
              if (statsData.approaching_quota || statsData.quota_exceeded) {
                sidecarBtn.classList.add('border-amber-600', 'text-amber-200');
                sidecarBtn.classList.remove('border-sky-700/80', 'text-sky-300');
              } else {
                sidecarBtn.classList.remove('border-amber-600', 'text-amber-200');
                sidecarBtn.classList.add('border-sky-700/80', 'text-sky-300');
              }
            }
          }

          if (countBadge) {
            // BL-EVO-20: Format large counts compactly (e.g. 397.2k) so mobile header never overflows
            const n = Number(warRoomTotalDiskFiles || 0);
            countBadge.innerText = n >= 100000 ? `${(n / 1000).toFixed(0)}k` : (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
          }

          if (sidecarBtn) {
            const sizeStr = warRoomTotalStorageMb > 0 ? ` (${warRoomTotalStorageMb.toFixed(1)} MB)` : '';
            sidecarBtn.title = `Toggle Live Deliverables & Sandbox File Explorer — ${warRoomTotalDiskFiles} total files on disk${sizeStr}`;
          }

          if (warRoomFilesSidecarOpen) {
            renderWarRoomFilesList();
          }
        }
      } catch (e) {
        console.error('Failed to load war room sandbox files:', e);
      }
    }

    function renderWarRoomFilesList() {
      const listEl = document.getElementById('warroom-files-list');
      const summaryEl = document.getElementById('sidecar-footer-summary');
      if (!listEl) return;

      let filtered = warRoomCachedFiles;
      if (warRoomFilesCategory !== 'all') {
        filtered = filtered.filter(f => f.category === warRoomFilesCategory);
      }
      if (warRoomFilesSearchQuery) {
        filtered = filtered.filter(f => f.name.toLowerCase().includes(warRoomFilesSearchQuery) || f.rel_path.toLowerCase().includes(warRoomFilesSearchQuery));
      }

      if (summaryEl) {
        // BL-EVO-20: Sidecar Pagination Summary: "Showing X of Y total files" with search/category breakdown
        const totalDisk = Math.max(warRoomTotalDiskFiles || 0, warRoomCachedFiles.length);
        if (warRoomFilesCategory !== 'all' || warRoomFilesSearchQuery) {
          summaryEl.innerText = `Showing ${filtered.length} matching (${totalDisk} total on disk)`;
        } else if (warRoomCachedFiles.length < totalDisk) {
          summaryEl.innerText = `Showing ${filtered.length} of ${totalDisk} total files (most recent)`;
        } else {
          summaryEl.innerText = `Showing ${filtered.length} of ${totalDisk} total files`;
        }
      }

      if (filtered.length === 0) {
        listEl.innerHTML = `
          <div class="flex flex-col items-center justify-center p-6 text-center text-slate-500 font-mono space-y-2">
            <span class="text-2xl">📭</span>
            <span class="text-[11px]">No files matching filter</span>
            <span class="text-[9.5px] text-slate-600">Agents generate deliverables here during research & code runs.</span>
          </div>`;
        return;
      }

      const rows = filtered.map(f => {
        const icon = getFileIcon(f.ext);
        const safePath = (f.abs_path || '').replace(/'/g, "\\'");
        const isDeliverable = f.category === 'deliverables';
        const badgeClass = isDeliverable
          ? 'bg-emerald-950 text-emerald-400 border-emerald-800'
          : 'bg-amber-950 text-amber-400 border-amber-800';

        return `
          <div class="p-2.5 rounded-lg bg-slate-900/80 hover:bg-slate-900 border border-slate-800 hover:border-sky-700/80 transition flex flex-col gap-1.5 group">
            <div class="flex items-start gap-2 min-w-0">
              <span class="text-sm shrink-0 mt-0.5">${icon}</span>
              <span class="font-bold text-slate-200 hover:text-sky-300 break-all leading-snug text-[11px] cursor-pointer flex-1" onclick="openFsQuickViewModal('${safePath}')" title="${f.rel_path}">
                ${f.name}
              </span>
            </div>
            <div class="flex items-center justify-between gap-2 text-[10px] text-slate-400 font-mono pl-6 flex-wrap">
              <div class="flex items-center gap-1.5 flex-wrap">
                <span class="text-[8.5px] uppercase font-bold px-1 rounded border shrink-0 ${badgeClass}">${f.category}</span>
                <span>${fmtFileSize(f.size)} • ${fmtFileTime(f.mtime)}</span>
              </div>
              <div class="flex items-center gap-1 opacity-85 group-hover:opacity-100 transition shrink-0">
                <button type="button" onclick="openFsQuickViewModal('${safePath}')" class="px-1.5 py-0.5 rounded bg-sky-950/80 hover:bg-sky-900 border border-sky-700 text-sky-300 text-[9.5px] font-bold cursor-pointer" title="Preview File">
                  👁️ View
                </button>
                <a href="/api/fs/download?path=${encodeURIComponent(f.abs_path)}" download="${f.name}" class="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-[9.5px] font-bold cursor-pointer inline-flex items-center" title="Download to PC">
                  ⬇️
                </a>
              </div>
            </div>
          </div>
        `;
      }).join('');

      listEl.innerHTML = rows;
    }

    window.toggleWarRoomFilesSidecar = toggleWarRoomFilesSidecar;
    window.refreshWarRoomFilesSidecar = refreshWarRoomFilesSidecar;
    window.setWarRoomFilesCategory = setWarRoomFilesCategory;
    window.handleWarRoomFilesSearch = handleWarRoomFilesSearch;
    window.loadWarRoomSandboxFiles = loadWarRoomSandboxFiles;
    window.pruneWarRoomScratchFiles = pruneWarRoomScratchFiles;

    async function loadWarRoomMessages(roomId = activeWarRoomId) {
      const targetRoom = roomId || activeWarRoomId || 'general';
      const container = document.getElementById('warroom-conversation');
      if (!container) return;
      currentWarRoomHistory = [];
      try {
        const res = await fetch(`/api/war-room/messages?room_id=${encodeURIComponent(targetRoom)}&limit=100`);
        const data = await res.json();
        container.innerHTML = '';
        if (data.messages && data.messages.length > 0) {
          currentWarRoomHistory = data.messages;
          data.messages.forEach(m => appendWarRoomMessage(m));
        } else {
          container.innerHTML = `
            <div class="p-5 rounded-2xl bg-slate-950/70 border border-slate-800/80 text-center max-w-lg mx-auto my-auto space-y-3">
              <div class="w-10 h-10 rounded-xl bg-cyan-500/20 border border-cyan-500 flex items-center justify-center text-xl mx-auto">👥</div>
              <h3 class="text-white font-bold text-xs sm:text-sm font-pixel">ROOM 2: CONFERENCE WAR ROOM CONVENED</h3>
              <p class="text-xs text-slate-400 leading-relaxed font-mono">
                Multi-agent shared conversation bus is active across all fleets.
                Use <span class="text-indigo-400 font-bold">@everyone</span> / <span class="text-purple-400 font-bold">@everyagents</span> to broadcast to all panelists,
                direct specific agents with <span class="text-cyan-400 font-bold">@Agent</span>, or let agents tag <span class="text-emerald-400 font-bold">@user</span>!
              </p>
              <div class="flex flex-wrap justify-center gap-2 pt-1.5">
                <button onclick="insertWarRoomMention('everyone')" class="px-3 py-1.5 rounded-lg bg-indigo-950/90 hover:bg-indigo-900 border border-indigo-700 text-indigo-300 text-[11px] font-mono font-bold transition cursor-pointer">
                  👥 Mention @everyone
                </button>
                <button onclick="insertWarRoomMention('Solaris'); insertWarRoomMention('Claude');" class="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-cyan-300 text-[11px] font-mono transition cursor-pointer">
                  ➕ Mention @Solaris & @Claude
                </button>
              </div>
            </div>
          `;
        }
        // Fetch active inquiries for this room
        fetchRoomInquiries(targetRoom);
        // BL-WAR-13: Fetch shared sandbox storage stats
        loadWarRoomSandboxStats(targetRoom);
        // BL-UI-50: Sync In-Room Deliverables & Files Sidecar if open or active
        loadWarRoomSandboxFiles(targetRoom);
        // BL-WAR-19 & BL-WAR-18: Fetch scheduled reminders, room schedules & async jobs
        fetchRoomReminders(targetRoom);
        if (typeof fetchRoomSchedules === 'function') fetchRoomSchedules(targetRoom);
        fetchRoomBgTasks(targetRoom);
      } catch (e) {
        console.error('Failed to load war room messages:', e);
      }
    }

