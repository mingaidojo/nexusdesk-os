/**
 * @module guide.js
 * @description 100% English Customer-Journey Feature Guide & Quick Help for NexusDesk OS.
 * Aligned with Oceanic Dark theme, exact on-screen labels, visual workflow infographics,
 * and Previous/Next customer journey navigation.
 */

const GUIDE_STAGE_META = {
  all: { label: 'All Steps' },
  connect: { label: '1 · Connect & Secure', badge: 'STEP 1 · CONNECT & SECURE', tone: 'text-[#58a6ff] bg-[#58a6ff]/10 border-[#58a6ff]/30' },
  setup: { label: '2 · Knowledge & Roles', badge: 'STEP 2 · KNOWLEDGE & ROLES', tone: 'text-[#bc8cff] bg-[#bc8cff]/10 border-[#bc8cff]/30' },
  daily: { label: '3 · Daily Chat & Voice', badge: 'STEP 3 · DAILY CHAT & VOICE', tone: 'text-[#3fb950] bg-[#3fb950]/10 border-[#3fb950]/30' },
  automate: { label: '4 · Schedules & Follow-Ups', badge: 'STEP 4 · SCHEDULES & FOLLOW-UPS', tone: 'text-[#d29922] bg-[#d29922]/10 border-[#d29922]/30' },
  scale: { label: '5 · AI Team & System', badge: 'STEP 5 · AI TEAM & SYSTEM', tone: 'text-[#79c0ff] bg-[#79c0ff]/10 border-[#79c0ff]/30' }
};

