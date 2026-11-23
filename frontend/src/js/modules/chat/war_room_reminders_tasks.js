/**
 * @module chat/war_room_reminders_tasks.js
 * @description War Room Reminders, Async Background Tasks & Context Inspector.
 * Polls and renders scheduled reminders, live async task logs/cancellation modal,
 * and the Shared Memory & Context Inspector modal.
 *
 * Part of the Console & War Room chat subsystem (concatenated globally by frontend/build.py).
 */

// =========================================================================
// BL-WAR-18 & BL-WAR-19: Scheduled Reminders & Two-Phase Async Jobs Tray
// =========================================================================
let activeRoomReminders = [];
let activeRoomBgTasks = [];
let activeRoomSchedules = [];
let warRoomRemindersExpanded = false;
const _recentlyCancelledReminderIds = new Map();
let _lastCancelAllRemindersAt = 0;

function _filterNonCancelledReminders(list) {
  const now = Date.now();
  return (list || []).filter((r) => {
    if (!r || !r.id) return false;
    if (_lastCancelAllRemindersAt && (now - _lastCancelAllRemindersAt) < 10000) return false;
    const ts = _recentlyCancelledReminderIds.get(r.id);
    if (ts && (now - ts) < 10000) return false;
    return true;
  });
}

function _formatReminderDueBadge(r) {
  if (r && r.fire_at) {
    const remSec = Math.round(Number(r.fire_at) - Date.now() / 1000);
    if (remSec <= 0) return 'Due';
    if (remSec < 60) return `${remSec}s`;
    if (remSec < 3600) return `${Math.floor(remSec / 60)}m`;
    const hrs = Math.floor(remSec / 3600);
    const mins = Math.floor((remSec % 3600) / 60);
    return mins > 0 ? `${hrs}h ${mins}m` : `${hrs}h`;
  }
  return (r && (r.due_label || r.label)) || 'Scheduled';
}

window.toggleWarRoomRemindersExpand = function() {
  warRoomRemindersExpanded = !warRoomRemindersExpanded;
  renderWarRoomRemindersTray();
};

window.updateWarRoomTaskProgressInPlace = function(tid, elapsed, latestProgress) {
  if (!tid) return;
  const safeTid = String(tid).replace(/[^a-zA-Z0-9_\-]/g, '_');
  const elElapsed = document.getElementById(`wrs-tray-task-elapsed-${safeTid}`);
  const elProg = document.getElementById(`wrs-tray-task-prog-${safeTid}`);
  if (!elElapsed && !elProg) {
    renderWarRoomRemindersTray();
    return;
  }
  if (elElapsed && elapsed !== undefined && elapsed !== null) {
    const timeoutStr = elElapsed.dataset.timeout || '600';
    elElapsed.textContent = `[${Math.round(elapsed)}s/${timeoutStr}s]`;
  }
  if (elProg && latestProgress) {
    elProg.textContent = latestProgress;
    elProg.title = latestProgress;
  }
};

let wrsFormState = {
  frequency: 'daily',
  mode: 'agent_dispatch',
  daysOfWeek: [0],
  targets: ['Solaris'],
  activeTab: 'schedules'
};

function _escapeWrsHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function fetchRoomSchedules(roomId = activeWarRoomId) {
  const targetRoom = roomId || activeWarRoomId || 'general';
  try {
    const res = await fetch(`/api/war-room/schedules?room_id=${encodeURIComponent(targetRoom)}`);
    if (res.ok) {
      const data = await res.json();
      activeRoomSchedules = data.schedules || [];
      renderWarRoomRemindersTray();
      renderWarRoomSchedulesList();
    }
  } catch (e) {
    console.warn('Failed to fetch room schedules:', e);
  }
}

async function fetchRoomReminders(roomId = activeWarRoomId) {
  const targetRoom = roomId || activeWarRoomId || 'general';
  try {
    const res = await fetch(`/api/war-room/reminders?room_id=${encodeURIComponent(targetRoom)}&active_only=true`);
    if (res.ok) {
      const data = await res.json();
      activeRoomReminders = _filterNonCancelledReminders(data.reminders || []);
      renderWarRoomRemindersTray();
      renderWarRoomRemindersModalList();
    }
  } catch (e) {
    console.warn('Failed to fetch room reminders:', e);
  }
}

async function fetchRoomBgTasks(roomId = activeWarRoomId) {
  const targetRoom = roomId || activeWarRoomId || 'general';
  try {
    const res = await fetch(`/api/war-room/tasks?room_id=${encodeURIComponent(targetRoom)}`);
    if (res.ok) {
      const data = await res.json();
      activeRoomBgTasks = data.tasks || [];
      renderWarRoomRemindersTray();
      renderWarRoomBgTasksModalList();
    }
  } catch (e) {
    console.warn('Failed to fetch room bg tasks:', e);
  }
}

// Periodic background tasks sync (every 8s) so self-spawned or adopted jobs appear automatically
if (!window._warRoomBgTasksSyncTimer) {
  window._warRoomBgTasksSyncTimer = setInterval(() => {
    const wrPane = document.getElementById('console-pane-warroom');
    if (wrPane && !wrPane.classList.contains('hidden') && typeof activeWarRoomId !== 'undefined' && activeWarRoomId) {
      fetchRoomBgTasks(activeWarRoomId);
    }
  }, 8000);
}

