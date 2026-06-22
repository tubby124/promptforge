import { listProfiles, upsertProfile, deleteProfile, getActiveProfile, setActiveProfile } from './lib/profiles.js';
import { fetchPackIfStale, getPackMeta, getActivePack } from './lib/packs.js';

const $ = (id) => document.getElementById(id);

let editing = null;
let cachedTemplates = {};

document.addEventListener('DOMContentLoaded', init);

async function init() {
  const params = new URLSearchParams(location.search);
  if (params.get('firstRun')) $('firstRunCard').hidden = false;

  const { openrouterKey, model, packUrl } = await chrome.storage.local.get(['openrouterKey', 'model', 'packUrl']);
  if (openrouterKey) $('key').value = openrouterKey;
  if (model) $('model').value = model;
  if (packUrl) $('packUrl').value = packUrl;

  $('saveKey').addEventListener('click', onSaveKey);
  $('testKey').addEventListener('click', onTestKey);
  $('newProfile').addEventListener('click', () => openEditor(null));
  $('saveProfile').addEventListener('click', onSaveProfile);
  $('cancelEdit').addEventListener('click', closeEditor);
  $('deleteProfile').addEventListener('click', onDeleteProfile);
  $('savePackUrl').addEventListener('click', onSavePackUrl);
  $('refreshPack').addEventListener('click', onRefreshPack);
  $('exportProfiles').addEventListener('click', onExportProfiles);
  $('importProfiles').addEventListener('click', () => $('importFile').click());
  $('importFile').addEventListener('change', onImportFile);
  $('p-template').addEventListener('change', onTemplateChange);

  await loadTemplates();
  await renderProfiles();
  await renderPackInfo();
}

async function loadTemplates() {
  const pack = await getActivePack();
  const profileTemplates = isPlainObject(pack?.profile_templates) ? pack.profile_templates : {};
  const roleLibrary = isPlainObject(pack?.role_library) ? pack.role_library : {};
  cachedTemplates = {};
  const sel = $('p-template');
  // Reset to just the "blank" sentinel
  sel.innerHTML = '<option value="">— blank —</option>';

  for (const [key, value] of Object.entries(profileTemplates)) {
    cachedTemplates[key] = { type: 'profile', value };
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = value?.name || humanizeKey(key);
    opt.title = String(value?.notes || value?.customSystemPrompt || value?.role || '').slice(0, 240);
    sel.appendChild(opt);
  }

  for (const [key, value] of Object.entries(roleLibrary)) {
    if (cachedTemplates[key]) continue;
    cachedTemplates[key] = { type: 'role', value };
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = humanizeKey(key);
    opt.title = String(value || '').slice(0, 240);
    sel.appendChild(opt);
  }
}

