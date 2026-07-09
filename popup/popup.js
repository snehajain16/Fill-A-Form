// ===================== HELPERS =====================

function send(msg) { return chrome.runtime.sendMessage(msg); }

function showToast(msg, duration = 2400) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.classList.add('hidden'), 200); }, duration);
}

function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' +
    d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

// ===================== NAV =====================

const views = ['home-view', 'profiles-view', 'history-view', 'settings-view'];

function showView(id) {
  views.forEach(v => document.getElementById(v).classList.toggle('hidden', v !== id));
  document.querySelectorAll('.nav-btn').forEach(btn =>
    btn.classList.toggle('active', btn.dataset.view === id));
  if (id === 'home-view') initHome();
  if (id === 'profiles-view') initProfiles();
  if (id === 'history-view') initHistory();
  if (id === 'settings-view') initSettings();
}

document.querySelectorAll('.nav-btn').forEach(btn =>
  btn.addEventListener('click', () => showView(btn.dataset.view)));

// ===================== HOME =====================

async function initHome() {
  const [{ profiles }, { profile, profileId }, { settings }, { history }] = await Promise.all([
    send({ type: 'GET_PROFILES' }),
    send({ type: 'GET_ACTIVE_PROFILE' }),
    send({ type: 'GET_SETTINGS' }),
    send({ type: 'GET_HISTORY' }),
  ]);

  // badge
  const badge = document.getElementById('active-profile-badge');
  if (profile) { badge.textContent = profile.name; badge.classList.remove('hidden'); }
  else badge.classList.add('hidden');

  // stats
  const used = settings?.fillCount || 0;
  const limit = settings?.freeLimit || 20;
  document.querySelector('#stat-fills .stat-val').textContent = used;
  document.querySelector('#stat-profiles .stat-val').textContent = profiles?.length || 0;
  document.querySelector('#stat-history .stat-val').textContent = history?.length || 0;

  // usage bar
  const pct = settings?.isPremium ? 0 : Math.min(100, (used / limit) * 100);
  document.getElementById('usage-fill').style.width = pct + '%';
  document.getElementById('usage-label').textContent = settings?.isPremium
    ? 'Premium' : `${used}/${limit}`;

  // alerts
  const alertsEl = document.getElementById('home-alerts');
  alertsEl.innerHTML = '';
  if (!profile) {
    const a = el('div', 'alert warn', '<strong>No profile set.</strong> ');
    const link = el('button', 'link'); link.textContent = 'Create one →';
    link.onclick = () => { showView('profiles-view'); document.getElementById('new-profile-btn').click(); };
    a.appendChild(link);
    alertsEl.appendChild(a);
  }
  if (!settings?.apiKey) {
    const a = el('div', 'alert warn', '<strong>No API key.</strong> ');
    const link = el('button', 'link'); link.textContent = 'Add in Settings →';
    link.onclick = () => showView('settings-view');
    a.appendChild(link);
    alertsEl.appendChild(a);
  }
  if (settings && !settings.isPremium && used >= limit) {
    alertsEl.appendChild(el('div', 'alert warn', `<strong>Free limit reached.</strong> Upgrade to premium for unlimited fills.`));
  }

  // page field count
  const btn = document.getElementById('autofill-btn');
  btn.disabled = true;
  const fieldsEl = document.getElementById('fields-detected');
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => Array.from(document.querySelectorAll(
        'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="image"]), textarea, select'
      )).filter(el => el.offsetParent !== null).length,
    });
    const count = results?.[0]?.result ?? 0;
    fieldsEl.textContent = `${count} fillable field${count !== 1 ? 's' : ''} on this page`;
    btn.disabled = !profile || !settings?.apiKey || count === 0 ||
      (!settings.isPremium && used >= limit);
  } catch {
    fieldsEl.textContent = 'Open a page with a form to autofill';
  }
}

document.getElementById('autofill-btn').addEventListener('click', async () => {
  document.getElementById('autofill-btn').disabled = true;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await chrome.tabs.sendMessage(tab.id, { type: 'TRIGGER_AUTOFILL' });
    showToast('Autofill triggered!');
  } catch {
    showToast('Could not reach page. Try refreshing.');
  }
  setTimeout(initHome, 800);
});

// ===================== PROFILES =====================

let editingProfileId = null;

async function initProfiles() {
  const { profiles } = await send({ type: 'GET_PROFILES' });
  const { profileId: activeId } = await send({ type: 'GET_ACTIVE_PROFILE' });
  const listEl = document.getElementById('profile-list');
  listEl.innerHTML = '';

  if (!profiles || profiles.length === 0) {
    listEl.appendChild(el('div', 'empty-state',
      '<p style="font-size:12px">No profiles yet.<br/>Click <strong>+ New</strong> to create one.</p>'));
    return;
  }

  profiles.forEach(p => {
    const card = el('div', `profile-card${p.id === activeId ? ' active' : ''}`);

    const info = el('div', '');
    info.appendChild(el('div', 'profile-card-name', p.name));
    info.appendChild(el('div', 'profile-card-meta', formatDate(p.createdAt)));
    card.appendChild(info);

    const actions = el('div', 'profile-card-actions');

    if (p.id === activeId) {
      actions.appendChild(el('span', 'active-dot', ''));
    } else {
      const useBtn = el('button', 'ghost-btn'); useBtn.textContent = 'Use';
      useBtn.onclick = async (e) => {
        e.stopPropagation();
        await send({ type: 'SET_ACTIVE_PROFILE', profileId: p.id });
        showToast(`Switched to "${p.name}"`);
        initProfiles();
        initHome();
      };
      actions.appendChild(useBtn);
    }

    const editBtn = el('button', 'icon-btn sm');
    editBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
    editBtn.title = 'Edit';
    editBtn.onclick = (e) => { e.stopPropagation(); openEditor(p); };
    actions.appendChild(editBtn);

    card.appendChild(actions);
    card.addEventListener('click', async () => {
      await send({ type: 'SET_ACTIVE_PROFILE', profileId: p.id });
      showToast(`Active: ${p.name}`);
      initProfiles(); initHome();
    });
    listEl.appendChild(card);
  });
}