function renderWarRoomRemindersTray() {
  const tray = document.getElementById('warroom-reminders-tray');
  const chipsCont = document.getElementById('warroom-reminders-chips');
  const headerPill = document.getElementById('warroom-reminders-pill');

  const runningTasks = (activeRoomBgTasks || []).filter(t => t.status === 'running');
  const enabledSchedules = (activeRoomSchedules || []).filter(s => s.enabled !== false);
  const totalScheduled = enabledSchedules.length + (activeRoomReminders || []).length;
  const totalActive = totalScheduled + runningTasks.length;

  const countEl = document.getElementById('warroom-reminders-count');
  const badgeDot = document.getElementById('warroom-reminders-badge');
  if (countEl) {
    if (totalScheduled > 0) {
      countEl.innerText = String(totalScheduled);
      countEl.classList.remove('hidden');
    } else {
      countEl.classList.add('hidden');
    }
  }
  if (badgeDot) {
    badgeDot.classList.toggle('hidden', runningTasks.length === 0 && totalScheduled === 0);
  }

  const schedTabCount = document.getElementById('wrs-tab-sched-count');
  if (schedTabCount) schedTabCount.innerText = String((activeRoomSchedules || []).length + (activeRoomReminders || []).length);
  const jobsTabCount = document.getElementById('wrs-tab-jobs-count');
  if (jobsTabCount) jobsTabCount.innerText = String((activeRoomBgTasks || []).length);

  if (headerPill) {
    if (runningTasks.length > 0) {
      headerPill.innerHTML = `<span class="inline-block w-2 h-2 rounded-full bg-cyan-400 animate-ping mr-1"></span>${runningTasks.length} Run`;
      headerPill.className = 'text-[11px] font-bold text-cyan-300';
    } else if (totalActive > 0) {
      headerPill.innerText = `${totalActive} Active`;
      headerPill.className = 'text-[11px] font-bold text-amber-300';
    } else {
      headerPill.innerText = 'Remind';
      headerPill.className = 'text-[11px] font-bold text-slate-300';
    }
  }

  if (!tray || !chipsCont) return;
  const reminders = _filterNonCancelledReminders(activeRoomReminders);
  const trayTotal = reminders.length + runningTasks.length;
  if (trayTotal === 0) {
    tray.classList.add('hidden');
    chipsCont.innerHTML = '';
    return;
  }

  tray.classList.remove('hidden');
  const actionsHtml = `
    <div class="flex items-center gap-1 shrink-0 ml-auto">
      <button type="button" onclick="event.stopPropagation(); openWarRoomRemindersModal()" class="px-2 py-0.5 rounded bg-indigo-950/90 hover:bg-indigo-900 text-indigo-200 border border-indigo-700/80 text-[10px] font-mono cursor-pointer transition whitespace-nowrap">+ New</button>
      ${reminders.length > 0 ? `<button type="button" onmousedown="event.stopPropagation()" onclick="event.stopPropagation(); cancelWarRoomReminder('all', event)" class="px-1.5 py-0.5 rounded bg-slate-800/90 hover:bg-rose-950/80 text-slate-300 hover:text-rose-200 border border-slate-700 hover:border-rose-700/70 text-[10px] font-mono cursor-pointer transition whitespace-nowrap" title="Cancel all active reminders">Clear</button>` : ''}
    </div>
  `;

  const sectionsHtml = [];

  if (runningTasks.length > 0) {
    const taskChips = runningTasks.map((t) => {
      const safeDesc = _escapeWrsHtml(t.description || t.id);
      const safeId = String(t.id || '').replace(/'/g, "\\'");
      const domTid = String(t.id || '').replace(/[^a-zA-Z0-9_\-]/g, '_');
      const latestProg = _escapeWrsHtml(t.latest_progress || 'Running in background...');
      const elapsedNum = t.elapsed ? Math.round(t.elapsed) : Math.max(0, Math.round(Date.now() / 1000 - (t.created_at || Date.now() / 1000)));
      const timeoutNum = t.timeout || 600;
      const progSub = `<span id="wrs-tray-task-prog-${domTid}" class="text-[10px] text-emerald-300 min-w-0 flex-1 truncate border-l border-cyan-700 pl-1.5" title="${latestProg}">${latestProg}</span>`;
      return `
        <div onclick="openWarRoomTaskLiveModal('${safeId}')" class="inline-flex items-center gap-1.5 bg-cyan-950/95 hover:bg-cyan-900/95 border border-cyan-500/80 rounded-lg px-2.5 py-1 text-[10.5px] text-cyan-100 font-mono cursor-pointer transition shadow-md min-w-0 flex-1 overflow-hidden" title="Click to inspect live console output or stop task (${_escapeWrsHtml(t.id)})">
          <span class="animate-spin inline-block shrink-0">⚙️</span>
          <span class="px-1.5 py-0.2 rounded bg-cyan-900/90 border border-cyan-500/60 text-[9px] font-bold text-cyan-200 uppercase shrink-0">LIVE JOB</span>
          <strong class="text-cyan-300 shrink-0">@${_escapeWrsHtml(t.agent)}:</strong>
          <span class="min-w-0 max-w-[140px] sm:max-w-[200px] truncate font-semibold">${safeDesc}</span>
          ${progSub}
          <span id="wrs-tray-task-elapsed-${domTid}" data-timeout="${timeoutNum}" class="text-[9.5px] text-amber-300 font-bold shrink-0">[${elapsedNum}s/${timeoutNum}s]</span>
          <span class="px-1.5 py-0.2 rounded bg-slate-900/90 border border-cyan-600/60 text-[9px] text-cyan-300 font-semibold shrink-0 hidden sm:inline">📄 Live Log</span>
        </div>
      `;
    }).join('');
    sectionsHtml.push(`
      <div class="flex items-center justify-between gap-1.5 w-full min-w-0">
        <div class="flex flex-col sm:flex-row sm:items-center gap-1.5 flex-1 min-w-0 overflow-hidden">${taskChips}</div>
        ${actionsHtml}
      </div>
    `);
  }

  if (reminders.length > 0) {
    const visibleReminders = warRoomRemindersExpanded ? reminders : reminders.slice(0, 2);
    const hiddenCount = Math.max(0, reminders.length - visibleReminders.length);
    const remChipsHtml = visibleReminders.map((r) => {
      const safeTxt = _escapeWrsHtml(r.text || 'Reminder');
      const safeId = String(r.id || '').replace(/'/g, "\\'");
      const dueLbl = _escapeWrsHtml(_formatReminderDueBadge(r));
      return `
        <div class="flex items-center justify-between gap-1.5 bg-indigo-950/90 border border-indigo-600/75 rounded-lg pl-2 pr-1 py-0.5 text-[10.5px] text-indigo-200 font-mono min-w-0 overflow-hidden">
          <div class="flex items-center gap-1.5 min-w-0 flex-1">
            <span class="shrink-0">⏰</span>
            <span class="min-w-0 flex-1 truncate" title="${safeTxt}">"${safeTxt}"</span>
          </div>
          <div class="flex items-center gap-1 shrink-0">
            <span class="text-[9.5px] text-amber-300 font-bold shrink-0">[${dueLbl}]</span>
            <button type="button" onmousedown="event.stopPropagation()" onclick="event.stopPropagation(); cancelWarRoomReminder('${safeId}', event)"
                    class="w-4 h-4 rounded flex items-center justify-center text-rose-300 hover:text-white hover:bg-rose-500/40 font-bold cursor-pointer transition shrink-0" title="Cancel reminder">✕</button>
          </div>
        </div>
      `;
    }).join('');

    const togglePill = reminders.length > 2
      ? `<button type="button" onclick="toggleWarRoomRemindersExpand()" class="px-2 py-0.5 rounded-lg bg-indigo-950/80 hover:bg-indigo-900 border border-indigo-700/70 text-indigo-200 text-[10px] font-mono font-semibold cursor-pointer shrink-0 whitespace-nowrap transition">${warRoomRemindersExpanded ? '▴ Less' : `+${hiddenCount} more ▾`}</button>`
      : '';

    const gridColsCls = warRoomRemindersExpanded
      ? 'grid grid-cols-1 sm:grid-cols-2 gap-1 flex-1 min-w-0'
      : (visibleReminders.length === 1 ? 'grid grid-cols-1 gap-1 flex-1 min-w-0' : 'grid grid-cols-1 sm:grid-cols-2 gap-1 flex-1 min-w-0');

    sectionsHtml.push(`
      <div class="flex items-center justify-between gap-1.5 w-full min-w-0">
        <div class="${gridColsCls}">${remChipsHtml}</div>
        <div class="flex items-center gap-1 shrink-0">
          ${togglePill}
          ${runningTasks.length === 0 ? actionsHtml : ''}
        </div>
      </div>
    `);
  }

  chipsCont.innerHTML = sectionsHtml.join('');
}

window.openWarRoomRemindersModal = function(initialTab = 'schedules') {
  const modal = document.getElementById('modal-warroom-reminders');
  if (!modal) return;
  modal.classList.remove('hidden');
  const roomBadge = document.getElementById('wrs-modal-room-badge');
  if (roomBadge) roomBadge.innerText = `#${activeWarRoomId || 'general'}`;
  const tzBadge = document.getElementById('wrs-tz-pill');
  if (tzBadge && typeof getUserTzBadge === 'function') tzBadge.innerText = getUserTzBadge();

  switchWarRoomSchedulerTab(initialTab);
  renderWrsTargetAgentsSelector();
  fetchRoomSchedules(activeWarRoomId);
  fetchRoomReminders(activeWarRoomId);
  fetchRoomBgTasks(activeWarRoomId);
  const input = document.getElementById('wrs-input-prompt');
  if (input) setTimeout(() => input.focus(), 50);
};

window.switchWarRoomSchedulerTab = function(tabName = 'schedules') {
  wrsFormState.activeTab = tabName === 'jobs' ? 'jobs' : 'schedules';
  const paneSched = document.getElementById('wrs-pane-schedules');
  const paneJobs = document.getElementById('wrs-pane-jobs');
  const btnSched = document.getElementById('wrs-tab-btn-schedules');
  const btnJobs = document.getElementById('wrs-tab-btn-jobs');
  if (paneSched) paneSched.classList.toggle('hidden', wrsFormState.activeTab !== 'schedules');
  if (paneJobs) paneJobs.classList.toggle('hidden', wrsFormState.activeTab !== 'jobs');
  if (btnSched) {
    btnSched.className = wrsFormState.activeTab === 'schedules'
      ? 'px-3.5 py-2 border-b-2 border-[#58a6ff] text-[#f0f6fc] font-semibold flex items-center gap-1.5 cursor-pointer transition'
      : 'px-3.5 py-2 border-b-2 border-transparent text-[#8b949e] hover:text-[#f0f6fc] font-medium flex items-center gap-1.5 cursor-pointer transition';
  }
  if (btnJobs) {
    btnJobs.className = wrsFormState.activeTab === 'jobs'
      ? 'px-3.5 py-2 border-b-2 border-[#58a6ff] text-[#f0f6fc] font-semibold flex items-center gap-1.5 cursor-pointer transition'
      : 'px-3.5 py-2 border-b-2 border-transparent text-[#8b949e] hover:text-[#f0f6fc] font-medium flex items-center gap-1.5 cursor-pointer transition';
  }
};

window.setWrsFrequency = function(freq) {
  wrsFormState.frequency = freq || 'daily';
  ['once', 'daily', 'weekdays', 'weekly', 'interval'].forEach(f => {
    const b = document.getElementById(`wrs-freq-${f}`);
    if (!b) return;
    b.className = f === wrsFormState.frequency
      ? 'px-2.5 py-1 rounded-lg bg-[#58a6ff]/15 text-[#58a6ff] border border-[#58a6ff]/50 text-[11px] font-semibold cursor-pointer transition'
      : 'px-2.5 py-1 rounded-lg bg-[#161b22] text-[#8b949e] border border-[#30363d] hover:text-white text-[11px] font-medium cursor-pointer transition';
  });
  const weeklyRow = document.getElementById('wrs-weekly-days-row');
  const intervalRow = document.getElementById('wrs-interval-row');
  const timeWrap = document.getElementById('wrs-time-picker-wrap');
  if (weeklyRow) weeklyRow.classList.toggle('hidden', wrsFormState.frequency !== 'weekly');
  if (intervalRow) intervalRow.classList.toggle('hidden', wrsFormState.frequency !== 'interval');
  if (timeWrap) timeWrap.classList.toggle('hidden', wrsFormState.frequency === 'interval');
};

window.toggleWrsWeekday = function(dayIdx) {
  const idx = wrsFormState.daysOfWeek.indexOf(dayIdx);
  if (idx >= 0) {
    if (wrsFormState.daysOfWeek.length > 1) wrsFormState.daysOfWeek.splice(idx, 1);
  } else {
    wrsFormState.daysOfWeek.push(dayIdx);
  }
  wrsFormState.daysOfWeek.sort((a, b) => a - b);
  for (let d = 0; d < 7; d++) {
    const btn = document.getElementById(`wrs-day-${d}`);
    if (!btn) continue;
    const on = wrsFormState.daysOfWeek.includes(d);
    btn.className = on
      ? 'wrs-day-btn px-2 py-0.5 rounded bg-[#58a6ff]/15 text-[#58a6ff] border border-[#58a6ff]/50 text-[10.5px] font-semibold cursor-pointer'
      : 'wrs-day-btn px-2 py-0.5 rounded bg-[#161b22] text-[#8b949e] border border-[#30363d] text-[10.5px] cursor-pointer';
  }
};

window.setWrsMode = function(mode) {
  wrsFormState.mode = mode || 'agent_dispatch';
  ['agent_dispatch', 'static_notice', 'roundtable'].forEach(m => {
    const b = document.getElementById(`wrs-mode-${m}`);
    if (!b) return;
    b.className = m === wrsFormState.mode
      ? 'px-2.5 py-1 rounded-lg bg-[#58a6ff]/15 text-[#79c0ff] border border-[#58a6ff]/50 text-[11px] font-semibold cursor-pointer transition'
      : 'px-2.5 py-1 rounded-lg bg-[#161b22] text-[#8b949e] border border-[#30363d] hover:text-white text-[11px] font-medium cursor-pointer transition';
  });
  const rtWrap = document.getElementById('wrs-roundtable-rounds-wrap');
  const tgtsSec = document.getElementById('wrs-targets-section');
  if (rtWrap) rtWrap.classList.toggle('hidden', wrsFormState.mode !== 'roundtable');
  if (tgtsSec) tgtsSec.classList.toggle('hidden', wrsFormState.mode === 'static_notice');
};

window.toggleWrsTargetAgent = function(name) {
  if (name === 'everyone') {
    wrsFormState.targets = wrsFormState.targets.includes('everyone') ? ['Solaris'] : ['everyone'];
  } else {
    wrsFormState.targets = wrsFormState.targets.filter(t => t !== 'everyone');
    const idx = wrsFormState.targets.indexOf(name);
    if (idx >= 0) {
      if (wrsFormState.targets.length > 1) wrsFormState.targets.splice(idx, 1);
    } else {
      wrsFormState.targets.push(name);
    }
  }
  renderWrsTargetAgentsSelector();
};

function renderWrsTargetAgentsSelector() {
  const row = document.getElementById('wrs-target-agents-row');
  if (!row) return;
  let pool = [];
  if (typeof getEffectiveWarRoomParticipants === 'function') {
    pool = getEffectiveWarRoomParticipants() || [];
  }
  const names = Array.from(new Set(pool.map(p => p.name).filter(Boolean)));
  if (!names.length) names.push('Solaris', 'Claude', 'Agy', 'Codex');
  const options = [...names, 'everyone'];
  row.innerHTML = options.map(n => {
    const active = wrsFormState.targets.includes(n);
    return `<button type="button" onclick="toggleWrsTargetAgent('${_escapeWrsHtml(n)}')" class="px-2 py-0.5 rounded-md border text-[10.5px] font-mono cursor-pointer transition ${active ? 'bg-[#3fb950]/15 text-[#56d364] border-[#3fb950]/50 font-semibold' : 'bg-[#161b22] text-[#8b949e] border-[#30363d] hover:text-white'}">@${_escapeWrsHtml(n)}</button>`;
  }).join('');
}

window.resetWarRoomScheduleForm = function() {
  const editEl = document.getElementById('wrs-edit-id');
  const promptEl = document.getElementById('wrs-input-prompt');
  const timeEl = document.getElementById('wrs-input-time');
  const pushEl = document.getElementById('wrs-input-push');
  const submitBtn = document.getElementById('wrs-submit-btn');
  const heading = document.getElementById('wrs-composer-heading');
  const cancelBtn = document.getElementById('wrs-cancel-edit-btn');
  if (editEl) editEl.value = '';
  if (promptEl) promptEl.value = '';
  if (timeEl) timeEl.value = '08:30';
  if (pushEl) pushEl.checked = false;
  if (submitBtn) submitBtn.innerText = '+ Add Schedule';
  if (heading) heading.innerText = 'Quick Composer';
  if (cancelBtn) cancelBtn.classList.add('hidden');
  wrsFormState.daysOfWeek = [0];
  wrsFormState.targets = ['Solaris'];
  setWrsFrequency('daily');
  setWrsMode('agent_dispatch');
  renderWrsTargetAgentsSelector();
};

window.saveWarRoomScheduleFromModal = async function() {
  const promptEl = document.getElementById('wrs-input-prompt');
  const promptVal = promptEl ? promptEl.value.trim() : '';
  if (!promptVal) {
    if (promptEl) promptEl.focus();
    return;
  }
  const editId = document.getElementById('wrs-edit-id')?.value?.trim() || null;
  const timeVal = document.getElementById('wrs-input-time')?.value || '08:30';
  const intervalVal = parseInt(document.getElementById('wrs-input-interval')?.value || '60', 10);
  const roundsVal = parseInt(document.getElementById('wrs-input-rounds')?.value || '2', 10);
  const pushOwner = Boolean(document.getElementById('wrs-input-push')?.checked);
  const tzOffset = (typeof getUserTzOffset === 'function') ? getUserTzOffset() : (-(new Date().getTimezoneOffset() / 60));

  try {
    const res = await fetch('/api/war-room/schedules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: editId,
        room_id: activeWarRoomId || 'general',
        prompt: promptVal,
        frequency: wrsFormState.frequency,
        days_of_week: wrsFormState.daysOfWeek,
        time_hhmm: timeVal,
        interval_minutes: wrsFormState.frequency === 'interval' ? intervalVal : null,
        tz_offset_hours: tzOffset,
        mode: wrsFormState.mode,
        targets: wrsFormState.targets,
        roundtable_rounds: roundsVal,
        push_to_owner_channel: pushOwner,
        created_by: 'operator',
        created_via: 'modal'
      })
    });
    const data = await res.json();
    if (!res.ok) {
      alert('Failed to save schedule: ' + (data.detail || `HTTP ${res.status}`));
      return;
    }
    activeRoomSchedules = data.schedules || activeRoomSchedules;
    resetWarRoomScheduleForm();
    renderWarRoomRemindersTray();
    renderWarRoomSchedulesList();
  } catch (e) {
    alert('Error saving War Room schedule: ' + e.message);
  }
};

