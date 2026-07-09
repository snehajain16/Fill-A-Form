import { encryptData, decryptData } from '../utils/crypto.js';

const PROFILES_KEY   = 'fill_a_form_profiles';
const ACTIVE_KEY     = 'fill_a_form_active_profile';
const SETTINGS_KEY   = 'fill_a_form_settings';
const HISTORY_KEY    = 'fill_a_form_history';
const HISTORY_LIMIT  = 100;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse).catch(err => {
    sendResponse({ error: err.message });
  });
  return true;
});

async function handleMessage(message) {
  switch (message.type) {
    // ---- multi-profile ----
    case 'GET_PROFILES':         return getProfiles();
    case 'GET_ACTIVE_PROFILE':   return getActiveProfile();
    case 'SET_ACTIVE_PROFILE':   return setActiveProfile(message.profileId);
    case 'SAVE_PROFILE':         return saveProfile(message.profile);
    case 'DELETE_PROFILE':       return deleteProfile(message.profileId);
    // ---- settings ----
    case 'GET_SETTINGS':         return getSettings();
    case 'SAVE_SETTINGS':        return saveSettings(message.settings);
    // ---- autofill ----
    case 'AUTOFILL_REQUEST':     return handleAutofillRequest(message.fields, message.pageContext, message.url, message.pageTitle);
    // ---- history ----
    case 'GET_HISTORY':          return getHistory();
    case 'CLEAR_HISTORY':        return clearHistory();
    // ---- backend sync ----
    case 'SYNC_TO_BACKEND':      return syncToBackend();
    default:
      throw new Error(`Unknown message type: ${message.type}`);
  }
}

// ===================== MULTI-PROFILE =====================

async function getProfiles() {
  const result = await chrome.storage.local.get(PROFILES_KEY);
  const encProfiles = result[PROFILES_KEY] || [];
  const profiles = await Promise.all(
    encProfiles.map(async p => ({
      id: p.id,
      name: p.name,
      createdAt: p.createdAt,
      data: JSON.parse(await decryptData(p.encrypted)),
    }))
  );
  return { profiles };
}

async function getActiveProfile() {
  const { profiles } = await getProfiles();
  if (profiles.length === 0) return { profile: null, profileId: null };
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
  const encProfiles = result[PROFILES_KEY] || [];

  const encrypted = await encryptData(JSON.stringify(profile.data));
  const existing = encProfiles.findIndex(p => p.id === profile.id);

  const entry = {
    id: profile.id || crypto.randomUUID(),
    name: profile.name || 'Default',
    createdAt: profile.createdAt || new Date().toISOString(),
    encrypted,
  };

  if (existing >= 0) {
    encProfiles[existing] = entry;
  } else {
    encProfiles.push(entry);
  }

  await chrome.storage.local.set({ [PROFILES_KEY]: encProfiles });

  // make it active if it's the first profile or if it's new
  const activeResult = await chrome.storage.local.get(ACTIVE_KEY);
  if (!activeResult[ACTIVE_KEY] || existing < 0) {
    await chrome.storage.local.set({ [ACTIVE_KEY]: entry.id });
  }

  return { success: true, profileId: entry.id };
}

async function deleteProfile(profileId) {
  const result = await chrome.storage.local.get(PROFILES_KEY);
  const encProfiles = (result[PROFILES_KEY] || []).filter(p => p.id !== profileId);
  await chrome.storage.local.set({ [PROFILES_KEY]: encProfiles });

  // if active was deleted, switch to first available
  const activeResult = await chrome.storage.local.get(ACTIVE_KEY);
  if (activeResult[ACTIVE_KEY] === profileId && encProfiles.length > 0) {
    await chrome.storage.local.set({ [ACTIVE_KEY]: encProfiles[0].id });
  }
  return { success: true };
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
  return {
    apiKey: '',
    backendUrl: '',
    backendToken: '',
    autoFillOnLoad: false,
    fillCount: 0,
    freeLimit: 20,
    isPremium: false,
  };
}

// ===================== AUTOFILL =====================

async function handleAutofillRequest(fields, pageContext, url, pageTitle) {
  const [{ profile, profileId }, { settings }] = await Promise.all([
    getActiveProfile(),
    getSettings(),
  ]);

  if (!profile) throw new Error('NO_PROFILE');
  if (!settings.isPremium && settings.fillCount >= settings.freeLimit) throw new Error('LIMIT_REACHED');
  if (!settings.apiKey) throw new Error('NO_API_KEY');

  const suggestions = await callClaudeAPI(fields, profile.data, pageContext, settings.apiKey);

  await Promise.all([
    saveSettings({ ...settings, fillCount: settings.fillCount + 1 }),
    appendHistory({
      url: url || '',
      pageTitle: pageTitle || '',
      profileId,
      profileName: profile.name,
      fieldsFilled: Object.keys(suggestions).length,
      totalFields: fields.length,
    }),
  ]);

  return { suggestions };
}

async function callClaudeAPI(fields, profileData, pageContext, apiKey) {
  const prompt = buildPrompt(fields, profileData, pageContext);

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `API error ${response.status}`);
  }

  const data = await response.json();
  return parseClaudeResponse(data.content[0].text, fields);
}

function buildPrompt(fields, profileData, pageContext) {
  const fieldList = fields
    .map(f => `- id: "${f.id}", label: "${f.label}", type: "${f.type}", name: "${f.name}"`)
    .join('\n');

  return `You are a form autofill assistant. Given a user profile and form fields, return the best matching value for each field.

Page context: ${pageContext}

User profile:
${JSON.stringify(profileData, null, 2)}

Form fields:
${fieldList}

Respond ONLY with a JSON object mapping field id to value. Omit fields you cannot fill. Example:
{"field_id_1": "John", "field_id_2": "Doe"}

JSON:`;
}

function parseClaudeResponse(text, fields) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return {};
  try {
    const parsed = JSON.parse(match[0]);
    const validIds = new Set(fields.map(f => f.id));
    return Object.fromEntries(Object.entries(parsed).filter(([k]) => validIds.has(k)));
  } catch {
    return {};
  }
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

// ===================== BACKEND SYNC =====================

async function syncToBackend() {
  const { settings } = await getSettings();
  if (!settings.backendUrl || !settings.backendToken) throw new Error('NO_BACKEND_CONFIG');

  const [{ profiles }, { history }] = await Promise.all([getProfiles(), getHistory()]);

  // send profiles (without encrypted blob — send plain data over HTTPS)
  const res = await fetch(`${settings.backendUrl}/api/sync`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.backendToken}`,
    },
    body: JSON.stringify({
      profiles: profiles.map(p => ({ id: p.id, name: p.name, data: p.data, createdAt: p.createdAt })),
      history,
    }),
  });

  if (!res.ok) throw new Error(`Sync failed: ${res.status}`);
  return { success: true };
}
