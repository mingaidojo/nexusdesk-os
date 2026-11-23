/**
 * @module chat/voice_tts_engine.js
 * @description Unified Neural/Local TTS & Web Speech Bi-Directional Voice Engine.
 * Handles Edge-TTS, Piper-TTS, and browser Web Speech API synthesis/recognition,
 * waveform rendering, dictation toggles, and hands-free voice loop.
 *
 * Part of the Console & War Room chat subsystem (concatenated globally by frontend/build.py).
 */

// --- Unified Neural & Local TTS Engine (Edge-TTS, Piper-TTS, Web Speech API) ---
let currentTtsEngine = localStorage.getItem('nexusdesk_tts_engine') || 'edge';
let currentTtsScope = localStorage.getItem('nexusdesk_tts_scope') || 'first_sentence'; // 'first_sentence' or 'full'
let availableEdgeVoices = [];
let availablePiperVoices = [];
let availableRolePersonas = {};
let activeTtsAudio = null;
let ttsAudioContext = null;
let activeTtsSource = null;
let sharedTtsAudioElement = null;
let currentTtsPlaybackId = 0;
let lastTtsPlaybackEndTime = 0;
let lastSpokenTtsCleanText = '';

function isAnyTtsActive() {
  if (activeTtsSource !== null) return true;
  if (activeTtsAudio !== null) return true;
  if ('speechSynthesis' in window && window.speechSynthesis.speaking) return true;
  return false;
}

function getTtsAudioContext() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    if (!ttsAudioContext) {
      ttsAudioContext = new AudioCtx();
    }
    if (ttsAudioContext.state === 'suspended') {
      ttsAudioContext.resume().catch(() => {});
    }
    return ttsAudioContext;
  } catch (_) {
    return null;
  }
}

function unlockAudio() {
  try {
    const ctx = getTtsAudioContext();
    if (ctx && ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    if (!sharedTtsAudioElement && typeof document !== 'undefined') {
      sharedTtsAudioElement = new Audio();
      sharedTtsAudioElement.id = 'nexusdesk-tts-audio';
      sharedTtsAudioElement.style.display = 'none';
      document.body.appendChild(sharedTtsAudioElement);
    }
  } catch (_) {}
}

// Auto-unlock audio playback on first user gesture across the document
if (typeof document !== 'undefined') {
  document.addEventListener('click', unlockAudio, { once: false, passive: true });
  document.addEventListener('keydown', unlockAudio, { once: false, passive: true });
}

let ttsPlaybackQueue = [];
let ttsQueueBusy = false;

function stopActiveTtsPlayback(clearQueue = true) {
  if (clearQueue) {
    ttsPlaybackQueue.length = 0;
    ttsQueueBusy = false;
  }
  if (activeTtsSource) {
    try {
      activeTtsSource.stop();
      activeTtsSource.disconnect();
    } catch (_) {}
    activeTtsSource = null;
  }
  if (activeTtsAudio) {
    try {
      activeTtsAudio.pause();
      activeTtsAudio.src = '';
    } catch (_) {}
    activeTtsAudio = null;
  }
  if ('speechSynthesis' in window && window.speechSynthesis.speaking) {
    try {
      window.speechSynthesis.cancel();
    } catch (_) {}
  }
  animateWaveform(false);
}

async function loadTtsVoices() {
  try {
    const res = await fetch('/api/tts/voices');
    if (res.ok) {
      const data = await res.json();
      availableEdgeVoices = data.edge_voices || [];
      availablePiperVoices = data.piper_voices || [];
      availableRolePersonas = data.role_personas || {};
      if (data.active_engine && !localStorage.getItem('nexusdesk_tts_engine')) {
        currentTtsEngine = data.active_engine;
      }
      if (data.speech_scope && !localStorage.getItem('nexusdesk_tts_scope')) {
        currentTtsScope = data.speech_scope;
      }
      refreshVoiceDropdown();
      refreshScopeUI();
    }
  } catch (e) {
    console.warn('Could not fetch backend TTS voices:', e);
  }
}

function refreshScopeUI() {
  const badge = document.getElementById('tts-scope-badge');
  const btnFirst = document.getElementById('btn-scope-first');
  const btnFull = document.getElementById('btn-scope-full');
  const warroomScopeSelect = document.getElementById('warroom-tts-scope-select');

  if (warroomScopeSelect) warroomScopeSelect.value = currentTtsScope;

  if (badge) {
    badge.innerText = currentTtsScope === 'first_sentence' ? '1ST SENTENCE' : 'FULL OUTPUT';
    badge.className = currentTtsScope === 'first_sentence'
      ? 'text-cyan-400 font-bold text-[9px] px-1.5 py-0.2 rounded bg-cyan-950/80 border border-cyan-800'
      : 'text-purple-400 font-bold text-[9px] px-1.5 py-0.2 rounded bg-purple-950/80 border border-purple-800';
  }

  if (btnFirst && btnFull) {
    if (currentTtsScope === 'first_sentence') {
      btnFirst.className = 'py-1 px-2 text-[10px] font-mono rounded text-center transition bg-cyan-600/30 text-cyan-300 font-semibold border border-cyan-500/40 cursor-pointer';
      btnFull.className = 'py-1 px-2 text-[10px] font-mono rounded text-center transition text-slate-400 hover:text-slate-200 border border-transparent cursor-pointer';
    } else {
      btnFull.className = 'py-1 px-2 text-[10px] font-mono rounded text-center transition bg-purple-600/30 text-purple-300 font-semibold border border-purple-500/40 cursor-pointer';
      btnFirst.className = 'py-1 px-2 text-[10px] font-mono rounded text-center transition text-slate-400 hover:text-slate-200 border border-transparent cursor-pointer';
    }
  }
}

function switchTtsSpeechScope(scope) {
  currentTtsScope = scope;
  localStorage.setItem('nexusdesk_tts_scope', scope);
  refreshScopeUI();

  // Persist to backend settings
  fetch('/api/tts/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ speech_scope: scope })
  }).catch(() => {});
}