window.editWarRoomSchedule = function(schedId) {
  const s = (activeRoomSchedules || []).find(x => x.id === schedId);
  if (!s) return;
  switchWarRoomSchedulerTab('schedules');
  const editEl = document.getElementById('wrs-edit-id');
  const promptEl = document.getElementById('wrs-input-prompt');
  const timeEl = document.getElementById('wrs-input-time');
  const intervalEl = document.getElementById('wrs-input-interval');
  const roundsEl = document.getElementById('wrs-input-rounds');
  const pushEl = document.getElementById('wrs-input-push');
  const submitBtn = document.getElementById('wrs-submit-btn');
  const heading = document.getElementById('wrs-composer-heading');
  const cancelBtn = document.getElementById('wrs-cancel-edit-btn');

  if (editEl) editEl.value = s.id;
  if (promptEl) promptEl.value = s.prompt || s.title || '';
  if (timeEl && s.time_hhmm) timeEl.value = s.time_hhmm;
  if (intervalEl && s.interval_minutes) intervalEl.value = String(s.interval_minutes);
  if (roundsEl && s.roundtable_rounds) roundsEl.value = String(s.roundtable_rounds);
  if (pushEl) pushEl.checked = Boolean(s.push_to_owner_channel);
  if (submitBtn) submitBtn.innerText = 'Save Changes';
  if (heading) heading.innerText = `Editing Schedule (${s.id})`;
  if (cancelBtn) cancelBtn.classList.remove('hidden');

  wrsFormState.daysOfWeek = Array.isArray(s.days_of_week) && s.days_of_week.length ? [...s.days_of_week] : [0];
  wrsFormState.targets = Array.isArray(s.targets) && s.targets.length ? [...s.targets] : ['Solaris'];
  setWrsFrequency(s.frequency || 'daily');
  for (let d = 0; d < 7; d++) {
    const btn = document.getElementById(`wrs-day-${d}`);
    if (!btn) continue;
    const on = wrsFormState.daysOfWeek.includes(d);
    btn.className = on
      ? 'wrs-day-btn px-2 py-0.5 rounded bg-[#58a6ff]/15 text-[#58a6ff] border border-[#58a6ff]/50 text-[10.5px] font-semibold cursor-pointer'
      : 'wrs-day-btn px-2 py-0.5 rounded bg-[#161b22] text-[#8b949e] border border-[#30363d] text-[10.5px] cursor-pointer';
  }
  setWrsMode(s.mode || 'agent_dispatch');
  renderWrsTargetAgentsSelector();
  if (promptEl) promptEl.focus();
};

