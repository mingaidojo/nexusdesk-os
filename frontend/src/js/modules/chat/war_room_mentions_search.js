/**
 * @module chat/war_room_mentions_search.js
 * @description War Room @Mention Autocomplete & Transcript Search.
 * Provides interactive `@mention` autocomplete popover, textarea auto-resize,
 * operator yield banner dismissal, and War Room message search/highlight.
 *
 * Part of the Console & War Room chat subsystem (concatenated globally by frontend/build.py).
 */

// --- BL-CHAT-24: Interactive @Mention Autocomplete Popover ---
let warRoomAutocompleteCandidates = [];
let warRoomAutocompleteIndex = 0;

function getMentionAutocompleteOptions(query) {
  const q = (query || '').toLowerCase();
  const baseOptions = [
    { tag: 'everyone', label: '@everyone', desc: 'Broadcast directive to all core War Room panelists', badge: 'BROADCAST', color: '#818cf8' },
    { tag: 'everyagents', label: '@everyagents', desc: 'Consult all specialist agents across fleets', badge: 'ALL AGENTS', color: '#c084fc' },
    { tag: 'user', label: '@user', desc: 'Address Human Operator (Min) / Request decision', badge: 'OPERATOR', color: '#34d399' }
  ];

  const participants = getEffectiveWarRoomParticipants();
  participants.forEach(p => {
    baseOptions.push({
      tag: p.name,
      label: `@${p.name}`,
      desc: p.role || 'Autonomous Fleet Specialist',
      badge: (p.engine || 'hermes').toUpperCase(),
      color: p.color || '#38bdf8'
    });
  });

  return baseOptions.filter(opt =>
    opt.tag.toLowerCase().startsWith(q) ||
    opt.label.toLowerCase().includes(q) ||
    opt.desc.toLowerCase().includes(q)
  );
}

function handleWarRoomInputChange(e) {
  if (e && e.isComposing) return;
  const input = e.target;
  const popover = document.getElementById('warroom-mention-popover');
  if (!input || !popover) return;

  const cursorPos = input.selectionStart || input.value.length;
  const textBeforeCursor = input.value.slice(0, cursorPos);
  const match = textBeforeCursor.match(/(?:^|\s)@([a-zA-Z0-9_\-]*)$/);

  if (!match) {
    popover.classList.add('hidden');
    return;
  }

  const query = match[1] || '';
  warRoomAutocompleteCandidates = getMentionAutocompleteOptions(query);
  warRoomAutocompleteIndex = 0;

  if (warRoomAutocompleteCandidates.length === 0) {
    popover.classList.add('hidden');
    return;
  }

  renderWarRoomMentionPopover();
  popover.classList.remove('hidden');
}

function renderWarRoomMentionPopover() {
  const popover = document.getElementById('warroom-mention-popover');
  if (!popover) return;
  popover.innerHTML = `<div class="px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-slate-400 border-b border-slate-800">Omnidirectional @Mentions (↑/↓/Tab/Enter)</div>`;

  warRoomAutocompleteCandidates.forEach((cand, idx) => {
    const isActive = idx === warRoomAutocompleteIndex;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.onmousedown = (ev) => {
      ev.preventDefault();
      applyWarRoomMentionAutocomplete(cand.tag);
    };
    btn.className = `w-full text-left px-2.5 py-1.5 rounded-lg flex items-center justify-between gap-2 transition cursor-pointer ${isActive ? 'bg-cyan-950/90 border border-cyan-600/70 text-white' : 'hover:bg-slate-800/80 text-slate-300 border border-transparent'}`;
    btn.innerHTML = `
      <div class="min-w-0 flex-1">
        <div class="font-bold text-[11px] flex items-center gap-1.5" style="color: ${cand.color}">${cand.label}</div>
        <div class="text-[9px] text-slate-400 truncate">${cand.desc}</div>
      </div>
      <span class="text-[8px] font-mono px-1.5 py-0.5 rounded bg-slate-950 border border-slate-700 text-slate-300 shrink-0">${cand.badge}</span>
    `;
    popover.appendChild(btn);
  });
}