function refreshVoiceDropdown() {
  const picker = document.getElementById('voice-picker');
  const enginePicker = document.getElementById('tts-engine-picker');
  const warroomEngineSelect = document.getElementById('warroom-tts-engine-select');
  const badge = document.getElementById('tts-engine-status-badge');

  if (enginePicker) enginePicker.value = currentTtsEngine;
  if (warroomEngineSelect) warroomEngineSelect.value = currentTtsEngine;
  if (badge) {
    if (currentTtsEngine === 'edge') {
      badge.innerText = 'EDGE NEURAL';
      badge.className = 'text-emerald-400 font-bold text-[9px] px-1.5 py-0.2 rounded bg-emerald-950/80 border border-emerald-800';
    } else if (currentTtsEngine === 'piper') {
      badge.innerText = 'PIPER ONNX';
      badge.className = 'text-cyan-400 font-bold text-[9px] px-1.5 py-0.2 rounded bg-cyan-950/80 border border-cyan-800';
    } else {
      badge.innerText = 'BROWSER';
      badge.className = 'text-slate-400 font-bold text-[9px] px-1.5 py-0.2 rounded bg-slate-900 border border-slate-700';
    }
  }

  if (!picker) return;
  picker.innerHTML = '';

  if (currentTtsEngine === 'edge') {
    picker.innerHTML += '<option value="">Auto Persona (By Agent Role)</option>';
    availableEdgeVoices.forEach(v => {
      picker.innerHTML += `<option value="${v.id}">${v.name}</option>`;
    });
  } else if (currentTtsEngine === 'piper') {
    picker.innerHTML += '<option value="">Auto Persona (Local ONNX)</option>';
    availablePiperVoices.forEach(v => {
      picker.innerHTML += `<option value="${v.id}">${v.name}</option>`;
    });
  } else {
    picker.innerHTML += '<option value="">Default System Voice</option>';
    if (Array.isArray(availableBrowserVoices)) {
      availableBrowserVoices.forEach(v => {
        picker.innerHTML += `<option value="${v.name}">${v.name} (${v.lang})</option>`;
      });
    }
  }

  if (selectedAgent && selectedAgent.voice && selectedAgent.voice.voiceName) {
    picker.value = selectedAgent.voice.voiceName;
  }
}

function switchTtsEngine(engine) {
  currentTtsEngine = engine;
  localStorage.setItem('nexusdesk_tts_engine', engine);
  refreshVoiceDropdown();

  // Persist to backend settings
  fetch('/api/tts/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ active_engine: engine })
  }).catch(() => {});
}

// --- Web Speech API (STT & TTS per Agent + BL-VOICE-23 Bi-Directional Turn-Taking Loop) ---
function initSpeechEngine() {
  loadTtsVoices();
  refreshScopeUI();

  if ('speechSynthesis' in window) {
    window.speechSynthesis.onvoiceschanged = () => {
      availableBrowserVoices = window.speechSynthesis.getVoices();
      if (currentTtsEngine === 'browser') {
        refreshVoiceDropdown();
      }
    };
  }

  // Restore persisted Bi-Directional Voice state (without auto-triggering mic on cold reload unless user toggles)
  const savedBiDir = localStorage.getItem('nexusdesk_voice_bidirectional_mode');
  if (savedBiDir === 'true') {
    handsFreeVoiceActive = true;
    updateBiDirectionalVoiceUI('idle');
  } else {
    handsFreeVoiceActive = false;
    updateBiDirectionalVoiceUI('off');
  }

  // Escape key interrupts active TTS playback or active dictation immediately
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      stopActiveTtsPlayback();
      updateBiDirectionalVoiceUI(handsFreeVoiceActive ? 'idle' : 'off');
      const popover = document.getElementById('warroom-mention-popover');
      if (popover) popover.classList.add('hidden');
    }
  });
}

function updateAgentVoiceSetting() {
  if (!selectedAgent) return;
  const pitchEl = document.getElementById('range-pitch');
  const rateEl = document.getElementById('range-rate');
  const voiceEl = document.getElementById('voice-picker');
  if (pitchEl) selectedAgent.voice.pitch = parseFloat(pitchEl.value);
  if (rateEl) selectedAgent.voice.rate = parseFloat(rateEl.value);
  if (voiceEl) selectedAgent.voice.voiceName = voiceEl.value;
  const valPitchEl = document.getElementById('val-pitch');
  const valRateEl = document.getElementById('val-rate');
  if (valPitchEl) valPitchEl.innerText = selectedAgent.voice.pitch;
  if (valRateEl) valRateEl.innerText = selectedAgent.voice.rate;
  syncVoiceSettingsUi();
}