window.toggleWarRoomSchedule = async function(schedId) {
  try {
    const res = await fetch(`/api/war-room/schedules/${encodeURIComponent(schedId)}/toggle?room_id=${encodeURIComponent(activeWarRoomId || 'general')}`, { method: 'PATCH' });
    if (res.ok) {
      const data = await res.json();
      activeRoomSchedules = data.schedules || activeRoomSchedules;
      renderWarRoomRemindersTray();
      renderWarRoomSchedulesList();
    }
  } catch (e) {
    console.warn('Failed to toggle War Room schedule:', e);
  }
};

window.runWarRoomScheduleNow = async function(schedId) {
  try {
    const res = await fetch(`/api/war-room/schedules/${encodeURIComponent(schedId)}/run?room_id=${encodeURIComponent(activeWarRoomId || 'general')}`, { method: 'POST' });
    if (res.ok) {
      closeWarRoomRemindersModal();
    } else {
      const d = await res.json().catch(() => ({}));
      alert('Failed to run schedule: ' + (d.detail || `HTTP ${res.status}`));
    }
  } catch (e) {
    alert('Error triggering schedule: ' + e.message);
  }
};

window.deleteWarRoomSchedule = async function(schedId) {
  if (!confirm('Delete this War Room schedule?')) return;
  try {
    const res = await fetch(`/api/war-room/schedules/${encodeURIComponent(schedId)}?room_id=${encodeURIComponent(activeWarRoomId || 'general')}`, { method: 'DELETE' });
    if (res.ok) {
      const data = await res.json();
      activeRoomSchedules = data.schedules || [];
      renderWarRoomRemindersTray();
      renderWarRoomSchedulesList();
    }
  } catch (e) {
    console.warn('Failed to delete War Room schedule:', e);
  }
};

