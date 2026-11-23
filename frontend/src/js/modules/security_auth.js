    // --- Master Authentication Controls ---
    function showAuthUnlockModal() {
      const modal = document.getElementById('auth-unlock-modal');
      if (modal) {
        modal.classList.remove('hidden');
        const input = document.getElementById('auth-token-input');
        if (input) {
          input.value = localStorage.getItem('nexusdesk_token') || '';
          input.focus();
        }
      }
    }

    function closeAuthUnlockModal() {
      const modal = document.getElementById('auth-unlock-modal');
      if (modal) modal.classList.add('hidden');
    }

    function toggleAuthTokenVisibility() {
      const input = document.getElementById('auth-token-input');
      if (input) {
        input.type = input.type === 'password' ? 'text' : 'password';
      }
    }

    function copyRecoveryCommand() {
      const cmd = document.getElementById('recovery-cmd-text').innerText;
      navigator.clipboard.writeText(cmd).then(() => {
        alert('Copied recovery command to clipboard!');
      }).catch(() => {
        prompt('Copy this recovery command:', cmd);
      });
    }

    async function submitUnlockToken() {
      const input = document.getElementById('auth-token-input');
      const err = document.getElementById('auth-unlock-error');
      const btn = document.getElementById('auth-unlock-btn');
      if (!input) return;
      const token = input.value.trim();
      if (!token) {
        if (err) {
          err.innerText = '⚠️ Please enter your secret key.';
          err.classList.remove('hidden');
        }
        return;
      }
      btn.disabled = true;
      btn.innerText = 'Verifying...';
      try {
        const res = await fetch('/api/auth/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: token })
        });
        if (res.ok) {
          localStorage.setItem('nexusdesk_token', token);
          if (err) err.classList.add('hidden');
          closeAuthUnlockModal();
          initWebSocket();
          refreshTelemetry();
          syncLiveHermesAgentActivity();
        } else {
          if (err) {
            err.innerText = '⚠️ Invalid secret key. Please check your credentials or run the recovery command.';
            err.classList.remove('hidden');
          }
        }
      } catch (e) {
        if (err) {
          err.innerText = '⚠️ Error contacting server: ' + e.message;
          err.classList.remove('hidden');
        }
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<span>🔓</span> <span>UNLOCK MISSION CONTROL</span>';
      }
    }

    let globalSecurityConfig = {
      auth_enabled: false,
      authenticated: true,
      secret_key: ''
    };

    function updateSecurityBadge(cfg) {
      if (cfg) globalSecurityConfig = { ...globalSecurityConfig, ...cfg };
      const isAuthActive = !!globalSecurityConfig.auth_enabled;
      
      // Desktop badge
      const badgeDot = document.getElementById('security-mode-dot');
      const badgeText = document.getElementById('security-mode-text');
      const badgeBtn = document.getElementById('security-mode-badge');
      if (badgeDot && badgeText && badgeBtn) {
        if (isAuthActive) {
          badgeDot.className = 'w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_6px_#10b981]';
          badgeText.innerText = '';
          badgeText.className = 'hidden';
          badgeBtn.className = 'hidden sm:flex items-center gap-1.5 px-2 py-1 rounded-lg bg-emerald-950/40 border border-emerald-800/80 hover:border-emerald-700 text-xs font-mono transition cursor-pointer';
          badgeBtn.title = 'Security: Key Protection Active (Click to configure)';
        } else {
          badgeDot.className = 'w-2 h-2 rounded-full bg-slate-500';
          badgeText.innerText = '';
          badgeText.className = 'hidden';
          badgeBtn.className = 'hidden sm:flex items-center gap-1.5 px-2 py-1 rounded-lg bg-slate-900/80 border border-slate-800 hover:border-slate-700 text-xs font-mono transition cursor-pointer';
          badgeBtn.title = 'Security: Developer Mode / Open (Click to configure)';
        }
      }

      // Mobile badge
      const badgeDotMob = document.getElementById('security-mode-dot-mob');
      const badgeTextMob = document.getElementById('security-mode-text-mob');
      if (badgeDotMob && badgeTextMob) {
        if (isAuthActive) {
          badgeDotMob.className = 'w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_#10b981]';
          badgeTextMob.innerText = '';
          badgeTextMob.className = 'hidden';
        } else {
          badgeDotMob.className = 'w-1.5 h-1.5 rounded-full bg-slate-500';
          badgeTextMob.innerText = '';
          badgeTextMob.className = 'hidden';
        }
      }

      // Sidebar badge
      const sbBadge = document.getElementById('sidebar-sec-badge');
      if (sbBadge) {
        if (isAuthActive) {
          sbBadge.innerText = 'SECURE';
          sbBadge.className = 'sidebar-label text-[9px] px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-800 font-mono';
        } else {
          sbBadge.innerText = 'DEV';
          sbBadge.className = 'sidebar-label text-[9px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700 font-mono';
        }
      }

      // Modal elements if open
      const statusText = document.getElementById('modal-sec-status-text');
      const toggleBtn = document.getElementById('modal-sec-toggle-btn');
      const statusBanner = document.getElementById('modal-sec-status-banner');
      const keyInput = document.getElementById('modal-sec-key-input');
      const urlInput = document.getElementById('modal-sec-url-input');

      if (statusText && toggleBtn && statusBanner) {
        if (isAuthActive) {
          statusText.innerHTML = '🔒 <span class="text-emerald-400">Active (Locked with Master Key)</span>';
          statusBanner.className = 'p-3 rounded-xl border flex items-center justify-between bg-emerald-950/30 border-emerald-800/80';
          toggleBtn.innerHTML = '<span>Disable Auth (Dev Mode)</span>';
          toggleBtn.className = 'px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 bg-rose-600/80 hover:bg-rose-500 text-white shadow-sm cursor-pointer';
        } else {
          statusText.innerHTML = '🔓 <span class="text-slate-300">Inactive (Development Mode)</span>';
          statusBanner.className = 'p-3 rounded-xl border flex items-center justify-between bg-slate-900/60 border-slate-800';
          toggleBtn.innerHTML = '<span>Enable Auth</span>';
          toggleBtn.className = 'px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm cursor-pointer';
        }
      }

      if (keyInput && globalSecurityConfig.secret_key) {
        keyInput.value = globalSecurityConfig.secret_key;
      }
      if (urlInput && globalSecurityConfig.secret_key) {
        const origin = window.location.origin;
        urlInput.value = `${origin}/?token=${globalSecurityConfig.secret_key}`;
      }

      // Sync dedicated #tab-security if present
      syncSecuritySettingsTab();
    }

    function syncSecuritySettingsTab() {
      const isAuthActive = !!globalSecurityConfig.auth_enabled;
      const secKey = globalSecurityConfig.secret_key || '';
      const origin = window.location.origin;

      const pill = document.getElementById('tab-sec-status-pill');
      if (pill) {
        if (isAuthActive) {
          pill.innerText = 'STATUS: ACTIVE (PROTECTED)';
          pill.className = 'px-2.5 py-1 rounded bg-emerald-950 text-emerald-300 border border-emerald-800 text-[10px] font-mono font-semibold uppercase';
        } else {
          pill.innerText = 'STATUS: INACTIVE (DEV MODE)';
          pill.className = 'px-2.5 py-1 rounded bg-slate-900 text-slate-400 border border-slate-800 text-[10px] font-mono font-semibold uppercase';
        }
      }

      const banner = document.getElementById('tab-sec-banner');
      const stateText = document.getElementById('tab-sec-state-text');
      const toggleBtn = document.getElementById('tab-sec-toggle-btn');
      if (banner && stateText && toggleBtn) {
        if (isAuthActive) {
          banner.className = 'p-3.5 rounded-xl border flex items-center justify-between bg-emerald-950/30 border-emerald-800/80 mb-4';
          stateText.innerHTML = '🔒 <span class="text-emerald-400">Active (Locked with Master Key)</span>';
          toggleBtn.innerHTML = '<span>Disable Auth (Dev Mode)</span>';
          toggleBtn.className = 'px-3.5 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 bg-rose-600/80 hover:bg-rose-500 text-white shadow-sm cursor-pointer font-mono';
        } else {
          banner.className = 'p-3.5 rounded-xl border flex items-center justify-between bg-slate-900/60 border-slate-800 mb-4';
          stateText.innerHTML = '🔓 <span class="text-slate-300">Inactive (Development Mode)</span>';
          toggleBtn.innerHTML = '<span>Enable Auth</span>';
          toggleBtn.className = 'px-3.5 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm cursor-pointer font-mono';
        }
      }

      const keyInput = document.getElementById('tab-sec-key-input');
      if (keyInput) keyInput.value = secKey;

      const urlInput = document.getElementById('tab-sec-url-input');
      if (urlInput) urlInput.value = secKey ? `${origin}/?token=${secKey}` : origin;
    }

    function toggleTabSecKeyVisibility() {
      const input = document.getElementById('tab-sec-key-input');
      if (input) input.type = input.type === 'password' ? 'text' : 'password';
    }

    function copyTabSecurityKey() {
      const input = document.getElementById('tab-sec-key-input');
      if (input && input.value) {
        navigator.clipboard.writeText(input.value).then(() => {
          alert('Master Secret Key copied to clipboard!');
        }).catch(() => {
          prompt('Copy secret key:', input.value);
        });
      }
    }

    function copyTabSecurityUnlockUrl() {
      const input = document.getElementById('tab-sec-url-input');
      if (input && input.value) {
        navigator.clipboard.writeText(input.value).then(() => {
          alert('1-Click Fast Unlock URL copied to clipboard!');
        }).catch(() => {
          prompt('Copy fast unlock URL:', input.value);
        });
      }
    }

    async function openSecuritySettingsModal() {
      const modal = document.getElementById('security-settings-modal');
      if (modal) modal.classList.remove('hidden');
      try {
        const res = await fetch('/api/auth/status');
        if (res.ok) {
          const data = await res.json();
          updateSecurityBadge(data);
        }
      } catch (e) {}
    }

    function closeSecuritySettingsModal() {
      const modal = document.getElementById('security-settings-modal');
      if (modal) modal.classList.add('hidden');
    }

    function toggleSecKeyVisibility() {
      const input = document.getElementById('modal-sec-key-input');
      if (input) input.type = input.type === 'password' ? 'text' : 'password';
    }

    function copySecurityKey() {
      const input = document.getElementById('modal-sec-key-input');
      if (input && input.value) {
        navigator.clipboard.writeText(input.value).then(() => {
          alert('Master Secret Key copied to clipboard!');
        }).catch(() => {
          prompt('Copy secret key:', input.value);
        });
      }
    }

    function copySecurityUnlockUrl() {
      const input = document.getElementById('modal-sec-url-input');
      if (input && input.value) {
        navigator.clipboard.writeText(input.value).then(() => {
          alert('1-Click Fast Unlock URL copied to clipboard!');
        }).catch(() => {
          prompt('Copy fast unlock URL:', input.value);
        });
      }
    }

    async function toggleSecurityAuthMode() {
      const current = !!globalSecurityConfig.auth_enabled;
      const willEnable = !current;
      const confirmMsg = willEnable 
        ? 'Enable Master Authentication? Requests will require your Secret Key.'
        : 'Disable Master Authentication? NexusDesk will run in frictionless Development Mode without requiring keys.';
      if (!confirm(confirmMsg)) return;

      try {
        const res = await fetch('/api/auth/toggle', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: willEnable })
        });
        if (res.ok) {
          const data = await res.json();
          if (willEnable && data.secret_key) {
            localStorage.setItem('nexusdesk_token', data.secret_key);
          }
          updateSecurityBadge(data);
          alert(willEnable ? 'Authentication is now ACTIVE.' : 'Authentication is now INACTIVE (Development Mode).');
        } else {
          alert('Failed to update security mode.');
        }
      } catch (e) {
        alert('Error contacting server: ' + e.message);
      }
    }

    async function regenerateSecretKey() {
      if (!confirm('Regenerate Master Secret Key? Any existing unlock links and saved sessions will need the new key.')) return;
      try {
        const res = await fetch('/api/auth/toggle', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: globalSecurityConfig.auth_enabled, regenerate_key: true })
        });
        if (res.ok) {
          const data = await res.json();
          localStorage.setItem('nexusdesk_token', data.secret_key);
          updateSecurityBadge(data);
          alert('Secret key regenerated successfully!');
        } else {
          alert('Failed to regenerate key.');
        }
      } catch (e) {
        alert('Error: ' + e.message);
      }
    }

    async function checkAuthStatus() {
      try {
        const res = await fetch('/api/auth/status');
        if (res.ok) {
          const data = await res.json();
          updateSecurityBadge(data);
          if (data.auth_enabled && !data.authenticated) {
            showAuthUnlockModal();
          }
        }
      } catch (e) {}
    }

    // =========================================================================
    // BL-WAR-41: War Room Contextual Dispatcher Settings & Simulator Controls
    // =========================================================================

    function toggleDispatcherSourceUI() {
      const isAgent = document.getElementById('dispatcher-source-agent')?.checked;
      const agentBox = document.getElementById('dispatcher-agent-opt-container');
      const customBox = document.getElementById('dispatcher-custom-opt-container');
      if (agentBox && customBox) {
        if (isAgent) {
          agentBox.classList.remove('hidden');
          customBox.classList.add('hidden');
        } else {
          agentBox.classList.add('hidden');
          customBox.classList.remove('hidden');
        }
      }
    }

    let dispatcherDetectedAgents = [];
    let isDispatcherSettingsLoaded = false;

    function populateDispatcherModelsDropdown(agentName, preselectedModel = null) {
      const modelSel = document.getElementById('dispatcher-agent-model-select');
      const customInp = document.getElementById('dispatcher-agent-model-custom');
      if (!modelSel || !dispatcherDetectedAgents || !dispatcherDetectedAgents.length) return;

      const matched = dispatcherDetectedAgents.find(a => (a.name || '').toLowerCase() === (agentName || '').toLowerCase());
      if (!matched) return;

      const availableModels = matched.available_models || [];
      const currentSelected = preselectedModel || (modelSel.value && modelSel.value !== '__custom__' ? modelSel.value : matched.resolved_model);

      modelSel.innerHTML = '';
      let hasMatched = false;

      availableModels.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.innerText = `${m.id} • ${m.label || m.id}`;
        if (m.id.toLowerCase() === (currentSelected || '').toLowerCase()) {
          opt.selected = true;
          hasMatched = true;
        }
        modelSel.appendChild(opt);
      });

      // Unrestricted Custom Option
      const customOpt = document.createElement('option');
      customOpt.value = '__custom__';
      customOpt.innerText = '⚙️ Custom / Arbitrary Model Slug...';
      if (!hasMatched && currentSelected) {
        customOpt.selected = true;
        if (customInp) customInp.value = currentSelected;
      }
      modelSel.appendChild(customOpt);

      updateDispatcherVerboseCard(agentName, currentSelected);
    }

    function updateDispatcherVerboseCard(agentName, modelName = null) {
      if (!dispatcherDetectedAgents || !dispatcherDetectedAgents.length) return;
      const matched = dispatcherDetectedAgents.find(a => (a.name || '').toLowerCase() === (agentName || '').toLowerCase());
      if (matched) {
        const mEl = document.getElementById('disp-verbose-model');
        const pEl = document.getElementById('disp-verbose-provider');
        const tEl = document.getElementById('disp-verbose-tier');

        const activeModel = modelName || matched.resolved_model || 'default';
        if (mEl) mEl.innerText = activeModel;
        if (pEl) pEl.innerText = `${matched.name} (${matched.engine.toUpperCase()}) via ${matched.resolved_provider.toUpperCase()}`;

        let tier = matched.latency_tier || 'Standard';
        if (activeModel.includes('flash') || activeModel.includes('mini') || activeModel.includes('haiku')) {
          tier = 'Sub-Second Ultra Fast (~0.9-1.2s)';
        } else if (activeModel.includes('opus') || activeModel.includes('heavy') || activeModel.includes('550b')) {
          tier = 'Frontier Heavy (~3.0-4.5s)';
        }
        if (tEl) tEl.innerText = tier;
      }
    }

    function onDispatcherAgentSelectChanged() {
      const agentSel = document.getElementById('dispatcher-agent-name');
      const customInp = document.getElementById('dispatcher-agent-model-custom');
      if (agentSel) {
        const matched = dispatcherDetectedAgents.find(a => (a.name || '').toLowerCase() === agentSel.value.toLowerCase());
        const defaultModel = matched ? matched.resolved_model : null;
        if (customInp) customInp.value = defaultModel || '';
        populateDispatcherModelsDropdown(agentSel.value, defaultModel);
      }
    }

    function onDispatcherModelSelectChanged() {
      const agentSel = document.getElementById('dispatcher-agent-name');
      const modelSel = document.getElementById('dispatcher-agent-model-select');
      const customInp = document.getElementById('dispatcher-agent-model-custom');
      if (!agentSel || !modelSel) return;

      if (modelSel.value === '__custom__') {
        if (customInp) customInp.focus();
        updateDispatcherVerboseCard(agentSel.value, customInp?.value || 'custom-model');
      } else {
        if (customInp) customInp.value = modelSel.value;
        updateDispatcherVerboseCard(agentSel.value, modelSel.value);
      }
    }

    function onDispatcherCustomModelInput() {
      const agentSel = document.getElementById('dispatcher-agent-name');
      const modelSel = document.getElementById('dispatcher-agent-model-select');
      const customInp = document.getElementById('dispatcher-agent-model-custom');
      if (modelSel && customInp) {
        const val = customInp.value.trim();
        let exists = Array.from(modelSel.options).some(o => o.value.toLowerCase() === val.toLowerCase());
        if (exists) {
          modelSel.value = val;
        } else {
          modelSel.value = '__custom__';
        }
        updateDispatcherVerboseCard(agentSel?.value, val || 'custom-model');
      }
    }

    async function loadWarRoomDispatcherSettings() {
      try {
        const res = await fetch('/api/war-room/dispatcher/rules');
        if (!res.ok) return;
        const cfg = await res.json();

        // 1. Populate Level 1 (Agents) dynamically only once or if changed (avoids dropdown flickering)
        if (Array.isArray(cfg.available_agents) && cfg.available_agents.length > 0) {
          dispatcherDetectedAgents = cfg.available_agents;
          const agentSel = document.getElementById('dispatcher-agent-name');
          const badgeEl = document.getElementById('dispatcher-agent-detected-badge');
          if (badgeEl) {
            badgeEl.innerText = `${cfg.available_agents.length} AGENTS`;
          }

          if (agentSel) {
            const currentSelectedAgent = cfg.llm_agent_name || agentSel.value || 'Agy';
            // Only rebuild options if options count changed or empty to eliminate UI flickering
            if (agentSel.options.length !== cfg.available_agents.length) {
              agentSel.innerHTML = '';
              cfg.available_agents.forEach(a => {
                const opt = document.createElement('option');
                opt.value = a.name;
                opt.innerText = `${a.name} [${a.engine.toUpperCase()}] • ${a.latency_tier}`;
                if (a.name.toLowerCase() === currentSelectedAgent.toLowerCase()) {
                  opt.selected = true;
                }
                agentSel.appendChild(opt);
              });
            } else {
              agentSel.value = currentSelectedAgent;
            }

            // 2. Populate Level 2 (Models) for selected agent
            const modelToSet = cfg.llm_agent_model || cfg.llm_model || null;
            populateDispatcherModelsDropdown(agentSel.value, modelToSet);
            const customInp = document.getElementById('dispatcher-agent-model-custom');
            if (customInp && modelToSet) customInp.value = modelToSet;
          }
        }

        // Stage 1 LLM Controls
        const toggle = document.getElementById('dispatcher-llm-toggle');
        const toggleLbl = document.getElementById('dispatcher-llm-toggle-label');
        if (toggle) {
          toggle.checked = !!cfg.llm_router_enabled;
          if (toggleLbl) toggleLbl.innerText = toggle.checked ? 'ENABLED' : 'DISABLED';
        }

        // Source: Agent vs Custom
        const srcAgent = document.getElementById('dispatcher-source-agent');
        const srcCustom = document.getElementById('dispatcher-source-custom');
        if (cfg.llm_source === 'custom') {
          if (srcCustom) srcCustom.checked = true;
        } else {
          if (srcAgent) srcAgent.checked = true;
        }
        toggleDispatcherSourceUI();

        const providerSel = document.getElementById('dispatcher-llm-provider');
        if (providerSel && cfg.llm_provider) providerSel.value = cfg.llm_provider;

        const modelSel = document.getElementById('dispatcher-llm-model');
        if (modelSel && cfg.llm_model) modelSel.value = cfg.llm_model;

        const timeoutInp = document.getElementById('dispatcher-llm-timeout');
        if (timeoutInp && cfg.llm_timeout_seconds) timeoutInp.value = cfg.llm_timeout_seconds;

        const confInp = document.getElementById('dispatcher-llm-confidence');
        if (confInp && cfg.confidence_threshold) confInp.value = cfg.confidence_threshold;

        // Stage 2 Fixed Rules
        const r = cfg.fixed_rules || {};
        const pNames = document.getElementById('dispatcher-rule-plain-names');
        if (pNames) pNames.checked = r.check_plain_text_names !== false;

        const spkQ = document.getElementById('dispatcher-rule-speaker-question');
        if (spkQ) spkQ.checked = r.check_last_speaker_question !== false;

        const pendInq = document.getElementById('dispatcher-rule-pending-inquiries');
        if (pendInq) pendInq.checked = r.check_pending_inquiries !== false;

        const uMention = document.getElementById('dispatcher-rule-user-mention');
        if (uMention) uMention.checked = r.check_recent_user_mention !== false;

        const skipFail = document.getElementById('dispatcher-rule-skip-failed');
        if (skipFail) skipFail.checked = r.skip_failed_agents !== false;

        const defAgent = document.getElementById('dispatcher-rule-default-agent');
        if (defAgent && r.default_fallback_agent) defAgent.value = r.default_fallback_agent;

        const maxTurns = document.getElementById('dispatcher-rule-max-turns');
        if (maxTurns && r.inquiry_recency_max_turns) maxTurns.value = r.inquiry_recency_max_turns;

      } catch (err) {
        console.error('[DISPATCHER] Failed to load rules:', err);
      }
    }

    async function saveWarRoomDispatcherSettings() {
      const toggle = document.getElementById('dispatcher-llm-toggle');
      const isAgent = document.getElementById('dispatcher-source-agent')?.checked;
      const agentSel = document.getElementById('dispatcher-agent-name');
      const modelSel = document.getElementById('dispatcher-agent-model-select');
      const customModelInp = document.getElementById('dispatcher-agent-model-custom');
      const providerSel = document.getElementById('dispatcher-llm-provider');
      const customGatewayModelSel = document.getElementById('dispatcher-llm-model');
      const timeoutInp = document.getElementById('dispatcher-llm-timeout');
      const confInp = document.getElementById('dispatcher-llm-confidence');

      const pNames = document.getElementById('dispatcher-rule-plain-names');
      const spkQ = document.getElementById('dispatcher-rule-speaker-question');
      const pendInq = document.getElementById('dispatcher-rule-pending-inquiries');
      const uMention = document.getElementById('dispatcher-rule-user-mention');
      const skipFail = document.getElementById('dispatcher-rule-skip-failed');
      const defAgent = document.getElementById('dispatcher-rule-default-agent');
      const maxTurns = document.getElementById('dispatcher-rule-max-turns');

      // Resolve level 2 model (selected from list or custom typed slug)
      let selectedModel = '';
      if (modelSel) {
        if (modelSel.value === '__custom__' && customModelInp && customModelInp.value.trim()) {
          selectedModel = customModelInp.value.trim();
        } else {
          selectedModel = modelSel.value || customModelInp?.value || '';
        }
      }

      const payload = {
        llm_router_enabled: toggle ? toggle.checked : true,
        llm_source: isAgent ? 'agent' : 'custom',
        llm_agent_name: agentSel ? agentSel.value : 'Agy',
        llm_agent_model: selectedModel,
        llm_provider: providerSel ? providerSel.value : 'abacus',
        llm_model: isAgent ? (selectedModel || 'gemini-2.5-flash') : (customGatewayModelSel ? customGatewayModelSel.value : 'gemini-2.5-flash'),
        llm_timeout_seconds: timeoutInp ? parseFloat(timeoutInp.value) : 2.5,
        confidence_threshold: confInp ? parseFloat(confInp.value) : 0.70,
        fixed_rules: {
          check_plain_text_names: pNames ? pNames.checked : true,
          check_last_speaker_question: spkQ ? spkQ.checked : true,
          check_pending_inquiries: pendInq ? pendInq.checked : true,
          check_recent_user_mention: uMention ? uMention.checked : true,
          skip_failed_agents: skipFail ? skipFail.checked : true,
          default_fallback_agent: defAgent ? defAgent.value.trim() : 'Solaris',
          inquiry_recency_max_turns: maxTurns ? parseInt(maxTurns.value, 10) : 4
        }
      };

      try {
        const res = await fetch('/api/war-room/dispatcher/rules', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (res.ok) {
          alert('✅ War Room Dispatcher Rules saved successfully!');
          loadWarRoomDispatcherSettings();
        } else {
          alert('⚠️ Failed to save dispatcher settings: ' + res.statusText);
        }
      } catch (err) {
        alert('⚠️ Network error saving dispatcher settings: ' + err.message);
      }
    }

    async function runDispatcherSimulation() {
      const inp = document.getElementById('dispatcher-sim-msg');
      const resBox = document.getElementById('dispatcher-sim-result');
      if (!inp || !resBox) return;
      const text = inp.value.trim();
      if (!text) {
        alert('Please enter a test message to simulate routing.');
        return;
      }
      resBox.classList.remove('hidden');
      resBox.innerHTML = '<span class="text-slate-400">Evaluating simulation through dual-stage pipeline...</span>';

      try {
        const res = await fetch('/api/war-room/dispatcher/test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: text, room_id: (window.currentWarRoomId || 'general') })
        });
        if (res.ok) {
          const data = await res.json();
          const targetStr = (data.target_names || []).map(n => `@${n}`).join(', ') || 'None';
          resBox.innerHTML = `
            <div class="font-bold text-cyan-300">🎯 Selected Target: <span class="text-white">${targetStr}</span></div>
            <div class="mt-1 text-slate-300 text-[10.5px]">${data.reason || 'No specific routing note.'}</div>
          `;
        } else {
          resBox.innerHTML = `<span class="text-rose-400">Simulation error: ${res.statusText}</span>`;
        }
      } catch (err) {
        resBox.innerHTML = `<span class="text-rose-400">Simulation error: ${err.message}</span>`;
      }
    }

    // Toggle label live update
    document.addEventListener('change', (e) => {
      if (e.target && e.target.id === 'dispatcher-llm-toggle') {
        const lbl = document.getElementById('dispatcher-llm-toggle-label');
        if (lbl) lbl.innerText = e.target.checked ? 'ENABLED' : 'DISABLED';
      }
    });

    window.loadWarRoomDispatcherSettings = loadWarRoomDispatcherSettings;
    window.saveWarRoomDispatcherSettings = saveWarRoomDispatcherSettings;
    window.runDispatcherSimulation = runDispatcherSimulation;
    window.toggleDispatcherSourceUI = toggleDispatcherSourceUI;
    window.onDispatcherAgentSelectChanged = onDispatcherAgentSelectChanged;
    window.onDispatcherModelSelectChanged = onDispatcherModelSelectChanged;
    window.onDispatcherCustomModelInput = onDispatcherCustomModelInput;