// BL-UI-48: Mobile Voice Settings Modal sync helpers
window.syncVoiceSettingsUi = function() {
  const modal = document.getElementById('mobile-voice-settings-modal');
  if (!modal) return;
  const eng = (typeof currentTtsEngine !== 'undefined' && currentTtsEngine) ? currentTtsEngine : 'edge';
  const scope = (typeof currentTtsScope !== 'undefined' && currentTtsScope) ? currentTtsScope : 'first_sentence';

  const mEng = document.getElementById('modal-tts-engine-picker');
  if (mEng) mEng.value = eng;
  const mEngBadge = document.getElementById('modal-tts-engine-status-badge');
  if (mEngBadge) mEngBadge.innerText = eng.toUpperCase() + (eng === 'edge' ? ' NEURAL' : eng === 'piper' ? ' LOCAL' : ' WEBSPEECH');

  const mScopeBadge = document.getElementById('modal-tts-scope-badge');
  if (mScopeBadge) mScopeBadge.innerText = (scope === 'first_sentence') ? '1ST SENTENCE' : 'FULL OUTPUT';
  const bScopeFirst = document.getElementById('modal-btn-scope-first');
  const bScopeFull = document.getElementById('modal-btn-scope-full');
  if (bScopeFirst && bScopeFull) {
    if (scope === 'first_sentence') {
      bScopeFirst.className = 'py-1.5 px-2 text-[10px] font-mono rounded text-center transition bg-cyan-600/30 text-cyan-300 font-semibold border border-cyan-500/40 cursor-pointer';
      bScopeFull.className = 'py-1.5 px-2 text-[10px] font-mono rounded text-center transition text-slate-400 hover:text-slate-200 border border-transparent cursor-pointer';
    } else {
      bScopeFull.className = 'py-1.5 px-2 text-[10px] font-mono rounded text-center transition bg-cyan-600/30 text-cyan-300 font-semibold border border-cyan-500/40 cursor-pointer';
      bScopeFirst.className = 'py-1.5 px-2 text-[10px] font-mono rounded text-center transition text-slate-400 hover:text-slate-200 border border-transparent cursor-pointer';
    }
  }

  // Sync modal voice picker options with desktop voice-picker
  const deskVoicePicker = document.getElementById('voice-picker');
  const mVoicePicker = document.getElementById('modal-voice-picker');
  if (deskVoicePicker && mVoicePicker) {
    mVoicePicker.innerHTML = deskVoicePicker.innerHTML;
    mVoicePicker.value = deskVoicePicker.value;
  }

  // Sync pitch & rate
  if (selectedAgent && selectedAgent.voice) {
    const mPitch = document.getElementById('modal-range-pitch');
    const mRate = document.getElementById('modal-range-rate');
    const mValPitch = document.getElementById('modal-val-pitch');
    const mValRate = document.getElementById('modal-val-rate');
    if (mPitch && selectedAgent.voice.pitch !== undefined) mPitch.value = selectedAgent.voice.pitch;
    if (mValPitch && selectedAgent.voice.pitch !== undefined) mValPitch.innerText = selectedAgent.voice.pitch;
    if (mRate && selectedAgent.voice.rate !== undefined) mRate.value = selectedAgent.voice.rate;
    if (mValRate && selectedAgent.voice.rate !== undefined) mValRate.innerText = selectedAgent.voice.rate;
  }
};

window.updateAgentVoiceSettingFromModal = function() {
  if (!selectedAgent) return;
  const mPitch = document.getElementById('modal-range-pitch');
  const mRate = document.getElementById('modal-range-rate');
  const mVoice = document.getElementById('modal-voice-picker');
  if (mPitch) {
    selectedAgent.voice.pitch = parseFloat(mPitch.value);
    const mValPitch = document.getElementById('modal-val-pitch');
    if (mValPitch) mValPitch.innerText = selectedAgent.voice.pitch;
    const deskPitch = document.getElementById('range-pitch');
    if (deskPitch) deskPitch.value = selectedAgent.voice.pitch;
    const deskValPitch = document.getElementById('val-pitch');
    if (deskValPitch) deskValPitch.innerText = selectedAgent.voice.pitch;
  }
  if (mRate) {
    selectedAgent.voice.rate = parseFloat(mRate.value);
    const mValRate = document.getElementById('modal-val-rate');
    if (mValRate) mValRate.innerText = selectedAgent.voice.rate;
    const deskRate = document.getElementById('range-rate');
    if (deskRate) deskRate.value = selectedAgent.voice.rate;
    const deskValRate = document.getElementById('val-rate');
    if (deskValRate) deskValRate.innerText = selectedAgent.voice.rate;
  }
  if (mVoice) {
    selectedAgent.voice.voiceName = mVoice.value;
    const deskVoice = document.getElementById('voice-picker');
    if (deskVoice) deskVoice.value = mVoice.value;
  }
};

window.toggleMobileVoiceSettingsModal = function(show) {
  const modal = document.getElementById('mobile-voice-settings-modal');
  if (!modal) return;
  const shouldShow = (typeof show === 'boolean') ? show : modal.classList.contains('hidden');
  if (shouldShow) {
    syncVoiceSettingsUi();
    modal.classList.remove('hidden');
  } else {
    modal.classList.add('hidden');
  }
};