const NEXUSDESK_GUIDE_ITEMS = [
  {
    id: 'step-connect-channels',
    stepNum: '01',
    stage: 'connect',
    title: 'Connect Messaging Channels & Set Your Owner Profile',
    whereToClick: 'Sidebar -> AUTOMATION -> Chat Agents  |  Sidebar -> SYSTEM -> Omnichannel & Gateways',
    summary: 'Link WhatsApp or Telegram numbers and tell NexusDesk who the Owner is before letting agents reply to customers.',
    keywords: 'connect pair whatsapp telegram sim qr user profile owner gateway setup start',
    targetTab: 'chat-agents',
    targetLabel: 'Open Chat Agents',
    visual: {
      caption: 'Onboarding Flow',
      type: 'flow',
      nodes: [
        { label: 'Owner Profile', sub: 'Set name & phone', tone: 'blue' },
        { label: 'Pair SIM / Bot', sub: 'Chat Agents / Gateways', tone: 'purple' },
        { label: 'Agent Online', sub: 'Ready for WA & TG', tone: 'green' }
      ]
    },
    rules: [
      {
        label: 'Your Profile (User Profile)',
        detail: 'Set how agents should address you and save your primary contact details once so every specialist knows the real Owner.'
      },
      {
        label: 'Dedicated SIMs vs. Global Gateways',
        detail: 'Dedicated Chat Agent phones connect directly inside Chat Agents. Shared Telegram, email, webhook, or Google Drive links live in Omnichannel & Gateways.'
      },
      {
        label: 'Quick Live Status Check',
        detail: 'Look at the top header bar: a green server status indicator confirms NexusDesk OS is actively listening for incoming messages.'
      }
    ],
    commands: [
      'Sidebar -> SYSTEM -> User Profile (confirm your Owner name)',
      'Sidebar -> SYSTEM -> Omnichannel & Gateways (verify channel status)'
    ]
  },
  {
    id: 'step-security-guardrails',
    stepNum: '02',
    stage: 'connect',
    title: 'Control Who Can Boss Your Agent Around (5D Guardrails & Security)',
    whereToClick: 'Sidebar -> Chat Agents -> Workspace Studio -> 5D Guardrails & Security',
    summary: 'Separate Owner privileges from Group Moderators and everyday customers so nobody hijacks your agent or reads private chats.',
    keywords: 'rbac permission superadmin group admin moderator security authority who controls',
    targetTab: 'chat-agents',
    targetLabel: 'Open Chat Agents',
    visual: {
      caption: '3-Tier Authority Scope',
      type: 'flow',
      nodes: [
        { label: 'Owner (Everywhere)', sub: '1-on-1 DMs + All Groups', tone: 'green' },
        { label: 'Group Moderator', sub: 'Locked inside 1 group only', tone: 'amber' },
        { label: 'Customers & Members', sub: 'Ask, order & relay safely', tone: 'blue' }
      ]
    },
    rules: [
      {
        label: 'Owner (Admin / Owner WhatsApp)',
        detail: 'Full authority everywhere (labeled SUPERADMIN internally): update pricing, manage reminders, inspect files, send broadcasts, or remove an agent from any group.'
      },
      {
        label: 'Group Moderators (Group Moderator Numbers)',
        detail: 'Works strictly inside that single group to launch polls, send group voice announcements, set group reminders, or request recaps. Regular WA/TG admins stay blocked unless you enable Allow WA/TG Group Admins as Scoped Moderators.'
      },
      {
        label: 'Private 1-on-1 DM Safety Boundary',
        detail: 'If a Group Moderator messages your agent in a private 1-on-1 DM, they lose moderator powers and are treated just like a normal customer.'
      },
      {
        label: 'Customers (1-on-1 Guardrail Policy)',
        detail: 'Can ask product questions, submit orders, set reminders for themselves, or leave a note for you—without ever seeing your private phone number or other groups.'
      }
    ],
    commands: [
      '@Clarissa create a poll for next week team standup times',
      'Please pass a message to the owner: I will send the deposit tomorrow at 2 PM.'
    ]
  },
  {
    id: 'step-workspace-roles',
    stepNum: '03',
    stage: 'setup',
    title: 'Customize Per-Group Jobs, Escalations & Natural Closing',
    whereToClick: 'Sidebar -> Chat Agents -> Workspace Studio -> Workspace & Channels  (and Edit Chat Agent)',
    summary: 'Give the same agent a specialized job in each room—silent group monitor in one, sales order taker in another, or 1-on-1 follow-up assistant.',
    keywords: 'workspace studio channels directive business type monitor recap order escalation closing',
    targetTab: 'chat-agents',
    targetLabel: 'Open Chat Agents',
    visual: {
      caption: 'One Agent, Specialized Hats Per Room',
      type: 'flow',
      nodes: [
        { label: 'Storefront DM', sub: 'Catalog answers + Orders.xlsx', tone: 'green' },
        { label: 'Team Group', sub: 'Silent Monitor + Weekly Recap', tone: 'purple' },
        { label: 'VIP Escalation', sub: 'Instant alert to Owner WA', tone: 'amber' }
      ]
    },
    rules: [
      {
        label: 'Business Type / Category & Custom Workspace Directive',
        detail: 'Choose a preset (Commerce & Customer Service, Group Monitoring & Recap, Sales & 1-on-1 Follow-Up, Operations & Team Coordination, or General / Custom Workspace) and add plain instructions for that room.'
      },
      {
        label: 'Adaptive Capabilities Checkboxes',
        detail: 'Enable Monitor & Recap All Group Posts to silently log group activity for summaries; CS Order Capture to quote catalog files and record sales in Orders.xlsx; or 1-on-1 Sales Follow-Up to chase warm leads.'
      },
      {
        label: 'Owner Escalation Triggers',
        detail: 'Enter alert keywords or thresholds such as complaint, refund, >= 500, receipt so the agent pings your WhatsApp immediately whenever high-priority issues appear.'
      },
      {
        label: 'Natural Human Closing Style',
        detail: 'Enabled by default inside Edit Chat Agent so replies finish concisely ("Got it, noted.") instead of repeating robotic closing lines on every single message.'
      }
    ],
    commands: [
      'Summarize every message posted in the Sales Team group this week',
      'Follow up with +15550192834 tomorrow at 10 AM regarding yesterday catalog quote'
    ]
  },
  {
    id: 'step-contacts-explorer',
    stepNum: '04',
    stage: 'setup',
    title: 'Organize Contact Books & Share Files Cleanly (Data Explorer)',
    whereToClick: 'Sidebar -> Chat Agents -> Data Explorer  (or inside Workspace Studio)',
    summary: 'Upload brochures, view or download workspace files, keep private vs. shared contacts tidy, and hand off files straight to your AI team.',
    keywords: 'data explorer contacts local global copy path war room phone format pdf excel',
    targetTab: 'chat-agents',
    targetLabel: 'Open Chat Agents',
    visual: {
      caption: 'Knowledge & Contact Routing',
      type: 'flow',
      nodes: [
        { label: 'Upload & Edit Files', sub: 'Data Explorer & Orders.xlsx', tone: 'blue' },
        { label: 'Contacts (contacts.json)', sub: 'Local Room vs. Global VIPs', tone: 'purple' },
        { label: '🚀 War Room / Copy Path', sub: '1-click handoff to AI Team', tone: 'green' }
      ]
    },
    rules: [
      {
        label: '📋 Copy Path & 🚀 War Room Buttons',
        detail: 'Select any file inside Data Explorer to copy its server path (📋 Copy Path) or share a working copy directly into a Mission Console War Room (🚀 War Room) with a short note.'
      },
      {
        label: 'Private Local vs. Global Shared Contacts',
        detail: 'Contacts marked local stay isolated inside one workspace/group (stored in contacts.json). Global contacts—such as key suppliers or VIP clients—are available across every room.'
      },
      {
        label: 'Automatic Phone Number Normalization',
        detail: 'Ask by contact name ("Send to Alice") or type a standard local or international phone number—NexusDesk normalizes leading zeros or + prefixes automatically before sending.'
      }
    ],
    commands: [
      'Save Alice +15550123456 as Warehouse Lead in local contacts',
      'Send the Q4 product catalog PDF to +15550198765'
    ]
  },
  {
    id: 'step-voice-polls',
    stepNum: '05',
    stage: 'daily',
    title: 'Run Daily Voice Notes, Live Polls & Silent Group Recaps',
    whereToClick: 'Any connected WhatsApp or Telegram Group or 1-on-1 DM',
    summary: 'Communicate naturally via spoken voice notes in multiple languages, launch real native polls, and catch up on busy groups in seconds.',
    keywords: 'voice note audio stt tts english chinese indonesian poll voting recap summary',
    targetTab: 'chat-agents',
    targetLabel: 'Open Chat Agents',
    visual: {
      caption: 'Voice & Group Interaction Loop',
      type: 'flow',
      nodes: [
        { label: 'Voice Note In', sub: 'EN / ID / ZH auto-detected', tone: 'blue' },
        { label: 'Clean Audio Text', sub: 'Zero emojis for crisp TTS', tone: 'purple' },
        { label: 'Voice Reply / Live Poll', sub: 'Delivered straight in chat', tone: 'green' }
      ]
    },
    rules: [
      {
        label: 'Language-Matched Spoken Voice Replies',
        detail: 'When a user sends a voice note in English, Indonesian, or Chinese, the agent listens, avoids emojis so text-to-speech sounds smooth, and responds in the exact same spoken language.'
      },
      {
        label: 'Remote Group Voice Announcements from Your DM',
        detail: 'As Owner, tell your agent privately in 1-on-1 DM to deliver a spoken voice note into any named group—kept completely neutral unless you ask to be credited.'
      },
      {
        label: 'Native Clickable WhatsApp Polls',
        detail: 'Launch real interactive polls inside a group—or trigger them remotely from your DM—to collect votes on schedules, budgets, or lunch spots.'
      }
    ],
    commands: [
      'Send a voice note to the Sales Team group saying tomorrow standup starts at 9 AM',
      'Create a poll in Marketing Team asking whether everyone prefers Tuesday or Thursday at 3 PM'
    ]
  },
  {
    id: 'step-schedules-reminders',
    stepNum: '06',
    stage: 'automate',
    title: 'Manage Reminders, Daily Tasks & Smart Auto Follow-Ups',
    whereToClick: 'Sidebar -> Chat Agents -> Schedules / Crons button on any agent card',
    summary: 'Create, pause, edit, test, or delete one-off reminders and daily recurring tasks from either the dashboard modal or plain WhatsApp chat.',
    keywords: 'agent schedules reminders crud daily once direct message task follow up +30m',
    targetTab: 'chat-agents',
    targetLabel: 'Open Chat Agents',
    visual: {
      caption: 'Unified Reminder & Scheduled Task Engine',
      type: 'flow',
      nodes: [
        { label: 'Trigger (Once or Daily)', sub: '08:30, +30m, or promise', tone: 'amber' },
        { label: 'Direct Message ($0 AI)', sub: 'Sends exact alert text', tone: 'blue' },
        { label: 'Agent Task (AI Active)', sub: 'Researches & reports back', tone: 'green' }
      ]
    },
    rules: [
      {
        label: 'Two Simple Choices (Recurrence & Execution Mode)',
        detail: 'Choose Once (One-Off Reminder) or Daily (Recurring). Then pick Direct Message (zero AI cost for plain reminder texts) or Agent Task (wakes the AI at that time to research, check prices, or summarize a group).'
      },
      {
        label: 'Flexible Time Formats (Time / Offset)',
        detail: 'Enter a daily time such as 08:30, a full timestamp such as 2026-11-18 09:00, or a fast relative countdown such as +30m or +2h.'
      },
      {
        label: 'Full Control via WhatsApp Chat',
        detail: 'As the Owner, simply ask what schedules are active, reschedule any item, pause it, or cancel it right inside WhatsApp—no dashboard visit needed.'
      },
      {
        label: 'Smart Promise Self-Reminders',
        detail: 'When a customer says "I will send payment at 4 PM", the agent can automatically queue a polite follow-up reminder so leads never slip through.'
      }
    ],
    commands: [
      'Every day at 08:30 check gold prices and AAPL stock, then WhatsApp me a summary',
      'Remind me in +30m to follow up with Alex about the HTML catalog',
      'What reminders and scheduled tasks do you have active right now?'
    ]
  },
  {
    id: 'step-relays-workflows',
    stepNum: '07',
    stage: 'automate',
    title: 'Pass Messages to Owner & Chain Multi-Agent Workflows',
    whereToClick: 'Sidebar -> AUTOMATION -> Crons & Workflows  |  Workspace Studio -> Owner Escalation Triggers',
    summary: 'Ensure customers can always escalate urgent requests safely to the Owner, and wire automated system-wide Crons and agent-to-agent pipelines.',
    keywords: 'relay pass message owner escalation workflows crons pipeline automation',
    targetTab: 'workflows',
    targetLabel: 'Open Workflows',
    visual: {
      caption: 'Escalation & Multi-Step Automation',
      type: 'flow',
      nodes: [
        { label: 'Customer Request / Trigger', sub: 'Refund, VIP order, or Cron', tone: 'amber' },
        { label: 'Agent Relay / Pipeline', sub: 'Summarized without leaks', tone: 'purple' },
        { label: 'Owner Alert / Final Output', sub: 'Delivered cleanly on time', tone: 'green' }
      ]
    },
    rules: [
      {
        label: 'Safe Customer-to-Owner Relays',
        detail: 'Any customer or group member can ask the agent to forward a note or payment update to you; the agent passes your alert privately without exposing your phone number.'
      },
      {
        label: 'System-Wide Crons',
        detail: 'Use Sidebar -> AUTOMATION -> Crons for recurring background maintenance, report generation, or multi-workspace scheduled runs.'
      },
      {
        label: 'Multi-Agent Workflows',
        detail: 'Connect multiple specialized AI agents in sequence inside Workflows so research, drafting, and final delivery run step-by-step automatically.'
      }
    ],
    commands: [
      'Please tell the owner I need an urgent callback regarding Order #402',
      'Sidebar -> AUTOMATION -> Workflows (link multiple agents into a pipeline)'
    ]
  },
  {
    id: 'step-warroom-floor',
    stepNum: '08',
    stage: 'scale',
    title: 'Collaborate in Mission Console & Virtual Office (AgentFloor)',
    whereToClick: 'Sidebar -> OPERATIONS -> Mission Console, AgentFloor, Fleet Roster & Memory Vault',
    summary: 'Escalate complex analysis, coding, or planning to a room full of AI specialists, hold structured Roundtable debates, and inspect desk workspaces.',
    keywords: 'mission console war room agentfloor roundtable sandbox memory vault voice desk @everyone',
    targetTab: 'console',
    targetLabel: 'Open Mission Console',
    visual: {
      caption: 'Specialist Collaboration Workspace',
      type: 'flow',
      nodes: [
        { label: 'Mission Console', sub: '@mention or Roundtable', tone: 'blue' },
        { label: 'Room Sandbox Folder', sub: 'Shared briefs & outputs', tone: 'purple' },
        { label: 'AgentFloor & Vault', sub: '1-on-1 desk & memory files', tone: 'green' }
      ]
    },
    rules: [
      {
        label: 'Target One Specialist or the Whole Room',
        detail: 'Mention @claude, @agy, @codex, or @everyone inside Mission Console. Follow-up messages queue safely if a specialist is still typing.'
      },
      {
        label: 'Roundtable Debates & Isolated Sandboxes',
        detail: 'Enable Roundtable for multi-round review between agents. Each room gets its own Sandbox directory so deliverables never get mixed up.'
      },
      {
        label: 'AgentFloor, Spoken Audio & Memory Vault',
        detail: 'Click any desk on AgentFloor (or Fleet Roster) for 1-on-1 chat, toggle spoken voice audio from the top-right speaker icon, and refine agent skills inside Memory Vault.'
      }
    ],
    commands: [
      '@solaris @claude review this launch plan and list the top 3 risks',
      '@everyone run a 2-round roundtable on Q4 pricing tiers',
      '/newroom launch-v2'
    ]
  },
  {
    id: 'step-models-system',
    stepNum: '09',
    stage: 'scale',
    title: 'Configure AI Failover, Plugins (MCP) & System Health',
    whereToClick: 'Sidebar -> INTELLIGENCE & MODELS  |  TOOLS & MCP  |  SYSTEM',
    summary: 'Keep agents resilient with automatic backup models, govern which tools each agent can touch, clean disk storage, and inspect live server logs.',
    keywords: 'models global failover reasoning budgets context meters mcp tools storage logs daemon self evolving',
    targetTab: 'models-failover',
    targetLabel: 'Open Global Failover',
    visual: {
      caption: 'Resilience & System Control Layer',
      type: 'flow',
      nodes: [
        { label: 'Primary AI Model', sub: 'Agent Roles & Budgets', tone: 'blue' },
        { label: 'Auto Failover + MCP', sub: 'Backup chain & tool rules', tone: 'amber' },
        { label: 'Storage & Live Logs', sub: 'Cleanup & Systemd Logs', tone: 'green' }
      ]
    },
    rules: [
      {
        label: 'Global Failover & Agent Roles',
        detail: 'Assign models and Reasoning Budgets per engine (Hermes, Claude, Codex, OpenCode, Agy) and configure Global Failover so chats switch seamlessly if a provider hits a quota limit.'
      },
      {
        label: 'Tools & MCP Access Control',
        detail: 'Inspect Verified Catalog (18), manage Configured Daemons, and decide in Privilege Matrix which specialists are allowed to run each plugin.'
      },
      {
        label: 'Storage, Logs, Dispatcher & Self-Evolving Hub',
        detail: 'Archive old files in Storage & Archival, verify health in Systemd Logs or Restart Daemon, tune War Room routing in Dispatcher Rules, and track upgrades in Self-Evolving Hub.'
      }
    ],
    commands: [
      'Sidebar -> INTELLIGENCE & MODELS -> Global Failover',
      'Sidebar -> TOOLS & MCP -> Privilege Matrix',
      'Sidebar -> SYSTEM -> Systemd Logs'
    ]
  }
];

