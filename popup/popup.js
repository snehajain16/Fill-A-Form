import { downloadJson, readJsonFile } from '../utils/backup.js';

// ===================== HELPERS =====================

const send = msg => chrome.runtime.sendMessage(msg);

function showToast(msg, duration = 2400) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.remove('hidden');
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.classList.add('hidden'), 200); }, duration);
}

function fmt(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined,{month:'short',day:'numeric'}) + ' ' + d.toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'});
}

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

// ===================== NAV =====================

const VIEWS = ['home-view','profiles-view','templates-view','history-view','settings-view'];
const VIEW_INIT = { 'home-view': initHome, 'profiles-view': initProfiles, 'templates-view': initTemplates, 'history-view': initHistory, 'settings-view': initSettings };

function showView(id) {
  VIEWS.forEach(v => document.getElementById(v).classList.toggle('hidden', v !== id));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === id));
  VIEW_INIT[id]?.();
}

document.querySelectorAll('.nav-btn').forEach(b => b.addEventListener('click', () => showView(b.dataset.view)));

// ===================== HOME =====================

async function initHome() {
  const [{ profiles }, { settings }, { history }, { templates }] = await Promise.all([
    send({type:'GET_PROFILES'}), send({type:'GET_SETTINGS'}),
    send({type:'GET_HISTORY'}), send({type:'GET_TEMPLATES'}),
  ]);
  const { profile } = await send({type:'GET_ACTIVE_PROFILE'});

  // badge
  const badge = document.getElementById('active-profile-badge');
  profile ? (badge.textContent = profile.name, badge.classList.remove('hidden')) : badge.classList.add('hidden');

  // stats
  document.getElementById('s-fills').textContent = settings?.fillCount || 0;
  document.getElementById('s-profiles').textContent = profiles?.length || 0;
  document.getElementById('s-templates').textContent = templates?.length || 0;
  document.getElementById('s-history').textContent = history?.length || 0;

  const used = settings?.fillCount || 0, limit = settings?.freeLimit || 20;
  document.getElementById('usage-fill').style.width = settings?.isPremium ? '0%' : Math.min(100,(used/limit*100))+'%';
  document.getElementById('usage-label').textContent = settings?.isPremium ? 'Premium' : `${used}/${limit}`;

  // shortcut hint — adjust for Mac
  const isMac = navigator.platform.startsWith('Mac');
  document.getElementById('shortcut-hint').innerHTML =
    `Press <kbd>${isMac ? '⌘' : 'Ctrl'}+Shift+F</kbd> on any page for quick fill`;

  // alerts
  const alertsEl = document.getElementById('home-alerts');
  alertsEl.innerHTML = '';
  if (!profile) {
    const a = el('div','alert warn','<strong>No profile set.</strong> ');
    const l = el('button','link'); l.textContent = 'Create one →';
    l.onclick = () => { showView('profiles-view'); setTimeout(() => document.getElementById('new-profile-btn').click(),50); };
    a.appendChild(l); alertsEl.appendChild(a);
  }
  if (!settings?.apiKey) {
    const a = el('div','alert warn','<strong>No API key.</strong> ');
    const l = el('button','link'); l.textContent = 'Add in Settings →';
    l.onclick = () => showView('settings-view');
    a.appendChild(l); alertsEl.appendChild(a);
  }
  if (settings && !settings.isPremium && used >= limit) {
    alertsEl.appendChild(el('div','alert warn','<strong>Free limit reached.</strong> Upgrade to premium.'));
  }

  // page field count
  const btn = document.getElementById('autofill-btn');
  btn.disabled = true;
  try {
    const [tab] = await chrome.tabs.query({ active:true, currentWindow:true });
    const results = await chrome.scripting.executeScript({
      target:{tabId:tab.id},
      func: () => Array.from(document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="image"]),textarea,select')).filter(e=>e.offsetParent!==null).length,
    });
    const count = results?.[0]?.result ?? 0;
    document.getElementById('fields-detected').textContent = `${count} fillable field${count!==1?'s':''} on this page`;
    btn.disabled = !profile || !settings?.apiKey || count===0 || (!settings.isPremium && used>=limit);
  } catch { document.getElementById('fields-detected').textContent = 'Open a page with a form to autofill'; }
}

