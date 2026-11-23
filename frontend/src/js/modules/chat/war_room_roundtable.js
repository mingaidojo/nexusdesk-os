    // --- Modal: Round-Table Debate Controller ---
    function openRoundTableModal() {
      const modal = document.getElementById('modal-roundtable');
      if (!modal) return;
      populateRoundTablePanelists();
      if (!warRoomParticipants || warRoomParticipants.length === 0) {
        loadWarRoomParticipants();
      }
      modal.classList.remove('hidden');
    }

    function closeRoundTableModal() {
      const modal = document.getElementById('modal-roundtable');
      if (modal) modal.classList.add('hidden');
    }

    function updateRoundTableSelectionCount() {
      const cbs = Array.from(document.querySelectorAll('.roundtable-panelist-cb'));
      const checkedCount = cbs.filter(cb => cb.checked).length;
      const badge = document.getElementById('roundtable-selected-count');
      if (badge) {
        badge.innerText = `${checkedCount} selected`;
        if (checkedCount >= 2 && checkedCount <= 5) {
          badge.className = 'px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800 text-[10px] font-mono font-bold';
        } else {
          badge.className = 'px-2 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-800 text-[10px] font-mono font-bold';
        }
      }
      cbs.forEach(cb => {
        const label = cb.closest('label');
        if (label) {
          if (cb.checked) {
            label.classList.add('border-cyan-600/80', 'bg-slate-900');
            label.classList.remove('border-slate-800', 'bg-slate-900/60');
          } else {
            label.classList.remove('border-cyan-600/80', 'bg-slate-900');
            label.classList.add('border-slate-800', 'bg-slate-900/60');
          }
        }
      });
    }

    function selectRoundTablePreset(mode) {
      const cbs = Array.from(document.querySelectorAll('.roundtable-panelist-cb'));
      const coreIds = ['solaris', 'claude', 'agy'];
      cbs.forEach((cb, idx) => {
        const valLower = (cb.value || '').toLowerCase();
        if (mode === 'all') {
          cb.checked = idx < 5; // Cap at 5 panelists for optimal roundtable pacing
        } else if (mode === 'core') {
          cb.checked = coreIds.includes(valLower) || (idx === 0 && !cbs.some(x => coreIds.includes((x.value || '').toLowerCase())));
        } else if (mode === 'clear') {
          cb.checked = false;
        }
      });
      updateRoundTableSelectionCount();
    }

    function populateRoundTablePanelists() {
      const container = document.getElementById('roundtable-panelist-list');
      if (!container) return;

      // Preserve existing user selection if checkboxes are already rendered
      const previouslyChecked = Array.from(container.querySelectorAll('.roundtable-panelist-cb:checked')).map(cb => cb.value.toLowerCase());
      const defaultSelected = previouslyChecked.length > 0 ? previouslyChecked : ['solaris', 'claude', 'agy'];

      container.innerHTML = '';
      const participants = getEffectiveWarRoomParticipants();

      participants.forEach((p, idx) => {
        const pid = (p.id || p.name || '').toLowerCase();
        const isChecked = defaultSelected.includes(pid) || (defaultSelected.length === 0 && idx < 3);
        const eng = (p.engine || 'hermes').toLowerCase();
        const engStyle = ENGINE_BADGE_STYLES[eng] || ENGINE_BADGE_STYLES.hermes;
        const color = p.color || '#06b6d4';

        const row = document.createElement('label');
        row.className = `flex items-center gap-2.5 p-2 rounded-lg border cursor-pointer select-none text-xs transition ${isChecked ? 'border-cyan-600/80 bg-slate-900' : 'border-slate-800 bg-slate-900/60 hover:border-slate-700'}`;
        row.innerHTML = `
          <input type="checkbox" value="${p.name}" onchange="updateRoundTableSelectionCount()" class="roundtable-panelist-cb rounded text-cyan-600 focus:ring-cyan-500 accent-cyan-500 cursor-pointer" ${isChecked ? 'checked' : ''} />
          <div class="w-5 h-5 rounded flex items-center justify-center text-[9px] font-pixel font-bold shrink-0" style="background: ${color}22; border: 1px solid ${color}; color: ${color};">${p.name[0]}</div>
          <div class="flex-1 min-w-0">
            <div class="text-slate-100 font-bold font-mono text-[11px] truncate">${p.name}</div>
            <div class="text-[9px] text-slate-400 font-mono truncate">${p.role || 'Specialist'}</div>
          </div>
          <span class="text-[8px] font-mono px-1.5 py-0.5 rounded font-bold uppercase border shrink-0 ${engStyle}">[${eng.toUpperCase()}]</span>
        `;
        container.appendChild(row);
      });

      updateRoundTableSelectionCount();
    }

    async function launchRoundTableDiscussion() {
      const topicInput = document.getElementById('roundtable-topic-input');
      const topic = topicInput ? topicInput.value.trim() : '';
      if (!topic) {
        alert('Please specify a deliberation topic for the roundtable.');
        return;
      }

      const checked = Array.from(document.querySelectorAll('.roundtable-panelist-cb:checked')).map(cb => cb.value);
      if (checked.length < 2) {
        alert('Please select at least 2 panelists for the discussion.');
        return;
      }

      const roundsSelect = document.getElementById('roundtable-rounds-select');
      const rounds = roundsSelect ? parseInt(roundsSelect.value, 10) : 2;

      closeRoundTableModal();

      // Ensure view is on War Room
      if (currentConsoleMode !== 'warroom') {
        switchConsoleMode('warroom');
      }

      try {
        const res = await fetch('/api/war-room/roundtable', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            topic: topic,
            agents: checked,
            rounds: rounds,
            room_id: activeWarRoomId || 'general'
          })
        });
        const data = await res.json();
        if (!res.ok) {
          alert(`Failed to launch roundtable: ${data.detail || 'Unknown error'}`);
        }
      } catch (e) {
        alert('Error contacting roundtable server: ' + e);
      }
    }

    // --- WebSocket Event Handler for War Room Events ---
    function handleWarRoomWebSocketEvent(payload) {
      if (!payload || !payload.type) return;
      // BL-UI-57: feed War Room switcher live/unread/orchestrator indicators
      if (typeof window.roomSwitcherNote === 'function') window.roomSwitcherNote(payload);

      if (payload.type === 'war_room_message') {
        const msgRoom = payload.data?.room_id || 'general';
        if (msgRoom === activeWarRoomId) {
          appendWarRoomMessage(payload.data);
          // BL-EVO-25: Only stop speaker heartbeat for THIS agent when an actual agent reply arrives
          if (payload.data?.sender_type === 'agent') {
            stopSpeakerHeartbeat(msgRoom, payload.data?.sender || null);
            // BL-EVO-22: Refresh sandbox storage stats & file explorer when agents deliver files or messages
            if (typeof loadWarRoomSandboxFiles === 'function') loadWarRoomSandboxFiles(msgRoom);
            if (typeof loadWarRoomSandboxStats === 'function') loadWarRoomSandboxStats(msgRoom);
          }
        }

        // Canvas active speaker bubble
        if (payload.data?.sender_type === 'agent' && typeof setConferenceSpeaker === 'function') {
          setConferenceSpeaker(payload.data.sender, payload.data.text);
        }

        // BL-VOICE-23 + Parallel Swarm FIFO TTS Queue: Speak every agent with "<Agent> here." intro in unique voice
        if (payload.data?.sender_type === 'agent' && currentConsoleMode === 'warroom' && msgRoom === activeWarRoomId && (handsFreeVoiceActive || audioResponseEnabled)) {
          const matchingAgent = (typeof agents !== 'undefined' && Array.isArray(agents))
            ? agents.find(a => a.name.toLowerCase() === (payload.data.sender || '').toLowerCase())
            : null;
          speakWithAgentVoice(
            matchingAgent || { name: payload.data.sender, voice: { pitch: 1.0, rate: 1.05 } },
            payload.data.text,
            { queue: true, prefix: `${payload.data.sender} here.` }
          );
        }
      } else if (payload.type === 'war_room_message_updated') {
        const msgRoom = payload.data?.room_id || 'general';
        if (msgRoom === activeWarRoomId && typeof updateWarRoomMessageInDom === 'function') {
          updateWarRoomMessageInDom(payload.data);
        }
      } else if (payload.type === 'war_room_user_mentioned') {
        const msgRoom = payload.data?.room_id || 'general';
        if (msgRoom === activeWarRoomId) {
          // BL-CHAT-24: Agent tagged @user / @Min -> Alert operator & chime
          const alertBanner = document.getElementById('warroom-user-alert-banner');
          const alertTitle = document.getElementById('warroom-user-alert-title');
          const alertPreview = document.getElementById('warroom-user-alert-preview');
          const agentName = payload.data?.agent || 'An Agent';
          if (alertTitle) alertTitle.innerText = `@${agentName} mentioned @user and is awaiting your response!`;
          if (alertPreview) alertPreview.innerText = payload.data?.text ? `"${payload.data.text}"` : 'Automated agent chaining paused for your input.';
          if (alertBanner) alertBanner.classList.remove('hidden');
          playOperatorMentionChime();
          // BL-WAR-15: Auto-refresh inquiries deck when user is mentioned
          fetchRoomInquiries(msgRoom);
        }
      } else if (payload.type === 'war_room_inquiries_updated') {
        const msgRoom = payload.data?.room_id || 'general';
        if (msgRoom === activeWarRoomId) {
          activeRoomInquiries = payload.data?.inquiries || [];
          renderInquiriesDeck();
        }
      } else if (payload.type === 'war_room_reminders_updated') {
        const msgRoom = payload.data?.room_id || 'general';
        if (msgRoom === activeWarRoomId) {
          const rawRems = payload.data?.reminders || [];
          activeRoomReminders = typeof _filterNonCancelledReminders === 'function' ? _filterNonCancelledReminders(rawRems) : rawRems;
          renderWarRoomRemindersTray();
          renderWarRoomRemindersModalList();
        }
      } else if (payload.type === 'war_room_schedules_updated') {
        const msgRoom = payload.data?.room_id || 'general';
        if (msgRoom === activeWarRoomId) {
          activeRoomSchedules = payload.data?.schedules || [];
          if (typeof renderWarRoomRemindersTray === 'function') renderWarRoomRemindersTray();
          if (typeof renderWarRoomSchedulesList === 'function') renderWarRoomSchedulesList();
        }
        if (typeof loadCronsTable === 'function' && document.getElementById('tab-crons') && !document.getElementById('tab-crons').classList.contains('hidden')) {
          loadCronsTable();
        }
      } else if (payload.type === 'war_room_queue_updated') {
        const msgRoom = payload.data?.room_id || 'general';
        if (msgRoom === activeWarRoomId && typeof renderWarRoomQueueBanner === 'function') {
          renderWarRoomQueueBanner(payload.data?.queued_directives || []);
        }
      } else if (payload.type === 'war_room_tasks_updated') {
        const msgRoom = payload.data?.room_id || 'general';
        if (msgRoom === activeWarRoomId) {
          activeRoomBgTasks = payload.data?.tasks || [];
          renderWarRoomRemindersTray();
          renderWarRoomBgTasksModalList();
          if (typeof activeLiveTaskModalId !== 'undefined' && activeLiveTaskModalId && typeof refreshActiveTaskLiveModal === 'function') {
            refreshActiveTaskLiveModal();
          }
          // BL-EVO-22: Refresh sandbox storage stats & file list when tasks update (e.g. archiving/pruning complete)
          if (typeof loadWarRoomSandboxFiles === 'function') loadWarRoomSandboxFiles(msgRoom);
          if (typeof loadWarRoomSandboxStats === 'function') loadWarRoomSandboxStats(msgRoom);
        }
      } else if (payload.type === 'war_room_task_progress') {
        const msgRoom = payload.data?.room_id || 'general';
        if (msgRoom === activeWarRoomId) {
          const tid = payload.data?.task_id;
          const idx = (activeRoomBgTasks || []).findIndex(t => t.id === tid);
          if (idx >= 0) {
            activeRoomBgTasks[idx].elapsed = payload.data?.elapsed;
            activeRoomBgTasks[idx].latest_progress = payload.data?.latest_progress;
            if (typeof updateWarRoomTaskProgressInPlace === 'function') {
              updateWarRoomTaskProgressInPlace(tid, payload.data?.elapsed, payload.data?.latest_progress);
            } else {
              renderWarRoomRemindersTray();
            }
            renderWarRoomBgTasksModalList();
          }
        }
      } else if (payload.type === 'war_room_speaker_start') {
        const msgRoom = payload.data?.room_id || 'general';
        const speakerTimeout = payload.data?.timeout_seconds || 2700;
        startSpeakerHeartbeat(payload.data.agent, payload.data.engine, msgRoom, speakerTimeout, payload.data?.swarm_phase || '');
        if (msgRoom === activeWarRoomId) {
          if (typeof setConferenceSpeaker === 'function') {
            setConferenceSpeaker(payload.data.agent, 'Synthesizing response...');
          }
        }
      } else if (payload.type === 'war_room_agent_intent') {
        if (typeof updateLiveAgentIntent === 'function') {
          updateLiveAgentIntent(payload.data);
        }
      } else if (payload.type === 'war_room_preflight_resolved') {
        if (typeof resolveLivePreflightGate === 'function') {
          resolveLivePreflightGate(payload.data);
        }
      } else if (payload.type === 'war_room_speaker_activity') {
        const msgRoom = payload.data?.room_id || 'general';
        if (typeof updateLiveSpeakerActivity === 'function') {
          updateLiveSpeakerActivity(payload.data);
        }
        if (msgRoom === activeWarRoomId && payload.data?.activity && typeof setConferenceSpeaker === 'function') {
          setConferenceSpeaker(payload.data.agent, payload.data.activity);
        }
      } else if (payload.type === 'war_room_speaker_stop') {
        const msgRoom = payload.data?.room_id || 'general';
        stopSpeakerHeartbeat(msgRoom, payload.data?.agent || 'all');
      } else if (payload.type === 'war_room_participant_added' || payload.type === 'war_room_room_model_updated') {
        const msgRoom = payload.data?.room_id || 'general';
        if (msgRoom === activeWarRoomId) {
          loadWarRoomParticipants();
        }
      } else if (payload.type === 'war_room_roundtable_complete' || payload.type === 'war_room_dispatch_complete') {
        const msgRoom = payload.data?.room_id || 'general';
        if (msgRoom === activeWarRoomId) {
          stopSpeakerHeartbeat();
          // An 'interrupted' completion is managed by the Interrupt handler itself (a new chain may follow)
          if (payload.data?.status !== 'interrupted') {
            if (typeof warRoomExternalInFlight !== 'undefined' && warRoomExternalInFlight) {
              isAgentTurnInFlight = false;
              warRoomExternalInFlight = false;
            }
            if (!isAgentTurnInFlight && typeof updateWarRoomControlsUI === 'function') {
              updateWarRoomControlsUI(false);
            }
          }
          if (typeof syncWarRoomMessages === 'function') {
            syncWarRoomMessages(activeWarRoomId);
          }
          // BL-EVO-22: Refresh storage pill and files badge upon dispatch completion
          if (typeof loadWarRoomSandboxFiles === 'function') loadWarRoomSandboxFiles(activeWarRoomId);
          if (typeof loadWarRoomSandboxStats === 'function') loadWarRoomSandboxStats(activeWarRoomId);
        }
      } else if (payload.type === 'war_room_cleared') {
        const clearedRoom = payload.data?.room_id || 'general';
        if (clearedRoom === activeWarRoomId) {
          const container = document.getElementById('warroom-conversation');
          if (container) container.innerHTML = '';
          dismissWarRoomUserAlert();
          loadWarRoomMessages(activeWarRoomId);
        }
      } else if (payload.type === 'war_room_created') {
        loadWarRoomRooms();
      } else if (payload.type === 'war_room_deleted') {
        const deletedRoomId = payload.data?.room_id;
        const tabIdx = consoleTabs.findIndex(t => t.roomId === deletedRoomId);
        if (tabIdx !== -1) {
          closeConsoleTab(consoleTabs[tabIdx].id);
        }
      }
    }

    // --- Web Speech Dictate for War Room ---
    function toggleWarRoomVoiceDictate() {
      if (!('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
        alert('SpeechRecognition API not available in this browser.');
        return;
      }
      if (!warRoomRecognition) {
        const SpeechClass = window.SpeechRecognition || window.webkitSpeechRecognition;
        warRoomRecognition = new SpeechClass();
        warRoomRecognition.continuous = false;
        warRoomRecognition.interimResults = false;

        warRoomRecognition.onresult = (e) => {
          const transcript = e.results[0][0].transcript;
          const input = document.getElementById('warroom-text-input');
          if (input) {
            input.value = input.value ? `${input.value.trim()} ${transcript}` : transcript;
            sendWarRoomChat();
          }
        };

        warRoomRecognition.onend = () => {
          warRoomDictating = false;
          const icon = document.getElementById('warroom-mic-icon');
          if (icon) icon.classList.remove('text-rose-500', 'animate-pulse');
        };
      }

      if (!warRoomDictating) {
        warRoomRecognition.start();
        warRoomDictating = true;
        const icon = document.getElementById('warroom-mic-icon');
        if (icon) icon.classList.add('text-rose-500', 'animate-pulse');
      } else {
        warRoomRecognition.stop();
      }
    }