function openEditor(profile) {
  editingProfileId = profile?.id || null;
  document.getElementById('profile-list').classList.add('hidden');
  document.getElementById('new-profile-btn').classList.add('hidden');
  document.getElementById('profile-editor').classList.remove('hidden');
  document.getElementById('editor-title').textContent = profile ? 'Edit Profile' : 'New Profile';
  document.getElementById('edit-profile-id').value = profile?.id || '';
  document.getElementById('edit-profile-name').value = profile?.name || '';
  const deleteBtn = document.getElementById('delete-profile-btn');
  deleteBtn.classList.toggle('hidden', !profile);

  const form = document.getElementById('profile-form');
  form.querySelectorAll('[name]').forEach(input => {
    input.value = profile?.data?.[input.name] || '';
  });
}

function closeEditor() {
  document.getElementById('profile-editor').classList.add('hidden');
  document.getElementById('profile-list').classList.remove('hidden');
  document.getElementById('new-profile-btn').classList.remove('hidden');
  editingProfileId = null;
}

document.getElementById('new-profile-btn').addEventListener('click', () => openEditor(null));
document.getElementById('back-to-profiles').addEventListener('click', closeEditor);

document.getElementById('profile-form').addEventListener('submit', async e => {
  e.preventDefault();
  const data = {};
  new FormData(e.target).forEach((v, k) => { if (v) data[k] = v; });
  const id = document.getElementById('edit-profile-id').value || crypto.randomUUID();
  const name = document.getElementById('edit-profile-name').value.trim() || 'Profile';
  const res = await send({
    type: 'SAVE_PROFILE',
    profile: { id, name, data, createdAt: new Date().toISOString() },
  });
  if (res.success) { showToast('Profile saved!'); closeEditor(); initProfiles(); initHome(); }
  else showToast('Error saving profile.');
});

document.getElementById('delete-profile-btn').addEventListener('click', async () => {
  if (!editingProfileId) return;
  if (!confirm('Delete this profile?')) return;
  await send({ type: 'DELETE_PROFILE', profileId: editingProfileId });
  showToast('Profile deleted.');
  closeEditor(); initProfiles(); initHome();
});

// ===================== HISTORY =====================

async function initHistory() {
  const { history } = await send({ type: 'GET_HISTORY' });
  const listEl = document.getElementById('history-list');
  const emptyEl = document.getElementById('history-empty');
  listEl.innerHTML = '';

  if (!history || history.length === 0) {
    emptyEl.classList.remove('hidden');
    return;
  }
  emptyEl.classList.add('hidden');

  history.forEach(h => {
    const item = el('div', 'history-item');
    const title = h.pageTitle || h.url || 'Unknown page';
    const host = (() => { try { return new URL(h.url).hostname; } catch { return h.url; } })();
    item.appendChild(el('div', 'history-item-title', title));
    const meta = el('div', 'history-item-meta');
    meta.appendChild(el('span', '', host));
    meta.appendChild(el('span', 'history-badge', `${h.fieldsFilled} filled`));
    meta.appendChild(el('span', '', h.profileName || ''));
    meta.appendChild(el('span', '', formatDate(h.timestamp)));
    item.appendChild(meta);
    listEl.appendChild(item);
  });
}

document.getElementById('clear-history-btn').addEventListener('click', async () => {
  if (!confirm('Clear all fill history?')) return;
  await send({ type: 'CLEAR_HISTORY' });
  showToast('History cleared.');
  initHistory();
});

// ===================== SETTINGS =====================

async function initSettings() {
  const { settings } = await send({ type: 'GET_SETTINGS' });
  if (!settings) return;
  document.getElementById('api-key-input').value = settings.apiKey || '';
  document.getElementById('backend-url-input').value = settings.backendUrl || '';
  document.getElementById('backend-token-input').value = settings.backendToken || '';
  document.getElementById('auto-fill-toggle').checked = settings.autoFillOnLoad || false;
}

document.getElementById('settings-form').addEventListener('submit', async e => {
  e.preventDefault();
  const { settings } = await send({ type: 'GET_SETTINGS' });
  const updated = {
    ...settings,
    apiKey: document.getElementById('api-key-input').value.trim(),
    backendUrl: document.getElementById('backend-url-input').value.trim(),
    backendToken: document.getElementById('backend-token-input').value.trim(),
    autoFillOnLoad: document.getElementById('auto-fill-toggle').checked,
  };
  const res = await send({ type: 'SAVE_SETTINGS', settings: updated });
  if (res.success) { showToast('Settings saved!'); initHome(); }
});

document.getElementById('sync-btn').addEventListener('click', async () => {
  const btn = document.getElementById('sync-btn');
  btn.textContent = 'Syncing...';
  btn.disabled = true;
  const res = await send({ type: 'SYNC_TO_BACKEND' });
  btn.textContent = 'Sync to Backend';
  btn.disabled = false;
  if (res.error) showToast(`Sync failed: ${res.error}`);
  else showToast('Synced successfully!');
});

// ===================== INIT =====================
initHome();