document.getElementById('autofill-btn').addEventListener('click', async () => {
  document.getElementById('autofill-btn').disabled = true;
  try {
    const [tab] = await chrome.tabs.query({active:true,currentWindow:true});
    await chrome.tabs.sendMessage(tab.id,{type:'TRIGGER_AUTOFILL'});
    showToast('Autofill triggered!');
  } catch { showToast('Could not reach page. Try refreshing.'); }
  setTimeout(initHome, 800);
});

// ===================== PROFILES + BOARDS =====================

let activeBoardFilter = null;
let editingProfileId = null;

async function initProfiles() {
  const [{ profiles }, { boards }, { profileId: activeId }] = await Promise.all([
    send({type:'GET_PROFILES'}), send({type:'GET_BOARDS'}), send({type:'GET_ACTIVE_PROFILE'}),
  ]);

  renderBoards(boards, profiles);
  renderBoardFilter(boards);
  renderProfileList(profiles, boards, activeId);
}

function renderBoards(boards, profiles) {
  const list = document.getElementById('board-list');
  list.innerHTML = '';
  if (!boards.length) { list.appendChild(el('span','hint','No boards yet')); return; }
  boards.forEach(b => {
    const chip = el('div','board-chip');
    chip.style.cssText = `color:${b.color};background:${b.color}18;`;
    const profileCount = profiles.filter(p => p.boardId === b.id).length;
    chip.innerHTML = `<span class="board-chip-dot" style="background:${b.color}"></span>${esc(b.name)} <span style="opacity:.6;font-weight:400">(${profileCount})</span>`;
    const del = el('button','board-chip-del','✕');
    del.title = 'Delete board';
    del.onclick = async e => { e.stopPropagation(); if(confirm(`Delete board "${b.name}"?`)) { await send({type:'DELETE_BOARD',boardId:b.id}); initProfiles(); } };
    chip.appendChild(del);
    list.appendChild(chip);
  });
}

function renderBoardFilter(boards) {
  const row = document.getElementById('board-filter-row');
  row.innerHTML = '';
  if (!boards.length) return;
  const all = el('button','board-filter-btn'+(activeBoardFilter===null?' active':''),'All');
  all.onclick = () => { activeBoardFilter=null; document.querySelectorAll('.board-filter-btn').forEach(b=>b.classList.remove('active')); all.classList.add('active'); renderProfileListRefresh(); };
  row.appendChild(all);
  boards.forEach(b => {
    const btn = el('button','board-filter-btn'+(activeBoardFilter===b.id?' active':''), esc(b.name));
    btn.style.borderColor = activeBoardFilter===b.id ? b.color : '';
    btn.style.color = activeBoardFilter===b.id ? b.color : '';
    btn.onclick = () => { activeBoardFilter=b.id; document.querySelectorAll('.board-filter-btn').forEach(x=>x.classList.remove('active')); btn.classList.add('active'); renderProfileListRefresh(); };
    row.appendChild(btn);
  });
}

async function renderProfileListRefresh() {
  const [{ profiles }, { boards }, { profileId: activeId }] = await Promise.all([
    send({type:'GET_PROFILES'}), send({type:'GET_BOARDS'}), send({type:'GET_ACTIVE_PROFILE'}),
  ]);
  renderProfileList(profiles, boards, activeId);
}

