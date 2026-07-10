import { downloadJson, readJsonFile } from '../utils/backup.js';

// ---- helpers ----
const $ = id => document.getElementById(id);
const send = msg => chrome.runtime.sendMessage(msg);
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

function toast(msg, type = 'success') {
  const el = $('toast');
  el.textContent = msg;
  el.className = `show ${type}`;
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.className = ''; }, 2800);
}

// ---- nav ----
document.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => switchView(btn.dataset.view));
});

function switchView(id) {
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === id));
  $(id).classList.remove('hidden');
  if (id === 'history-view')   renderHistory();
  if (id === 'profiles-view')  renderProfiles();
  if (id === 'templates-view') renderTemplates();
}

// ---- state ----
let state = { profiles: [], boards: [], templates: [], history: [], settings: {}, activeId: null, usage: null };
let selectedBoard = null;
let editingProfileId = null;
let editingTemplateId = null;
let profilePinHash = null;

// ---- init ----
async function init() {
  const data = await send({ type: 'INIT_DATA' });
  state.profiles  = data.profiles  || [];
  state.boards    = data.boards    || [];
  state.templates = data.templates || [];
  state.history   = data.history   || [];
  state.settings  = data.settings  || {};
  state.activeId  = data.profileId || null;
  state.usage     = data.usage     || null;

  renderHome();
  initSettings();
  populateBoardChips();
}

// ---- HOME ----
async function renderHome() {
  let fieldCount = 0;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      const r = await chrome.tabs.sendMessage(tab.id, { type: 'GET_FIELD_COUNT' }).catch(() => null);
      fieldCount = r?.count || 0;
    }
  } catch {}

  $('fields-detected').textContent = fieldCount > 0
    ? `${fieldCount} fillable field${fieldCount !== 1 ? 's' : ''} detected`
    : 'No fillable fields on this page';

  const btn = $('autofill-btn');
  btn.disabled = fieldCount === 0;

  $('s-fills').textContent     = state.usage?.totalFills ?? state.history.length;
  $('s-profiles').textContent  = state.profiles.length;
  $('s-templates').textContent = state.templates.length;
  $('s-history').textContent   = state.history.length;

  const limit = state.usage?.limit ?? 10;
  const used  = state.usage?.used  ?? 0;
  const pct   = Math.min(100, Math.round((used / limit) * 100));
  $('usage-bar').style.width = pct + '%';
  $('usage-bar').style.background = pct >= 90 ? '#dc2626' : pct >= 70 ? '#d97706' : 'linear-gradient(90deg,#4f46e5,#7c3aed)';
  $('usage-label').textContent = state.settings.premium
    ? 'Premium — unlimited fills'
    : `${used} / ${limit} free fills`;

  const modeLabels = { heuristic: '⚡ Smart Match', hybrid: '🔀 Hybrid', ai: '🤖 AI Only' };
  $('mode-pill').innerHTML = `<span class="mode-pill-tag">${modeLabels[state.settings.fillMode] || '⚡ Smart Match'}</span>`;
  $('shortcut-hint').textContent = '⌨ Ctrl+Shift+F for quick paste overlay';

  const active = state.profiles.find(p => p.id === state.activeId);
  const badge = $('active-badge');
  if (active) { badge.textContent = active.name; badge.classList.remove('hidden'); }
  else badge.classList.add('hidden');

  const alerts = $('home-alerts');
  alerts.innerHTML = '';
  const mode = state.settings.fillMode || 'heuristic';
  if ((mode === 'ai' || mode === 'hybrid') && !state.settings.apiKey)
    alerts.innerHTML += '<div class="alert alert-warn">⚠ Add your Claude API key in Settings to use AI fill.</div>';
  if (!state.profiles.length)
    alerts.innerHTML += '<div class="alert alert-info">👤 Create a profile to start autofilling.</div>';
}

$('autofill-btn').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  $('autofill-btn').disabled = true;
  await chrome.tabs.sendMessage(tab.id, { type: 'TRIGGER_AUTOFILL', profileId: state.activeId || null }).catch(() => {});
  setTimeout(() => { $('autofill-btn').disabled = false; }, 1500);
});