function renderWarRoomSchedulesList() {
  const list = document.getElementById('wrs-schedules-list');
  if (!list) return;
  if (!activeRoomSchedules || activeRoomSchedules.length === 0) {
    list.innerHTML = '<div class="text-[#8b949e] text-[11px] py-4 text-center border border-dashed border-[#30363d] rounded-xl bg-[#0d1117]/40">No recurring or complex schedules yet. Add one above or ask @Solaris in room chat.</div>';
    return;
  }
  list.innerHTML = activeRoomSchedules.map(s => {
    const enabled = s.enabled !== false;
    const mode = (s.mode || 'agent_dispatch').toLowerCase();
    const modeBadge = mode === 'roundtable'
      ? `<span class="px-2 py-0.5 rounded bg-[#bc8cff]/15 text-[#d2a8ff] border border-[#bc8cff]/40 text-[9.5px] font-semibold">🎯 ROUNDTABLE (${s.roundtable_rounds || 2}R)</span>`
      : mode === 'static_notice'
      ? `<span class="px-2 py-0.5 rounded bg-[#d29922]/15 text-[#e3b341] border border-[#d29922]/40 text-[9.5px] font-semibold">💬 STATIC NOTICE ($0 AI)</span>`
      : `<span class="px-2 py-0.5 rounded bg-[#58a6ff]/15 text-[#79c0ff] border border-[#58a6ff]/40 text-[9.5px] font-semibold">🤖 AI DISPATCH (${_escapeWrsHtml((s.targets || []).map(t => '@' + t).join(', '))})</span>`;
    const creatorBadge = s.created_by && s.created_by !== 'operator'
      ? `<span class="px-1.5 py-0.5 rounded bg-[#3fb950]/10 text-[#56d364] border border-[#3fb950]/30 text-[9px] font-mono">by @${_escapeWrsHtml(s.created_by)}</span>`
      : `<span class="px-1.5 py-0.5 rounded bg-[#21262d] text-[#8b949e] border border-[#30363d] text-[9px] font-mono">by @Owner</span>`;
    const safeId = _escapeWrsHtml(s.id);
    return `
      <div class="p-3 rounded-xl border transition ${enabled ? 'bg-[#0d1117] border-[#30363d]' : 'bg-[#0d1117]/40 border-[#30363d]/50 opacity-65'} flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div class="flex items-start gap-3 min-w-0 flex-1">
          <div class="px-2.5 py-1.5 rounded-lg bg-[#161b22] border border-[#30363d] text-center shrink-0 min-w-[92px]">
            <div class="text-[10px] font-semibold text-[#58a6ff] leading-tight">${_escapeWrsHtml((s.frequency || 'daily').toUpperCase())}</div>
            <div class="font-mono text-[10px] text-[#c9d1d9] mt-0.5">${_escapeWrsHtml(s.time_hhmm || (s.interval_minutes ? s.interval_minutes + 'm' : '—'))}</div>
          </div>
          <div class="min-w-0 flex-1 space-y-1">
            <div class="flex items-center gap-1.5 flex-wrap">
              ${modeBadge}
              ${creatorBadge}
              ${s.push_to_owner_channel ? '<span class="text-[9.5px] text-[#56d364]" title="Pushes summary to Owner WA/TG">📱</span>' : ''}
            </div>
            <div class="text-xs font-semibold text-[#f0f6fc] truncate" title="${_escapeWrsHtml(s.prompt)}">${_escapeWrsHtml(s.title)}</div>
            <div class="text-[10.5px] text-[#8b949e] font-mono">Next: <span class="${enabled ? 'text-[#c9d1d9]' : 'text-[#8b949e]'}">${_escapeWrsHtml(s.next_run_display || 'Scheduled')}</span>${s.run_count ? ` · Runs: ${s.run_count}` : ''}</div>
          </div>
        </div>
        <div class="flex items-center gap-1.5 shrink-0 flex-wrap">
          <button type="button" onclick="runWarRoomScheduleNow('${safeId}')" class="px-2 py-1 rounded-lg bg-[#21262d] hover:bg-[#238636] text-[#c9d1d9] hover:text-white border border-[#30363d] text-[10.5px] font-medium cursor-pointer transition" title="Execute inside room now">▶ Run</button>
          <button type="button" onclick="toggleWarRoomSchedule('${safeId}')" class="px-2 py-1 rounded-lg bg-[#21262d] hover:bg-[#30363d] text-[#c9d1d9] border border-[#30363d] text-[10.5px] font-medium cursor-pointer transition">${enabled ? '⏸ Pause' : '▶ Resume'}</button>
          <button type="button" onclick="editWarRoomSchedule('${safeId}')" class="px-2 py-1 rounded-lg bg-[#21262d] hover:bg-[#30363d] text-[#c9d1d9] border border-[#30363d] text-[10.5px] font-medium cursor-pointer transition">✏️ Edit</button>
          <button type="button" onclick="deleteWarRoomSchedule('${safeId}')" class="px-2 py-1 rounded-lg bg-[#f85149]/10 hover:bg-[#f85149]/25 text-[#f85149] border border-[#f85149]/30 text-[10.5px] font-medium cursor-pointer transition" title="Delete schedule">🗑️</button>
        </div>
      </div>
    `;
  }).join('');
}