function applyWarRoomMentionAutocomplete(tag) {
  const input = document.getElementById('warroom-text-input');
  const popover = document.getElementById('warroom-mention-popover');
  if (!input) return;

  const cursorPos = input.selectionStart || input.value.length;
  const textBefore = input.value.slice(0, cursorPos);
  const textAfter = input.value.slice(cursorPos);

  const replacedBefore = textBefore.replace(/(^|\s)@([a-zA-Z0-9_\-]*)$/, `$1@${tag} `);
  input.value = replacedBefore + textAfter;
  if (popover) popover.classList.add('hidden');
  input.focus();
}

function handleWarRoomInputKeydown(e) {
  const popover = document.getElementById('warroom-mention-popover');
  const popoverOpen = popover && !popover.classList.contains('hidden') && warRoomAutocompleteCandidates.length > 0;

  if (popoverOpen) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      warRoomAutocompleteIndex = (warRoomAutocompleteIndex + 1) % warRoomAutocompleteCandidates.length;
      renderWarRoomMentionPopover();
      return;
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      warRoomAutocompleteIndex = (warRoomAutocompleteIndex - 1 + warRoomAutocompleteCandidates.length) % warRoomAutocompleteCandidates.length;
      renderWarRoomMentionPopover();
      return;
    } else if (e.key === 'Tab' || e.key === 'Enter') {
      e.preventDefault();
      const chosen = warRoomAutocompleteCandidates[warRoomAutocompleteIndex];
      if (chosen) applyWarRoomMentionAutocomplete(chosen.tag);
      return;
    } else if (e.key === 'Escape') {
      e.preventDefault();
      popover.classList.add('hidden');
      return;
    }
  }

  // Shift+Enter: Interrupt running agent immediately (BL-WAR-38)
  if (e.key === 'Enter' && e.shiftKey) {
    e.preventDefault();
    if (typeof window.handleWarRoomInterruptClick === 'function') {
      window.handleWarRoomInterruptClick();
    } else if (typeof handleWarRoomInterruptClick === 'function') {
      handleWarRoomInterruptClick();
    } else {
      sendWarRoomChat();
    }
    return;
  }

  // Ctrl+Enter or Cmd+Enter: Send or Queue Next Directive
  if ((e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
    e.preventDefault();
    sendWarRoomChat();
    return;
  }
}

window.autoResizeTextarea = function(el, ev) {
  if (!el) return;
  if (!el._imeResizeBound) {
    el._imeResizeBound = true;
    el.addEventListener('compositionend', () => window.autoResizeTextarea(el));
  }
  // Never mutate textarea height synchronously during active IME composition
  if (ev && ev.isComposing) return;

  const val = el.value || '';
  const minH = el.id === 'warroom-text-input' ? 42 : 38;
  const maxH = el.id === 'warroom-text-input' ? 140 : 130;

  if (!val) {
    if (el._lastAutoHeight && el._lastAutoHeight !== minH) {
      el.style.height = minH + 'px';
      el._lastAutoHeight = minH;
    }
    return;
  }

  // Fast path: if single-line and not overflowing current box, avoid collapsing height = 'auto'
  // on every keystroke so mobile/OS IME InputConnection never drops punctuation like 'https://' or '...'
  const curH = el._lastAutoHeight || el.clientHeight || minH;
  if (!val.includes('\n') && curH <= minH + 4 && el.scrollHeight <= el.clientHeight + 2) {
    return;
  }

  el.style.height = 'auto';
  const newHeight = Math.min(Math.max(el.scrollHeight, minH), maxH);
  el.style.height = newHeight + 'px';
  el._lastAutoHeight = newHeight;
};

function dismissWarRoomUserAlert() {
  const alertBanner = document.getElementById('warroom-user-alert-banner');
  if (alertBanner) alertBanner.classList.add('hidden');
  const input = document.getElementById('warroom-text-input');
  if (input) input.focus();
}

// =========================================================================
// BL-UI-61: War Room Conversation Search & Transcript Filtering
// =========================================================================
let warRoomSearchQuery = '';
let warRoomSearchMatches = [];
let warRoomSearchCurrentIdx = -1;

