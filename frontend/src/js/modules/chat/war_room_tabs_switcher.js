/**
 * @module chat/war_room_tabs_switcher.js
 * @description War Room Multi-Tab Navigation & Room Switcher.
 * Maintains active console mode (`direct` / `warroom`), `activeWarRoomId`, console tabs,
 * searchable room switcher pill, and live/unread room indicators.
 *
 * Part of the Console & War Room chat subsystem (concatenated globally by frontend/build.py).
 */

// ==============================================================
// --- BL-CHAT-18: MULTI-TAB CHAT & WAR ROOM MANAGEMENT ---
// ==============================================================
let currentConsoleMode = 'direct'; // 'direct' | 'warroom'
let activeConsoleTabId = 'tab-direct-default';
let activeWarRoomId = 'general';
let warRoomParticipants = [];
let warRoomDictating = false;
let warRoomRecognition = null;

let consoleTabs = [
  { id: 'tab-direct-default', type: 'direct', title: '1-on-1', agent: 'Solaris', closable: false },
  { id: 'tab-warroom-general', type: 'warroom', title: 'War Room: General', roomId: 'general', closable: false }
];

// ==============================================================
// --- BL-UI-57: WAR ROOM SWITCHER (replaces sliding room tabs) ---
// One pill + searchable dropdown with live/unread/orchestrator
// indicators and inline rename/delete. Direct 1-on-1 tabs remain.
// ==============================================================
const ROOM_PREFIX_RE = /^War Room:\s*/i;
const roomActivity = { live: new Set(), unread: {}, orch: {} };
let roomSwitcherOpen = false;
let roomSwitcherQuery = '';
let roomSwitcherRenamingId = null;
let roomPillRenaming = false;

function roomDisplayName(tab) {
  return (tab.title || '').replace(ROOM_PREFIX_RE, '') || 'Room';
}

function escRoomHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderConsoleTabs() {
  const container = document.getElementById('console-room-tabs-bar');
  if (!container) return;
  if (roomPillRenaming) return; // keep inline pill editor alive across WS-triggered re-renders

  const roomTabs = consoleTabs.filter(t => t.type === 'warroom');
  const otherTabs = consoleTabs.filter(t => t.type !== 'warroom');
  const currentRoom = roomTabs.find(t => t.id === activeConsoleTabId)
    || roomTabs.find(t => (t.roomId || 'general') === activeWarRoomId)
    || roomTabs[0];
  const warroomActive = !!currentRoom && currentRoom.id === activeConsoleTabId;

  const directHtml = otherTabs.map(tab => {
    const isActive = tab.id === activeConsoleTabId;
    const activeClass = isActive
      ? 'bg-emerald-950/90 text-emerald-200 border-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.25)] font-bold'
      : 'bg-slate-900/90 hover:bg-slate-800 text-slate-400 hover:text-slate-200 border-slate-700/80';
    return `
      <div class="group flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-mono transition cursor-pointer shrink-0 select-none ${activeClass}"
           onclick="activateConsoleTab('${tab.id}')" title="${escRoomHtml(tab.title)}">
        <span class="text-xs shrink-0">💬</span>
        <span class="max-w-[100px] sm:max-w-[140px] md:max-w-[170px] truncate">${escRoomHtml(tab.title)}</span>
        ${tab.closable ? `
          <button type="button" onclick="event.stopPropagation(); closeConsoleTab('${tab.id}')" class="ml-0.5 text-slate-400 hover:text-rose-400 p-0.5 rounded hover:bg-slate-800 transition" title="Close Tab">✕</button>
        ` : ''}
      </div>`;
  }).join('');

  let pillHtml = '';
  if (currentRoom) {
    const rid = currentRoom.roomId || 'general';
    const isLive = roomActivity.live.has(rid);
    const otherActivity = roomTabs.some(t => {
      const r = t.roomId || 'general';
      return r !== rid && ((roomActivity.unread[r] || 0) > 0 || roomActivity.live.has(r));
    });
    const pillClass = warroomActive
      ? 'bg-cyan-950/90 text-cyan-200 border-cyan-500 shadow-[0_0_10px_rgba(6,182,212,0.25)] font-bold'
      : 'bg-slate-900/90 hover:bg-slate-800 text-slate-300 border-slate-700/80';
    pillHtml = `
      <div class="flex items-center gap-1 shrink-0">
        <div role="button" tabindex="0" id="room-switcher-pill" onclick="toggleRoomSwitcher(event)" ondblclick="startRoomPillRename()"
                class="relative flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-mono transition cursor-pointer select-none ${pillClass}"
                title="Switch War Room (Ctrl+K) • double-click to rename">
          <span class="text-xs shrink-0">🛡</span>
          <span id="room-pill-name" class="max-w-[110px] sm:max-w-[170px] md:max-w-[240px] truncate">${escRoomHtml(currentRoom.title)}</span>
          ${isLive ? '<span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shrink-0" title="Live: agents working"></span>' : ''}
          <span class="text-[9px] text-slate-400">▾</span>
          ${otherActivity ? '<span class="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-amber-400 border border-[#161b22]" title="Activity in other rooms"></span>' : ''}
        </div>
        ${rid !== 'general' ? `<button type="button" onclick="startRoomPillRename()" class="text-slate-400 hover:text-cyan-300 p-1 rounded transition text-xs" title="Rename War Room">✏️</button>` : ''}
        <span id="warroom-subnav-room-badge" class="text-[8.5px] sm:text-[9.5px] font-mono px-1.5 py-0.5 rounded font-bold uppercase bg-cyan-950/90 text-cyan-300 border border-cyan-800/80 shrink-0 select-none ml-0.5" title="Active Room ID">${escRoomHtml(rid.toUpperCase())}</span>
      </div>`;
  }

  container.innerHTML = directHtml + pillHtml;
  if (roomSwitcherOpen) renderRoomSwitcherPanel();
}

