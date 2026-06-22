// History of optimizations. Stored in chrome.storage.local. Cap at 20 entries.
// Entry shape:
//   { id, ts, raw, optimized, category, targetAi, profileId, profileName, model, usage, continuedFrom }

const KEY = 'history';
const MAX = 20;

export async function listHistory() {
  const { [KEY]: h } = await chrome.storage.local.get(KEY);
  return Array.isArray(h) ? h : [];
}

export async function pushHistory(entry) {
  const h = await listHistory();
  const next = [{ id: makeId(), ts: Date.now(), ...entry }, ...h].slice(0, MAX);
  await chrome.storage.local.set({ [KEY]: next });
  return next;
}

export async function getHistoryEntry(id) {
  const h = await listHistory();
  return h.find((e) => e.id === id) || null;
}

export async function clearHistory() {
  await chrome.storage.local.set({ [KEY]: [] });
}

function makeId() {
  return `h-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}
