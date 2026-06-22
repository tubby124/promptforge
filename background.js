import { fetchPackIfStale, getActivePack } from './lib/packs.js';
import { buildSystemPrompt, resolveMode } from './lib/optimizer.js';
import { getActiveProfile } from './lib/profiles.js';
import { pushHistory } from './lib/history.js';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_MODEL = 'anthropic/claude-haiku-4-5';
const PACK_REFRESH_ALARM = 'pf-pack-refresh';

// Per-million-token prices (USD). Used for the live cost stamp in the popup.
// Approximations as of 2026-06; can be overridden via pack.model_pricing.
const MODEL_PRICING = {
  'anthropic/claude-haiku-4-5': { in: 1.0, out: 5.0 },
  'anthropic/claude-sonnet-4-6': { in: 3.0, out: 15.0 },
  'openai/gpt-4o-mini': { in: 0.15, out: 0.6 },
  'openai/gpt-4.1': { in: 2.0, out: 8.0 },
  'google/gemini-2.5-flash': { in: 0.3, out: 2.5 },
  'meta-llama/llama-4-maverick': { in: 0.5, out: 0.75 },
};

chrome.runtime.onInstalled.addListener(async (details) => {
  await chrome.alarms.create(PACK_REFRESH_ALARM, { periodInMinutes: 360 });
  if (details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('options.html?firstRun=1') });
  }
  fetchPackIfStale().catch((e) => console.warn('[PromptForge] pack fetch on install failed:', e));
});

chrome.runtime.onStartup.addListener(() => {
  fetchPackIfStale().catch((e) => console.warn('[PromptForge] pack fetch on startup failed:', e));
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === PACK_REFRESH_ALARM) {
    fetchPackIfStale(true).catch((e) => console.warn('[PromptForge] alarm pack fetch failed:', e));
  }
});

chrome.commands.onCommand.addListener((command) => {
  if (command === 'open-optimizer') openOptimizer();
});

function openOptimizer() {
  if (chrome.action?.openPopup) {
    chrome.action.openPopup().catch(() => openStandalonePopup());
  } else {
    openStandalonePopup();
  }
}

function openStandalonePopup() {
  chrome.windows.create({
    url: chrome.runtime.getURL('popup.html?standalone=1'),
    type: 'popup',
    width: 740,
    height: 820,
  });
}

// Non-streaming message channel — kept for pack refresh + inject only.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'PF_REFRESH_PACK') {
    fetchPackIfStale(true)
      .then((r) => sendResponse({ ok: true, ...r }))
      .catch((err) => sendResponse({ ok: false, error: err.message || String(err) }));
    return true;
  }
  if (msg?.type === 'PF_INJECT_INTO_TAB') {
    injectIntoActiveTab(msg.payload?.text || '')
      .then((r) => sendResponse({ ok: true, ...r }))
      .catch((err) => sendResponse({ ok: false, error: err.message || String(err) }));
    return true;
  }
  if (msg?.type === 'PF_OPEN_POPUP') {
    openStandalonePopup();
    sendResponse({ ok: true });
    return false;
  }
});

// Streaming optimize channel — uses long-lived Port to push deltas to the popup.
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'PF_OPTIMIZE') return;
  let aborted = false;
  port.onDisconnect.addListener(() => { aborted = true; });
  port.onMessage.addListener(async (msg) => {
    if (msg?.type !== 'start') return;
    try {
      await streamOptimize(msg.payload, port, () => aborted);
    } catch (e) {
      safePost(port, { type: 'error', error: e.message || String(e) });
    }
  });
});

function safePost(port, msg) {
  try { port.postMessage(msg); } catch { /* port closed */ }
}