window.startRoomPillRename = function() {
  const roomTabs = consoleTabs.filter(t => t.type === 'warroom');
  const tab = roomTabs.find(t => t.id === activeConsoleTabId) || roomTabs.find(t => (t.roomId || 'general') === activeWarRoomId);
  if (!tab || (tab.roomId || 'general') === 'general') return;
  closeRoomSwitcher();
  const nameEl = document.getElementById('room-pill-name');
  if (!nameEl) return;
  roomPillRenaming = true;
  const original = roomDisplayName(tab);
  const input = document.createElement('input');
  input.type = 'text';
  input.value = original;
  input.className = 'bg-slate-950 border border-cyan-500 rounded px-1.5 py-0.5 text-xs text-white font-mono focus:outline-none w-[150px] sm:w-[220px] shadow-inner';
  let done = false;
  const finish = async (save) => {
    if (done) return;
    done = true;
    roomPillRenaming = false;
    if (save) await persistRoomRename(tab, input.value);
    renderConsoleTabs();
  };
  input.onkeydown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  };
  input.onblur = () => finish(true);
  input.onclick = (e) => e.stopPropagation();
  input.ondblclick = (e) => e.stopPropagation();
  nameEl.innerHTML = '';
  nameEl.appendChild(input);
  input.focus();
  input.select();
};