// ---- PROFILES ----
function renderProfiles() {
  renderBoardChips();
  const list = $('profile-list');
  let profiles = state.profiles;
  if (selectedBoard) profiles = profiles.filter(p => p.boardId === selectedBoard);

  if (!profiles.length) {
    list.innerHTML = '<div class="empty-state"><div class="empty-icon">👤</div><p>No profiles yet.</p><span>Click + New to create one.</span></div>';
    return;
  }
  list.innerHTML = profiles.map(p => {
    const board = state.boards.find(b => b.id === p.boardId);
    const isActive = p.id === state.activeId;
    return `<div class="card profile-card${isActive ? ' card-active' : ''}" data-id="${p.id}">
      <div class="card-av" style="background:linear-gradient(135deg,${board?.color || '#4f46e5'},${adjustColor(board?.color || '#4f46e5')})">
        ${esc((p.name[0] || '?').toUpperCase())}
      </div>
      <div class="card-body">
        <div class="card-title">${esc(p.name)}${p.hasPin ? ' 🔒' : ''}</div>
        ${board ? `<div class="card-sub"><span class="board-dot" style="background:${board.color}"></span>${esc(board.name)}</div>` : ''}
      </div>
      <div class="card-actions">
        <button class="mini-btn set-active-btn${isActive ? ' primary' : ''}" data-id="${p.id}">${isActive ? '✓ Active' : 'Set Active'}</button>
        <button class="mini-btn edit-profile-btn" data-id="${p.id}">Edit</button>
      </div>
    </div>`;
  }).join('');

  list.querySelectorAll('.set-active-btn').forEach(btn => btn.addEventListener('click', async e => {
    e.stopPropagation();
    await send({ type: 'SET_ACTIVE_PROFILE', profileId: btn.dataset.id });
    state.activeId = btn.dataset.id;
    renderProfiles(); renderHome();
  }));
  list.querySelectorAll('.edit-profile-btn').forEach(btn => btn.addEventListener('click', e => {
    e.stopPropagation();
    openProfileEditor(btn.dataset.id);
  }));
}

function adjustColor(hex) {
  // darken hex slightly for gradient end
  try {
    const n = parseInt(hex.slice(1), 16);
    const r = Math.max(0, (n >> 16) - 40);
    const g = Math.max(0, ((n >> 8) & 0xff) - 20);
    const b = Math.max(0, (n & 0xff) + 20);
    return `#${((r<<16)|(g<<8)|b).toString(16).padStart(6,'0')}`;
  } catch { return '#7c3aed'; }
}

function renderBoardChips() {
  const chips = $('board-chips');
  chips.innerHTML = state.boards.map(b => `
    <button class="chip${selectedBoard === b.id ? ' chip-active' : ''}" data-id="${b.id}" style="border-color:${b.color}">
      <span class="board-dot" style="background:${b.color}"></span>${esc(b.name)}
    </button>`).join('');
  chips.querySelectorAll('.chip').forEach(c => c.addEventListener('click', () => {
    selectedBoard = selectedBoard === c.dataset.id ? null : c.dataset.id;
    $('all-filter').classList.toggle('chip-active', !selectedBoard);
    renderProfiles();
  }));
}

function populateBoardChips() { renderBoardChips(); }

$('all-filter').addEventListener('click', () => {
  selectedBoard = null;
  $('all-filter').classList.add('chip-active');
  renderProfiles();
});

$('new-board-btn').addEventListener('click', () => {
  $('board-inline-editor').classList.toggle('hidden');
  $('board-name-in').focus();
});
$('board-cancel-btn').addEventListener('click', () => $('board-inline-editor').classList.add('hidden'));
$('board-save-btn').addEventListener('click', async () => {
  const name = $('board-name-in').value.trim();
  if (!name) return;
  const res = await send({ type: 'SAVE_BOARD', board: { name, color: $('board-color-in').value } });
  state.boards = res.boards;
  $('board-inline-editor').classList.add('hidden');
  $('board-name-in').value = '';
  renderProfiles();
  toast('Board created');
});

$('new-profile-btn').addEventListener('click', () => openProfileEditor(null));

