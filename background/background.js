import { encryptData, decryptData } from '../utils/crypto.js';
import { hashPin, verifyPin } from '../utils/pin.js';

const PROFILES_KEY  = 'fill_a_form_profiles';
const ACTIVE_KEY    = 'fill_a_form_active_profile';
const SETTINGS_KEY  = 'fill_a_form_settings';
const HISTORY_KEY   = 'fill_a_form_history';
const BOARDS_KEY    = 'fill_a_form_boards';
const TEMPLATES_KEY = 'fill_a_form_templates';
const HISTORY_LIMIT = 100;

// ===================== COMMAND LISTENER (global shortcut) =====================

chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'quick-paste') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      chrome.tabs.sendMessage(tab.id, { type: 'SHOW_QUICK_PASTE' }).catch(() => {});
    }
  }
});

// ===================== MESSAGE ROUTER =====================

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message).then(sendResponse).catch(err => sendResponse({ error: err.message }));
  return true;
});

async function handleMessage(message) {
  switch (message.type) {
    // profiles
    case 'GET_PROFILES':           return getProfiles();
    case 'GET_ACTIVE_PROFILE':     return getActiveProfile();
    case 'SET_ACTIVE_PROFILE':     return setActiveProfile(message.profileId);
    case 'SAVE_PROFILE':           return saveProfile(message.profile);
    case 'DELETE_PROFILE':         return deleteProfile(message.profileId);
    case 'VERIFY_PIN':             return verifyProfilePin(message.profileId, message.pin);
    case 'SET_PROFILE_PIN':        return setProfilePin(message.profileId, message.pin);
    case 'REMOVE_PROFILE_PIN':     return removeProfilePin(message.profileId, message.pin);
    // boards
    case 'GET_BOARDS':             return getBoards();
    case 'SAVE_BOARD':             return saveBoard(message.board);
    case 'DELETE_BOARD':           return deleteBoard(message.boardId);
    // templates
    case 'GET_TEMPLATES':          return getTemplates();
    case 'SAVE_TEMPLATE':          return saveTemplate(message.template);
    case 'DELETE_TEMPLATE':        return deleteTemplate(message.templateId);
    // settings
    case 'GET_SETTINGS':           return getSettings();
    case 'SAVE_SETTINGS':          return saveSettings(message.settings);
    // autofill
    case 'AUTOFILL_REQUEST':       return handleAutofillRequest(message);
    // history
    case 'GET_HISTORY':            return getHistory();
    case 'CLEAR_HISTORY':          return clearHistory();
    // backup / restore
    case 'EXPORT_BACKUP':          return exportBackup();
    case 'IMPORT_BACKUP':          return importBackup(message.data);
    // backend sync
    case 'SYNC_TO_BACKEND':        return syncToBackend();
    default:
      throw new Error(`Unknown message type: ${message.type}`);
  }
}

// ===================== PROFILES =====================

async function getProfiles() {
  const result = await chrome.storage.local.get(PROFILES_KEY);
  const enc = result[PROFILES_KEY] || [];
  const profiles = await Promise.all(enc.map(async p => ({
    id: p.id,
    name: p.name,
    boardId: p.boardId || null,
    pinHash: p.pinHash || null,
    hasPin: !!p.pinHash,
    createdAt: p.createdAt,
    data: JSON.parse(await decryptData(p.encrypted)),
  })));
  return { profiles };
}

async function getActiveProfile() {
  const { profiles } = await getProfiles();
  if (!profiles.length) return { profile: null, profileId: null };
  const result = await chrome.storage.local.get(ACTIVE_KEY);
  const activeId = result[ACTIVE_KEY] || profiles[0].id;
  const profile = profiles.find(p => p.id === activeId) || profiles[0];
  return { profile, profileId: profile.id };
}

async function setActiveProfile(profileId) {
  await chrome.storage.local.set({ [ACTIVE_KEY]: profileId });
  return { success: true };
}