function renderProfileList(profiles, boards, activeId) {
  const list = document.getElementById('profile-list');
  list.innerHTML = '';
  const filtered = activeBoardFilter ? profiles.filter(p => p.boardId === activeBoardFilter) : profiles;
  if (!filtered.length) {
    list.appendChild(el('div','empty-state','<p>No profiles yet.<br/>Click <strong>+ Profile</strong> to create one.</p>'));
    return;
  }
  filtered.forEach(p => {
    const board = boards.find(b => b.id === p.boardId);
    const card = el('div',`profile-card${p.id===activeId?' active-profile':''}`);
    const body = el('div','profile-card-body');
    body.appendChild(el('div','profile-card-name', `${p.hasPin?'🔒 ':''}${esc(p.name)}`));
    const meta = el('div','profile-card-meta');
    if (board) meta.innerHTML += `<span class="board-dot" style="background:${board.color}"></span><span style="color:${board.color}">${esc(board.name)}</span>`;
    meta.appendChild(document.createTextNode(fmt(p.createdAt)));
    body.appendChild(meta);
    card.appendChild(body);

    const actions = el('div','profile-actions');
    if (p.id === activeId) actions.appendChild(el('span','active-dot',''));
    else {
      const use = el('button','ghost-btn sm','Use');
      use.onclick = async e => { e.stopPropagation(); await send({type:'SET_ACTIVE_PROFILE',profileId:p.id}); showToast(`Active: ${p.name}`); initProfiles(); initHome(); };
      actions.appendChild(use);
    }
    const edit = el('button','icon-btn');
    edit.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
    edit.onclick = e => { e.stopPropagation(); openProfileEditor(p, boards); };
    actions.appendChild(edit);
    card.appendChild(actions);
    card.addEventListener('click', async () => { await send({type:'SET_ACTIVE_PROFILE',profileId:p.id}); showToast(`Active: ${p.name}`); initProfiles(); initHome(); });
    list.appendChild(card);
  });
}

// Board editor
document.getElementById('new-board-btn').addEventListener('click', () => {
  document.getElementById('board-editor').classList.remove('hidden');
  document.getElementById('board-name-input').value = '';
  document.getElementById('board-name-input').focus();
});
document.getElementById('board-cancel-btn').addEventListener('click', () => document.getElementById('board-editor').classList.add('hidden'));
document.getElementById('board-save-btn').addEventListener('click', async () => {
  const name = document.getElementById('board-name-input').value.trim();
  if (!name) return;
  const color = document.getElementById('board-color-input').value;
  await send({type:'SAVE_BOARD', board:{name,color}});
  document.getElementById('board-editor').classList.add('hidden');
  initProfiles();
});

// Profile editor open/close
function openProfileEditor(profile, boards) {
  editingProfileId = profile?.id || null;
  document.getElementById('profile-editor').classList.remove('hidden');
  document.getElementById('editor-title').textContent = profile ? 'Edit Profile' : 'New Profile';
  document.getElementById('edit-profile-id').value = profile?.id || '';
  document.getElementById('edit-profile-name').value = profile?.name || '';
  document.getElementById('delete-profile-btn').classList.toggle('hidden', !profile);

  // populate board select
  const boardSel = document.getElementById('edit-profile-board');
  boardSel.innerHTML = '<option value="">— No board —</option>';
  (boards||[]).forEach(b => {
    const opt = document.createElement('option');
    opt.value = b.id; opt.textContent = b.name;
    if (profile?.boardId === b.id) opt.selected = true;
    boardSel.appendChild(opt);
  });

  // populate form fields
  const form = document.getElementById('profile-form');
  form.querySelectorAll('[name]').forEach(input => { input.value = profile?.data?.[input.name] || ''; });

  // PIN status
  const pinStatus = document.getElementById('pin-status');
  const pinToggleBtn = document.getElementById('pin-toggle-btn');
  const pinSetRow = document.getElementById('pin-set-row');
  if (profile?.hasPin) {
    pinStatus.textContent = 'PIN is set'; pinToggleBtn.textContent = 'Remove PIN'; pinSetRow.classList.add('hidden');
    pinToggleBtn.onclick = async () => {
      const pin = prompt('Enter current PIN to remove it:');
      if (!pin) return;
      const res = await send({type:'REMOVE_PROFILE_PIN', profileId:editingProfileId, pin});
      if (res.error) showToast('Wrong PIN'); else { showToast('PIN removed'); closeProfileEditor(); initProfiles(); }
    };
  } else {
    pinStatus.textContent = 'No PIN'; pinToggleBtn.textContent = 'Set PIN'; pinSetRow.classList.add('hidden');
    pinToggleBtn.onclick = () => pinSetRow.classList.toggle('hidden');
  }

  document.getElementById('pin-save-btn').onclick = async () => {
    const pin = document.getElementById('pin-input').value;
    if (!pin || pin.length < 4) { showToast('PIN must be 4–8 digits'); return; }
    if (!editingProfileId) { showToast('Save profile first'); return; }
    await send({type:'SET_PROFILE_PIN', profileId:editingProfileId, pin});
    showToast('PIN set!'); pinSetRow.classList.add('hidden'); pinStatus.textContent = 'PIN is set';
  };

  // dynamic fields
  renderDynamicFields(profile?.data || {});
}

