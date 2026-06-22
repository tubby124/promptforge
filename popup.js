import { listProfiles, getActiveProfile, setActiveProfile, isProfileReady } from './lib/profiles.js';
import { categorize, detectTargetAi } from './lib/categorize.js';
import { listHistory, clearHistory } from './lib/history.js';

const $ = (id) => document.getElementById(id);

const els = {
  profile: $('pf-profile'),
  category: $('pf-category'),
  target: $('pf-target'),
  raw: $('pf-raw'),
  imageInput: $('pf-image-input'),
  attachImage: $('pf-attach-image'),
  imageList: $('pf-image-list'),
  detected: $('pf-detected'),
  optimize: $('pf-optimize'),
  clear: $('pf-clear'),
  outputSection: $('pf-output-section'),
  result: $('pf-result'),
  original: $('pf-original'),
  meta: $('pf-meta'),
  copy: $('pf-copy'),
  inject: $('pf-inject'),
  regenerate: $('pf-regenerate'),
  status: $('pf-status'),
  openOptions: $('pf-open-options'),
  toggleHistory: $('pf-toggle-history'),
  clearHistoryBtn: $('pf-clear-history'),
  historyPanel: $('pf-history-panel'),
  historyList: $('pf-history-list'),
  tabOptimized: $('pf-tab-optimized'),
  tabOriginal: $('pf-tab-original'),
  modeSharpen: $('pf-mode-sharpen'),
  modeDeep: $('pf-mode-deep'),
  setupWarning: $('pf-setup-warning'),
  debugSystem: $('pf-debug-system'),
};

let detectedCategory = 'general';
let detectedTarget = 'generic';
let mode = 'sharpen';
let lastRequest = null;
let lastResult = null;
let activePort = null;
let attachedImages = [];

const MAX_IMAGES = 3;
const MAX_IMAGE_DIMENSION = 1600;
const JPEG_QUALITY = 0.86;

document.addEventListener('DOMContentLoaded', init);

async function init() {
  if (new URLSearchParams(location.search).get('standalone')) {
    document.body.classList.add('pf-standalone');
    document.documentElement.classList.add('pf-standalone');
  }

  const profiles = await listProfiles();
  const active = await getActiveProfile();
  renderProfiles(profiles, active.id);

  const { pfMode } = await chrome.storage.local.get('pfMode');
  if (pfMode === 'deep' || pfMode === 'sharpen') mode = pfMode;
  setModeUi(mode);

  const tab = await getActiveTab();
  detectedTarget = detectTargetAi(tab?.url ? new URL(tab.url).hostname : '');

  els.raw.addEventListener('input', refreshDetected);
  els.attachImage.addEventListener('click', () => els.imageInput.click());
  els.imageInput.addEventListener('change', onImageInputChange);
  els.profile.addEventListener('change', onProfileChange);
  els.category.addEventListener('change', refreshDetected);
  els.target.addEventListener('change', refreshDetected);
  els.optimize.addEventListener('click', onOptimize);
  els.clear.addEventListener('click', onClear);
  els.copy.addEventListener('click', onCopy);
  els.inject.addEventListener('click', onInject);
  els.regenerate.addEventListener('click', onRegenerate);
  els.openOptions.addEventListener('click', () => chrome.runtime.openOptionsPage());
  els.toggleHistory.addEventListener('click', toggleHistory);
  els.clearHistoryBtn.addEventListener('click', onClearHistory);
  els.tabOptimized.addEventListener('click', () => switchTab('optimized'));
  els.tabOriginal.addEventListener('click', () => switchTab('original'));
  els.modeSharpen.addEventListener('click', () => onModeChange('sharpen'));
  els.modeDeep.addEventListener('click', () => onModeChange('deep'));

  els.raw.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      onOptimize();
    }
  });

  const seed = await chrome.storage.local.get('pendingPrefill');
  if (seed?.pendingPrefill) {
    els.raw.value = seed.pendingPrefill;
    await chrome.storage.local.remove('pendingPrefill');
    refreshDetected();
  }

  await refreshReadiness();
  refreshDetected();
  els.raw.focus();
}

function renderProfiles(profiles, activeId) {
  els.profile.innerHTML = '';
  for (const p of profiles) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name || p.id;
    if (p.id === activeId) opt.selected = true;
    els.profile.appendChild(opt);
  }
}

async function onProfileChange() {
  await setActiveProfile(els.profile.value);
  await refreshReadiness();
}

async function onModeChange(next) {
  mode = next;
  setModeUi(next);
  await chrome.storage.local.set({ pfMode: next });
  refreshDetected();
}

function setModeUi(active) {
  const isSharpen = active === 'sharpen';
  els.modeSharpen.classList.toggle('pf-mode-active', isSharpen);
  els.modeDeep.classList.toggle('pf-mode-active', !isSharpen);
  els.modeSharpen.setAttribute('aria-selected', String(isSharpen));
  els.modeDeep.setAttribute('aria-selected', String(!isSharpen));
}

