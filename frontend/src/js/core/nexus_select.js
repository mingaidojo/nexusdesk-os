/**
 * @module core/nexus_select.js
 * @description Unified NexusDesk Custom Select & Oceanic Glass Popover Enhancer.
 * Upgrades every native `<select>` across the UI with a sleek, Obsidian-Oceanic
 * trigger button and viewport-aware glass listbox popover while preserving 100%
 * compatibility with `.value`, `.selectedIndex`, `onchange`, dynamic `<option>`
 * mutations, `disabled`/`hidden` attributes, and HTML5 form validation.
 */
(function () {
  const POPOVER_ID = 'nexus-select-popover';
  let activeSelectEl = null;
  let activeTriggerEl = null;
  let activeCleanup = null;
  let rootObserver = null;
  let rafQueue = new Set();
  let rafScheduled = false;

  // Preserve original HTMLSelectElement property descriptors so JS assignments stay reactive
  const selectProto = typeof HTMLSelectElement !== 'undefined' ? HTMLSelectElement.prototype : null;
  const origValueDesc = selectProto ? Object.getOwnPropertyDescriptor(selectProto, 'value') : null;
  const origIdxDesc = selectProto ? Object.getOwnPropertyDescriptor(selectProto, 'selectedIndex') : null;

  if (selectProto && origValueDesc && origValueDesc.configurable) {
    Object.defineProperty(selectProto, 'value', {
      configurable: true,
      enumerable: origValueDesc.enumerable,
      get() {
        return origValueDesc.get.call(this);
      },
      set(val) {
        origValueDesc.set.call(this, val);
        if (typeof this._nexusSyncUi === 'function') this._nexusSyncUi();
      }
    });
  }

  if (selectProto && origIdxDesc && origIdxDesc.configurable) {
    Object.defineProperty(selectProto, 'selectedIndex', {
      configurable: true,
      enumerable: origIdxDesc.enumerable,
      get() {
        return origIdxDesc.get.call(this);
      },
      set(val) {
        origIdxDesc.set.call(this, val);
        if (typeof this._nexusSyncUi === 'function') this._nexusSyncUi();
      }
    });
  }

  function escHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function extractTriggerLayoutClasses(sel) {
    const raw = (sel.getAttribute('class') || '').split(/\s+/).filter(Boolean);
    const keepPrefixes = [
      'w-', 'min-w-', 'max-w-', 'h-', 'min-h-', 'max-h-', 'flex-', 'shrink', 'grow',
      'mt-', 'mb-', 'mr-', 'ml-', 'my-', 'mx-', 'col-span-', 'self-', 'justify-'
    ];
    const keepExact = new Set(['hidden', 'block', 'inline-block', 'flex', 'inline-flex', 'truncate', 'font-mono', 'font-sans', 'font-semibold', 'font-bold']);
    const textAndRadius = [];
    const layout = [];
    let isTransparent = false;
    let customBorder = '';
    let customTextColor = '';
    let customPad = [];

    raw.forEach((cls) => {
      if (cls === 'bg-transparent') isTransparent = true;
      if (keepExact.has(cls) || keepPrefixes.some((p) => cls.startsWith(p))) {
        layout.push(cls);
      } else if (/^text-(xs|sm|base|\[.+\])$/.test(cls)) {
        textAndRadius.push(cls);
      } else if (/^text-(slate|cyan|emerald|amber|rose|indigo|purple|sky|white|#)/.test(cls)) {
        customTextColor = cls;
      } else if (/^rounded/.test(cls)) {
        textAndRadius.push(cls);
      } else if (/^(p|px|py|pl|pr)-/.test(cls)) {
        customPad.push(cls);
      } else if (/^border-(amber|cyan|emerald|indigo|rose|purple|\[#30363d\])/.test(cls)) {
        customBorder = cls;
      }
    });

    return { layout, textAndRadius, isTransparent, customBorder, customTextColor, customPad };
  }

  function getSelectedOptionText(sel) {
    const idx = sel.selectedIndex;
    const opt = idx >= 0 && sel.options[idx] ? sel.options[idx] : sel.options[0];
    return opt ? (opt.textContent || opt.label || opt.value || '').trim() : 'Select...';
  }

  function syncSelectUi(sel) {
    const btn = sel._nexusTrigger;
    if (!btn) return;
    const labelEl = btn.querySelector('.nexus-select-label');
    const txt = getSelectedOptionText(sel);
    if (labelEl) labelEl.textContent = txt || 'Select...';

    const isHidden = sel.classList.contains('hidden');
    btn.classList.toggle('hidden', isHidden);
    btn.disabled = !!sel.disabled;
    btn.classList.toggle('opacity-50', !!sel.disabled);
    btn.classList.toggle('cursor-not-allowed', !!sel.disabled);
    if (sel.title) btn.title = sel.title;
    else if (txt) btn.title = txt;

    // Mirror subtle border-color overrides if JS updated classes on select
    btn.setAttribute('aria-disabled', sel.disabled ? 'true' : 'false');
  }

  function scheduleSync(sel) {
    rafQueue.add(sel);
    if (rafScheduled) return;
    rafScheduled = true;
    requestAnimationFrame(() => {
      rafScheduled = false;
      const items = Array.from(rafQueue);
      rafQueue.clear();
      items.forEach((s) => {
        if (document.contains(s)) syncSelectUi(s);
      });
    });
  }

  window.closeNexusSelectPopover = function () {
    const pop = document.getElementById(POPOVER_ID);
    if (pop) pop.remove();
    if (activeTriggerEl) {
      activeTriggerEl.setAttribute('aria-expanded', 'false');
      activeTriggerEl.classList.remove('nexus-select-open');
    }
    if (activeCleanup) {
      activeCleanup();
      activeCleanup = null;
    }
    activeSelectEl = null;
    activeTriggerEl = null;
  };

  function collectSelectEntries(sel) {
    const entries = [];
    Array.from(sel.children).forEach((child) => {
      if (child.tagName === 'OPTGROUP') {
        entries.push({ type: 'group', label: child.label || 'Group' });
        Array.from(child.children).forEach((opt) => {
          if (opt.tagName === 'OPTION') {
            entries.push({
              type: 'option',
              index: opt.index,
              value: opt.value,
              text: (opt.textContent || opt.label || opt.value || '').trim(),
              title: opt.title || '',
              disabled: !!opt.disabled || !!child.disabled,
              selected: opt.index === sel.selectedIndex
            });
          }
        });
      } else if (child.tagName === 'OPTION') {
        entries.push({
          type: 'option',
          index: child.index,
          value: child.value,
          text: (child.textContent || child.label || child.value || '').trim(),
          title: child.title || '',
          disabled: !!child.disabled,
          selected: child.index === sel.selectedIndex
        });
      }
    });
    return entries;
  }

  function selectOptionAndEmit(sel, optIndex, focusTrigger = true) {
    const prevIdx = sel.selectedIndex;
    origIdxDesc ? origIdxDesc.set.call(sel, optIndex) : (sel.selectedIndex = optIndex);
    syncSelectUi(sel);
    const trig = sel._nexusTrigger;
    window.closeNexusSelectPopover();
    if (prevIdx !== optIndex) {
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      sel.dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (focusTrigger && trig) trig.focus();
  }

  function openNexusSelectPopover(sel, triggerBtn) {
    if (sel.disabled) return;
    if (activeSelectEl === sel && document.getElementById(POPOVER_ID)) {
      window.closeNexusSelectPopover();
      return;
    }
    window.closeNexusSelectPopover();

    activeSelectEl = sel;
    activeTriggerEl = triggerBtn;
    triggerBtn.setAttribute('aria-expanded', 'true');
    triggerBtn.classList.add('nexus-select-open');

    const entries = collectSelectEntries(sel);
    const optEntries = entries.filter((e) => e.type === 'option');
    const showSearch = optEntries.length > 9;

    const pop = document.createElement('div');
    pop.id = POPOVER_ID;
    pop.className = 'nexus-popover-menu fixed z-[10050] flex flex-col overflow-hidden';
    pop.setAttribute('role', 'listbox');

    const searchHtml = showSearch
      ? `<div class="px-2 pt-2 pb-1.5 border-b border-slate-800/90 bg-[#090d14]/80">
           <input type="text" class="nexus-select-search w-full px-2.5 py-1.5 text-[11px] font-mono bg-[#0d1117] border border-slate-700/80 rounded-lg text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyan-500/80" placeholder="🔍 Filter options..." autocomplete="off" />
         </div>`
      : '';

    pop.innerHTML = `
      ${searchHtml}
      <div class="nexus-select-list max-h-64 overflow-y-auto custom-scrollbar p-1.5 space-y-0.5"></div>
    `;

    document.body.appendChild(pop);

    const listEl = pop.querySelector('.nexus-select-list');
    const searchEl = pop.querySelector('.nexus-select-search');
    let focusedOptionIdx = Math.max(0, optEntries.findIndex((o) => o.selected && !o.disabled));

    const renderList = (query = '') => {
      const q = query.trim().toLowerCase();
      listEl.innerHTML = '';
      let renderedCount = 0;
      let visibleButtons = [];

      entries.forEach((entry) => {
        if (entry.type === 'group') {
          const hdr = document.createElement('div');
          hdr.className = 'px-2.5 pt-2 pb-1 text-[9px] font-mono font-bold uppercase tracking-wider text-slate-500 select-none';
          hdr.textContent = entry.label;
          listEl.appendChild(hdr);
          return;
        }
        if (q && !entry.text.toLowerCase().includes(q) && !entry.value.toLowerCase().includes(q)) {
          return;
        }
        renderedCount++;
        const row = document.createElement('button');
        row.type = 'button';
        row.setAttribute('role', 'option');
        row.setAttribute('aria-selected', entry.selected ? 'true' : 'false');
        if (entry.disabled) row.disabled = true;
        if (entry.title && entry.title !== entry.text) row.title = entry.title;

        row.className = `nexus-popover-option ${entry.selected ? 'is-selected' : ''} ${entry.disabled ? 'opacity-40 cursor-not-allowed' : ''}`;
        row.innerHTML = `
          <span class="nexus-option-check shrink-0">${entry.selected ? '✓' : ''}</span>
          <span class="min-w-0 flex-1 truncate text-left">${escHtml(entry.text)}</span>
        `;

        if (!entry.disabled) {
          row.addEventListener('click', (ev) => {
            ev.stopPropagation();
            selectOptionAndEmit(sel, entry.index, true);
          });
        }
        listEl.appendChild(row);
        visibleButtons.push({ btn: row, index: entry.index, selected: entry.selected, disabled: entry.disabled });
      });

      if (renderedCount === 0) {
        listEl.innerHTML = '<div class="py-4 px-3 text-center text-[11px] font-mono text-slate-500">No matching options</div>';
      }
      return visibleButtons;
    };

    let visibleButtons = renderList('');

    // Viewport-aware placement (auto-flip upward near composer / bottom edges, clamp horizontally)
    const rect = triggerBtn.getBoundingClientRect();
    const minW = Math.max(rect.width, 168);
    const maxW = Math.min(340, window.innerWidth - 16);
    const naturalW = Math.min(Math.max(minW, pop.offsetWidth || minW), maxW);
    pop.style.width = `${naturalW}px`;

    const popH = Math.min(pop.offsetHeight || 240, window.innerHeight - 24);
    const spaceBelow = window.innerHeight - rect.bottom - 10;
    const spaceAbove = rect.top - 10;
    const openUpward = spaceBelow < Math.min(popH, 190) && spaceAbove > spaceBelow;

    const left = Math.max(8, Math.min(rect.left, window.innerWidth - naturalW - 8));
    let top;
    if (openUpward) {
      const clampedH = Math.min(popH, spaceAbove);
      if (listEl && showSearch) listEl.style.maxHeight = `${Math.max(120, clampedH - 52)}px`;
      else if (listEl) listEl.style.maxHeight = `${Math.max(120, clampedH - 12)}px`;
      const finalH = pop.offsetHeight || clampedH;
      top = Math.max(8, rect.top - finalH - 6);
      pop.dataset.placement = 'top';
    } else {
      const clampedH = Math.min(popH, Math.max(140, spaceBelow));
      if (listEl && showSearch) listEl.style.maxHeight = `${Math.max(120, clampedH - 52)}px`;
      else if (listEl) listEl.style.maxHeight = `${Math.max(120, clampedH - 12)}px`;
      top = Math.min(rect.bottom + 6, window.innerHeight - (pop.offsetHeight || 160) - 8);
      pop.dataset.placement = 'bottom';
    }
    pop.style.left = `${left}px`;
    pop.style.top = `${top}px`;

    // Scroll active item smoothly into view
    const activeRow = listEl.querySelector('.nexus-popover-option.is-selected');
    if (activeRow) {
      requestAnimationFrame(() => activeRow.scrollIntoView({ block: 'nearest' }));
    }

    if (searchEl) {
      searchEl.addEventListener('input', (e) => {
        visibleButtons = renderList(e.target.value);
      });
      setTimeout(() => searchEl.focus(), 15);
    }

    const onDocDown = (e) => {
      if (!pop.contains(e.target) && !triggerBtn.contains(e.target)) {
        window.closeNexusSelectPopover();
      }
    };

    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        window.closeNexusSelectPopover();
        triggerBtn.focus();
        return;
      }
      const enabledBtns = visibleButtons.filter((b) => !b.disabled);
      if (!enabledBtns.length) return;

      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const curBtnIdx = enabledBtns.findIndex((b) => b.btn === document.activeElement);
        let nextIdx = 0;
        if (curBtnIdx >= 0) {
          nextIdx = e.key === 'ArrowDown'
            ? (curBtnIdx + 1) % enabledBtns.length
            : (curBtnIdx - 1 + enabledBtns.length) % enabledBtns.length;
        } else {
          const selPos = enabledBtns.findIndex((b) => b.selected);
          nextIdx = selPos >= 0 ? selPos : 0;
        }
        enabledBtns[nextIdx].btn.focus();
      } else if (e.key === 'Enter' && document.activeElement && pop.contains(document.activeElement) && document.activeElement !== searchEl) {
        e.preventDefault();
        const match = enabledBtns.find((b) => b.btn === document.activeElement);
        if (match) selectOptionAndEmit(sel, match.index, true);
      }
    };

    const onScrollOrResize = (e) => {
      if (e && e.target && pop.contains(e.target)) return;
      window.closeNexusSelectPopover();
    };

    setTimeout(() => {
      document.addEventListener('mousedown', onDocDown, true);
      document.addEventListener('keydown', onKeyDown, true);
      window.addEventListener('resize', onScrollOrResize);
      window.addEventListener('scroll', onScrollOrResize, true);
    }, 0);

    activeCleanup = () => {
      document.removeEventListener('mousedown', onDocDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('resize', onScrollOrResize);
      window.removeEventListener('scroll', onScrollOrResize, true);
    };
  }

  function enhanceSelectElement(sel) {
    if (!sel || sel.tagName !== 'SELECT' || sel.multiple || sel.hasAttribute('data-native-select')) return;
    if (sel._nexusEnhanced) {
      syncSelectUi(sel);
      return;
    }
    sel._nexusEnhanced = true;

    const meta = extractTriggerLayoutClasses(sel);
    sel.classList.add('nexus-select-native');
    sel.setAttribute('tabindex', '-1');

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('aria-haspopup', 'listbox');
    btn.setAttribute('aria-expanded', 'false');

    const baseClasses = [
      'nexus-select-trigger',
      meta.isTransparent ? 'nexus-select-transparent' : 'nexus-select-surface',
      ...meta.layout,
      ...meta.textAndRadius
    ];
    if (meta.customTextColor) baseClasses.push(meta.customTextColor);
    if (meta.customBorder && !meta.isTransparent) baseClasses.push(meta.customBorder);
    if (meta.customPad.length) baseClasses.push(...meta.customPad);

    btn.className = baseClasses.filter(Boolean).join(' ');
    btn.innerHTML = `
      <span class="nexus-select-label truncate flex-1 text-left"></span>
      <svg class="nexus-select-chevron shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M4 6l4 4 4-4"/>
      </svg>
    `;

    sel.insertAdjacentElement('afterend', btn);
    sel._nexusTrigger = btn;
    sel._nexusSyncUi = () => scheduleSync(sel);

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openNexusSelectPopover(sel, btn);
    });

    btn.addEventListener('keydown', (e) => {
      if (['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(e.key)) {
        e.preventDefault();
        openNexusSelectPopover(sel, btn);
      }
    });

    // If a <label for="..."> targets the native select, open the custom trigger on focus/click
    sel.addEventListener('focus', () => {
      if (btn && !sel.disabled) btn.focus();
    });
    sel.addEventListener('change', () => syncSelectUi(sel));

    const obs = new MutationObserver(() => scheduleSync(sel));
    obs.observe(sel, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['class', 'disabled', 'title', 'style']
    });
    sel._nexusObserver = obs;

    syncSelectUi(sel);
  }

  function scanAndEnhanceAll(root = document) {
    if (!root || !root.querySelectorAll) return;
    root.querySelectorAll('select').forEach(enhanceSelectElement);
  }

  function initNexusSelectSystem() {
    scanAndEnhanceAll(document);
    if (!rootObserver && document.body) {
      rootObserver = new MutationObserver((mutations) => {
        for (const m of mutations) {
          for (const node of m.addedNodes) {
            if (node.nodeType !== 1) continue;
            if (node.tagName === 'SELECT') enhanceSelectElement(node);
            else if (node.querySelectorAll) scanAndEnhanceAll(node);
          }
        }
      });
      rootObserver.observe(document.body, { childList: true, subtree: true });
    }
  }

  window.refreshNexusSelects = scanAndEnhanceAll;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initNexusSelectSystem);
  } else {
    initNexusSelectSystem();
  }
})();