async function saveProfile(profile) {
  const result = await chrome.storage.local.get(PROFILES_KEY);
  const enc = result[PROFILES_KEY] || [];
  const encrypted = await encryptData(JSON.stringify(profile.data || {}));
  const entry = {
    id: profile.id || crypto.randomUUID(),
    name: profile.name || 'Profile',
    boardId: profile.boardId || null,
    pinHash: profile.pinHash ?? (enc.find(p => p.id === profile.id)?.pinHash || null),
    createdAt: profile.createdAt || new Date().toISOString(),
    encrypted,
  };
  const idx = enc.findIndex(p => p.id === entry.id);
  if (idx >= 0) enc[idx] = entry; else enc.push(entry);
  await chrome.storage.local.set({ [PROFILES_KEY]: enc });
  const activeResult = await chrome.storage.local.get(ACTIVE_KEY);
  if (!activeResult[ACTIVE_KEY]) await chrome.storage.local.set({ [ACTIVE_KEY]: entry.id });
  return { success: true, profileId: entry.id };
}

async function deleteProfile(profileId) {
  const result = await chrome.storage.local.get(PROFILES_KEY);
  const enc = (result[PROFILES_KEY] || []).filter(p => p.id !== profileId);
  await chrome.storage.local.set({ [PROFILES_KEY]: enc });
  const activeResult = await chrome.storage.local.get(ACTIVE_KEY);
  if (activeResult[ACTIVE_KEY] === profileId && enc.length > 0) {
    await chrome.storage.local.set({ [ACTIVE_KEY]: enc[0].id });
  }
  return { success: true };
}

async function setProfilePin(profileId, pin) {
  const result = await chrome.storage.local.get(PROFILES_KEY);
  const enc = result[PROFILES_KEY] || [];
  const profile = enc.find(p => p.id === profileId);
  if (!profile) throw new Error('Profile not found');
  profile.pinHash = await hashPin(pin);
  await chrome.storage.local.set({ [PROFILES_KEY]: enc });
  return { success: true };
}

async function removeProfilePin(profileId, pin) {
  const result = await chrome.storage.local.get(PROFILES_KEY);
  const enc = result[PROFILES_KEY] || [];
  const profile = enc.find(p => p.id === profileId);
  if (!profile) throw new Error('Profile not found');
  if (profile.pinHash && !(await verifyPin(pin, profile.pinHash))) throw new Error('WRONG_PIN');
  profile.pinHash = null;
  await chrome.storage.local.set({ [PROFILES_KEY]: enc });
  return { success: true };
}

async function verifyProfilePin(profileId, pin) {
  const result = await chrome.storage.local.get(PROFILES_KEY);
  const enc = result[PROFILES_KEY] || [];
  const profile = enc.find(p => p.id === profileId);
  if (!profile?.pinHash) return { valid: true };
  return { valid: await verifyPin(pin, profile.pinHash) };
}

// ===================== BOARDS =====================

async function getBoards() {
  const result = await chrome.storage.local.get(BOARDS_KEY);
  return { boards: result[BOARDS_KEY] || [] };
}

async function saveBoard(board) {
  const result = await chrome.storage.local.get(BOARDS_KEY);
  const boards = result[BOARDS_KEY] || [];
  const entry = { id: board.id || crypto.randomUUID(), name: board.name, color: board.color || '#4f46e5', createdAt: board.createdAt || new Date().toISOString() };
  const idx = boards.findIndex(b => b.id === entry.id);
  if (idx >= 0) boards[idx] = entry; else boards.push(entry);
  await chrome.storage.local.set({ [BOARDS_KEY]: boards });
  return { success: true, boardId: entry.id };
}

async function deleteBoard(boardId) {
  const result = await chrome.storage.local.get(BOARDS_KEY);
  const boards = (result[BOARDS_KEY] || []).filter(b => b.id !== boardId);
  await chrome.storage.local.set({ [BOARDS_KEY]: boards });
  // unassign profiles from this board
  const profResult = await chrome.storage.local.get(PROFILES_KEY);
  const enc = profResult[PROFILES_KEY] || [];
  enc.forEach(p => { if (p.boardId === boardId) p.boardId = null; });
  await chrome.storage.local.set({ [PROFILES_KEY]: enc });
  return { success: true };
}

// ===================== TEMPLATES =====================

