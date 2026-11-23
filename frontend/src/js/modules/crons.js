    // --- TAB 5: Workflows & Crons (USER LOCAL TIMEZONE & HUMAN BUILDER) ---

    // 1. Timezone & Live Clocks
    function getUserTzOffset() {
      const stored = localStorage.getItem('nexusdesk_user_tz_offset');
      return (stored !== null && !isNaN(parseFloat(stored))) ? parseFloat(stored) : 7.0; // Default GMT+7
    }

    function getUserTzBadge() {
      return localStorage.getItem('nexusdesk_user_tz_name') || 'GMT+7';
    }

    function openTimezoneModal() {
      const currentOffset = getUserTzOffset();
      const select = document.getElementById('select-user-timezone');
      if (select) {
        for (let i = 0; i < select.options.length; i++) {
          const [val] = select.options[i].value.split('|');
          if (parseFloat(val) === currentOffset) {
            select.selectedIndex = i;
            break;
          }
        }
      }
      document.getElementById('timezone-modal').classList.remove('hidden');
    }

    function closeTimezoneModal() {
      document.getElementById('timezone-modal').classList.add('hidden');
    }

    function setQuickTz(offset, name) {
      window.nexusUserTzOffset = parseFloat(offset);
      window.nexusUserTzLabel = name;
      localStorage.setItem('nexusdesk_user_tz_offset', offset);
      localStorage.setItem('nexusdesk_user_tz_name', name);
      fetch('/api/system/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tz_offset: parseFloat(offset), tz_label: name })
      }).catch(() => {});
      closeTimezoneModal();
      updateLiveClocks();
      loadCronsTable();
    }

    function saveSelectedTimezone() {
      const select = document.getElementById('select-user-timezone');
      if (!select) return;
      const [offsetStr, nameStr] = select.value.split('|');
      const offset = parseFloat(offsetStr);
      const tzLabel = nameStr || `GMT${offset >= 0 ? '+' : ''}${offset}`;
      window.nexusUserTzOffset = offset;
      window.nexusUserTzLabel = tzLabel;
      localStorage.setItem('nexusdesk_user_tz_offset', offset);
      localStorage.setItem('nexusdesk_user_tz_name', tzLabel);
      fetch('/api/system/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tz_offset: offset, tz_label: tzLabel })
      }).catch(() => {});
      closeTimezoneModal();
      updateLiveClocks();
      loadCronsTable();
    }

    function formatTimeFromDate(d) {
      const hh = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      const ss = String(d.getSeconds()).padStart(2, '0');
      return `${hh}:${mm}:${ss}`;
    }

    function updateLiveClocks() {
      const now = new Date();
      // Server Hardware Time (Europe/Berlin CEST)
      let srvStr = '--:--:-- CEST';
      try {
        srvStr = now.toLocaleTimeString('en-US', { timeZone: 'Europe/Berlin', hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' CEST';
      } catch (e) {
        srvStr = formatTimeFromDate(now) + ' CEST';
      }
      const srvEl = document.getElementById('header-server-time');
      if (srvEl) srvEl.innerText = srvStr;

      // User Local Time (Based on chosen offset, default GMT+7)
      const userOffset = getUserTzOffset();
      const tzBadge = getUserTzBadge();
      const utcMs = now.getTime() + (now.getTimezoneOffset() * 60000);
      const userDate = new Date(utcMs + (userOffset * 3600000));
      const userTimeStr = formatTimeFromDate(userDate);
      const userShortTimeStr = `${String(userDate.getHours()).padStart(2, '0')}:${String(userDate.getMinutes()).padStart(2, '0')}`;

      const localEl = document.getElementById('header-local-time');
      if (localEl) localEl.innerText = userTimeStr;
      const badgeEl = document.getElementById('header-tz-badge');
      if (badgeEl) badgeEl.innerText = tzBadge;

      const localMobEl = document.getElementById('header-local-time-mob');
      if (localMobEl) localMobEl.innerText = userShortTimeStr;
      const badgeMobEl = document.getElementById('header-tz-badge-mob');
      if (badgeMobEl) badgeMobEl.innerText = tzBadge.split(' ')[0];

      const dailyBadge = document.getElementById('cron-daily-tz-badge');
      if (dailyBadge) dailyBadge.innerText = `${tzBadge.split(' ')[0]} (Local)`;
    }

    function formatDateTimeInUserTz(isoString) {
      if (!isoString) return 'Scheduled';
      try {
        const d = new Date(isoString);
        if (isNaN(d.getTime())) return isoString;
        const userOffset = getUserTzOffset();
        const utcMs = d.getTime() + (d.getTimezoneOffset() * 60000);
        const userDate = new Date(utcMs + (userOffset * 3600000));
        
        const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const dayName = days[userDate.getDay()];
        const hh = userDate.getHours();
        const mm = String(userDate.getMinutes()).padStart(2, '0');
        const ampm = hh >= 12 ? 'PM' : 'AM';
        const displayHh = String(hh % 12 || 12).padStart(2, '0');
        return `${dayName}, ${displayHh}:${mm} ${ampm}`;
      } catch (e) {
        return isoString;
      }
    }

    function formatDateTimeInServerTz(isoString) {
      if (!isoString) return '';
      try {
        const d = new Date(isoString);
        if (isNaN(d.getTime())) return '';
        return d.toLocaleTimeString('en-US', { timeZone: 'Europe/Berlin', hour12: false, hour: '2-digit', minute: '2-digit' });
      } catch (e) {
        return '';
      }
    }

    function formatScheduleHumanInUserTz(job) {
      const expr = (job.schedule?.expr || job.schedule_display || '').trim();
      const userOffset = getUserTzOffset();
      const tzBadge = getUserTzBadge();
      const tzShort = tzBadge.split(' ')[0] || 'Local';

      // 1. Daily expression e.g. "0 2 * * *"
      const dailyMatch = expr.match(/^(\d+)\s+(\d+)\s+\*\s+\*\s+\*$/);
      if (dailyMatch) {
        const srvMin = parseInt(dailyMatch[1]);
        const srvHour = parseInt(dailyMatch[2]);
        // Server is CEST (UTC+2) -> User is UTC + userOffset
        const userHour = (srvHour + Math.round(userOffset - 2) + 24) % 24;
        const ampm = userHour >= 12 ? 'PM' : 'AM';
        const displayH = String(userHour % 12 || 12).padStart(2, '0');
        const displayM = String(srvMin).padStart(2, '0');
        return `Every day at ${displayH}:${displayM} ${ampm} (${tzShort})`;
      }

      // 2. Weekly expression e.g. "0 9 * * 1" (0=Sun, 1=Mon, ..., 6=Sat, 7=Sun)
      const weeklyMatch = expr.match(/^(\d+)\s+(\d+)\s+\*\s+\*\s+([0-7])$/);
      if (weeklyMatch) {
        const srvMin = parseInt(weeklyMatch[1]);
        const srvHour = parseInt(weeklyMatch[2]);
        let dayNum = parseInt(weeklyMatch[3]);
        if (dayNum === 7) dayNum = 0;
        const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const dayName = dayNames[dayNum] || `Day ${dayNum}`;
        const userHour = (srvHour + Math.round(userOffset - 2) + 24) % 24;
        const ampm = userHour >= 12 ? 'PM' : 'AM';
        const displayH = String(userHour % 12 || 12).padStart(2, '0');
        const displayM = String(srvMin).padStart(2, '0');
        return `Every ${dayName} at ${displayH}:${displayM} ${ampm} (${tzShort})`;
      }

      // 3. Hourly / Interval patterns
      const intervalMatch = expr.match(/^\d+\s+\*\/(\d+)\s+\*\s+\*\s+\*$/);
      if (intervalMatch) {
        const hours = intervalMatch[1];
        return `Every ${hours} hour${hours === '1' ? '' : 's'}`;
      }
      if (expr.includes('*/2')) return 'Every 2 hours';
      if (expr.includes('*/3')) return 'Every 3 hours';
      if (expr.includes('*/4')) return 'Every 4 hours';
      if (expr.includes('*/6')) return 'Every 6 hours';
      if (expr.includes('*/12')) return 'Every 12 hours';

      return job.schedule_human || job.schedule?.display || expr || 'Custom schedule';
    }

    // 2. Intuitive Human Cron Builder
    let currentCronMode = 'daily';
    let currentCronTargetType = 'prompt';
    let cachedWorkflowsList = [];
    let currentViewingSkillPath = '';
    let currentViewingSkillAgent = 'solaris';

    function setCronTargetType(type) {
      currentCronTargetType = type;
      const btnPrompt = document.getElementById('cron-target-btn-prompt');
      const btnWorkflow = document.getElementById('cron-target-btn-workflow');
      const secPrompt = document.getElementById('cron-target-sec-prompt');
      const secWorkflow = document.getElementById('cron-target-sec-workflow');

      if (type === 'workflow') {
        if (btnWorkflow) {
          btnWorkflow.className = 'p-2 rounded-lg border border-cyan-500 bg-cyan-950/70 text-cyan-300 font-mono text-xs font-bold flex items-center justify-center gap-1.5 transition cursor-pointer';
        }
        if (btnPrompt) {
          btnPrompt.className = 'p-2 rounded-lg border border-slate-800 bg-slate-900/60 text-slate-400 font-mono text-xs font-bold flex items-center justify-center gap-1.5 hover:border-slate-700 transition cursor-pointer';
        }
        if (secWorkflow) secWorkflow.classList.remove('hidden');
        if (secPrompt) secPrompt.classList.add('hidden');
        populateCronWorkflowDropdown();
      } else {
        if (btnPrompt) {
          btnPrompt.className = 'p-2 rounded-lg border border-cyan-500 bg-cyan-950/70 text-cyan-300 font-mono text-xs font-bold flex items-center justify-center gap-1.5 transition cursor-pointer';
        }
        if (btnWorkflow) {
          btnWorkflow.className = 'p-2 rounded-lg border border-slate-800 bg-slate-900/60 text-slate-400 font-mono text-xs font-bold flex items-center justify-center gap-1.5 hover:border-slate-700 transition cursor-pointer';
        }
        if (secPrompt) secPrompt.classList.remove('hidden');
        if (secWorkflow) secWorkflow.classList.add('hidden');
      }
    }

    async function populateCronWorkflowDropdown(selectedId) {
      const select = document.getElementById('modal-cron-workflow-id');
      if (!select) return;
      if (cachedWorkflowsList.length === 0) {
        try {
          const res = await fetch('/api/workflows');
          const data = await res.json();
          cachedWorkflowsList = data.workflows || [];
        } catch (_) {}
      }

      select.innerHTML = cachedWorkflowsList.map(w => `
        <option value="${w.id}" ${(selectedId && w.id === selectedId) ? 'selected' : ''}>
          ${w.name} (${w.steps?.length || 0} steps)
        </option>
      `).join('');

      onCronWorkflowSelected();
    }

    function onCronWorkflowSelected() {
      const select = document.getElementById('modal-cron-workflow-id');
      const previewBox = document.getElementById('cron-workflow-preview-box');
      if (!select || !previewBox) return;
      const wfId = select.value;
      const wf = cachedWorkflowsList.find(w => w.id === wfId);
      if (!wf) {
        previewBox.innerHTML = '<span class="text-slate-500">No workflow selected.</span>';
        return;
      }
      previewBox.innerHTML = `
        <div class="text-cyan-300 font-semibold mb-1 flex items-center gap-1">
          <span>🔀</span> <span>${wf.name}</span>
        </div>
        <p class="text-[10px] text-slate-400 mb-2">${wf.description || ''}</p>
        <div class="flex items-center gap-1 text-[10px] text-slate-400 flex-wrap">
          ${(wf.steps || []).map((s, idx) => `
            <span class="px-1.5 py-0.5 rounded bg-slate-950 border border-slate-800 text-slate-200">
              ${idx + 1}. <strong class="text-emerald-400">${s.agent}</strong>
            </span>
            ${idx < wf.steps.length - 1 ? '<span class="text-slate-600">→</span>' : ''}
          `).join('')}
        </div>
      `;
    }

    function setCronBuilderMode(mode) {
      currentCronMode = mode;
      ['daily', 'interval', 'weekly', 'custom'].forEach(m => {
        const tab = document.getElementById(`cron-tab-${m}`);
        const sec = document.getElementById(`cron-builder-${m}`);
        if (m === mode) {
          if (tab) tab.className = 'p-2 rounded border border-emerald-600 bg-emerald-950/70 text-emerald-300 font-semibold text-center transition';
          if (sec) sec.classList.remove('hidden');
        } else {
          if (tab) tab.className = 'p-2 rounded border border-slate-800 bg-slate-900/60 text-slate-400 font-semibold text-center hover:border-slate-700 transition';
          if (sec) sec.classList.add('hidden');
        }
      });
      syncCronFromHumanBuilder();
    }

    function syncCronFromHumanBuilder() {
      const userOffset = getUserTzOffset();
      const tzBadge = getUserTzBadge();
      let expr = '0 2 * * *';
      let humanDesc = '';
      let serverDesc = '';

      if (currentCronMode === 'daily') {
        const timeVal = document.getElementById('cron-daily-time')?.value || '07:00';
        const [uHStr, uMStr] = timeVal.split(':');
        const uH = parseInt(uHStr);
        const uM = parseInt(uMStr);
        // User time to Server CEST (UTC+2): diff is -(userOffset - 2)
        const srvH = (uH - Math.round(userOffset - 2) + 24) % 24;
        expr = `${uM} ${srvH} * * *`;
        const ampm = uH >= 12 ? 'PM' : 'AM';
        const dispH = String(uH % 12 || 12).padStart(2, '0');
        const dispM = String(uM).padStart(2, '0');
        humanDesc = `Runs daily at ${dispH}:${dispM} ${ampm} (${tzBadge.split(' ')[0]})`;
        serverDesc = `Server: ${String(srvH).padStart(2, '0')}:${dispM} CEST • Expr: ${expr}`;
      } else if (currentCronMode === 'interval') {
        const hours = document.getElementById('cron-interval-hours')?.value || '2';
        expr = `0 */${hours} * * *`;
        humanDesc = `Repeats every ${hours} hour(s) around the clock`;
        serverDesc = `Server interval trigger • Expr: ${expr}`;
      } else if (currentCronMode === 'weekly') {
        const day = document.getElementById('cron-weekly-day')?.value || '1';
        const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const timeVal = document.getElementById('cron-weekly-time')?.value || '09:00';
        const [uHStr, uMStr] = timeVal.split(':');
        const uH = parseInt(uHStr);
        const uM = parseInt(uMStr);
        const srvH = (uH - Math.round(userOffset - 2) + 24) % 24;
        expr = `${uM} ${srvH} * * ${day}`;
        humanDesc = `Every ${dayNames[day]} at ${timeVal} (${tzBadge.split(' ')[0]})`;
        serverDesc = `Server: ${String(srvH).padStart(2, '0')}:${uMStr} CEST • Expr: ${expr}`;
      } else {
        expr = document.getElementById('modal-cron-expr')?.value.trim() || '0 2 * * *';
        humanDesc = 'Custom cron schedule';
        serverDesc = `Expr: ${expr}`;
      }

      const exprInput = document.getElementById('modal-cron-expr');
      if (exprInput) exprInput.value = expr;
      const prevHuman = document.getElementById('cron-preview-human');
      if (prevHuman) prevHuman.innerText = humanDesc;
      const prevSrv = document.getElementById('cron-preview-server');
      if (prevSrv) prevSrv.innerText = serverDesc;
    }

    function onCustomCronExprInput() {
      const expr = document.getElementById('modal-cron-expr')?.value.trim();
      const prevHuman = document.getElementById('cron-preview-human');
      if (prevHuman) prevHuman.innerText = 'Custom expression';
      const prevSrv = document.getElementById('cron-preview-server');
      if (prevSrv) prevSrv.innerText = `Expression: ${expr}`;
    }

    function setRawCron(expr) {
      const exprInput = document.getElementById('modal-cron-expr');
      if (exprInput) exprInput.value = expr;
      onCustomCronExprInput();
    }

    // Update automation badges in sidebar and overview strips
    function updateAutomationCounts(cronTotal, cronActive, cronDisabled, wfTotal) {
      // Sidebar Sub-menu badge counters
      const subCronEl = document.getElementById('sub-count-crons');
      if (subCronEl) {
        subCronEl.innerHTML = `<span class="px-1.5 py-0.2 rounded bg-slate-900 text-slate-300 border border-slate-800 font-mono font-bold">${cronTotal}</span>` +
          (cronActive > 0 ? `<span class="px-1 py-0.2 rounded bg-emerald-950/90 text-emerald-400 font-mono text-[8px] font-semibold">${cronActive} act</span>` : '') +
          (cronDisabled > 0 ? `<span class="px-1 py-0.2 rounded bg-amber-950/90 text-amber-400 font-mono text-[8px]">${cronDisabled} off</span>` : '');
      }

      const subWfEl = document.getElementById('sub-count-workflows');
      if (subWfEl) {
        subWfEl.innerHTML = `<span class="px-1.5 py-0.2 rounded bg-slate-900 text-slate-300 border border-slate-800 font-mono font-bold">${wfTotal}</span>` +
          (wfTotal > 0 ? `<span class="px-1 py-0.2 rounded bg-cyan-950/90 text-cyan-400 font-mono text-[8px] font-semibold">${wfTotal} act</span>` : '');
      }

      const badgeAutoEl = document.getElementById('badge-count-automation');
      if (badgeAutoEl) {
        badgeAutoEl.innerText = `${cronTotal + wfTotal}`;
      }

      // Summary Strip stats inside Tab Crons
      const statCronTotal = document.getElementById('stat-cron-total');
      if (statCronTotal) statCronTotal.innerText = cronTotal;
      const statCronActive = document.getElementById('stat-cron-active');
      if (statCronActive) statCronActive.innerText = cronActive;
      const statCronDisabled = document.getElementById('stat-cron-disabled');
      if (statCronDisabled) statCronDisabled.innerText = cronDisabled;
      const cronPill = document.getElementById('cron-stats-pill');
      if (cronPill) cronPill.innerText = `${cronTotal} Total · ${cronActive} Active · ${cronDisabled} Disabled`;

      // Summary Strip stats inside Tab Workflows
      const statWfTotal = document.getElementById('stat-workflow-total');
      if (statWfTotal) statWfTotal.innerText = wfTotal;
      const statWfActive = document.getElementById('stat-workflow-active');
      if (statWfActive) statWfActive.innerText = wfTotal;
      const wfPill = document.getElementById('workflow-stats-pill');
      if (wfPill) wfPill.innerText = `${wfTotal} Total · ${wfTotal} Active`;
    }

    // 3. Crons Table Display & Actions
    let cronFilterEngine = 'all';
    let cronSearchQuery = '';

    function filterCronsByEngine(engine) {
      cronFilterEngine = engine;
      ['all', 'dag', 'hermes', 'warroom', 'sys'].forEach(k => {
        const btn = document.getElementById(`btn-cron-filter-${k}`);
        if (!btn) return;
        const isActive = (k === 'all' && engine === 'all') ||
                         (k === 'dag' && engine === 'nexusdesk_dag') ||
                         (k === 'hermes' && engine === 'hermes_native') ||
                         (k === 'warroom' && engine === 'war_room_schedule') ||
                         (k === 'sys' && engine === 'system_crontab');
        if (isActive) {
          btn.className = 'px-2.5 py-1 rounded text-[11px] font-semibold transition bg-cyan-950 text-cyan-300 border border-cyan-800 shadow-sm cursor-pointer';
        } else {
          btn.className = 'px-2.5 py-1 rounded text-[11px] font-semibold transition text-slate-400 hover:text-slate-200 border border-transparent hover:border-slate-800 cursor-pointer';
        }
      });
      renderCronsRows();
    }

    function handleCronSearch(val) {
      cronSearchQuery = (val || '').toLowerCase().trim();
      const clearBtn = document.getElementById('cron-search-clear');
      if (clearBtn) {
        if (cronSearchQuery) clearBtn.classList.remove('hidden');
        else clearBtn.classList.add('hidden');
      }
      renderCronsRows();
    }

    function clearCronSearch() {
      const input = document.getElementById('cron-search-input');
      if (input) input.value = '';
      handleCronSearch('');
    }

    function navigateToWorkflowDAG(wfId) {
      if (typeof switchMainTab === 'function') {
        switchMainTab('workflows');
        setTimeout(() => {
          if (typeof selectWorkflowDetail === 'function') {
            selectWorkflowDetail(wfId);
          }
        }, 150);
      }
    }

    function openWarRoomSchedulerFromCrons(roomId) {
      if (typeof switchMainTab === 'function') switchMainTab('console');
      setTimeout(() => {
        if (typeof consoleTabs !== 'undefined' && Array.isArray(consoleTabs)) {
          const wrTab = consoleTabs.find(t => t.type === 'warroom' && t.roomId === roomId);
          if (wrTab && typeof activateConsoleTab === 'function') {
            activateConsoleTab(wrTab.id);
          } else {
            activeWarRoomId = roomId || 'general';
          }
        }
        if (typeof openWarRoomRemindersModal === 'function') {
          openWarRoomRemindersModal('schedules');
        }
      }, 150);
    }

    async function toggleWarRoomCronRow(schedId, roomId) {
      try {
        await fetch(`/api/war-room/schedules/${encodeURIComponent(schedId)}/toggle?room_id=${encodeURIComponent(roomId || 'general')}`, { method: 'PATCH' });
        loadCronsTable();
      } catch (e) {
        alert('Failed to toggle War Room schedule: ' + e);
      }
    }

    async function triggerWarRoomCronRow(schedId, roomId) {
      try {
        const res = await fetch(`/api/war-room/schedules/${encodeURIComponent(schedId)}/run?room_id=${encodeURIComponent(roomId || 'general')}`, { method: 'POST' });
        if (res.ok) {
          alert(`Dispatched War Room schedule inside #${roomId}.`);
          loadCronsTable();
        }
      } catch (e) {
        alert('Failed to trigger War Room schedule: ' + e);
      }
    }

    async function deleteWarRoomCronRow(schedId, roomId) {
      if (!confirm('Delete this War Room schedule?')) return;
      try {
        await fetch(`/api/war-room/schedules/${encodeURIComponent(schedId)}?room_id=${encodeURIComponent(roomId || 'general')}`, { method: 'DELETE' });
        loadCronsTable();
      } catch (e) {
        alert('Failed to delete War Room schedule: ' + e);
      }
    }

    function renderCronsRows() {
      const tbody = document.getElementById('cron-table-body');
      if (!tbody) return;

      const totalCount = cronJobsData.length;
      const dagCount = cronJobsData.filter(j => j.engine_type === 'nexusdesk_dag' || j.target_type === 'workflow' || !!j.workflow_id).length;
      const warRoomCount = cronJobsData.filter(j => j.engine_type === 'war_room_schedule').length;
      const sysCount = cronJobsData.filter(j => j.engine_type === 'system_crontab').length;
      const hermesCount = totalCount - dagCount - warRoomCount - sysCount;

      const cntAll = document.getElementById('count-cron-all');
      if (cntAll) cntAll.innerText = totalCount;
      const cntDag = document.getElementById('count-cron-dag');
      if (cntDag) cntDag.innerText = dagCount;
      const cntHermes = document.getElementById('count-cron-hermes');
      if (cntHermes) cntHermes.innerText = hermesCount;
      const cntWarRoom = document.getElementById('count-cron-warroom');
      if (cntWarRoom) cntWarRoom.innerText = warRoomCount;
      const cntSys = document.getElementById('count-cron-sys');
      if (cntSys) cntSys.innerText = sysCount;

      // Filter rows
      const filtered = cronJobsData.filter(j => {
        const eng = j.engine_type || ((j.target_type === 'workflow' || !!j.workflow_id) ? 'nexusdesk_dag' : 'hermes_native');
        if (cronFilterEngine !== 'all' && eng !== cronFilterEngine) return false;

        if (cronSearchQuery) {
          const matchName = (j.name || '').toLowerCase().includes(cronSearchQuery);
          const matchPrompt = (j.prompt || '').toLowerCase().includes(cronSearchQuery);
          const matchWf = (j.workflow_id || '').toLowerCase().includes(cronSearchQuery);
          const matchAgent = (j.agent || '').toLowerCase().includes(cronSearchQuery);
          const matchRoom = (j.room_name || j.room_id || '').toLowerCase().includes(cronSearchQuery);
          const matchSkills = Array.isArray(j.skills) ? j.skills.some(s => String(s).toLowerCase().includes(cronSearchQuery)) : false;
          if (!matchName && !matchPrompt && !matchWf && !matchAgent && !matchRoom && !matchSkills) return false;
        }
        return true;
      });

      if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="py-6 text-center text-slate-500 font-mono text-xs">No cron pipelines match the selected filters.</td></tr>`;
        return;
      }

      tbody.innerHTML = '';
      filtered.forEach((j, idx) => {
        const humanSchedule = formatScheduleHumanInUserTz(j);
        const nextUserTime = j.next_run_at ? formatDateTimeInUserTz(j.next_run_at) : (j.next_execution || 'Scheduled');
        const nextSrvTime = j.next_run_at ? formatDateTimeInServerTz(j.next_run_at) : '';
        const expr = j.schedule?.expr || j.schedule_display || '';
        const rowNum = idx + 1;

        const isWarRoom = j.engine_type === 'war_room_schedule';
        const isSys = j.engine_type === 'system_crontab';
        const isWf = !isWarRoom && !isSys && (j.engine_type === 'nexusdesk_dag' || j.target_type === 'workflow' || !!j.workflow_id);
        const engineBadge = isWarRoom
          ? `<div class="inline-flex items-center gap-1.5 flex-wrap">
               <span class="px-2 py-0.5 rounded bg-amber-950/90 border border-amber-700 text-amber-300 font-mono text-[9px] font-bold flex items-center gap-1 shadow-sm" title="Stateful War Room Collaborative Schedule">
                 <span>🤝</span> <span>WAR ROOM</span>
               </span>
               <button onclick="event.stopPropagation(); openWarRoomSchedulerFromCrons('${(j.room_id || 'general').replace(/'/g, "\\'")}')" class="text-[10px] text-amber-400 hover:text-amber-200 underline font-mono flex items-center gap-0.5 cursor-pointer" title="Jump to #${j.room_id || 'general'} Scheduler">
                 <span>#${j.room_name || j.room_id || 'general'}</span> <span>↗</span>
               </button>
             </div>`
          : isSys
          ? `<span class="px-2 py-0.5 rounded bg-slate-800 border border-slate-600 text-slate-300 font-mono text-[9px] font-bold flex items-center gap-1" title="Linux VPS OS Crontab (Read-Only Audit)">
               <span>🖥️</span> <span>VPS CRONTAB · READ-ONLY</span>
             </span>`
          : isWf
          ? `<div class="inline-flex items-center gap-1.5 flex-wrap">
               <span class="px-2 py-0.5 rounded bg-cyan-950/90 border border-cyan-700 text-cyan-300 font-mono text-[9px] font-bold flex items-center gap-1 shadow-sm" title="Multi-Agent DAG Execution Engine">
                 <span>🔀</span> <span>NEXUSDESK DAG</span>
               </span>
               <button onclick="event.stopPropagation(); navigateToWorkflowDAG('${j.workflow_id}')" class="text-[10px] text-cyan-400 hover:text-cyan-200 underline font-mono flex items-center gap-0.5 cursor-pointer" title="Inspect Visual DAG Sequence">
                 <span>${j.workflow_id}</span> <span>➔</span>
               </button>
             </div>`
          : `<span class="px-2 py-0.5 rounded bg-indigo-950/80 border border-indigo-800 text-indigo-300 font-mono text-[9px] font-bold flex items-center gap-1" title="Hermes Native Prompt / Single Agent Ticker">
               <span>🪐</span> <span>HERMES PROMPT</span>
             </span>`;

        // Extract and render bound skills chips
        const skillsList = Array.isArray(j.skills) ? j.skills : (j.skill ? [j.skill] : []);
        let skillsChipsHtml = '';
        if (skillsList.length > 0) {
          const chips = skillsList.map(s => {
            const safeSkill = String(s).replace(/'/g, "\\'");
            const agentName = j.agent || 'solaris';
            return `<button onclick="event.stopPropagation(); openStepSkillPreview('${agentName}', '${safeSkill}')" class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-950/80 border border-amber-800 text-amber-300 font-mono text-[9px] hover:bg-amber-900 transition cursor-pointer" title="Inspect dynamic SKILL.md definition"><span>🛠️</span> <span>${s}</span></button>`;
          }).join(' ');
          skillsChipsHtml = `<div class="flex flex-wrap items-center gap-1 mt-1">${chips}</div>`;
        }

        // Extract referenced files from prompt
        let fileChipsHtml = '';
        const promptText = j.prompt || '';
        const fileMatches = promptText.match(/(?:^|\s)([\w\-\.\/]+\.(?:py|sh|json|md|csv|txt|yaml|yml))/g);
        if (fileMatches && fileMatches.length > 0) {
          const uniqueFiles = Array.from(new Set(fileMatches.map(m => m.trim()))).slice(0, 3);
          const fileBadges = uniqueFiles.map(f => {
            const baseName = f.split('/').pop();
            const safePath = f.replace(/'/g, "\\'");
            const agentName = j.agent || 'solaris';
            return `<button onclick="event.stopPropagation(); inspectCronReferencedFile('${agentName}', '${safePath}')" class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-sky-950/80 border border-sky-800 text-sky-300 font-mono text-[9px] hover:bg-sky-900 transition cursor-pointer" title="View in Memory Vault: ${f}"><span>📄</span> <span>${baseName}</span></button>`;
          }).join(' ');
          fileChipsHtml = `<div class="flex flex-wrap items-center gap-1 mt-1">${fileBadges}</div>`;
        }

        const promptSnippet = isWf
          ? `<span class="text-cyan-400 font-mono">Linked DAG Pipeline: <strong>${j.workflow_id || 'Configured Pipeline'}</strong></span>`
          : promptText;

        tbody.innerHTML += `
          <tr class="hover:bg-slate-900/60 transition border-b border-slate-800/40">
            <td class="py-2.5 px-2.5 text-center text-slate-500 font-mono text-[11px] font-bold">
              #${rowNum}
            </td>
            <td class="py-2.5 px-3 max-w-[280px] sm:max-w-[340px] lg:max-w-[420px]">
              <div class="flex items-center gap-2 flex-wrap mb-1">
                <strong class="text-white text-xs font-semibold break-words">${j.name}</strong>
                ${engineBadge}
              </div>
              <div class="text-slate-400 text-[11px] leading-relaxed break-words whitespace-normal line-clamp-2 mt-0.5">
                ${promptSnippet}
              </div>
              ${skillsChipsHtml}
              ${fileChipsHtml}
            </td>
            <td class="py-2.5 px-3 whitespace-nowrap">
              <div class="text-cyan-400 font-mono text-xs font-semibold">${humanSchedule}</div>
              <div class="text-[10px] text-slate-500 font-mono mt-0.5">Expr: <code class="text-slate-400">${expr}</code></div>
            </td>
            <td class="py-2.5 px-3 whitespace-nowrap">
              <div class="font-semibold text-emerald-400 font-mono text-xs">${nextUserTime}</div>
              ${nextSrvTime ? `<div class="text-[10px] text-slate-500 font-mono mt-0.5">Server: ${nextSrvTime} CEST</div>` : ''}
            </td>
            <td class="py-2.5 px-3 whitespace-nowrap">
              <span class="px-2 py-0.5 rounded text-[9px] font-semibold ${j.last_status === 'ok' ? 'bg-emerald-950 text-emerald-400 border border-emerald-800' : 'bg-slate-800 text-slate-400'}">
                ${j.last_status || 'SCHEDULED'}
              </span>
            </td>
            <td class="py-2.5 px-2.5 text-center">
              ${isSys
                ? `<span class="text-[9px] text-slate-500 font-mono">OS</span>`
                : isWarRoom
                ? `<input type="checkbox" ${j.enabled ? 'checked' : ''} onchange="toggleWarRoomCronRow('${j.id}', '${(j.room_id || 'general').replace(/'/g, "\\'")}')" class="rounded bg-slate-900 border-slate-700 text-emerald-600 focus:ring-0 cursor-pointer" />`
                : `<input type="checkbox" ${j.enabled ? 'checked' : ''} onchange="toggleCronJob('${j.id}')" class="rounded bg-slate-900 border-slate-700 text-emerald-600 focus:ring-0 cursor-pointer" />`}
            </td>
            <td class="py-2.5 px-3 text-right whitespace-nowrap">
              <div class="flex justify-end gap-1.5">
                ${isSys
                  ? `<span class="px-2 py-1 rounded bg-slate-900 text-slate-500 border border-slate-800 text-[10px] font-mono">Host Managed</span>`
                  : isWarRoom
                  ? `<button onclick="triggerWarRoomCronRow('${j.id}', '${(j.room_id || 'general').replace(/'/g, "\\'")}')" class="px-2 py-1 rounded bg-emerald-950 text-emerald-400 border border-emerald-800 hover:bg-emerald-900 text-[11px] font-semibold cursor-pointer" title="Execute inside #${j.room_id || 'general'}">▶ Run</button>
                     <button onclick="openWarRoomSchedulerFromCrons('${(j.room_id || 'general').replace(/'/g, "\\'")}')" class="px-2 py-1 rounded bg-amber-950/80 text-amber-300 border border-amber-800 hover:bg-amber-900 text-[11px] cursor-pointer">↗ Edit in Room</button>
                     <button onclick="deleteWarRoomCronRow('${j.id}', '${(j.room_id || 'general').replace(/'/g, "\\'")}')" class="px-2 py-1 rounded bg-rose-950 text-rose-400 border border-rose-900 hover:bg-rose-900 text-[11px] cursor-pointer">🗑</button>`
                  : `<button onclick="triggerCronJob('${j.id}')" class="px-2 py-1 rounded bg-emerald-950 text-emerald-400 border border-emerald-800 hover:bg-emerald-900 text-[11px] font-semibold cursor-pointer" title="Run immediately and deliver to Telegram">▶ Run</button>
                     <button onclick="openEditCronModal('${j.id}')" class="px-2 py-1 rounded bg-slate-800 text-slate-300 hover:bg-slate-700 text-[11px] cursor-pointer">✏️ Edit</button>
                     <button onclick="deleteCronJob('${j.id}')" class="px-2 py-1 rounded bg-rose-950 text-rose-400 border border-rose-900 hover:bg-rose-900 text-[11px] cursor-pointer">🗑</button>`}
              </div>
            </td>
          </tr>
        `;
      });
    }

    async function loadCronsTable() {
      const tbody = document.getElementById('cron-table-body');
      if (tbody) tbody.innerHTML = '<tr><td colspan="7" class="py-4 text-center text-slate-500 font-mono text-xs">Loading cron pipelines...</td></tr>';

      try {
        const res = await fetch('/api/crons');
        const data = await res.json();
        cronJobsData = data.jobs || [];

        const activeCount = cronJobsData.filter(j => j.enabled !== false).length;
        const disabledCount = cronJobsData.length - activeCount;

        // Also fetch workflows count to keep sidebar and strips perfectly in sync
        let wfCount = 0;
        try {
          const wfRes = await fetch('/api/workflows');
          const wfData = await wfRes.json();
          wfCount = (wfData.workflows || []).length;
        } catch (_) {}

        updateAutomationCounts(cronJobsData.length, activeCount, disabledCount, wfCount);
        renderCronsRows();
      } catch (e) {
        if (tbody) tbody.innerHTML = `<tr><td colspan="7" class="py-4 text-center text-rose-400 font-mono text-xs">Failed to load crons: ${e}</td></tr>`;
      }
    }

    async function toggleCronJob(jobId) {
      try {
        await fetch(`/api/crons/${jobId}/toggle`, { method: 'POST' });
        loadCronsTable();
      } catch (e) {
        alert('Failed to toggle cron: ' + e);
      }
    }

    async function triggerCronJob(jobId) {
      try {
        const res = await fetch(`/api/crons/${jobId}/trigger`, { method: 'POST' });
        const data = await res.json();
        alert(`Dispatched execution for: ${data.name}. Output will deliver to Telegram.`);
      } catch (e) {
        alert('Failed to trigger cron: ' + e);
      }
    }

    async function deleteCronJob(jobId) {
      if (!confirm('Are you sure you want to delete this cron task?')) return;
      try {
        await fetch(`/api/crons/${jobId}`, { method: 'DELETE' });
        loadCronsTable();
      } catch (e) {
        alert('Failed to delete: ' + e);
      }
    }

    function openEditCronModal(id) {
      const job = cronJobsData.find(j => j.id === id);
      if (!job) return alert('Cron job not found.');

      document.getElementById('modal-cron-id').value = job.id;
      document.getElementById('modal-cron-name').value = job.name || '';
      const expr = job.schedule?.expr || job.schedule?.display || job.schedule_display || '';
      document.getElementById('modal-cron-expr').value = expr;
      document.getElementById('modal-cron-prompt').value = job.prompt || '';
      document.getElementById('cron-modal-title').innerText = `EDIT CRON: ${job.name}`;

      const isWorkflowTarget = (job.target_type === 'workflow' || !!job.workflow_id);
      setCronTargetType(isWorkflowTarget ? 'workflow' : 'prompt');
      if (isWorkflowTarget) {
        populateCronWorkflowDropdown(job.workflow_id);
      }

      // Auto-detect preset type
      const dailyMatch = expr.match(/^(\d+)\s+(\d+)\s+\*\s+\*\s+\*$/);
      if (dailyMatch) {
        setCronBuilderMode('daily');
        const srvMin = parseInt(dailyMatch[1]);
        const srvHour = parseInt(dailyMatch[2]);
        const userOffset = getUserTzOffset();
        const userHour = (srvHour + Math.round(userOffset - 2) + 24) % 24;
        const timeVal = `${String(userHour).padStart(2, '0')}:${String(srvMin).padStart(2, '0')}`;
        const timeInput = document.getElementById('cron-daily-time');
        if (timeInput) timeInput.value = timeVal;
      } else if (expr.includes('*/')) {
        setCronBuilderMode('interval');
        const m = expr.match(/\*\/(\d+)/);
        const intSelect = document.getElementById('cron-interval-hours');
        if (m && intSelect) intSelect.value = m[1];
      } else {
        setCronBuilderMode('custom');
      }

      syncCronFromHumanBuilder();
      document.getElementById('cron-modal').classList.remove('hidden');
    }

    function openCreateCronModal() {
      document.getElementById('modal-cron-id').value = '';
      document.getElementById('modal-cron-name').value = 'New Pipeline Task';
      const timeInput = document.getElementById('cron-daily-time');
      if (timeInput) timeInput.value = '07:00';
      setCronBuilderMode('daily');
      document.getElementById('modal-cron-prompt').value = 'You are Solaris, orchestrate daily pipeline updates.';
      setCronTargetType('prompt');
      document.getElementById('cron-modal-title').innerText = 'CREATE CRON JOB';
      syncCronFromHumanBuilder();
      document.getElementById('cron-modal').classList.remove('hidden');
    }

    function closeCronModal() {
      document.getElementById('cron-modal').classList.add('hidden');
    }

    async function submitSaveCron() {
      const id = document.getElementById('modal-cron-id').value;
      const name = document.getElementById('modal-cron-name').value.trim();
      const expr = document.getElementById('modal-cron-expr').value.trim();
      const prompt = document.getElementById('modal-cron-prompt').value.trim();
      const targetType = currentCronTargetType;
      const workflowId = (targetType === 'workflow') ? document.getElementById('modal-cron-workflow-id')?.value : null;

      try {
        const bodyPayload = {
          name,
          schedule_expr: expr,
          prompt,
          target_type: targetType,
          workflow_id: workflowId
        };

        if (id) {
          await fetch(`/api/crons/${id}/update`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(bodyPayload)
          });
        } else {
          bodyPayload.enabled = true;
          await fetch(`/api/crons/create`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(bodyPayload)
          });
        }
        closeCronModal();
        loadCronsTable();
      } catch (e) {
        alert('Error saving cron: ' + e);
      }
    }

    // 4. Workflows DAG & Full CRUD Management
    let currentWorkflowSteps = [];