function openProfileEditor(id) {
  editingProfileId = id;
  const form = $('profile-form');
  form.reset();
  $('dynamic-list').innerHTML = '';
  $('delete-profile').classList.add('hidden');
  $('pin-indicator').textContent = 'Off';
  $('pin-indicator').className = 'pin-ind off';
  $('pin-input-row').classList.add('hidden');
  profilePinHash = null;

  const boardSel = $('edit-board');
  boardSel.innerHTML = '<option value="">— No board —</option>' +
    state.boards.map(b => `<option value="${b.id}">${esc(b.name)}</option>`).join('');

  if (id) {
    const p = state.profiles.find(x => x.id === id);
    if (!p) return;
    $('profile-panel-title').textContent = 'Edit Profile';
    $('edit-id').value    = p.id;
    $('edit-name').value  = p.name;
    $('edit-board').value = p.boardId || '';
    profilePinHash = p.pinHash || null;
    if (p.pinHash) { $('pin-indicator').textContent = 'On'; $('pin-indicator').className = 'pin-ind on'; }
    $('delete-profile').classList.remove('hidden');
    const data = p.data || {};
    form.querySelectorAll('[name]').forEach(inp => { if (data[inp.name] !== undefined) inp.value = data[inp.name]; });
    (p.dynamicFields || []).forEach(f => addDynamicRow(f));
  } else {
    $('profile-panel-title').textContent = 'New Profile';
    $('edit-id').value = '';
  }

  $('profile-editor').classList.remove('hidden');
}

$('back-profiles').addEventListener('click', () => {
  $('profile-editor').classList.add('hidden');
  editingProfileId = null;
});

$('pin-toggle').addEventListener('click', () => $('pin-input-row').classList.toggle('hidden'));
$('pin-confirm-btn').addEventListener('click', async () => {
  const pin = $('pin-val').value;
  if (!pin || pin.length < 4) { toast('PIN must be 4–8 digits', 'error'); return; }
  const res = await send({ type: 'HASH_PIN', pin });
  profilePinHash = res.hash;
  $('pin-indicator').textContent = 'On';
  $('pin-indicator').className = 'pin-ind on';
  $('pin-input-row').classList.add('hidden');
  $('pin-val').value = '';
  toast('PIN set');
});

$('profile-form').addEventListener('submit', async e => {
  e.preventDefault();
  const form = e.target;
  const data = {};
  form.querySelectorAll('[name]').forEach(inp => { if (inp.name) data[inp.name] = inp.value; });

  const dynamicFields = Array.from($('dynamic-list').querySelectorAll('.dyn-row')).map(row => ({
    key:      row.querySelector('.dyn-key').value.trim(),
    url:      row.querySelector('.dyn-url').value.trim(),
    selector: row.querySelector('.dyn-sel').value.trim(),
  })).filter(f => f.key && f.url);

  const profile = {
    id:            $('edit-id').value || undefined,
    name:          $('edit-name').value.trim(),
    boardId:       $('edit-board').value || null,
    pinHash:       profilePinHash || null,
    hasPin:        !!profilePinHash,
    data,
    dynamicFields,
  };

  const res = await send({ type: 'SAVE_PROFILE', profile });
  state.profiles = res.profiles;
  toast(editingProfileId ? 'Profile updated' : 'Profile created');
  $('profile-editor').classList.add('hidden');
  editingProfileId = null;
  renderProfiles();
  renderHome();
});

$('delete-profile').addEventListener('click', async () => {
  if (!editingProfileId || !confirm('Delete this profile?')) return;
  const res = await send({ type: 'DELETE_PROFILE', profileId: editingProfileId });
  state.profiles = res.profiles;
  if (state.activeId === editingProfileId) state.activeId = null;
  toast('Profile deleted');
  $('profile-editor').classList.add('hidden');
  editingProfileId = null;
  renderProfiles();
  renderHome();
});

// ---- RESUME PARSER ----
$('resume-file').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  const status = $('resume-status');
  status.textContent = 'Parsing resume…';
  status.className = 'resume-status';
  try {
    const apiKey = state.settings.apiKey;
    if (!apiKey) { status.textContent = '⚠ Add your Claude API key in Settings first.'; status.className = 'resume-status error'; return; }
    const mimeType = file.type === 'application/pdf' ? 'application/pdf' : 'text/plain';
    const fileData = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    const res = await send({ type: 'PARSE_RESUME', fileData, mimeType, apiKey });
    if (res.error) throw new Error(res.error);
    const parsed = res.parsed;
    const form = $('profile-form');
    let filled = 0;
    form.querySelectorAll('[name]').forEach(inp => {
      if (parsed[inp.name] !== undefined && parsed[inp.name] !== '') {
        inp.value = parsed[inp.name];
        filled++;
      }
    });
    // pre-fill name from resume if not set
    if (!$('edit-name').value && (parsed.fullName || parsed.firstName)) {
      $('edit-name').value = parsed.fullName || [parsed.firstName, parsed.lastName].filter(Boolean).join(' ');
    }
    status.textContent = `✓ Filled ${filled} fields from resume`;
    status.className = 'resume-status success';
  } catch (err) {
    status.textContent = '✗ ' + (err.message === 'NO_API_KEY' ? 'Add API key in Settings first' : err.message);
    status.className = 'resume-status error';
  }
  e.target.value = '';
  $('resume-status').classList.remove('hidden');
});