async function persistRoomRename(tab, rawName) {
  const newName = (rawName || '').trim().replace(ROOM_PREFIX_RE, '');
  if (!newName || newName === roomDisplayName(tab)) return;
  tab.title = `War Room: ${newName}`;
  try {
    await fetch(`/api/war-room/rooms/${encodeURIComponent(tab.roomId || 'general')}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName })
    });
  } catch (e) {
    console.error('Failed to persist war room name:', e);
  }
  const headerTitle = document.getElementById('warroom-header-title');
  if (headerTitle && tab.id === activeConsoleTabId) headerTitle.innerText = tab.title;
}

let roomSwitcherLoading = false;

async function refreshRoomLiveStates() {
  const fetchRoomsPromise = fetch('/api/war-room/rooms')
    .then(r => (r.ok ? r.json() : null))
    .then(d => {
      if (!d || !Array.isArray(d.rooms)) return;
      d.rooms.forEach(room => {
        roomActivity.orch[room.id] = room.orchestrator || null;
        const existing = consoleTabs.find(t => t.roomId === room.id);
        if (existing) {
          if (room.name && room.id !== 'general') existing.title = `War Room: ${room.name}`;
          if (room.participants) existing.participants = room.participants;
        } else if (room.id !== 'general') {
          consoleTabs.push({
            id: 'tab-warroom-' + room.id,
            type: 'warroom',
            title: `War Room: ${room.name}`,
            roomId: room.id,
            participants: room.participants || null,
            closable: true
          });
        }
      });
    })
    .catch(() => {});

  const fetchConcPromise = fetch('/api/war-room/concurrency')
    .then(r => (r.ok ? r.json() : null))
    .then(c => {
      if (!c) return;
      roomActivity.live.clear();
      (c.active_rooms || []).forEach(ar => {
        if (ar.busy) roomActivity.live.add(ar.id);
      });
    })
    .catch(async () => {
      const rooms = consoleTabs.filter(t => t.type === 'warroom').map(t => t.roomId || 'general');
      await Promise.all(rooms.map(async rid => {
        try {
          const r = await fetch(`/api/war-room/state?room_id=${encodeURIComponent(rid)}`);
          if (!r.ok) return;
          const s = await r.json();
          if (s.active) roomActivity.live.add(rid); else roomActivity.live.delete(rid);
        } catch (_) {}
      }));
    });

  await Promise.all([fetchRoomsPromise, fetchConcPromise]);
}

function ensureRoomSwitcherPanel() {
  let panel = document.getElementById('room-switcher-panel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'room-switcher-panel';
    panel.className = 'hidden fixed z-[70] bg-[#161b22] border border-slate-700 rounded-xl shadow-2xl font-mono text-xs backdrop-blur-md flex flex-col overflow-hidden';
    document.body.appendChild(panel);
  }
  return panel;
}

function positionRoomSwitcherPanel() {
  const panel = ensureRoomSwitcherPanel();
  const pill = document.getElementById('room-switcher-pill');
  if (window.innerWidth < 640 || !pill) {
    panel.style.left = '8px'; panel.style.right = '8px'; panel.style.top = 'auto';
    panel.style.bottom = '8px'; panel.style.width = 'auto'; panel.style.maxHeight = '70vh';
    panel.style.borderRadius = '16px';
  } else {
    const rect = pill.getBoundingClientRect();
    const width = 340;
    panel.style.width = width + 'px';
    panel.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)) + 'px';
    panel.style.right = 'auto'; panel.style.bottom = 'auto';
    panel.style.top = (rect.bottom + 6) + 'px';
    panel.style.maxHeight = Math.max(240, window.innerHeight - rect.bottom - 24) + 'px';
    panel.style.borderRadius = '12px';
  }
}

function renderRoomSwitcherPanel() {
  const panel = ensureRoomSwitcherPanel();
  const q = roomSwitcherQuery.trim().toLowerCase();
  const roomTabs = consoleTabs.filter(t => t.type === 'warroom');
  const rows = roomTabs.filter(t => !q || roomDisplayName(t).toLowerCase().includes(q));
  const hadFocusOnSearch = document.activeElement && document.activeElement.id === 'room-switcher-search';

  const rowsHtml = rows.map(t => {
    const rid = t.roomId || 'general';
    const isCurrent = t.id === activeConsoleTabId;
    const isLive = roomActivity.live.has(rid);
    const unread = roomActivity.unread[rid] || 0;
    const orch = roomActivity.orch[rid];
    const isGeneral = rid === 'general';
    const safeId = escRoomHtml(t.id);
    const renaming = roomSwitcherRenamingId === t.id;
    const nameHtml = renaming
      ? `<input id="room-switcher-rename-input" type="text" value="${escRoomHtml(roomDisplayName(t))}" class="flex-1 min-w-0 bg-slate-950 border border-cyan-500 rounded px-1.5 py-0.5 text-xs text-white focus:outline-none" onclick="event.stopPropagation()" />
         <span class="text-[8px] text-slate-500 shrink-0">↵ save · esc</span>`
      : `<span class="truncate ${isCurrent ? 'text-cyan-200 font-bold' : 'text-slate-200'}">${escRoomHtml(roomDisplayName(t))}</span>`;
    return `
      <div class="group flex items-center gap-2 px-2.5 py-1.5 rounded-lg cursor-pointer transition ${isCurrent ? 'bg-cyan-950/50 border border-cyan-700/60' : 'hover:bg-slate-800/80 border border-transparent'}"
           onclick="selectRoomFromSwitcher('${safeId}')">
        <span class="w-2 h-2 rounded-full shrink-0 ${isLive ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'}" title="${isLive ? 'Live' : 'Idle'}"></span>
        <div class="flex items-center gap-1.5 min-w-0 flex-1">${nameHtml}</div>
        ${!renaming && orch ? `<span class="text-[8px] px-1 py-0.5 rounded font-bold uppercase bg-amber-950 text-amber-300 border border-amber-700/80 shrink-0 truncate max-w-[90px]" title="Room Orchestrator: ${escRoomHtml(orch)}">👑 ${escRoomHtml(orch)}</span>` : ''}
        ${!renaming && unread > 0 ? `<span class="text-[9px] px-1.5 py-0.5 rounded-full font-bold bg-amber-500/20 text-amber-300 border border-amber-600/70 shrink-0">${unread} new</span>` : ''}
        ${!renaming && !isGeneral ? `
          <div class="flex items-center gap-0.5 shrink-0 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition">
            <button type="button" onclick="event.stopPropagation(); startRoomRenameInSwitcher('${safeId}')" class="p-1 rounded hover:bg-slate-700 text-slate-400 hover:text-cyan-300" title="Rename">✏️</button>
            <button type="button" onclick="event.stopPropagation(); deleteRoomFromSwitcher('${safeId}')" class="p-1 rounded hover:bg-slate-700 text-slate-400 hover:text-rose-400" title="Delete room">🗑</button>
          </div>` : ''}
      </div>`;
  }).join('');

  panel.innerHTML = `
    <div class="p-2 border-b border-slate-800">
      <input id="room-switcher-search" type="text" value="${escRoomHtml(roomSwitcherQuery)}" placeholder="🔍 Search rooms…" autocomplete="off"
             class="w-full bg-slate-950 border border-slate-700 focus:border-cyan-500 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none" />
    </div>
    <div class="flex-1 overflow-y-auto custom-scrollbar p-1.5 space-y-0.5" style="min-height:60px">
      ${rowsHtml || '<div class="py-4 text-center text-slate-500">No rooms match</div>'}
      ${roomSwitcherLoading && roomTabs.length <= 1 ? '<div class="py-2 text-center text-[10px] text-cyan-400/80 animate-pulse">Loading rooms...</div>' : ''}
    </div>
    <div class="p-1.5 border-t border-slate-800 flex items-center justify-between gap-2">
      <button type="button" onclick="closeRoomSwitcher(); toggleNewRoomDropdown()" class="px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-700 font-bold flex items-center gap-1 cursor-pointer"><span class="text-emerald-400">+</span> New Room</button>
      <span class="text-[9px] text-slate-500">Ctrl+K switch · Alt+↑/↓ cycle</span>
    </div>`;

  const search = document.getElementById('room-switcher-search');
  if (search) {
    search.oninput = () => {
      roomSwitcherQuery = search.value;
      const pos = search.selectionStart;
      renderRoomSwitcherPanel();
      const s2 = document.getElementById('room-switcher-search');
      if (s2) { s2.focus(); try { s2.setSelectionRange(pos, pos); } catch (_) {} }
    };
    search.onkeydown = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); closeRoomSwitcher(); }
      else if (e.key === 'Enter') {
        e.preventDefault();
        const first = consoleTabs.filter(t => t.type === 'warroom' && (!roomSwitcherQuery.trim() || roomDisplayName(t).toLowerCase().includes(roomSwitcherQuery.trim().toLowerCase())))[0];
        if (first) selectRoomFromSwitcher(first.id);
      }
    };
    if (hadFocusOnSearch || !roomSwitcherRenamingId) {
      if (!roomSwitcherRenamingId && hadFocusOnSearch === false && !panel.dataset.focused) {
        panel.dataset.focused = '1';
        search.focus();
      } else if (hadFocusOnSearch) {
        search.focus();
      }
    }
  }

  const rin = document.getElementById('room-switcher-rename-input');
  if (rin) {
    const tab = consoleTabs.find(t => t.id === roomSwitcherRenamingId);
    let done = false;
    const finish = async (save) => {
      if (done) return;
      done = true;
      roomSwitcherRenamingId = null;
      if (save && tab) await persistRoomRename(tab, rin.value);
      renderConsoleTabs();
      if (roomSwitcherOpen) renderRoomSwitcherPanel();
    };
    rin.onkeydown = (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    };
    rin.onblur = () => finish(true);
    rin.focus();
    rin.select();
  }
}

window.toggleRoomSwitcher = function(event) {
  if (event) event.stopPropagation();
  if (roomSwitcherOpen) closeRoomSwitcher(); else openRoomSwitcher();
};

async function openRoomSwitcher() {
  roomSwitcherOpen = true;
  roomSwitcherQuery = '';
  roomSwitcherRenamingId = null;
  roomSwitcherLoading = true;
  const panel = ensureRoomSwitcherPanel();
  delete panel.dataset.focused;
  panel.classList.remove('hidden');
  positionRoomSwitcherPanel();
  renderRoomSwitcherPanel();
  try {
    await refreshRoomLiveStates();
  } finally {
    roomSwitcherLoading = false;
  }
  if (roomSwitcherOpen) { renderRoomSwitcherPanel(); renderConsoleTabs(); }
}

function closeRoomSwitcher() {
  roomSwitcherOpen = false;
  roomSwitcherRenamingId = null;
  const panel = document.getElementById('room-switcher-panel');
  if (panel) { panel.classList.add('hidden'); delete panel.dataset.focused; }
}
window.closeRoomSwitcher = closeRoomSwitcher;

window.selectRoomFromSwitcher = function(tabId) {
  if (roomSwitcherRenamingId) return;
  closeRoomSwitcher();
  activateConsoleTab(tabId);
};

window.startRoomRenameInSwitcher = function(tabId) {
  roomSwitcherRenamingId = tabId;
  renderRoomSwitcherPanel();
};

let pendingDeleteTab = null;

window.openDeleteWarRoomModal = async function(tabId) {
  const tab = consoleTabs.find(t => t.id === tabId);
  if (!tab || !tab.closable || (tab.roomId || 'general') === 'general') {
    alert('The default General War Room cannot be deleted.');
    return;
  }
  pendingDeleteTab = tab;
  const modal = document.getElementById('modal-delete-warroom');
  if (!modal) return;
  const rid = tab.roomId || 'general';
  const nameEl = document.getElementById('del-wr-room-name');
  const idEl = document.getElementById('del-wr-room-id');
  const statsEl = document.getElementById('del-wr-stats');
  const statusBox = document.getElementById('del-wr-status-box');
  const confirmBtn = document.getElementById('del-wr-confirm-btn');
  const cancelBtn = document.getElementById('del-wr-cancel-btn');

  if (nameEl) nameEl.innerText = roomDisplayName(tab);
  if (idEl) idEl.innerText = rid;
  if (statsEl) statsEl.innerText = 'Loading preview…';
  if (statusBox) statusBox.classList.add('hidden');
  if (confirmBtn) confirmBtn.disabled = false;
  if (cancelBtn) cancelBtn.disabled = false;

  modal.classList.remove('hidden');
  if (roomSwitcherOpen) closeRoomSwitcher();

  try {
    const res = await fetch(`/api/war-room/rooms/${encodeURIComponent(rid)}/delete-preview`);
    if (res.ok && statsEl) {
      const p = await res.json();
      const s = p.sandbox_stats || {};
      statsEl.innerText = `${p.message_count || 0} msgs · ${s.total_mb || 0} MB (${s.deliverables_count || 0} deliverables, ${s.scratch_count || 0} scratch)`;
    }
  } catch (_) {
    if (statsEl) statsEl.innerText = 'Preview unavailable';
  }
};

window.closeDeleteWarRoomModal = function() {
  const modal = document.getElementById('modal-delete-warroom');
  if (modal) modal.classList.add('hidden');
  pendingDeleteTab = null;
};

window.confirmArchiveAndDeleteWarRoom = async function() {
  if (!pendingDeleteTab) return;
  const tab = pendingDeleteTab;
  const rid = tab.roomId || 'general';
  const pruneScratch = Boolean(document.getElementById('del-wr-prune-scratch')?.checked);
  const pruneDups = Boolean(document.getElementById('del-wr-prune-dups')?.checked);
  const keepLast3 = Boolean(document.getElementById('del-wr-keep-3')?.checked);
  const statusBox = document.getElementById('del-wr-status-box');
  const statusText = document.getElementById('del-wr-status-text');
  const confirmBtn = document.getElementById('del-wr-confirm-btn');
  const cancelBtn = document.getElementById('del-wr-cancel-btn');

  if (statusBox) statusBox.classList.remove('hidden');
  if (statusText) statusText.innerText = '1. Summarizing → 2. Pruning → 3. Zipping → 4. Deleting…';
  if (confirmBtn) confirmBtn.disabled = true;
  if (cancelBtn) cancelBtn.disabled = true;

  try {
    const res = await fetch(`/api/war-room/rooms/${encodeURIComponent(rid)}/archive-and-delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prune_scratch: pruneScratch,
        prune_duplicates: pruneDups,
        keep_last_versions: keepLast3 ? 3 : null
      })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.detail || `HTTP ${res.status}`);
    }
    closeDeleteWarRoomModal();

    // Remove tab locally & switch to General
    const idx = consoleTabs.findIndex(t => t.id === tab.id);
    if (idx !== -1) consoleTabs.splice(idx, 1);
    saveConsoleTabs();
    if (activeConsoleTabId === tab.id) {
      const fallback = consoleTabs[0];
      if (fallback) await switchConsoleTab(fallback.id);
    }
    renderConsoleTabs();

    const msg = `Archived to ${data.archive_path || '/home/nexus_shared/archives/'} (${data.archive_size_mb || 0} MB, pruned ${data.pruned_files || 0} files) and deleted room "${roomDisplayName(tab)}".`;
    if (typeof showToast === 'function') showToast(msg, 'success');
    else alert(msg);
  } catch (err) {
    if (statusText) statusText.innerText = `Error: ${err.message}`;
    if (confirmBtn) confirmBtn.disabled = false;
    if (cancelBtn) cancelBtn.disabled = false;
  }
};