window.closeWarRoomRemindersModal = function() {
  const modal = document.getElementById('modal-warroom-reminders');
  if (modal) modal.classList.add('hidden');
};

window.fillReminderPreset = function(text) {
  const input = document.getElementById('warroom-reminder-input');
  if (input) {
    input.value = text;
    input.focus();
  }
};

window.submitNewWarRoomReminder = async function() {
  const input = document.getElementById('warroom-reminder-input');
  const text = input ? input.value.trim() : '';
  if (!text) return;
  try {
    const tzOffsetHours = -(new Date().getTimezoneOffset() / 60);
    const res = await fetch('/api/war-room/reminders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        room_id: activeWarRoomId || 'general',
        text: text,
        timezone_offset_hours: tzOffsetHours
      })
    });
    const contentType = res.headers.get('content-type') || '';
    const data = contentType.includes('application/json') ? await res.json() : { detail: await res.text() };
    if (res.ok) {
      if (input) input.value = '';
      activeRoomReminders = data.reminders || (data.reminder ? [...activeRoomReminders, data.reminder] : activeRoomReminders);
      renderWarRoomRemindersTray();
      renderWarRoomRemindersModalList();
    } else {
      alert('Failed to schedule reminder: ' + (data.detail || `HTTP ${res.status}`));
    }
  } catch (e) {
    alert('Error scheduling reminder: ' + e.message);
  }
};

window.cancelWarRoomReminder = async function(reminderId = 'all', ev = null) {
  if (ev && typeof ev.preventDefault === 'function') ev.preventDefault();
  if (ev && typeof ev.stopPropagation === 'function') ev.stopPropagation();

  const now = Date.now();
  if (reminderId === 'all') {
    _lastCancelAllRemindersAt = now;
    activeRoomReminders = [];
  } else if (reminderId) {
    _recentlyCancelledReminderIds.set(reminderId, now);
    activeRoomReminders = (activeRoomReminders || []).filter((r) => r.id !== reminderId);
  }
  renderWarRoomRemindersTray();
  renderWarRoomRemindersModalList();

  try {
    const res = await fetch('/api/war-room/reminders/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        room_id: activeWarRoomId || 'general',
        reminder_id: reminderId
      })
    });
    const contentType = res.headers.get('content-type') || '';
    const data = contentType.includes('application/json') ? await res.json() : { detail: await res.text() };
    if (res.ok) {
      activeRoomReminders = _filterNonCancelledReminders(data.reminders || []);
      renderWarRoomRemindersTray();
      renderWarRoomRemindersModalList();
    } else {
      console.warn('Cancel reminder response:', res.status, data);
    }
  } catch (e) {
    console.warn('Error cancelling reminder:', e);
  }
};

