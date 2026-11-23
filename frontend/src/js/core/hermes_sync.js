    // --- Real-time Hermes Agent Runtime Activity Sync ---
    let liveActivityData = null;

    async function syncLiveHermesAgentActivity() {
      try {
        const res = await fetch('/api/simulation/live-activity');
        if (!res.ok) return;
        const data = await res.json();
        liveActivityData = data;

        const dot = document.getElementById('runtime-status-dot');
        const text = document.getElementById('runtime-status-text');
        const badge = document.getElementById('runtime-active-badge');

        if (data.is_active && Object.keys(data.active_agents).length > 0) {
          if (dot) dot.className = 'w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping';
          const activeEntries = Object.entries(data.active_agents);
          const activeNames = activeEntries.map(([k]) => k);
          if (text) {
            text.innerHTML = `<span class="text-emerald-400 font-bold">${activeNames.join(', ')}</span> actively executing Hermes tasks!`;
          }
          if (badge) {
            badge.innerHTML = activeEntries.map(([name, info]) => `
              <span class="bg-emerald-950/90 text-emerald-300 px-2.5 py-0.5 rounded text-[10px] border border-emerald-700/80 font-mono font-semibold flex items-center gap-1 shadow-sm">
                <span>⚡</span> <span>${name}:</span> <span class="text-white">${info.action}</span>
              </span>
            `).join(' ');
          }

          // Force real-time active state on corresponding agents
          agents.forEach(ag => {
            const liveInfo = data.active_agents[ag.name];
            if (liveInfo) {
              ag.isLiveActive = true;
              ag.state = 'working';
              ag.x = ag.homeX;
              ag.y = ag.homeY;
              ag.targetX = ag.homeX;
              ag.targetY = ag.homeY;
              ag.dialogue = '⚡ ' + liveInfo.action;
              ag.dialogueTimer = 250;
              ag.stateTimer = 2500;
            } else {
              ag.isLiveActive = false;
            }
          });
        } else {
          if (dot) dot.className = 'w-2.5 h-2.5 rounded-full bg-slate-500';
          if (text) text.innerText = 'Agents idle • Standing by for next terminal command or cron pipeline';
          if (badge) badge.innerHTML = '<span class="text-slate-500 text-[10px] font-mono">Fleet Standby</span>';
          agents.forEach(ag => {
            ag.isLiveActive = false;
          });
        }
      } catch (e) {
        console.error('Failed to sync live activity:', e);
      }
    }

    // --- Telemetry Polling ---
    async function refreshTelemetry() {
      try {
        const res = await fetch('/api/system');
        if (res.ok) {
          const data = await res.json();
          document.getElementById('metric-cpu').innerText = `${data.cpu_percent.toFixed(0)}%`;
          document.getElementById('metric-ram').innerText = `${data.ram_percent.toFixed(1)}%`;
          document.getElementById('metric-ram-mb').innerText = `(${data.ram_used_mb} / ${data.ram_total_mb} MB)`;
          document.getElementById('metric-disk').innerText = `${data.disk_free_gb} GB`;
        }
      } catch (e) {}
    }