function closeProfileEditor() {
  document.getElementById('profile-editor').classList.add('hidden');
  editingProfileId = null;
}

document.getElementById('back-to-profiles').addEventListener('click', closeProfileEditor);
document.getElementById('new-profile-btn').addEventListener('click', async () => {
  const { boards } = await send({type:'GET_BOARDS'});
  openProfileEditor(null, boards);
});

// Dynamic fields
let dynamicFieldCount = 0;
function renderDynamicFields(data) {
  const container = document.getElementById('dynamic-fields-list');
  container.innerHTML = '';
  dynamicFieldCount = 0;
  Object.entries(data).filter(([,v]) => v && typeof v === 'object' && v.type === 'dynamic').forEach(([key, def]) => addDynamicFieldRow(key, def.fetchUrl, def.selector));
}

function addDynamicFieldRow(fieldName='', fetchUrl='', selector='') {
  const idx = dynamicFieldCount++;
  const row = el('div','dynamic-field-row');
  row.innerHTML = `
    <div class="df-inputs">
      <span class="df-label">Field key</span>
      <input class="df-key" type="text" placeholder="e.g. currentTitle" value="${esc(fieldName)}"/>
      <button class="df-remove" type="button" title="Remove">✕</button>
    </div>
    <div class="df-inputs">
      <span class="df-label">URL</span>
      <input class="df-url" type="url" placeholder="https://…" value="${esc(fetchUrl)}"/>
    </div>
    <div class="df-inputs">
      <span class="df-label">CSS selector</span>
      <input class="df-sel" type="text" placeholder=".job-title or #name" value="${esc(selector)}"/>
    </div>`;
  row.querySelector('.df-remove').onclick = () => row.remove();
  document.getElementById('dynamic-fields-list').appendChild(row);
}

document.getElementById('add-dynamic-field-btn').addEventListener('click', () => addDynamicFieldRow());

// Profile form submit
document.getElementById('profile-form').addEventListener('submit', async e => {
  e.preventDefault();
  const data = {};
  new FormData(e.target).forEach((v,k) => { if(v) data[k]=v; });
  // collect dynamic fields
  document.querySelectorAll('.dynamic-field-row').forEach(row => {
    const key = row.querySelector('.df-key').value.trim();
    const url = row.querySelector('.df-url').value.trim();
    const sel = row.querySelector('.df-sel').value.trim();
    if (key && url) data[key] = { type:'dynamic', fetchUrl:url, selector:sel };
  });
  const id = document.getElementById('edit-profile-id').value || crypto.randomUUID();
  const name = document.getElementById('edit-profile-name').value.trim() || 'Profile';
  const boardId = document.getElementById('edit-profile-board').value || null;
  const res = await send({type:'SAVE_PROFILE', profile:{id, name, boardId, data, createdAt:new Date().toISOString()}});
  if (res.success) { editingProfileId = id; showToast('Profile saved!'); closeProfileEditor(); initProfiles(); initHome(); }
  else showToast('Error saving.');
});

document.getElementById('delete-profile-btn').addEventListener('click', async () => {
  if (!editingProfileId || !confirm('Delete this profile?')) return;
  await send({type:'DELETE_PROFILE', profileId:editingProfileId});
  showToast('Profile deleted.'); closeProfileEditor(); initProfiles(); initHome();
});

// ===================== TEMPLATES =====================

let editingTemplateId = null;