function testAgentVoiceSample() {
  unlockAudio();
  const agent = selectedAgent || (typeof agents !== 'undefined' && agents[0]) || { name: 'Solaris', voice: { pitch: 1.0, rate: 1.0 } };
  speakWithAgentVoice(agent, `Hello! This is ${agent.name}. Testing ${currentTtsEngine.toUpperCase()} voice output.`);
}

function extractSpeechText(rawText, scope) {
  if (!rawText) return '';

  // BL-CHAT-32: Priority 1 - If response has <executive_summary>, use it as the spoken voice text!
  const execSummaryMatch = rawText.match(/<executive_summary>([\s\S]*?)<\/executive_summary>/i);
  if (execSummaryMatch && execSummaryMatch[1] && execSummaryMatch[1].trim().length > 3) {
    let summaryClean = execSummaryMatch[1]
      .replace(/```[\s\S]*?```/g, '')
      .replace(/!\[.*?\]\(.*?\)/g, '')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/[*#_\[\]()~>|]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (summaryClean) return summaryClean;
  }

  // 1. Strip code blocks and XML control/unclosed wrapper tags cleanly
  let text = (rawText || '')
    .replace(/<executive_summary>[\s\S]*?<\/executive_summary>/gi, '')
    .replace(/<(?:swarm_dispatch|async_task|no_op|set_reminder|set_schedule|manage_schedule|outbound_message|chat_agent_whatsapp|chat_agent_publish|chat_agent_recap_config|next_step)\b[^>]*>[\s\S]*?<\/(?:swarm_dispatch|async_task|no_op|set_reminder|set_schedule|manage_schedule|outbound_message|chat_agent_whatsapp|chat_agent_publish|chat_agent_recap_config|next_step)>/gi, '')
    .replace(/<\/?(?:executive_summary|swarm_dispatch|async_task|no_op|set_reminder|set_schedule|manage_schedule|outbound_message|chat_agent_whatsapp|chat_agent_publish|chat_agent_recap_config|next_step)\b[^>]*>/gi, '')
    .replace(/```[\s\S]*?```/g, ' [code omitted] ')
    .replace(/!\[.*?\]\(.*?\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/https?:\/\/\S+/g, ' link ')
    .replace(/^\s*(?:[#>*_]+\s*)*executive\s+(?:summary|synthesis)\b[^\n]*(?:\n+|$)/gim, '')
    .replace(/[*#_\[\]()~>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!text) return '';

  // 2. Extract first sentence vs full output based on scope
  if (scope === 'first_sentence') {
    const sentenceMatch = text.match(/^([^.!?\n]+[.!?])/);
    if (sentenceMatch && sentenceMatch[1] && sentenceMatch[1].trim().length > 8) {
      return sentenceMatch[1].trim();
    }
    if (text.length > 150) {
      const truncated = text.slice(0, 150);
      const lastSpace = truncated.lastIndexOf(' ');
      return (lastSpace > 40 ? truncated.slice(0, lastSpace) : truncated) + '.';
    }
    return text;
  }

  // Full output: speak up to 900 characters cleanly
  if (text.length > 900) {
    const truncated = text.slice(0, 897);
    const lastSpace = truncated.lastIndexOf(' ');
    return (lastSpace > 200 ? truncated.slice(0, lastSpace) : truncated) + '...';
  }
  return text;
}

async function playTtsStream(url, onEndedCallback) {
  const thisPlaybackId = ++currentTtsPlaybackId;

  // 1. Try modern Web Audio API (fetch + decodeAudioData)
  // This bypasses browser <audio> tag Range header bugs, handles MP3 and WAV reliably,
  // and works consistently even after prolonged async LLM processing once unlocked.
  const ctx = getTtsAudioContext();
  if (ctx) {
    try {
      if (ctx.state === 'suspended') {
        await ctx.resume().catch(() => {});
      }
      const res = await fetch(url);
      if (!res.ok) throw new Error(`TTS stream HTTP ${res.status}`);
      const arrayBuf = await res.arrayBuffer();
      const decodedBuf = await ctx.decodeAudioData(arrayBuf);

      // If another speak request arrived while downloading/decoding, discard this stale buffer
      if (thisPlaybackId !== currentTtsPlaybackId) {
        return false;
      }

      if (activeTtsSource) {
        try {
          activeTtsSource.stop();
          activeTtsSource.disconnect();
        } catch (_) {}
        activeTtsSource = null;
      }

      const source = ctx.createBufferSource();
      source.buffer = decodedBuf;
      source.connect(ctx.destination);
      activeTtsSource = source;

      source.onended = () => {
        if (activeTtsSource === source) {
          activeTtsSource = null;
        }
        lastTtsPlaybackEndTime = Date.now();
        if (thisPlaybackId === currentTtsPlaybackId && onEndedCallback) {
          onEndedCallback();
        }
      };

      source.start(0);
      return true;
    } catch (audioCtxErr) {
      console.warn('AudioContext streaming error, attempting HTMLAudio fallback:', audioCtxErr);
      if (activeTtsSource) {
        try { activeTtsSource.stop(); } catch (_) {}
        activeTtsSource = null;
      }
    }
  }

  // If another speak request superseded while attempting WebAudio, cancel fallback
  if (thisPlaybackId !== currentTtsPlaybackId) {
    return false;
  }

  // 2. Fallback: Reusable DOM-attached HTMLAudioElement with full user activation
  try {
    if (!sharedTtsAudioElement && typeof document !== 'undefined') {
      sharedTtsAudioElement = new Audio();
      sharedTtsAudioElement.id = 'nexusdesk-tts-audio';
      sharedTtsAudioElement.style.display = 'none';
      document.body.appendChild(sharedTtsAudioElement);
    }
    if (sharedTtsAudioElement) {
      activeTtsAudio = sharedTtsAudioElement;
      sharedTtsAudioElement.src = url;
      sharedTtsAudioElement.onended = () => {
        activeTtsAudio = null;
        lastTtsPlaybackEndTime = Date.now();
        if (thisPlaybackId === currentTtsPlaybackId && onEndedCallback) {
          onEndedCallback();
        }
      };
      sharedTtsAudioElement.onerror = (e) => {
        console.warn('HTMLAudio stream error:', e);
        activeTtsAudio = null;
        if (thisPlaybackId === currentTtsPlaybackId && onEndedCallback) {
          onEndedCallback();
        }
      };
      await sharedTtsAudioElement.play();
      return true;
    }
  } catch (audioErr) {
    console.warn('HTMLAudio playback rejected:', audioErr);
    activeTtsAudio = null;
    if (thisPlaybackId === currentTtsPlaybackId && onEndedCallback) {
      onEndedCallback();
    }
  }
  return false;
}

function _drainNextTtsQueueItem() {
  if (ttsPlaybackQueue.length > 0) {
    const nextItem = ttsPlaybackQueue.shift();
    _playPreparedAgentSpeech(nextItem.agent, nextItem.clean, nextItem.voiceCfg);
    return;
  }
  ttsQueueBusy = false;
  animateWaveform(false);
  lastTtsPlaybackEndTime = Date.now();
  if (handsFreeVoiceActive) {
    scheduleBiDirectionalListen(1400); // 1.4s acoustic cooldown buffer on mobile
  } else {
    updateBiDirectionalVoiceUI('off');
  }
}

function _playPreparedAgentSpeech(agent, clean, voiceCfg) {
  ttsQueueBusy = true;
  lastSpokenTtsCleanText = clean;

  // Engine Dispatch: Edge-TTS or Piper-TTS
  if (currentTtsEngine === 'edge' || currentTtsEngine === 'piper') {
    const token = (typeof localStorage !== 'undefined' ? localStorage.getItem('nexusdesk_token') : '') || '';
    const tokenQuery = token ? `&token=${encodeURIComponent(token)}` : '';
    const agentNameParam = agent?.name ? `&agent_name=${encodeURIComponent(agent.name.toLowerCase().trim())}` : '';
    const role = agent?.role || agent?.theme || 'developer';
    const targetVoice = voiceCfg.voiceName || '';
    const speedPercent = Math.round(((voiceCfg.rate || 1.0) - 1.0) * 100);
    const rateParam = speedPercent !== 0 ? `&rate=${speedPercent > 0 ? '+' : ''}${speedPercent}%` : '';

    // clean has already been scoped by extractSpeechText(rawText, currentTtsScope) (including <executive_summary>
    // and optional "Agent here," prefix), so request scope=full from /api/tts/stream to prevent backend re-truncation.
    const url = `/api/tts/stream?text=${encodeURIComponent(clean)}&engine=${currentTtsEngine}&voice=${encodeURIComponent(targetVoice)}${agentNameParam}&agent_role=${encodeURIComponent(role)}&scope=full${rateParam}${tokenQuery}`;

    animateWaveform(true);
    updateBiDirectionalVoiceUI('speaking');

    playTtsStream(url, () => {
      _drainNextTtsQueueItem();
    });
    return;
  }

  // Engine Dispatch: Browser Web Speech API ONLY if explicitly selected
  speakWithBrowserVoice(clean, voiceCfg);
}

function speakWithAgentVoice(agent, rawText, options = {}) {
  unlockAudio();
  stopActiveVoiceRecognition();

  let clean = extractSpeechText(rawText, currentTtsScope);
  if (!clean) {
    if (!ttsQueueBusy && handsFreeVoiceActive) scheduleBiDirectionalListen(800);
    return;
  }

  // Apply explicit spoken agent intro (e.g. "Claude here, ...") after <executive_summary> extraction
  if (options && options.prefix) {
    const prefixClean = String(options.prefix).trim().replace(/\.+$/, ',');
    const agName = (agent && agent.name) ? agent.name.trim() : '';
    const alreadyIntro = agName && new RegExp(`^${agName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b\\s*(here|speaking|reporting|says)`, 'i').test(clean);
    if (prefixClean && !alreadyIntro) {
      clean = `${prefixClean} ${clean}`;
    }
  }

  const voiceCfg = (agent && agent.voice) ? agent.voice : { pitch: 1.0, rate: 1.0, voiceName: '' };

  if (options && options.queue && (ttsQueueBusy || isAnyTtsActive())) {
    ttsPlaybackQueue.push({ agent, clean, voiceCfg });
    return;
  }

  stopActiveTtsPlayback(true);
  _playPreparedAgentSpeech(agent, clean, voiceCfg);
}

function speakWithBrowserVoice(clean, voiceCfg) {
  if (!('speechSynthesis' in window)) {
    _drainNextTtsQueueItem();
    return;
  }
  const utter = new SpeechSynthesisUtterance(clean);
  utter.pitch = voiceCfg.pitch || 1.0;
  utter.rate = voiceCfg.rate || 1.0;

  if (voiceCfg.voiceName && Array.isArray(availableBrowserVoices)) {
    const found = availableBrowserVoices.find(v => v.name === voiceCfg.voiceName);
    if (found) utter.voice = found;
  }

  animateWaveform(true);
  updateBiDirectionalVoiceUI('speaking');

  utter.onend = () => {
    _drainNextTtsQueueItem();
  };
  utter.onerror = () => {
    _drainNextTtsQueueItem();
  };

  // Chromium fix: wait 50ms before speak to prevent cancel collision freeze
  setTimeout(() => {
    try {
      window.speechSynthesis.speak(utter);
    } catch (e) {
      console.warn('speechSynthesis.speak error:', e);
    }
  }, 50);
}

let waveformAnimating = false;
function animateWaveform(start) {
  waveformAnimating = start;
  const wCanvas = document.getElementById('waveformCanvas');
  if (!wCanvas) return;
  const wCtx = wCanvas.getContext('2d');
  if (!start) {
    wCanvas.classList.add('hidden');
    wCtx.clearRect(0, 0, wCanvas.width, wCanvas.height);
    return;
  }
  wCanvas.classList.remove('hidden');
  function drawWave() {
    if (!waveformAnimating) return;
    wCtx.clearRect(0, 0, wCanvas.width, wCanvas.height);
    wCtx.strokeStyle = '#10b981';
    wCtx.lineWidth = 1.5;
    wCtx.beginPath();
    for (let x = 0; x < wCanvas.width; x += 4) {
      const y = (wCanvas.height / 2) + Math.sin((x * 0.2) + (Date.now() * 0.015)) * 8;
      if (x === 0) wCtx.moveTo(x, y); else wCtx.lineTo(x, y);
    }
    wCtx.stroke();
    requestAnimationFrame(drawWave);
  }
  drawWave();
}

let recognition = null;
let isSingleRecording = false;

if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
  const SpeechClass = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SpeechClass();
  recognition.continuous = false;
  recognition.interimResults = false;

  recognition.onstart = () => {
    isSingleRecording = true;
    const singleMic = document.getElementById('single-mic-icon');
    const warroomMic = document.getElementById('warroom-mic-icon');
    if (singleMic) singleMic.classList.add('text-rose-500', 'animate-pulse');
    if (warroomMic && currentConsoleMode === 'warroom') warroomMic.classList.add('text-rose-500', 'animate-pulse');
    if (handsFreeVoiceActive) updateBiDirectionalVoiceUI('listening');
  };

  // BL-VOICE-26: Pre-emptive Barge-in Audio Interruption on early speech onset
  recognition.onspeechstart = () => {
    if (isAnyTtsActive()) {
      console.warn('🎙️ User onspeechstart detected! Pre-emptively silencing TTS speaker before recording.');
      stopActiveTtsPlayback();
    }
  };

  recognition.onresult = async (e) => {
    const transcript = (e.results && e.results[0] && e.results[0][0]) ? e.results[0][0].transcript.trim() : '';
    if (!transcript) return;

    // BL-VOICE-24: Voice Barge-In Interrupt!
    // If the user begins speaking while an agent is currently playing spoken TTS, barge in immediately.
    if (isAnyTtsActive()) {
      console.warn('🎙️ User barge-in detected! Stopping agent TTS speaker playback immediately.');
      stopActiveTtsPlayback();
    }

    // BL-VOICE-26: Acoustic Echo Bleed Subtraction against last played agent speech
    const lower = transcript.toLowerCase();
    if (lastSpokenTtsCleanText) {
      const cleanLast = lastSpokenTtsCleanText.toLowerCase().replace(/[^\w\s]/g, '').trim();
      const cleanTrans = lower.replace(/[^\w\s]/g, '').trim();
      if (cleanTrans && cleanLast) {
        // Check if transcript is essentially identical to what the agent just said or begins with it
        if (cleanTrans === cleanLast || cleanLast.startsWith(cleanTrans) || cleanLast.includes(cleanTrans)) {
          if (cleanTrans.length > 8) {
            console.warn('🎙️ Discarded acoustic feedback echo from speaker playback:', transcript);
            return;
          }
        }
      }
    }

    // Self-Echo Bleed Filter: discard reflexive phrases matching agent self-introductions
    if (/^(this is|i am|i'm)\s+(solaris|claude|agy|pylon|scribe|lore|chroma|chorusius)\b/i.test(lower)) {
      console.warn('Discarded reflexive agent identity echo:', transcript);
      return;
    }

    // BL-VOICE-25: Clean transcript through existing Dispatcher LLM for phonetic accuracy & correct agent mentions
    let finalCommand = transcript;
    try {
      const roomTabs = (typeof consoleTabs !== 'undefined') ? consoleTabs.filter(t => t.type === 'warroom') : [];
      const curRoom = roomTabs.find(t => t.id === activeConsoleTabId) || {};
      const rid = curRoom.roomId || (typeof activeWarRoomId !== 'undefined' ? activeWarRoomId : 'general');
      const rTitle = curRoom.title || 'General';

      const res = await fetch('/api/war-room/stt/clean', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transcript: transcript,
          room_id: rid,
          room_title: rTitle
        })
      });
      if (res.ok) {
        const data = await res.json();
        if (data && data.cleaned) {
          finalCommand = data.cleaned;
        }
      }
    } catch (err) {
      console.warn('[STT] Dispatcher cleaner bypassed, using raw:', err);
    }

    if (currentConsoleMode === 'warroom') {
      const wrInput = document.getElementById('warroom-text-input');
      if (wrInput) {
        wrInput.value = wrInput.value.trim() && !handsFreeVoiceActive
          ? `${wrInput.value.trim()} ${finalCommand}`
          : finalCommand;
        if (handsFreeVoiceActive) {
          sendWarRoomChat();
        }
      }
    } else {
      const chatInput = document.getElementById('chat-text-input');
      if (chatInput) {
        chatInput.value = chatInput.value.trim() && !handsFreeVoiceActive
          ? `${chatInput.value.trim()} ${finalCommand}`
          : finalCommand;
        if (handsFreeVoiceActive) {
          sendConsoleChat();
        }
      }
    }
  };

  recognition.onend = () => {
    isSingleRecording = false;
    const singleMic = document.getElementById('single-mic-icon');
    const warroomMic = document.getElementById('warroom-mic-icon');
    if (singleMic) singleMic.classList.remove('text-rose-500', 'animate-pulse');
    if (warroomMic) warroomMic.classList.remove('text-rose-500', 'animate-pulse');

    // Only auto-restart listening if bi-directional mode is ON and no agent turn or TTS is currently active
    if (handsFreeVoiceActive && !isAgentTurnInFlight && !isAnyTtsActive()) {
      scheduleBiDirectionalListen(1200);
    }
  };
}

function stopActiveVoiceRecognition() {
  if (biDirListenTimer) {
    clearTimeout(biDirListenTimer);
    biDirListenTimer = null;
  }
  if (recognition && isSingleRecording) {
    try { recognition.stop(); } catch (e) {}
  }
  isSingleRecording = false;
}

function scheduleBiDirectionalListen(delayMs = 1200) {
  if (biDirListenTimer) clearTimeout(biDirListenTimer);
  if (!handsFreeVoiceActive) return;
  updateBiDirectionalVoiceUI('idle');
  biDirListenTimer = setTimeout(() => {
    if (!handsFreeVoiceActive || isAgentTurnInFlight) return;
    if (isAnyTtsActive() || (Date.now() - lastTtsPlaybackEndTime < 1000)) return;
    if (recognition && !isSingleRecording) {
      try {
        recognition.start();
      } catch (e) {}
    }
  }, delayMs);
}

function updateBiDirectionalVoiceUI(phase = 'idle') {
  const active = handsFreeVoiceActive;
  // 1. Top Header desktop & mobile indicators
  const indicator = document.getElementById('duplex-indicator');
  const label = document.getElementById('duplex-label');
  const mobIndicator = document.getElementById('duplex-indicator-mob');
  const headerBtn = document.getElementById('btn-duplex-voice');

  // 2. AgentFloor bar indicator
  const floorDot = document.getElementById('floor-bidir-dot');
  const floorLabel = document.getElementById('floor-bidir-label');
  const floorBtn = document.getElementById('btn-floor-bidir-voice');

  // 3. Chat Console bar indicator & live loop state pill
  const consoleDot = document.getElementById('console-bidir-dot');
  const consoleLabel = document.getElementById('console-bidir-label');
  const consoleBtn = document.getElementById('btn-console-bidir-voice');
  const warroomDot = document.getElementById('warroom-bidir-dot');
  const warroomLabel = document.getElementById('warroom-bidir-label');
  const warroomBtn = document.getElementById('btn-warroom-bidir-voice');
  const statePill = document.getElementById('voice-loop-state-pill');

  const activeBtnClass = 'border-emerald-500/80 bg-emerald-950/70 text-emerald-200 shadow-[0_0_12px_rgba(16,185,129,0.25)]';
  const inactiveBtnClass = 'border-slate-700 bg-slate-800/80 text-slate-300';

  if (active) {
    if (indicator) indicator.className = 'w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399] animate-pulse';
    if (label) label.innerText = 'bi-direct';
    if (mobIndicator) mobIndicator.className = 'w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399] animate-pulse';
    if (headerBtn) {
      headerBtn.classList.add('border-emerald-500/80', 'bg-emerald-950/60', 'text-emerald-200');
      headerBtn.classList.remove('border-slate-700', 'bg-slate-800/80', 'text-slate-300');
    }

    if (floorDot) floorDot.className = 'w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399] animate-pulse';
    if (floorLabel) floorLabel.innerText = 'bi-direct';
    if (floorBtn) {
      floorBtn.classList.add('border-emerald-500/80', 'bg-emerald-950/60', 'text-emerald-200');
      floorBtn.classList.remove('border-slate-700', 'bg-slate-800/80', 'text-slate-300');
    }

    if (consoleDot) consoleDot.className = 'w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399] animate-pulse';
    if (consoleLabel) consoleLabel.innerText = 'bi-direct';
    if (consoleBtn) {
      consoleBtn.className = `px-2.5 py-1 rounded-lg text-xs font-semibold font-mono flex items-center gap-1.5 transition cursor-pointer border ${activeBtnClass}`;
    }

    if (warroomDot) warroomDot.className = 'w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399] animate-pulse';
    if (warroomLabel) warroomLabel.innerText = 'bi-direct';
    if (warroomBtn) {
      warroomBtn.className = `px-2 py-1 rounded text-xs font-semibold font-mono flex items-center gap-1 transition cursor-pointer border ${activeBtnClass}`;
    }

    if (statePill) {
      if (phase === 'listening') {
        statePill.classList.remove('hidden');
        statePill.innerText = '🎙️ LISTENING TO YOU...';
        statePill.className = 'px-2.5 py-1 rounded-full text-[10px] font-mono font-bold bg-rose-950/90 text-rose-300 border border-rose-600/70 flex items-center gap-1.5 animate-pulse';
      } else if (phase === 'thinking') {
        statePill.classList.remove('hidden');
        statePill.innerText = '🧠 AGENT THINKING...';
        statePill.className = 'px-2.5 py-1 rounded-full text-[10px] font-mono font-bold bg-amber-950/90 text-amber-300 border border-amber-600/70 flex items-center gap-1.5 animate-pulse';
      } else if (phase === 'speaking') {
        statePill.classList.remove('hidden');
        statePill.innerText = '🔊 AGENT SPEAKING (ESC TO SKIP)';
        statePill.className = 'px-2.5 py-1 rounded-full text-[10px] font-mono font-bold bg-cyan-950/90 text-cyan-300 border border-cyan-600/70 flex items-center gap-1.5';
      } else {
        // Idle/standby: suppress badge to keep UI clean per BL-VOICE-24
        statePill.classList.add('hidden');
      }
    }
  } else {
    if (indicator) indicator.className = 'w-2 h-2 rounded-full bg-black border border-slate-700';
    if (label) label.innerText = 'bi-direct';
    if (mobIndicator) mobIndicator.className = 'w-2 h-2 rounded-full bg-black border border-slate-700';
    if (headerBtn) {
      headerBtn.classList.remove('border-emerald-500/80', 'bg-emerald-950/60', 'text-emerald-200');
      headerBtn.classList.add('border-slate-700', 'bg-slate-800/80', 'text-slate-300');
    }

    if (floorDot) floorDot.className = 'w-2 h-2 rounded-full bg-black border border-slate-700';
    if (floorLabel) floorLabel.innerText = 'bi-direct';
    if (floorBtn) {
      floorBtn.classList.remove('border-emerald-500/80', 'bg-emerald-950/60', 'text-emerald-200');
      floorBtn.classList.add('border-slate-700', 'bg-slate-800/80', 'text-slate-300');
    }

    if (consoleDot) consoleDot.className = 'w-2 h-2 rounded-full bg-black border border-slate-700';
    if (consoleLabel) consoleLabel.innerText = 'bi-direct';
    if (consoleBtn) {
      consoleBtn.className = `px-2.5 py-1 rounded-lg text-xs font-semibold font-mono flex items-center gap-1.5 transition bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700/80 cursor-pointer`;
    }

    if (warroomDot) warroomDot.className = 'w-2 h-2 rounded-full bg-black border border-slate-700';
    if (warroomLabel) warroomLabel.innerText = 'bi-direct';
    if (warroomBtn) {
      warroomBtn.className = `px-2 py-1 rounded text-xs font-semibold font-mono flex items-center gap-1 transition bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700/80 cursor-pointer`;
    }

    if (statePill) statePill.classList.add('hidden');
  }
}

function toggleSingleVoiceDictate() {
  if (!recognition) return alert('SpeechRecognition API not available in this browser.');
  if (!isSingleRecording) {
    stopActiveTtsPlayback();
    try { recognition.start(); } catch (e) {}
  } else {
    stopActiveVoiceRecognition();
  }
}

function toggleHandsFreeVoice() {
  handsFreeVoiceActive = !handsFreeVoiceActive;
  localStorage.setItem('nexusdesk_voice_bidirectional_mode', handsFreeVoiceActive ? 'true' : 'false');

  if (handsFreeVoiceActive) {
    // Ensure TTS audio response is also enabled when entering Bi-Directional Voice mode
    if (!audioResponseEnabled) {
      toggleAudioReply();
    }
    updateBiDirectionalVoiceUI('listening');
    if (recognition && !isSingleRecording && !isAnyTtsActive()) {
      try { recognition.start(); } catch (e) {}
    }
  } else {
    stopActiveVoiceRecognition();
    stopActiveTtsPlayback();
    updateBiDirectionalVoiceUI('off');
  }
}

function toggleAudioReply() {
  unlockAudio();
  audioResponseEnabled = !audioResponseEnabled;
  localStorage.setItem('nexusdesk_audio_response', audioResponseEnabled ? 'true' : 'false');
  const onIcon = document.getElementById('tts-icon-on');
  const offIcon = document.getElementById('tts-icon-off');
  const onMob = document.getElementById('tts-icon-on-mob');
  const offMob = document.getElementById('tts-icon-off-mob');
  if (onIcon) onIcon.classList.toggle('hidden', !audioResponseEnabled);
  if (offIcon) offIcon.classList.toggle('hidden', audioResponseEnabled);
  if (onMob) onMob.classList.toggle('hidden', !audioResponseEnabled);
  if (offMob) offMob.classList.toggle('hidden', audioResponseEnabled);
}
