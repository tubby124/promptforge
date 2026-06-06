// OTA pack fetcher. Pulls a versioned JSON style pack from a user-configurable URL
// (default: GitHub Pages). Caches locally with a soft TTL. Falls back to bundled pack.

const PACK_KEY = 'cachedPack';
const META_KEY = 'cachedPackMeta'; // { fetchedAt, etag, url, version }
const DEFAULT_PACK_URL = 'https://tubby124.github.io/promptforge-packs/v1.json';
const SOFT_TTL_MS = 6 * 60 * 60 * 1000; // 6h
const HARD_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30d

export async function getActivePack() {
  const { [PACK_KEY]: cached } = await chrome.storage.local.get(PACK_KEY);
  if (cached && typeof cached === 'object') return cached;
  return await loadBundledPack();
}

export async function loadBundledPack() {
  try {
    const url = chrome.runtime.getURL('packs/default-pack.json');
    const res = await fetch(url);
    if (!res.ok) throw new Error(`bundled pack ${res.status}`);
    return await res.json();
  } catch (e) {
    console.warn('[PromptForge] failed to load bundled pack:', e);
    return null;
  }
}

export async function fetchPackIfStale(force = false) {
  const { packUrl } = await chrome.storage.local.get('packUrl');
  const url = packUrl || DEFAULT_PACK_URL;
  const { [META_KEY]: meta } = await chrome.storage.local.get(META_KEY);
  const now = Date.now();
  if (!force && meta?.fetchedAt && (now - meta.fetchedAt) < SOFT_TTL_MS) return { skipped: true };

  try {
    const headers = {};
    if (meta?.etag) headers['If-None-Match'] = meta.etag;
    const res = await fetch(url, { headers, cache: 'no-cache' });
    if (res.status === 304) {
      await chrome.storage.local.set({ [META_KEY]: { ...meta, fetchedAt: now } });
      return { notModified: true };
    }
    if (!res.ok) throw new Error(`pack fetch ${res.status}`);
    const pack = await res.json();
    if (!validatePack(pack)) throw new Error('invalid pack schema');
    const etag = res.headers.get('etag') || null;
    await chrome.storage.local.set({
      [PACK_KEY]: pack,
      [META_KEY]: { fetchedAt: now, etag, url, version: pack.version || 'unknown' },
    });
    return { updated: true, version: pack.version };
  } catch (e) {
    console.warn('[PromptForge] pack fetch failed:', e);
    if (meta?.fetchedAt && (now - meta.fetchedAt) < HARD_TTL_MS) {
      return { failedSoft: true, error: e.message };
    }
    return { failedHard: true, error: e.message };
  }
}

function validatePack(p) {
  if (!p || typeof p !== 'object') return false;
  if (!p.version || typeof p.version !== 'string') return false;
  return true;
}

export async function getPackMeta() {
  const { [META_KEY]: meta } = await chrome.storage.local.get(META_KEY);
  return meta || null;
}
