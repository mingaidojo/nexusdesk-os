    // --- Agent Stations & Autonomous State Machine ---
    // Realistic positioning inside the architectural office floor
    let agents = [
      {
        id: 'solaris',
        name: 'Solaris',
        role: 'Lead orchestrator & router',
        workspace: 'orchestrator',
        x: 160,
        y: 130,
        homeX: 160,
        homeY: 130,
        targetX: 160,
        targetY: 130,
        speed: 0.9,
        color: '#10b981',
        theme: 'orchestrator',
        hairColor: '#1e293b',
        shirtColor: '#0f172a',
        state: 'working', // working, walking, gossiping, sleeping, whistling, playing_phone, briefing
        stateTimer: 2800, // 45+ seconds of steady work
        dialogue: null,
        dialogueTimer: 0,
        voice: { pitch: 0.85, rate: 1.0, gender: 'male', voiceName: '' }
      },
      {
        id: 'scribe',
        name: 'Scribe',
        role: 'Customer care & ticket triage',
        workspace: 'support_tickets',
        x: 380,
        y: 250,
        homeX: 380,
        homeY: 250,
        targetX: 380,
        targetY: 250,
        speed: 0.85,
        color: '#38bdf8',
        theme: 'support',
        hairColor: '#451a03',
        shirtColor: '#0284c7',
        state: 'working',
        stateTimer: 3200,
        dialogue: null,
        dialogueTimer: 0,
        voice: { pitch: 1.15, rate: 0.95, gender: 'female', voiceName: '' }
      },
      {
        id: 'chorusius',
        name: 'Chorusius',
        role: 'Community & devotions broadcaster',
        workspace: 'community_drafts',
        x: 530,
        y: 250,
        homeX: 530,
        homeY: 250,
        targetX: 530,
        targetY: 250,
        speed: 0.9,
        color: '#f59e0b',
        theme: 'broadcast',
        hairColor: '#d97706',
        shirtColor: '#b45309',
        state: 'working',
        stateTimer: 2500,
        dialogue: null,
        dialogueTimer: 0,
        voice: { pitch: 1.05, rate: 1.0, gender: 'male', voiceName: '' }
      },
      {
        id: 'lore',
        name: 'Lore',
        role: 'Theology & scripture research',
        workspace: 'theology_research',
        x: 680,
        y: 250,
        homeX: 680,
        homeY: 250,
        targetX: 680,
        targetY: 250,
        speed: 0.8,
        color: '#a855f7',
        theme: 'theology',
        hairColor: '#94a3b8',
        shirtColor: '#6b21a8',
        state: 'working',
        stateTimer: 3400,
        dialogue: null,
        dialogueTimer: 0,
        voice: { pitch: 0.95, rate: 0.9, gender: 'male', voiceName: '' }
      },
      {
        id: 'chroma',
        name: 'Chroma',
        role: 'Creative director & visuals',
        workspace: 'creative_assets',
        x: 380,
        y: 390,
        homeX: 380,
        homeY: 390,
        targetX: 380,
        targetY: 390,
        speed: 0.9,
        color: '#ec4899',
        theme: 'creative',
        hairColor: '#db2777',
        shirtColor: '#9d174d',
        state: 'working',
        stateTimer: 2900,
        dialogue: null,
        dialogueTimer: 0,
        voice: { pitch: 1.25, rate: 1.05, gender: 'female', voiceName: '' }
      },
      {
        id: 'pylon',
        name: 'Pylon',
        role: 'Sysadmin & VPS health',
        workspace: 'sys_logs',
        x: 530,
        y: 390,
        homeX: 530,
        homeY: 390,
        targetX: 530,
        targetY: 390,
        speed: 0.95,
        color: '#6366f1',
        theme: 'sysadmin',
        hairColor: '#1e293b',
        shirtColor: '#3730a3',
        state: 'working',
        stateTimer: 2100,
        dialogue: null,
        dialogueTimer: 0,
        voice: { pitch: 0.8, rate: 1.15, gender: 'male', voiceName: '' }
      }
    ];

    // --- Responsive Collapsible Sidebar Logic ---
    let isSidebarCollapsed = false;

    function initSidebar() {
      const saved = localStorage.getItem('nexusdesk_sidebar_collapsed');
      if (saved === 'true') {
        setSidebarCollapsed(true, false);
      } else if (saved === 'false') {
        setSidebarCollapsed(false, false);
      } else {
        // BL-UI-50: Auto-collapse to mini-rail (60px) on tablet viewports (768px - 1100px) by default
        const isTablet = window.innerWidth >= 768 && window.innerWidth <= 1100;
        setSidebarCollapsed(isTablet, false);
      }
    }

    function toggleSidebarCollapse() {
      setSidebarCollapsed(!isSidebarCollapsed, true);
    }

    function setSidebarCollapsed(collapsed, save = true) {
      isSidebarCollapsed = collapsed;
      if (save) localStorage.setItem('nexusdesk_sidebar_collapsed', collapsed ? 'true' : 'false');

      const sidebar = document.getElementById('main-sidebar');
      const toggleBtn = document.getElementById('btn-toggle-sidebar');
      const chevron = document.getElementById('sidebar-toggle-chevron');
      const bottomToggleText = document.getElementById('sidebar-bottom-toggle-text');
      const bottomToggleIcon = document.getElementById('sidebar-bottom-toggle-icon');
      const labels = document.querySelectorAll('.sidebar-label');
      const headers = document.querySelectorAll('.sidebar-group-header');

      if (!sidebar) return;

      if (collapsed) {
        sidebar.classList.remove('w-64');
        sidebar.classList.add('w-[72px]');
        labels.forEach(el => el.classList.add('hidden'));
        headers.forEach(el => el.classList.add('hidden'));
        if (chevron) chevron.innerText = '▶';
        if (bottomToggleText) bottomToggleText.classList.add('hidden');
        if (bottomToggleIcon) bottomToggleIcon.innerText = '▶';
      } else {
        sidebar.classList.remove('w-[72px]');
        sidebar.classList.add('w-64');
        labels.forEach(el => el.classList.remove('hidden'));
        headers.forEach(el => el.classList.remove('hidden'));
        if (chevron) chevron.innerText = '◀';
        if (bottomToggleText) bottomToggleText.classList.remove('hidden');
        if (bottomToggleIcon) bottomToggleIcon.innerText = '◀';
      }
    }

    function toggleMobileSidebar(open) {
      const sidebar = document.getElementById('main-sidebar');
      const backdrop = document.getElementById('sidebar-backdrop');
      if (!sidebar || !backdrop) return;
      if (open) {
        sidebar.classList.remove('-translate-x-full');
        sidebar.classList.add('translate-x-0');
        backdrop.classList.remove('hidden');
      } else {
        sidebar.classList.add('-translate-x-full');
        sidebar.classList.remove('translate-x-0');
        backdrop.classList.add('hidden');
      }
    }

    function closeMobileSidebarIfMobile() {
      if (window.innerWidth < 768) {
        toggleMobileSidebar(false);
      }
    }

    // --- Tab Switching with Breadcrumbs & Render Triggers ---
    function switchMainTab(tab) {
      let targetTab = tab;
      if (targetTab === 'tools') targetTab = 'tools-matrix';
      if (targetTab === 'models') targetTab = 'models-agents';
      if (targetTab === 'modellib') targetTab = 'models-library';
      activeTab = targetTab;

      const allTabs = [
        'floor', 'console', 'roster', 'memory',
        'tools-matrix', 'tools-configured', 'tools-catalog',
        'models-agents', 'models-failover', 'models-reasoning', 'models-memory', 'models-library',
        'chat-agents', 'crons', 'workflows', 'security', 'system-daemon', 'system-logs', 'system-dispatcher', 'system-storage', 'system-gateways', 'system-profile', 'self-evolving', 'guide'
      ];
      allTabs.forEach(t => {
        const el = document.getElementById(`tab-${t}`);
        if (el) el.classList.toggle('hidden', t !== targetTab);
      });

      // BL-UI-40, BL-UI-41, BL-UI-46, BL-UI-59: Console view vs Standard scrollable page views
      const contentWrapper = document.getElementById('content-wrapper');
      const mainEl = document.querySelector('main');
      const footerEl = document.getElementById('main-footer');
      if (targetTab === 'console') {
        document.documentElement.classList.add('console-active-mode');
        document.body.classList.add('console-active-mode');
        if (contentWrapper) {
          contentWrapper.classList.add('overflow-hidden');
          contentWrapper.classList.remove('overflow-y-auto');
        }
        if (mainEl) {
          mainEl.classList.add('overflow-hidden', 'p-2', 'sm:p-3', 'pb-0', 'sm:pb-0');
          mainEl.classList.remove('p-3', 'sm:p-5', 'pb-16', 'sm:pb-20');
        }
        if (footerEl) {
          footerEl.classList.remove('hidden');
          footerEl.classList.add('console-docked-footer');
        }
      } else {
        document.documentElement.classList.remove('console-active-mode');
        document.body.classList.remove('console-active-mode');
        if (contentWrapper) {
          contentWrapper.classList.remove('overflow-hidden');
          contentWrapper.classList.add('overflow-y-auto');
        }
        if (mainEl) {
          mainEl.classList.remove('overflow-hidden', 'pb-0', 'sm:pb-0');
          mainEl.classList.add('p-3', 'sm:p-5', 'pb-16', 'sm:pb-20');
        }
        if (footerEl) {
          footerEl.classList.remove('hidden', 'console-docked-footer');
        }
      }

      // Reset window scroll to top on tab switch so no section title is occluded
      window.scrollTo({ top: 0, behavior: 'instant' });

      // Update active state on sidebar navigation buttons
      document.querySelectorAll('.sidebar-nav-btn').forEach(btn => {
        const bTab = btn.dataset.tab;
        const isParentActive = (
          bTab === targetTab ||
          (bTab === 'crons' && targetTab === 'crons') ||
          (bTab === 'workflows' && targetTab === 'workflows') ||
          (bTab === 'security' && targetTab === 'security')
        );
        if (isParentActive) {
          btn.className = 'sidebar-nav-btn group w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg transition font-medium text-[11px] text-left relative bg-emerald-600/20 text-emerald-300 border border-emerald-500/40 shadow-sm';
          const ind = btn.querySelector('.sidebar-active-indicator');
          if (ind) ind.classList.remove('hidden');
        } else {
          btn.className = 'sidebar-nav-btn group w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg transition font-medium text-[11px] text-left relative text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 border border-transparent';
          const ind = btn.querySelector('.sidebar-active-indicator');
          if (ind) ind.classList.add('hidden');
        }
      });

      // Update active state on sidebar sub-buttons
      document.querySelectorAll('.sidebar-sub-btn').forEach(btn => {
        const sTab = btn.dataset.subtab;
        if (sTab && sTab === targetTab) {
          btn.classList.add('bg-cyan-950/80', 'text-cyan-300', 'font-bold', 'border-l-2', 'border-cyan-400');
          btn.classList.remove('text-slate-400');
        } else {
          btn.classList.remove('bg-cyan-950/80', 'text-cyan-300', 'font-bold', 'border-l-2', 'border-cyan-400');
          btn.classList.add('text-slate-400');
        }
      });

      // Update breadcrumb title and badge in top bar
      const breadcrumbTitles = {
        floor: 'AgentFloor',
        console: 'Call Agent',
        roster: 'Agent Roster',
        memory: 'Memory Vault',
        'tools-matrix': 'Tools Privilege Matrix',
        'tools-configured': 'Configured Daemons',
        'tools-catalog': 'Verified MCP Catalog',
        'models-agents': 'Models & Roles',
        'models-failover': 'Global Failover Chain',
        'models-reasoning': 'Reasoning Budgets',
        'models-memory': 'Context Meters',
        'models-library': 'Model Specifications',
        'chat-agents': 'Chat Agents & Multi-SIM Workspaces',
        crons: 'Autonomous Cron Pipelines',
        workflows: 'Multi-Agent Workflows',
        security: 'Security & Access Keys',
        'system-daemon': 'Daemon & Restart',
        'system-logs': 'Systemd Journal Logs',
        'system-dispatcher': 'War Room Dispatcher Settings',
        'system-storage': 'Storage & Archival',
        'system-gateways': 'Outbound Gateways',
        'system-profile': 'User Profile',
        'self-evolving': 'Self-Evolving Hub',
        guide: 'Feature Guide & Playbook'
      };
      const breadcrumbBadges = {
        floor: 'VIRTUAL OFFICE',
        console: 'VOICE CONSOLE',
        roster: 'FLEET ROSTER',
        memory: 'KNOWLEDGE VAULT',
        'tools-matrix': 'PRIVILEGES',
        'tools-configured': 'ACTIVE DAEMONS',
        'tools-catalog': 'VERIFIED MCP',
        'models-agents': 'ROLES & LLM',
        'models-failover': 'FAILOVER CHAIN',
        'models-reasoning': 'THINKING EFFORT',
        'models-memory': 'CONTEXT METERS',
        'models-library': 'MODEL SPECS',
        'chat-agents': 'SIM AUTOMATION',
        crons: 'CRON JOBS',
        workflows: 'MULTI-AGENT DAG',
        security: 'ACCESS KEYS',
        'system-daemon': 'SYSTEMD SERVICE',
        'system-logs': 'JOURNALCTL',
        'system-dispatcher': 'DISPATCHER RULES',
        'system-storage': 'RETENTION & ARCHIVES',
        'system-gateways': 'OPERATOR ALERTS',
        'self-evolving': 'OBSERVABILITY & BACKLOG',
        guide: 'HELP & DOCS'
      };

      const bTitleEl = document.getElementById('header-breadcrumb-title');
      if (bTitleEl) bTitleEl.innerText = breadcrumbTitles[targetTab] || targetTab.toUpperCase();

      const bBadgeEl = document.getElementById('header-breadcrumb-badge');
      if (bBadgeEl) bBadgeEl.innerText = breadcrumbBadges[targetTab] || 'COMMAND HUB';

      if (targetTab === 'console') renderConsoleAgentCards();
      if (targetTab === 'guide' && typeof renderGuideTab === 'function') renderGuideTab();
      if (targetTab === 'memory') loadMemoryExplorer(activeEditorAgent);
      if (targetTab.startsWith('tools-')) loadToolsAndMcpHub();
      if (targetTab.startsWith('models-')) loadModelsConfig();
      if (targetTab === 'chat-agents' && typeof loadChatAgentsHub === 'function') loadChatAgentsHub();
      if (targetTab === 'crons') loadCronsTable();
      if (targetTab === 'workflows') {
        loadWorkflowsDAG();
        if (typeof loadWorkflowRunsHistory === 'function') loadWorkflowRunsHistory();
      }
      if (targetTab === 'roster') renderFleetRoster();
      if (targetTab === 'security') syncSecuritySettingsTab();
      if (targetTab === 'system-gateways' && typeof loadGateways === 'function') loadGateways();
      if (targetTab === 'system-storage' && typeof loadSystemStorage === 'function') loadSystemStorage();
      if (targetTab === 'system-profile' && typeof loadUserProfileSettings === 'function') loadUserProfileSettings();
      if (targetTab === 'self-evolving' && typeof fetchSelfEvolvingData === 'function') fetchSelfEvolvingData();
    }

    window.nexusOperatorName = window.nexusOperatorName || 'User';
    window.nexusUserTzOffset = (typeof window.nexusUserTzOffset === 'number')
      ? window.nexusUserTzOffset
      : (parseFloat(localStorage.getItem('nexusdesk_user_tz_offset')) || 7.0);
    window.nexusUserTzLabel = window.nexusUserTzLabel || localStorage.getItem('nexusdesk_user_tz_name') || 'GMT+7';

    window.formatNexusDateTime = function(unixSec, includeSeconds = true) {
      if (!unixSec) return '';
      const tzOffset = (typeof window.nexusUserTzOffset === 'number')
        ? window.nexusUserTzOffset
        : (parseFloat(localStorage.getItem('nexusdesk_user_tz_offset')) || 7.0);
      const d = new Date((Number(unixSec) + tzOffset * 3600) * 1000);
      const pad = (n) => String(n).padStart(2, '0');
      const datePart = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
      const timePart = includeSeconds
        ? `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
        : `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
      return `${datePart} ${timePart}`;
    };

    window.loadUserProfileSettings = async function() {
      try {
        const res = await fetch('/api/system/profile');
        if (res.ok) {
          const data = await res.json();
          const name = (data.display_name || 'User').trim();
          const tzOffset = (data.tz_offset !== undefined && !isNaN(parseFloat(data.tz_offset))) ? parseFloat(data.tz_offset) : 7.0;
          const tzLabel = (data.tz_label || `GMT${tzOffset >= 0 ? '+' : ''}${tzOffset}`).trim();

          window.nexusOperatorName = name;
          window.nexusUserTzOffset = tzOffset;
          window.nexusUserTzLabel = tzLabel;
          localStorage.setItem('nexusdesk_user_tz_offset', String(tzOffset));
          localStorage.setItem('nexusdesk_user_tz_name', tzLabel);

          const inp = document.getElementById('sys-profile-display-name');
          if (inp) inp.value = name;
          const tzSel = document.getElementById('sys-profile-timezone');
          if (tzSel) {
            for (let i = 0; i < tzSel.options.length; i++) {
              const [val] = tzSel.options[i].value.split('|');
              if (parseFloat(val) === tzOffset) {
                tzSel.selectedIndex = i;
                break;
              }
            }
          }
          if (typeof updateLiveClocks === 'function') updateLiveClocks();
          if (typeof updateUserProfilePreview === 'function') updateUserProfilePreview();
        }
      } catch (_) {}
    };

    window.updateUserProfilePreview = function() {
      const inp = document.getElementById('sys-profile-display-name');
      const tzSel = document.getElementById('sys-profile-timezone');
      const val = (inp ? inp.value.trim() : '') || window.nexusOperatorName || 'User';
      let tzOffset = window.nexusUserTzOffset || 7.0;
      let tzLabel = window.nexusUserTzLabel || 'GMT+7';
      if (tzSel && tzSel.value) {
        const [offStr, lblStr] = tzSel.value.split('|');
        tzOffset = parseFloat(offStr);
        tzLabel = lblStr || tzLabel;
      }
      const bEl = document.getElementById('sys-profile-preview-bubble');
      const mEl = document.getElementById('sys-profile-preview-mention');
      const tEl = document.getElementById('sys-profile-preview-time');
      if (bEl) bEl.innerText = `👤 ${val}`;
      if (mEl) mEl.innerText = `👤 @${val}`;
      if (tEl) {
        const nowSec = Math.floor(Date.now() / 1000);
        const d = new Date((nowSec + tzOffset * 3600) * 1000);
        const pad = (n) => String(n).padStart(2, '0');
        tEl.innerText = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} (${tzLabel})`;
      }
    };

    window.saveUserProfileSettings = async function() {
      const inp = document.getElementById('sys-profile-display-name');
      const tzSel = document.getElementById('sys-profile-timezone');
      const btn = document.getElementById('btn-save-user-profile');
      const name = (inp ? inp.value.trim() : '') || 'User';
      let tzOffset = window.nexusUserTzOffset || 7.0;
      let tzLabel = window.nexusUserTzLabel || 'GMT+7';
      if (tzSel && tzSel.value) {
        const [offStr, lblStr] = tzSel.value.split('|');
        tzOffset = parseFloat(offStr);
        tzLabel = lblStr || `GMT${tzOffset >= 0 ? '+' : ''}${tzOffset}`;
      }
      if (btn) btn.disabled = true;
      try {
        const res = await fetch('/api/system/profile', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ display_name: name, tz_offset: tzOffset, tz_label: tzLabel })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
        window.nexusOperatorName = data.display_name || name;
        window.nexusUserTzOffset = (data.tz_offset !== undefined) ? parseFloat(data.tz_offset) : tzOffset;
        window.nexusUserTzLabel = data.tz_label || tzLabel;
        localStorage.setItem('nexusdesk_user_tz_offset', String(window.nexusUserTzOffset));
        localStorage.setItem('nexusdesk_user_tz_name', window.nexusUserTzLabel);
        updateUserProfilePreview();
        if (typeof updateLiveClocks === 'function') updateLiveClocks();
        if (typeof loadCronsTable === 'function') loadCronsTable();
        if (typeof showToast === 'function') showToast(`Profile saved: ${window.nexusOperatorName} (${window.nexusUserTzLabel})`, 'success');
      } catch (e) {
        if (typeof showToast === 'function') showToast(`Failed to save profile: ${e.message}`, 'error');
      } finally {
        if (btn) btn.disabled = false;
      }
    };

    document.addEventListener('DOMContentLoaded', () => {
      loadUserProfileSettings();
    });

    function scrollToToolsSection(sec) {
      setTimeout(() => {
        let el = null;
        if (sec === 'matrix') el = document.getElementById('tools-section-matrix');
        else if (sec === 'configured') el = document.getElementById('tools-section-configured');
        else if (sec === 'catalog') el = document.getElementById('tools-section-catalog');
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 50);
    }

    function scrollToModelSection(sec) {
      setTimeout(() => {
        let el = null;
        if (sec === 'agents') el = document.getElementById('models-section-agents');
        else if (sec === 'failover') el = document.getElementById('models-section-failover');
        else if (sec === 'reasoning') el = document.getElementById('global-reasoning-select');
        else if (sec === 'memory') el = document.getElementById('model-specs-section');
        else if (sec === 'library') el = document.getElementById('model-library-grid');
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 50);
    }

    // --- Sidebar Collapsible Group Manager with localStorage Persistence ---
    function toggleSidebarGroup(groupId) {
      const itemsEl = document.getElementById(`group-items-${groupId}`);
      const chevronEl = document.getElementById(`chevron-${groupId}`);
      if (!itemsEl) return;

      const isCurrentlyHidden = itemsEl.classList.contains('hidden');
      if (isCurrentlyHidden) {
        itemsEl.classList.remove('hidden');
        if (chevronEl) chevronEl.innerText = '▾';
        localStorage.setItem(`nexusdesk_grp_${groupId}`, 'open');
      } else {
        itemsEl.classList.add('hidden');
        if (chevronEl) chevronEl.innerText = '▸';
        localStorage.setItem(`nexusdesk_grp_${groupId}`, 'collapsed');
      }
    }

    function initSidebarGroups() {
      const groups = ['operations', 'models', 'tools', 'automation', 'system'];
      groups.forEach(g => {
        const saved = localStorage.getItem(`nexusdesk_grp_${g}`);
        if (saved === 'collapsed') {
          const itemsEl = document.getElementById(`group-items-${g}`);
          const chevronEl = document.getElementById(`chevron-${g}`);
          if (itemsEl) itemsEl.classList.add('hidden');
          if (chevronEl) chevronEl.innerText = '▸';
        }
      });
    }

    // =========================================================================
    // SYSTEM DAEMON TELEMETRY & RESTART CONTROLLER (BL-SYS-06)
    // =========================================================================
    async function refreshDaemonTelemetry() {
      try {
        const res = await fetch('/api/system/daemon/status');
        if (!res.ok) return;
        const data = await res.json();
        
        const badge = document.getElementById('daemon-badge-status');
        const pidEl = document.getElementById('daemon-info-pid');
        const memEl = document.getElementById('daemon-info-mem');
        const startEl = document.getElementById('daemon-info-started');
        const dot = document.getElementById('daemon-active-dot');

        // BL-SYS-20: Top Header Quick Daemon Telemetry Pill
        const headerDot = document.getElementById('header-daemon-dot');
        const headerStatus = document.getElementById('header-daemon-status');
        if (headerDot && headerStatus) {
          if (data.active) {
            headerDot.className = 'w-2 h-2 rounded-full bg-emerald-400 animate-pulse';
            headerStatus.className = 'text-[10px] text-emerald-300 font-semibold font-mono tracking-tight';
            headerStatus.innerText = 'nexusdesk: active';
          } else {
            headerDot.className = 'w-2 h-2 rounded-full bg-rose-500';
            headerStatus.className = 'text-[10px] text-rose-300 font-semibold font-mono tracking-tight';
            headerStatus.innerText = `nexusdesk: ${(data.status || 'stopped').toLowerCase()}`;
          }
        }

        if (badge) {
          if (data.active) {
            badge.className = 'px-2.5 py-1 rounded bg-emerald-950/80 border border-emerald-800/80 text-[10px] text-emerald-300 font-mono font-semibold uppercase';
            badge.innerText = `STATUS: ACTIVE (${(data.status || 'running').toUpperCase()})`;
          } else {
            badge.className = 'px-2.5 py-1 rounded bg-rose-950/80 border border-rose-800/80 text-[10px] text-rose-300 font-mono font-semibold uppercase';
            badge.innerText = `STATUS: INACTIVE (${(data.status || 'stopped').toUpperCase()})`;
          }
        }
        if (dot) {
          if (data.active) {
            dot.innerHTML = '<span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span> ACTIVE';
            dot.className = 'flex items-center gap-1 text-[10px] text-emerald-400 font-mono';
          } else {
            dot.innerHTML = '<span class="w-2 h-2 rounded-full bg-rose-400"></span> INACTIVE';
            dot.className = 'flex items-center gap-1 text-[10px] text-rose-400 font-mono';
          }
        }
        if (pidEl && data.pid) pidEl.innerText = data.pid;
        if (memEl && data.memory_mb) memEl.innerText = `${data.memory_mb} MB`;
        if (startEl && data.started_at) startEl.innerText = data.started_at;
      } catch (e) {
        console.warn('Failed to fetch daemon telemetry:', e);
      }
    }

    async function refreshDaemonLogs() {
      const logsEl = document.getElementById('daemon-systemd-logs');
      if (!logsEl) return;
      logsEl.innerText = 'Refreshing logs...';
      try {
        const res = await fetch('/api/system/daemon/logs?lines=50');
        const data = await res.json();
        logsEl.innerText = data.logs || 'No recent logs.';
        logsEl.scrollTop = logsEl.scrollHeight;
      } catch (e) {
        logsEl.innerText = 'Failed to load logs: ' + e;
      }
    }

    async function confirmRestartNexusDesk() {
      const ok = confirm("Are you sure you want to restart the NexusDesk daemon (nexusdesk.service)?\n\nThe server will cleanly reload and reconnect automatically within 3-4 seconds.");
      if (!ok) return;

      const btn = document.getElementById('btn-trigger-restart');
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span>⏳ Reloading Daemon...</span>';
        btn.className = 'px-3.5 py-2 rounded-lg text-xs font-bold flex items-center gap-1.5 bg-slate-800 text-slate-400 font-mono cursor-not-allowed';
      }

      try {
        const res = await fetch('/api/system/restart', { method: 'POST' });
        const data = await res.json();
        
        // Render reload banner
        showRestartReconnectingOverlay();
      } catch (e) {
        // Even if fetch aborts because server dies immediately, that's expected on reload!
        showRestartReconnectingOverlay();
      }
    }

    function showRestartReconnectingOverlay() {
      // Create or show modal overlay
      let overlay = document.getElementById('daemon-restart-overlay');
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'daemon-restart-overlay';
        overlay.className = 'fixed inset-0 bg-black/90 backdrop-blur-md z-[9999] flex flex-col items-center justify-center p-6 text-center font-mono space-y-4';
        overlay.innerHTML = `
          <div class="w-14 h-14 rounded-2xl bg-rose-950/80 border border-rose-600 flex items-center justify-center text-2xl animate-spin text-rose-400">
            ⚙️
          </div>
          <div class="space-y-1.5 max-w-sm">
            <h3 class="text-sm font-bold text-white font-pixel">RELOADING NEXUSDESK DAEMON</h3>
            <p class="text-xs text-slate-400 leading-relaxed">Service restart in progress (<code>sudo systemctl restart nexusdesk</code>). Waiting for FastAPI healthcheck...</p>
          </div>
          <div id="restart-countdown-box" class="px-3 py-1 rounded-full bg-slate-900 border border-slate-700 text-cyan-300 text-xs font-bold">
            Reconnecting in <span id="restart-timer-val">3</span>s...
          </div>
        `;
        document.body.appendChild(overlay);
      } else {
        overlay.classList.remove('hidden');
      }

      let countdown = 3;
      const timerEl = document.getElementById('restart-timer-val');
      const interval = setInterval(async () => {
        countdown--;
        if (timerEl) timerEl.innerText = countdown > 0 ? countdown : '0';
        if (countdown <= 0) {
          // Poll /api/system until it responds
          try {
            const check = await fetch('/api/system', { cache: 'no-store' });
            if (check.ok) {
              clearInterval(interval);
              if (timerEl) timerEl.innerText = 'Connected!';
              setTimeout(() => {
                window.location.reload();
              }, 400);
            }
          } catch (err) {
            // Wait for next cycle
          }
        }
      }, 1000);
    }

    // Auto-hook telemetry and logs polling when system tabs open
    let lastTabActive = '';
    window.addEventListener('DOMContentLoaded', () => {
      const observer = new MutationObserver(() => {
        const daemonTab = document.getElementById('tab-system-daemon');
        if (daemonTab && !daemonTab.classList.contains('hidden')) {
          refreshDaemonTelemetry();
        }
        const logsTab = document.getElementById('tab-system-logs');
        if (logsTab && !logsTab.classList.contains('hidden')) {
          refreshDaemonLogs();
        }
        const dispTab = document.getElementById('tab-system-dispatcher');
        if (dispTab && !dispTab.classList.contains('hidden')) {
          // Only fetch settings once upon entering the tab to avoid overwriting user dropdown interactions
          if (lastTabActive !== 'system-dispatcher') {
            lastTabActive = 'system-dispatcher';
            if (typeof loadWarRoomDispatcherSettings === 'function') {
              loadWarRoomDispatcherSettings();
            }
          }
        } else if (lastTabActive === 'system-dispatcher') {
          lastTabActive = '';
        }
        // BL-SYS-01 / BL-SYS-57: load once per entry (same guard pattern as dispatcher)
        const storTab = document.getElementById('tab-system-storage');
        if (storTab && !storTab.classList.contains('hidden')) {
          if (!window.__storageTabLoaded) { window.__storageTabLoaded = true; if (typeof loadSystemStorage === 'function') loadSystemStorage(); }
        } else { window.__storageTabLoaded = false; }
        const gwTab = document.getElementById('tab-system-gateways');
        if (gwTab && !gwTab.classList.contains('hidden')) {
          if (!window.__gatewaysTabLoaded) { window.__gatewaysTabLoaded = true; if (typeof loadGateways === 'function') loadGateways(); }
        } else { window.__gatewaysTabLoaded = false; }
      });
      const mainEl = document.querySelector('main');
      if (mainEl) observer.observe(mainEl, { attributes: true, subtree: true, attributeFilter: ['class'] });
    });

    window.refreshDaemonTelemetry = refreshDaemonTelemetry;
    window.refreshDaemonLogs = refreshDaemonLogs;
    window.confirmRestartNexusDesk = confirmRestartNexusDesk;