async function getTemplates() {
  const result = await chrome.storage.local.get(TEMPLATES_KEY);
  return { templates: result[TEMPLATES_KEY] || [] };
}

async function saveTemplate(template) {
  const result = await chrome.storage.local.get(TEMPLATES_KEY);
  const templates = result[TEMPLATES_KEY] || [];
  const entry = {
    id: template.id || crypto.randomUUID(),
    name: template.name || 'Template',
    description: template.description || '',
    urlPattern: template.urlPattern || '',
    profileId: template.profileId || null,
    fieldMappings: template.fieldMappings || {},
    createdAt: template.createdAt || new Date().toISOString(),
  };
  const idx = templates.findIndex(t => t.id === entry.id);
  if (idx >= 0) templates[idx] = entry; else templates.push(entry);
  await chrome.storage.local.set({ [TEMPLATES_KEY]: templates });
  return { success: true, templateId: entry.id };
}

async function deleteTemplate(templateId) {
  const result = await chrome.storage.local.get(TEMPLATES_KEY);
  const templates = (result[TEMPLATES_KEY] || []).filter(t => t.id !== templateId);
  await chrome.storage.local.set({ [TEMPLATES_KEY]: templates });
  return { success: true };
}

function matchesUrlPattern(pattern, url) {
  if (!pattern) return false;
  try {
    // support glob-style wildcards
    const regex = new RegExp('^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
    return regex.test(url) || regex.test(new URL(url).hostname);
  } catch {
    return url.includes(pattern);
  }
}

// ===================== SETTINGS =====================

async function getSettings() {
  const result = await chrome.storage.local.get(SETTINGS_KEY);
  return { settings: result[SETTINGS_KEY] || defaultSettings() };
}

async function saveSettings(settings) {
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
  return { success: true };
}

function defaultSettings() {
  return { apiKey: '', backendUrl: '', backendToken: '', autoFillOnLoad: false, fillCount: 0, freeLimit: 20, isPremium: false };
}

// ===================== AUTOFILL =====================

async function handleAutofillRequest({ fields, pageContext, url, pageTitle, profileId: requestedProfileId }) {
  const [{ settings }, { templates }] = await Promise.all([getSettings(), getTemplates()]);

  if (!settings.isPremium && settings.fillCount >= settings.freeLimit) throw new Error('LIMIT_REACHED');
  if (!settings.apiKey) throw new Error('NO_API_KEY');

  // resolve profile
  let profileId = requestedProfileId;
  let profile;
  if (profileId) {
    const { profiles } = await getProfiles();
    const found = profiles.find(p => p.id === profileId);
    if (found) profile = found;
  }
  if (!profile) {
    const active = await getActiveProfile();
    profile = active.profile;
    profileId = active.profileId;
  }
  if (!profile) throw new Error('NO_PROFILE');

  // resolve dynamic fields in profile data
  const resolvedData = await resolveDynamicFields(profile.data);

  // check for a matching template first (no API call needed)
  const matchingTemplate = url
    ? templates.find(t => matchesUrlPattern(t.urlPattern, url))
    : null;

  let suggestions;
  if (matchingTemplate && Object.keys(matchingTemplate.fieldMappings).length > 0) {
    suggestions = applyTemplateMappings(matchingTemplate.fieldMappings, fields, resolvedData);
  } else {
    suggestions = await callClaudeAPI(fields, resolvedData, pageContext, settings.apiKey);
  }

  await Promise.all([
    saveSettings({ ...settings, fillCount: settings.fillCount + 1 }),
    appendHistory({ url: url || '', pageTitle: pageTitle || '', profileId, profileName: profile.name, fieldsFilled: Object.keys(suggestions).length, totalFields: fields.length, usedTemplate: matchingTemplate?.name || null }),
  ]);

  return { suggestions };
}

function applyTemplateMappings(mappings, fields, profileData) {
  const result = {};
  fields.forEach(f => {
    // match by label, name, or id
    const key = Object.keys(mappings).find(k =>
      k.toLowerCase() === (f.label || '').toLowerCase() ||
      k.toLowerCase() === (f.name || '').toLowerCase() ||
      k === f.id
    );
    if (key) {
      const val = mappings[key];
      // support profile variable substitution e.g. "{{firstName}}"
      result[f.id] = typeof val === 'string'
        ? val.replace(/\{\{(\w+)\}\}/g, (_, k) => profileData[k] || '')
        : val;
    }
  });
  return result;
}

async function resolveDynamicFields(data) {
  const resolved = { ...data };
  const dynamicEntries = Object.entries(data).filter(([, v]) => v && typeof v === 'object' && v.type === 'dynamic');
  await Promise.all(dynamicEntries.map(async ([key, def]) => {
    try {
      const res = await fetch(def.fetchUrl);
      const html = await res.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      resolved[key] = doc.querySelector(def.selector)?.textContent?.trim() || data[key] || '';
    } catch {
      resolved[key] = '';
    }
  }));
  return resolved;
}

async function callClaudeAPI(fields, profileData, pageContext, apiKey) {
  const fieldList = fields.map(f => `- id:"${f.id}" label:"${f.label}" type:"${f.type}" name:"${f.name}"`).join('\n');
  const prompt = `You are a form autofill assistant. Match user profile to form fields.

Page: ${pageContext}
Profile: ${JSON.stringify(profileData, null, 2)}
Fields:\n${fieldList}

Respond ONLY with JSON mapping field id to value. Omit unfillable fields.
JSON:`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 1024, messages: [{ role: 'user', content: prompt }] }),
  });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error?.message || `API ${res.status}`); }
  const data = await res.json();
  return parseClaudeResponse(data.content[0].text, fields);
}