let guideActiveStage = 'all';
let guideSearchQuery = '';
let guideSelectedId = NEXUSDESK_GUIDE_ITEMS[0].id;

function escapeGuideHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function getFilteredGuideItems() {
  const q = (guideSearchQuery || '').trim().toLowerCase();
  return NEXUSDESK_GUIDE_ITEMS.filter(item => {
    if (guideActiveStage !== 'all' && item.stage !== guideActiveStage) return false;
    if (!q) return true;
    const stageInfo = GUIDE_STAGE_META[item.stage] || {};
    const haystack = [
      item.stepNum,
      item.title,
      item.whereToClick || '',
      item.summary,
      item.keywords || '',
      stageInfo.label || '',
      ...(item.rules || []).map(r => `${r.label} ${r.detail}`),
      ...(item.commands || [])
    ].join(' ').toLowerCase();
    return q.split(/\s+/).every(tok => haystack.includes(tok));
  });
}

function setGuideStage(stage) {
  guideActiveStage = GUIDE_STAGE_META[stage] ? stage : 'all';
  ['all', 'connect', 'setup', 'daily', 'automate', 'scale'].forEach(s => {
    const btn = document.getElementById(`guide-stage-${s}`);
    if (!btn) return;
    const isActive = s === guideActiveStage;
    btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    btn.className = isActive
      ? 'px-3 py-1.5 rounded-lg bg-[#58a6ff]/15 text-[#58a6ff] border border-[#58a6ff]/50 font-semibold transition'
      : 'px-3 py-1.5 rounded-lg bg-[#0d1117] text-[#8b949e] border border-[#30363d] hover:text-[#f0f6fc] hover:border-[#484f58] font-medium transition';
  });
  renderGuideTab();
}