window.deleteRoomFromSwitcher = function(tabId) {
  openDeleteWarRoomModal(tabId);
};

window.deleteActiveWarRoom = function() {
  const activeTab = consoleTabs.find(t => t.id === activeConsoleTabId);
  if (!activeTab) return;
  openDeleteWarRoomModal(activeTab.id);
};

// Live / unread / orchestrator tracking fed from the WebSocket handler
window.roomSwitcherNote = function(payload) {
  if (!payload || !payload.type) return;
  const rid = (payload.data && payload.data.room_id) || 'general';
  if (payload.type === 'war_room_speaker_start') {
    roomActivity.live.add(rid);
  } else if (payload.type === 'war_room_speaker_stop') {
    if ((payload.data && payload.data.agent) === 'all') roomActivity.live.delete(rid);
    else {
      fetch(`/api/war-room/state?room_id=${encodeURIComponent(rid)}`).then(r => r.ok ? r.json() : null).then(s => {
        if (!s) return;
        if (s.active) roomActivity.live.add(rid); else roomActivity.live.delete(rid);
        renderConsoleTabs();
      }).catch(() => {});
    }
  } else if (payload.type === 'war_room_message') {
    const isOpenRoom = (rid === activeWarRoomId) && (typeof currentConsoleMode !== 'undefined' && currentConsoleMode === 'warroom');
    if (!isOpenRoom && payload.data && payload.data.sender_type === 'agent') {
      roomActivity.unread[rid] = (roomActivity.unread[rid] || 0) + 1;
    }
  } else if (payload.type === 'war_room_room_orchestrator_updated') {
    roomActivity.orch[rid] = payload.data ? (payload.data.orchestrator || null) : null;
  }
};