async function streamOptimize(payload, port, isAborted) {
  const { rawInput, profileId, category, targetAi, mode, images = [] } = payload || {};
  const { openrouterKey, model } = await chrome.storage.local.get(['openrouterKey', 'model']);
  if (!openrouterKey) throw new Error('Set your OpenRouter API key in PromptForge Settings first.');

  const pack = await getActivePack();
  const profile = await getActiveProfile(profileId);
  const system = buildSystemPrompt({ profile, category, pack, targetAi, mode });
  const effectiveMode = resolveMode({ mode, category });
  const usedModel = model || DEFAULT_MODEL;

  // Sharpen mode = short output. Deep mode = longer structured prompt.
  const maxTokens = effectiveMode === 'sharpen' ? 600 : 1500;

  const body = {
    model: usedModel,
    temperature: 0.4,
    max_tokens: maxTokens,
    stream: true,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: buildUserMessageContent(rawInput, images) },
    ],
  };

  const { text, usage, finalModel } = await fetchWithBackoff({
    url: OPENROUTER_URL,
    key: openrouterKey,
    body,
    port,
    isAborted,
  });

  if (isAborted()) return;
  if (!text) throw new Error('Empty response from model');

  const costUsd = estimateCost(finalModel || usedModel, usage, pack);
  const result = {
    optimized: text,
    raw: formatRawForHistory(rawInput, images),
    usage,
    costUsd,
    model: finalModel || usedModel,
    packVersion: pack?.version || 'bundled',
    profileId: profile?.id || 'default',
    profileName: profile?.name || 'default',
    category,
    targetAi,
    imageCount: images.length,
    imageNames: images.map((img) => img.name).filter(Boolean),
    mode: effectiveMode,
    systemPrompt: system,
  };

  pushHistory(result).catch((e) => console.warn('[PromptForge] history save failed:', e));
  safePost(port, { type: 'done', result });
}

function buildUserMessageContent(rawInput, images) {
  const validImages = normalizeImages(images);
  if (!validImages.length) return rawInput;

  const text = [
    rawInput,
    '',
    `Attached reference image${validImages.length === 1 ? '' : 's'}:`,
    ...validImages.map((img, i) => `${i + 1}. ${img.name || 'image'} (${img.width || '?'}x${img.height || '?'}). Use this visual reference when optimizing the prompt.`),
  ].join('\n');

  return [
    { type: 'text', text },
    ...validImages.map((img) => ({
      type: 'image_url',
      image_url: { url: img.dataUrl },
    })),
  ];
}

function normalizeImages(images) {
  if (!Array.isArray(images)) return [];
  return images
    .filter((img) => img?.dataUrl && /^data:image\/(png|jpeg|jpg|webp);base64,/.test(img.dataUrl))
    .slice(0, 3);
}

function formatRawForHistory(rawInput, images) {
  const validImages = normalizeImages(images);
  if (!validImages.length) return rawInput;
  const names = validImages.map((img) => `- ${img.name || 'image'} (${img.width || '?'}x${img.height || '?'})`);
  return `${rawInput}\n\nAttached reference images:\n${names.join('\n')}`;
}

async function fetchWithBackoff({ url, key, body, port, isAborted }) {
  const headers = {
    'Authorization': `Bearer ${key}`,
    'Content-Type': 'application/json',
    'HTTP-Referer': 'https://github.com/tubby124/promptforge',
    'X-Title': 'PromptForge',
    'Accept': 'text/event-stream',
  };

  let attempt = 0;
  const maxAttempts = 3;
  let lastErr;

  while (attempt < maxAttempts) {
    attempt++;
    if (isAborted()) throw new Error('aborted');
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });

    if (res.status === 429 || res.status === 503) {
      const retryAfter = parseRetryAfter(res.headers.get('retry-after'));
      const delayMs = retryAfter ?? Math.min(2000 * attempt, 8000);
      lastErr = new Error(`OpenRouter ${res.status} — rate limited`);
      try { await res.body?.cancel(); } catch {}
      if (attempt >= maxAttempts) break;
      safePost(port, { type: 'retry', delayMs });
      await sleep(delayMs);
      continue;
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`OpenRouter ${res.status}: ${shortenError(errText)}`);
    }

    if (!res.body) throw new Error('No response body');

    return await readSseStream(res, port, isAborted);
  }
  throw lastErr || new Error('Request failed after retries');
}

function parseRetryAfter(h) {
  if (!h) return null;
  const n = Number(h);
  if (!Number.isNaN(n) && n > 0) return Math.min(n * 1000, 10000);
  const d = new Date(h);
  if (!Number.isNaN(d.getTime())) {
    const ms = d.getTime() - Date.now();
    if (ms > 0) return Math.min(ms, 10000);
  }
  return null;
}

function shortenError(text) {
  // OpenRouter error bodies are typically JSON with a `error.message` field.
  try {
    const parsed = JSON.parse(text);
    const msg = parsed?.error?.message || parsed?.message;
    if (msg) return String(msg).slice(0, 300);
  } catch {}
  return text.slice(0, 300);
}