// Backward-compatible alias if any caller still references setGuideCategory
function setGuideCategory(cat) {
  const map = { 'chat-agents': 'connect', warroom: 'scale', 'models-tools': 'scale', system: 'automate' };
  setGuideStage(map[cat] || 'all');
}

function onGuideSearchInput(val) {
  guideSearchQuery = val || '';
  const clearBtn = document.getElementById('guide-search-clear-btn');
  if (clearBtn) clearBtn.classList.toggle('hidden', !guideSearchQuery.trim());
  renderGuideTab();
}

function clearGuideSearch() {
  const inp = document.getElementById('guide-search-input');
  if (inp) inp.value = '';
  onGuideSearchInput('');
}

function selectGuideItem(itemId) {
  guideSelectedId = itemId;
  renderGuideTab();
}

function goToAdjacentGuide(delta) {
  const currentIdx = NEXUSDESK_GUIDE_ITEMS.findIndex(i => i.id === guideSelectedId);
  const nextIdx = (currentIdx === -1 ? 0 : currentIdx) + delta;
  if (nextIdx < 0 || nextIdx >= NEXUSDESK_GUIDE_ITEMS.length) return;
  const target = NEXUSDESK_GUIDE_ITEMS[nextIdx];
  guideSelectedId = target.id;
  if (guideActiveStage !== 'all' && target.stage !== guideActiveStage) {
    setGuideStage('all');
  } else {
    renderGuideTab();
  }
}

