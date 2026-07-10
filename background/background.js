import { encryptData, decryptData } from '../utils/crypto.js';
import { hashPin, verifyPin } from '../utils/pin.js';
import { heuristicFill, heuristicFillWithGaps } from '../utils/heuristic.js';

// ===================== STORAGE KEYS =====================

const KEYS = {
  PROFILES:  'fill_a_form_profiles',
  ACTIVE:    'fill_a_form_active_profile',
  SETTINGS:  'fill_a_form_settings',
  HISTORY:   'fill_a_form_history',
  BOARDS:    'fill_a_form_boards',
  TEMPLATES: 'fill_a_form_templates',
};
const HISTORY_LIMIT = 100;

// ===================== IN-MEMORY CACHE =====================
// Invalidated per-key on every write; prevents redundant storage reads
// within the same service worker lifetime.

const cache = new Map();

async function read(key) {
  if (cache.has(key)) return cache.get(key);
  const result = await chrome.storage.local.get(key);
  const value = result[key] ?? null;
  cache.set(key, value);
  return value;
}

async function write(key, value) {
  cache.set(key, value);
  await chrome.storage.local.set({ [key]: value });
}

// ===================== COMMAND LISTENER =====================

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'quick-paste') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) chrome.tabs.sendMessage(tab.id, { type: 'SHOW_QUICK_PASTE' }).catch(() => {});
});

// ===================== MESSAGE ROUTER =====================

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message).then(sendResponse).catch(err => sendResponse({ error: err.message }));
  return true;
});

async function handleMessage(msg) {
  switch (msg.type) {
    case 'INIT_DATA':          return initData();           // bulk load for popup open
    case 'GET_PROFILES':       return getProfiles();
    case 'GET_ACTIVE_PROFILE': return getActiveProfile();
    case 'SET_ACTIVE_PROFILE': return setActiveProfile(msg.profileId);
    case 'SAVE_PROFILE':       return saveProfile(msg.profile);
    case 'DELETE_PROFILE':     return deleteProfile(msg.profileId);
    case 'VERIFY_PIN':         return verifyProfilePin(msg.profileId, msg.pin);
    case 'SET_PROFILE_PIN':    return setProfilePin(msg.profileId, msg.pin);
    case 'REMOVE_PROFILE_PIN': return removeProfilePin(msg.profileId, msg.pin);
    case 'GET_BOARDS':         return getBoards();
    case 'SAVE_BOARD':         return saveBoard(msg.board);
    case 'DELETE_BOARD':       return deleteBoard(msg.boardId);
    case 'GET_TEMPLATES':      return getTemplates();
    case 'SAVE_TEMPLATE':      return saveTemplate(msg.template);
    case 'DELETE_TEMPLATE':    return deleteTemplate(msg.templateId);
    case 'GET_SETTINGS':       return getSettings();
    case 'SAVE_SETTINGS':      return saveSettings(msg.settings);
    case 'AUTOFILL_REQUEST':   return handleAutofillRequest(msg);
    case 'GET_HISTORY':        return getHistory();
    case 'CLEAR_HISTORY':      return clearHistory();
    case 'EXPORT_BACKUP':
    case 'EXPORT_DATA':        return exportBackup();
    case 'IMPORT_BACKUP':
    case 'IMPORT_DATA':        return importBackup(msg.data);
    case 'SYNC_TO_BACKEND':
    case 'BACKEND_SYNC':       return syncToBackend();
    case 'HASH_PIN':           return { hash: await hashPin(msg.pin) };
    case 'ATS_FILL':           return atsGetProfileData(msg.profileId);
    case 'PARSE_RESUME':       return parseResume(msg.fileData, msg.mimeType, msg.apiKey);
    default: throw new Error(`Unknown message: ${msg.type}`);
  }
}

// ===================== BULK INIT (single round-trip for popup) =====================

async function initData() {
  const [{ profiles }, { profile, profileId }, { settings }, { boards }, { templates }, { history }] = await Promise.all([
    getProfiles(), getActiveProfile(), getSettings(), getBoards(), getTemplates(), getHistory(),
  ]);
  return { profiles, profile, profileId, settings, boards, templates, history };
}

// ===================== PROFILES =====================

async function getProfiles() {
  const enc = (await read(KEYS.PROFILES)) || [];
  const profiles = await Promise.all(enc.map(async p => ({
    id:        p.id,
    name:      p.name,
    boardId:   p.boardId || null,
    hasPin:    !!p.pinHash,
    pinHash:   p.pinHash || null,
    createdAt: p.createdAt,
    data:      JSON.parse(await decryptData(p.encrypted)),
  })));
  return { profiles };
}