// Global shortcuts + outside-click close
document.addEventListener('click', (e) => {
  if (!roomSwitcherOpen) return;
  const panel = document.getElementById('room-switcher-panel');
  const pill = document.getElementById('room-switcher-pill');
  if ((panel && panel.contains(e.target)) || (pill && pill.contains(e.target))) return;
  closeRoomSwitcher();
});
window.addEventListener('resize', () => { if (roomSwitcherOpen) positionRoomSwitcherPanel(); });
document.addEventListener('keydown', (e) => {
  const consoleTab = document.getElementById('tab-console');
  if (!consoleTab || consoleTab.classList.contains('hidden')) return;
  if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
    e.preventDefault();
    if (roomSwitcherOpen) closeRoomSwitcher(); else openRoomSwitcher();
  } else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
    const rooms = consoleTabs.filter(t => t.type === 'warroom');
    if (rooms.length < 2) return;
    e.preventDefault();
    const idx = rooms.findIndex(t => t.id === activeConsoleTabId);
    const next = rooms[(idx + (e.key === 'ArrowDown' ? 1 : -1) + rooms.length) % rooms.length];
    activateConsoleTab(next.id);
  } else if (e.key === 'Escape' && roomSwitcherOpen && !roomSwitcherRenamingId) {
    closeRoomSwitcher();
  }
});

