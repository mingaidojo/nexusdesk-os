/**
 * @module chat/file_preview_artifacts.js
 * @description Server Artifact Discovery, Multimodal Media & FS Quick-View.
 * Rewrites agent markdown image paths, extracts/hydrates generated server file pills,
 * drives the FS Quick-View modal, and manages multi-file batch attachments.
 *
 * Part of the Console & War Room chat subsystem (concatenated globally by frontend/build.py).
 */

// ==============================================================
// --- BL-FILE-12 & BL-EVO-12: SERVER PATH & MULTIMODAL MEDIA ---
// ==============================================================
let currentPreviewPath = '';
let currentPreviewContentText = '';

function prepareAgentMarkdownMedia(text, roomId) {
  if (!text || typeof text !== 'string') return text;
  const currentRoom = roomId || (typeof activeWarRoomId !== 'undefined' ? activeWarRoomId : 'general');
  const token = (typeof NEXUSDESK_TOKEN !== 'undefined' && NEXUSDESK_TOKEN) ? NEXUSDESK_TOKEN : '';

  // Transform markdown image paths: ![alt](/home/nexus_shared/...) -> ![alt](/api/fs/preview?path=...)
  return text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (fullMatch, alt, url) => {
    let cleanUrl = url.trim().replace(/^<|>$/g, '');
    if (cleanUrl.startsWith('/home/nexus_shared/')) {
      return `![${alt}](/api/fs/preview?path=${encodeURIComponent(cleanUrl)}${token ? `&token=${encodeURIComponent(token)}` : ''})`;
    }
    if (cleanUrl.startsWith('deliverables/') || cleanUrl.startsWith('scratch/')) {
      const abs = `/home/nexus_shared/sandboxes/${currentRoom}/${cleanUrl}`;
      return `![${alt}](/api/fs/preview?path=${encodeURIComponent(abs)}${token ? `&token=${encodeURIComponent(token)}` : ''})`;
    }
    return fullMatch;
  });
}

