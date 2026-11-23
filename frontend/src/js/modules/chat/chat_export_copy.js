    // --- BL-CHAT-26: One-Click Message & Code Block Clipboard Copy ---
    function copyMessageBubble(btn) {
      if (!btn) return;
      const bubble = btn.closest('div[class*="flex"]') || btn.closest('.msg-bubble-card') || btn.parentElement;
      let text = '';
      if (bubble && bubble._rawText) {
        text = bubble._rawText;
      } else {
        const prose = btn.closest('div[class*="bg-"]')?.querySelector('.prose');
        text = prose ? (prose.innerText || prose.textContent || '') : '';
      }
      if (!text) return;

      navigator.clipboard.writeText(text).then(() => {
        const lbl = btn.querySelector('.copy-lbl');
        const origText = lbl ? lbl.innerText : 'Copy';
        if (lbl) lbl.innerText = 'Copied!';
        btn.classList.add('text-emerald-400');
        setTimeout(() => {
          if (lbl) lbl.innerText = origText;
          btn.classList.remove('text-emerald-400');
        }, 1800);
      }).catch(err => {
        console.error('Copy message failed:', err);
      });
    }

    function attachCodeBlockCopyButtons(container) {
      if (!container) return;
      const pres = container.querySelectorAll('pre');
      pres.forEach(pre => {
        if (pre.querySelector('.code-copy-btn')) return;
        const code = pre.querySelector('code');
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'code-copy-btn px-2 py-0.5 rounded text-[10px] font-mono bg-slate-800/90 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 transition cursor-pointer shadow-sm';
        btn.innerText = '📋 Copy';
        btn.onclick = (e) => {
          e.stopPropagation();
          const codeText = code ? code.innerText : pre.innerText;
          navigator.clipboard.writeText(codeText).then(() => {
            btn.innerText = '✓ Copied!';
            btn.className = 'code-copy-btn px-2 py-0.5 rounded text-[10px] font-mono bg-emerald-900 text-emerald-300 border border-emerald-600 transition cursor-pointer shadow-sm';
            setTimeout(() => {
              btn.innerText = '📋 Copy';
              btn.className = 'code-copy-btn px-2 py-0.5 rounded text-[10px] font-mono bg-slate-800/90 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 transition cursor-pointer shadow-sm';
            }, 1800);
          });
        };
        pre.appendChild(btn);
      });
    }

    // --- BL-CHAT-25: Spacious Fullscreen Console Mode Toggle ---
    let isConsoleSpacious = false;

    function toggleConsoleSpaciousMode() {
      const consoleTab = document.getElementById('tab-console');
      if (!consoleTab) return;
      isConsoleSpacious = !isConsoleSpacious;

      if (isConsoleSpacious) {
        consoleTab.classList.add('spacious-fullscreen');
      } else {
        consoleTab.classList.remove('spacious-fullscreen');
      }

      document.querySelectorAll('.label-console-spacious').forEach(el => {
        el.innerText = isConsoleSpacious ? 'Compact' : 'Expand';
      });

      if (typeof invalidateIsoBuffer === 'function') invalidateIsoBuffer();
    }

    // --- BL-CHAT-28: Full Conversation Save, Snapshot, Catalog & Export Engine ---
    let activeSaveModalTab = 'snapshot';
    let savedSessionsCatalogCache = [];

    function openExportModal(mode) {
      activeExportMode = mode || 'warroom';
      const modal = document.getElementById('modal-export-transcript');
      if (!modal) return;
      const titleEl = document.getElementById('export-modal-title');
      const subtitleEl = document.getElementById('export-modal-subtitle');
      const isDirect = (activeExportMode === 'direct');
      const agentName = selectedAgent ? selectedAgent.name : 'Agent';
      const targetName = isDirect ? agentName : (activeWarRoomId || 'General');

      if (titleEl) titleEl.innerText = isDirect ? `SAVE & ARCHIVE: ${agentName.toUpperCase()}` : 'SAVE & ARCHIVE WAR ROOM';
      if (subtitleEl) subtitleEl.innerText = isDirect ? `Snapshot 1-on-1 dialogue with ${agentName}` : `Archive boardroom conference (${targetName})`;

      // Prepopulate fields
      const targetInput = document.getElementById('snapshot-input-target');
      if (targetInput) targetInput.value = isDirect ? agentName : `Room: ${targetName}`;

      const titleInput = document.getElementById('snapshot-input-title');
      if (titleInput) {
        const dateStr = new Date().toLocaleDateString();
        titleInput.value = isDirect ? `1-on-1 Discussion with ${agentName} (${dateStr})` : `War Room Conference - ${targetName} (${dateStr})`;
      }

      const wikiAgentInput = document.getElementById('wiki-distill-agent');
      if (wikiAgentInput) wikiAgentInput.value = agentName;

      const wikiTitleInput = document.getElementById('wiki-distill-title');
      if (wikiTitleInput) wikiTitleInput.value = isDirect ? `${agentName}_takeaways` : `warroom_${targetName}_decisions`;

      const msgCount = isDirect ? currentChatHistory.length : currentWarRoomHistory.length;
      const countEl = document.getElementById('snapshot-turn-counter');
      if (countEl) countEl.innerText = `Total messages to save: ${msgCount}`;

      modal.classList.remove('hidden');
      switchSaveModalTab('snapshot');
    }

    function switchSaveModalTab(tab) {
      activeSaveModalTab = tab;
      const tabs = ['snapshot', 'catalog', 'wiki', 'download'];
      tabs.forEach(t => {
        const btn = document.getElementById(`tab-btn-save-${t}`);
        const pane = document.getElementById(`save-pane-${t}`);
        if (pane) pane.classList.toggle('hidden', t !== tab);
        if (btn) {
          if (t === tab) {
            btn.className = 'px-3 py-1.5 rounded-t-lg text-xs font-mono font-semibold text-emerald-400 border-b-2 border-emerald-400 transition cursor-pointer';
          } else {
            btn.className = 'px-3 py-1.5 rounded-t-lg text-xs font-mono font-semibold text-slate-400 hover:text-slate-200 border-b-2 border-transparent transition cursor-pointer';
          }
        }
      });

      if (tab === 'catalog') {
        loadSavedSessionsCatalog();
      }
    }

    async function submitSaveSnapshot() {
      const { title, targetAgent, isDirect, messages, inst } = getExportData();
      const titleInput = document.getElementById('snapshot-input-title');
      const tagsInput = document.getElementById('snapshot-input-tags');
      const descInput = document.getElementById('snapshot-input-desc');
      const btn = document.getElementById('btn-submit-save-snapshot');

      const customTitle = (titleInput && titleInput.value.trim()) ? titleInput.value.trim() : title;
      const tags = (tagsInput && tagsInput.value) ? tagsInput.value.split(',').map(s => s.trim()).filter(Boolean) : [];
      const description = descInput ? descInput.value.trim() : '';
      const target = isDirect ? targetAgent : (activeWarRoomId || 'general');

      if (!messages || messages.length === 0) {
        alert('Cannot save an empty conversation with no messages.');
        return;
      }

      if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span>⏳ Saving...</span>';
      }

      try {
        const res = await fetch('/api/sessions/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: customTitle,
            session_type: isDirect ? 'direct' : 'warroom',
            target: target,
            tags: tags,
            description: description,
            messages: messages,
            instance: inst
          })
        });
        const data = await res.json();
        if (res.ok) {
          alert(`✓ Session snapshot saved successfully!\nTitle: ${data.session.title}\nID: ${data.session.id}`);
          switchSaveModalTab('catalog');
        } else {
          alert('Failed to save snapshot: ' + (data.detail || 'Unknown error'));
        }
      } catch (e) {
        alert('Network error saving snapshot: ' + e);
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = '<span>💾</span> <span>Save Snapshot</span>';
        }
      }
    }

    async function loadSavedSessionsCatalog() {
      const listEl = document.getElementById('catalog-sessions-list');
      if (listEl) listEl.innerHTML = '<div class="text-center py-6 text-slate-500 font-mono text-xs">Loading saved snapshots...</div>';
      try {
        const res = await fetch('/api/sessions/list');
        const data = await res.json();
        savedSessionsCatalogCache = data.sessions || [];
        renderSavedCatalogList();
      } catch (e) {
        if (listEl) listEl.innerHTML = `<div class="text-center py-4 text-rose-400 font-mono text-xs">Failed to load catalog: ${e}</div>`;
      }
    }

    function renderSavedCatalogList() {
      const listEl = document.getElementById('catalog-sessions-list');
      if (!listEl) return;
      const search = (document.getElementById('catalog-search-input')?.value || '').toLowerCase().trim();

      const filtered = savedSessionsCatalogCache.filter(item => {
        if (!search) return true;
        const t = (item.title || '').toLowerCase();
        const d = (item.description || '').toLowerCase();
        const tags = (item.tags || []).join(' ').toLowerCase();
        return t.includes(search) || d.includes(search) || tags.includes(search);
      });

      if (filtered.length === 0) {
        listEl.innerHTML = '<div class="text-center py-6 text-slate-500 font-mono text-xs">No saved sessions found. Create a snapshot to get started!</div>';
        return;
      }

      listEl.innerHTML = filtered.map(item => {
        const isWar = item.session_type === 'warroom';
        const typeBadge = isWar
          ? '<span class="px-1.5 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800 text-[9px] font-mono">WAR ROOM</span>'
          : '<span class="px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800 text-[9px] font-mono">1-ON-1</span>';
        
        const autoBadge = item.is_auto_archive
          ? '<span class="px-1.5 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-800 text-[9px] font-mono">AUTO-ARCHIVE</span>'
          : '';

        const tagsHtml = (item.tags || []).map(tg => `<span class="text-[9px] text-slate-400 font-mono bg-slate-800/80 px-1 py-0.5 rounded">#${tg}</span>`).join(' ');

        return `
          <div class="p-2.5 rounded-xl bg-slate-900/90 border border-slate-800 hover:border-slate-700 flex flex-col gap-1.5 transition">
            <div class="flex items-start justify-between gap-2">
              <div class="flex items-center gap-1.5 flex-wrap">
                ${typeBadge}
                ${autoBadge}
                <strong class="text-slate-100 font-mono text-xs">${item.title}</strong>
              </div>
              <span class="text-[10px] text-slate-400 font-mono shrink-0">${item.created_at || ''}</span>
            </div>
            ${item.description ? `<p class="text-[11px] text-slate-400 font-sans">${item.description}</p>` : ''}
            <div class="flex items-center justify-between pt-1 border-t border-slate-800/60 mt-0.5">
              <div class="flex items-center gap-1.5">
                <span class="text-[10px] font-mono text-slate-400">💬 ${item.message_count || 0} msgs</span>
                ${tagsHtml}
              </div>
              <div class="flex items-center gap-1.5">
                <button type="button" onclick="restoreSavedSession('${item.id}')" class="px-2 py-1 rounded bg-emerald-950 hover:bg-emerald-900 text-emerald-300 border border-emerald-700/80 text-[10px] font-mono font-bold transition cursor-pointer" title="Resume/Restore this session">
                  🔄 Resume
                </button>
                <button type="button" onclick="deleteSavedSession('${item.id}')" class="px-1.5 py-1 rounded bg-slate-800 hover:bg-rose-950 text-slate-400 hover:text-rose-300 border border-slate-700 text-[10px] font-mono transition cursor-pointer" title="Delete snapshot">
                  ✕
                </button>
              </div>
            </div>
          </div>
        `;
      }).join('');
    }

    async function restoreSavedSession(sessionId) {
      if (!confirm(`Resume and restore session '${sessionId}' into current conversation display?`)) return;
      const isDirect = (activeExportMode === 'direct');
      const targetAgent = selectedAgent ? selectedAgent.name : 'Agent';
      const targetId = isDirect ? targetAgent : (activeWarRoomId || 'general');

      try {
        const res = await fetch(`/api/sessions/${sessionId}/restore`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            target_mode: isDirect ? 'direct' : 'warroom',
            target_id: targetId
          })
        });
        const data = await res.json();
        if (res.ok) {
          alert(`✓ Session restored successfully (${data.restored_count} messages)!`);
          closeExportModal();
          if (isDirect) {
            loadAgentChat(selectedAgent);
          } else {
            syncWarRoomMessages(activeWarRoomId);
          }
        } else {
          alert('Failed to restore session: ' + (data.detail || 'Unknown error'));
        }
      } catch (e) {
        alert('Network error restoring session: ' + e);
      }
    }

    async function deleteSavedSession(sessionId) {
      if (!confirm(`Permanently delete snapshot '${sessionId}'?`)) return;
      try {
        const res = await fetch(`/api/sessions/${sessionId}`, { method: 'DELETE' });
        if (res.ok) {
          savedSessionsCatalogCache = savedSessionsCatalogCache.filter(x => x.id !== sessionId);
          renderSavedCatalogList();
        } else {
          alert('Failed to delete session');
        }
      } catch (e) {
        alert('Network error deleting session: ' + e);
      }
    }

    async function submitDistillWiki() {
      const { targetAgent, isDirect, messages, inst } = getExportData();
      const titleInput = document.getElementById('wiki-distill-title');
      const folderSelect = document.getElementById('wiki-distill-folder');
      const btn = document.getElementById('btn-submit-distill-wiki');

      const title = (titleInput && titleInput.value.trim()) ? titleInput.value.trim() : 'Session_Takeaways';
      const folder = folderSelect ? folderSelect.value : 'notes';

      if (!messages || messages.length === 0) {
        alert('Cannot distill an empty conversation with no messages.');
        return;
      }

      if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span>⏳ Writing Vault...</span>';
      }

      try {
        const res = await fetch('/api/sessions/distill-wiki', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: title,
            folder: folder,
            target_agent: targetAgent,
            messages: messages,
            instance: inst
          })
        });
        const data = await res.json();
        if (res.ok) {
          alert(`✓ Distilled conversation directly to ${data.destination.toUpperCase()}!\nPath: ${data.path}`);
          closeExportModal();
        } else {
          alert('Failed to distill to wiki: ' + (data.detail || 'Unknown error'));
        }
      } catch (e) {
        alert('Network error: ' + e);
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = '<span>🧠</span> <span>Distill to Vault</span>';
        }
      }
    }

    function closeExportModal() {
      const modal = document.getElementById('modal-export-transcript');
      if (modal) modal.classList.add('hidden');
    }

    function getExportData() {
      const isDirect = (activeExportMode === 'direct');
      const targetAgent = selectedAgent ? selectedAgent.name : 'Agent';
      const title = isDirect ? `1-on-1 Chat with ${targetAgent}` : `Multi-Agent Conference War Room`;
      const messages = isDirect ? currentChatHistory : currentWarRoomHistory;
      const inst = (typeof currentInstanceKey !== 'undefined' && currentInstanceKey) ? currentInstanceKey : (localStorage.getItem('nexusdesk_instance') || 'default');
      return { title, isDirect, targetAgent, messages, inst };
    }

    function executeExport(format) {
      const { title, targetAgent, isDirect, messages, inst } = getExportData();
      const dateStr = new Date().toISOString().slice(0, 10);
      const safeName = isDirect ? targetAgent.replace(/\s+/g, '_') : 'WarRoom';
      const filename = `NexusDesk_${safeName}_Transcript_${dateStr}.${format}`;

      let content = '';
      let mimeType = 'text/plain';

      if (format === 'md') {
        mimeType = 'text/markdown';
        content = `# NexusDesk Conversation Transcript: ${title}\n\n`;
        content += `- **Fleet Instance**: \`${inst}\`\n`;
        content += `- **Export Date**: ${new Date().toLocaleString()}\n`;
        content += `- **Total Dialogue Turns**: ${messages.length}\n\n`;
        content += `---\n\n`;

        messages.forEach(m => {
          const time = m.timestamp ? ((typeof window.formatNexusDateTime === 'function') ? window.formatNexusDateTime(m.timestamp, true) : new Date(m.timestamp * 1000).toLocaleTimeString()) : '';
          const sender = m.sender || (m.sender_type === 'user' ? 'Operator (Min)' : 'System');
          const eng = m.engine ? ` [${m.engine.toUpperCase()}]` : '';
          content += `### [${time}] ${sender}${eng}\n`;
          if (m.role) content += `*${m.role}*\n\n`;
          content += `${m.text || ''}\n\n`;
        });
      } else if (format === 'json') {
        mimeType = 'application/json';
        content = JSON.stringify({
          title,
          fleet_instance: inst,
          exported_at: new Date().toISOString(),
          total_messages: messages.length,
          messages
        }, null, 2);
      } else {
        mimeType = 'text/plain';
        content = `=====================================================\n`;
        content += `NEXUSDESK TRANSCRIPT: ${title}\n`;
        content += `Instance: ${inst} | Exported: ${new Date().toLocaleString()}\n`;
        content += `=====================================================\n\n`;

        messages.forEach(m => {
          const time = m.timestamp ? ((typeof window.formatNexusDateTime === 'function') ? window.formatNexusDateTime(m.timestamp, true) : new Date(m.timestamp * 1000).toLocaleTimeString()) : '';
          const sender = m.sender || (m.sender_type === 'user' ? 'Operator' : 'System');
          content += `[${time}] ${sender}:\n${m.text || ''}\n\n`;
        });
      }

      downloadTranscriptBlob(content, filename, mimeType);
      closeExportModal();
    }

    function downloadTranscriptBlob(content, filename, mimeType) {
      const blob = new Blob([content], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }

    function copyFullTranscriptToClipboard() {
      const { title, messages, inst } = getExportData();
      let content = `# NexusDesk Transcript: ${title} (${inst})\n\n`;
      messages.forEach(m => {
        const time = m.timestamp ? ((typeof window.formatNexusDateTime === 'function') ? window.formatNexusDateTime(m.timestamp, true) : new Date(m.timestamp * 1000).toLocaleTimeString()) : '';
        const sender = m.sender || (m.sender_type === 'user' ? 'Operator' : 'System');
        content += `[${time}] ${sender}: ${m.text || ''}\n\n`;
      });

      navigator.clipboard.writeText(content).then(() => {
        const btn = document.getElementById('btn-copy-full-transcript');
        const lbl = document.getElementById('label-copy-full-transcript');
        if (lbl) lbl.innerText = '✓ Copied to Clipboard!';
        if (btn) btn.classList.add('bg-emerald-900', 'text-emerald-300', 'border-emerald-600');
        setTimeout(() => {
          if (lbl) lbl.innerText = 'Copy Full Transcript';
          if (btn) btn.classList.remove('bg-emerald-900', 'text-emerald-300', 'border-emerald-600');
        }, 1800);
      });
    }

    // BL-UI-26: Context Actions Dropdown Menus for Direct Chat & War Room
    function toggleDirectChatActionsMenu(e) {
      if (e) e.stopPropagation();
      const drop = document.getElementById('direct-chat-actions-dropdown');
      if (drop) drop.classList.toggle('hidden');
      hideWarRoomActionsMenu();
    }

    function hideDirectChatActionsMenu() {
      const drop = document.getElementById('direct-chat-actions-dropdown');
      if (drop) drop.classList.add('hidden');
    }

    function toggleWarRoomActionsMenu(e) {
      if (e) e.stopPropagation();
      const drop = document.getElementById('warroom-actions-dropdown');
      if (drop) drop.classList.toggle('hidden');
      hideDirectChatActionsMenu();
    }

    function hideWarRoomActionsMenu() {
      const drop = document.getElementById('warroom-actions-dropdown');
      if (drop) drop.classList.add('hidden');
    }

    // Close actions dropdown on backdrop click
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#direct-chat-more-menu-container')) {
        hideDirectChatActionsMenu();
      }
      if (!e.target.closest('#warroom-more-menu-container')) {
        hideWarRoomActionsMenu();
      }
    });

    // Window global bindings
    window.toggleDirectChatActionsMenu = toggleDirectChatActionsMenu;
    window.hideDirectChatActionsMenu = hideDirectChatActionsMenu;
    window.toggleWarRoomActionsMenu = toggleWarRoomActionsMenu;
    window.hideWarRoomActionsMenu = hideWarRoomActionsMenu;
    window.copyMessageBubble = copyMessageBubble;
    window.attachCodeBlockCopyButtons = attachCodeBlockCopyButtons;
    window.toggleConsoleSpaciousMode = toggleConsoleSpaciousMode;
    window.openExportModal = openExportModal;
    window.closeExportModal = closeExportModal;
    window.switchSaveModalTab = switchSaveModalTab;
    window.submitSaveSnapshot = submitSaveSnapshot;
    window.loadSavedSessionsCatalog = loadSavedSessionsCatalog;
    window.renderSavedCatalogList = renderSavedCatalogList;
    window.restoreSavedSession = restoreSavedSession;
    window.deleteSavedSession = deleteSavedSession;
    window.submitDistillWiki = submitDistillWiki;
    window.executeExport = executeExport;
    window.copyFullTranscriptToClipboard = copyFullTranscriptToClipboard;
    window.renderInquiriesDeck = renderInquiriesDeck;
    window.toggleInquiriesTray = toggleInquiriesTray;
    window.resolveInquiry = resolveInquiry;
    window.resolveAllInquiries = resolveAllInquiries;
    window.selectInquiryQuickChip = selectInquiryQuickChip;
    window.fetchRoomInquiries = fetchRoomInquiries;

    // BL-EVO-06: Ensure chat console content can scroll to reveal bottom menus
    // This issue is primarily resolved via CSS adjustments to the chat messages container
    // (e.g., `flex-grow: 1; overflow-y: auto;` on the messages wrapper and appropriate
    // height constraints on its parent) to ensure the input area and action menus
    // at the bottom are always accessible. No direct JS manipulation is required here.
    // The relevant CSS is applied to #chat-messages-container and #warroom-messages-container
    // to ensure they take up available space and scroll independently.