async function getActiveProfile() {
  const { profiles } = await getProfiles();
  if (!profiles.length) return { profile: null, profileId: null };
  const activeId = (await read(KEYS.ACTIVE)) || profiles[0].id;
  const profile = profiles.find(p => p.id === activeId) || profiles[0];
  return { profile, profileId: profile.id };
}

async function setActiveProfile(profileId) {
  await write(KEYS.ACTIVE, profileId);
  return { success: true };
}

async function saveProfile(profile) {
  const enc = (await read(KEYS.PROFILES)) || [];
  const encrypted = await encryptData(JSON.stringify(profile.data || {}));
  const existing = enc.find(p => p.id === profile.id);
  const entry = {
    id:        profile.id || crypto.randomUUID(),
    name:      profile.name || 'Profile',
    boardId:   profile.boardId || null,
    pinHash:   profile.pinHash ?? existing?.pinHash ?? null,
    createdAt: profile.createdAt || new Date().toISOString(),
    encrypted,
  };
  const idx = enc.findIndex(p => p.id === entry.id);
  if (idx >= 0) enc[idx] = entry; else enc.push(entry);
  await write(KEYS.PROFILES, enc);
  if (!(await read(KEYS.ACTIVE))) await write(KEYS.ACTIVE, entry.id);
  const { profiles } = await getProfiles();
  return { success: true, profileId: entry.id, profiles };
}

async function deleteProfile(profileId) {
  const enc = ((await read(KEYS.PROFILES)) || []).filter(p => p.id !== profileId);
  await write(KEYS.PROFILES, enc);
  if ((await read(KEYS.ACTIVE)) === profileId && enc.length) await write(KEYS.ACTIVE, enc[0].id);
  const { profiles } = await getProfiles();
  return { success: true, profiles };
}

async function setProfilePin(profileId, pin) {
  const enc = (await read(KEYS.PROFILES)) || [];
  const p = enc.find(p => p.id === profileId);
  if (!p) throw new Error('Profile not found');
  p.pinHash = await hashPin(pin);
  await write(KEYS.PROFILES, enc);
  return { success: true };
}

async function removeProfilePin(profileId, pin) {
  const enc = (await read(KEYS.PROFILES)) || [];
  const p = enc.find(p => p.id === profileId);
  if (!p) throw new Error('Profile not found');
  if (p.pinHash && !(await verifyPin(pin, p.pinHash))) throw new Error('WRONG_PIN');
  p.pinHash = null;
  await write(KEYS.PROFILES, enc);
  return { success: true };
}

async function verifyProfilePin(profileId, pin) {
  const enc = (await read(KEYS.PROFILES)) || [];
  const p = enc.find(p => p.id === profileId);
  if (!p?.pinHash) return { valid: true };
  return { valid: await verifyPin(pin, p.pinHash) };
}

// ===================== BOARDS =====================

async function getBoards() {
  return { boards: (await read(KEYS.BOARDS)) || [] };
}

async function saveBoard(board) {
  const boards = (await read(KEYS.BOARDS)) || [];
  const entry = { id: board.id || crypto.randomUUID(), name: board.name, color: board.color || '#4f46e5', createdAt: board.createdAt || new Date().toISOString() };
  const idx = boards.findIndex(b => b.id === entry.id);
  if (idx >= 0) boards[idx] = entry; else boards.push(entry);
  await write(KEYS.BOARDS, boards);
  return { success: true, boardId: entry.id, boards };
}

async function deleteBoard(boardId) {
  await write(KEYS.BOARDS, ((await read(KEYS.BOARDS)) || []).filter(b => b.id !== boardId));
  const enc = (await read(KEYS.PROFILES)) || [];
  enc.forEach(p => { if (p.boardId === boardId) p.boardId = null; });
  await write(KEYS.PROFILES, enc);
  return { success: true };
}

// ===================== TEMPLATES =====================

async function getTemplates() {
  return { templates: (await read(KEYS.TEMPLATES)) || [] };
}

async function saveTemplate(template) {
  const templates = (await read(KEYS.TEMPLATES)) || [];
  const entry = {
    id:            template.id || crypto.randomUUID(),
    name:          template.name || 'Template',
    description:   template.description || '',
    urlPattern:    template.urlPattern || '',
    profileId:     template.profileId || null,
    fieldMappings: template.fieldMappings || {},
    createdAt:     template.createdAt || new Date().toISOString(),
  };
  const idx = templates.findIndex(t => t.id === entry.id);
  if (idx >= 0) templates[idx] = entry; else templates.push(entry);
  await write(KEYS.TEMPLATES, templates);
  return { success: true, templateId: entry.id, templates };
}

