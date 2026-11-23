    // --- Universal Markdown & Link Renderer Initialization (BL-UI-11) ---
    function configureUniversalMarkedRenderer() {
      if (typeof marked === 'undefined') return;
      const renderer = new marked.Renderer();
      const defaultLinkRenderer = renderer.link.bind(renderer);

      renderer.link = function(href, title, text) {
        // Support marked v4/v5 signature differences if passed as object
        let linkHref = href;
        let linkTitle = title;
        let linkText = text;
        if (typeof href === 'object' && href !== null) {
          linkHref = href.href;
          linkTitle = href.title;
          linkText = href.text;
        }

        const isInternalAnchor = linkHref && linkHref.startsWith('#');
        if (isInternalAnchor) {
          return `<a href="${linkHref}" class="text-sky-400 hover:text-sky-300 underline underline-offset-2">${linkText}</a>`;
        }

        // BL-EVO-40: Local server deliverables/scratch paths interception
        if (linkHref && (linkHref.startsWith('/home/nexus_shared/') || linkHref.startsWith('deliverables/') || linkHref.startsWith('scratch/'))) {
          let absPath = linkHref;
          if (!absPath.startsWith('/home/nexus_shared/')) {
            const currentRoom = (typeof activeWarRoomId !== 'undefined' && activeWarRoomId) ? activeWarRoomId : 'general';
            absPath = `/home/nexus_shared/sandboxes/${currentRoom}/${linkHref}`;
          }
          const safePath = absPath.replace(/'/g, "\\'");
          const titleAttr = linkTitle ? ` title="${linkTitle}"` : ` title="${absPath}"`;
          return `<a href="javascript:void(0)" onclick="openFsQuickViewModal('${safePath}')"${titleAttr} class="text-sky-400 hover:text-cyan-300 underline underline-offset-2 inline-flex items-center gap-1 group font-mono cursor-pointer"><span>📄</span><span>${linkText}</span><span class="text-[9px] text-cyan-400 opacity-80 group-hover:opacity-100 transition-opacity">👁️</span></a>`;
        }

        const titleAttr = linkTitle ? ` title="${linkTitle}"` : '';
        return `<a href="${linkHref}" target="_blank" rel="noopener noreferrer"${titleAttr} class="text-sky-400 hover:text-sky-300 underline underline-offset-2 inline-flex items-center gap-0.5 group"><span>${linkText}</span><span class="text-[10px] opacity-70 group-hover:opacity-100 transition-opacity">↗</span></a>`;
      };

      marked.setOptions({
        renderer: renderer,
        breaks: true,
        gfm: true
      });
    }

    // --- WebSocket Event Listener ---
    let activeWebSocket = null;
    let wsReconnectTimeout = null;
    let wsPingInterval = null;

    function initWebSocket() {
      if (activeWebSocket) {
        try {
          activeWebSocket.onclose = null;
          activeWebSocket.onerror = null;
          activeWebSocket.close();
        } catch (e) {}
        activeWebSocket = null;
      }
      if (wsReconnectTimeout) {
        clearTimeout(wsReconnectTimeout);
        wsReconnectTimeout = null;
      }
      if (wsPingInterval) {
        clearInterval(wsPingInterval);
        wsPingInterval = null;
      }

      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const token = localStorage.getItem('nexusdesk_token') || '';
      const inst = (typeof currentInstanceKey !== 'undefined' && currentInstanceKey) ? currentInstanceKey : (localStorage.getItem('nexusdesk_instance') || 'agents_bs');
      const wsUrl = `${proto}//${window.location.host}/ws/events?token=${encodeURIComponent(token)}&instance=${encodeURIComponent(inst)}`;
      const ws = new WebSocket(wsUrl);
      activeWebSocket = ws;

      ws.onopen = () => {
        // BL-WAR-23: Periodic 20s keepalive ping prevents silent proxy/NAT timeouts
        if (wsPingInterval) clearInterval(wsPingInterval);
        wsPingInterval = setInterval(() => {
          if (activeWebSocket && activeWebSocket.readyState === WebSocket.OPEN) {
            try {
              activeWebSocket.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
            } catch (e) {}
          }
        }, 20000);

        // Reconnect delta sync: retrieve any messages missed while disconnected
        if (typeof syncWarRoomMessages === 'function' && typeof currentConsoleMode !== 'undefined' && currentConsoleMode === 'warroom') {
          syncWarRoomMessages(undefined, true);
        }
      };

      ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload.type === 'pong') {
            // Heartbeat acknowledged by server
            return;
          }
          if (payload.type === 'agent_state') {
            const ag = agents.find(a => a.name.toLowerCase() === payload.data.agent.toLowerCase());
            if (ag) {
              ag.state = payload.data.state;
              if (typeof renderConsoleAgentCards === 'function') renderConsoleAgentCards();
              if (selectedAgent && (selectedAgent.name.toLowerCase() === payload.data.agent.toLowerCase() || selectedAgent.id === ag.id)) {
                const stateBadge = document.getElementById('chat-agent-state');
                if (stateBadge) {
                  const st = (payload.data.state || 'ready').toLowerCase();
                  if (st === 'working') {
                    stateBadge.innerText = 'WORKING';
                    stateBadge.className = 'text-[8.5px] sm:text-[9px] font-mono px-1.5 sm:px-2 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-800 animate-pulse shrink-0';
                  } else {
                    stateBadge.innerText = 'READY';
                    stateBadge.className = 'text-[8.5px] sm:text-[9px] font-mono px-1.5 sm:px-2 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-800 shrink-0';
                  }
                }
              }
            }
          } else if (payload.type === 'briefing_start') {
            triggerBriefingSimulation();
          } else if (payload.type === 'gossip_start') {
            triggerGossipSimulation();
          } else if (payload.type === 'auth_config_changed') {
            updateSecurityBadge(payload.data);
          } else if (payload.type === 'agent_shout') {
            // Speech bubbles on the 2.5D/3D office floor & TTS announcements (not injected into 1-on-1 chat)
            if (typeof handleAgentShout === 'function') {
              handleAgentShout(payload.data);
            }
          } else if (payload.type === 'fleet_discovered') {
            // BL-SYS-05: Dynamic Zero-Reload Discovery for Newly Provisioned VPS Users
            if (typeof loadInstances === 'function') {
              loadInstances();
            }
            const toastEl = document.getElementById('fleet-discovered-toast');
            if (toastEl) {
              const label = payload.data?.label || `${payload.data?.key || 'New'} Fleet`;
              toastEl.innerText = `✨ Discovered: ${label}!`;
              toastEl.classList.remove('hidden');
              setTimeout(() => toastEl.classList.add('hidden'), 4000);
            }
          } else if (payload.type && payload.type.startsWith('war_room')) {
            // BL-CHAT-18: Multi-Agent Conference War Room Transcript Bus & Choreography
            if (typeof handleWarRoomWebSocketEvent === 'function') {
              handleWarRoomWebSocketEvent(payload);
            }
          } else if (payload.type && payload.type.startsWith('workflow_')) {
            // BL-AUTO-36: Multi-Agent Workflow Runner Live Events
            if (typeof handleWorkflowWebSocketEvent === 'function') {
              handleWorkflowWebSocketEvent(payload);
            }
          } else if (payload.type && (payload.type.startsWith('self_evolving') || payload.type === 'telemetry_event_recorded')) {
            // BL-SYS-21 & BL-SYS-22: Self-Evolving Hub Observability & Backlog Events
            if (typeof handleSelfEvolvingWebSocketEvent === 'function') {
              handleSelfEvolvingWebSocketEvent(payload.type, payload.data || payload);
            }
          }
        } catch (e) {}
      };

      ws.onclose = () => {
        if (wsPingInterval) {
          clearInterval(wsPingInterval);
          wsPingInterval = null;
        }
        wsReconnectTimeout = setTimeout(initWebSocket, 3000);
      };

      ws.onerror = () => {
        try { ws.close(); } catch (e) {}
      };
    }

    // --- Initialization ---
    window.addEventListener('DOMContentLoaded', () => {
      checkAuthStatus();
      loadInstances();
      loadToolsAndMcpHub();
      initSidebar();
      initSidebarGroups();
      initSpeechEngine();
      // Sync initial TTS mute state UI icons from persisted state
      const ttsOn = document.getElementById('tts-icon-on');
      const ttsOff = document.getElementById('tts-icon-off');
      const ttsOnMob = document.getElementById('tts-icon-on-mob');
      const ttsOffMob = document.getElementById('tts-icon-off-mob');
      if (ttsOn && ttsOff) {
        ttsOn.classList.toggle('hidden', !audioResponseEnabled);
        ttsOff.classList.toggle('hidden', audioResponseEnabled);
      }
      if (ttsOnMob && ttsOffMob) {
        ttsOnMob.classList.toggle('hidden', !audioResponseEnabled);
        ttsOffMob.classList.toggle('hidden', audioResponseEnabled);
      }
      configureUniversalMarkedRenderer();
      initWebSocket();
      updateLiveClocks();
      setInterval(updateLiveClocks, 1000);
      renderOfficeCanvas();
      selectAgent(agents[0]);
      if (typeof renderConsoleTabs === 'function') renderConsoleTabs();
      if (typeof loadWarRoomRooms === 'function') loadWarRoomRooms();
      if (typeof loadWarRoomParticipants === 'function') loadWarRoomParticipants();
      let initialTab = (window.location.hash || '').replace('#', '') || 'floor';
      let subMode = '';
      if (initialTab.includes(':')) {
        [initialTab, subMode] = initialTab.split(':');
      }
      switchMainTab(initialTab);
      if (initialTab === 'console' && subMode && typeof switchConsoleMode === 'function') {
        setTimeout(() => {
          if (subMode === 'warroom') {
            const warTab = (typeof consoleTabs !== 'undefined') ? consoleTabs.find(t => t.type === 'warroom') : null;
            if (warTab && typeof activateConsoleTab === 'function') {
              activateConsoleTab(warTab.id);
            } else {
              switchConsoleMode('warroom');
            }
          }
        }, 150);
      }
      refreshTelemetry();
      setInterval(refreshTelemetry, 5000);
      if (typeof refreshDaemonTelemetry === 'function') {
        refreshDaemonTelemetry();
        setInterval(refreshDaemonTelemetry, 5000);
      }
      syncLiveHermesAgentActivity();
      setInterval(syncLiveHermesAgentActivity, 2500);

      // Event delegation for MCP modal triggers to ensure 100% responsiveness on mobile & touch devices
      document.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-mcp-target], [onclick*="openMcpConfigModal"]');
        if (btn && !btn.getAttribute('data-delegated-bound')) {
          btn.setAttribute('data-delegated-bound', 'true');
        }
      });
      // Close modal on backdrop click
      const mcpModal = document.getElementById('mcp-config-modal');
      if (mcpModal) {
        mcpModal.addEventListener('click', (e) => {
          if (e.target === mcpModal) closeMcpConfigModal();
        });
      }

      // Window Focus & Visibility Auto-Sync (BL-SYS-03, BL-WAR-23):
      // Quietly revalidate fleet states & War Room messages when returning to tab
      window.addEventListener('focus', () => {
        if (typeof syncAllFleetState === 'function') {
          syncAllFleetState(false);
        }
        if (typeof syncWarRoomMessages === 'function' && typeof currentConsoleMode !== 'undefined' && currentConsoleMode === 'warroom') {
          syncWarRoomMessages(undefined, true);
        }
      });

      document.addEventListener('visibilitychange', () => {
        if (!document.hidden && typeof syncWarRoomMessages === 'function' && typeof currentConsoleMode !== 'undefined' && currentConsoleMode === 'warroom') {
          syncWarRoomMessages(undefined, true);
        }
      });

      // Auto-hide sidebar nav buttons whose tab partial is not included in this edition (e.g. OSS)
      document.querySelectorAll('.sidebar-nav-btn[data-tab]').forEach((btn) => {
        const tabId = btn.getAttribute('data-tab');
        if (tabId && !document.getElementById(`tab-${tabId}`)) {
          btn.style.display = 'none';
        }
      });
    });