function lockModeForImageGen(isImage) {
  // Image-gen always uses deep regardless of toggle — show the lock visually.
  els.modeSharpen.classList.toggle('pf-mode-locked', isImage);
  if (isImage) {
    els.modeSharpen.title = 'Image work always uses Deep (structured visual tokens are the whole point).';
    els.modeDeep.title = 'Image work always uses Deep.';
  } else {
    els.modeSharpen.title = 'Light pass — preserves voice and length. Default.';
    els.modeDeep.title = 'Full Lyra-4D heavyweight pass. Structured sections, role, output spec.';
  }
}

function refreshDetected() {
  detectedCategory = categorize(els.raw.value);
  const catSel = els.category.value;
  const effectiveCat = catSel === 'auto'
    ? (attachedImages.length ? normalizeImageCategory(detectedCategory) : detectedCategory)
    : catSel;
  const effectiveTgt = els.target.value === 'auto' ? detectedTarget : els.target.value;
  const isImage = effectiveCat === 'image-gen' || effectiveCat === 'image-edit';
  lockModeForImageGen(isImage);
  const effectiveMode = isImage ? 'deep (forced — image-gen)' : mode;
  const imageStamp = attachedImages.length ? ` · ${attachedImages.length} image${attachedImages.length === 1 ? '' : 's'}` : '';
  els.detected.textContent = els.raw.value.trim()
    ? `Detected: ${detectedCategory} · target: ${effectiveTgt} · using: ${effectiveCat} · mode: ${effectiveMode}${imageStamp}`
    : `Auto-detect ready · target: ${effectiveTgt} · mode: ${effectiveMode}${imageStamp}`;
}

function normalizeImageCategory(category) {
  return category === 'email' ? 'email' : (category === 'image-gen' ? 'image-edit' : 'image-edit');
}

async function refreshReadiness() {
  const { openrouterKey } = await chrome.storage.local.get('openrouterKey');
  const activeProfile = await getActiveProfile();
  const profileReady = isProfileReady(activeProfile);
  const ready = !!openrouterKey && profileReady;
  els.optimize.disabled = !ready;
  els.regenerate.disabled = !ready;

  if (!openrouterKey) {
    showSetupWarning('Set your OpenRouter API key in <a id="pf-warn-link">Settings</a> before optimizing.');
  } else if (!profileReady) {
    showSetupWarning('Active profile needs at least a role or business filled in. <a id="pf-warn-link">Edit profile</a>.');
  } else {
    hideSetupWarning();
  }
}

function showSetupWarning(html) {
  els.setupWarning.innerHTML = html;
  els.setupWarning.hidden = false;
  const link = $('pf-warn-link');
  if (link) link.addEventListener('click', () => chrome.runtime.openOptionsPage());
}

function hideSetupWarning() {
  els.setupWarning.hidden = true;
  els.setupWarning.innerHTML = '';
}

async function onOptimize() {
  const rawInput = els.raw.value.trim();
  if (!rawInput) {
    setStatus(attachedImages.length ? 'Tell me what to change about the image first.' : 'Paste something to optimize first.', 'warn');
    return;
  }
  const catSel = els.category.value;
  const category = catSel === 'auto'
    ? (attachedImages.length ? normalizeImageCategory(detectedCategory) : detectedCategory)
    : catSel;
  const targetAi = els.target.value === 'auto' ? detectedTarget : els.target.value;

  lastRequest = {
    rawInput,
    profileId: els.profile.value,
    category,
    targetAi,
    mode,
    images: attachedImages.map(({ id: _id, previewUrl: _previewUrl, ...rest }) => rest),
  };
  await runOptimize(lastRequest, 'Optimizing…');
}

async function onRegenerate() {
  if (!lastRequest) return onOptimize();
  await runOptimize(lastRequest, 'Regenerating…');
}

async function runOptimize(payload, statusMsg) {
  setOptimizingState(true);
  setStatus(statusMsg);
  els.outputSection.hidden = false;
  els.result.value = '';
  els.original.value = formatOriginalInput(payload);
  els.meta.innerHTML = '';
  els.debugSystem.textContent = '';
  switchTab('optimized');

  if (activePort) {
    try { activePort.disconnect(); } catch {}
    activePort = null;
  }

  try {
    const port = chrome.runtime.connect({ name: 'PF_OPTIMIZE' });
    activePort = port;
    let streamed = '';
    let completed = false;

    await new Promise((resolve, reject) => {
      const onMsg = (msg) => {
        if (msg.type === 'delta') {
          streamed += msg.delta || '';
          els.result.value = streamed;
        } else if (msg.type === 'done') {
          lastResult = msg.result;
          renderResult(msg.result);
          setStatus('Done.', 'ok');
          completed = true;
          resolve();
        } else if (msg.type === 'error') {
          reject(new Error(msg.error || 'Unknown error'));
        } else if (msg.type === 'retry') {
          setStatus(`Rate limited. Retrying in ${msg.delayMs}ms…`, 'warn');
        }
      };
      port.onMessage.addListener(onMsg);
      port.onDisconnect.addListener(() => {
        if (!completed) {
          reject(new Error(chrome.runtime.lastError?.message || 'Stream disconnected'));
        }
      });
      port.postMessage({ type: 'start', payload });
    });
  } catch (e) {
    setStatus(e.message || 'Failed', 'err');
  } finally {
    activePort = null;
    setOptimizingState(false);
  }
}