function humanizeKey(k) {
  return String(k).replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function onTemplateChange() {
  const key = $('p-template').value;
  if (!key) return;
  const template = normalizeTemplate(cachedTemplates[key], key);
  if (!template) return;

  if (template.type === 'profile') {
    applyProfileTemplate(template.value, key);
  } else {
    applyRoleTemplate(template.value, key);
  }
  setBanner(`Template "${humanizeKey(key)}" applied. Edit any field to customize.`, 'ok');
}

function normalizeTemplate(raw, key) {
  if (!raw) return null;
  if (typeof raw === 'string') return { type: 'role', value: raw };
  if (raw.type === 'profile' && isPlainObject(raw.value)) return raw;
  if (raw.type === 'role') return raw;
  if (isPlainObject(raw)) return { type: 'profile', value: raw };
  console.warn('Unsupported template:', key, raw);
  return null;
}

function applyProfileTemplate(t, key) {
  setIfBlank('p-name', t.name || humanizeKey(key));
  setIfBlank('p-role', t.role);
  setIfBlank('p-business', t.business);
  setIfBlank('p-audience', t.audience);
  setIfBlank('p-voice', t.voice);
  setIfBlank('p-must', t.mustInclude);
  setIfBlank('p-avoid', t.mustAvoid);
  setIfBlank('p-sig', t.signature);
  setIfBlank('p-notes', t.notes);
  setIfBlank('p-custom', t.customSystemPrompt);
}

function applyRoleTemplate(description, key) {
  // Pre-fill role + voice + notes from the template. Don't clobber non-empty fields.
  setIfBlank('p-name', humanizeKey(key));
  setIfBlank('p-role', humanizeKey(key));
  setIfBlank('p-voice', String(description).split('. ').slice(0, 2).join('. '));
  setIfBlank('p-notes', description);
}

function setIfBlank(id, value) {
  if (value == null || value === '') return;
  const el = $(id);
  if (el && !el.value.trim()) el.value = String(value);
}

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

async function onSaveKey() {
  const key = $('key').value.trim();
  const model = $('model').value;
  if (!key) return setBanner('Paste a key first.', 'warn');
  setBanner('Saving + verifying model…');
  const verified = await verifyModelAvailable(key, model);
  if (!verified.ok) {
    return setBanner(verified.message, verified.kind || 'err');
  }
  await chrome.storage.local.set({ openrouterKey: key, model });
  setBanner(verified.message, 'ok');
}

async function verifyModelAvailable(key, model) {
  try {
    const res = await fetch('https://openrouter.ai/api/v1/models', {
      headers: { 'Authorization': `Bearer ${key}` },
    });
    if (!res.ok) {
      return { ok: false, kind: 'err', message: `Could not list models (${res.status}). Key may be invalid.` };
    }
    const data = await res.json();
    const ids = (data?.data || []).map((m) => m.id);
    if (!ids.length) return { ok: true, message: 'Saved. (Model list empty, skipped check.)' };
    if (ids.includes(model)) return { ok: true, message: `Saved. Model "${model}" verified.` };
    // Try a close-match guess so the user sees what's available.
    const stem = model.split('/')[1]?.split('-')[0] || model;
    const candidates = ids.filter((id) => id.toLowerCase().includes(stem.toLowerCase())).slice(0, 4);
    const hint = candidates.length ? ` Closest matches: ${candidates.join(', ')}.` : '';
    return {
      ok: false,
      kind: 'warn',
      message: `Saved key, but model "${model}" is not in OpenRouter's catalogue right now — first optimize call will fail.${hint}`,
    };
  } catch (e) {
    return { ok: false, kind: 'warn', message: `Saved key, model check failed: ${e.message}` };
  }
}

async function onTestKey() {
  const key = $('key').value.trim();
  const model = $('model').value;
  if (!key) return setBanner('Paste a key first.', 'warn');
  setBanner('Testing…');
  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/tubby124/promptforge',
        'X-Title': 'PromptForge',
      },
      body: JSON.stringify({
        model,
        max_tokens: 30,
        messages: [{ role: 'user', content: 'Reply with exactly: ok' }],
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`${res.status}: ${text.slice(0, 300)}`);
    }
    const data = await res.json();
    const out = data?.choices?.[0]?.message?.content?.trim();
    setBanner(`OK · model returned: "${out?.slice(0, 80) || '(empty)'}"`, 'ok');
  } catch (e) {
    setBanner(`Failed: ${e.message}`, 'err');
  }
}

async function renderProfiles() {
  const profiles = await listProfiles();
  const active = await getActiveProfile();
  const list = $('profileList');
  list.innerHTML = '';
  for (const p of profiles) {
    const row = document.createElement('div');
    row.className = 'profile-row';
    row.innerHTML = `
      <div class="name">${escapeHtml(p.name || p.id)} ${p.id === active.id ? '<span class="meta">· active</span>' : ''}</div>
      <button data-act="activate" data-id="${p.id}">Make active</button>
      <button data-act="edit" data-id="${p.id}">Edit</button>
    `;
    list.appendChild(row);
  }
  list.querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      const act = btn.dataset.act;
      if (act === 'activate') {
        await setActiveProfile(id);
        await renderProfiles();
      } else if (act === 'edit') {
        const target = (await listProfiles()).find((x) => x.id === id);
        openEditor(target);
      }
    });
  });
}

function openEditor(profile) {
  editing = profile ? { ...profile } : { id: '', name: '' };
  $('editorTitle').textContent = profile ? `Edit profile · ${profile.name}` : 'New profile';
  $('p-template').value = '';
  $('p-name').value = editing.name || '';
  $('p-role').value = editing.role || '';
  $('p-business').value = editing.business || '';
  $('p-audience').value = editing.audience || '';
  $('p-voice').value = editing.voice || '';
  $('p-must').value = editing.mustInclude || '';
  $('p-avoid').value = editing.mustAvoid || '';
  $('p-sig').value = editing.signature || '';
  $('p-notes').value = editing.notes || '';
  $('p-custom').value = editing.customSystemPrompt || '';
  $('deleteProfile').hidden = !profile || profile.id === 'default';
  $('profileEditor').hidden = false;
  $('p-name').focus();
  $('profileEditor').scrollIntoView({ behavior: 'smooth' });
}