function extractServerFilePaths(text, roomId) {
  if (!text || typeof text !== 'string') return [];
  const currentRoom = roomId || (typeof activeWarRoomId !== 'undefined' ? activeWarRoomId : 'general');
  const found = new Map(); // baseName -> fullPath

  // 1. Absolute /home/nexus_shared paths
  const ABS_REGEX = /(?:file:\/\/)?(\/home\/nexus_shared\/[a-zA-Z0-9_\-\.\/]+\.[a-zA-Z0-9]{1,10})/g;
  let match;
  while ((match = ABS_REGEX.exec(text)) !== null) {
    let p = match[1].replace(/^[<(\['"]+|[>)'\]":;,]+$/g, '');
    const base = p.split('/').pop();
    if (!found.has(base) || p.includes('/deliverables/')) {
      found.set(base, p);
    }
  }

  // 2. Relative deliverables/ or scratch/ paths
  const REL_REGEX = /(?:^|[\s\(`'"])((?:deliverables|scratch)\/[a-zA-Z0-9_\-\.\/]+\.[a-zA-Z0-9]{1,10})(?:$|[\s\)`'":;,])/g;
  while ((match = REL_REGEX.exec(text)) !== null) {
    let rel = match[1].trim();
    let absPath = `/home/nexus_shared/sandboxes/${currentRoom}/${rel}`;
    const base = rel.split('/').pop();
    if (!found.has(base) || rel.startsWith('deliverables/')) {
      found.set(base, absPath);
    }
  }

  // 3. Markdown image & link targets: ![alt](url) and [text](url)
  const MD_REGEX = /!?\[[^\]]*\]\(([^)]+)\)/g;
  while ((match = MD_REGEX.exec(text)) !== null) {
    let target = match[1].trim().replace(/^<|>$/g, '');
    if (target.startsWith('/home/nexus_shared/')) {
      const p = target.split('?')[0];
      const base = p.split('/').pop();
      if (!found.has(base) || p.includes('/deliverables/')) {
        found.set(base, p);
      }
    } else if (target.startsWith('deliverables/') || target.startsWith('scratch/')) {
      const p = target.split('?')[0];
      const absPath = `/home/nexus_shared/sandboxes/${currentRoom}/${p}`;
      const base = p.split('/').pop();
      if (!found.has(base) || p.startsWith('deliverables/')) {
        found.set(base, absPath);
      }
    }
  }

  // 4. BL-EVO-41: Explicit deliverables filenames in backticks or quotes (e.g. `OCBC_HSBC_210_v5.pptx`, "report.pdf")
  const DELIV_EXTS_REGEX = /[`'"]([a-zA-Z0-9_\-\.\/]+\.(?:pptx|ppt|pdf|csv|xlsx|xls|docx|doc|zip|tar\.gz|tgz|png|jpg|jpeg|webp))[`'"]/gi;
  while ((match = DELIV_EXTS_REGEX.exec(text)) !== null) {
    let fn = match[1].trim();
    const base = fn.split('/').pop();
    if (!found.has(base)) {
      const absPath = fn.includes('/') && fn.startsWith('scratch/')
        ? `/home/nexus_shared/sandboxes/${currentRoom}/${fn}`
        : `/home/nexus_shared/sandboxes/${currentRoom}/deliverables/${base}`;
      found.set(base, absPath);
    }
  }

  return Array.from(found.values());
}

// BL-EVO-26: Deliverable card metadata row (VPS folder · size · local modified time, click-to-copy path)
function formatArtifactSize(bytes) {
  if (typeof bytes !== 'number' || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function artifactMetaRowHtml(path, fallbackLabel) {
  const attr = String(path).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  return `
    <div class="flex items-center gap-1.5 mt-0.5 min-w-0 text-[9px] font-mono text-slate-500 leading-tight" data-artifact-meta="${attr}">
      <span data-meta-path class="truncate min-w-0 cursor-pointer hover:text-cyan-300 transition" title="${attr}&#10;Click to copy full path" onclick="copyArtifactPath(this)">${fallbackLabel}</span>
      <button type="button" onclick="copyArtifactPath(this)" class="px-1 py-0.2 rounded bg-slate-900 hover:bg-slate-800 border border-slate-700/80 text-slate-400 hover:text-cyan-300 transition cursor-pointer shrink-0 leading-none" title="Copy full path: ${attr}">📋</button>
      <span data-meta-size class="shrink-0 whitespace-nowrap text-slate-400 font-semibold"></span>
      <span data-meta-time class="shrink-0 whitespace-nowrap text-slate-400"></span>
    </div>`;
}

window.copyArtifactPath = async function(el) {
  const row = el && el.closest('[data-artifact-meta]');
  const full = (row && row.dataset.absPath) || (row && row.dataset.artifactMeta) || '';
  if (!full) return;
  try {
    await navigator.clipboard.writeText(full);
  } catch (_) {
    const ta = document.createElement('textarea');
    ta.value = full; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch (__) {}
    ta.remove();
  }
  const prev = el.innerText;
  el.innerText = prev === '📋' ? '✓' : '✓ Copied';
  el.classList.add('text-emerald-400');
  setTimeout(() => { el.innerText = prev; el.classList.remove('text-emerald-400'); }, 1100);
};

let artifactMetaTimer = null;
function scheduleArtifactMetaHydration(roomId) {
  if (artifactMetaTimer) clearTimeout(artifactMetaTimer);
  artifactMetaTimer = setTimeout(() => hydrateArtifactMeta(roomId), 250);
}

async function hydrateArtifactMeta(roomId) {
  const allRows = Array.from(document.querySelectorAll('[data-artifact-meta]:not([data-meta-done])')).reverse();
  if (allRows.length === 0) return;
  const uniquePaths = Array.from(new Set(allRows.map(r => r.dataset.artifactMeta)));
  try {
    for (let i = 0; i < uniquePaths.length; i += 50) {
      const chunk = uniquePaths.slice(i, i + 50);
      const qs = chunk.map(p => `paths=${encodeURIComponent(p)}`).join('&');
      const res = await fetch(`/api/war-room/sandbox/file-meta?room_id=${encodeURIComponent(roomId || 'general')}&${qs}`);
      if (!res.ok) continue;
      const data = (await res.json()).files || {};
      allRows.forEach(row => {
        const meta = data[row.dataset.artifactMeta];
        if (!meta) return;
        row.dataset.metaDone = '1';
        const pathEl = row.querySelector('[data-meta-path]');
        const copyBtn = row.querySelector('button');
        const sizeEl = row.querySelector('[data-meta-size]');
        const timeEl = row.querySelector('[data-meta-time]');
        if (!meta.exists) {
          if (sizeEl) sizeEl.innerText = '· missing';
          return;
        }
        row.dataset.absPath = meta.abs_path;
        if (pathEl) {
          pathEl.innerText = meta.folder + '/';
          pathEl.title = `${meta.abs_path}\nClick to copy full path`;
        }
        if (copyBtn) {
          copyBtn.title = `Copy full path: ${meta.abs_path}`;
        }
        if (sizeEl) sizeEl.innerText = `· ${formatArtifactSize(meta.size)}`;
        if (timeEl && meta.mtime) {
          const fmt = (typeof window.formatNexusDateTime === 'function')
            ? window.formatNexusDateTime(meta.mtime, false)
            : new Date(meta.mtime * 1000).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
          timeEl.innerText = `· ${fmt}`;
          timeEl.title = fmt;
        }
      });
    }
  } catch (e) {
    console.warn('Artifact metadata fetch failed:', e);
  }
}

function renderServerArtifactsCards(paths, roomId) {
  if (!paths || paths.length === 0) return '';
  const currentRoom = roomId || (typeof activeWarRoomId !== 'undefined' ? activeWarRoomId : 'general');
  scheduleArtifactMetaHydration(currentRoom);

  const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'];
  const images = [];
  const documents = [];

  paths.forEach(p => {
    const ext = p.includes('.') ? p.slice(p.lastIndexOf('.')).toLowerCase() : '';
    if (IMAGE_EXTS.includes(ext)) {
      images.push({ path: p, ext });
    } else {
      documents.push({ path: p, ext });
    }
  });

  let html = '';

  // 1. INLINE IMAGE PREVIEW CARDS (BL-EVO-12 Criterion 1)
  if (images.length > 0) {
    const imageCards = images.map(img => {
      const baseName = img.path.split('/').pop();
      const safePath = img.path.replace(/'/g, "\\'");
      const previewUrl = fsPreviewUrl(img.path);
      const extLabel = img.ext.replace('.', '').toUpperCase();

      return `
        <div class="group relative flex flex-col rounded-xl overflow-hidden bg-slate-950/90 border border-cyan-800/60 hover:border-cyan-400 transition-all duration-200 shadow-lg">
          <!-- Thumbnail with Lightbox click -->
          <div class="relative w-full overflow-hidden bg-black/60 flex items-center justify-center p-2 cursor-zoom-in"
               onclick="openFsQuickViewModal('${safePath}')" title="Click to enlarge in Lightbox">
            <img src="${previewUrl}" 
                 alt="${baseName}" 
                 loading="lazy" 
                 class="max-h-56 sm:max-h-64 w-auto object-contain rounded-lg transition-transform duration-200 group-hover:scale-[1.01]" 
                 onerror="this.onerror=null; this.parentElement.innerHTML='<div class=\\'p-6 text-xs text-slate-500 font-mono text-center\\'>🖼️ Image render pending or unavailable</div>';" />
            <div class="absolute top-2.5 right-2.5 opacity-0 group-hover:opacity-100 transition-opacity">
              <span class="px-2 py-1 rounded bg-black/75 border border-cyan-500/70 text-cyan-300 text-[10px] font-mono font-bold backdrop-blur-sm shadow flex items-center gap-1">
                🔍 Lightbox
              </span>
            </div>
            <div class="absolute top-2.5 left-2.5">
              <span class="px-1.5 py-0.5 rounded bg-cyan-950/90 border border-cyan-700/80 text-cyan-300 text-[9px] font-mono font-bold uppercase">
                ${extLabel}
              </span>
            </div>
          </div>
          <!-- Card Info & Action Bar -->
          <div class="p-2.5 flex items-center justify-between gap-2 bg-[#090d14] border-t border-slate-800/90">
            <div class="min-w-0 flex-1">
              <span class="text-xs font-mono font-semibold text-slate-200 hover:text-cyan-300 break-all leading-snug block cursor-pointer" 
                    onclick="openFsQuickViewModal('${safePath}')" title="${img.path}">
                ${baseName}
              </span>
              ${artifactMetaRowHtml(img.path, (img.path.includes('/deliverables/') ? 'deliverables/' : 'scratch/') + baseName)}
            </div>
            <div class="flex items-center gap-1.5 shrink-0">
              <button type="button" onclick="openFsQuickViewModal('${safePath}')" 
                      class="px-2 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-cyan-300 border border-slate-700 transition cursor-pointer text-[10px] font-mono flex items-center gap-1" 
                      title="Enlarge Image">
                <span>👁️</span> <span>View</span>
              </button>
              <button type="button" onclick="downloadServerFile('${safePath}')" 
                      class="px-2.5 py-1 rounded-lg bg-cyan-950 hover:bg-cyan-900 text-cyan-300 border border-cyan-700 hover:border-cyan-500 font-semibold transition cursor-pointer text-[10px] font-mono flex items-center gap-1 shadow-sm" 
                      title="Download image to local computer">
                <span>⬇️</span> <span>Download</span>
              </button>
            </div>
          </div>
        </div>
      `;
    }).join('');

    const gridClass = images.length === 1 ? 'grid grid-cols-1' : 'grid grid-cols-1 sm:grid-cols-2 gap-3';

    html += `
      <div class="mt-3 pt-2.5 border-t border-cyan-900/40">
        <div class="flex items-center gap-1.5 mb-2 text-[10px] font-mono text-cyan-400 font-semibold uppercase tracking-wider">
          <span>🖼️</span> <span>Generated Visuals & Charts (${images.length})</span>
        </div>
        <div class="${gridClass}">
          ${imageCards}
        </div>
      </div>
    `;
  }

  // 2. UNIVERSAL FILE DOWNLOAD CARDS (BL-EVO-12 Criterion 3)
  if (documents.length > 0) {
    const docCards = documents.map(doc => {
      const baseName = doc.path.split('/').pop();
      const safePath = doc.path.replace(/'/g, "\\'");
      const ext = doc.ext;
      const extUpper = ext.replace('.', '').toUpperCase();

      let icon = '📄';
      let badgeStyle = 'bg-slate-800 text-slate-300 border-slate-700';
      let typeLabel = extUpper || 'FILE';

      if (ext === '.pdf') {
        icon = '📕';
        badgeStyle = 'bg-rose-950/90 text-rose-300 border-rose-700/80';
        typeLabel = 'PDF';
      } else if (['.pptx', '.ppt'].includes(ext)) {
        icon = '📊';
        badgeStyle = 'bg-amber-950/90 text-amber-300 border-amber-700/80';
        typeLabel = 'SLIDES';
      } else if (['.docx', '.doc'].includes(ext)) {
        icon = '📑';
        badgeStyle = 'bg-blue-950/90 text-blue-300 border-blue-700/80';
        typeLabel = 'DOC';
      } else if (['.xlsx', '.xls', '.csv', '.tsv'].includes(ext)) {
        icon = '📊';
        badgeStyle = 'bg-emerald-950/90 text-emerald-300 border-emerald-700/80';
        typeLabel = extUpper;
      } else if (['.zip', '.tar', '.gz', '.tgz', '.7z'].includes(ext)) {
        icon = '📦';
        badgeStyle = 'bg-purple-950/90 text-purple-300 border-purple-700/80';
        typeLabel = 'ARCHIVE';
      } else if (['.html', '.htm'].includes(ext)) {
        icon = '🌐';
        badgeStyle = 'bg-teal-950/90 text-teal-300 border-teal-700/80';
        typeLabel = 'HTML';
      } else if (['.py', '.sh', '.js', '.json', '.yaml', '.yml', '.md', '.sql'].includes(ext)) {
        icon = '⚡';
        badgeStyle = 'bg-cyan-950/90 text-cyan-300 border-cyan-700/80';
        typeLabel = extUpper;
      }

      return `
        <div data-artifact-card class="flex flex-col gap-1.5 p-2.5 rounded-xl bg-slate-950/90 border border-slate-800/90 hover:border-cyan-600/70 transition shadow-sm min-w-0">
          <div class="flex items-start gap-2 min-w-0">
            <span class="text-base shrink-0 mt-0.5">${icon}</span>
            <div class="flex items-center gap-1.5 flex-wrap min-w-0 flex-1">
              <span class="text-cyan-200 font-mono font-semibold text-xs hover:text-cyan-100 break-all leading-snug cursor-pointer" 
                    onclick="openFsQuickViewModal(this.closest('[data-artifact-card]')?.querySelector('[data-artifact-meta]')?.dataset.absPath || '${safePath}')" title="${doc.path}">
                ${baseName}
              </span>
              <span class="text-[8px] font-mono px-1.5 py-0.2 rounded font-bold uppercase border shrink-0 ${badgeStyle}">
                ${typeLabel}
              </span>
            </div>
          </div>
          <div class="flex items-center justify-between gap-2 pl-6 flex-wrap">
            <div class="min-w-0 flex-1">
              ${artifactMetaRowHtml(doc.path, (doc.path.includes('/deliverables/') ? 'deliverables/' : 'scratch/') + baseName)}
            </div>
            <div class="flex items-center gap-1.5 shrink-0">
              <button type="button" onclick="openFsQuickViewModal(this.closest('[data-artifact-card]')?.querySelector('[data-artifact-meta]')?.dataset.absPath || '${safePath}')" 
                      class="px-2 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-cyan-300 border border-slate-700 transition cursor-pointer text-[10px] font-mono flex items-center gap-1" 
                      title="Preview artifact">
                <span>👁️</span> <span class="hidden sm:inline">View</span>
              </button>
              <button type="button" onclick="downloadServerFile('${safePath}', this)" 
                      class="px-2 sm:px-2.5 py-1 rounded-lg bg-cyan-950 hover:bg-cyan-900 text-cyan-300 border border-cyan-700 hover:border-cyan-500 font-semibold transition cursor-pointer text-[10px] font-mono flex items-center gap-1 shadow-sm" 
                      title="Download ${baseName} to local computer">
                <span>⬇️</span> <span class="hidden sm:inline">Download</span>
              </button>
            </div>
          </div>
        </div>
      `;
    }).join('');

    html += `
      <div class="mt-2.5 pt-2 border-t border-slate-800/80">
        <div class="flex items-center gap-1.5 mb-1.5 text-[10px] font-mono text-slate-400 font-semibold uppercase tracking-wider">
          <span>📎</span> <span>Deliverables & File Downloads (${documents.length})</span>
        </div>
        <div class="flex flex-col gap-1.5">
          ${docCards}
        </div>
      </div>
    `;
  }

  return html;
}

// Backwards compatibility alias
window.renderServerArtifactsCards = renderServerArtifactsCards;
window.renderServerArtifactsPills = renderServerArtifactsCards;
function renderServerArtifactsPills(paths, roomId) {
  return renderServerArtifactsCards(paths, roomId);
}

async function downloadServerFile(filePath, triggerEl = null) {
  try {
    const resolved = triggerEl && triggerEl.closest ? triggerEl.closest('[data-artifact-card]')?.querySelector('[data-artifact-meta]')?.dataset.absPath : '';
    let targetPath = resolved || filePath;
    if (!targetPath) return;
    if (targetPath.includes('path=')) {
      try {
        const u = new URL(targetPath, window.location.origin);
        targetPath = u.searchParams.get('path') || targetPath;
      } catch (e) {
        const m = targetPath.match(/path=([^&]+)/);
        if (m) targetPath = decodeURIComponent(m[1]);
      }
    }
    const token = (typeof NEXUSDESK_TOKEN !== 'undefined' && NEXUSDESK_TOKEN) ? NEXUSDESK_TOKEN : '';
    const roomParam = (typeof activeWarRoomId !== 'undefined' && activeWarRoomId) ? `&room_id=${encodeURIComponent(activeWarRoomId)}` : '';
    const infoUrl = `/api/fs/stat?path=${encodeURIComponent(targetPath)}${roomParam}${token ? `&token=${encodeURIComponent(token)}` : ''}`;
    try {
      const checkRes = await fetch(infoUrl);
      if (!checkRes.ok) {
        const errData = await checkRes.json().catch(() => ({}));
        const msg = errData.detail || `File not found (HTTP ${checkRes.status})`;
        if (typeof showToast === 'function') showToast(`Download failed: ${msg}`, 'error');
        else alert(`Download failed: ${msg}`);
        return;
      }
      const infoData = await checkRes.json().catch(() => ({}));
      if (infoData.path) targetPath = infoData.path;
    } catch (_) {}

    const url = `/api/fs/download?path=${encodeURIComponent(targetPath)}${roomParam}${token ? `&token=${encodeURIComponent(token)}` : ''}`;
    const a = document.createElement('a');
    a.href = url;
    a.download = targetPath.split('/').pop();
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } catch (e) {
    if (typeof showToast === 'function') showToast('Failed to initiate download: ' + e, 'error');
    else alert('Failed to initiate download: ' + e);
  }
}

// BL-FILE-13 & BL-EVO-17: Rich Universal Artifact Viewer (PDF, Markdown, CSV/TSV table, HTML, image, syntax-highlighted code, office pairing)
let currentPreviewKind = 'text';
let currentPreviewUrl = '';
let currentPreviewShowRaw = false;
let currentPreviewXlsxData = null;
let currentPreviewXlsxSheetIdx = 0;
let currentPreviewArchiveData = null;
let currentPreviewArchiveEntry = '';
let currentPreviewArchiveEntryState = null;
let fsPreviewShowLineNumbers = true;
const FS_PREVIEW_CONTAINERS = ['text', 'html', 'image', 'pdf', 'md', 'table', 'binary', 'archive'];
const FS_HIGHLIGHT_MAX_CHARS = 200000;
const FS_HIGHLIGHT_MAX_LINES = 4000;
const FS_CODE_EXT_LANG_MAP = {
  '.py': 'python', '.pyw': 'python',
  '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript', '.jsx': 'javascript',
  '.ts': 'typescript', '.tsx': 'typescript',
  '.sh': 'bash', '.bash': 'bash', '.zsh': 'bash',
  '.json': 'json', '.jsonl': 'json',
  '.sql': 'sql',
  '.yaml': 'yaml', '.yml': 'yaml',
  '.css': 'css', '.scss': 'scss',
  '.html': 'xml', '.htm': 'xml', '.xml': 'xml', '.svg': 'xml',
  '.toml': 'ini', '.ini': 'ini', '.conf': 'ini',
  '.md': 'markdown', '.rs': 'rust', '.go': 'go', '.java': 'java',
  '.c': 'c', '.cpp': 'cpp', '.h': 'c', '.hpp': 'cpp', '.php': 'php', '.rb': 'ruby'
};

function updateFsLineNumbersUi() {
  const codeEl = document.getElementById('fs-quickview-code');
  const btn = document.getElementById('fs-quickview-linenums-btn');
  const lbl = document.getElementById('fs-quickview-ln-lbl');
  if (codeEl) codeEl.classList.toggle('fs-with-ln', fsPreviewShowLineNumbers);
  if (lbl) lbl.innerText = fsPreviewShowLineNumbers ? 'Lines: ON' : 'Lines: OFF';
  if (btn) {
    btn.classList.toggle('border-cyan-500/40', fsPreviewShowLineNumbers);
    btn.classList.toggle('text-cyan-300', fsPreviewShowLineNumbers);
    btn.classList.toggle('border-slate-700', !fsPreviewShowLineNumbers);
    btn.classList.toggle('text-slate-400', !fsPreviewShowLineNumbers);
  }
}

window.toggleFsLineNumbers = function() {
  fsPreviewShowLineNumbers = !fsPreviewShowLineNumbers;
  updateFsLineNumbersUi();
};

function splitHighlightedHtmlLines(html) {
  const rawLines = String(html).split('\n');
  const openTags = [];
  return rawLines.map(line => {
    const prefix = openTags.join('');
    // Update open-tag stack across tokens in this line before balancing close tags
    const tagRegex = /<\/?span\b[^>]*>/g;
    let m;
    while ((m = tagRegex.exec(line)) !== null) {
      if (m[0].startsWith('</')) {
        if (openTags.length) openTags.pop();
      } else {
        openTags.push(m[0]);
      }
    }
    const suffix = '</span>'.repeat(openTags.length);
    return prefix + line + suffix;
  });
}

function renderFsCodePreview(codeEl, content, ext) {
  if (!codeEl) return { highlighted: false, lang: null, lines: 0 };
  const text = content || '';
  const lineCount = text ? text.split('\n').length : 0;
  const lang = FS_CODE_EXT_LANG_MAP[ext] || null;
  const lnBtn = document.getElementById('fs-quickview-linenums-btn');

  // Performance guard: very large files fall back cleanly to raw plain text
  if (text.length > FS_HIGHLIGHT_MAX_CHARS || lineCount > FS_HIGHLIGHT_MAX_LINES) {
    codeEl.classList.remove('fs-with-ln');
    codeEl.innerText = text;
    if (lnBtn) lnBtn.classList.add('hidden');
    return { highlighted: false, fastFallback: true, lang, lines: lineCount };
  }

  if (lnBtn) lnBtn.classList.remove('hidden');
  updateFsLineNumbersUi();

  let htmlContent = '';
  let didHighlight = false;
  if (lang && typeof hljs !== 'undefined' && hljs.getLanguage(lang)) {
    try {
      htmlContent = hljs.highlight(text, { language: lang, ignoreIllegals: true }).value;
      didHighlight = true;
    } catch (e) {
      htmlContent = escapeFsHtml(text);
    }
  } else {
    htmlContent = escapeFsHtml(text);
  }

  const lines = splitHighlightedHtmlLines(htmlContent);
  const linesHtml = lines
    .map((lineHtml, idx) => `<span class="fs-code-line" data-ln="${idx + 1}"><span class="fs-code-src">${lineHtml || ' '}</span></span>`)
    .join('');
  codeEl.innerHTML = `<code class="hljs${lang ? ` language-${lang}` : ''}">${linesHtml}</code>`;
  return { highlighted: didHighlight, fastFallback: false, lang, lines: lines.length };
}

function fsPreviewUrl(filePath) {
  const token = (typeof NEXUSDESK_TOKEN !== 'undefined' && NEXUSDESK_TOKEN) ? NEXUSDESK_TOKEN : '';
  return `/api/fs/preview?path=${encodeURIComponent(filePath)}${token ? `&token=${encodeURIComponent(token)}` : ''}`;
}

function showFsPreviewContainer(kind) {
  FS_PREVIEW_CONTAINERS.forEach(k => {
    const el = document.getElementById(`fs-quickview-${k === 'text' ? 'text' : k}-container`);
    if (el) el.classList.toggle('hidden', k !== kind);
  });
  currentPreviewKind = kind;
}

function escapeFsHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function parseDelimitedText(text, delim) {
  const rows = [];
  let row = [], cell = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') inQ = false;
      else cell += c;
    } else if (c === '"') inQ = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

function renderFsTableRows(rows, totalRows = null) {
  const MAX_ROWS = 1000;
  if (!rows || rows.length === 0) return '<div class="p-4 text-xs font-mono text-slate-500">Empty sheet or file.</div>';
  const maxCols = rows.reduce((m, r) => Math.max(m, r.length), 0);
  const head = rows[0] || [];
  const colCount = Math.max(head.length, maxCols);
  const body = rows.slice(1, MAX_ROWS + 1);
  const th = Array.from({ length: colCount }, (_, ci) => {
    const h = head[ci] !== undefined && head[ci] !== '' ? head[ci] : `Col ${ci + 1}`;
    return `<th class="sticky top-0 bg-slate-900 text-cyan-300 text-left px-3 py-1.5 border-b border-slate-700 font-semibold whitespace-nowrap">${escapeFsHtml(h)}</th>`;
  }).join('');
  const tr = body.map((r, i) => `<tr class="${i % 2 ? 'bg-slate-900/40' : ''}">${Array.from({ length: colCount }, (_, ci) => `<td class="px-3 py-1 border-b border-slate-800/70 text-slate-200 whitespace-nowrap">${escapeFsHtml(r[ci] ?? '')}</td>`).join('')}</tr>`).join('');
  const actualTotal = totalRows !== null ? totalRows - 1 : rows.length - 1;
  const shown = body.length;
  const note = actualTotal > shown ? `<div class="p-2 text-[10px] font-mono text-amber-400">Showing first ${shown} of ${actualTotal} data rows. Download the file for full data.</div>` : '';
  return `<table class="min-w-full text-[11px] font-mono border-collapse"><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table>${note}`;
}

function renderFsTable(text, delim) {
  const rows = parseDelimitedText(text, delim);
  return renderFsTableRows(rows);
}

function renderFsXlsxSheet(sheetIdx = 0) {
  const data = currentPreviewXlsxData;
  if (!data || !Array.isArray(data.sheets) || data.sheets.length === 0) {
    const body = document.getElementById('fs-quickview-table-body');
    if (body) body.innerHTML = '<div class="p-4 text-xs font-mono text-slate-500">Workbook has no sheets.</div>';
    return;
  }
  const idx = Math.max(0, Math.min(sheetIdx, data.sheets.length - 1));
  currentPreviewXlsxSheetIdx = idx;
  const sheet = data.sheets[idx];

  const tabsEl = document.getElementById('fs-quickview-xlsx-tabs');
  if (tabsEl) {
    tabsEl.classList.remove('hidden');
    tabsEl.innerHTML = data.sheets.map((s, i) => {
      const active = i === idx;
      const cls = active
        ? 'bg-cyan-950/90 border-cyan-500/60 text-cyan-200 font-semibold'
        : 'bg-slate-900/90 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700';
      return `<button type="button" onclick="selectFsXlsxSheet(${i})" class="px-2.5 py-1 rounded-lg border text-[11px] font-mono whitespace-nowrap transition cursor-pointer shrink-0 ${cls}">${escapeFsHtml(s.name)} <span class="text-[9px] opacity-70">(${s.total_rows})</span></button>`;
    }).join('');
  }

  const kb = ((data.size || 0) / 1024).toFixed(1);
  const tm = document.getElementById('fs-quickview-table-meta');
  if (tm) {
    tm.innerText = `📊 Excel Workbook • ${data.sheets.length} sheet${data.sheets.length === 1 ? '' : 's'} • ${kb} KB • ${sheet.name} (${sheet.total_rows} rows × ${sheet.total_cols} cols)`;
  }
  const body = document.getElementById('fs-quickview-table-body');
  if (body) {
    body.innerHTML = renderFsTableRows(sheet.rows, sheet.truncated ? sheet.total_rows : null);
    body.scrollTop = 0;
    body.scrollLeft = 0;
  }
}

window.selectFsXlsxSheet = function(idx) {
  renderFsXlsxSheet(idx);
};

async function openFsQuickViewModal(filePath) {
  if (!filePath) return;
  if (filePath.includes('path=')) {
    try {
      const u = new URL(filePath, window.location.origin);
      filePath = u.searchParams.get('path') || filePath;
    } catch (e) {
      const m = filePath.match(/path=([^&]+)/);
      if (m) filePath = decodeURIComponent(m[1]);
    }
  }
  currentPreviewPath = filePath;
  currentPreviewContentText = '';
  currentPreviewShowRaw = false;
  currentPreviewUrl = '';
  currentPreviewXlsxData = null;
  currentPreviewXlsxSheetIdx = 0;
  currentPreviewArchiveData = null;
  currentPreviewArchiveEntry = '';
  currentPreviewArchiveEntryState = null;
  const modal = document.getElementById('modal-fs-quickview');
  const title = document.getElementById('fs-quickview-title');
  const pathEl = document.getElementById('fs-quickview-path');
  const icon = document.getElementById('fs-quickview-icon');
  const spinner = document.getElementById('fs-quickview-spinner');
  const codeEl = document.getElementById('fs-quickview-code');
  const metaEl = document.getElementById('fs-quickview-meta');
  const iframeEl = document.getElementById('fs-quickview-iframe');
  const imgEl = document.getElementById('fs-quickview-img');
  const pdfFrame = document.getElementById('fs-quickview-pdf-frame');

  if (!modal) return;
  const baseName = filePath.split('/').pop();
  if (title) title.innerText = baseName.toUpperCase();
  if (pathEl) pathEl.innerText = filePath;

  modal.classList.remove('hidden');
  if (spinner) spinner.classList.remove('hidden');
  FS_PREVIEW_CONTAINERS.forEach(k => {
    const el = document.getElementById(`fs-quickview-${k}-container`);
    if (el) el.classList.add('hidden');
  });

  const ext = baseName.includes('.') ? baseName.slice(baseName.lastIndexOf('.')).toLowerCase() : '';
  const token = (typeof NEXUSDESK_TOKEN !== 'undefined' && NEXUSDESK_TOKEN) ? NEXUSDESK_TOKEN : '';
  const url = fsPreviewUrl(filePath);

  try {
    if (ext === '.html' || ext === '.htm') {
      if (icon) icon.innerText = '🌐';
      if (iframeEl) iframeEl.src = url;
      currentPreviewUrl = url;
      showFsPreviewContainer('html');
    } else if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico'].includes(ext)) {
      if (icon) icon.innerText = '🖼️';
      if (imgEl) imgEl.src = url;
      currentPreviewUrl = url;
      showFsPreviewContainer('image');
    } else if (ext === '.pdf') {
      if (icon) icon.innerText = '📕';
      if (pdfFrame) pdfFrame.src = url;
      const pm = document.getElementById('fs-quickview-pdf-meta');
      if (pm) pm.innerText = 'Native PDF viewer';
      currentPreviewUrl = url;
      showFsPreviewContainer('pdf');
    } else {
      const res = await fetch(`/api/fs/preview?path=${encodeURIComponent(filePath)}`, {
        headers: token ? { 'X-NexusDesk-Token': token } : {}
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Failed to read file');

      if (data.kind === 'archive') {
        if (icon) icon.innerText = '📦';
        currentPreviewArchiveData = data;
        renderFsArchiveExplorer(data);
        showFsPreviewContainer('archive');
        if (data.default_entry) {
          previewFsArchiveEntry(data.default_entry);
        }
      } else if (data.kind === 'xlsx') {
        if (icon) icon.innerText = '📊';
        currentPreviewXlsxData = data;
        const rawBtn = document.getElementById('fs-quickview-raw-btn');
        if (rawBtn) rawBtn.classList.add('hidden');
        renderFsXlsxSheet(0);
        showFsPreviewContainer('table');
      } else if (data.kind === 'office') {
        if (icon) icon.innerText = '📊';
        if (data.paired_pdf) {
          // Show the LibreOffice-rendered PDF twin of the office document
          const pdfUrl = fsPreviewUrl(data.paired_pdf);
          if (pdfFrame) pdfFrame.src = pdfUrl;
          const pl = document.getElementById('fs-quickview-pdf-label');
          if (pl) pl.innerText = `📕 PDF render of ${baseName}`;
          const pm = document.getElementById('fs-quickview-pdf-meta');
          if (pm) pm.innerText = 'Use ⬇️ Download for the original Office file';
          currentPreviewUrl = pdfUrl;
          showFsPreviewContainer('pdf');
        } else {
          const bm = document.getElementById('fs-quickview-binary-msg');
          if (bm) bm.innerText = `${baseName} is an Office document with no PDF render beside it. Ask an agent to convert it (libreoffice --headless --convert-to pdf) or download it.`;
          showFsPreviewContainer('binary');
        }
      } else if (data.kind === 'binary') {
        if (icon) icon.innerText = '🗂️';
        const kb = (data.size / 1024).toFixed(1);
        const bm = document.getElementById('fs-quickview-binary-msg');
        if (bm) bm.innerText = `${baseName} (${data.mime_type || 'binary'}, ${kb} KB) has no inline preview. Download it to open locally.`;
        showFsPreviewContainer('binary');
      } else {
        currentPreviewContentText = data.content || '';
        const kb = (data.size / 1024).toFixed(1);
        const renderInfo = renderFsCodePreview(codeEl, currentPreviewContentText, ext);
        const langBadge = renderInfo.highlighted && renderInfo.lang ? `${renderInfo.lang.toUpperCase()} • ` : '';
        const linesBadge = renderInfo.lines ? `${renderInfo.lines} lines • ` : '';
        const fallbackBadge = renderInfo.fastFallback ? ' • Plain-text fast mode' : '';
        const metaTxt = `${langBadge}${linesBadge}${data.mime_type || 'text'} • ${kb} KB${data.truncated ? ' (Preview Truncated at 2MB)' : ''}${fallbackBadge}`;
        if (metaEl) metaEl.innerText = metaTxt;

        if (ext === '.md' && typeof marked !== 'undefined') {
          if (icon) icon.innerText = '📝';
          const body = document.getElementById('fs-quickview-md-body');
          if (body) body.innerHTML = marked.parse(currentPreviewContentText);
          showFsPreviewContainer('md');
        } else if (ext === '.csv' || ext === '.tsv') {
          if (icon) icon.innerText = '📊';
          const tabsEl = document.getElementById('fs-quickview-xlsx-tabs');
          if (tabsEl) tabsEl.classList.add('hidden');
          const rawBtn = document.getElementById('fs-quickview-raw-btn');
          if (rawBtn) rawBtn.classList.remove('hidden');
          const body = document.getElementById('fs-quickview-table-body');
          if (body) body.innerHTML = renderFsTable(currentPreviewContentText, ext === '.tsv' ? '\t' : ',');
          const tm = document.getElementById('fs-quickview-table-meta');
          if (tm) tm.innerText = `📊 Data Table • ${metaTxt}`;
          showFsPreviewContainer('table');
        } else {
          if (icon) icon.innerText = ext === '.py' ? '⚡' : (renderInfo.highlighted ? '💻' : '📄');
          showFsPreviewContainer('text');
        }
      }
    }
  } catch (err) {
    showFsPreviewContainer('text');
    if (codeEl) codeEl.innerText = `Error loading artifact preview: ${err.message || err}`;
    if (metaEl) metaEl.innerText = 'ERROR';
  } finally {
    if (spinner) spinner.classList.add('hidden');
  }
}

// Toggle between rendered (markdown/table) and raw text views
function toggleFsPreviewRaw() {
  currentPreviewShowRaw = !currentPreviewShowRaw;
  if (currentPreviewShowRaw) {
    const prev = currentPreviewKind;
    showFsPreviewContainer('text');
    currentPreviewKind = prev; // remember rendered kind for toggling back
  } else {
    const ext = (currentPreviewPath.split('.').pop() || '').toLowerCase();
    showFsPreviewContainer(ext === 'md' ? 'md' : 'table');
  }
}

function _formatFsBytes(bytes) {
  const b = Number(bytes || 0);
  if (b >= 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`;
  if (b >= 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${b} B`;
}

function _archiveEntryIcon(kind, name) {
  const lower = (name || '').toLowerCase();
  if (kind === 'image') return '🖼️';
  if (kind === 'html') return '🌐';
  if (kind === 'pdf') return '📕';
  if (kind === 'xlsx' || kind === 'table') return '📊';
  if (kind === 'md') return '📝';
  if (lower.endsWith('.css') || lower.endsWith('.scss')) return '🎨';
  if (lower.endsWith('.json') || lower.endsWith('.jsonl')) return '📋';
  if (kind === 'code') return '⚡';
  if (kind === 'office') return '📑';
  return '📄';
}

function _archiveEntryUrl(entryPath, opts = {}) {
  const token = (typeof NEXUSDESK_TOKEN !== 'undefined' && NEXUSDESK_TOKEN) ? NEXUSDESK_TOKEN : '';
  const roomParam = (typeof activeWarRoomId !== 'undefined' && activeWarRoomId) ? `&room_id=${encodeURIComponent(activeWarRoomId)}` : '';
  const rawQ = opts.raw ? '&raw=1' : '';
  const dlQ = opts.download ? '&download=1' : '';
  const tokQ = token ? `&token=${encodeURIComponent(token)}` : '';
  return `/api/fs/archive-entry?path=${encodeURIComponent(currentPreviewPath)}&entry=${encodeURIComponent(entryPath)}${rawQ}${dlQ}${roomParam}${tokQ}`;
}

function renderFsArchiveTreeList(filterText = '') {
  const treeEl = document.getElementById('fs-archive-tree');
  if (!treeEl || !currentPreviewArchiveData) return;
  const q = filterText.trim().toLowerCase();
  const entries = (currentPreviewArchiveData.entries || []).filter((e) => {
    return !q || e.path.toLowerCase().includes(q) || e.name.toLowerCase().includes(q);
  });
  if (entries.length === 0) {
    treeEl.innerHTML = '<div class="py-4 text-center text-[11px] text-slate-500">No archive entries match filter.</div>';
    return;
  }

  // Group visually by directory folder
  const grouped = [];
  let lastDir = null;
  entries.forEach((e) => {
    const dirLbl = e.dir || '(root)';
    if (dirLbl !== lastDir) {
      lastDir = dirLbl;
      grouped.push(`<div class="px-2 pt-2 pb-0.5 text-[9.5px] font-bold text-slate-500 uppercase tracking-wider truncate" title="${escapeFsHtml(dirLbl)}">📁 ${escapeFsHtml(dirLbl)}</div>`);
    }
    const isSel = currentPreviewArchiveEntry === e.path;
    const encPath = encodeURIComponent(e.path);
    const ic = _archiveEntryIcon(e.kind, e.name);
    grouped.push(`
      <div class="group flex items-center justify-between gap-1 px-2 py-1 rounded-lg cursor-pointer transition border ${
        isSel
          ? 'bg-cyan-950/70 border-cyan-500/50 text-cyan-100'
          : 'border-transparent hover:bg-slate-800/80 text-slate-300'
      }" onclick="previewFsArchiveEntry(decodeURIComponent('${encPath}'))" title="${escapeFsHtml(e.path)}">
        <div class="flex items-center gap-1.5 min-w-0 flex-1">
          <span class="shrink-0 text-xs">${ic}</span>
          <span class="truncate ${isSel ? 'font-semibold text-cyan-200' : ''}">${escapeFsHtml(e.name)}</span>
        </div>
        <div class="flex items-center gap-1 shrink-0">
          <span class="text-[9px] text-slate-500">${_formatFsBytes(e.size)}</span>
          <button type="button" onclick="event.stopPropagation(); downloadFsArchiveEntry(decodeURIComponent('${encPath}'))"
                  class="opacity-70 sm:opacity-0 sm:group-hover:opacity-100 px-1 py-0.5 rounded bg-slate-900 hover:bg-cyan-950 text-cyan-300 text-[9px] transition cursor-pointer" title="Download this file only">⬇️</button>
        </div>
      </div>
    `);
  });
  treeEl.innerHTML = grouped.join('');
}

function renderFsArchiveExplorer(data) {
  const metaEl = document.getElementById('fs-archive-meta');
  const picksEl = document.getElementById('fs-archive-quick-picks');
  const filterEl = document.getElementById('fs-archive-filter-input');
  if (filterEl) filterEl.value = '';
  if (metaEl) {
    const ratio = data.total_uncompressed > 0 && data.size > 0
      ? ` · ${Math.max(0, Math.round((1 - data.size / data.total_uncompressed) * 100))}% compressed`
      : '';
    metaEl.innerText = `📦 ${data.total_files} file${data.total_files === 1 ? '' : 's'} · ${_formatFsBytes(data.size)} zipped (${_formatFsBytes(data.total_uncompressed)} extracted${ratio})`;
  }
  if (picksEl) {
    const picks = Array.isArray(data.quick_picks) ? data.quick_picks : [];
    picksEl.innerHTML = picks.map((p) => {
      const encPath = encodeURIComponent(p.path);
      return `<button type="button" onclick="previewFsArchiveEntry(decodeURIComponent('${encPath}'))" class="px-2 py-0.5 rounded-md bg-slate-900 hover:bg-cyan-950/70 border border-slate-700/80 hover:border-cyan-500/60 text-[10px] font-mono text-slate-200 hover:text-cyan-200 transition cursor-pointer flex items-center gap-1">${_archiveEntryIcon(p.kind, p.name)} <span>${escapeFsHtml(p.name)}</span></button>`;
    }).join('');
  }
  renderFsArchiveTreeList('');
}

window.filterFsArchiveEntries = function(q) {
  renderFsArchiveTreeList(q || '');
};

window.downloadFsArchiveEntry = function(entryPath) {
  if (!currentPreviewPath || !entryPath) return;
  const a = document.createElement('a');
  a.href = _archiveEntryUrl(entryPath, { download: true });
  a.download = entryPath.split('/').pop();
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
};

window.downloadCurrentArchiveEntry = function() {
  if (currentPreviewArchiveEntry) downloadFsArchiveEntry(currentPreviewArchiveEntry);
};

function renderArchiveEntryBodyContent() {
  const st = currentPreviewArchiveEntryState;
  const bodyEl = document.getElementById('fs-archive-entry-body');
  if (!st || !bodyEl) return;

  const entryPath = st.entry;
  const ext = st.ext || '';
  const showRaw = !!st.showRaw;
  const rawBtn = document.getElementById('fs-archive-entry-raw-btn');
  if (rawBtn) {
    const supportsToggle = st.kind === 'md' || st.kind === 'table' || st.kind === 'html';
    rawBtn.classList.toggle('hidden', !supportsToggle);
    if (supportsToggle) rawBtn.innerText = showRaw ? 'Rendered' : 'Raw';
  }

  if (st.kind === 'image') {
    const rawUrl = _archiveEntryUrl(entryPath, { raw: true });
    currentPreviewUrl = rawUrl;
    bodyEl.innerHTML = `<div class="flex-1 min-h-0 flex items-center justify-center overflow-auto bg-[#090d13] rounded-lg border border-slate-800/80 p-3"><img src="${rawUrl}" alt="${escapeFsHtml(st.name)}" class="max-w-full max-h-full object-contain rounded shadow-lg" /></div>`;
    return;
  }

  if (st.kind === 'pdf') {
    const rawUrl = _archiveEntryUrl(entryPath, { raw: true });
    currentPreviewUrl = rawUrl;
    bodyEl.innerHTML = `<iframe src="${rawUrl}" class="flex-1 w-full bg-slate-200 rounded-lg border border-slate-700"></iframe>`;
    return;
  }

  if (st.kind === 'html' && !showRaw) {
    const rawUrl = _archiveEntryUrl(entryPath, { raw: true });
    currentPreviewUrl = rawUrl;
    bodyEl.innerHTML = `<iframe src="${rawUrl}" class="flex-1 w-full bg-white rounded-lg border border-slate-700" sandbox="allow-scripts allow-same-origin"></iframe>`;
    return;
  }

  if (st.kind === 'xlsx') {
    const sheets = st.sheets || [];
    if (!sheets.length) {
      bodyEl.innerHTML = '<div class="p-4 text-xs font-mono text-slate-500">Workbook has no sheets.</div>';
      return;
    }
    const idx = Math.max(0, Math.min(st.sheetIdx || 0, sheets.length - 1));
    const sheet = sheets[idx];
    const tabsHtml = sheets.map((s, i) => `
      <button type="button" onclick="selectFsArchiveXlsxSheet(${i})" class="px-2 py-0.5 rounded-md border text-[10px] font-mono whitespace-nowrap cursor-pointer ${i === idx ? 'bg-cyan-950/90 border-cyan-500/60 text-cyan-200 font-semibold' : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'}">${escapeFsHtml(s.name)} (${s.total_rows})</button>
    `).join('');
    bodyEl.innerHTML = `
      <div class="flex items-center gap-1.5 mb-2 overflow-x-auto pb-1 custom-scrollbar shrink-0">${tabsHtml}</div>
      <div class="flex-1 min-h-0 overflow-auto bg-[#090d13] border border-slate-800/80 rounded-lg custom-scrollbar">${renderFsTableRows(sheet.rows, sheet.truncated ? sheet.total_rows : null)}</div>
    `;
    return;
  }

  if (st.kind === 'binary') {
    currentPreviewUrl = '';
    bodyEl.innerHTML = `
      <div class="flex-1 flex flex-col items-center justify-center gap-2 text-center">
        <div class="text-3xl">🗂️</div>
        <div class="text-xs font-mono text-slate-300">${escapeFsHtml(st.name)} (${escapeFsHtml(st.mime_type || 'binary')}, ${_formatFsBytes(st.size)}) cannot be previewed as text.</div>
        <button type="button" onclick="downloadCurrentArchiveEntry()" class="px-3 py-1 rounded-lg bg-cyan-950 hover:bg-cyan-900 border border-cyan-700 text-cyan-300 text-xs font-mono cursor-pointer">⬇️ Download Entry</button>
      </div>
    `;
    return;
  }

  currentPreviewUrl = '';
  currentPreviewContentText = st.content || '';
  if (st.kind === 'md' && !showRaw && typeof marked !== 'undefined') {
    bodyEl.innerHTML = `<div class="flex-1 min-h-0 overflow-auto bg-[#090d13] border border-slate-800/80 rounded-lg p-3.5 prose prose-invert prose-sm max-w-none text-slate-200 select-text custom-scrollbar">${marked.parse(st.content || '')}</div>`;
    return;
  }

  if (st.kind === 'table' && !showRaw) {
    bodyEl.innerHTML = `<div class="flex-1 min-h-0 overflow-auto bg-[#090d13] border border-slate-800/80 rounded-lg custom-scrollbar">${renderFsTable(st.content || '', ext === '.tsv' ? '\t' : ',')}</div>`;
    return;
  }

  const pre = document.createElement('pre');
  pre.className = 'fs-with-ln flex-1 min-h-0 overflow-auto bg-[#090d13] border border-slate-800/80 rounded-lg p-3 text-slate-200 font-mono text-[11px] leading-relaxed whitespace-pre-wrap select-text custom-scrollbar';
  bodyEl.innerHTML = '';
  bodyEl.appendChild(pre);
  renderFsCodePreview(pre, st.content || '', ext);
}

window.toggleFsArchiveEntryRaw = function() {
  if (!currentPreviewArchiveEntryState) return;
  currentPreviewArchiveEntryState.showRaw = !currentPreviewArchiveEntryState.showRaw;
  renderArchiveEntryBodyContent();
};

window.selectFsArchiveXlsxSheet = function(idx) {
  if (!currentPreviewArchiveEntryState) return;
  currentPreviewArchiveEntryState.sheetIdx = idx;
  renderArchiveEntryBodyContent();
};

window.previewFsArchiveEntry = async function(entryPath) {
  if (!currentPreviewPath || !entryPath) return;
  currentPreviewArchiveEntry = entryPath;
  const filterVal = (document.getElementById('fs-archive-filter-input') || {}).value || '';
  renderFsArchiveTreeList(filterVal);

  const titleEl = document.getElementById('fs-archive-entry-title');
  const iconEl = document.getElementById('fs-archive-entry-icon');
  const metaEl = document.getElementById('fs-archive-entry-meta');
  const dlBtn = document.getElementById('fs-archive-entry-dl-btn');
  const bodyEl = document.getElementById('fs-archive-entry-body');
  const baseName = entryPath.split('/').pop();
  if (titleEl) titleEl.innerText = entryPath;
  if (iconEl) iconEl.innerText = '⏳';
  if (dlBtn) dlBtn.classList.remove('hidden');
  if (bodyEl) bodyEl.innerHTML = '<div class="flex-1 flex items-center justify-center text-xs font-mono text-cyan-300">Loading archive entry...</div>';

  try {
    const res = await fetch(_archiveEntryUrl(entryPath));
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
    if (iconEl) iconEl.innerText = _archiveEntryIcon(data.kind, data.name || baseName);
    if (metaEl) metaEl.innerText = `${_formatFsBytes(data.size)}${data.truncated ? ' (truncated at 2 MB)' : ''}`;
    currentPreviewArchiveEntryState = { ...data, entry: entryPath, showRaw: false, sheetIdx: 0 };
    renderArchiveEntryBodyContent();
  } catch (err) {
    if (iconEl) iconEl.innerText = '⚠️';
    if (bodyEl) bodyEl.innerHTML = `<div class="flex-1 flex items-center justify-center text-xs font-mono text-rose-400">Error loading entry: ${escapeFsHtml(err.message || err)}</div>`;
  }
};

// Open the current artifact in a separate browser window for full-screen viewing
function openCurrentPreviewInNewWindow() {
  if (!currentPreviewPath) return;
  if (currentPreviewUrl) {
    window.open(currentPreviewUrl, '_blank', 'noopener');
    return;
  }
  // Text-like artifacts: render the already-prepared view into a standalone page
  const baseName = escapeFsHtml(currentPreviewPath.split('/').pop());
  const ext = (currentPreviewPath.split('.').pop() || '').toLowerCase();
  let bodyHtml;
  if (currentPreviewXlsxData && Array.isArray(currentPreviewXlsxData.sheets)) {
    const sheet = currentPreviewXlsxData.sheets[currentPreviewXlsxSheetIdx] || currentPreviewXlsxData.sheets[0];
    bodyHtml = sheet
      ? `<h3 style="margin:0 0 12px;color:#67e8f9;font-size:14px">${escapeFsHtml(sheet.name)} (${sheet.total_rows} rows × ${sheet.total_cols} cols)</h3>` + renderFsTableRows(sheet.rows, sheet.truncated ? sheet.total_rows : null)
      : '<div>Empty workbook</div>';
  } else if (ext === 'md' && typeof marked !== 'undefined') {
    bodyHtml = `<article style="max-width:900px;margin:0 auto;line-height:1.6">${marked.parse(currentPreviewContentText)}</article>`;
  } else if (ext === 'csv' || ext === 'tsv') {
    bodyHtml = renderFsTable(currentPreviewContentText, ext === 'tsv' ? '\t' : ',');
  } else {
    bodyHtml = `<pre style="white-space:pre-wrap;font-size:13px">${escapeFsHtml(currentPreviewContentText)}</pre>`;
  }
  const w = window.open('', '_blank');
  if (!w) { alert('Pop-up blocked: allow pop-ups to open the full-screen view.'); return; }
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${baseName}</title>
    <style>body{background:#0d1117;color:#e6edf3;font-family:ui-monospace,Menlo,monospace;margin:0;padding:20px}
    table{border-collapse:collapse}th,td{padding:4px 10px;border-bottom:1px solid #30363d;text-align:left;white-space:nowrap}
    th{position:sticky;top:0;background:#161b22;color:#67e8f9}a{color:#67e8f9}code{background:#161b22;padding:1px 4px;border-radius:4px}
    pre code{display:block;padding:10px;overflow:auto}</style></head><body>${bodyHtml}</body></html>`);
  w.document.close();
}

function closeFsQuickViewModal() {
  const modal = document.getElementById('modal-fs-quickview');
  const iframeEl = document.getElementById('fs-quickview-iframe');
  const pdfFrame = document.getElementById('fs-quickview-pdf-frame');
  if (iframeEl) iframeEl.src = 'about:blank';
  if (pdfFrame) pdfFrame.src = 'about:blank';
  if (modal) modal.classList.add('hidden');
  currentPreviewPath = '';
  currentPreviewContentText = '';
  currentPreviewUrl = '';
  currentPreviewXlsxData = null;
  currentPreviewXlsxSheetIdx = 0;
  currentPreviewArchiveData = null;
  currentPreviewArchiveEntry = '';
  currentPreviewArchiveEntryState = null;
}

function downloadCurrentPreviewFile() {
  if (currentPreviewPath) {
    downloadServerFile(currentPreviewPath);
  }
}

function copyCurrentPreviewContent() {
  if (!currentPreviewContentText) return;
  navigator.clipboard.writeText(currentPreviewContentText).then(() => {
    const lbl = document.getElementById('fs-quickview-copy-lbl');
    if (lbl) {
      const old = lbl.innerText;
      lbl.innerText = 'Copied!';
      setTimeout(() => { lbl.innerText = old; }, 1500);
    }
  });
}

// ==============================================================
// --- BL-CHAT-31 & BL-WAR-10: MULTI-FILE BATCH ATTACHMENTS & RICH MARKDOWN RENDERING ---
// ==============================================================
let activeChatAttachment = {
  direct: [],   // Array of up to 5 { filename, url, size, is_image, local_path }
  warroom: []
};

const MAX_UI_BATCH_FILES = 5;
const MAX_UI_FILE_SIZE = 100 * 1024 * 1024;
const MAX_UI_BATCH_TOTAL_SIZE = 250 * 1024 * 1024;

window.renderChatAttachmentRibbon = function(scope) {
  const prefix = scope === 'direct' ? 'chat' : 'warroom';
  const ribbon = document.getElementById(`${prefix}-attachment-ribbon`);
  if (!ribbon) return;

  const list = Array.isArray(activeChatAttachment[scope]) ? activeChatAttachment[scope] : [];
  if (list.length === 0) {
    ribbon.classList.add('hidden');
    ribbon.innerHTML = '';
    return;
  }

  ribbon.classList.remove('hidden');
  const totalKb = Math.max(1, Math.round(list.reduce((acc, f) => acc + (f.size || 0), 0) / 1024));
  const accentColor = scope === 'direct' ? 'emerald' : 'cyan';

  const chipsHtml = list.map((att, idx) => {
    const kb = Math.max(1, Math.round((att.size || 0) / 1024));
    const icon = att.is_image ? '🖼️' : '📄';
    const safeName = (att.filename || 'file').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `
      <div class="inline-flex items-center gap-1.5 bg-${accentColor}-950/85 border border-${accentColor}-700/80 rounded-lg px-2 py-0.5 text-[10.5px] text-${accentColor}-200 font-mono shadow-sm">
        <span>${icon}</span>
        <span class="max-w-[150px] truncate" title="${safeName} (${kb} KB)">${safeName}</span>
        <span class="text-[9px] text-${accentColor}-400/80">(${kb}KB)</span>
        <button type="button" onclick="removeChatAttachment('${scope}', ${idx})" class="text-rose-400 hover:text-rose-200 ml-0.5 font-bold cursor-pointer" title="Remove ${safeName}">✕</button>
      </div>
    `;
  }).join('');

  ribbon.innerHTML = `
    <span class="text-[10px] font-mono font-bold text-${accentColor}-400 shrink-0">📎 ${list.length}/${MAX_UI_BATCH_FILES} (${totalKb} KB):</span>
    ${chipsHtml}
    ${list.length > 1 ? `<button type="button" onclick="removeChatAttachment('${scope}')" class="text-[10px] font-mono text-slate-400 hover:text-rose-300 underline ml-1 cursor-pointer">Clear All</button>` : ''}
  `;
};

window.removeChatAttachment = function(scope, index = null) {
  if (!Array.isArray(activeChatAttachment[scope])) {
    activeChatAttachment[scope] = [];
  }
  if (index === null || index === undefined) {
    activeChatAttachment[scope] = [];
  } else {
    activeChatAttachment[scope].splice(index, 1);
  }
  renderChatAttachmentRibbon(scope);
};

async function uploadFilesForChatScope(fileList, scope) {
  if (!fileList || fileList.length === 0) return;
  if (!Array.isArray(activeChatAttachment[scope])) {
    activeChatAttachment[scope] = [];
  }

  const existing = activeChatAttachment[scope];
  const incoming = Array.from(fileList);

  if (existing.length + incoming.length > MAX_UI_BATCH_FILES) {
    alert(`Batch limit: You can attach at most ${MAX_UI_BATCH_FILES} files per message (currently ${existing.length} attached, selected ${incoming.length}).`);
    return;
  }

  let totalBytes = existing.reduce((sum, f) => sum + (f.size || 0), 0);
  for (const f of incoming) {
    if (f.size > MAX_UI_FILE_SIZE) {
      alert(`File "${f.name}" exceeds the 100 MB per-file limit.`);
      return;
    }
    totalBytes += f.size;
  }
  if (totalBytes > MAX_UI_BATCH_TOTAL_SIZE) {
    alert(`Total batch payload exceeds the 250 MB limit per message.`);
    return;
  }

  const formData = new FormData();
  incoming.forEach(f => formData.append('files', f));
  if (scope === 'warroom') {
    formData.append('room_id', activeWarRoomId || 'general');
  }

  const prefix = scope === 'direct' ? 'chat' : 'warroom';
  const ribbon = document.getElementById(`${prefix}-attachment-ribbon`);
  if (ribbon) {
    ribbon.classList.remove('hidden');
    ribbon.innerHTML = `<span class="text-[10.5px] font-mono text-cyan-300 animate-pulse">⏳ Uploading ${incoming.length} file(s)...</span>`;
  }

  try {
    const res = await fetch('/api/chat/upload', {
      method: 'POST',
      body: formData
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Upload failed');

    const uploadedBatch = Array.isArray(data.files) ? data.files : [data];
    activeChatAttachment[scope] = existing.concat(uploadedBatch).slice(0, MAX_UI_BATCH_FILES);
    renderChatAttachmentRibbon(scope);
  } catch (e) {
    alert('Upload failed: ' + e.message);
    renderChatAttachmentRibbon(scope);
  }
}

window.handleChatFileUpload = async function(event, scope) {
  const files = event.target.files;
  if (!files || files.length === 0) return;
  try {
    await uploadFilesForChatScope(files, scope);
  } finally {
    event.target.value = '';
  }
};

window.handleChatDragOver = function(event, scope) {
  event.preventDefault();
  event.stopPropagation();
  const zone = document.getElementById(scope === 'direct' ? 'chat-drop-zone' : 'warroom-drop-zone');
  if (zone) zone.classList.add('ring-1', 'ring-cyan-500/80', 'bg-slate-900/60');
};

window.handleChatDragLeave = function(event, scope) {
  event.preventDefault();
  event.stopPropagation();
  const zone = document.getElementById(scope === 'direct' ? 'chat-drop-zone' : 'warroom-drop-zone');
  if (zone) zone.classList.remove('ring-1', 'ring-cyan-500/80', 'bg-slate-900/60');
};

window.handleChatFileDrop = async function(event, scope) {
  event.preventDefault();
  event.stopPropagation();
  const zone = document.getElementById(scope === 'direct' ? 'chat-drop-zone' : 'warroom-drop-zone');
  if (zone) zone.classList.remove('ring-1', 'ring-cyan-500/80', 'bg-slate-900/60');
  const dt = event.dataTransfer;
  if (dt && dt.files && dt.files.length > 0) {
    await uploadFilesForChatScope(dt.files, scope);
  }
};

function formatBatchAttachmentsMarkdown(attList) {
  if (!Array.isArray(attList) || attList.length === 0) return '';
  if (attList.length === 1) {
    const att = attList[0];
    return att.is_image
      ? `\n\n![${att.filename}](${att.url})\n📎 **Image File**: [${att.filename}](${att.url}) (Local: \`${att.local_path}\`)`
      : `\n\n📎 **Attachment**: [${att.filename}](${att.url}) (Local: \`${att.local_path}\`)`;
  }
  const lines = attList.map((att, idx) => {
    const kb = Math.max(1, Math.round((att.size || 0) / 1024));
    if (att.is_image) {
      return `${idx + 1}. 🖼️ **[${att.filename}](${att.url})** (${kb} KB) — Local: \`${att.local_path}\`\n   ![${att.filename}](${att.url})`;
    }
    return `${idx + 1}. 📄 **[${att.filename}](${att.url})** (${kb} KB) — Local: \`${att.local_path}\``;
  });
  return `\n\n📎 **Attached Files (${attList.length})**:\n` + lines.join('\n');
}
