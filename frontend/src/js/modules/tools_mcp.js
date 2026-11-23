    // --- TAB: Tools, APIs & MCP Hub Logic ---
    let toolsData = { core_toolsets: [], agent_tools: {} };
    let mcpCatalogData = [];
    let mcpConfiguredData = {};
    let selectedToolsAgent = 'Solaris';

    async function loadToolsAndMcpHub() {
      try {
        const [tRes, mRes] = await Promise.all([
          fetch('/api/tools'),
          fetch('/api/mcp')
        ]);
        if (tRes.ok) toolsData = await tRes.json();
        if (mRes.ok) {
          const mJson = await mRes.json();
          mcpCatalogData = mJson.catalog || [];
          mcpConfiguredData = mJson.configured_servers || {};
        }

        renderToolsAgentTabs();
        renderToolsMatrix();
        renderMcpConfiguredServers();
        renderMcpCatalog();
      } catch (e) {
        console.error('Failed to load tools and MCP Hub:', e);
      }
    }

    function renderToolsAgentTabs() {
      const container = document.getElementById('tools-agent-tabs');
      if (!container) return;

      const agentNames = availableAgentsList.length ? availableAgentsList : Object.keys(toolsData.agent_tools || {});
      if (!agentNames.includes(selectedToolsAgent) && agentNames.length) {
        selectedToolsAgent = agentNames[0];
      }

      const badge = document.getElementById('tools-active-agent-badge');
      if (badge) badge.innerText = `AGENT: ${selectedToolsAgent.toUpperCase()}`;

      container.innerHTML = agentNames.map(name => {
        const isSelected = name.toLowerCase() === selectedToolsAgent.toLowerCase();
        return `
          <button onclick="selectToolsAgent('${name}')" class="px-3 py-1.5 rounded-lg text-xs font-mono font-semibold transition ${
            isSelected
              ? 'bg-cyan-600 text-white shadow-sm border border-cyan-500'
              : 'bg-slate-900 text-slate-400 hover:text-slate-200 hover:bg-slate-800 border border-slate-800'
          }">
            ${name}
          </button>
        `;
      }).join('');
    }

    function selectToolsAgent(name) {
      selectedToolsAgent = name;
      renderToolsAgentTabs();
      renderToolsMatrix();
    }

    function renderToolsMatrix() {
      const grid = document.getElementById('tools-matrix-grid');
      if (!grid) return;

      const currentTools = toolsData.agent_tools?.[selectedToolsAgent] || [];
      const hasWildcard = currentTools.includes('*');

      grid.innerHTML = (toolsData.core_toolsets || []).map(tool => {
        const isEnabled = hasWildcard || currentTools.includes(tool.id) || (tool.id === 'file_editor' && currentTools.includes('file')) || (tool.id === 'web_search' && currentTools.includes('web'));

        return `
          <div class="bg-slate-950/80 p-4 rounded-xl border ${isEnabled ? 'border-cyan-800/80' : 'border-slate-800/60'} flex flex-col justify-between transition hover:border-slate-700">
            <div>
              <div class="flex items-center justify-between mb-2">
                <span class="text-xl">${tool.icon || '⚡'}</span>
                <label class="relative inline-flex items-center cursor-pointer">
                  <input type="checkbox" ${isEnabled ? 'checked' : ''} onchange="toggleAgentTool('${selectedToolsAgent}', '${tool.id}', this.checked)" class="sr-only peer">
                  <div class="w-9 h-5 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-500"></div>
                </label>
              </div>
              <h3 class="font-bold text-xs ${isEnabled ? 'text-cyan-300' : 'text-slate-300'} font-mono mb-1">${tool.name}</h3>
              <p class="text-[11px] text-slate-400 font-mono leading-relaxed">${tool.desc}</p>
            </div>
            <div class="mt-3 pt-2 border-t border-slate-800/80 flex items-center justify-between text-[10px] font-mono">
              <span class="text-slate-500">Privilege:</span>
              <span class="${isEnabled ? 'text-emerald-400' : 'text-slate-500'} font-semibold">${isEnabled ? 'GRANTED' : 'RESTRICTED'}</span>
            </div>
          </div>
        `;
      }).join('');
    }

    async function toggleAgentTool(agentName, toolId, enabled) {
      try {
        const res = await fetch('/api/tools/toggle', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agent_name: agentName,
            toolset: toolId,
            enabled: enabled
          })
        });

        if (res.ok) {
          const toast = document.getElementById('tools-save-toast');
          if (toast) {
            toast.classList.remove('hidden');
            setTimeout(() => toast.classList.add('hidden'), 2500);
          }
          // Refresh tools data
          const tRes = await fetch('/api/tools');
          if (tRes.ok) {
            toolsData = await tRes.json();
            renderToolsMatrix();
          }
        } else {
          const err = await res.json();
          alert(`Tool toggle error: ${err.detail || 'Failed to update tool'}`);
        }
      } catch (e) {
        alert('Error toggling tool: ' + e);
      }
    }

    function renderMcpConfiguredServers() {
      const grid = document.getElementById('mcp-servers-grid');
      if (!grid) return;

      const keys = Object.keys(mcpConfiguredData || {});
      if (!keys.length) {
        grid.innerHTML = `
          <div class="col-span-full bg-slate-950/60 p-6 rounded-xl border border-dashed border-slate-800 text-center text-xs text-slate-400 font-mono">
            <span class="text-2xl block mb-2">🔌</span>
            <span>No external MCP server daemons configured yet.</span><br />
            <span class="text-slate-500 text-[11px]">Install a connector from the Nous Catalog below or add a custom server.</span>
          </div>
        `;
        return;
      }

      grid.innerHTML = keys.map(k => {
        const srv = mcpConfiguredData[k];
        const isSse = !!srv.url;
        const envCount = Object.keys(srv.env || {}).length;

        return `
          <div class="bg-slate-950 p-4 rounded-xl border border-slate-800 flex flex-col justify-between hover:border-slate-700 transition shadow-lg">
            <div>
              <div class="flex items-center justify-between mb-2">
                <span class="px-2 py-0.5 rounded text-[9px] font-mono font-bold uppercase ${isSse ? 'bg-purple-950 text-purple-300 border border-purple-800' : 'bg-cyan-950 text-cyan-300 border border-cyan-800'}">
                  ${isSse ? 'SSE / HTTP' : 'STDIO'}
                </span>
                <span class="text-[10px] text-emerald-400 font-mono flex items-center gap-1">
                  <span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span> ACTIVE
                </span>
              </div>
              <h3 class="font-bold text-sm text-slate-100 font-mono mb-1">${k}</h3>
              <p class="text-[11px] text-slate-400 font-mono truncate mb-2">${srv.command || srv.url}</p>
              <div class="bg-slate-900/60 p-2 rounded border border-slate-800/80 text-[10px] font-mono text-slate-400 space-y-1">
                <div>Env Keys: <span class="text-cyan-300">${envCount} set</span></div>
                ${srv.args?.length ? `<div>Args: <span class="text-slate-300">${srv.args.join(' ')}</span></div>` : ''}
              </div>
            </div>
            <div class="flex gap-2 pt-3 mt-3 border-t border-slate-800/80">
              <button onclick="openMcpConfigModal('${k}')" class="flex-1 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-mono font-semibold transition">
                Configure
              </button>
              <button onclick="deleteMcpServer('${k}')" class="px-2.5 py-1.5 rounded bg-rose-950/80 hover:bg-rose-900 text-rose-300 border border-rose-800 text-xs font-mono font-semibold transition">
                🗑️
              </button>
            </div>
          </div>
        `;
      }).join('');
    }

        let currentMcpCatalogFilter = 'all';

    function filterMcpCatalogCategory(cat) {
      currentMcpCatalogFilter = cat;
      const btnAll = document.getElementById('mcp-cat-btn-all');
      const btnCore = document.getElementById('mcp-cat-btn-core');
      const btnCloud = document.getElementById('mcp-cat-btn-cloud');

      if (btnAll) btnAll.className = (cat === 'all') ? 'px-2.5 py-1 rounded bg-amber-900/60 border border-amber-500/70 text-[10px] text-amber-200 font-mono font-semibold' : 'px-2.5 py-1 rounded bg-slate-900 border border-slate-800 text-[10px] text-slate-400 hover:text-slate-200 font-mono font-semibold';
      if (btnCore) btnCore.className = (cat === 'core') ? 'px-2.5 py-1 rounded bg-amber-900/60 border border-amber-500/70 text-[10px] text-amber-200 font-mono font-semibold' : 'px-2.5 py-1 rounded bg-slate-900 border border-slate-800 text-[10px] text-slate-400 hover:text-slate-200 font-mono font-semibold';
      if (btnCloud) btnCloud.className = (cat === 'cloud') ? 'px-2.5 py-1 rounded bg-amber-900/60 border border-amber-500/70 text-[10px] text-amber-200 font-mono font-semibold' : 'px-2.5 py-1 rounded bg-slate-900 border border-slate-800 text-[10px] text-slate-400 hover:text-slate-200 font-mono font-semibold';

      renderMcpCatalog();
    }

    function renderMcpCatalog() {
      const grid = document.getElementById('mcp-catalog-grid');
      if (!grid) return;

      const filtered = (mcpCatalogData || []).filter(cat => {
        if (currentMcpCatalogFilter === 'all') return true;
        if (currentMcpCatalogFilter === 'core') return cat.group === 'core';
        if (currentMcpCatalogFilter === 'cloud') return cat.group === 'cloud';
        return true;
      });

      grid.innerHTML = filtered.map(cat => {
        const isConfigured = !!mcpConfiguredData?.[cat.name];
        const isCloud = cat.group === 'cloud';

        return `
          <div class="bg-slate-950/70 p-4 rounded-xl border border-slate-800 flex flex-col justify-between hover:border-slate-700 transition">
            <div>
              <div class="flex items-center justify-between mb-2">
                <span class="px-2 py-0.5 rounded text-[9px] font-mono font-bold uppercase ${isCloud ? 'bg-cyan-950/80 text-cyan-300 border border-cyan-800' : 'bg-amber-950/80 text-amber-300 border border-amber-800'}">
                  ${cat.badge || (isCloud ? 'EXTERNAL' : 'CORE')}
                </span>
                <span class="text-[10px] text-slate-500 font-mono">${cat.auth}</span>
              </div>
              <h4 class="font-bold text-sm text-slate-100 font-mono mb-0.5">${cat.name}</h4>
              <span class="text-[10px] ${isCloud ? 'text-cyan-400' : 'text-amber-400'} font-mono block mb-2">${cat.category}</span>
              <p class="text-xs text-slate-400 font-mono leading-relaxed mb-3">${cat.desc}</p>
            </div>
            <button type="button" onclick="openMcpConfigModal('${cat.name}')" class="w-full py-2 rounded-lg ${isConfigured ? 'bg-slate-800 text-slate-300 hover:bg-slate-700' : 'bg-cyan-700 hover:bg-cyan-600 text-white'} text-xs font-mono font-semibold transition flex items-center justify-center gap-1.5 cursor-pointer">
              <span>${isConfigured ? '⚙️' : '📥'}</span>
              <span>${isConfigured ? 'Edit Configuration' : 'Install / Configure'}</span>
            </button>
          </div>
        `;
      }).join('');
    }

    function applyMcpTemplate(presetKey) {
      const normalizedKey = (presetKey || '').toLowerCase();
      const templates = {
        filesystem: {
          name: 'filesystem',
          command: 'npx -y @modelcontextprotocol/server-filesystem /home/myvirtualcoder/nexusdesk/workspace',
          url: '',
          args: '',
          env: '{}'
        },
        postgres: {
          name: 'postgres',
          command: 'npx -y @modelcontextprotocol/server-postgres postgresql://user:pass@localhost:5432/dbname',
          url: '',
          args: '',
          env: '{}'
        },
        sqlite: {
          name: 'sqlite',
          command: 'npx -y @modelcontextprotocol/server-sqlite /home/myvirtualcoder/nexusdesk/database.sqlite',
          url: '',
          args: '',
          env: '{}'
        },
        'brave-search': {
          name: 'brave-search',
          command: 'npx -y @modelcontextprotocol/server-brave-search',
          url: '',
          args: '',
          env: '{\n  "BRAVE_API_KEY": "BSA..."\n}'
        },
        git: {
          name: 'git',
          command: 'npx -y @modelcontextprotocol/server-git /home/myvirtualcoder/nexusdesk',
          url: '',
          args: '',
          env: '{}'
        },
        puppeteer: {
          name: 'puppeteer',
          command: 'npx -y @modelcontextprotocol/server-puppeteer',
          url: '',
          args: '',
          env: '{}'
        },
        fetch: {
          name: 'fetch',
          command: 'uvx mcp-server-fetch',
          url: '',
          args: '',
          env: '{}'
        },
        memory: {
          name: 'memory',
          command: 'npx -y @modelcontextprotocol/server-memory',
          url: '',
          args: '',
          env: '{}'
        },
        linear: {
          name: 'linear',
          command: '',
          url: 'https://mcp.linear.app/sse',
          args: '',
          env: '{\n  "LINEAR_API_KEY": "lin_api_..."\n}'
        },
        supabase: {
          name: 'supabase',
          command: 'npx -y @modelcontextprotocol/server-supabase',
          url: '',
          args: '',
          env: '{\n  "SUPABASE_URL": "https://xyz.supabase.co",\n  "SUPABASE_SERVICE_ROLE_KEY": "..."\n}'
        },
        cloudflare: {
          name: 'cloudflare',
          command: 'npx -y @cloudflare/mcp-server-cloudflare',
          url: '',
          args: '',
          env: '{\n  "CLOUDFLARE_API_TOKEN": "..."\n}'
        },
        deepwiki: {
          name: 'deepwiki',
          command: 'npx -y @modelcontextprotocol/server-deepwiki',
          url: '',
          args: '',
          env: '{}'
        },
        sentry: {
          name: 'sentry',
          command: 'npx -y @modelcontextprotocol/server-sentry',
          url: '',
          args: '',
          env: '{\n  "SENTRY_AUTH_TOKEN": "..."\n}'
        },
        stripe: {
          name: 'stripe',
          command: 'npx -y @stripe/mcp',
          url: '',
          args: '',
          env: '{\n  "STRIPE_SECRET_KEY": "sk_test_..."\n}'
        },
        notion: {
          name: 'notion',
          command: 'npx -y @modelcontextprotocol/server-notion',
          url: '',
          args: '',
          env: '{\n  "NOTION_API_KEY": "secret_..."\n}'
        },
        datadog: {
          name: 'datadog',
          command: 'npx -y @datadog/mcp-server-datadog',
          url: '',
          args: '',
          env: '{\n  "DD_API_KEY": "...",\n  "DD_APP_KEY": "..."\n}'
        },
        figma: {
          name: 'figma',
          command: 'npx -y @modelcontextprotocol/server-figma',
          url: '',
          args: '',
          env: '{\n  "FIGMA_ACCESS_TOKEN": "figd_..."\n}'
        },
        github: {
          name: 'github',
          command: 'npx -y @modelcontextprotocol/server-github',
          url: '',
          args: '',
          env: '{\n  "GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_..."\n}'
        }
      };

      const tpl = templates[normalizedKey];
      if (!tpl) return;

      document.getElementById('modal-mcp-name').value = tpl.name;
      document.getElementById('modal-mcp-command').value = tpl.command;
      document.getElementById('modal-mcp-url').value = tpl.url;
      document.getElementById('modal-mcp-args').value = tpl.args;
      document.getElementById('modal-mcp-env').value = tpl.env;
      
      const testStatus = document.getElementById('modal-mcp-test-status');
      if (testStatus) testStatus.classList.add('hidden');
    }

    async function testMcpConnection() {
      const name = document.getElementById('modal-mcp-name').value.trim();
      const command = document.getElementById('modal-mcp-command').value.trim();
      const url = document.getElementById('modal-mcp-url').value.trim();
      const testStatus = document.getElementById('modal-mcp-test-status');

      if (!name) {
        alert('Please specify a server name first.');
        return;
      }
      if (!command && !url) {
        alert('Please enter either a stdio command or an SSE/HTTP url to test.');
        return;
      }

      if (testStatus) {
        testStatus.classList.remove('hidden');
        testStatus.className = 'text-xs font-mono px-3 py-2 rounded-lg bg-cyan-950/60 border border-cyan-800 text-cyan-300 flex items-center gap-2';
        testStatus.innerHTML = '<span class="animate-spin">⏳</span> Probing server connection...';
      }

      try {
        const inst = localStorage.getItem('nexusdesk_instance') || 'agents_bs';
        const res = await fetch('/api/mcp/test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, command, url, instance: inst })
        });
        const result = await res.json();
        if (testStatus) {
          const detail = result.detail || result.message || '';
          if (result.status === 'online' || result.status === 'ok') {
            testStatus.className = 'text-xs font-mono px-3 py-2 rounded-lg bg-emerald-950/60 border border-emerald-800 text-emerald-300 flex items-center gap-2';
            testStatus.innerHTML = `<span>✅</span> <span><strong>Ready (${result.latency_ms || 0}ms):</strong> ${detail}</span>`;
          } else if (result.status === 'warning') {
            testStatus.className = 'text-xs font-mono px-3 py-2 rounded-lg bg-amber-950/60 border border-amber-800 text-amber-300 flex items-center gap-2';
            testStatus.innerHTML = `<span>⚠️</span> <span><strong>Notice (${result.latency_ms || 0}ms):</strong> ${detail}</span>`;
          } else {
            testStatus.className = 'text-xs font-mono px-3 py-2 rounded-lg bg-rose-950/60 border border-rose-800 text-rose-300 flex items-center gap-2';
            testStatus.innerHTML = `<span>❌</span> <span><strong>Probe Failed:</strong> ${detail || result.error || 'Connection failed'}</span>`;
          }
        }
      } catch (err) {
        if (testStatus) {
          testStatus.className = 'text-xs font-mono px-3 py-2 rounded-lg bg-rose-950/60 border border-rose-800 text-rose-300 flex items-center gap-2';
          testStatus.innerHTML = `<span>❌</span> <span>Error contacting test endpoint: ${err.message}</span>`;
        }
      }
    }

    function openMcpConfigModal(serverName = '') {
      try {
        const sName = (serverName || '').trim();
        const existing = sName ? mcpConfiguredData?.[sName] : null;
        const catalogItem = sName ? (mcpCatalogData || []).find(c => c.name.toLowerCase() === sName.toLowerCase()) : null;

        const modal = document.getElementById('mcp-config-modal');
        if (!modal) {
          alert('Configuration modal element not found');
          return;
        }

        const titleEl = document.getElementById('modal-mcp-title');
        const nameEl = document.getElementById('modal-mcp-name');
        const cmdEl = document.getElementById('modal-mcp-command');
        const urlEl = document.getElementById('modal-mcp-url');
        const argsEl = document.getElementById('modal-mcp-args');
        const envEl = document.getElementById('modal-mcp-env');
        const testStatus = document.getElementById('modal-mcp-test-status');
        if (testStatus) testStatus.classList.add('hidden');

        if (existing) {
          if (titleEl) titleEl.innerText = `EDIT MCP SERVER: ${sName.toUpperCase()}`;
          if (nameEl) nameEl.value = sName;
          if (cmdEl) cmdEl.value = existing.command || '';
          if (urlEl) urlEl.value = existing.url || '';
          if (argsEl) argsEl.value = Array.isArray(existing.args) ? existing.args.join(', ') : (existing.args || '');
          if (envEl) envEl.value = JSON.stringify(existing.env || {}, null, 2);
        } else if (catalogItem) {
          if (titleEl) titleEl.innerText = `CONFIGURE MCP SERVER: ${sName.toUpperCase()}`;
          if (nameEl) nameEl.value = catalogItem.name;
          if (cmdEl) cmdEl.value = catalogItem.default_command || '';
          if (urlEl) urlEl.value = catalogItem.default_url || '';
          if (argsEl) argsEl.value = Array.isArray(catalogItem.default_args) ? catalogItem.default_args.join(', ') : '';
          if (envEl) envEl.value = JSON.stringify(catalogItem.env || {}, null, 2);
        } else if (sName) {
          if (titleEl) titleEl.innerText = `CONFIGURE MCP SERVER: ${sName.toUpperCase()}`;
          if (nameEl) nameEl.value = sName;
          applyMcpTemplate(sName.toLowerCase());
        } else {
          if (titleEl) titleEl.innerText = 'CONFIGURE CUSTOM MCP SERVER';
          if (nameEl) nameEl.value = '';
          if (cmdEl) cmdEl.value = '';
          if (urlEl) urlEl.value = '';
          if (argsEl) argsEl.value = '';
          if (envEl) envEl.value = '{}';
        }

        modal.classList.remove('hidden');
        modal.style.display = 'flex';
      } catch (err) {
        console.error('Error opening MCP config modal:', err);
        alert('Error opening MCP config modal: ' + err.message);
      }
    }

    function closeMcpConfigModal() {
      const modal = document.getElementById('mcp-config-modal');
      if (modal) {
        modal.classList.add('hidden');
        modal.style.display = 'none';
      }
    }

    async function submitSaveMcpServer() {
      const name = document.getElementById('modal-mcp-name').value.trim();
      const command = document.getElementById('modal-mcp-command').value.trim();
      const url = document.getElementById('modal-mcp-url').value.trim();
      const argsRaw = document.getElementById('modal-mcp-args').value.trim();
      const envRaw = document.getElementById('modal-mcp-env').value.trim();

      if (!name) return alert('Server Name is required.');
      if (!command && !url) return alert('Either Command (stdio) or URL (sse) must be specified.');

      let args = [];
      if (argsRaw) {
        args = argsRaw.split(',').map(s => s.trim()).filter(Boolean);
      }

      let env = {};
      if (envRaw) {
        try {
          env = JSON.parse(envRaw);
        } catch (e) {
          return alert('Environment Variables must be a valid JSON object: ' + e);
        }
      }

      try {
        const res = await fetch('/api/mcp/server', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: name,
            command: command || null,
            url: url || null,
            args: args,
            env: env
          })
        });

        if (res.ok) {
          alert(`MCP server '${name}' saved to config.yaml!`);
          closeMcpConfigModal();
          await loadToolsAndMcpHub();
        } else {
          const err = await res.json();
          alert(`Failed to save MCP server: ${err.detail || 'Unknown error'}`);
        }
      } catch (e) {
        alert('Error: ' + e);
      }
    }

    async function deleteMcpServer(name) {
      if (!confirm(`Are you sure you want to remove MCP server '${name}' from config.yaml?`)) return;

      try {
        const res = await fetch(`/api/mcp/server/${name}`, { method: 'DELETE' });
        if (res.ok) {
          alert(`MCP server '${name}' removed from config.yaml!`);
          await loadToolsAndMcpHub();
        } else {
          const err = await res.json();
          alert(`Failed to delete MCP server: ${err.detail || 'Unknown error'}`);
        }
      } catch (e) {
        alert('Error: ' + e);
      }
    }