function renderWarRoomRemindersModalList() {
  const list = document.getElementById('warroom-reminders-modal-list');
  if (!list) return;
  if (!activeRoomReminders || activeRoomReminders.length === 0) {
    list.innerHTML = '<div class="text-slate-500 text-[11px] py-2 text-center border border-dashed border-slate-800 rounded-lg">No active reminders in this room.</div>';
    return;
  }
  list.innerHTML = activeRoomReminders.map(r => {
    const safeTxt = _escapeWrsHtml(r.text || '');
    const safeId = (r.id || '').replace(/'/g, "\\'");
    const dueDisp = _escapeWrsHtml(_formatReminderDueBadge(r) + (r.label && r.label !== _formatReminderDueBadge(r) ? ` · ${r.label}` : ''));
    return `
      <div class="flex items-center justify-between p-2 rounded-lg bg-slate-900 border border-slate-800 gap-2">
        <div class="min-w-0 flex-1">
          <div class="text-slate-100 font-bold text-[11px] truncate" title="${safeTxt}">⏰ ${safeTxt}</div>
          <div class="text-[10px] text-amber-300 font-mono">Trigger: ${dueDisp}</div>
        </div>
        <button type="button" onclick="event.stopPropagation(); cancelWarRoomReminder('${safeId}', event)" class="px-2 py-0.5 rounded bg-rose-950/80 hover:bg-rose-900 text-rose-300 border border-rose-800 text-[10px] cursor-pointer shrink-0">Cancel</button>
      </div>
    `;
  }).join('');
}

function renderWarRoomBgTasksModalList() {
  const list = document.getElementById('warroom-bg-tasks-modal-list');
  if (!list) return;
  if (!activeRoomBgTasks || activeRoomBgTasks.length === 0) {
    list.innerHTML = '<div class="text-slate-500 text-[11px] py-2 text-center border border-dashed border-slate-800 rounded-lg">No background async jobs recorded for this room yet.</div>';
    return;
  }
  list.innerHTML = activeRoomBgTasks.slice(0, 10).map(t => {
    const st = (t.status || 'running').toLowerCase();
    const badgeCls = st === 'completed'
      ? 'bg-emerald-950 text-emerald-300 border-emerald-700'
      : st === 'running'
      ? 'bg-cyan-950 text-cyan-300 border-cyan-600 animate-pulse'
      : 'bg-rose-950 text-rose-300 border-rose-700';
    const safeDesc = (t.description || t.id).replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const safeId = (t.id || '').replace(/'/g, "\\'");
    const latestProg = (t.latest_progress || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const logBtn = t.log_file
      ? `<button type="button" onclick="closeWarRoomRemindersModal(); openFsQuickViewModal('${t.log_file.replace(/'/g, "\\'")}')" class="text-[10px] text-cyan-400 hover:underline cursor-pointer">📄 Log</button>`
      : '';
    const liveBtn = `<button type="button" onclick="closeWarRoomRemindersModal(); openWarRoomTaskLiveModal('${safeId}')" class="px-1.5 py-0.5 rounded bg-cyan-950 hover:bg-cyan-900 text-cyan-300 border border-cyan-700 text-[10px] cursor-pointer">🔍 Live</button>`;
    return `
      <div class="p-2 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-between gap-2">
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-1.5">
            <strong class="text-slate-200 text-[11px]">@${t.agent}</strong>
            <span class="text-[9px] text-slate-400 font-mono">${t.id}</span>
            <span class="px-1.5 py-0.2 rounded text-[8.5px] font-bold uppercase border ${badgeCls}">${st}</span>
          </div>
          <div class="text-[10.5px] text-slate-300 truncate mt-0.5">${safeDesc}</div>
          ${latestProg ? `<div class="text-[9.5px] text-emerald-400 font-mono truncate mt-0.5">↳ ${latestProg}</div>` : ''}
        </div>
        <div class="shrink-0 flex items-center gap-2">
          ${t.duration ? `<span class="text-[9.5px] text-slate-400">${t.duration}s</span>` : ''}
          ${liveBtn}
          ${logBtn}
        </div>
      </div>
    `;
  }).join('');
}

let activeLiveTaskModalId = null;
let activeLiveTaskPollTimer = null;

window.openWarRoomTaskLiveModal = function(taskId) {
  activeLiveTaskModalId = taskId;
  const modal = document.getElementById('modal-warroom-task-live');
  if (!modal) return;
  modal.classList.remove('hidden');
  refreshActiveTaskLiveModal();
  if (activeLiveTaskPollTimer) clearInterval(activeLiveTaskPollTimer);
  activeLiveTaskPollTimer = setInterval(refreshActiveTaskLiveModal, 2500);
};

window.closeWarRoomTaskLiveModal = function() {
  const modal = document.getElementById('modal-warroom-task-live');
  if (modal) modal.classList.add('hidden');
  activeLiveTaskModalId = null;
  if (activeLiveTaskPollTimer) {
    clearInterval(activeLiveTaskPollTimer);
    activeLiveTaskPollTimer = null;
  }
};

window.refreshActiveTaskLiveModal = async function() {
  if (!activeLiveTaskModalId) return;
  const targetRoom = activeWarRoomId || 'general';
  try {
    const res = await fetch(`/api/war-room/tasks/${encodeURIComponent(activeLiveTaskModalId)}/live?room_id=${encodeURIComponent(targetRoom)}&tail=60`);
    if (!res.ok) return;
    const data = await res.json();
    const t = data.task || {};
    const st = (t.status || 'running').toLowerCase();

    const titleEl = document.getElementById('task-live-title');
    const subEl = document.getElementById('task-live-subtitle');
    const badgeEl = document.getElementById('task-live-status-badge');
    const spinEl = document.getElementById('task-live-spinner');
    const elapsedEl = document.getElementById('task-live-elapsed');
    const latestEl = document.getElementById('task-live-latest-line');
    const barEl = document.getElementById('task-live-progress-bar');
    const cmdEl = document.getElementById('task-live-command');
    const logEl = document.getElementById('task-live-log-stream');
    const cancelBtn = document.getElementById('btn-cancel-live-task');

    if (titleEl) titleEl.innerText = t.description || t.id || 'Async Background Task';
    if (subEl) subEl.innerText = `@${t.agent || 'Agent'} • ${t.id || activeLiveTaskModalId}${t.pid ? ` (PID ${t.pid})` : ''}`;
    if (badgeEl) {
      badgeEl.innerText = st.toUpperCase();
      badgeEl.className = st === 'completed'
        ? 'px-1.5 py-0.5 rounded text-[9px] font-bold uppercase bg-emerald-950 text-emerald-300 border border-emerald-600'
        : st === 'running'
        ? 'px-1.5 py-0.5 rounded text-[9px] font-bold uppercase bg-cyan-950 text-cyan-300 border border-cyan-600'
        : 'px-1.5 py-0.5 rounded text-[9px] font-bold uppercase bg-rose-950 text-rose-300 border border-rose-600';
    }
    if (spinEl) {
      spinEl.className = st === 'running' ? 'text-base animate-spin inline-block' : 'text-base inline-block';
      spinEl.innerText = st === 'completed' ? '✅' : st === 'running' ? '⚙️' : '⚠️';
    }

    const elap = Math.round(data.elapsed || 0);
    const tout = Math.round(data.timeout || t.timeout || 600);
    if (elapsedEl) elapsedEl.innerText = `${elap}s / ${tout}s`;
    if (latestEl) latestEl.innerText = data.latest_progress || t.latest_progress || 'Running...';
    if (barEl) {
      const pct = st === 'completed' ? 100 : Math.min(98, Math.max(4, Math.round((elap / tout) * 100)));
      barEl.style.width = `${pct}%`;
    }
    if (cmdEl) cmdEl.innerText = `Command: ${t.command || '-'}`;
    if (logEl) {
      logEl.innerText = data.log_tail || '(Waiting for output...)';
      logEl.scrollTop = logEl.scrollHeight;
    }
    if (cancelBtn) {
      if (st === 'running') {
        cancelBtn.classList.remove('hidden');
      } else {
        cancelBtn.classList.add('hidden');
        if (activeLiveTaskPollTimer) {
          clearInterval(activeLiveTaskPollTimer);
          activeLiveTaskPollTimer = null;
        }
      }
    }
  } catch (e) {
    console.warn('Error fetching live task telemetry:', e);
  }
};

window.cancelActiveLiveTask = async function() {
  if (!activeLiveTaskModalId) return;
  if (!confirm(`Cancel running background job ${activeLiveTaskModalId}?`)) return;
  try {
    const res = await fetch('/api/war-room/tasks/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        room_id: activeWarRoomId || 'general',
        task_id: activeLiveTaskModalId
      })
    });
    if (res.ok) {
      await refreshActiveTaskLiveModal();
      await fetchRoomBgTasks(activeWarRoomId);
    }
  } catch (e) {
    alert('Failed to cancel task: ' + e.message);
  }
};