async function deleteTemplate(templateId) {
  const templates = ((await read(KEYS.TEMPLATES)) || []).filter(t => t.id !== templateId);
  await write(KEYS.TEMPLATES, templates);
  return { success: true, templates };
}

// ===================== SETTINGS =====================

async function getSettings() {
  return { settings: (await read(KEYS.SETTINGS)) || defaultSettings() };
}

async function saveSettings(settings) {
  await write(KEYS.SETTINGS, settings);
  return { success: true, settings };
}

function defaultSettings() {
  return {
    apiKey: '', backendUrl: '', backendToken: '',
    fillMode: 'heuristic',   // 'heuristic' | 'ai' | 'hybrid'
    autoFillOnLoad: false,
    fillCount: 0, freeLimit: 20, isPremium: false,
  };
}

// ===================== AUTOFILL =====================

async function handleAutofillRequest({ fields, pageContext, url, pageTitle, profileId: reqProfileId }) {
  const [{ settings }, { templates }] = await Promise.all([getSettings(), getTemplates()]);

  if (!settings.isPremium && settings.fillCount >= settings.freeLimit) throw new Error('LIMIT_REACHED');

  // resolve profile
  let profile;
  if (reqProfileId) {
    const { profiles } = await getProfiles();
    profile = profiles.find(p => p.id === reqProfileId);
  }
  if (!profile) ({ profile } = await getActiveProfile());
  if (!profile) throw new Error('NO_PROFILE');

  const profileData = await resolveDynamicFields(profile.data);

  // template takes highest priority (free, instant)
  const template = url ? templates.find(t => urlMatches(t.urlPattern, url)) : null;
  if (template && Object.keys(template.fieldMappings).length > 0) {
    const suggestions = applyTemplate(template.fieldMappings, fields, profileData);
    await finalize(settings, profile, url, pageTitle, suggestions, fields.length, template.name);
    return { suggestions, method: 'template' };
  }

  // fill mode
  const mode = settings.fillMode || 'heuristic';
  let suggestions = {};
  let method = mode;

  if (mode === 'heuristic') {
    suggestions = heuristicFill(fields, profileData);
  } else if (mode === 'ai') {
    if (!settings.apiKey) throw new Error('NO_API_KEY');
    suggestions = await callClaude(fields, profileData, pageContext, settings.apiKey);
  } else if (mode === 'hybrid') {
    const { suggestions: hSuggestions, unmatched } = heuristicFillWithGaps(fields, profileData);
    suggestions = hSuggestions;
    if (unmatched.length > 0 && settings.apiKey) {
      const aiSuggestions = await callClaude(unmatched, profileData, pageContext, settings.apiKey);
      Object.assign(suggestions, aiSuggestions);
    }
  }

  await finalize(settings, profile, url, pageTitle, suggestions, fields.length, null);
  return { suggestions, method };
}

async function finalize(settings, profile, url, pageTitle, suggestions, totalFields, templateName) {
  await Promise.all([
    saveSettings({ ...settings, fillCount: settings.fillCount + 1 }),
    appendHistory({
      url: url || '', pageTitle: pageTitle || '',
      profileId: profile.id, profileName: profile.name,
      fieldsFilled: Object.keys(suggestions).length,
      totalFields,
      usedTemplate: templateName || null,
    }),
  ]);
}

function urlMatches(pattern, url) {
  if (!pattern) return false;
  try {
    const re = new RegExp('^' + pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
    return re.test(url) || re.test(new URL(url).hostname);
  } catch { return url.includes(pattern); }
}

function applyTemplate(mappings, fields, profileData) {
  const result = {};
  fields.forEach(f => {
    const key = Object.keys(mappings).find(k =>
      k.toLowerCase() === (f.label || '').toLowerCase() ||
      k.toLowerCase() === (f.name || '').toLowerCase() ||
      k === f.id
    );
    if (key) result[f.id] = String(mappings[key]).replace(/\{\{(\w+)\}\}/g, (_, k) => profileData[k] || '');
  });
  return result;
}

async function resolveDynamicFields(data) {
  const resolved = { ...data };
  const dynamic = Object.entries(data).filter(([, v]) => v?.type === 'dynamic');
  await Promise.all(dynamic.map(async ([key, def]) => {
    try {
      const html = await fetch(def.fetchUrl).then(r => r.text());
      const doc = new DOMParser().parseFromString(html, 'text/html');
      resolved[key] = doc.querySelector(def.selector)?.textContent?.trim() || '';
    } catch { resolved[key] = ''; }
  }));
  return resolved;
}

async function callClaude(fields, profileData, pageContext, apiKey) {
  const fieldList = fields.map(f => `id:"${f.id}" label:"${f.label}" type:"${f.type}" name:"${f.name}"`).join('\n');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001', max_tokens: 1024,
      messages: [{ role: 'user', content: `Form autofill assistant. Map profile to fields.\nPage: ${pageContext}\nProfile: ${JSON.stringify(profileData)}\nFields:\n${fieldList}\nJSON only:` }],
    }),
  });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error?.message || `API ${res.status}`); }
  const data = await res.json();
  return parseJSON(data.content[0].text, fields);
}

