/**
 * @module chat/war_room_messaging.js
 * @description War Room Messaging, Queue/Interrupt Controls & Deliberation Anchors.
 * Renders War Room message bubbles (`appendWarRoomMessage`), syncs live turns,
 * handles queue/interrupt controls, `sendWarRoomChat`, and clearing room history.
 *
 * Part of the Console & War Room chat subsystem (concatenated globally by frontend/build.py).
 */

// BL-EVO-19: 1-Click Quick Action Pill Handler for Post-Job Permissions & Directives
function applyQuickDirective(agentName, directiveText) {
  const input = document.getElementById('warroom-text-input');
  if (!input) return;
  const formatted = `@${agentName} ${directiveText}`;
  input.value = input.value ? `${input.value.trim()} • ${formatted}` : formatted;
  if (typeof autoResizeTextarea === 'function') autoResizeTextarea(input);
  input.focus();
  if (typeof resolveInquiry === 'function') {
    resolveInquiry('all', agentName);
  }
}
window.applyQuickDirective = applyQuickDirective;

// --- BL-EVO-38: Quick Navigation Anchors for War Room Deliberation Turns ---
function jumpToLastUserDirective(triggerEl) {
  const container = document.getElementById('warroom-conversation');
  if (!container) return;
  const currentBubble = triggerEl ? triggerEl.closest('[data-msg-id], .msg-agent-turn') : null;
  let targetDirective = null;

  if (currentBubble) {
    // Walk backwards in DOM before this turn to find the direct preceding operator directive
    let prev = currentBubble.previousElementSibling;
    while (prev) {
      if (prev.classList.contains('msg-user-directive') || prev.getAttribute('data-role') === 'user-directive' || prev.querySelector('strong')?.textContent.includes('OPERATOR')) {
        targetDirective = prev;
        break;
      }
      prev = prev.previousElementSibling;
    }
  }

  if (!targetDirective) {
    // Fallback: Find the latest operator directive in the entire conversation
    const allUserDirectives = container.querySelectorAll('.msg-user-directive, [data-role="user-directive"]');
    if (allUserDirectives.length > 0) {
      targetDirective = allUserDirectives[allUserDirectives.length - 1];
    }
  }

  if (targetDirective) {
    targetDirective.scrollIntoView({ behavior: 'smooth', block: 'center' });
    targetDirective.classList.add('ring-2', 'ring-emerald-400', 'transition-all');
    setTimeout(() => {
      targetDirective.classList.remove('ring-2', 'ring-emerald-400');
    }, 1800);
  }
}

function jumpToFirstTurnResponse(triggerEl) {
  const container = document.getElementById('warroom-conversation');
  if (!container) return;
  const currentBubble = triggerEl ? triggerEl.closest('[data-msg-id], .msg-agent-turn') : null;
  let firstTurn = null;

  if (currentBubble) {
    // Find the operator directive preceding this turn first
    let prev = currentBubble.previousElementSibling;
    let foundDirective = null;
    while (prev) {
      if (prev.classList.contains('msg-user-directive') || prev.getAttribute('data-role') === 'user-directive' || prev.querySelector('strong')?.textContent.includes('OPERATOR')) {
        foundDirective = prev;
        break;
      }
      prev = prev.previousElementSibling;
    }

    if (foundDirective) {
      // Walk forward from directive to find the first agent turn
      let next = foundDirective.nextElementSibling;
      while (next && next !== currentBubble) {
        if (next.classList.contains('msg-agent-turn') || next.getAttribute('data-role') === 'agent-turn') {
          firstTurn = next;
          break;
        }
        next = next.nextElementSibling;
      }
    }
  }

  if (!firstTurn) {
    const allAgentTurns = container.querySelectorAll('.msg-agent-turn, [data-role="agent-turn"]');
    if (allAgentTurns.length > 0) {
      firstTurn = allAgentTurns[0];
    }
  }

  if (firstTurn) {
    firstTurn.scrollIntoView({ behavior: 'smooth', block: 'center' });
    firstTurn.classList.add('ring-2', 'ring-cyan-400', 'transition-all');
    setTimeout(() => {
      firstTurn.classList.remove('ring-2', 'ring-cyan-400');
    }, 1800);
  }
}

window.jumpToLastUserDirective = jumpToLastUserDirective;
window.jumpToFirstTurnResponse = jumpToFirstTurnResponse;