$('add-dynamic').addEventListener('click', () => addDynamicRow());
function addDynamicRow(f = {}) {
  const row = document.createElement('div');
  row.className = 'dyn-row';
  row.innerHTML = `
    <input class="dyn-key small-input" placeholder="Key (e.g. salary)" value="${esc(f.key||'')}"/>
    <input class="dyn-url small-input" placeholder="URL" value="${esc(f.url||'')}"/>
    <input class="dyn-sel small-input" placeholder="CSS selector" value="${esc(f.selector||'')}"/>
    <button type="button" class="mini-btn dyn-del">×</button>`;
  row.querySelector('.dyn-del').addEventListener('click', () => row.remove());
  $('dynamic-list').appendChild(row);
}

// ---- TEMPLATES ----
function renderTemplates() {
  const tplProf = $('tpl-profile');
  tplProf.innerHTML = '<option value="">— Any active profile —</option>' +
    state.profiles.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('');

  const list = $('template-list');
  if (!state.templates.length) {
    list.innerHTML = '<div class="empty-state"><div class="empty-icon">📋</div><p>No templates yet.</p><span>Create one to fill known forms instantly.</span></div>';
    return;
  }
  list.innerHTML = state.templates.map(t => `
    <div class="card">
      <div class="card-body">
        <div class="card-title">${esc(t.name)}</div>
        <div class="card-sub">${esc(t.urlPattern || 'Any URL')} · ${Object.keys(t.fieldMappings||{}).length} field${Object.keys(t.fieldMappings||{}).length !== 1 ? 's' : ''}</div>
      </div>
      <button class="mini-btn edit-tpl-btn" data-id="${t.id}">Edit</button>
    </div>`).join('');
  list.querySelectorAll('.edit-tpl-btn').forEach(btn => btn.addEventListener('click', e => {
    e.stopPropagation();
    openTemplateEditor(btn.dataset.id);
  }));
}

$('new-template-btn').addEventListener('click', () => openTemplateEditor(null));

function openTemplateEditor(id) {
  editingTemplateId = id;
  $('tpl-id').value = '';
  $('tpl-name').value = '';
  $('tpl-pattern').value = '';
  $('tpl-profile').value = '';
  $('mapping-list').innerHTML = '';
  $('delete-template').classList.add('hidden');

  if (id) {
    const t = state.templates.find(x => x.id === id);
    if (!t) return;
    $('tpl-panel-title').textContent = 'Edit Template';
    $('tpl-id').value      = t.id;
    $('tpl-name').value    = t.name;
    $('tpl-pattern').value = t.urlPattern || '';
    $('tpl-profile').value = t.profileId  || '';
    Object.entries(t.fieldMappings || {}).forEach(([key, value]) => addMappingRow({ key, value }));
    $('delete-template').classList.remove('hidden');
  } else {
    $('tpl-panel-title').textContent = 'New Template';
  }

  $('template-editor').classList.remove('hidden');
}

$('back-templates').addEventListener('click', () => {
  $('template-editor').classList.add('hidden');
  editingTemplateId = null;
});

$('add-mapping').addEventListener('click', () => addMappingRow());
function addMappingRow(m = {}) {
  const row = document.createElement('div');
  row.className = 'mapping-row';
  row.innerHTML = `
    <input class="map-key small-input" placeholder="label or field name" value="${esc(m.key||'')}"/>
    <input class="map-val small-input" placeholder="value or {{fieldName}}" value="${esc(m.value||'')}"/>
    <button type="button" class="mini-btn map-del">×</button>`;
  row.querySelector('.map-del').addEventListener('click', () => row.remove());
  $('mapping-list').appendChild(row);
}

$('template-form').addEventListener('submit', async e => {
  e.preventDefault();
  const mappings = Array.from($('mapping-list').querySelectorAll('.mapping-row')).map(row => ({
    key:   row.querySelector('.map-key').value.trim(),
    value: row.querySelector('.map-val').value.trim(),
  })).filter(m => m.key);

  const fieldMappings = Object.fromEntries(mappings.map(m => [m.key, m.value]));
  const tpl = {
    id:            $('tpl-id').value || undefined,
    name:          $('tpl-name').value.trim(),
    urlPattern:    $('tpl-pattern').value.trim(),
    profileId:     $('tpl-profile').value || null,
    fieldMappings,
  };

  const res = await send({ type: 'SAVE_TEMPLATE', template: tpl });
  state.templates = res.templates;
  toast(editingTemplateId ? 'Template updated' : 'Template created');
  $('template-editor').classList.add('hidden');
  editingTemplateId = null;
  renderTemplates();
});