// -------------------------------------------------------------------------
// BL-EVO-36: Antigravity-Style War Room Shared Memory & Context Inspector
// -------------------------------------------------------------------------
function renderWarRoomMemoryPayload(data) {
  if (!data) return;
  const turnsEl = document.getElementById('warroom-mem-stat-turns');
  const compEl = document.getElementById('warroom-mem-stat-compacted');
  const filesEl = document.getElementById('warroom-mem-stat-files');
  const modeEl = document.getElementById('warroom-mem-stat-mode');
  const pinnedEl = document.getElementById('warroom-mem-pinned-input');
  const sumEl = document.getElementById('warroom-mem-summary-input');
  const reqsList = document.getElementById('warroom-mem-requests-list');
  const artsList = document.getElementById('warroom-mem-artifacts-list');

  if (turnsEl) turnsEl.innerText = `${data.substantive_messages || 0} (${data.recent_window_count || 0} live)`;
  if (compEl) compEl.innerText = String(data.older_compacted_count || 0);
  if (filesEl) filesEl.innerText = String((data.artifacts || []).length);
  if (modeEl) {
    const m = data.compaction_mode || 'auto';
    modeEl.innerText = m === 'llm_antigravity' ? '⚡ LLM Compacted' : m === 'operator_edited' ? '✏️ Operator Pinned' : m === 'deterministic' ? '🧭 Deterministic' : '🟢 Sliding Window';
  }
  if (pinnedEl) pinnedEl.value = data.pinned_notes || '';
  if (sumEl) sumEl.value = data.compacted_summary || '';

  if (reqsList) {
    const reqs = data.user_requests || [];
    if (!reqs.length) {
      reqsList.innerHTML = '<div class="text-slate-500 text-center py-2">No operator requests recorded yet.</div>';
    } else {
      reqsList.innerHTML = reqs.map(r => `
        <div class="p-1.5 rounded bg-slate-900/80 border border-slate-800/80 flex items-start gap-2">
          <span class="text-cyan-400 font-bold shrink-0">#${r.index}${r.timestamp ? ` [${r.timestamp}]` : ''}</span>
          <span class="text-slate-200 break-words">${String(r.text || '').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</span>
        </div>
      `).join('');
    }
  }

  if (artsList) {
    const arts = data.artifacts || [];
    if (!arts.length) {
      artsList.innerHTML = '<div class="text-slate-500 text-center py-2">No sandbox deliverables or scripts indexed yet.</div>';
    } else {
      artsList.innerHTML = arts.map(a => {
        const isDeliv = a.category === 'deliverable';
        const badgeCls = isDeliv ? 'bg-emerald-950 text-emerald-300 border-emerald-700' : 'bg-amber-950 text-amber-300 border-amber-700';
        const schemaTxt = a.schema_hint ? ` • <span class="text-cyan-300">${String(a.schema_hint).replace(/</g, '&lt;')}</span>` : '';
        return `
          <div class="p-1.5 rounded bg-slate-900/80 border border-slate-800/80 flex flex-wrap items-center justify-between gap-1">
            <div class="flex items-center gap-1.5 min-w-0">
              <span class="px-1 py-0.2 rounded text-[9px] font-bold border ${badgeCls}">${isDeliv ? 'DELIV' : 'SCRATCH'}</span>
              <span class="text-slate-100 font-semibold truncate">${a.name}</span>
              <span class="text-purple-300 text-[10px]">${a.owner || ''}</span>
            </div>
            <div class="text-[10px] text-slate-400">${a.size_str || ''} • ${a.mtime_str || ''}${schemaTxt}</div>
          </div>
        `;
      }).join('');
    }
  }
}

async function openWarRoomMemoryModal() {
  const modal = document.getElementById('modal-warroom-memory');
  if (!modal) return;
  modal.classList.remove('hidden');
  const statusEl = document.getElementById('warroom-mem-save-status');
  if (statusEl) statusEl.innerText = 'Loading room memory state...';
  try {
    const rid = (typeof activeWarRoomId !== 'undefined' && activeWarRoomId) ? activeWarRoomId : 'general';
    const res = await fetch(`/api/war-room/context?room_id=${encodeURIComponent(rid)}`);
    if (res.ok) {
      const data = await res.json();
      renderWarRoomMemoryPayload(data);
      if (statusEl) statusEl.innerText = `Synced for room '${rid}'`;
    }
  } catch (e) {
    if (statusEl) statusEl.innerText = 'Error loading context: ' + e.message;
  }
}

function closeWarRoomMemoryModal() {
  const modal = document.getElementById('modal-warroom-memory');
  if (modal) modal.classList.add('hidden');
}

async function saveWarRoomMemoryContext() {
  const rid = (typeof activeWarRoomId !== 'undefined' && activeWarRoomId) ? activeWarRoomId : 'general';
  const pinnedEl = document.getElementById('warroom-mem-pinned-input');
  const sumEl = document.getElementById('warroom-mem-summary-input');
  const statusEl = document.getElementById('warroom-mem-save-status');
  if (statusEl) statusEl.innerText = 'Saving memory overrides...';
  try {
    const res = await fetch('/api/war-room/context', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        room_id: rid,
        pinned_notes: pinnedEl ? pinnedEl.value : '',
        compacted_summary: sumEl ? sumEl.value : ''
      })
    });
    if (res.ok) {
      const data = await res.json();
      renderWarRoomMemoryPayload(data);
      if (statusEl) statusEl.innerText = '✅ Saved! Injected into all subsequent agent turns.';
    }
  } catch (e) {
    if (statusEl) statusEl.innerText = '⚠️ Save failed: ' + e.message;
  }
}

async function triggerWarRoomMemoryCompaction() {
  const rid = (typeof activeWarRoomId !== 'undefined' && activeWarRoomId) ? activeWarRoomId : 'general';
  const btn = document.getElementById('btn-warroom-compact-now');
  const statusEl = document.getElementById('warroom-mem-save-status');
  if (btn) {
    btn.disabled = true;
    btn.innerText = '⏳ Compacting...';
  }
  if (statusEl) statusEl.innerText = 'Running Antigravity-style multi-agent compaction...';
  try {
    const res = await fetch('/api/war-room/context/compact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ room_id: rid })
    });
    if (res.ok) {
      const data = await res.json();
      renderWarRoomMemoryPayload(data);
      if (statusEl) statusEl.innerText = '✅ Context compacted & mirrored to CONTEXT_SUMMARY.md!';
    }
  } catch (e) {
    if (statusEl) statusEl.innerText = '⚠️ Compaction error: ' + e.message;
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerText = '⚡ Compact Now';
    }
  }
}

window.openWarRoomMemoryModal = openWarRoomMemoryModal;
window.closeWarRoomMemoryModal = closeWarRoomMemoryModal;
window.saveWarRoomMemoryContext = saveWarRoomMemoryContext;
window.triggerWarRoomMemoryCompaction = triggerWarRoomMemoryCompaction;