function closeEditor() {
  editing = null;
  $('profileEditor').hidden = true;
}

async function onSaveProfile() {
  if (!editing) return;
  const next = {
    id: editing.id,
    name: $('p-name').value.trim(),
    role: $('p-role').value.trim(),
    business: $('p-business').value.trim(),
    audience: $('p-audience').value.trim(),
    voice: $('p-voice').value.trim(),
    mustInclude: $('p-must').value.trim(),
    mustAvoid: $('p-avoid').value.trim(),
    signature: $('p-sig').value.trim(),
    notes: $('p-notes').value.trim(),
    customSystemPrompt: $('p-custom').value.trim(),
  };
  if (!next.name) return setBanner('Profile needs a name.', 'warn');
  await upsertProfile(next);
  await renderProfiles();
  closeEditor();
  setBanner('Profile saved.', 'ok');
}

async function onDeleteProfile() {
  if (!editing?.id) return;
  if (!confirm(`Delete profile "${editing.name}"?`)) return;
  await deleteProfile(editing.id);
  await renderProfiles();
  closeEditor();
  setBanner('Deleted.', 'ok');
}

async function onSavePackUrl() {
  const url = $('packUrl').value.trim();
  await chrome.storage.local.set({ packUrl: url || undefined });
  setBanner('Pack URL saved. Click "Refresh now" to fetch.', 'ok');
}

async function onRefreshPack() {
  setBanner('Refreshing pack…');
  try {
    const r = await chrome.runtime.sendMessage({ type: 'PF_REFRESH_PACK' });
    if (!r?.ok) throw new Error(r?.error || 'unknown');
    await renderPackInfo();
    await loadTemplates();
    setBanner('Pack refreshed.', 'ok');
  } catch (e) {
    setBanner(`Refresh failed: ${e.message}`, 'err');
  }
}

async function renderPackInfo() {
  const meta = await getPackMeta();
  $('packVersion').textContent = meta?.version
    ? `${meta.version} (fetched ${new Date(meta.fetchedAt).toLocaleString()})`
    : 'using bundled pack — no remote fetch yet';
}

async function onExportProfiles() {
  const profiles = await listProfiles();
  const blob = new Blob([JSON.stringify({ format: 'promptforge-profiles@1', exportedAt: new Date().toISOString(), profiles }, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `promptforge-profiles-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  setBanner(`Exported ${profiles.length} profile(s).`, 'ok');
}

async function onImportFile(ev) {
  const file = ev.target.files?.[0];
  ev.target.value = '';
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    const incoming = Array.isArray(data?.profiles) ? data.profiles : (Array.isArray(data) ? data : null);
    if (!incoming) throw new Error('No "profiles" array found in file.');
    let added = 0;
    for (const raw of incoming) {
      if (!raw?.name) continue;
      // Strip incoming id to avoid collisions; let upsertProfile generate a fresh one.
      const { id: _drop, ...rest } = raw;
      await upsertProfile({ ...rest, id: '' });
      added++;
    }
    await renderProfiles();
    setBanner(`Imported ${added} profile(s).`, 'ok');
  } catch (e) {
    setBanner(`Import failed: ${e.message}`, 'err');
  }
}

function setBanner(msg, kind = '') {
  let bar = document.getElementById('pf-banner');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'pf-banner';
    bar.style.cssText = 'position:fixed;top:12px;right:12px;padding:10px 16px;border-radius:8px;font-size:13px;font-weight:600;z-index:1000;box-shadow:0 4px 24px rgba(0,0,0,0.3);max-width:520px;';
    document.body.appendChild(bar);
  }
  const colors = { ok: ['#54d68a', '#0b3a1f'], warn: ['#ffb547', '#3a2a0b'], err: ['#ff6b6b', '#3a0b0b'], '': ['#6ea8ff', '#0b1a3a'] };
  const [bg, fg] = colors[kind] || colors[''];
  bar.style.background = bg; bar.style.color = fg;
  bar.textContent = msg;
  clearTimeout(setBanner._t);
  setBanner._t = setTimeout(() => { bar.remove(); }, 5000);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
