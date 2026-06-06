// Profile CRUD backed by chrome.storage.local.
// Schema fields: { id, name, role, business, audience, voice, mustInclude, mustAvoid,
//                  signature, notes, customSystemPrompt, createdAt }

const KEY = 'profiles';
const ACTIVE_KEY = 'activeProfileId';

const DEFAULT_PROFILE = {
  id: 'default',
  name: 'Default',
  role: '',
  business: '',
  audience: '',
  voice: 'direct, clear, no fluff',
  mustInclude: '',
  mustAvoid: 'corporate jargon, hype words like leverage / utilize / synergy / unlock',
  signature: '',
  notes: '',
  customSystemPrompt: '',
  createdAt: Date.now(),
};

export async function listProfiles() {
  const { [KEY]: profiles } = await chrome.storage.local.get(KEY);
  if (!profiles || !Array.isArray(profiles) || profiles.length === 0) {
    await chrome.storage.local.set({ [KEY]: [DEFAULT_PROFILE], [ACTIVE_KEY]: DEFAULT_PROFILE.id });
    return [DEFAULT_PROFILE];
  }
  return profiles.map((p) => ({ customSystemPrompt: '', ...p }));
}

export async function getActiveProfile(explicitId) {
  const profiles = await listProfiles();
  if (explicitId) {
    const found = profiles.find((p) => p.id === explicitId);
    if (found) return found;
  }
  const { [ACTIVE_KEY]: activeId } = await chrome.storage.local.get(ACTIVE_KEY);
  return profiles.find((p) => p.id === activeId) || profiles[0];
}

export async function setActiveProfile(id) {
  await chrome.storage.local.set({ [ACTIVE_KEY]: id });
}

export async function upsertProfile(profile) {
  const profiles = await listProfiles();
  const idx = profiles.findIndex((p) => p.id === profile.id);
  if (idx >= 0) {
    profiles[idx] = { ...profiles[idx], ...profile };
  } else {
    profiles.push({ ...DEFAULT_PROFILE, ...profile, id: profile.id || makeId(profile.name), createdAt: Date.now() });
  }
  await chrome.storage.local.set({ [KEY]: profiles });
  return profiles;
}

export async function deleteProfile(id) {
  const profiles = await listProfiles();
  const filtered = profiles.filter((p) => p.id !== id);
  if (filtered.length === 0) filtered.push(DEFAULT_PROFILE);
  await chrome.storage.local.set({ [KEY]: filtered });
  const { [ACTIVE_KEY]: activeId } = await chrome.storage.local.get(ACTIVE_KEY);
  if (activeId === id) await setActiveProfile(filtered[0].id);
  return filtered;
}

function makeId(name) {
  const base = (name || 'profile').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32);
  return `${base || 'profile'}-${Math.random().toString(36).slice(2, 8)}`;
}

// A profile is "ready" when at least one of the core voice fields is filled.
// The bundled default profile is intentionally not ready until the user edits it.
export function isProfileReady(profile) {
  if (!profile) return false;
  return Boolean(
    (profile.role && profile.role.trim()) ||
    (profile.business && profile.business.trim()) ||
    (profile.audience && profile.audience.trim()) ||
    (profile.notes && profile.notes.trim()) ||
    (profile.customSystemPrompt && profile.customSystemPrompt.trim())
  );
}