$('delete-template').addEventListener('click', async () => {
  if (!editingTemplateId || !confirm('Delete this template?')) return;
  const res = await send({ type: 'DELETE_TEMPLATE', templateId: editingTemplateId });
  state.templates = res.templates;
  toast('Template deleted');
  $('template-editor').classList.add('hidden');
  editingTemplateId = null;
  renderTemplates();
});

// ---- HISTORY ----
function renderHistory() {
  const list  = $('history-list');
  const empty = $('history-empty');
  if (!state.history.length) {
    list.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');
  list.innerHTML = [...state.history].reverse().map(h => {
    const badge = h.method === 'template'  ? '<span class="h-badge h-tpl">template</span>'
                : h.method === 'heuristic' ? '<span class="h-badge h-heur">smart</span>'
                : '<span class="h-badge">AI</span>';
    const date = new Date(h.timestamp).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
    return `<div class="card">
      <div class="card-body">
        <div class="card-title">${esc(h.pageTitle || h.url || 'Unknown page')}</div>
        <div class="card-sub">${date} · ${h.fieldsFilled || 0} fields ${badge}</div>
      </div>
    </div>`;
  }).join('');
}

$('clear-history').addEventListener('click', async () => {
  if (!confirm('Clear all fill history?')) return;
  await send({ type: 'CLEAR_HISTORY' });
  state.history = [];
  renderHistory();
  renderHome();
  toast('History cleared');
});

// ---- SETTINGS ----
function initSettings() {
  const s = state.settings;
  const mode = s.fillMode || 'heuristic';
  const radio = document.querySelector(`input[name="fillMode"][value="${mode}"]`);
  if (radio) radio.checked = true;
  toggleApiKeySection(mode);

  $('api-key-in').value     = s.apiKey       || '';
  $('backend-url').value    = s.backendUrl    || '';
  $('backend-token').value  = s.backendToken  || '';
  $('auto-fill-toggle').checked = !!s.autoFill;

  document.querySelectorAll('input[name="fillMode"]').forEach(r => {
    r.addEventListener('change', () => toggleApiKeySection(r.value));
  });
}

function toggleApiKeySection(mode) {
  $('api-key-section').classList.toggle('hidden', mode === 'heuristic');
}

$('settings-form').addEventListener('submit', async e => {
  e.preventDefault();
  const mode = document.querySelector('input[name="fillMode"]:checked')?.value || 'heuristic';
  const settings = {
    ...state.settings,
    fillMode:     mode,
    apiKey:       $('api-key-in').value.trim(),
    backendUrl:   $('backend-url').value.trim(),
    backendToken: $('backend-token').value.trim(),
    autoFill:     $('auto-fill-toggle').checked,
  };
  await send({ type: 'SAVE_SETTINGS', settings });
  state.settings = settings;
  toast('Settings saved');
  renderHome();
});

$('export-btn').addEventListener('click', async () => {
  const res = await send({ type: 'EXPORT_DATA' });
  downloadJson(res.backup, 'fill-a-form-backup.faf');
  toast('Backup exported');
});

$('import-in').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = await readJsonFile(file);
    const res  = await send({ type: 'IMPORT_DATA', data });
    state.profiles  = res.profiles;
    state.boards    = res.boards;
    state.templates = res.templates;
    state.history   = res.history;
    initSettings();
    renderHome();
    toast(`Backup imported — ${res.profileCount} profile${res.profileCount !== 1 ? 's' : ''}`);
  } catch { toast('Import failed — invalid file', 'error'); }
  e.target.value = '';
});

$('sync-btn').addEventListener('click', async () => {
  const url   = $('backend-url').value.trim();
  const token = $('backend-token').value.trim();
  if (!url) { toast('Enter a backend URL first', 'error'); return; }
  try {
    const res = await send({ type: 'BACKEND_SYNC', url, token });
    if (res.error) throw new Error(res.error);
    toast('Sync complete');
  } catch (err) { toast('Sync failed: ' + err.message, 'error'); }
});

// ---- boot ----
init();