function parseJSON(text, fields) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return {};
  try {
    const parsed = JSON.parse(match[0]);
    const valid = new Set(fields.map(f => f.id));
    return Object.fromEntries(Object.entries(parsed).filter(([k]) => valid.has(k)));
  } catch { return {}; }
}

// ===================== ATS FILL =====================

async function atsGetProfileData(profileId) {
  let profile;
  if (profileId) {
    const { profiles } = await getProfiles();
    profile = profiles.find(p => p.id === profileId);
  }
  if (!profile) ({ profile } = await getActiveProfile());
  if (!profile) throw new Error('NO_PROFILE');
  const data = await resolveDynamicFields(profile.data);
  return { profileData: data };
}

// ===================== RESUME PARSER =====================

async function parseResume(fileData, mimeType, apiKey) {
  if (!apiKey) throw new Error('NO_API_KEY');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-beta': 'pdfs-2024-09-25' },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001', max_tokens: 1024,
      messages: [{
        role: 'user',
        content: [
          { type: 'document', source: { type: 'base64', media_type: mimeType, data: fileData } },
          { type: 'text', text: 'Extract the applicant\'s information from this resume. Return ONLY a JSON object with these fields (omit fields not found): firstName, lastName, fullName, email, phone, address1, address2, city, state, zip, country, linkedin, company, occupation, nationality. No explanation, JSON only.' },
        ],
      }],
    }),
  });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error?.message || `API ${res.status}`); }
  const data = await res.json();
  const text = data.content[0]?.text || '';
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Could not parse resume data');
  return { parsed: JSON.parse(match[0]) };
}

// ===================== HISTORY =====================

async function getHistory() {
  return { history: (await read(KEYS.HISTORY)) || [] };
}

async function clearHistory() {
  await write(KEYS.HISTORY, []);
  return { success: true };
}

async function appendHistory(entry) {
  const history = (await read(KEYS.HISTORY)) || [];
  history.unshift({ id: crypto.randomUUID(), timestamp: new Date().toISOString(), ...entry });
  if (history.length > HISTORY_LIMIT) history.length = HISTORY_LIMIT;
  await write(KEYS.HISTORY, history);
}

// ===================== BACKUP =====================

async function exportBackup() {
  const [{ profiles }, { boards }, { templates }, { history }] = await Promise.all([
    getProfiles(), getBoards(), getTemplates(), getHistory(),
  ]);
  return {
    backup: {
      version: '1.1', exportedAt: new Date().toISOString(),
      profiles: profiles.map(({ pinHash, ...p }) => p),
      boards, templates, history,
    }
  };
}

async function importBackup(data) {
  if (!data?.version || !Array.isArray(data.profiles)) throw new Error('Invalid backup file');
  if (data.boards)    await write(KEYS.BOARDS, data.boards);
  if (data.templates) await write(KEYS.TEMPLATES, data.templates);
  if (data.history)   await write(KEYS.HISTORY, data.history);
  const enc = await Promise.all(data.profiles.map(async p => ({
    id: p.id, name: p.name, boardId: p.boardId || null, pinHash: null,
    createdAt: p.createdAt, encrypted: await encryptData(JSON.stringify(p.data || {})),
  })));
  await write(KEYS.PROFILES, enc);
  if (enc.length) await write(KEYS.ACTIVE, enc[0].id);
  const [{ profiles }, { boards }, { templates }, { history }] = await Promise.all([
    getProfiles(), getBoards(), getTemplates(), getHistory(),
  ]);
  return { success: true, profileCount: enc.length, profiles, boards, templates, history };
}

// ===================== BACKEND SYNC =====================

async function syncToBackend() {
  const { settings } = await getSettings();
  if (!settings.backendUrl || !settings.backendToken) throw new Error('NO_BACKEND_CONFIG');
  const [{ profiles }, { history }] = await Promise.all([getProfiles(), getHistory()]);
  const res = await fetch(`${settings.backendUrl}/api/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.backendToken}` },
    body: JSON.stringify({ profiles: profiles.map(p => ({ id: p.id, name: p.name, data: p.data, createdAt: p.createdAt })), history }),
  });
  if (!res.ok) throw new Error(`Sync failed: ${res.status}`);
  return { success: true };
}