async function initTemplates() {
  const [{ templates }, { profiles }] = await Promise.all([send({type:'GET_TEMPLATES'}), send({type:'GET_PROFILES'})]);
  const list = document.getElementById('template-list');
  list.innerHTML = '';
  if (!templates.length) {
    list.appendChild(el('div','empty-state','<p>No templates yet.<br/>Create one to fill known forms without an AI call.</p>'));
    return;
  }
  const profileMap = Object.fromEntries((profiles||[]).map(p=>[p.id,p.name]));
  templates.forEach(t => {
    const card = el('div','template-card');
    const body = el('div','template-card-body');
    body.appendChild(el('div','template-card-name', esc(t.name)));
    const meta = el('div','template-card-meta');
    if (t.urlPattern) meta.appendChild(el('span','template-tag','🔗 '+esc(t.urlPattern)));
    const mapCount = Object.keys(t.fieldMappings||{}).length;
    meta.appendChild(el('span','template-tag',`${mapCount} field${mapCount!==1?'s':''}`));
    if (t.profileId && profileMap[t.profileId]) meta.appendChild(el('span','template-tag','👤 '+esc(profileMap[t.profileId])));
    body.appendChild(meta);
    card.appendChild(body);
    const edit = el('button','icon-btn');
    edit.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
    edit.onclick = e => { e.stopPropagation(); openTemplateEditor(t, profiles); };
    card.appendChild(edit);
    card.addEventListener('click', () => openTemplateEditor(t, profiles));
    list.appendChild(card);
  });
}

function openTemplateEditor(tpl, profiles) {
  editingTemplateId = tpl?.id || null;
  document.getElementById('template-editor').classList.remove('hidden');
  document.getElementById('tpl-editor-title').textContent = tpl ? 'Edit Template' : 'New Template';
  document.getElementById('tpl-id').value = tpl?.id || '';
  document.getElementById('tpl-name').value = tpl?.name || '';
  document.getElementById('tpl-desc').value = tpl?.description || '';
  document.getElementById('tpl-url-pattern').value = tpl?.urlPattern || '';
  document.getElementById('delete-template-btn').classList.toggle('hidden', !tpl);

  const sel = document.getElementById('tpl-profile-select');
  sel.innerHTML = '<option value="">— Any active profile —</option>';
  (profiles||[]).forEach(p => { const o = document.createElement('option'); o.value=p.id; o.textContent=p.name; if(tpl?.profileId===p.id) o.selected=true; sel.appendChild(o); });

  // mappings
  const mappingsEl = document.getElementById('tpl-mappings-list');
  mappingsEl.innerHTML = '';
  Object.entries(tpl?.fieldMappings||{}).forEach(([k,v]) => addMappingRow(k,v));
}

function closeTemplateEditor() {
  document.getElementById('template-editor').classList.add('hidden');
  editingTemplateId = null;
}

function addMappingRow(labelOrName='', value='') {
  const row = el('div','mapping-row');
  row.innerHTML = `<input class="map-key" type="text" placeholder="Field label or name" value="${esc(labelOrName)}"/><span class="mapping-arrow">→</span><input class="map-val" type="text" placeholder="Value or {{profileField}}" value="${esc(value)}"/><button class="mapping-remove" type="button">✕</button>`;
  row.querySelector('.mapping-remove').onclick = () => row.remove();
  document.getElementById('tpl-mappings-list').appendChild(row);
}

document.getElementById('new-template-btn').addEventListener('click', async () => {
  const { profiles } = await send({type:'GET_PROFILES'});
  openTemplateEditor(null, profiles);
});
document.getElementById('back-to-templates').addEventListener('click', closeTemplateEditor);
document.getElementById('add-mapping-btn').addEventListener('click', () => addMappingRow());

document.getElementById('template-form').addEventListener('submit', async e => {
  e.preventDefault();
  const fieldMappings = {};
  document.querySelectorAll('.mapping-row').forEach(row => {
    const k = row.querySelector('.map-key').value.trim();
    const v = row.querySelector('.map-val').value;
    if (k) fieldMappings[k] = v;
  });
  const tpl = {
    id: document.getElementById('tpl-id').value || crypto.randomUUID(),
    name: document.getElementById('tpl-name').value.trim(),
    description: document.getElementById('tpl-desc').value.trim(),
    urlPattern: document.getElementById('tpl-url-pattern').value.trim(),
    profileId: document.getElementById('tpl-profile-select').value || null,
    fieldMappings,
    createdAt: new Date().toISOString(),
  };
  const res = await send({type:'SAVE_TEMPLATE', template:tpl});
  if (res.success) { showToast('Template saved!'); closeTemplateEditor(); initTemplates(); initHome(); }
  else showToast('Error saving.');
});