function copyGuideSnippet(btnEl, encodedText) {
  const txt = decodeURIComponent(encodedText);
  const flash = () => {
    if (!btnEl) return;
    const orig = btnEl.innerHTML;
    btnEl.innerText = 'Copied';
    btnEl.classList.add('text-[#3fb950]', 'border-[#3fb950]/60');
    setTimeout(() => {
      btnEl.innerHTML = orig;
      btnEl.classList.remove('text-[#3fb950]', 'border-[#3fb950]/60');
    }, 1500);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(txt).then(flash).catch(() => prompt('Copy example:', txt));
  } else {
    prompt('Copy example:', txt);
  }
}

function openFeatureGuide(initialQuery = '') {
  if (typeof toggleMobileSidebar === 'function') toggleMobileSidebar(false);
  switchMainTab('guide');
  if (initialQuery) {
    const inp = document.getElementById('guide-search-input');
    if (inp) inp.value = initialQuery;
    onGuideSearchInput(initialQuery);
  } else {
    renderGuideTab();
  }
  setTimeout(() => {
    const inp = document.getElementById('guide-search-input');
    if (inp) inp.focus();
  }, 60);
}

function renderGuideInfographic(visual) {
  if (!visual || !Array.isArray(visual.nodes) || !visual.nodes.length) return '';
  const toneClasses = {
    blue: 'bg-[#58a6ff]/10 border-[#58a6ff]/40 text-[#79c0ff]',
    green: 'bg-[#3fb950]/10 border-[#3fb950]/40 text-[#56d364]',
    amber: 'bg-[#d29922]/10 border-[#d29922]/40 text-[#e3b341]',
    purple: 'bg-[#bc8cff]/10 border-[#bc8cff]/40 text-[#d2a8ff]'
  };
  const arrowSvg = `<div class="hidden sm:flex items-center justify-center text-[#484f58] shrink-0" aria-hidden="true"><svg class="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8h10M9 4l4 4-4 4"/></svg></div>`;
  const cardsHtml = visual.nodes.map((n, idx) => {
    const cls = toneClasses[n.tone] || toneClasses.blue;
    return `
      ${idx > 0 ? arrowSvg : ''}
      <div class="flex-1 min-w-0 rounded-xl border px-3 py-2.5 ${cls}">
        <div class="text-[11px] font-semibold leading-tight truncate">${escapeGuideHtml(n.label)}</div>
        <div class="text-[10.5px] text-[#c9d1d9]/85 mt-0.5 leading-snug">${escapeGuideHtml(n.sub)}</div>
      </div>
    `;
  }).join('');

  return `
    <div class="rounded-xl border border-[#30363d] bg-[#0d1117]/90 p-3 space-y-2">
      <div class="flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-[#8b949e]">
        <span>Visual Overview</span>
        <span class="text-[#58a6ff]">${escapeGuideHtml(visual.caption || '')}</span>
      </div>
      <div class="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
        ${cardsHtml}
      </div>
    </div>
  `;
}

