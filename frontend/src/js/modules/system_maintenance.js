    // ==============================================================
    // --- BL-SYS-01 / BL-SYS-57: Storage & Archival + Outbound Gateways ---
    // ==============================================================
    function sysEsc(s) {
      return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function fmtBytes(n) {
      n = Number(n) || 0;
      const units = ['B', 'KB', 'MB', 'GB', 'TB'];
      let i = 0;
      while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
      return `${n >= 100 || i === 0 ? Math.round(n) : n.toFixed(1)} ${units[i]}`;
    }

    function setMsg(id, text, ok) {
      const el = document.getElementById(id);
      if (!el) return;
      el.innerText = text;
      el.className = 'text-[11px] font-mono ' + (ok === true ? 'text-emerald-400' : ok === false ? 'text-rose-400' : 'text-slate-400');
    }

    async function sysJson(url, opts) {
      const res = await fetch(url, opts);
      let data = {};
      try { data = await res.json(); } catch (_) {}
      if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
      return data;
    }

    // ---------------- Storage ----------------
    let storageLastScan = null;

    async function loadSystemStorage() {
      try {
        const d = await sysJson('/api/system/storage');
        storageLastScan = d;
        renderStorage(d);
      } catch (e) {
        const body = document.getElementById('stor-rooms-body');
        if (body) body.innerHTML = `<tr><td colspan="4" class="py-3 text-rose-400">Failed to load storage: ${sysEsc(e.message)}</td></tr>`;
      }
    }

    function renderStorage(d) {
      const disk = d.disk || {};
      const pct = Number(disk.percent) || 0;
      const warn = (d.policy || {}).disk_warn_percent || 85;
      const bar = document.getElementById('stor-disk-bar');
      if (bar) {
        bar.style.width = Math.min(100, pct) + '%';
        bar.className = 'h-full transition-all ' + (pct >= warn ? 'bg-rose-500' : pct >= warn - 10 ? 'bg-amber-500' : 'bg-emerald-500');
      }
      const lbl = document.getElementById('stor-disk-label');
      if (lbl) lbl.innerText = `Host disk: ${fmtBytes(disk.used)} used of ${fmtBytes(disk.total)} • ${fmtBytes(disk.free)} free`;
      const pctEl = document.getElementById('stor-disk-pct');
      if (pctEl) pctEl.innerText = pct + '%';
      const warnEl = document.getElementById('stor-disk-warn');
      if (warnEl) warnEl.classList.toggle('hidden', pct < warn);

      const p = d.policy || {};
      const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
      setVal('pol-scratch-days', p.scratch_retention_days);
      setVal('pol-log-days', p.log_retention_days);
      setVal('pol-snap-keep', p.snapshot_keep_latest);
      setVal('pol-snap-days', p.snapshot_retention_days);
      setVal('pol-disk-warn', p.disk_warn_percent);
      setVal('pol-interval', p.auto_interval_hours);
      const auto = document.getElementById('pol-auto');
      if (auto) auto.checked = !!p.auto_enabled;

      const st = d.state || {};
      const last = document.getElementById('stor-last-run');
      if (last) {
        last.innerText = st.last_cleanup_ts
          ? `Last cleanup: ${new Date(st.last_cleanup_ts * 1000).toLocaleString()} • freed ${fmtBytes(st.last_cleanup_freed_bytes)} (${st.last_cleanup_files || 0} files)`
          : 'Never run';
      }

      const body = document.getElementById('stor-rooms-body');
      if (body) {
        const rooms = d.rooms || [];
        body.innerHTML = rooms.length ? rooms.map(r => `
          <tr class="border-b border-slate-800/60 hover:bg-slate-900/40 transition">
            <td class="py-2 pr-3 font-semibold text-slate-100">${sysEsc(r.room_name || r.room_id)}${r.persistent ? ' <span title="scratch/.persist present — exempt from cleanup" class="text-[9px] px-1 rounded bg-emerald-950 text-emerald-300 border border-emerald-800">PERSIST</span>' : ''}</td>
            <td class="pr-3 text-slate-400 font-mono text-[10px]">${sysEsc(r.room_id)}</td>
            <td class="pr-3 text-slate-300">${fmtBytes(r.scratch_bytes)} <span class="text-slate-600">(${r.scratch_files})</span></td>
            <td class="pr-3 text-slate-300">${fmtBytes(r.deliverables_bytes)} <span class="text-slate-600">(${r.deliverables_files})</span></td>
            <td class="text-right whitespace-nowrap">
              <button onclick="archiveRoom('${sysEsc(r.room_id)}', false, this)" class="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 cursor-pointer text-[10.5px]" title="Archive deliverables only">📦 Deliverables</button>
              <button onclick="archiveRoom('${sysEsc(r.room_id)}', true, this)" class="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 cursor-pointer text-[10.5px]" title="Archive deliverables + scratch">📦 Full</button>
            </td>
          </tr>`).join('') : '<tr><td colspan="5" class="py-3 text-slate-500">No sandboxes found.</td></tr>';
      }

      const other = document.getElementById('stor-other');
      if (other) {
        const o = d.other || {};
        const card = (label, v, note) => `<div class="bg-slate-950 border border-slate-800 rounded-lg p-2"><div class="text-slate-500">${label}</div><div class="text-slate-200 text-xs font-bold">${fmtBytes(v.bytes)}</div><div class="text-slate-600">${v.files} files • ${note}</div></div>`;
        other.innerHTML =
          card('Snapshots', o.snapshots || {}, 'pruned by policy') +
          card('Archives', o.archives || {}, 'protected') +
          card('Uploads', o.uploads || {}, 'protected') +
          card('Voice models', o.voice_models || {}, 'protected');
      }

      renderArchives(d.archives || []);
    }

    function renderArchives(list) {
      const el = document.getElementById('stor-archives');
      if (!el) return;
      el.innerHTML = list.length ? list.map(a => `
        <div class="flex items-center justify-between gap-2 bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5">
          <div class="min-w-0"><div class="text-slate-200 truncate">${sysEsc(a.name)}</div><div class="text-slate-500 text-[10px]">${fmtBytes(a.size)} • ${new Date(a.created * 1000).toLocaleString()}</div></div>
          <div class="flex gap-1.5 shrink-0">
            <button onclick="downloadArchive('${sysEsc(a.name)}')" class="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 cursor-pointer">⬇ Download</button>
            <button onclick="deleteArchive('${sysEsc(a.name)}')" class="px-2 py-0.5 rounded bg-rose-950/70 hover:bg-rose-900 border border-rose-800 text-rose-200 cursor-pointer">🗑</button>
          </div>
        </div>`).join('') : '<div class="text-slate-500 py-2">No archives yet — use the 📦 buttons in the sandbox table.</div>';
    }

    async function saveStoragePolicy() {
      const num = id => parseInt(document.getElementById(id).value, 10);
      try {
        await sysJson('/api/system/storage/policy', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            scratch_retention_days: num('pol-scratch-days'),
            log_retention_days: num('pol-log-days'),
            snapshot_keep_latest: num('pol-snap-keep'),
            snapshot_retention_days: num('pol-snap-days'),
            disk_warn_percent: num('pol-disk-warn'),
            auto_interval_hours: num('pol-interval'),
            auto_enabled: document.getElementById('pol-auto').checked
          })
        });
        setMsg('stor-policy-msg', 'Policy saved ✓', true);
        loadSystemStorage();
      } catch (e) { setMsg('stor-policy-msg', e.message, false); }
    }

    function renderCleanupResult(r) {
      const box = document.getElementById('stor-cleanup-result');
      if (!box) return;
      const s = r.summary || {};
      const cats = Object.entries(s.by_category || {}).map(([k, v]) => `<span class="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-700">${sysEsc(k)}: ${v.files} files • ${fmtBytes(v.bytes)}</span>`).join(' ');
      const head = r.dry_run
        ? `<div class="text-amber-300 font-bold mb-1">DRY RUN — nothing deleted. Would remove ${s.total_files} files (${fmtBytes(s.total_bytes)}).</div>`
        : `<div class="text-emerald-300 font-bold mb-1">Cleanup done — removed ${s.removed_files || 0} files, freed ${fmtBytes(s.freed_bytes)}.</div>`;
      const rows = (r.candidates || []).slice(0, 50).map(c => `<div class="truncate text-slate-400" title="${sysEsc(c.path)}">${fmtBytes(c.size)} • ${c.age_days}d • <span class="text-slate-500">${sysEsc(c.category)}</span> • ${sysEsc(c.path)}</div>`).join('');
      const errs = (r.errors || []).length ? `<div class="text-rose-400 mt-1">${r.errors.map(sysEsc).join('<br>')}</div>` : '';
      box.innerHTML = head + `<div class="flex flex-wrap gap-1.5 mb-2">${cats || '<span class="text-slate-500">Nothing matches the retention policy.</span>'}</div>` +
        (r.dry_run && rows ? `<div class="max-h-48 overflow-y-auto custom-scrollbar space-y-0.5">${rows}${s.total_files > 50 ? '<div class="text-slate-600">… preview limited to 50 largest</div>' : ''}</div>` : '') + errs;
      box.classList.remove('hidden');
    }

    async function previewStorageCleanup() {
      try {
        const r = await sysJson('/api/system/maintenance/clean-storage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dry_run: true }) });
        renderCleanupResult(r);
      } catch (e) { setMsg('stor-policy-msg', e.message, false); }
    }

    async function runStorageCleanup() {
      try {
        const pre = await sysJson('/api/system/maintenance/clean-storage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dry_run: true }) });
        const s = pre.summary || {};
        if (!s.total_files) { renderCleanupResult(pre); return; }
        if (!confirm(`Permanently delete ${s.total_files} files (${fmtBytes(s.total_bytes)}) under the current retention policy?\n\nDeliverables, uploads and voice models are never touched.`)) return;
        const r = await sysJson('/api/system/maintenance/clean-storage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dry_run: false }) });
        renderCleanupResult(r);
        loadSystemStorage();
      } catch (e) { setMsg('stor-policy-msg', e.message, false); }
    }

    async function archiveRoom(roomId, includeScratch, btn) {
      const old = btn ? btn.innerText : '';
      if (btn) { btn.disabled = true; btn.innerText = '⏳ Archiving…'; }
      try {
        const r = await sysJson('/api/system/storage/archives', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ room_id: roomId, include_scratch: !!includeScratch }) });
        setMsg('stor-policy-msg', `Archived ${r.archive.files} files → ${r.archive.name} (${fmtBytes(r.archive.size)})`, true);
        loadSystemStorage();
      } catch (e) {
        setMsg('stor-policy-msg', 'Archive failed: ' + e.message, false);
        if (btn) { btn.disabled = false; btn.innerText = old; }
      }
    }

    async function downloadArchive(name) {
      try {
        const res = await fetch(`/api/system/storage/archives/${encodeURIComponent(name)}/download`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = name;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      } catch (e) { setMsg('stor-policy-msg', 'Download failed: ' + e.message, false); }
    }

    async function deleteArchive(name) {
      if (!confirm(`Delete archive ${name}?`)) return;
      try {
        await sysJson(`/api/system/storage/archives/${encodeURIComponent(name)}`, { method: 'DELETE' });
        loadSystemStorage();
      } catch (e) { setMsg('stor-policy-msg', e.message, false); }
    }

    // ---------------- Gateways & Omnichannel Hub ----------------
    let currentWhatsAppMode = 'api';
    let currentOmnichannelMode = 'dispatcher';
    let _omniAgentsCache = [];

    function setOmnichannelRoutingMode(mode) {
      currentOmnichannelMode = (mode === 'dedicated') ? 'dedicated' : 'dispatcher';
      const cardDisp = document.getElementById('gw-omni-card-dispatcher');
      const cardDed = document.getElementById('gw-omni-card-dedicated');
      const radioDisp = document.getElementById('gw-omni-radio-dispatcher');
      const radioDed = document.getElementById('gw-omni-radio-dedicated');
      const panelDisp = document.getElementById('gw-omni-panel-dispatcher');
      const panelDed = document.getElementById('gw-omni-panel-dedicated');

      if (currentOmnichannelMode === 'dedicated') {
        if (radioDed) radioDed.checked = true;
        if (cardDed) cardDed.className = 'p-3.5 rounded-xl border-2 border-emerald-500 bg-emerald-950/25 cursor-pointer transition flex flex-col gap-2 min-w-0';
        if (cardDisp) cardDisp.className = 'p-3.5 rounded-xl border border-slate-800 bg-slate-950/60 hover:border-slate-700 cursor-pointer transition flex flex-col justify-between gap-2 min-w-0';
        if (panelDed) panelDed.classList.remove('opacity-60');
        if (panelDisp) panelDisp.classList.add('opacity-60');
      } else {
        if (radioDisp) radioDisp.checked = true;
        if (cardDisp) cardDisp.className = 'p-3.5 rounded-xl border-2 border-indigo-500 bg-indigo-950/25 cursor-pointer transition flex flex-col justify-between gap-2 min-w-0';
        if (cardDed) cardDed.className = 'p-3.5 rounded-xl border border-slate-800 bg-slate-950/60 hover:border-slate-700 cursor-pointer transition flex flex-col gap-2 min-w-0';
        if (panelDisp) panelDisp.classList.remove('opacity-60');
        if (panelDed) panelDed.classList.add('opacity-60');
      }
    }

    function onOmniDispatcherAgentChange() {
      const selAgent = document.getElementById('gw-omni-disp-agent');
      const selModel = document.getElementById('gw-omni-disp-model');
      if (!selAgent || !selModel || !_omniAgentsCache.length) return;
      const agentName = selAgent.value;
      const found = _omniAgentsCache.find(a => a.name.toLowerCase() === agentName.toLowerCase());
      if (found && Array.isArray(found.available_models) && found.available_models.length) {
        const prev = selModel.value;
        selModel.innerHTML = found.available_models.map(m =>
          `<option value="${sysEsc(m.id)}">${sysEsc(m.label || m.id)}</option>`
        ).join('');
        if ([...selModel.options].some(o => o.value === prev)) {
          selModel.value = prev;
        }
      }
    }

    function onOmniDedicatedAgentChange() {
      const selAgent = document.getElementById('gw-omni-ded-agent');
      const selModel = document.getElementById('gw-omni-ded-model');
      if (!selAgent || !selModel) return;
      const agentName = selAgent.value;
      const found = _omniAgentsCache.find(a => a.name.toLowerCase() === agentName.toLowerCase());
      const prev = selModel.value;
      let html = `<option value="">Default Active Model${found ? ` (${sysEsc(found.resolved_model || found.model_configured || 'auto')})` : ''}</option>`;
      if (found && Array.isArray(found.available_models)) {
        html += found.available_models.map(m =>
          `<option value="${sysEsc(m.id)}">${sysEsc(m.label || m.id)}</option>`
        ).join('');
      }
      selModel.innerHTML = html;
      if (prev && [...selModel.options].some(o => o.value === prev)) {
        selModel.value = prev;
      }
    }

    async function loadOmnichannelOptions(omniCfg) {
      try {
        const opts = await sysJson('/api/system/gateways/omnichannel/options');
        _omniAgentsCache = opts.agents || [];
        const rooms = opts.rooms || [];
        const dc = opts.dispatcher_config || {};

        const dedAgentEl = document.getElementById('gw-omni-ded-agent');
        const roomEl = document.getElementById('gw-omni-room');

        // Populate Option 1 Read-Only Summary from live Dispatcher Rules
        const statusEl = document.getElementById('gw-omni-disp-summary-status');
        const sourceEl = document.getElementById('gw-omni-disp-summary-source');
        const modelEl = document.getElementById('gw-omni-disp-summary-model');
        const fbEl = document.getElementById('gw-omni-disp-summary-fallback');

        const isEnabled = dc.llm_router_enabled !== false;
        if (statusEl) {
          statusEl.innerText = isEnabled ? 'ENABLED' : 'STAGE 2 RULES ONLY';
          statusEl.className = isEnabled ? 'text-emerald-400 font-bold' : 'text-amber-400 font-bold';
        }
        const srcType = dc.llm_source || 'agent';
        const dispAgent = dc.llm_agent_name || 'Chroma';
        const dispModel = (srcType === 'agent' ? (dc.llm_agent_model || dc.llm_model) : dc.llm_model) || 'gemini-2.5-flash';
        if (sourceEl) {
          sourceEl.innerText = srcType === 'agent'
            ? `Agent @${dispAgent}`
            : `Gateway (${(dc.llm_provider || 'abacus').toUpperCase()})`;
        }
        if (modelEl) {
          modelEl.innerText = dispModel;
        }
        if (fbEl) {
          const defLead = (dc.fixed_rules && dc.fixed_rules.default_fallback_agent) || 'Solaris';
          const confPct = Math.round((Number(dc.confidence_threshold) || 0.7) * 100);
          fbEl.innerText = `@${defLead} (Min conf: ${confPct}%)`;
        }

        // Update top badge if in Option 1 mode
        const oc = omniCfg || opts.omnichannel || {};
        const omniBadge = document.getElementById('gw-omni-active-badge');
        if (omniBadge && oc.enabled !== false && (oc.routing_mode || 'dispatcher') === 'dispatcher') {
          omniBadge.innerText = `OPTION 1: DISPATCHER (${dispModel.toUpperCase()})`;
        }

        if (_omniAgentsCache.length && dedAgentEl) {
          dedAgentEl.innerHTML = _omniAgentsCache.map(a =>
            `<option value="${sysEsc(a.name)}">@${sysEsc(a.name)} [${sysEsc((a.engine || 'hermes').toUpperCase())}] (${sysEsc(a.role || 'Specialist')})</option>`
          ).join('');
        }

        if (roomEl && rooms.length) {
          roomEl.innerHTML = rooms.map(r =>
            `<option value="${sysEsc(r.id)}">${sysEsc(r.name || r.id)} (${sysEsc(r.id)})</option>`
          ).join('');
        }

        if (dedAgentEl && oc.dedicated_agent) dedAgentEl.value = oc.dedicated_agent;
        onOmniDedicatedAgentChange();
        const dedModelEl = document.getElementById('gw-omni-ded-model');
        if (dedModelEl) dedModelEl.value = oc.dedicated_model || '';

        if (roomEl && oc.sync_room_id) roomEl.value = oc.sync_room_id;
      } catch (e) {
        console.warn('Omnichannel options load warning:', e);
      }
    }

    function setWhatsAppMode(mode) {
      currentWhatsAppMode = mode;
      const btnApi = document.getElementById('gw-wa-tab-api');
      const btnQr = document.getElementById('gw-wa-tab-qr');
      const panelApi = document.getElementById('gw-wa-panel-api');
      const panelQr = document.getElementById('gw-wa-panel-qr');
      if (btnApi && btnQr && panelApi && panelQr) {
        if (mode === 'qr') {
          btnQr.className = 'px-2.5 py-1 rounded bg-emerald-950 text-emerald-300 font-bold border border-emerald-800 transition';
          btnApi.className = 'px-2.5 py-1 rounded text-slate-400 hover:text-slate-200 transition';
          panelApi.classList.add('hidden');
          panelQr.classList.remove('hidden');
        } else {
          btnApi.className = 'px-2.5 py-1 rounded bg-emerald-950 text-emerald-300 font-bold border border-emerald-800 transition';
          btnQr.className = 'px-2.5 py-1 rounded text-slate-400 hover:text-slate-200 transition';
          panelQr.classList.add('hidden');
          panelApi.classList.remove('hidden');
        }
      }
    }

    function toggleGoogleDriveAuthFields() {
      const typeEl = document.getElementById('gw-gd-auth-type');
      const panelSa = document.getElementById('gw-gd-panel-sa');
      const panelApi = document.getElementById('gw-gd-panel-api');
      if (!typeEl || !panelSa || !panelApi) return;
      if (typeEl.value === 'api_key') {
        panelSa.classList.add('hidden');
        panelApi.classList.remove('hidden');
      } else {
        panelApi.classList.add('hidden');
        panelSa.classList.remove('hidden');
      }
    }

    let _waQrPollInterval = null;

    async function requestWhatsAppQR() {
      if (_waQrPollInterval) {
        clearInterval(_waQrPollInterval);
        _waQrPollInterval = null;
      }
      const qrBox = document.getElementById('gw-wa-qr-box');
      if (qrBox) qrBox.innerHTML = '<div class="flex flex-col items-center justify-center p-4 text-center"><span class="animate-spin text-xl mb-1">⏳</span><span class="text-slate-400 text-[10px] font-mono">Connecting to WhatsApp Web…</span></div>';
      try {
        const res = await sysJson('/api/system/gateways/whatsapp/qr');
        if (res.paired) {
          if (qrBox) {
            qrBox.innerHTML = `<div class="flex flex-col items-center justify-center p-3 text-emerald-400 font-mono text-center"><span class="text-3xl mb-1">✓</span><span class="text-xs font-bold">Device Already Linked!</span><span class="text-[11px] text-emerald-300 mt-1">+${res.phone || ''}</span></div>`;
          }
          await loadGateways();
          return;
        }

        if (qrBox && res.qr_svg) {
          qrBox.innerHTML = res.qr_svg;
        }

        // Auto-poll every 3 seconds to rotate QR and detect instant scan
        let pollCount = 0;
        _waQrPollInterval = setInterval(async () => {
          pollCount++;
          if (pollCount > 40) {
            clearInterval(_waQrPollInterval);
            _waQrPollInterval = null;
            return;
          }
          try {
            const pollRes = await sysJson('/api/system/gateways/whatsapp/qr');
            if (pollRes.paired) {
              clearInterval(_waQrPollInterval);
              _waQrPollInterval = null;
              if (qrBox) {
                qrBox.innerHTML = `<div class="flex flex-col items-center justify-center p-3 text-emerald-400 font-mono text-center"><span class="text-3xl mb-1">✓</span><span class="text-xs font-bold">WhatsApp Linked!</span><span class="text-[11px] text-emerald-300 mt-1">+${pollRes.phone || ''}</span></div>`;
              }
              setMsg('gw-msg-whatsapp', `Device paired with +${pollRes.phone || ''} ✓`, true);
              await loadGateways();
            } else if (pollRes.qr_svg && qrBox && qrBox.innerHTML !== pollRes.qr_svg) {
              qrBox.innerHTML = pollRes.qr_svg;
            }
          } catch (e) {}
        }, 3000);
      } catch (e) {
        if (qrBox) qrBox.innerHTML = `<span class="text-rose-500 text-[10px] font-mono text-center p-2">${sysEsc(e.message)}</span>`;
      }
    }

    async function confirmWhatsAppPairingPrompt() {
      try {
        const res = await sysJson('/api/system/gateways/whatsapp/qr/pair', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({})
        });
        if (res.status === 'paired') {
          setMsg('gw-msg-whatsapp', `Paired with +${res.phone || ''} ✓`, true);
          if (_waQrPollInterval) {
            clearInterval(_waQrPollInterval);
            _waQrPollInterval = null;
          }
          const qrBox = document.getElementById('gw-wa-qr-box');
          if (qrBox) {
            qrBox.innerHTML = `<div class="flex flex-col items-center justify-center p-3 text-emerald-400 font-mono text-center"><span class="text-3xl mb-1">✓</span><span class="text-xs font-bold">WhatsApp Linked!</span><span class="text-[11px] text-emerald-300 mt-1">+${res.phone || ''}</span></div>`;
          }
        } else {
          setMsg('gw-msg-whatsapp', 'Not paired yet. Point your phone camera at the QR code.', false);
        }
        await loadGateways();
      } catch (e) {
        setMsg('gw-msg-whatsapp', e.message, false);
      }
    }

    async function disconnectWhatsAppQR() {
      if (_waQrPollInterval) {
        clearInterval(_waQrPollInterval);
        _waQrPollInterval = null;
      }
      if (!confirm('Disconnect this paired WhatsApp device?')) return;
      try {
        await sysJson('/api/system/gateways/whatsapp/qr/disconnect', { method: 'POST' });
        setMsg('gw-msg-whatsapp', 'Disconnected WhatsApp ✓', true);
        const qrBox = document.getElementById('gw-wa-qr-box');
        if (qrBox) {
          qrBox.innerHTML = '<span class="text-slate-500 text-[10px] font-mono text-center p-2">Click "Generate QR Code" to link device</span>';
        }
        await loadGateways();
      } catch (e) {
        setMsg('gw-msg-whatsapp', e.message, false);
      }
    }

    async function loadGateways() {
      try {
        const g = await sysJson('/api/system/gateways');
        const v = (id, val) => { const el = document.getElementById(id); if (el) el.value = val == null ? '' : val; };
        const c = (id, val) => { const el = document.getElementById(id); if (el) el.checked = !!val; };

        // Omnichannel Hub
        const oc = g.omnichannel || {};
        c('gw-omni-enabled', oc.enabled !== false);
        c('gw-omni-autoreply', oc.auto_reply_channels !== false);
        c('gw-omni-autofiles', oc.auto_send_deliverables !== false);
        c('gw-omni-strict', oc.strict_operator_only !== false);
        setOmnichannelRoutingMode(oc.routing_mode || 'dispatcher');
        await loadOmnichannelOptions(oc);
        const omniBadge = document.getElementById('gw-omni-active-badge');
        if (omniBadge) {
          if (oc.enabled !== false) {
            omniBadge.innerText = oc.routing_mode === 'dedicated'
              ? `OPTION 2: @${(oc.dedicated_agent || 'SOLARIS').toUpperCase()}`
              : `OPTION 1: DISPATCHER (${(oc.dispatcher_model || 'FLASH').toUpperCase()})`;
            omniBadge.className = 'text-[9px] px-2 py-0.5 rounded font-bold uppercase bg-emerald-950 text-emerald-300 border border-emerald-700 font-mono';
          } else {
            omniBadge.innerText = 'SYNC PAUSED';
            omniBadge.className = 'text-[9px] px-2 py-0.5 rounded font-bold uppercase bg-slate-800 text-slate-400 border border-slate-700 font-mono';
          }
        }

        // Telegram
        c('gw-tg-enabled', g.telegram?.enabled);
        c('gw-tg-strict', g.telegram?.only_user_chat_id !== false);
        v('gw-tg-token', g.telegram?.bot_token);
        v('gw-tg-chat', g.telegram?.chat_id);

        // WhatsApp
        const wa = g.whatsapp || {};
        c('gw-wa-enabled', wa.enabled);
        v('gw-wa-phone', wa.recipient_phone);
        v('gw-wa-phone-id', wa.phone_number_id);
        v('gw-wa-url', wa.api_url);
        v('gw-wa-token', wa.api_token);
        v('gw-wa-user-phone', wa.user_phone || wa.qr_paired_number || wa.recipient_phone || '');
        c('gw-wa-strict-user', wa.only_user_number !== false);
        setWhatsAppMode(wa.mode || 'api');
        const waStatusEl = document.getElementById('gw-wa-qr-status');
        const qrBox = document.getElementById('gw-wa-qr-box');
        if (waStatusEl) {
          if (wa.qr_paired) {
            waStatusEl.innerText = `LINKED: +${wa.qr_paired_number || 'CONNECTED'}`;
            waStatusEl.className = 'text-[9px] px-2 py-0.5 rounded font-bold uppercase bg-emerald-950 text-emerald-300 border border-emerald-700';
            if (qrBox && (!qrBox.querySelector('.text-emerald-400') || !qrBox.innerHTML.includes(wa.qr_paired_number))) {
              qrBox.innerHTML = `<div class="flex flex-col items-center justify-center p-3 text-emerald-400 font-mono text-center"><span class="text-3xl mb-1">✓</span><span class="text-xs font-bold">WhatsApp Linked!</span><span class="text-[11px] text-emerald-300 mt-1">+${wa.qr_paired_number || ''}</span></div>`;
            }
          } else {
            waStatusEl.innerText = 'UNPAIRED';
            waStatusEl.className = 'text-[9px] px-2 py-0.5 rounded font-bold uppercase bg-slate-800 text-slate-400 border border-slate-700';
          }
        }

        // Google Drive
        const gd = g.google_drive || {};
        c('gw-gd-enabled', gd.enabled);
        v('gw-gd-auth-type', gd.auth_type || 'service_account');
        v('gw-gd-sa-json', gd.service_account_json);
        v('gw-gd-api-key', gd.api_key);
        v('gw-gd-folder', gd.target_folder_id);
        c('gw-gd-auto-sync', gd.auto_sync_deliverables !== false);
        toggleGoogleDriveAuthFields();

        // Email
        c('gw-em-enabled', g.email?.enabled);
        c('gw-em-strict', g.email?.only_user_email !== false);
        v('gw-em-host', g.email?.smtp_host);
        v('gw-em-port', g.email?.smtp_port);
        v('gw-em-sec', g.email?.security);
        v('gw-em-user', g.email?.username);
        v('gw-em-pass', g.email?.password);
        v('gw-em-from', g.email?.from_addr);
        v('gw-em-to', g.email?.to_addr);

        // Webhook
        c('gw-wh-enabled', g.webhook?.enabled);
        v('gw-wh-url', g.webhook?.url);
        v('gw-wh-token', g.webhook?.bearer_token);

        // Triggers
        c('gw-trg-mention', g.triggers?.on_user_mention);
        c('gw-trg-task-start', g.triggers?.on_task_start);
        c('gw-trg-task-progress', g.triggers?.on_task_progress);
        c('gw-trg-task', g.triggers?.on_task_failure);
        c('gw-trg-task-success', g.triggers?.on_task_success);
        c('gw-trg-disk', g.triggers?.on_disk_warning);
        c('gw-trg-away', g.triggers?.only_when_disconnected);
      } catch (e) { setMsg('gw-save-msg', 'Failed to load: ' + e.message, false); }
    }

    function collectGateways() {
      const v = id => { const el = document.getElementById(id); return el ? el.value : ''; };
      const c = id => { const el = document.getElementById(id); return el ? el.checked : false; };
      return {
        omnichannel: {
          enabled: c('gw-omni-enabled'),
          routing_mode: currentOmnichannelMode,
          dispatcher_agent: v('gw-omni-disp-agent') || 'Chroma',
          dispatcher_model: v('gw-omni-disp-model') || 'gemini-2.5-flash',
          dedicated_agent: v('gw-omni-ded-agent') || 'Solaris',
          dedicated_model: v('gw-omni-ded-model') || '',
          sync_room_id: v('gw-omni-room') || 'general',
          auto_reply_channels: c('gw-omni-autoreply'),
          auto_send_deliverables: c('gw-omni-autofiles'),
          strict_operator_only: c('gw-omni-strict')
        },
        telegram: {
          enabled: c('gw-tg-enabled'),
          only_user_chat_id: c('gw-tg-strict'),
          bot_token: v('gw-tg-token'),
          chat_id: v('gw-tg-chat')
        },
        whatsapp: {
          enabled: c('gw-wa-enabled'),
          mode: currentWhatsAppMode,
          user_phone: v('gw-wa-user-phone'),
          only_user_number: c('gw-wa-strict-user'),
          recipient_phone: v('gw-wa-phone'),
          phone_number_id: v('gw-wa-phone-id'),
          api_url: v('gw-wa-url'),
          api_token: v('gw-wa-token')
        },
        google_drive: {
          enabled: c('gw-gd-enabled'),
          auth_type: v('gw-gd-auth-type') || 'service_account',
          service_account_json: v('gw-gd-sa-json'),
          api_key: v('gw-gd-api-key'),
          target_folder_id: v('gw-gd-folder'),
          auto_sync_deliverables: c('gw-gd-auto-sync')
        },
        email: {
          enabled: c('gw-em-enabled'),
          only_user_email: c('gw-em-strict'),
          smtp_host: v('gw-em-host'),
          smtp_port: parseInt(v('gw-em-port'), 10) || 587,
          security: v('gw-em-sec'),
          username: v('gw-em-user'),
          password: v('gw-em-pass'),
          from_addr: v('gw-em-from'),
          to_addr: v('gw-em-to')
        },
        webhook: { enabled: c('gw-wh-enabled'), url: v('gw-wh-url'), bearer_token: v('gw-wh-token') },
        triggers: {
          on_user_mention: c('gw-trg-mention'),
          on_task_start: c('gw-trg-task-start'),
          on_task_progress: c('gw-trg-task-progress'),
          on_task_failure: c('gw-trg-task'),
          on_task_success: c('gw-trg-task-success'),
          on_disk_warning: c('gw-trg-disk'),
          only_when_disconnected: c('gw-trg-away')
        }
      };
    }

    async function saveGateways(quiet) {
      try {
        await sysJson('/api/system/gateways', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(collectGateways()) });
        if (!quiet) setMsg('gw-save-msg', 'Gateways saved ✓', true);
        await loadGateways();
        return true;
      } catch (e) { setMsg('gw-save-msg', e.message, false); return false; }
    }

    async function testGateway(channel) {
      setMsg(`gw-msg-${channel}`, 'Saving & verifying…', null);
      if (!(await saveGateways(true))) { setMsg(`gw-msg-${channel}`, 'Fix the form errors first', false); return; }
      try {
        const r = await sysJson(`/api/system/gateways/${channel}/test`, { method: 'POST' });
        setMsg(`gw-msg-${channel}`, r.ok ? (r.message || 'Verified ✓') : 'Failed: ' + r.error, !!r.ok);
      } catch (e) { setMsg(`gw-msg-${channel}`, e.message, false); }
    }

    function usePairedAsUserNumber() {
      const waStatusEl = document.getElementById('gw-wa-qr-status');
      const userPhoneEl = document.getElementById('gw-wa-user-phone');
      if (!userPhoneEl) return;
      let num = '';
      if (waStatusEl && waStatusEl.innerText.includes('+')) {
        num = waStatusEl.innerText.split('+')[1].trim();
      }
      if (!num) {
        num = prompt('Enter Operator WhatsApp Phone Number (e.g. 62812345678):') || '';
      }
      if (num) {
        userPhoneEl.value = num.replace(/\D/g, '');
        saveGateways(false);
      }
    }

    let _tgQrPollInterval = null;

    async function generateTelegramQR() {
      const tokenInput = document.getElementById('gw-tg-token');
      const qrBox = document.getElementById('gw-tg-qr-box');
      const badgeEl = document.getElementById('gw-tg-bot-badge');
      const linkContainer = document.getElementById('gw-tg-link-container');
      const linkEl = document.getElementById('gw-tg-link');
      const linkText = document.getElementById('gw-tg-link-text');
      const codeBanner = document.getElementById('gw-tg-code-banner');
      const codeVal = document.getElementById('gw-tg-code-val');

      const token = (tokenInput ? tokenInput.value : '').trim();
      if (!token) {
        setMsg('gw-msg-telegram', 'Please enter your Telegram Bot Token first.', false);
        if (tokenInput) tokenInput.focus();
        return;
      }

      if (_tgQrPollInterval) {
        clearInterval(_tgQrPollInterval);
        _tgQrPollInterval = null;
      }

      if (qrBox) {
        qrBox.innerHTML = '<span class="text-sky-400 text-[10px] font-mono animate-pulse">Querying Telegram…</span>';
      }
      setMsg('gw-msg-telegram', 'Generating pairing code &amp; QR…', null);

      try {
        const res = await sysJson('/api/system/gateways/telegram/qr', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bot_token: token })
        });

        if (res.ok) {
          if (res.qr_svg && qrBox) {
            qrBox.innerHTML = res.qr_svg;
          }
          if (badgeEl) {
            badgeEl.innerText = `@${res.bot_username || res.bot_name}`;
            badgeEl.classList.remove('hidden');
          }
          if (codeBanner && codeVal && res.pairing_code) {
            codeVal.innerText = res.pairing_code;
            codeBanner.classList.remove('hidden');
          }
          if (linkContainer && linkEl && linkText) {
            linkEl.href = res.bot_url;
            linkText.innerText = `Open @${res.bot_username} in Telegram (Code: ${res.pairing_code || ''})`;
            linkContainer.classList.remove('hidden');
          }
          setMsg('gw-msg-telegram', `Code: ${res.pairing_code}. Waiting for you to tap START in Telegram…`, null);

          // Auto-poll every 2.5 seconds to auto-detect when the user scans/starts the bot!
          let pollAttempts = 0;
          _tgQrPollInterval = setInterval(async () => {
            pollAttempts++;
            if (pollAttempts > 45) { // 45 * 2.5s = ~110 seconds
              clearInterval(_tgQrPollInterval);
              _tgQrPollInterval = null;
              return;
            }
            try {
              const checkRes = await sysJson('/api/system/gateways/telegram/detect-chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ bot_token: token })
              });
              if (checkRes.ok && checkRes.chat_id) {
                clearInterval(_tgQrPollInterval);
                _tgQrPollInterval = null;
                const chatInput = document.getElementById('gw-tg-chat');
                if (chatInput) chatInput.value = checkRes.chat_id;
                const tgEnabled = document.getElementById('gw-tg-enabled');
                if (tgEnabled) tgEnabled.checked = true;
                if (qrBox) {
                  qrBox.innerHTML = `<div class="flex flex-col items-center justify-center p-2 text-emerald-400 font-mono text-center"><span class="text-3xl mb-1">✓</span><span class="text-xs font-bold">Telegram Paired!</span><span class="text-[10px] text-emerald-300 mt-1">ID: ${checkRes.chat_id}</span></div>`;
                }
                setMsg('gw-msg-telegram', `Auto-paired with ${checkRes.user_label || 'Operator'} (ID: ${checkRes.chat_id}) ✓`, true);
                await loadGateways();
              }
            } catch (_) {}
          }, 2500);

        } else {
          throw new Error(res.detail || 'Failed to generate QR');
        }
      } catch (e) {
        if (qrBox) {
          qrBox.innerHTML = `<span class="text-rose-400 text-[9px] font-mono text-center p-1">${sysEsc(e.message)}</span>`;
        }
        setMsg('gw-msg-telegram', e.message, false);
      }
    }

    async function detectTelegramChatId() {
      const tokenInput = document.getElementById('gw-tg-token');
      const chatInput = document.getElementById('gw-tg-chat');
      const qrBox = document.getElementById('gw-tg-qr-box');
      const token = (tokenInput ? tokenInput.value : '').trim();

      setMsg('gw-msg-telegram', 'Checking recent bot messages…', null);

      try {
        const res = await sysJson('/api/system/gateways/telegram/detect-chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bot_token: token })
        });

        if (res.ok && res.chat_id) {
          if (chatInput) chatInput.value = res.chat_id;
          const tgEnabled = document.getElementById('gw-tg-enabled');
          if (tgEnabled) tgEnabled.checked = true;
          if (qrBox) {
            qrBox.innerHTML = `<div class="flex flex-col items-center justify-center p-2 text-emerald-400 font-mono text-center"><span class="text-3xl mb-1">✓</span><span class="text-xs font-bold">Telegram Paired!</span><span class="text-[10px] text-emerald-300 mt-1">ID: ${res.chat_id}</span></div>`;
          }
          setMsg('gw-msg-telegram', res.message || `Detected operator Chat ID: ${res.chat_id} ✓`, true);
          await loadGateways();
        } else {
          setMsg('gw-msg-telegram', res.message || 'No recent messages found. Tap START on Telegram first!', false);
        }
      } catch (e) {
        setMsg('gw-msg-telegram', e.message, false);
      }
    }

    window.generateTelegramQR = generateTelegramQR;
    window.detectTelegramChatId = detectTelegramChatId;
    window.usePairedAsUserNumber = usePairedAsUserNumber;
    window.setOmnichannelRoutingMode = setOmnichannelRoutingMode;
    window.onOmniDispatcherAgentChange = onOmniDispatcherAgentChange;
    window.onOmniDedicatedAgentChange = onOmniDedicatedAgentChange;
    window.loadOmnichannelOptions = loadOmnichannelOptions;
    window.loadSystemStorage = loadSystemStorage;
    window.saveStoragePolicy = saveStoragePolicy;
    window.previewStorageCleanup = previewStorageCleanup;
    window.runStorageCleanup = runStorageCleanup;
    window.archiveRoom = archiveRoom;
    window.downloadArchive = downloadArchive;
    window.deleteArchive = deleteArchive;
    window.loadGateways = loadGateways;
    window.saveGateways = saveGateways;
    window.testGateway = testGateway;
    window.setWhatsAppMode = setWhatsAppMode;
    window.toggleGoogleDriveAuthFields = toggleGoogleDriveAuthFields;
    window.requestWhatsAppQR = requestWhatsAppQR;
    window.confirmWhatsAppPairingPrompt = confirmWhatsAppPairingPrompt;
    window.disconnectWhatsAppQR = disconnectWhatsAppQR;
