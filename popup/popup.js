// View management
const views = ['main-view', 'profile-view', 'settings-view'];

function showView(id) {
  views.forEach(v => document.getElementById(v).classList.toggle('hidden', v !== id));
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === id);
  });
}

document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => showView(btn.dataset.view));
});

document.getElementById('settings-toggle').addEventListener('click', () => showView('settings-view'));
document.getElementById('go-to-profile')?.addEventListener('click', () => showView('profile-view'));
document.getElementById('go-to-settings')?.addEventListener('click', () => showView('settings-view'));

// Toast
function showToast(msg, duration = 2500) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.remove('hidden');
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.classList.add('hidden'), 200);
  }, duration);
}

// Send message helper
function sendMessage(msg) {
  return chrome.runtime.sendMessage(msg);
}

// ---------- MAIN VIEW ----------
async function initMainView() {
  const [{ profile }, { settings }] = await Promise.all([
    sendMessage({ type: 'GET_PROFILE' }),
    sendMessage({ type: 'GET_SETTINGS' }),
  ]);

  const noProfile = document.getElementById('no-profile-msg');
  const noKey = document.getElementById('no-key-msg');
  const btn = document.getElementById('autofill-btn');
  const fillCountDisplay = document.getElementById('fill-count-display');
  const pageFieldsDisplay = document.getElementById('page-fields-display');

  noProfile.classList.toggle('hidden', !!profile);
  noKey.classList.toggle('hidden', !!(settings.apiKey));
  btn.disabled = !profile || !settings.apiKey;

  if (settings) {
    const used = settings.fillCount || 0;
    const limit = settings.freeLimit || 20;
    fillCountDisplay.textContent = settings.isPremium
      ? 'Premium — unlimited fills'
      : `${used} / ${limit} free fills used`;
  }

  // count fields on active tab
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const inputs = document.querySelectorAll(
          'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="image"]), textarea, select'
        );
        return Array.from(inputs).filter(el => el.offsetParent !== null).length;
      },
    });
    const count = results?.[0]?.result ?? 0;
    pageFieldsDisplay.textContent = `${count} field${count !== 1 ? 's' : ''} detected`;
    if (count === 0) btn.disabled = true;
  } catch {
    pageFieldsDisplay.textContent = '';
  }
}

document.getElementById('autofill-btn').addEventListener('click', async () => {
  const btn = document.getElementById('autofill-btn');
  btn.disabled = true;
  btn.textContent = 'Filling...';
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await chrome.tabs.sendMessage(tab.id, { type: 'TRIGGER_AUTOFILL' });
    showToast('Autofill triggered!');
  } catch {
    showToast('Could not reach page. Try refreshing.');
  } finally {
    setTimeout(() => initMainView(), 600);
  }
});

// ---------- PROFILE VIEW ----------
async function initProfileView() {
  const { profile } = await sendMessage({ type: 'GET_PROFILE' });
  if (!profile) return;
  const form = document.getElementById('profile-form');
  Object.entries(profile).forEach(([key, val]) => {
    const input = form.querySelector(`[name="${key}"]`);
    if (input) input.value = val;
  });
}

document.getElementById('profile-form').addEventListener('submit', async e => {
  e.preventDefault();
  const form = e.target;
  const profile = {};
  new FormData(form).forEach((val, key) => { if (val) profile[key] = val; });
  const res = await sendMessage({ type: 'SAVE_PROFILE', profile });
  if (res.success) showToast('Profile saved!');
  else showToast('Error saving profile.');
});

// ---------- SETTINGS VIEW ----------
async function initSettingsView() {
  const { settings } = await sendMessage({ type: 'GET_SETTINGS' });
  if (!settings) return;

  document.getElementById('api-key-input').value = settings.apiKey || '';
  document.getElementById('auto-fill-toggle').checked = settings.autoFillOnLoad || false;

  const used = settings.fillCount || 0;
  const limit = settings.freeLimit || 20;
  const pct = Math.min(100, (used / limit) * 100);
  document.getElementById('usage-text').textContent = settings.isPremium
    ? 'Premium plan — unlimited fills'
    : `Free plan: ${used} of ${limit} fills used`;
  document.getElementById('usage-fill').style.width = settings.isPremium ? '0%' : `${pct}%`;
}

document.getElementById('settings-form').addEventListener('submit', async e => {
  e.preventDefault();
  const { settings } = await sendMessage({ type: 'GET_SETTINGS' });
  const updated = {
    ...settings,
    apiKey: document.getElementById('api-key-input').value.trim(),
    autoFillOnLoad: document.getElementById('auto-fill-toggle').checked,
  };
  const res = await sendMessage({ type: 'SAVE_SETTINGS', settings: updated });
  if (res.success) {
    showToast('Settings saved!');
    initMainView();
  }
});

// ---------- INIT ----------
(async () => {
  await Promise.all([initMainView(), initProfileView(), initSettingsView()]);
})();