function appendWarRoomMessage(msg) {
  const container = document.getElementById('warroom-conversation');
  if (!container || !msg) return;

  // Guard: Do not render empty/hollow message objects (e.g. raw turn summary metadata)
  const rawMsgText = (msg.text !== undefined && msg.text !== null) ? String(msg.text).trim() : '';
  if (!rawMsgText) {
    return;
  }

  // BL-WAR-23: Deduplicate via data-msg-id attribute to prevent duplicate bubbles (unless edited)
  const existingBubble = msg.id ? container.querySelector(`[data-msg-id="${msg.id}"]`) : null;
  const incomingEditedKey = msg.edited_at ? String(msg.edited_at) : '';
  if (existingBubble) {
    if (!incomingEditedKey || existingBubble.dataset.editedAt === incomingEditedKey) {
      return;
    }
  }

  // Deduplicate optimistic user messages when authoritative server message arrives
  if (msg.sender_type === 'user' && !String(msg.id).startsWith('usr-')) {
    const optimisticBubbles = container.querySelectorAll('[data-msg-id^="usr-"]');
    for (const optEl of optimisticBubbles) {
      if (optEl._rawText && optEl._rawText.trim() === rawMsgText) {
        optEl.setAttribute('data-msg-id', msg.id);
        if (msg.timestamp) {
          const timeSpan = optEl.querySelector('span.font-mono');
          if (timeSpan) {
            timeSpan.innerText = (typeof window.formatNexusDateTime === 'function')
              ? window.formatNexusDateTime(msg.timestamp, true)
              : new Date(msg.timestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
          }
        }
        return;
      }
    }
  }

  // Clear welcome placeholder if present before appending first real message
  const welcomeCard = container.querySelector('.font-pixel');
  if (welcomeCard && welcomeCard.textContent && welcomeCard.textContent.includes('ROOM 2: CONFERENCE WAR ROOM CONVENED')) {
    container.innerHTML = '';
  }

  // BL-CHAT-27: Track in war room history if unique
  if (msg.id && !currentWarRoomHistory.some(m => m.id === msg.id)) {
    currentWarRoomHistory.push(msg);
  } else if (!msg.id) {
    currentWarRoomHistory.push(msg);
  }

  // Format date + timestamp in configured User Profile timezone
  const timeStr = msg.timestamp
    ? ((typeof window.formatNexusDateTime === 'function')
        ? window.formatNexusDateTime(msg.timestamp, true)
        : new Date(msg.timestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }))
    : '';

  // BL-CHAT-24 & BL-WAR-36: Highlight @mentions and [PHASE] tags safely AFTER Markdown parsing,
  // skipping <code>, <pre>, <a>, <script>, <style> so backtick/fenced code never prints raw <span> HTML.
  function highlightWarRoomMentionsAndPhasesHtml(htmlStr) {
    const tmp = document.createElement('div');
    tmp.innerHTML = htmlStr || '';
    const skipTags = new Set(['CODE', 'PRE', 'A', 'SCRIPT', 'STYLE']);
    const walker = document.createTreeWalker(tmp, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    let node;
    while ((node = walker.nextNode())) {
      let cur = node.parentNode;
      let shouldSkip = false;
      while (cur && cur !== tmp) {
        if (skipTags.has(cur.nodeName)) {
          shouldSkip = true;
          break;
        }
        cur = cur.parentNode;
      }
      if (!shouldSkip && node.nodeValue && (/@[a-zA-Z0-9_\-]+/.test(node.nodeValue) || /\[(PROPOSAL|IMPLEMENTATION|QA_REVIEW|VERDICT)\]/i.test(node.nodeValue))) {
        textNodes.push(node);
      }
    }
    const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const tokenRe = /(^|[^a-zA-Z0-9._%+-])(@[a-zA-Z0-9_\-]+)|\[(PROPOSAL|IMPLEMENTATION|QA_REVIEW|VERDICT)\]/gi;
    textNodes.forEach((tn) => {
      const val = tn.nodeValue;
      let out = '';
      let lastIdx = 0;
      let m;
      tokenRe.lastIndex = 0;
      while ((m = tokenRe.exec(val)) !== null) {
        out += esc(val.slice(lastIdx, m.index));
        if (m[2]) {
          out += esc(m[1] || '');
          const mention = m[2];
          const lower = mention.slice(1).toLowerCase();
          const opLower = (window.nexusOperatorName || 'user').toLowerCase();
          if (['everyone', 'everyagents', 'all', 'all-agents', 'room'].includes(lower)) {
            out += `<span class="text-indigo-200 font-bold bg-indigo-950/90 px-1.5 py-0.5 rounded border border-indigo-500/80 font-mono text-[11px] shadow-sm">👥 ${esc(mention)}</span>`;
          } else if (['user', 'min', 'operator', 'human', 'admin', opLower].includes(lower)) {
            out += `<span class="text-emerald-200 font-bold bg-emerald-950/90 px-1.5 py-0.5 rounded border border-emerald-500/80 font-mono text-[11px] shadow-sm">👤 ${esc(mention)}</span>`;
          } else {
            out += `<span class="text-cyan-300 font-bold bg-cyan-950/80 px-1.5 py-0.5 rounded border border-cyan-800/60 font-mono text-[11px]">${esc(mention)}</span>`;
          }
        } else if (m[3]) {
          const u = m[3].toUpperCase();
          if (u === 'PROPOSAL') {
            out += `<span class="px-1.5 py-0.5 rounded bg-indigo-950 text-indigo-300 border border-indigo-700 font-mono text-[10px] font-bold uppercase tracking-wider">📐 PROPOSAL</span>`;
          } else if (u === 'IMPLEMENTATION') {
            out += `<span class="px-1.5 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-700 font-mono text-[10px] font-bold uppercase tracking-wider">⚙️ IMPLEMENTATION</span>`;
          } else if (u === 'QA_REVIEW') {
            out += `<span class="px-1.5 py-0.5 rounded bg-purple-950 text-purple-300 border border-purple-700 font-mono text-[10px] font-bold uppercase tracking-wider">🔍 QA REVIEW</span>`;
          } else {
            out += `<span class="px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-700 font-mono text-[10px] font-bold uppercase tracking-wider">✅ VERDICT</span>`;
          }
        }
        lastIdx = tokenRe.lastIndex;
      }
      out += esc(val.slice(lastIdx));
      const span = document.createElement('span');
      span.innerHTML = out;
      tn.parentNode.replaceChild(span, tn);
    });
    return tmp.innerHTML;
  }

  let rawText = msg.text || '';
  // BL-CHAT-32: Parse <executive_summary> vs full content
  let execSummaryHtml = '';
  let bodyText = rawText;
  const summaryMatch = rawText.match(/<executive_summary>([\s\S]*?)<\/executive_summary>/i);
  if (summaryMatch && summaryMatch[1]) {
    const cleanSummaryRaw = summaryMatch[1].trim();
    const summaryParsed = (typeof marked !== 'undefined' && marked.parseInline)
      ? marked.parseInline(cleanSummaryRaw)
      : cleanSummaryRaw.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const cleanSummary = highlightWarRoomMentionsAndPhasesHtml(summaryParsed);
    execSummaryHtml = `
      <div class="mb-2 p-2.5 rounded-lg bg-cyan-950/70 border border-cyan-700/80 text-cyan-200 text-xs font-sans shadow-inner">
        <div class="flex items-center gap-1.5 text-[10px] font-mono text-cyan-400 font-bold uppercase tracking-wider mb-1">
          <span>🎙️</span> <span>EXECUTIVE TAKEAWAY</span>
        </div>
        <div class="leading-relaxed font-medium">${cleanSummary}</div>
      </div>
    `;
    bodyText = rawText.replace(/<executive_summary>[\s\S]*?<\/executive_summary>/gi, '').trim();
  }

  // Parse <swarm_dispatch> into a clean collapsible Orchestrator Swarm Dispatch card (+ optional Approve & Launch Swarm button)
  let swarmDispatchHtml = '';
  const swarmMatch = bodyText.match(/<swarm_dispatch>([\s\S]*?)<\/swarm_dispatch>/i);
  const metaTasks = Array.isArray(msg.swarm_dispatch_items) && msg.swarm_dispatch_items.length > 0 ? msg.swarm_dispatch_items : null;
  let resolvedTasksArr = metaTasks;
  if (swarmMatch && swarmMatch[1]) {
    if (!resolvedTasksArr) {
      try {
        const cleanJson = swarmMatch[1].trim().replace(/^```(?:json)?\s*|\s*```$/gi, '').trim();
        const parsedDispatch = JSON.parse(cleanJson);
        const arr = Array.isArray(parsedDispatch) ? parsedDispatch : (parsedDispatch.tasks || parsedDispatch.workers || []);
        if (Array.isArray(arr) && arr.length > 0) resolvedTasksArr = arr;
      } catch (_) {}
    }
    bodyText = bodyText.replace(/<swarm_dispatch>[\s\S]*?<\/swarm_dispatch>/gi, '').trim();
  }
  if (Array.isArray(resolvedTasksArr) && resolvedTasksArr.length > 0) {
    const escSw = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const rowsHtml = resolvedTasksArr.map(t => `
      <div class="flex items-start gap-2 py-1 border-b border-amber-900/40 last:border-b-0">
        <span class="px-1.5 py-0.5 rounded bg-amber-950/90 border border-amber-600/60 text-amber-300 font-bold text-[10px] shrink-0">@${escSw(t.agent || t.name || 'Worker')}</span>
        <span class="text-slate-200 text-[11px] leading-snug">${escSw(t.task || t.assignment || t.prompt || '')}</span>
      </div>
    `).join('');
    let approveBtnHtml = '';
    if (msg.swarm_awaiting_approval) {
      window._pendingSwarmPayloads = window._pendingSwarmPayloads || {};
      const payloadKey = msg.id || `sw_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      window._pendingSwarmPayloads[payloadKey] = {
        room_id: msg.room_id || activeWarRoomId || 'general',
        lead_agent: msg.swarm_lead || msg.sender || '',
        directive: msg.swarm_directive || '',
        tasks: resolvedTasksArr.map(t => ({
          agent: String(t.agent || t.name || '').trim(),
          task: String(t.task || t.assignment || t.prompt || '').trim()
        })),
        max_waves: msg.max_turns || 1
      };
      const safeKey = String(payloadKey).replace(/[^a-zA-Z0-9_\-:.]/g, '');
      approveBtnHtml = `
        <div class="mt-2 pt-2 border-t border-amber-800/50 flex items-center justify-between gap-2 flex-wrap">
          <span class="text-[10px] text-amber-300/90">⏸️ Awaiting your approval before parallel workers start</span>
          <button type="button" onclick="approveAndLaunchSwarm(this, '${safeKey}')" class="px-3 py-1 rounded-lg bg-amber-600 hover:bg-amber-500 text-slate-950 font-bold text-[11px] transition cursor-pointer shadow-md flex items-center gap-1.5">
            <span>⚡</span><span>Approve &amp; Launch Swarm</span>
          </button>
        </div>
      `;
    }
    swarmDispatchHtml = `
      <details open class="mb-2 rounded-lg bg-amber-950/30 border border-amber-700/60 px-2.5 py-1.5 text-xs font-mono">
        <summary class="cursor-pointer text-[10px] font-bold uppercase tracking-wider text-amber-300 select-none">📋 Orchestrator Swarm Dispatch (${resolvedTasksArr.length} parallel worker${resolvedTasksArr.length === 1 ? '' : 's'})</summary>
        <div class="mt-1.5 space-y-0.5">${rowsHtml}</div>
        ${approveBtnHtml}
      </details>
    `;
  }
  // Strip internal executed XML+JSON control tags so raw JSON never leaks into War Room bubbles (also cleans legacy logs)
  bodyText = bodyText
    .replace(/<(chat_agent_whatsapp|chat_agent_publish|chat_agent_recap_config|async_task|set_reminder|set_schedule|manage_schedule|outbound_message|next_step)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const roomId = msg.room_id || activeWarRoomId || 'general';
  const preprocessed = (typeof prepareAgentMarkdownMedia !== 'undefined') ? prepareAgentMarkdownMedia(bodyText, roomId) : bodyText;
  const rawParsedHtml = (typeof marked !== 'undefined') ? marked.parse(preprocessed) : preprocessed;
  const parsedHtml = highlightWarRoomMentionsAndPhasesHtml(rawParsedHtml);

  const bubble = document.createElement('div');
  bubble._rawText = rawText;
  if (msg.id) {
    bubble.setAttribute('data-msg-id', msg.id);
  }
  if (msg.edited_at) {
    bubble.dataset.editedAt = String(msg.edited_at);
  }

  if (msg.sender_type === 'user') {
    bubble.className = 'flex gap-2.5 items-start justify-end msg-user-directive';
    bubble.setAttribute('data-role', 'user-directive');
    bubble.innerHTML = `
      <div class="bg-emerald-950/90 border border-emerald-700 px-3.5 py-2.5 rounded-xl text-xs max-w-[92%] sm:max-w-[88%] text-emerald-100 shadow-md">
        <div class="flex items-center justify-between gap-4 mb-1 border-b border-emerald-800/80 pb-1">
          <strong class="text-emerald-400 text-[11px] font-pixel flex items-center gap-1.5">
            <span>👤</span> <span>${(window.nexusOperatorName || 'User').replace(/</g, '&lt;')}</span>
          </strong>
          <div class="flex items-center gap-2">
            <span class="text-[9px] font-mono text-emerald-400/70">${timeStr}</span>
            <button type="button" onclick="copyMessageBubble(this)" class="btn-copy-msg px-1.5 py-0.5 rounded text-[10px] font-mono text-emerald-300/80 hover:text-emerald-100 hover:bg-emerald-900/60 transition flex items-center gap-1 cursor-pointer" title="Copy message text">
              <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>
              <span class="copy-lbl">Copy</span>
            </button>
          </div>
        </div>
        <div class="prose prose-invert prose-xs text-xs font-sans text-emerald-50 leading-relaxed">${parsedHtml}</div>
      </div>
    `;
  } else if (msg.sender_type === 'system') {
    bubble.className = 'w-full my-1 flex justify-center';
    bubble.innerHTML = `
      <div class="w-full max-w-2xl px-3.5 py-2 rounded-xl bg-slate-900/90 border border-cyan-800/60 text-xs text-slate-300 flex items-start justify-between gap-3 shadow-md">
        <div class="flex items-start gap-2.5 flex-1 min-w-0">
          <div class="text-cyan-400 text-sm mt-0.5 shrink-0">⚡</div>
          <div class="flex-1 min-w-0">
            <div class="text-[11px] font-mono text-cyan-300">${parsedHtml}</div>
            <div class="text-[9px] font-mono text-slate-500 mt-0.5">${timeStr}</div>
          </div>
        </div>
        <button type="button" onclick="copyMessageBubble(this)" class="btn-copy-msg px-1.5 py-0.5 rounded text-[10px] font-mono text-slate-400 hover:text-cyan-300 hover:bg-slate-800 transition flex items-center gap-1 cursor-pointer shrink-0" title="Copy message text">
          <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>
          <span class="copy-lbl">Copy</span>
        </button>
      </div>
    `;
  } else {
    // Agent message
    const eng = (msg.engine || 'hermes').toLowerCase();
    const engStyle = ENGINE_BADGE_STYLES[eng] || ENGINE_BADGE_STYLES.hermes;
    const color = msg.color || '#06b6d4';
    const sender = msg.sender || msg.agent || 'Agent';
    const mentionsOperator = Boolean(msg.mentions_user) || /(?:^|[\s(])@(user|min|operator|human)\b/i.test(rawText);
    // Check if message is a context limit exhaustion error (BL-UI-49)
    const isContextError = rawText.includes("grown too large to send") || 
                           rawText.includes("context window") || 
                           rawText.includes("maximum context length");
    let contextActionsHtml = '';
    if (isContextError) {
      const safeSender = sender.replace(/'/g, "\\'");
      contextActionsHtml = `
        <div class="mt-2.5 pt-2 border-t border-rose-800/60 flex flex-wrap items-center gap-2">
          <span class="text-[10px] font-mono text-rose-300 font-bold">⚡ Recovery Options:</span>
          <button type="button" onclick="clearWarRoomHistory(true)" class="px-2.5 py-1 rounded-lg bg-rose-950 hover:bg-rose-900 border border-rose-600 text-rose-200 text-[10px] font-mono font-bold flex items-center gap-1 cursor-pointer transition shadow-sm" title="Reset all agent session memories and start a fresh session window">
            <span>⚡</span> <span>Reset Room Session</span>
          </button>
          <button type="button" onclick="openQuickModelPickerModal('${safeSender}', '${eng}', '', '')" class="px-2.5 py-1 rounded-lg bg-cyan-950 hover:bg-cyan-900 border border-cyan-600 text-cyan-200 text-[10px] font-mono font-bold flex items-center gap-1 cursor-pointer transition shadow-sm" title="Switch this agent to a higher-capacity LLM">
            <span>🔄</span> <span>Switch Model</span>
          </button>
        </div>
      `;
    }

    const cardBorder = isContextError
      ? 'border-rose-600/80 shadow-[0_0_15px_rgba(225,29,72,0.25)]'
      : (mentionsOperator
          ? 'border-emerald-500/90 shadow-[0_0_15px_rgba(16,185,129,0.2)]'
          : 'border-slate-800 shadow-lg');

    bubble.className = 'flex gap-3 items-start msg-agent-turn';
    bubble.setAttribute('data-role', 'agent-turn');
    const turnNum = msg.turn || msg.turn_index || msg.hop;
    const maxTurnNum = msg.max_turns || 5;
    const swarmPhase = msg.swarm_phase || '';
    const swarmBadgeHtml = swarmPhase === 'plan'
      ? `<span class="text-[8.5px] font-mono px-1.5 py-0.5 rounded-full bg-amber-950/90 text-amber-300 border border-amber-600/80 font-bold">👑 PLAN</span>`
      : swarmPhase === 'synthesis'
      ? `<span class="text-[8.5px] font-mono px-1.5 py-0.5 rounded-full bg-purple-950/90 text-purple-300 border border-purple-600/80 font-bold">🎯 SYNTHESIS</span>`
      : (msg.execution_mode === 'parallel' || swarmPhase === 'swarm' || swarmPhase === 'worker')
      ? `<span class="text-[8.5px] font-mono px-1.5 py-0.5 rounded-full bg-amber-950/80 text-amber-300 border border-amber-600/70 font-bold">⚡ SWARM${msg.swarm_wave ? ` W${msg.swarm_wave}` : ''}</span>`
      : '';
    const turnBadgeHtml = turnNum ? `
      <span class="text-[9px] font-mono px-2 py-0.5 rounded-full bg-cyan-950/80 text-cyan-300 border border-cyan-700/80 font-bold tracking-tight shadow-sm" title="Turn ${turnNum} of ${maxTurnNum} in current round">
        ${msg.execution_mode === 'parallel' ? 'wave' : 'turn'} (${turnNum}/${maxTurnNum})
      </span>
    ` : '';

    bubble.innerHTML = `
      <div class="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-pixel font-bold flex-shrink-0 shadow-md mt-0.5" 
           style="background: ${color}22; border: 1.5px solid ${color}; color: ${color};">
        ${sender[0]}
      </div>
      <div class="bg-slate-900/95 border ${cardBorder} px-3.5 py-2.5 rounded-xl text-xs max-w-[92%] sm:max-w-[88%] text-slate-200 shadow-md">
        <div class="flex items-center justify-between gap-3 mb-1.5 border-b border-slate-800/80 pb-1">
          <div class="flex items-center gap-2 flex-wrap">
            <strong class="text-white text-xs font-pixel" style="color: ${color}">${sender}</strong>
            <span class="text-[8px] font-mono px-1.5 py-0.2 rounded font-bold uppercase border ${engStyle}">[${eng.toUpperCase()}]</span>
            ${turnBadgeHtml}
            ${swarmBadgeHtml}
            ${mentionsOperator ? `<span class="text-[8px] font-mono px-1.5 py-0.2 rounded bg-emerald-950 text-emerald-300 border border-emerald-600 font-bold">🔔 AWAITING @USER</span>` : ''}
            ${isContextError ? `<span class="text-[8px] font-mono px-1.5 py-0.2 rounded bg-rose-950 text-rose-300 border border-rose-600 font-bold animate-pulse">⚠️ CONTEXT LIMIT</span>` : ''}
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <span class="text-[9px] font-mono text-slate-400 whitespace-nowrap">${timeStr}</span>
            <button type="button" onclick="copyMessageBubble(this)" class="btn-copy-msg px-1.5 py-0.5 rounded text-[10px] font-mono text-slate-400 hover:text-cyan-300 hover:bg-slate-800 transition flex items-center gap-1 cursor-pointer" title="Copy message text">
              <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>
              <span class="copy-lbl">Copy</span>
            </button>
          </div>
        </div>
        ${msg.role ? `<p class="text-[10px] text-slate-400 mb-1.5 font-mono italic">${msg.role}</p>` : ''}
        ${execSummaryHtml}
        ${swarmDispatchHtml}
        <div class="prose prose-invert prose-xs text-xs font-sans text-slate-100 leading-relaxed">${parsedHtml}</div>
        ${contextActionsHtml}
        ${(() => {
          // Quick jump navigation footer on substantive turns: jump up to operator request
          return `
            <div class="mt-2.5 pt-2 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-2 text-[10px] font-mono text-slate-400">
              <div class="flex items-center gap-2">
                <button type="button" onclick="jumpToLastUserDirective(this)" class="px-2 py-0.5 rounded bg-slate-950 hover:bg-slate-800 text-emerald-400 border border-emerald-900/60 hover:border-emerald-600 transition flex items-center gap-1 cursor-pointer" title="Jump up to the operator directive for this round">
                  <span>↑</span> <span>Request</span>
                </button>
              </div>
              <span class="text-[9px] text-slate-500">NexusDesk Multi-Agent Deliberation</span>
            </div>
          `;
        })()}
        ${(() => {
          // BL-EVO-19: Post-Job Permission Gate Action Pills
          const isTaskCompleteNotice = rawText.includes("Proactive Return Turn — Async Job") ||
                                       rawText.includes("Background processing is complete") ||
                                       (mentionsOperator && (rawText.toLowerCase().includes("proceed with the next step") || rawText.toLowerCase().includes("permission to proceed")));
          if (!isTaskCompleteNotice) return '';
          const safeSender = sender.replace(/'/g, "\\'");
          return `
            <div class="mt-2.5 pt-2 border-t border-emerald-800/60 flex flex-wrap items-center gap-2">
              <span class="text-[10px] font-mono text-emerald-300 font-bold">⚡ Permission Gate:</span>
              <button type="button" onclick="applyQuickDirective('${safeSender}', 'Approved, proceed with next task.')" class="px-2.5 py-1 rounded-lg bg-emerald-950 hover:bg-emerald-900 border border-emerald-600 text-emerald-200 text-[10px] font-mono font-bold flex items-center gap-1 cursor-pointer transition shadow-sm" title="Authorize agent to proceed with next step">
                <span>✅</span> <span>Approve Next Step</span>
              </button>
              <button type="button" onclick="applyQuickDirective('${safeSender}', 'Hold, let me review deliverables first.')" class="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-300 text-[10px] font-mono flex items-center gap-1 cursor-pointer transition" title="Hold execution for manual review">
                <span>⏸️</span> <span>Review Deliverables</span>
              </button>
              <button type="button" onclick="applyQuickDirective('${safeSender}', 'Revise parameters and rerun.')" class="px-2 py-1 rounded-lg bg-amber-950/80 hover:bg-amber-900 border border-amber-600/70 text-amber-200 text-[10px] font-mono flex items-center gap-1 cursor-pointer transition" title="Request adjustments before continuing">
                <span>🔄</span> <span>Revise</span>
              </button>
            </div>
          `;
        })()}
        ${renderServerArtifactsCards(extractServerFilePaths(rawText, roomId), roomId)}
      </div>
    `;
  }

  attachCodeBlockCopyButtons(bubble);
  if (typeof window.enhanceProseTables === 'function') {
    window.enhanceProseTables(bubble);
  }
  if (existingBubble && existingBubble.parentNode === container) {
    existingBubble.replaceWith(bubble);
  } else {
    container.appendChild(bubble);
    container.scrollTop = container.scrollHeight;
  }
}

window.updateWarRoomMessageInDom = function(msgObj) {
  if (!msgObj || !msgObj.id) return;
  const idx = (currentWarRoomHistory || []).findIndex(m => m && m.id === msgObj.id);
  if (idx >= 0) currentWarRoomHistory[idx] = msgObj;
  appendWarRoomMessage(msgObj);
};

window.extractProseTableRows = function(tableEl) {
  if (!tableEl) return [];
  const rows = [];
  tableEl.querySelectorAll('tr').forEach((tr) => {
    const cells = [];
    tr.querySelectorAll('th, td').forEach((cell) => {
      cells.push((cell.innerText || cell.textContent || '').replace(/\s+/g, ' ').trim());
    });
    if (cells.length) rows.push(cells);
  });
  return rows;
};

window.downloadProseTable = async function(btnEl, format) {
  const wrap = btnEl ? btnEl.closest('.prose-table-wrap') : null;
  const tableEl = wrap ? wrap.querySelector('table') : null;
  if (!tableEl) return;
  const rows = window.extractProseTableRows(tableEl);
  if (!rows.length) return;

  const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const baseName = `warroom_table_${ts}`;

  if (format === 'csv') {
    const csvLines = rows.map((r) =>
      r.map((val) => {
        const s = String(val ?? '');
        return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      }).join(',')
    );
    const blob = new Blob(['\uFEFF' + csvLines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${baseName}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return;
  }

  if (format === 'xlsx') {
    const origText = btnEl.innerHTML;
    btnEl.disabled = true;
    btnEl.innerHTML = '⏳';
    try {
      const res = await fetch('/api/war-room/export-table', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows, filename: baseName })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${baseName}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      if (typeof showToast === 'function') showToast(`XLSX export failed: ${e.message}`, 'error');
      else alert(`XLSX export failed: ${e.message}`);
    } finally {
      btnEl.disabled = false;
      btnEl.innerHTML = origText;
    }
  }
};

window.enhanceProseTables = function(containerEl) {
  if (!containerEl) return;
  containerEl.querySelectorAll('.prose table').forEach((table) => {
    if (table.closest('.prose-table-wrap')) return;
    const wrap = document.createElement('div');
    wrap.className = 'prose-table-wrap';

    const toolbar = document.createElement('div');
    toolbar.className = 'prose-table-toolbar';
    toolbar.innerHTML = `
      <button type="button" onclick="downloadProseTable(this, 'csv')" class="prose-table-btn" title="Download table as CSV">⬇ CSV</button>
      <button type="button" onclick="downloadProseTable(this, 'xlsx')" class="prose-table-btn" title="Download table as Excel (.xlsx)">⬇ XLSX</button>
    `;

    const scroller = document.createElement('div');
    scroller.className = 'prose-table-scroll custom-scrollbar';

    table.parentNode.insertBefore(wrap, table);
    scroller.appendChild(table);
    wrap.appendChild(toolbar);
    wrap.appendChild(scroller);
  });
};

// BL-WAR-23 & BL-EVO-29: Incremental War Room transcript synchronizer with stale-lock recovery
let isWarRoomSyncing = false;
let warRoomSyncStartedAt = 0;
let activeWarRoomSyncAbort = null;
async function syncWarRoomMessages(roomId = activeWarRoomId, force = false) {
  const nowMs = Date.now();
  if (isWarRoomSyncing) {
    if (!force && (nowMs - warRoomSyncStartedAt) < 10000) return;
    if (activeWarRoomSyncAbort) {
      try { activeWarRoomSyncAbort.abort(); } catch (_) {}
    }
    isWarRoomSyncing = false;
  }
  const targetRoom = roomId || activeWarRoomId || 'general';
  const container = document.getElementById('warroom-conversation');
  if (!container) return;

  // Prefer last server-confirmed timestamp so an optimistic usr-* timestamp never skips server replies
  let lastTimestamp = 0;
  if (!force && currentWarRoomHistory && currentWarRoomHistory.length > 0) {
    for (let i = currentWarRoomHistory.length - 1; i >= 0; i--) {
      const m = currentWarRoomHistory[i];
      if (m && m.timestamp && !String(m.id || '').startsWith('usr-')) {
        lastTimestamp = m.timestamp;
        break;
      }
    }
  }

  isWarRoomSyncing = true;
  warRoomSyncStartedAt = nowMs;
  const abortCtrl = new AbortController();
  activeWarRoomSyncAbort = abortCtrl;
  const timeoutId = setTimeout(() => abortCtrl.abort(), 8000); // 8s timeout guard

  try {
    let url = `/api/war-room/messages?room_id=${encodeURIComponent(targetRoom)}&limit=${force ? 50 : 100}`;
    if (lastTimestamp > 0) {
      url += `&since=${encodeURIComponent(Math.max(0, lastTimestamp - 5.0))}`;
    }
    const res = await fetch(url, { signal: abortCtrl.signal });
    clearTimeout(timeoutId);
    if (!res.ok) return;
    const data = await res.json();
    if (data.messages && data.messages.length > 0) {
      let hasNew = false;
      let hasNewAgentMsg = false;
      data.messages.forEach(m => {
        const alreadyInDom = m.id && container.querySelector(`[data-msg-id="${m.id}"]`);
        const isEditedUpdate = alreadyInDom && m.edited_at && alreadyInDom.dataset.editedAt !== String(m.edited_at);
        if (!alreadyInDom || isEditedUpdate) {
          appendWarRoomMessage(m);
          if (!alreadyInDom) {
            hasNew = true;
            if (m.sender_type === 'agent') hasNewAgentMsg = true;
          }
        }
      });
      if (hasNew) {
        // BL-EVO-25: Do NOT kill active speaker heartbeat when sync picks up user/system messages while turn is in-flight!
        if (hasNewAgentMsg && !isAgentTurnInFlight) {
          stopSpeakerHeartbeat(targetRoom, 'all');
        }
        fetchRoomInquiries(targetRoom);
      }
    }
  } catch (e) {
    if (e.name !== 'AbortError') {
      console.warn('War room incremental sync failed:', e);
    }
  } finally {
    clearTimeout(timeoutId);
    if (activeWarRoomSyncAbort === abortCtrl) {
      activeWarRoomSyncAbort = null;
      isWarRoomSyncing = false;
    }
  }
}

function updateWarRoomControlsUI(inFlight) {
  const sendBtn = document.getElementById('btn-send-warroom');
  const sendLabel = document.getElementById('btn-send-warroom-label');
  const interruptBtn = document.getElementById('btn-interrupt-warroom');

  if (inFlight) {
    if (interruptBtn) {
      interruptBtn.classList.remove('hidden');
      interruptBtn.classList.add('flex');
    }
    if (sendBtn) {
      sendBtn.className = 'px-3 h-[30px] bg-sky-700 hover:bg-sky-600 text-white rounded-lg flex items-center justify-center gap-1.5 text-[11px] font-semibold transition shrink-0 cursor-pointer shadow-md group whitespace-nowrap';
      sendBtn.title = 'Queue directive for next turn (Ctrl+Enter)';
    }
    if (sendLabel) {
      sendLabel.className = 'inline';
      sendLabel.innerText = 'Queue';
    }
  } else {
    if (interruptBtn) {
      interruptBtn.classList.add('hidden');
      interruptBtn.classList.remove('flex');
    }
    if (sendBtn) {
      sendBtn.className = 'px-3 h-[30px] bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg flex items-center justify-center gap-1.5 text-[11px] font-semibold transition shrink-0 cursor-pointer shadow-md group whitespace-nowrap';
      sendBtn.title = 'Send (Ctrl+Enter)';
    }
    if (sendLabel) {
      sendLabel.className = 'hidden sm:inline';
      sendLabel.innerText = 'Send';
    }
  }
}

// BL-WAR-39: dispatch sequence so a late-finishing OLD request can never flip the UI back to idle
// while a NEWER chain (e.g. interrupt + new directive) is still running
let warRoomDispatchSeq = 0;
let warRoomDispatchStartedAt = 0;
let warRoomExternalInFlight = false;  // in-flight state adopted from the server (e.g. after page reload / another tab)
let warRoomIdlePolls = 0;

// BL-EVO-11: Persistent Queued Operator Directives UI State & Banner (Editable Inline + Per-Item Cancel)
let activeRoomQueuedDirectives = [];
let editingQueueDirectiveId = null;
let warRoomQueueExpanded = false;

function _escQueueHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderWarRoomQueueBanner(queuedList) {
  if (Array.isArray(queuedList)) {
    activeRoomQueuedDirectives = queuedList;
  }
  const banner = document.getElementById('warroom-queue-banner');
  if (!banner) return;

  const list = activeRoomQueuedDirectives || [];
  if (list.length === 0) {
    if (editingQueueDirectiveId) {
      editingQueueDirectiveId = null;
      if (typeof showToast === 'function') {
        showToast('⚡ Queued directive started executing.');
      }
    }
    warRoomQueueExpanded = false;
    banner.classList.add('hidden');
    banner.innerHTML = '';
    return;
  }

  // If currently editing an item that is still in the queue, preserve the live textarea across background polls
  if (editingQueueDirectiveId) {
    const stillQueued = list.find((d) => d.id === editingQueueDirectiveId);
    if (!stillQueued) {
      editingQueueDirectiveId = null;
      if (typeof showToast === 'function') {
        showToast('⚡ That queued directive has already started executing.');
      }
    } else if (document.getElementById('warroom-queue-edit-input')) {
      return;
    }
  }

  banner.classList.remove('hidden');

  if (editingQueueDirectiveId) {
    const item = list.find((d) => d.id === editingQueueDirectiveId) || list[0];
    const safeId = String(item.id || '').replace(/'/g, "\\'");
    const qIndex = Math.max(1, list.findIndex((d) => d.id === item.id) + 1);
    banner.innerHTML = `
      <div class="space-y-1.5">
        <div class="flex items-center justify-between gap-2">
          <span class="text-[10.5px] font-bold text-emerald-300 flex items-center gap-1.5">
            <span>✏️</span>
            <span>Editing Queued Directive #${qIndex}</span>
            <span class="text-[9.5px] text-emerald-400/70 font-normal hidden sm:inline">(Ctrl+Enter to Save · Esc to Cancel)</span>
          </span>
          <button type="button" onclick="cancelWarRoomQueueEditor()" class="text-[10px] text-slate-400 hover:text-white px-1.5 py-0.5 rounded hover:bg-emerald-900/50 cursor-pointer">✕ Close</button>
        </div>
        <textarea id="warroom-queue-edit-input" rows="2"
                  onkeydown="if(event.key==='Escape'){event.preventDefault();cancelWarRoomQueueEditor();}else if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)){event.preventDefault();saveWarRoomQueuedDirective('${safeId}');}"
                  class="w-full min-h-[54px] max-h-[160px] resize-y bg-[#090d14] border border-emerald-500/60 focus:border-cyan-400 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 font-mono focus:outline-none custom-scrollbar">${_escQueueHtml(item.message || '')}</textarea>
        <div class="flex items-center justify-between gap-2 flex-wrap">
          <button type="button" onclick="moveWarRoomQueuedToComposer('${safeId}')" class="px-2 py-1 rounded-md bg-slate-900/90 hover:bg-slate-800 text-cyan-300 border border-slate-700 text-[10px] font-semibold transition cursor-pointer" title="Pull this directive back into the main composer box (removes from queue)">↩ Move to Composer</button>
          <div class="flex items-center gap-1.5 ml-auto">
            <button type="button" onclick="cancelWarRoomQueueEditor()" class="px-2.5 py-1 rounded-md bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700 text-[10px] transition cursor-pointer">Cancel</button>
            <button type="button" id="btn-save-queue-edit" onclick="saveWarRoomQueuedDirective('${safeId}')" class="px-3 py-1 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-bold transition cursor-pointer shadow-sm">💾 Save Queue Edit</button>
          </div>
        </div>
      </div>
    `;
    const ta = document.getElementById('warroom-queue-edit-input');
    if (ta) {
      ta.focus();
      const len = ta.value.length;
      try { ta.setSelectionRange(len, len); } catch (_) {}
    }
    return;
  }

  const first = list[0];
  const firstId = String(first.id || '').replace(/'/g, "\\'");
  const firstMsg = (first.message || '').trim();
  const countBadgeTxt = list.length === 1 ? '1 Queued' : `${list.length} Queued`;
  const expandBtn = list.length > 1
    ? `<button type="button" onclick="toggleWarRoomQueueExpand()" class="px-1.5 py-0.5 rounded bg-emerald-900/70 hover:bg-emerald-800 text-emerald-200 border border-emerald-600/50 text-[10px] cursor-pointer shrink-0">${warRoomQueueExpanded ? '▴ Hide' : `+${list.length - 1} more ▾`}</button>`
    : '';

  let itemsListHtml = '';
  if (warRoomQueueExpanded && list.length > 1) {
    itemsListHtml = `
      <div class="pt-1.5 mt-1 border-t border-emerald-800/50 space-y-1 max-h-36 overflow-y-auto custom-scrollbar">
        ${list.map((d, idx) => {
          const safeItemId = String(d.id || '').replace(/'/g, "\\'");
          const safeText = _escQueueHtml((d.message || '').trim());
          return `
            <div class="flex items-center justify-between gap-2 px-2 py-1 rounded bg-[#090d14]/70 border border-emerald-800/40">
              <div class="flex items-center gap-1.5 min-w-0 flex-1">
                <span class="text-[9.5px] font-bold text-emerald-400 shrink-0">#${idx + 1}</span>
                <span class="truncate text-emerald-100/90 text-[10.5px]" title="${safeText}">"${safeText}"</span>
              </div>
              <div class="flex items-center gap-1 shrink-0">
                <button type="button" onclick="openWarRoomQueueEditor('${safeItemId}')" class="px-1.5 py-0.5 rounded bg-emerald-900/80 hover:bg-emerald-800 text-emerald-200 border border-emerald-600/50 text-[9.5px] font-semibold cursor-pointer">✏️ Edit</button>
                <button type="button" onclick="cancelWarRoomQueuedDirective('${safeItemId}')" class="px-1.5 py-0.5 rounded bg-rose-950/80 hover:bg-rose-800 text-rose-300 hover:text-white border border-rose-700/60 text-[9.5px] cursor-pointer" title="Remove item #${idx + 1}">✕</button>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  banner.innerHTML = `
    <div class="flex items-center justify-between gap-2">
      <div class="flex items-center gap-2 min-w-0 flex-1">
        <span class="text-xs shrink-0">📥</span>
        <span class="px-1.5 py-0.5 rounded bg-emerald-900/90 border border-emerald-500/50 text-[10px] font-bold text-emerald-300 shrink-0">${countBadgeTxt}</span>
        <span onclick="openWarRoomQueueEditor('${firstId}')" class="truncate text-emerald-100/90 text-[10.5px] hover:text-white cursor-pointer" title="${_escQueueHtml(firstMsg)} (Click to edit)">Next: "${_escQueueHtml(firstMsg)}"</span>
      </div>
      <div class="flex items-center gap-1 shrink-0">
        ${expandBtn}
        <button type="button" onclick="openWarRoomQueueEditor('${firstId}')" class="px-2 py-0.5 rounded bg-emerald-900/85 hover:bg-emerald-800 text-emerald-100 border border-emerald-500/50 text-[10px] font-semibold transition cursor-pointer" title="Edit queued directive">✏️ Edit</button>
        <button type="button" onclick="cancelWarRoomQueuedDirective('all')" class="px-2 py-0.5 rounded bg-rose-950/80 hover:bg-rose-800 text-rose-300 hover:text-white border border-rose-700/60 text-[10px] font-semibold transition cursor-pointer" title="Cancel queued directive(s)">✕ Cancel${list.length > 1 ? ' All' : ''}</button>
      </div>
    </div>
    ${itemsListHtml}
  `;
}
window.renderWarRoomQueueBanner = renderWarRoomQueueBanner;

window.toggleWarRoomQueueExpand = function() {
  warRoomQueueExpanded = !warRoomQueueExpanded;
  renderWarRoomQueueBanner();
};

window.openWarRoomQueueEditor = function(directiveId) {
  const list = activeRoomQueuedDirectives || [];
  const target = directiveId ? list.find((d) => d.id === directiveId) : list[0];
  if (!target) return;
  editingQueueDirectiveId = target.id;
  renderWarRoomQueueBanner();
};

window.cancelWarRoomQueueEditor = function() {
  editingQueueDirectiveId = null;
  renderWarRoomQueueBanner();
};

window.saveWarRoomQueuedDirective = async function(directiveId) {
  const ta = document.getElementById('warroom-queue-edit-input');
  const saveBtn = document.getElementById('btn-save-queue-edit');
  const newText = ta ? ta.value.trim() : '';
  if (!newText) {
    if (typeof showToast === 'function') showToast('Queued directive cannot be empty.', 'error');
    return;
  }
  if (saveBtn) { saveBtn.disabled = true; saveBtn.innerText = 'Saving...'; }
  try {
    const res = await fetch('/api/war-room/queue/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        room_id: activeWarRoomId || 'general',
        directive_id: directiveId,
        message: newText
      })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (typeof showToast === 'function') showToast(data.detail || `Failed to update queue (HTTP ${res.status})`, 'error');
      editingQueueDirectiveId = null;
      if (Array.isArray(data.queued_directives)) renderWarRoomQueueBanner(data.queued_directives);
      return;
    }
    editingQueueDirectiveId = null;
    renderWarRoomQueueBanner(data.queued_directives || []);
    if (typeof showToast === 'function') showToast('✅ Queued directive updated!');
  } catch (e) {
    if (typeof showToast === 'function') showToast('Error updating queued directive: ' + e.message, 'error');
  } finally {
    if (saveBtn) { saveBtn.disabled = false; saveBtn.innerText = '💾 Save Queue Edit'; }
  }
};

window.moveWarRoomQueuedToComposer = async function(directiveId) {
  const ta = document.getElementById('warroom-queue-edit-input');
  const item = (activeRoomQueuedDirectives || []).find((d) => d.id === directiveId);
  const textToMove = (ta ? ta.value : (item ? item.message : '')).trim();
  editingQueueDirectiveId = null;
  await cancelWarRoomQueuedDirective(directiveId);
  const mainInput = document.getElementById('warroom-text-input');
  if (mainInput && textToMove) {
    const existing = mainInput.value.trim();
    mainInput.value = existing ? `${existing}\n\n${textToMove}` : textToMove;
    if (typeof autoResizeTextarea === 'function') autoResizeTextarea(mainInput);
    mainInput.focus();
  }
};

async function cancelWarRoomQueuedDirective(directiveId = 'all') {
  try {
    if (directiveId === 'all' || directiveId === editingQueueDirectiveId) {
      editingQueueDirectiveId = null;
    }
    const res = await fetch('/api/war-room/queue/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        room_id: activeWarRoomId || 'general',
        directive_id: directiveId
      })
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      renderWarRoomQueueBanner(data.queued_directives || []);
      if (typeof showToast === 'function') {
        showToast('🗑️ Queued directive(s) cancelled.');
      }
    }
  } catch (e) {
    console.warn('Error cancelling queued directive:', e);
  }
}
window.cancelWarRoomQueuedDirective = cancelWarRoomQueuedDirective;

// BL-WAR-39: reconcile the Send/Queue/Interrupt UI with what the SERVER is really doing. Fixes the stale
// "turn in flight" state (Interrupt button stuck, messages queued into a queue nobody drains) and lets the
// Interrupt button appear for chains this tab did not start (round-table, queued drain, page reload).
setInterval(async () => {
  if (typeof currentConsoleMode === 'undefined' || currentConsoleMode !== 'warroom') return;
  try {
    const res = await fetch(`/api/war-room/state?room_id=${encodeURIComponent(activeWarRoomId || 'general')}`);
    if (!res.ok) return;
    const st = await res.json();
    if (Array.isArray(st.queued_directives)) {
      renderWarRoomQueueBanner(st.queued_directives);
    }
    if (st.active) {
      warRoomIdlePolls = 0;
      if (!isAgentTurnInFlight) {
        isAgentTurnInFlight = true;
        warRoomExternalInFlight = true;
        updateWarRoomControlsUI(true);
      }
    } else {
      warRoomIdlePolls++;
      const age = Date.now() - warRoomDispatchStartedAt;
      if (isAgentTurnInFlight && warRoomIdlePolls >= 2 && age > 8000) {
        isAgentTurnInFlight = false;
        warRoomExternalInFlight = false;
        updateWarRoomControlsUI(false);
        const b = document.getElementById('warroom-status-banner');
        if (b) b.classList.add('hidden');
        if (typeof stopSpeakerHeartbeat === 'function') stopSpeakerHeartbeat();
        syncWarRoomMessages(activeWarRoomId);
        if (typeof loadWarRoomSandboxFiles === 'function') loadWarRoomSandboxFiles(activeWarRoomId);
        if (typeof loadWarRoomSandboxStats === 'function') loadWarRoomSandboxStats(activeWarRoomId);
      } else if (warRoomIdlePolls > 0 && warRoomIdlePolls % 3 === 0) {
        // Periodic background sync of storage stats, files count, background tasks, and inquiries
        if (typeof loadWarRoomSandboxFiles === 'function') loadWarRoomSandboxFiles(activeWarRoomId);
        if (typeof loadWarRoomSandboxStats === 'function') loadWarRoomSandboxStats(activeWarRoomId);
        if (typeof fetchRoomBgTasks === 'function') fetchRoomBgTasks(activeWarRoomId);
        if (typeof fetchRoomReminders === 'function') fetchRoomReminders(activeWarRoomId);
        if (typeof fetchRoomSchedules === 'function') fetchRoomSchedules(activeWarRoomId);
        if (typeof fetchRoomInquiries === 'function') fetchRoomInquiries(activeWarRoomId);
      }
    }
  } catch (_) { /* transient network error: keep current UI state */ }
}, 4000);

async function handleWarRoomInterruptClick() {
  const input = document.getElementById('warroom-text-input');
  const text = input ? input.value.trim() : '';
  if (input) {
    input.value = '';
    if (typeof autoResizeTextarea === 'function') autoResizeTextarea(input);
  }

  const activeInstance = (typeof currentInstanceKey !== 'undefined' && currentInstanceKey) ? currentInstanceKey : (localStorage.getItem('nexusdesk_instance') || 'agents_bs');
  const depthSelect = document.getElementById('warroom-turns-depth-select');
  const chosenTurns = depthSelect ? parseInt(depthSelect.value, 10) : 1;
  const mySeq = ++warRoomDispatchSeq;
  warRoomDispatchStartedAt = Date.now();

  // Stop everything immediately in the UI: heartbeat banner, hands-free listening, in-flight flag
  if (typeof stopSpeakerHeartbeat === 'function') stopSpeakerHeartbeat();
  const banner = document.getElementById('warroom-status-banner');
  if (!text) {
    isAgentTurnInFlight = false;
    updateWarRoomControlsUI(false);
    if (banner) banner.classList.add('hidden');
  } else {
    // interrupt + new directive: the server runs the new chain inside this request
    isAgentTurnInFlight = true;
    updateWarRoomControlsUI(true);
    appendWarRoomMessage({
      id: 'usr-' + Date.now(), room_id: activeWarRoomId || 'general', sender: 'Min', sender_type: 'user',
      text: text, engine: 'human', color: '#10b981', timestamp: Date.now() / 1000
    });
  }

  try {
    const res = await fetch('/api/war-room/interrupt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        room_id: activeWarRoomId || 'general',
        message: text,
        max_turns: chosenTurns,
        execution_mode: warRoomExecMode,
        pause_before_swarm: warRoomExecMode === 'orchestrate_parallel' && warRoomReviewPlanBeforeSwarm,
        instance: activeInstance
      })
    });
    await res.json().catch(() => ({}));
    if (typeof showToast === 'function') {
      showToast(text ? '⚡ Interrupted. Your new directive is running.' : '⚡ All turns interrupted. Floor returned to you.');
    }
  } catch (e) {
    console.error('Interrupt failed:', e);
  } finally {
    if (mySeq === warRoomDispatchSeq) {
      isAgentTurnInFlight = false;
      updateWarRoomControlsUI(false);
      if (banner) banner.classList.add('hidden');
    }
    await syncWarRoomMessages(activeWarRoomId);
  }
}
let warRoomExecMode = 'sequential'; // Default: Turns ('sequential' | 'parallel' | 'orchestrate_parallel')
let warRoomReviewPlanBeforeSwarm = false;

window.toggleWarRoomReviewPlan = function() {
  warRoomReviewPlanBeforeSwarm = !warRoomReviewPlanBeforeSwarm;
  const btn = document.getElementById('btn-warroom-review-plan');
  if (btn) {
    if (warRoomReviewPlanBeforeSwarm) {
      btn.className = 'h-[30px] px-2 rounded-lg bg-amber-950/90 hover:bg-amber-900/90 border border-amber-500/80 text-amber-200 text-[10px] font-mono font-bold transition cursor-pointer flex items-center gap-1 whitespace-nowrap shrink-0';
    } else {
      btn.className = 'h-[30px] px-2 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-400 text-[10px] font-mono transition cursor-pointer flex items-center gap-1 whitespace-nowrap shrink-0';
    }
  }
};

window.approveAndLaunchSwarm = async function(btnEl, payloadKeyOrEncoded) {
  if (!payloadKeyOrEncoded) return;
  let payload = (window._pendingSwarmPayloads && window._pendingSwarmPayloads[payloadKeyOrEncoded]) || null;
  if (!payload) {
    try {
      payload = JSON.parse(decodeURIComponent(payloadKeyOrEncoded));
    } catch (e) {
      if (typeof showToast === 'function') showToast('Invalid swarm plan payload', 'error');
      return;
    }
  }
  if (btnEl) {
    btnEl.disabled = true;
    btnEl.innerHTML = '<span>⚡</span><span>Launching Swarm...</span>';
    btnEl.classList.add('opacity-70', 'cursor-not-allowed');
  }
  const activeInstance = (typeof currentInstanceKey !== 'undefined' && currentInstanceKey) ? currentInstanceKey : (localStorage.getItem('nexusdesk_instance') || 'agents_bs');
  isAgentTurnInFlight = true;
  updateWarRoomControlsUI(true);
  try {
    const res = await fetch('/api/war-room/swarm/launch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        room_id: payload.room_id || activeWarRoomId || 'general',
        lead_agent: payload.lead_agent || null,
        directive: payload.directive || '',
        tasks: payload.tasks || [],
        max_waves: payload.max_waves || 1,
        synthesize_swarm: true,
        instance: activeInstance
      })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
    if (btnEl) {
      btnEl.innerHTML = '<span>✓</span><span>Swarm Launched</span>';
      btnEl.className = 'px-3 py-1 rounded-lg bg-emerald-950 border border-emerald-600/70 text-emerald-300 font-bold text-[11px] flex items-center gap-1.5';
    }
    await syncWarRoomMessages(activeWarRoomId);
  } catch (err) {
    if (typeof showToast === 'function') showToast(`Swarm launch failed: ${err.message}`, 'error');
    else alert(`Swarm launch failed: ${err.message}`);
    if (btnEl) {
      btnEl.disabled = false;
      btnEl.innerHTML = '<span>⚡</span><span>Approve &amp; Launch Swarm</span>';
      btnEl.classList.remove('opacity-70', 'cursor-not-allowed');
    }
  } finally {
    isAgentTurnInFlight = false;
    updateWarRoomControlsUI(false);
  }
};

window.setWarRoomExecMode = function(mode) {
  const valid = ['sequential', 'parallel', 'orchestrate_parallel'];
  warRoomExecMode = valid.includes(mode) ? mode : 'sequential';

  const bar = document.getElementById('warroom-exec-mode-bar');
  if (bar) {
    bar.querySelectorAll('button[data-exec-mode]').forEach(btn => {
      const m = btn.getAttribute('data-exec-mode');
      const isActive = m === warRoomExecMode;
      if (isActive) {
        if (m === 'parallel') {
          btn.className = 'h-full px-2 rounded-md bg-amber-950/90 text-amber-200 border border-amber-500/70 font-bold transition cursor-pointer flex items-center gap-1 whitespace-nowrap';
        } else if (m === 'orchestrate_parallel') {
          btn.className = 'h-full px-2 rounded-md bg-purple-950/90 text-purple-200 border border-purple-500/70 font-bold transition cursor-pointer flex items-center gap-1 whitespace-nowrap';
        } else {
          btn.className = 'h-full px-2 rounded-md bg-cyan-950 text-cyan-200 border border-cyan-500/60 font-bold transition cursor-pointer flex items-center gap-1 whitespace-nowrap';
        }
      } else {
        btn.className = 'h-full px-2 rounded-md text-slate-400 hover:text-slate-200 border border-transparent transition cursor-pointer flex items-center gap-1 whitespace-nowrap';
      }
    });
  }

  const reviewBtn = document.getElementById('btn-warroom-review-plan');
  if (reviewBtn) {
    reviewBtn.classList.remove('hidden');
    reviewBtn.classList.add('flex');
  }

  const depthSelect = document.getElementById('warroom-turns-depth-select');
  if (depthSelect) {
    Array.from(depthSelect.options).forEach(opt => {
      const v = parseInt(opt.value, 10);
      if (warRoomExecMode === 'sequential') {
        opt.textContent = v === 1 ? '1 Turn' : `${v} Turns`;
      } else if (warRoomExecMode === 'parallel') {
        opt.textContent = v === 1 ? '1 Wave' : `${v} Waves`;
      } else {
        opt.textContent = v === 1 ? '1 Wave (Plan+Swarm)' : `${v} Waves (+Synth)`;
      }
    });
    depthSelect.title = warRoomExecMode === 'sequential'
      ? 'Autonomous Discussion Depth (Max Sequential Turns per prompt)'
      : warRoomExecMode === 'parallel'
      ? 'Parallel Swarm Waves (1 Wave = single parallel pass; 2+ Waves = follow-up parallel handoffs)'
      : 'Plan -> Swarm Depth (1 Wave = Plan + Parallel Swarm; 2+ Waves adds final Lead Synthesis)';
  }

  const input = document.getElementById('warroom-text-input');
  if (input) {
    if (warRoomExecMode === 'parallel') {
      input.placeholder = '⚡ Swarm: tag 2+ @Agents or @everyone to run in parallel (untagged broadcasts room)...';
    } else if (warRoomExecMode === 'orchestrate_parallel') {
      input.placeholder = '👑 Plan→Swarm: tag @Lead + @Workers (or leave untagged for auto-Lead)...';
    } else {
      input.placeholder = 'Type @Agent, @user (Ctrl+Enter to Send / Queue, Shift+Enter to Interrupt)...';
    }
  }
};

window.handleWarRoomInterruptClick = handleWarRoomInterruptClick;

async function sendWarRoomChat() {
  const input = document.getElementById('warroom-text-input');
  let text = input ? input.value.trim() : '';
  const attList = Array.isArray(activeChatAttachment.warroom) ? activeChatAttachment.warroom : [];
  if (!text && attList.length === 0) return;

  if (attList.length > 0) {
    const linkMd = formatBatchAttachmentsMarkdown(attList);
    const defaultHeader = attList.length === 1
      ? `[Attached File: ${attList[0].filename}]`
      : `[Attached ${attList.length} Files: ${attList.map(a => a.filename).join(', ')}]`;
    text = text ? `${text}${linkMd}` : `${defaultHeader}${linkMd}`;
    removeChatAttachment('warroom');
  }

  if (input) {
    input.value = '';
    if (typeof autoResizeTextarea === 'function') autoResizeTextarea(input);
  }
  const popover = document.getElementById('warroom-mention-popover');
  if (popover) popover.classList.add('hidden');
  dismissWarRoomUserAlert();

  const activeInstance = (typeof currentInstanceKey !== 'undefined' && currentInstanceKey) ? currentInstanceKey : (localStorage.getItem('nexusdesk_instance') || 'agents_bs');
  const depthSelect = document.getElementById('warroom-turns-depth-select');
  const chosenTurns = depthSelect ? parseInt(depthSelect.value, 10) : 1;

  // If agents are ALREADY actively speaking, queue this directive as the NEXT turn! (BL-WAR-38)
  // The server owns the queue note in the transcript (no optimistic duplicate bubble here). If the server
  // reports `idle` our in-flight flag was stale, so fall through and dispatch the directive normally.
  if (isAgentTurnInFlight) {
    try {
      const res = await fetch('/api/war-room/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          room_id: activeWarRoomId || 'general',
          message: text,
          max_turns: chosenTurns,
          execution_mode: warRoomExecMode,
          instance: activeInstance
        })
      });
      const data = await res.json();
      if (data && data.status === 'queued') {
        renderWarRoomQueueBanner(data.queued_directives || [data.directive].filter(Boolean));
        await syncWarRoomMessages(activeWarRoomId);
        if (typeof showToast === 'function') {
          showToast('📥 Directive queued! Will execute right after current agent finishes.');
        }
        return;
      }
      // stale UI state: nothing is running server-side, so send it for real
      isAgentTurnInFlight = false;
      updateWarRoomControlsUI(false);
    } catch (qErr) {
      console.error('Queue directive failed:', qErr);
    }
  }

  // Optimistically append the User directive to the room transcript immediately
  appendWarRoomMessage({
    id: 'usr-' + Date.now(),
    room_id: activeWarRoomId || 'general',
    sender: 'Min',
    sender_type: 'user',
    text: text,
    engine: 'human',
    color: '#10b981',
    timestamp: Date.now() / 1000
  });

  const mySeq = ++warRoomDispatchSeq;
  warRoomDispatchStartedAt = Date.now();
  isAgentTurnInFlight = true;
  updateWarRoomControlsUI(true);
  stopActiveVoiceRecognition();
  updateBiDirectionalVoiceUI('thinking');

  // Pre-detect tagged agent from text to show immediate responsive feedback
  let targetAgentPreview = '';
  let targetEnginePreview = '';
  if (typeof warRoomParticipants !== 'undefined' && Array.isArray(warRoomParticipants)) {
    const found = warRoomParticipants.find(p => p.name && text.toLowerCase().includes(`@${p.name.toLowerCase()}`));
    if (found) {
      targetAgentPreview = found.name;
      targetEnginePreview = found.engine || '';
    }
  }
  if (typeof startSpeakerHeartbeat === 'function') {
    startSpeakerHeartbeat(targetAgentPreview || 'Routing Directive...', targetEnginePreview, activeWarRoomId || 'general');
  }

  const banner = document.getElementById('warroom-status-banner');
  const statusText = document.getElementById('warroom-status-text');
  if (banner) banner.classList.remove('hidden');
  if (statusText) {
    statusText.innerText = targetAgentPreview
      ? `${targetAgentPreview}: Parsing directive & room context...`
      : 'Evaluating room context & routing directive...';
  }

  // BL-WAR-23 & BL-EVO-29: Periodic incremental sync every 3.5s while turn is in-flight,
  // and every 7s actively poll /api/war-room/state to reconcile if server finished while client connection lagged
  let inFlightTick = 0;
  const inFlightSyncTimer = setInterval(async () => {
    if (!isAgentTurnInFlight) {
      clearInterval(inFlightSyncTimer);
      return;
    }
    syncWarRoomMessages(activeWarRoomId);
    inFlightTick++;
    if (inFlightTick % 2 === 0) {
      try {
        const stateRes = await fetch(`/api/war-room/state?room_id=${encodeURIComponent(activeWarRoomId || 'general')}`);
        if (stateRes.ok) {
          const stateData = await stateRes.json();
          if (stateData && stateData.active === false && isAgentTurnInFlight) {
            // Server finished! Reconcile immediately
            await syncWarRoomMessages(activeWarRoomId);
            isAgentTurnInFlight = false;
            updateWarRoomControlsUI(false);
            stopSpeakerHeartbeat(activeWarRoomId || 'general');
            clearInterval(inFlightSyncTimer);
          }
        }
      } catch (_) {}
    }
  }, 3500);

  try {
    const res = await fetch('/api/war-room/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: text,
        handoff_enabled: true,
        max_turns: chosenTurns,
        max_hops: chosenTurns,
        execution_mode: warRoomExecMode,
        pause_before_swarm: Boolean(warRoomReviewPlanBeforeSwarm),
        instance: activeInstance,
        room_id: activeWarRoomId || 'general'
      })
    });
    const data = await res.json();
    if (mySeq === warRoomDispatchSeq) isAgentTurnInFlight = false;
    clearInterval(inFlightSyncTimer);

    if (!res.ok) {
      appendWarRoomMessage({
        sender: 'NexusDesk Moderator',
        sender_type: 'system',
        text: `⚠️ [Error ${res.status}] ${data.detail || 'Directive dispatch failed.'}`,
        timestamp: Date.now() / 1000
      });
      if (handsFreeVoiceActive) scheduleBiDirectionalListen(1400);
    } else {
      // BL-WAR-23: Sync latest real messages from server; turns metadata has already been broadcast via websocket
      await syncWarRoomMessages(activeWarRoomId);
      if (handsFreeVoiceActive && !isAnyTtsActive()) {
        scheduleBiDirectionalListen(1400);
      }
    }
  } catch (e) {
    if (mySeq === warRoomDispatchSeq) isAgentTurnInFlight = false;
    // If an in-flight sync or background execution is still active, don't throw an alert if turns are arriving
    await syncWarRoomMessages(activeWarRoomId);
    const hasRecentMsgs = currentWarRoomHistory && currentWarRoomHistory.length > 0 &&
      (Date.now() / 1000 - (currentWarRoomHistory[currentWarRoomHistory.length - 1].timestamp || 0) < 60);

    if (!hasRecentMsgs) {
      appendWarRoomMessage({
        sender: 'NexusDesk Moderator',
        sender_type: 'system',
        text: `⚠️ Network error dispatching war room chat: ${e}`,
        timestamp: Date.now() / 1000
      });
    }
    if (handsFreeVoiceActive) scheduleBiDirectionalListen(1200);
  } finally {
    clearInterval(inFlightSyncTimer);
    if (mySeq === warRoomDispatchSeq) {
      isAgentTurnInFlight = false;
      updateWarRoomControlsUI(false);
      if (banner) banner.classList.add('hidden');
    }
    await syncWarRoomMessages(activeWarRoomId);
    if (input) input.focus();
  }
}

// BL-EVO-29 & BL-EVO-34: Automatically reconcile transcript, tasks, and state when browser tab wakes up
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && typeof activeWarRoomId !== 'undefined' && activeWarRoomId) {
    syncWarRoomMessages(activeWarRoomId);
    if (typeof fetchRoomBgTasks === 'function') fetchRoomBgTasks(activeWarRoomId);
    if (typeof fetchRoomReminders === 'function') fetchRoomReminders(activeWarRoomId);
    if (typeof fetchRoomSchedules === 'function') fetchRoomSchedules(activeWarRoomId);
    if (typeof fetchRoomInquiries === 'function') fetchRoomInquiries(activeWarRoomId);
    fetch(`/api/war-room/state?room_id=${encodeURIComponent(activeWarRoomId)}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data && data.active === false && isAgentTurnInFlight) {
          isAgentTurnInFlight = false;
          if (typeof updateWarRoomControlsUI === 'function') updateWarRoomControlsUI(false);
          if (typeof stopSpeakerHeartbeat === 'function') stopSpeakerHeartbeat(activeWarRoomId);
        }
      })
      .catch(() => {});
  }
});

async function clearWarRoomHistory(resetMemory = false) {
  const targetRoom = activeWarRoomId || 'general';
  const promptMsg = resetMemory
    ? `HARD RESET: Completely wipe room transcript AND purge all agent session memories for room '${targetRoom}'?\nAll agents will start with zero recall of past topics.`
    : `Clear visible conversation transcript in this War Room (${targetRoom})?`;
  if (!confirm(promptMsg)) return;
  try {
    await fetch('/api/war-room/clear', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ room_id: targetRoom, reset_memory: resetMemory })
    });
    const container = document.getElementById('warroom-conversation');
    if (container) container.innerHTML = '';
    dismissWarRoomUserAlert();
    loadWarRoomMessages(targetRoom);
  } catch (e) {
    alert('Failed to clear war room: ' + e);
  }
}
