import { encryptData, decryptData } from '../utils/crypto.js';

const STORAGE_KEY = 'fill_a_form_profile';
const SETTINGS_KEY = 'fill_a_form_settings';

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse).catch(err => {
    sendResponse({ error: err.message });
  });
  return true; // keep channel open for async response
});

async function handleMessage(message, sender) {
  switch (message.type) {
    case 'GET_PROFILE':
      return getProfile();
    case 'SAVE_PROFILE':
      return saveProfile(message.profile);
    case 'GET_SETTINGS':
      return getSettings();
    case 'SAVE_SETTINGS':
      return saveSettings(message.settings);
    case 'AUTOFILL_REQUEST':
      return handleAutofillRequest(message.fields, message.pageContext);
    case 'RECORD_FILL':
      return recordFill(message.fieldData);
    default:
      throw new Error(`Unknown message type: ${message.type}`);
  }
}

async function getProfile() {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  if (!result[STORAGE_KEY]) return { profile: null };
  const decrypted = await decryptData(result[STORAGE_KEY]);
  return { profile: JSON.parse(decrypted) };
}

async function saveProfile(profile) {
  const encrypted = await encryptData(JSON.stringify(profile));
  await chrome.storage.local.set({ [STORAGE_KEY]: encrypted });
  return { success: true };
}

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
    autoFillOnLoad: false,
    showConfirmation: true,
    fillCount: 0,
    freeLimit: 20,
    isPremium: false,
  };
}

async function handleAutofillRequest(fields, pageContext) {
  const [{ profile }, { settings }] = await Promise.all([getProfile(), getSettings()]);

  if (!profile) throw new Error('NO_PROFILE');

  if (!settings.isPremium && settings.fillCount >= settings.freeLimit) {
    throw new Error('LIMIT_REACHED');
  }

  if (!settings.apiKey) throw new Error('NO_API_KEY');

  const suggestions = await callClaudeAPI(fields, profile, pageContext, settings.apiKey);

  // increment fill count
  await saveSettings({ ...settings, fillCount: settings.fillCount + 1 });

  return { suggestions };
}

async function callClaudeAPI(fields, profile, pageContext, apiKey) {
  const prompt = buildPrompt(fields, profile, pageContext);

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
  const text = data.content[0].text;
  return parseClaudeResponse(text, fields);
}

function buildPrompt(fields, profile, pageContext) {
  const fieldList = fields
    .map(f => `- id: "${f.id}", label: "${f.label}", type: "${f.type}", name: "${f.name}"`)
    .join('\n');

  const profileSummary = JSON.stringify(profile, null, 2);

  return `You are a form autofill assistant. Given a user profile and a list of form fields, return the best matching value for each field.

Page context: ${pageContext}

User profile:
${profileSummary}

Form fields to fill:
${fieldList}

Respond ONLY with a JSON object mapping each field id to its value. If a field cannot be filled from the profile, omit it. Example:
{"field_id_1": "John", "field_id_2": "Doe"}

JSON response:`;
}

function parseClaudeResponse(text, fields) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return {};
  try {
    const parsed = JSON.parse(match[0]);
    // only return values for fields that were actually requested
    const validIds = new Set(fields.map(f => f.id));
    return Object.fromEntries(
      Object.entries(parsed).filter(([k]) => validIds.has(k))
    );
  } catch {
    return {};
  }
}

async function recordFill(fieldData) {
  // future: store fill history for learning
  return { success: true };
}