function parseClaudeResponse(text, fields) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return {};
  try {
    const parsed = JSON.parse(match[0]);
    const valid = new Set(fields.map(f => f.id));
    return Object.fromEntries(Object.entries(parsed).filter(([k]) => valid.has(k)));
  } catch { return {}; }
}

// ===================== HISTORY =====================

async function getHistory() {
  const result = await chrome.storage.local.get(HISTORY_KEY);
  return { history: result[HISTORY_KEY] || [] };
}

async function clearHistory() {
  await chrome.storage.local.set({ [HISTORY_KEY]: [] });
  return { success: true };
}

async function appendHistory(entry) {
  const result = await chrome.storage.local.get(HISTORY_KEY);
  const history = result[HISTORY_KEY] || [];
  history.unshift({ id: crypto.randomUUID(), timestamp: new Date().toISOString(), ...entry });
  if (history.length > HISTORY_LIMIT) history.length = HISTORY_LIMIT;
  await chrome.storage.local.set({ [HISTORY_KEY]: history });
}

// ===================== BACKUP / RESTORE =====================

async function exportBackup() {
  const [{ profiles }, { boards }, { templates }, { history }, { settings }] = await Promise.all([
    getProfiles(), getBoards(), getTemplates(), getHistory(), getSettings(),
  ]);
  return {
    backup: {
      version: '1.1',
      exportedAt: new Date().toISOString(),
      profiles: profiles.map(({ pinHash, ...p }) => p), // exclude pin hashes from export
      boards,
      templates,
      history,
      settings: { ...settings, apiKey: '', backendToken: '' }, // strip secrets
    }
  };
}

async function importBackup(data) {
  if (!data?.version || !Array.isArray(data.profiles)) throw new Error('Invalid backup file');

  // save boards and templates directly
  if (data.boards) await chrome.storage.local.set({ [BOARDS_KEY]: data.boards });
  if (data.templates) await chrome.storage.local.set({ [TEMPLATES_KEY]: data.templates });
  if (data.history) await chrome.storage.local.set({ [HISTORY_KEY]: data.history });

  // re-encrypt profiles
  const encProfiles = await Promise.all((data.profiles || []).map(async p => ({
    id: p.id,
    name: p.name,
    boardId: p.boardId || null,
    pinHash: null,
    createdAt: p.createdAt,
    encrypted: await encryptData(JSON.stringify(p.data || {})),
  })));
  await chrome.storage.local.set({ [PROFILES_KEY]: encProfiles });
  if (encProfiles.length) await chrome.storage.local.set({ [ACTIVE_KEY]: encProfiles[0].id });

  return { success: true, profileCount: encProfiles.length };
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