function handleWarRoomSearch(val) {
  warRoomSearchQuery = (val || '').trim().toLowerCase();
  const controls = document.getElementById('warroom-search-controls');
  const counter = document.getElementById('warroom-search-counter');
  const container = document.getElementById('warroom-conversation');
  if (!container) return;

  // Clear previous match classes
  const allBubbles = container.querySelectorAll('.warroom-search-matched, .warroom-search-active');
  allBubbles.forEach(b => {
    b.classList.remove('warroom-search-matched', 'warroom-search-active', 'ring-2', 'ring-amber-500/80', 'ring-cyan-400', 'shadow-[0_0_15px_rgba(245,158,11,0.3)]', 'shadow-[0_0_18px_rgba(6,182,212,0.45)]');
  });

  warRoomSearchMatches = [];
  warRoomSearchCurrentIdx = -1;

  if (!warRoomSearchQuery) {
    if (controls) controls.classList.add('hidden');
    return;
  }

  if (controls) controls.classList.remove('hidden');

  // Search all direct child message bubbles in war room conversation
  const bubbles = Array.from(container.children);
  bubbles.forEach(b => {
    const text = (b._rawText || b.innerText || '').toLowerCase();
    if (text.includes(warRoomSearchQuery)) {
      warRoomSearchMatches.push(b);
      b.classList.add('warroom-search-matched', 'ring-2', 'ring-amber-500/80', 'shadow-[0_0_15px_rgba(245,158,11,0.3)]');
    }
  });

  if (warRoomSearchMatches.length > 0) {
    warRoomSearchCurrentIdx = warRoomSearchMatches.length - 1; // start on latest match
    highlightCurrentSearchMatch(true);
  } else {
    if (counter) {
      counter.innerText = '0/0';
      counter.className = 'text-rose-400 font-bold text-[9.5px] px-0.5';
    }
  }
}

function highlightCurrentSearchMatch(shouldScroll = true) {
  const counter = document.getElementById('warroom-search-counter');
  if (warRoomSearchMatches.length === 0 || warRoomSearchCurrentIdx < 0) {
    if (counter) {
      counter.innerText = '0/0';
      counter.className = 'text-slate-500 font-bold text-[9.5px] px-0.5';
    }
    return;
  }

  // Remove active ring from all matches, retain matched ring
  warRoomSearchMatches.forEach(b => {
    b.classList.remove('warroom-search-active', 'ring-cyan-400', 'shadow-[0_0_18px_rgba(6,182,212,0.45)]');
    b.classList.add('warroom-search-matched', 'ring-2', 'ring-amber-500/80', 'shadow-[0_0_15px_rgba(245,158,11,0.3)]');
  });

  const currentEl = warRoomSearchMatches[warRoomSearchCurrentIdx];
  if (currentEl) {
    currentEl.classList.remove('ring-amber-500/80', 'shadow-[0_0_15px_rgba(245,158,11,0.3)]');
    currentEl.classList.add('warroom-search-active', 'ring-2', 'ring-cyan-400', 'shadow-[0_0_18px_rgba(6,182,212,0.45)]');
    if (shouldScroll) {
      currentEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  if (counter) {
    counter.innerText = `${warRoomSearchCurrentIdx + 1}/${warRoomSearchMatches.length}`;
    counter.className = 'text-cyan-400 font-bold text-[9.5px] px-0.5';
  }
}

function navigateWarRoomSearch(direction = 1) {
  if (warRoomSearchMatches.length === 0) return;
  warRoomSearchCurrentIdx += direction;
  if (warRoomSearchCurrentIdx >= warRoomSearchMatches.length) {
    warRoomSearchCurrentIdx = 0;
  } else if (warRoomSearchCurrentIdx < 0) {
    warRoomSearchCurrentIdx = warRoomSearchMatches.length - 1;
  }
  highlightCurrentSearchMatch(true);
}

function handleWarRoomSearchKeydown(e) {
  if (e.key === 'Enter') {
    e.preventDefault();
    navigateWarRoomSearch(e.shiftKey ? -1 : 1);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    clearWarRoomSearch();
  }
}

function clearWarRoomSearch() {
  const input = document.getElementById('warroom-search-input');
  if (input) {
    input.value = '';
  }
  handleWarRoomSearch('');
  if (input) input.blur();
}

// Ctrl+F or Cmd+F shortcut to focus War Room search when in War Room mode
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
    if (typeof currentConsoleMode !== 'undefined' && currentConsoleMode === 'warroom') {
      const searchInput = document.getElementById('warroom-search-input');
      if (searchInput) {
        e.preventDefault();
        searchInput.focus();
        searchInput.select();
      }
    }
  }
});

window.handleWarRoomSearch = handleWarRoomSearch;
window.navigateWarRoomSearch = navigateWarRoomSearch;
window.handleWarRoomSearchKeydown = handleWarRoomSearchKeydown;
window.clearWarRoomSearch = clearWarRoomSearch;