async function readSseStream(res, port, isAborted) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let full = '';
  let usage = null;
  let finalModel = null;

  while (true) {
    if (isAborted()) {
      try { await reader.cancel(); } catch {}
      break;
    }
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    // SSE frames are separated by blank lines.
    let idx;
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      const frame = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      for (const line of frame.split('\n')) {
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        try {
          const parsed = JSON.parse(data);
          if (parsed.model) finalModel = parsed.model;
          if (parsed.usage) usage = parsed.usage;
          const delta = parsed.choices?.[0]?.delta?.content
            ?? parsed.choices?.[0]?.message?.content
            ?? '';
          if (delta) {
            full += delta;
            safePost(port, { type: 'delta', delta });
          }
        } catch {
          // Some providers send `: keepalive` comments — ignore.
        }
      }
    }
  }

  return { text: full.trim(), usage, finalModel };
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function estimateCost(model, usage, pack) {
  if (!usage) return null;
  const overrides = pack?.model_pricing || {};
  const p = overrides[model] || MODEL_PRICING[model] || MODEL_PRICING[DEFAULT_MODEL];
  if (!p) return null;
  const inTok = usage.prompt_tokens || usage.input_tokens || 0;
  const outTok = usage.completion_tokens || usage.output_tokens || 0;
  return ((inTok * p.in) + (outTok * p.out)) / 1_000_000;
}

async function injectIntoActiveTab(text) {
  let tab;
  const queryActiveWin = await chrome.tabs.query({ active: true, currentWindow: true });
  if (queryActiveWin[0] && !queryActiveWin[0].url?.startsWith('chrome-extension://')) {
    tab = queryActiveWin[0];
  } else {
    const wins = await chrome.windows.getAll({ populate: true, windowTypes: ['normal'] });
    for (const w of wins) {
      const t = w.tabs?.find((x) => x.active);
      if (t && !t.url?.startsWith('chrome-extension://')) {
        tab = t;
        break;
      }
    }
  }
  if (!tab?.id) throw new Error('No active tab');

  const adapter = await getAdapterForTab(tab);
  const result = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: injectIntoFocusedTextarea,
    args: [text, adapter],
  });
  return { injected: result?.[0]?.result === true, tabId: tab.id, url: tab.url };
}

async function getAdapterForTab(tab) {
  try {
    const pack = await getActivePack();
    const adapters = pack?.site_adapters || {};
    const host = tab?.url ? new URL(tab.url).hostname : '';
    if (!host) return null;
    if (adapters[host]) return adapters[host];
    // try suffix match (e.g. "chat.openai.com" matches "openai.com")
    for (const key of Object.keys(adapters)) {
      if (host === key || host.endsWith('.' + key) || key.endsWith(host)) return adapters[key];
    }
  } catch {}
  return null;
}

// Runs in the page context. Tries pack-supplied selectors first, then a generic
// fallback chain. Keep this function dependency-free — it's serialized over the
// extension boundary.
function injectIntoFocusedTextarea(text, adapter) {
  const setTextarea = (el) => {
    el.focus();
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  };
  const setContentEditable = (el) => {
    el.focus();
    try { document.execCommand('selectAll', false, null); } catch {}
    try {
      if (document.execCommand('insertText', false, text)) return true;
    } catch {}
    el.innerHTML = '';
    const p = document.createElement('p');
    p.textContent = text;
    el.appendChild(p);
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    return true;
  };

  const selectorChain = [];
  if (adapter?.textareaSelectors) selectorChain.push(...adapter.textareaSelectors.map((s) => ({ s, kind: 'ta' })));
  if (adapter?.editableSelectors) selectorChain.push(...adapter.editableSelectors.map((s) => ({ s, kind: 'ce' })));
  // generic fallbacks
  selectorChain.push(
    { s: '#prompt-textarea', kind: 'auto' },
    { s: 'textarea[data-id="root"]', kind: 'auto' },
    { s: 'div[contenteditable="true"][role="textbox"]', kind: 'ce' },
    { s: 'div.ProseMirror', kind: 'ce' },
    { s: '[contenteditable="true"]', kind: 'ce' },
    { s: 'textarea', kind: 'ta' },
  );

  for (const { s, kind } of selectorChain) {
    try {
      const el = document.querySelector(s);
      if (!el) continue;
      if (kind === 'ta' && el.tagName === 'TEXTAREA') { if (setTextarea(el)) return true; }
      else if (kind === 'ce' && el.isContentEditable) { if (setContentEditable(el)) return true; }
      else if (kind === 'auto') {
        if (el.tagName === 'TEXTAREA') { if (setTextarea(el)) return true; }
        else if (el.isContentEditable) { if (setContentEditable(el)) return true; }
      }
    } catch { /* try next */ }
  }
  return false;
}