document.getElementById('delete-template-btn').addEventListener('click', async () => {
  if (!editingTemplateId || !confirm('Delete this template?')) return;
  await send({type:'DELETE_TEMPLATE', templateId:editingTemplateId});
  showToast('Template deleted.'); closeTemplateEditor(); initTemplates(); initHome();
});

// ===================== HISTORY =====================

async function initHistory() {
  const { history } = await send({type:'GET_HISTORY'});
  const list = document.getElementById('history-list');
  const empty = document.getElementById('history-empty');
  list.innerHTML = '';
  if (!history?.length) { empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');
  history.forEach(h => {
    const item = el('div','history-item');
    const title = h.pageTitle || h.url || 'Unknown page';
    const host = (() => { try { return new URL(h.url).hostname; } catch { return h.url||''; } })();
    item.appendChild(el('div','history-title', esc(title)));
    const meta = el('div','history-meta');
    meta.appendChild(document.createTextNode(host));
    meta.appendChild(el('span','h-badge',`${h.fieldsFilled} filled`));
    if (h.usedTemplate) meta.appendChild(el('span','h-tpl','⚡ '+esc(h.usedTemplate)));
    if (h.profileName) meta.appendChild(document.createTextNode(h.profileName));
    meta.appendChild(document.createTextNode(fmt(h.timestamp)));
    item.appendChild(meta);
    list.appendChild(item);
  });
}

document.getElementById('clear-history-btn').addEventListener('click', async () => {
  if (!confirm('Clear all fill history?')) return;
  await send({type:'CLEAR_HISTORY'}); showToast('History cleared.'); initHistory();
});

// ===================== SETTINGS =====================

async function initSettings() {
  const { settings } = await send({type:'GET_SETTINGS'});
  if (!settings) return;
  document.getElementById('api-key-input').value = settings.apiKey || '';
  document.getElementById('backend-url-input').value = settings.backendUrl || '';
  document.getElementById('backend-token-input').value = settings.backendToken || '';
  document.getElementById('auto-fill-toggle').checked = settings.autoFillOnLoad || false;
}

document.getElementById('settings-form').addEventListener('submit', async e => {
  e.preventDefault();
  const { settings } = await send({type:'GET_SETTINGS'});
  await send({type:'SAVE_SETTINGS', settings:{...settings,
    apiKey: document.getElementById('api-key-input').value.trim(),
    backendUrl: document.getElementById('backend-url-input').value.trim(),
    backendToken: document.getElementById('backend-token-input').value.trim(),
    autoFillOnLoad: document.getElementById('auto-fill-toggle').checked,
  }});
  showToast('Settings saved!'); initHome();
});

document.getElementById('sync-btn').addEventListener('click', async () => {
  document.getElementById('sync-btn').textContent = 'Syncing…';
  const res = await send({type:'SYNC_TO_BACKEND'});
  document.getElementById('sync-btn').textContent = 'Sync to Backend';
  showToast(res.error ? `Sync failed: ${res.error}` : 'Synced!');
});

// Backup export
document.getElementById('export-btn').addEventListener('click', async () => {
  const { backup } = await send({type:'EXPORT_BACKUP'});
  const date = new Date().toISOString().slice(0,10);
  downloadJson(backup, `fill-a-form-backup-${date}.faf`);
  showToast('Backup downloaded!');
});

// Backup import
document.getElementById('import-input').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = await readJsonFile(file);
    const res = await send({type:'IMPORT_BACKUP', data});
    if (res.error) showToast(`Import failed: ${res.error}`);
    else { showToast(`Imported ${res.profileCount} profile${res.profileCount!==1?'s':''}!`); initHome(); }
  } catch (err) { showToast(err.message); }
  e.target.value = '';
});

// ===================== INIT =====================
initHome();