function setOptimizingState(busy) {
  els.optimize.disabled = busy;
  els.regenerate.disabled = busy;
  els.optimize.textContent = busy ? 'Optimizing…' : 'Optimize ⚡';
  if (!busy) refreshReadiness();
}

function renderResult(result) {
  els.result.value = result.optimized;
  els.original.value = result.raw || '';
  els.meta.innerHTML = formatMetaHtml(result);
  els.debugSystem.textContent = result.systemPrompt || '(system prompt not captured)';
  els.outputSection.hidden = false;
  switchTab('optimized');
}

function formatMetaHtml(r) {
  const lines = [];
  const m = (r.model || '').replace(/^anthropic\//, '').replace(/^openai\//, '').replace(/^google\//, '').replace(/^meta-llama\//, '');
  const img = r.imageCount ? ` · ${r.imageCount} img` : '';
  lines.push(`${m} · ${r.mode || 'sharpen'} · ${r.category}${r.targetAi ? ' → ' + r.targetAi : ''}${img}`);
  const tok = r.usage?.total_tokens || (r.usage?.prompt_tokens || 0) + (r.usage?.completion_tokens || 0);
  const cost = r.costUsd != null ? `$${r.costUsd.toFixed(4)}` : '—';
  lines.push(`${tok || '?'} tok · ${cost} · pack ${r.packVersion}`);
  return lines.map(escapeHtml).join('<br>');
}

function switchTab(tab) {
  const opt = tab === 'optimized';
  els.tabOptimized.classList.toggle('pf-tab-active', opt);
  els.tabOriginal.classList.toggle('pf-tab-active', !opt);
  els.tabOptimized.setAttribute('aria-selected', String(opt));
  els.tabOriginal.setAttribute('aria-selected', String(!opt));
  els.result.hidden = !opt;
  els.original.hidden = opt;
}

function onClear() {
  els.raw.value = '';
  attachedImages = [];
  renderAttachedImages();
  els.result.value = '';
  els.original.value = '';
  els.outputSection.hidden = true;
  els.meta.innerHTML = '';
  els.debugSystem.textContent = '';
  lastRequest = null;
  lastResult = null;
  setStatus('');
  refreshDetected();
  els.raw.focus();
}

async function onCopy() {
  const text = els.tabOptimized.classList.contains('pf-tab-active') ? els.result.value : els.original.value;
  try {
    await navigator.clipboard.writeText(text);
    setStatus('Copied to clipboard.', 'ok');
  } catch {
    setStatus('Copy failed — select and copy manually.', 'err');
  }
}

async function onInject() {
  if (!els.result.value) return;
  setStatus('Injecting into active tab…');
  const res = await chrome.runtime.sendMessage({
    type: 'PF_INJECT_INTO_TAB',
    payload: { text: els.result.value },
  });
  if (res?.ok && res.injected) {
    setStatus('Injected. Switch to the tab to send.', 'ok');
  } else {
    setStatus('Could not find a textarea on the active tab. Use Copy instead.', 'warn');
  }
}

async function toggleHistory() {
  const showing = !els.historyPanel.hidden;
  if (showing) {
    els.historyPanel.hidden = true;
    return;
  }
  await renderHistory();
  els.historyPanel.hidden = false;
}

async function renderHistory() {
  const items = await listHistory();
  els.historyList.innerHTML = '';
  if (!items.length) {
    const empty = document.createElement('li');
    empty.className = 'pf-history-empty';
    empty.textContent = 'No history yet — optimize something first.';
    els.historyList.appendChild(empty);
    return;
  }
  for (const item of items) {
    const li = document.createElement('li');
    li.className = 'pf-history-item';
    const when = relativeTime(item.ts);
    const snippet = (item.raw || '').replace(/\s+/g, ' ').slice(0, 80);
    li.innerHTML = `
      <div class="pf-history-snippet">${escapeHtml(snippet || '(empty)')}</div>
      <div class="pf-history-meta">${when} · ${escapeHtml(item.category || '?')} · ${escapeHtml(item.mode || 'sharpen')} · ${escapeHtml(item.profileName || '?')}</div>
    `;
    li.addEventListener('click', () => loadHistoryEntry(item));
    els.historyList.appendChild(li);
  }
}

function loadHistoryEntry(item) {
  els.raw.value = item.raw || '';
  attachedImages = [];
  renderAttachedImages();
  els.category.value = 'auto';
  els.target.value = 'auto';
  if (item.mode === 'sharpen' || item.mode === 'deep') {
    mode = item.mode;
    setModeUi(mode);
  }
  refreshDetected();
  renderResult(item);
  els.historyPanel.hidden = true;
  setStatus('Loaded from history.', 'ok');
}

async function onClearHistory() {
  if (!confirm('Clear all history?')) return;
  await clearHistory();
  await renderHistory();
}

function relativeTime(ts) {
  if (!ts) return '?';
  const diff = Date.now() - ts;
  const m = 60 * 1000, h = 60 * m, d = 24 * h;
  if (diff < m) return 'just now';
  if (diff < h) return `${Math.floor(diff / m)}m ago`;
  if (diff < d) return `${Math.floor(diff / h)}h ago`;
  if (diff < 7 * d) return `${Math.floor(diff / d)}d ago`;
  return new Date(ts).toLocaleDateString();
}

function setStatus(msg, kind = '') {
  els.status.textContent = msg || '';
  els.status.className = `pf-status ${kind}`;
}

async function onImageInputChange(ev) {
  const files = Array.from(ev.target.files || []);
  ev.target.value = '';
  if (!files.length) return;

  const room = MAX_IMAGES - attachedImages.length;
  if (room <= 0) {
    setStatus(`Max ${MAX_IMAGES} images per prompt.`, 'warn');
    return;
  }

  setStatus('Preparing image…');
  const selected = files.slice(0, room);
  let added = 0;
  for (const file of selected) {
    try {
      const image = await prepareImage(file);
      attachedImages.push(image);
      added++;
    } catch (e) {
      setStatus(e.message || `Could not read ${file.name}.`, 'err');
      break;
    }
  }
  renderAttachedImages();
  refreshDetected();
  if (files.length > selected.length) {
    setStatus(`Added ${added}; max ${MAX_IMAGES} images per prompt.`, 'warn');
  } else {
    setStatus(added ? `Added ${added} image${added === 1 ? '' : 's'}.` : '', added ? 'ok' : '');
  }
}

async function prepareImage(file) {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
    throw new Error(`${file.name} is not a supported image type.`);
  }

  const bitmap = await loadBitmap(file);
  const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(bitmap.naturalWidth, bitmap.naturalHeight));
  const width = Math.max(1, Math.round(bitmap.naturalWidth * scale));
  const height = Math.max(1, Math.round(bitmap.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0, width, height);
  URL.revokeObjectURL(bitmap.src);

  const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
  const approxBytes = Math.round((dataUrl.length - 'data:image/jpeg;base64,'.length) * 0.75);
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: file.name,
    type: 'image/jpeg',
    originalType: file.type,
    originalSize: file.size,
    size: approxBytes,
    width,
    height,
    dataUrl,
    previewUrl: dataUrl,
  };
}