let lastTabTapId = null;
let lastTabTapTime = 0;

window.handleConsoleTabClick = function(event, tabId) {
  const now = Date.now();
  const tab = consoleTabs.find(t => t.id === tabId);
  if (tab && tab.type === 'warroom') {
    // Check if user tapped the already active tab, or double-tapped within 400ms
    if ((tabId === activeConsoleTabId && (now - lastTabTapTime < 500 || now - lastTabTapTime > 600)) || (lastTabTapId === tabId && (now - lastTabTapTime < 450))) {
      startEditingConsoleTabTitle(tabId);
      lastTabTapTime = 0;
      return;
    }
  }
  lastTabTapId = tabId;
  lastTabTapTime = now;
  activateConsoleTab(tabId);
};

window.startEditingConsoleTabTitle = function(tabId) {
  const tab = consoleTabs.find(t => t.id === tabId);
  if (!tab || tab.type !== 'warroom') return;

  const titleEl = document.getElementById(`tab-title-text-${tabId}`);
  if (!titleEl || titleEl.querySelector('input')) return;

  const currentText = tab.title;
  const input = document.createElement('input');
  input.type = 'text';
  input.value = currentText;
  input.className = 'bg-slate-950 border border-cyan-500 rounded px-1.5 py-0.5 text-xs text-white font-mono focus:outline-none max-w-[120px] sm:max-w-[150px] shadow-inner';

  let isCommitting = false;
  const commitChange = async () => {
    if (isCommitting) return;
    isCommitting = true;
    const newName = input.value.trim() || currentText;
    if (newName !== currentText) {
      tab.title = newName;
      const roomId = tab.roomId || 'general';
      try {
        await fetch(`/api/war-room/rooms/${encodeURIComponent(roomId)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: newName })
        });
      } catch (e) {
        console.error('Failed to persist war room name:', e);
      }
    }
    renderConsoleTabs();
    const headerTitle = document.getElementById('warroom-header-title');
    if (headerTitle && tab.id === activeConsoleTabId) {
      headerTitle.innerText = tab.title;
    }
  };

  input.onkeydown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitChange();
    } else if (e.key === 'Escape') {
      isCommitting = true;
      renderConsoleTabs();
    }
  };

  input.onblur = commitChange;
  input.onclick = (e) => e.stopPropagation();

  titleEl.innerHTML = '';
  titleEl.appendChild(input);
  input.focus();
  input.select();
};

function activateConsoleTab(tabId) {
  const tab = consoleTabs.find(t => t.id === tabId);
  if (!tab) return;
  activeConsoleTabId = tab.id;

  if (tab.type === 'warroom') {
    activeWarRoomId = tab.roomId || 'general';
    if (typeof roomActivity !== 'undefined') roomActivity.unread[activeWarRoomId] = 0;
    switchConsoleMode('warroom', false);
    const headerTitle = document.getElementById('warroom-header-title');
    const headerBadge = document.getElementById('warroom-header-room-badge');
    const subnavBadge = document.getElementById('warroom-subnav-room-badge');
    const rName = (tab.roomId || 'general').toUpperCase();
    if (headerTitle) headerTitle.innerText = tab.title;
    if (headerBadge) headerBadge.innerText = rName;
    if (subnavBadge) subnavBadge.innerText = rName;
    loadWarRoomMessages(activeWarRoomId);
    loadWarRoomSandboxStats(activeWarRoomId);
    // BL-WAR-32: Synchronize reasoning status banner for the newly activated war room
    syncSpeakerBannerVisibility();
  } else {
    // Direct chat tab
    switchConsoleMode('direct', false);
    if (tab.agent && typeof agents !== 'undefined' && Array.isArray(agents)) {
      const target = agents.find(a => a.name.toLowerCase() === tab.agent.toLowerCase());
      if (target && typeof selectAgent === 'function') {
        selectAgent(target);
      }
    }
  }
  renderConsoleTabs();
  // Ensure the activated tab is scrolled into view smoothly
  setTimeout(() => {
    const activeTabEl = document.querySelector(`[onclick*="activateConsoleTab('${tab.id}')"]`);
    if (activeTabEl && typeof activeTabEl.scrollIntoView === 'function') {
      activeTabEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    }
  }, 50);
}

function switchConsoleMode(mode, syncTab = true) {
  currentConsoleMode = mode;
  const viewDirect = document.getElementById('console-direct-view');
  const viewWarroom = document.getElementById('console-warroom-view');
  const metaText = document.getElementById('console-subnav-meta-text');

  if (mode === 'warroom') {
    if (viewDirect) {
      viewDirect.classList.add('hidden');
      viewDirect.style.display = 'none';
    }
    if (viewWarroom) {
      viewWarroom.classList.remove('hidden');
      viewWarroom.style.display = 'flex';
    }
    if (metaText) metaText.innerText = 'Boardroom Bus • Multi-Agent Discussion';

    // Clear any orphan direct-chat timer when navigating away to war room
    if (activeDirectChatTimerInterval) {
      clearInterval(activeDirectChatTimerInterval);
      activeDirectChatTimerInterval = null;
    }
    const chatBanner = document.getElementById('chat-status-banner');
    if (chatBanner) chatBanner.classList.add('hidden');

    loadWarRoomParticipants();

    if (syncTab) {
      const activeTab = consoleTabs.find(t => t.id === activeConsoleTabId);
      if (!activeTab || activeTab.type !== 'warroom') {
        const warTab = consoleTabs.find(t => t.type === 'warroom') || consoleTabs[1];
        if (warTab) {
          activeConsoleTabId = warTab.id;
          activeWarRoomId = warTab.roomId || 'general';
        }
      }
      const headerTitle = document.getElementById('warroom-header-title');
      const headerBadge = document.getElementById('warroom-header-room-badge');
      const subnavBadge = document.getElementById('warroom-subnav-room-badge');
      const currentTab = consoleTabs.find(t => t.id === activeConsoleTabId);
      const rName = (activeWarRoomId || 'general').toUpperCase();
      if (headerTitle && currentTab) headerTitle.innerText = currentTab.title;
      if (headerBadge) headerBadge.innerText = rName;
      if (subnavBadge) subnavBadge.innerText = rName;
      loadWarRoomMessages(activeWarRoomId);
      loadWarRoomSandboxStats(activeWarRoomId);
    }

    // Animate canvas agents walking into Room 2
    if (typeof gatherAgentsToConferenceTable === 'function') {
      gatherAgentsToConferenceTable();
    }
  } else {
    // Direct 1-on-1 Chat Mode
    if (viewWarroom) {
      viewWarroom.classList.add('hidden');
      viewWarroom.style.display = 'none';
    }
    if (viewDirect) {
      viewDirect.classList.remove('hidden');
      viewDirect.style.display = '';
    }
    if (metaText) metaText.innerText = 'Single Agent Direct Memory Session';

    if (syncTab) {
      const activeTab = consoleTabs.find(t => t.id === activeConsoleTabId);
      if (!activeTab || activeTab.type !== 'direct') {
        const dirTab = consoleTabs.find(t => t.type === 'direct') || consoleTabs[0];
        if (dirTab) {
          activeConsoleTabId = dirTab.id;
          if (dirTab.agent && typeof agents !== 'undefined' && Array.isArray(agents)) {
            const target = agents.find(a => a.name.toLowerCase() === dirTab.agent.toLowerCase());
            if (target && typeof selectAgent === 'function') selectAgent(target);
          }
        }
      }
    }

    // Animate canvas agents returning to bullpen desks
    if (typeof dismissAgentsFromConferenceTable === 'function') {
      dismissAgentsFromConferenceTable();
    }
  }
  renderConsoleTabs();
}