function renderGuideTab() {
  const listEl = document.getElementById('guide-feature-list');
  const detailEl = document.getElementById('guide-detail-panel');
  const countBadge = document.getElementById('guide-count-badge');
  if (!listEl || !detailEl) return;

  const items = getFilteredGuideItems();
  if (countBadge) {
    countBadge.innerText = `${items.length} of ${NEXUSDESK_GUIDE_ITEMS.length} steps`;
  }

  if (items.length === 0) {
    listEl.innerHTML = `<div class="p-6 bg-[#161b22] border border-[#30363d] rounded-xl text-center text-[#8b949e] text-xs space-y-2"><div>No steps matched "<span class="text-[#f0f6fc] font-medium">${escapeGuideHtml(guideSearchQuery)}</span>".</div><button type="button" onclick="clearGuideSearch(); setGuideStage('all');" class="px-3 py-1 rounded-lg bg-[#21262d] hover:bg-[#30363d] text-[#f0f6fc] border border-[#30363d] text-[11px] font-medium transition">Reset Filters</button></div>`;
    detailEl.innerHTML = `<div class="p-8 text-center text-[#8b949e] text-xs">Choose a step on the left to view its workflow diagram, exact menu path, rules, and English examples.</div>`;
    return;
  }

  if (!items.some(i => i.id === guideSelectedId)) {
    guideSelectedId = items[0].id;
  }
  const active = items.find(i => i.id === guideSelectedId) || items[0];
  const activeStageMeta = GUIDE_STAGE_META[active.stage] || GUIDE_STAGE_META.connect;

  listEl.innerHTML = items.map(item => {
    const selected = item.id === active.id;
    const stageMeta = GUIDE_STAGE_META[item.stage] || GUIDE_STAGE_META.connect;
    return `
      <button type="button" onclick="selectGuideItem('${item.id}')" class="w-full text-left p-3.5 rounded-xl border transition space-y-1.5 ${selected ? 'bg-[#1c2128] border-[#58a6ff] shadow-[0_0_0_1px_rgba(88,166,255,0.25)]' : 'bg-[#161b22] border-[#30363d] hover:border-[#484f58] hover:bg-[#1c2128]/70'}">
        <div class="flex items-center justify-between gap-2">
          <div class="flex items-center gap-2 min-w-0">
            <span class="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#0d1117] border border-[#30363d] ${selected ? 'text-[#58a6ff] border-[#58a6ff]/40' : 'text-[#8b949e]'}">${escapeGuideHtml(item.stepNum)}</span>
            <span class="text-[9.5px] px-2 py-0.5 rounded border font-semibold uppercase tracking-wide truncate ${stageMeta.tone}">${escapeGuideHtml(stageMeta.badge)}</span>
          </div>
          ${selected ? '<span class="text-[10px] text-[#58a6ff] font-semibold shrink-0">Active</span>' : ''}
        </div>
        <div class="text-xs font-semibold text-[#f0f6fc] leading-snug">${escapeGuideHtml(item.title)}</div>
        <div class="text-[11px] text-[#8b949e] leading-relaxed line-clamp-2">${escapeGuideHtml(item.summary)}</div>
      </button>
    `;
  }).join('');

  const fullIndex = NEXUSDESK_GUIDE_ITEMS.findIndex(i => i.id === active.id);
  const prevItem = fullIndex > 0 ? NEXUSDESK_GUIDE_ITEMS[fullIndex - 1] : null;
  const nextItem = fullIndex >= 0 && fullIndex < NEXUSDESK_GUIDE_ITEMS.length - 1 ? NEXUSDESK_GUIDE_ITEMS[fullIndex + 1] : null;

  detailEl.innerHTML = `
    <div class="flex items-start justify-between gap-3 pb-4 border-b border-[#30363d] flex-wrap">
      <div class="space-y-2 min-w-0 flex-1">
        <div class="flex items-center gap-2 flex-wrap">
          <span class="font-mono text-[10px] font-bold px-2 py-0.5 rounded bg-[#0d1117] border border-[#30363d] text-[#58a6ff]">STEP ${escapeGuideHtml(active.stepNum)}</span>
          <span class="inline-block text-[9.5px] px-2 py-0.5 rounded border font-semibold uppercase tracking-wide ${activeStageMeta.tone}">${escapeGuideHtml(activeStageMeta.badge)}</span>
        </div>
        <h3 class="text-sm sm:text-base font-bold text-[#f0f6fc] tracking-tight">${escapeGuideHtml(active.title)}</h3>
        <p class="text-xs text-[#c9d1d9] leading-relaxed">${escapeGuideHtml(active.summary)}</p>
        ${active.whereToClick ? `
          <div class="inline-flex items-center gap-1.5 text-[11px] text-[#79c0ff] bg-[#58a6ff]/10 border border-[#58a6ff]/30 rounded-lg px-2.5 py-1.5">
            <svg class="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
            <span><strong class="font-semibold text-[#f0f6fc]">Where to find it:</strong> <span class="font-mono text-[10.5px]">${escapeGuideHtml(active.whereToClick)}</span></span>
          </div>
        ` : ''}
      </div>
      <button type="button" onclick="switchMainTab('${active.targetTab}')" class="px-3.5 py-2 rounded-lg bg-[#238636] hover:bg-[#2ea043] text-white font-semibold text-xs transition shrink-0 shadow-sm border border-[#3fb950]/40">
        ${escapeGuideHtml(active.targetLabel)} &rarr;
      </button>
    </div>

    ${renderGuideInfographic(active.visual)}

    <div class="space-y-2">
      <div class="text-[11px] uppercase font-semibold text-[#58a6ff] tracking-wider">How It Works &amp; Key Rules</div>
      <div class="divide-y divide-[#30363d] rounded-xl border border-[#30363d] bg-[#0d1117]/80 overflow-hidden">
        ${(active.rules || []).map(r => `
          <div class="p-3.5 grid grid-cols-1 sm:grid-cols-12 gap-1.5 sm:gap-3 items-start">
            <div class="sm:col-span-4 text-[11.5px] font-semibold text-[#e3b341] leading-snug">${escapeGuideHtml(r.label)}</div>
            <div class="sm:col-span-8 text-xs text-[#c9d1d9] leading-relaxed">${escapeGuideHtml(r.detail)}</div>
          </div>
        `).join('')}
      </div>
    </div>

    <div class="space-y-2">
      <div class="text-[11px] uppercase font-semibold text-[#3fb950] tracking-wider">English Examples (Click Copy)</div>
      <div class="space-y-2">
        ${(active.commands || []).map(cmd => `
          <div class="flex items-center justify-between gap-2 bg-[#0d1117] border border-[#30363d] rounded-xl px-3 py-2.5">
            <code class="font-mono text-[11px] text-[#f0f6fc] select-all break-words leading-relaxed">${escapeGuideHtml(cmd)}</code>
            <button type="button" onclick="copyGuideSnippet(this, '${encodeURIComponent(cmd)}')" class="px-2.5 py-1 rounded-lg bg-[#21262d] hover:bg-[#30363d] text-[#c9d1d9] hover:text-white border border-[#30363d] text-[10.5px] font-medium shrink-0 transition">
              Copy
            </button>
          </div>
        `).join('')}
      </div>
    </div>

    <div class="pt-3 border-t border-[#30363d] flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5">
      ${prevItem ? `
        <button type="button" onclick="goToAdjacentGuide(-1)" class="text-left px-3 py-2 rounded-xl bg-[#0d1117] hover:bg-[#21262d] border border-[#30363d] text-[11px] text-[#8b949e] hover:text-[#f0f6fc] transition">
          <div class="text-[9.5px] uppercase tracking-wider text-[#6e7681]">Previous Step</div>
          <div class="font-semibold text-[#c9d1d9] truncate">&larr; ${escapeGuideHtml(prevItem.stepNum)} &middot; ${escapeGuideHtml(prevItem.title)}</div>
        </button>
      ` : '<div></div>'}
      ${nextItem ? `
        <button type="button" onclick="goToAdjacentGuide(1)" class="text-left sm:text-right px-3.5 py-2 rounded-xl bg-[#58a6ff]/10 hover:bg-[#58a6ff]/20 border border-[#58a6ff]/30 text-[11px] transition">
          <div class="text-[9.5px] uppercase tracking-wider text-[#58a6ff] font-semibold">Follow-Up Next Step</div>
          <div class="font-semibold text-[#f0f6fc] truncate">${escapeGuideHtml(nextItem.stepNum)} &middot; ${escapeGuideHtml(nextItem.title)} &rarr;</div>
        </button>
      ` : `
        <button type="button" onclick="selectGuideItem('${NEXUSDESK_GUIDE_ITEMS[0].id}'); setGuideStage('all');" class="text-left sm:text-right px-3.5 py-2 rounded-xl bg-[#3fb950]/10 hover:bg-[#3fb950]/20 border border-[#3fb950]/30 text-[11px] transition">
          <div class="text-[9.5px] uppercase tracking-wider text-[#3fb950] font-semibold">Journey Complete</div>
          <div class="font-semibold text-[#f0f6fc]">Back to Step 01 &rarr;</div>
        </button>
      `}
    </div>
  `;
}

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === '/') {
    e.preventDefault();
    openFeatureGuide();
  }
});