function loadBitmap(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`Could not read ${file.name}.`));
    };
    img.src = url;
  });
}

function renderAttachedImages() {
  els.imageList.innerHTML = '';
  els.attachImage.disabled = attachedImages.length >= MAX_IMAGES;
  for (const image of attachedImages) {
    const item = document.createElement('div');
    item.className = 'pf-image-chip';
    item.innerHTML = `
      <img src="${image.previewUrl}" alt="">
      <span>${escapeHtml(image.name)}<small>${image.width}×${image.height}</small></span>
      <button type="button" aria-label="Remove ${escapeHtml(image.name)}" data-id="${image.id}">×</button>
    `;
    item.querySelector('button').addEventListener('click', () => {
      attachedImages = attachedImages.filter((x) => x.id !== image.id);
      renderAttachedImages();
      refreshDetected();
      setStatus('Image removed.', 'ok');
    });
    els.imageList.appendChild(item);
  }
}

function formatOriginalInput(payload) {
  const names = (payload.images || []).map((img) => `- ${img.name} (${img.width}x${img.height})`);
  return names.length ? `${payload.rawInput}\n\nAttached images:\n${names.join('\n')}` : payload.rawInput;
}

async function getActiveTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && !tab.url?.startsWith('chrome-extension://')) return tab;
    const wins = await chrome.windows.getAll({ populate: true, windowTypes: ['normal'] });
    for (const w of wins) {
      const t = w.tabs?.find((x) => x.active);
      if (t && !t.url?.startsWith('chrome-extension://')) return t;
    }
  } catch { /* fall through */ }
  return null;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
