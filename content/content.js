(() => {
  let fillButton = null;
  let isProcessing = false;
  let quickPasteOverlay = null;

  // ===================== FIELD DETECTION =====================

  function getFormFields() {
    const sel = 'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="image"]), textarea, select';
    return Array.from(document.querySelectorAll(sel))
      .filter(el => el.offsetParent !== null)
      .map((el, i) => ({
        id: el.id || el.name || `field_${i}`,
        element_index: i,
        label: findLabel(el),
        type: el.type || el.tagName.toLowerCase(),
        name: el.name || '',
        placeholder: el.placeholder || '',
        autocomplete: el.autocomplete || '',
      }))
      .filter(f => f.label || f.name || f.placeholder);
  }

  function findLabel(el) {
    if (el.id) {
      const lbl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (lbl) return lbl.innerText.trim();
    }
    const parent = el.closest('label');
    if (parent) return parent.innerText.replace(el.value, '').trim();
    if (el.getAttribute('aria-label')) return el.getAttribute('aria-label');
    const prev = el.previousElementSibling;
    if (prev && ['LABEL','SPAN','P','DIV'].includes(prev.tagName)) return prev.innerText.trim();
    return el.placeholder || el.name || '';
  }

  // ===================== INJECTION =====================

  function injectValues(suggestions) {
    const sel = 'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="image"]), textarea, select';
    const elements = Array.from(document.querySelectorAll(sel)).filter(el => el.offsetParent !== null);
    let filled = 0;
    elements.forEach((el, i) => {
      const id = el.id || el.name || `field_${i}`;
      if (suggestions[id] !== undefined) { setNativeValue(el, suggestions[id]); highlightField(el); filled++; }
    });
    return filled;
  }

  function setNativeValue(el, value) {
    const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype
      : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(el, value); else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function highlightField(el) {
    el.style.transition = 'background-color 0.4s ease';
    el.style.backgroundColor = '#d4edda';
    setTimeout(() => { el.style.backgroundColor = ''; }, 2000);
  }

  // ===================== NOTIFICATIONS =====================

  function showNotification(message, type = 'success') {
    const existing = document.getElementById('faf-notification');
    if (existing) existing.remove();
    const el = document.createElement('div');
    el.id = 'faf-notification';
    el.textContent = message;
    const colors = { success: '#198754', error: '#dc3545', info: '#4f46e5' };
    el.style.cssText = `position:fixed;top:20px;right:20px;z-index:2147483647;padding:12px 18px;border-radius:8px;font-size:14px;font-family:-apple-system,sans-serif;font-weight:500;box-shadow:0 4px 12px rgba(0,0,0,.15);background:${colors[type]||colors.success};color:white;max-width:320px;`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3500);
  }

  // ===================== AUTOFILL =====================

  async function triggerAutofill(profileId) {
    if (isProcessing) return;
    isProcessing = true;
    const fields = getFormFields();
    if (!fields.length) { showNotification('No fillable fields found.', 'error'); isProcessing = false; return; }
    showNotification('Analyzing form fields...', 'info');
    try {
      const res = await chrome.runtime.sendMessage({
        type: 'AUTOFILL_REQUEST', fields,
        pageContext: document.title + ' ' + window.location.hostname,
        url: window.location.href,
        pageTitle: document.title,
        profileId: profileId || null,
      });
      if (res.error) {
        const msgs = { NO_PROFILE: 'Set up a profile first.', NO_API_KEY: 'Add your API key in settings.', LIMIT_REACHED: 'Free limit reached. Upgrade to premium.' };
        showNotification(msgs[res.error] || res.error, 'error');
        return;
      }
      const filled = injectValues(res.suggestions);
      showNotification(`Filled ${filled} field${filled !== 1 ? 's' : ''}!`);
      closeQuickPaste();
    } catch { showNotification('Something went wrong.', 'error'); }
    finally { isProcessing = false; }
  }

  // ===================== QUICK PASTE OVERLAY =====================

  async function showQuickPaste() {
    if (quickPasteOverlay) { closeQuickPaste(); return; }

    const [{ profiles }, { profileId: activeId }] = await Promise.all([
      chrome.runtime.sendMessage({ type: 'GET_PROFILES' }),
      chrome.runtime.sendMessage({ type: 'GET_ACTIVE_PROFILE' }),
    ]);

    const fieldCount = getFormFields().length;

    const overlay = document.createElement('div');
    overlay.id = 'faf-quick-paste';
    overlay.innerHTML = `
      <div id="faf-qp-panel">
        <div id="faf-qp-header">
          <span id="faf-qp-logo">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
            Fill-A-Form AI
          </span>
          <button id="faf-qp-close">✕</button>
        </div>
        <div id="faf-qp-body">
          ${fieldCount === 0
            ? '<p id="faf-qp-no-fields">No fillable fields detected on this page.</p>'
            : `<p id="faf-qp-field-count">${fieldCount} field${fieldCount !== 1 ? 's' : ''} detected</p>`}
          <div id="faf-qp-profiles">
            ${(profiles || []).map(p => `
              <button class="faf-qp-profile${p.id === activeId ? ' active' : ''}" data-id="${p.id}" data-pin="${p.hasPin ? '1' : '0'}">
                <span class="faf-qp-pname">${escHtml(p.name)}</span>
                ${p.hasPin ? '<span class="faf-qp-lock">🔒</span>' : ''}
                ${p.id === activeId ? '<span class="faf-qp-check">✓</span>' : ''}
              </button>`).join('')}
          </div>
          ${fieldCount > 0 ? `<button id="faf-qp-fill-btn">Fill with AI</button>` : ''}
        </div>
        <div id="faf-pin-prompt" style="display:none">
          <p>Enter PIN to use this profile</p>
          <input id="faf-pin-input" type="password" placeholder="PIN" maxlength="8" />
          <div style="display:flex;gap:8px;margin-top:8px">
            <button id="faf-pin-cancel">Cancel</button>
            <button id="faf-pin-confirm">Confirm</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    quickPasteOverlay = overlay;

    let selectedProfileId = activeId;
    let pendingPinProfileId = null;

    overlay.addEventListener('click', e => { if (e.target === overlay) closeQuickPaste(); });
    document.getElementById('faf-qp-close').addEventListener('click', closeQuickPaste);

    // profile selection
    overlay.querySelectorAll('.faf-qp-profile').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        const hasPin = btn.dataset.pin === '1';
        if (hasPin && id !== activeId) {
          pendingPinProfileId = id;
          document.getElementById('faf-pin-prompt').style.display = 'block';
          document.getElementById('faf-pin-input').focus();
        } else {
          selectProfile(id);
        }
      });
    });

    function selectProfile(id) {
      selectedProfileId = id;
      overlay.querySelectorAll('.faf-qp-profile').forEach(b => b.classList.toggle('active', b.dataset.id === id));
    }

    // PIN prompt
    document.getElementById('faf-pin-cancel')?.addEventListener('click', () => {
      document.getElementById('faf-pin-prompt').style.display = 'none';
      pendingPinProfileId = null;
    });
    document.getElementById('faf-pin-confirm')?.addEventListener('click', async () => {
      const pin = document.getElementById('faf-pin-input').value;
      const { valid } = await chrome.runtime.sendMessage({ type: 'VERIFY_PIN', profileId: pendingPinProfileId, pin });
      if (valid) { selectProfile(pendingPinProfileId); document.getElementById('faf-pin-prompt').style.display = 'none'; }
      else { document.getElementById('faf-pin-input').style.borderColor = '#dc3545'; }
    });

    // fill button
    document.getElementById('faf-qp-fill-btn')?.addEventListener('click', () => triggerAutofill(selectedProfileId));

    // escape key
    overlay._keyHandler = e => { if (e.key === 'Escape') closeQuickPaste(); };
    document.addEventListener('keydown', overlay._keyHandler);
  }

  function closeQuickPaste() {
    if (!quickPasteOverlay) return;
    document.removeEventListener('keydown', quickPasteOverlay._keyHandler);
    quickPasteOverlay.remove();
    quickPasteOverlay = null;
  }

  function escHtml(str) {
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ===================== FLOATING BUTTON =====================

  function createFillButton() {
    if (fillButton) return;
    if (getFormFields().length === 0) return;
    fillButton = document.createElement('button');
    fillButton.id = 'fill-a-form-btn';
    fillButton.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg><span>Fill with AI</span>`;
    fillButton.addEventListener('click', () => triggerAutofill(null));
    document.body.appendChild(fillButton);
  }

  // ===================== MESSAGE LISTENER =====================

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'TRIGGER_AUTOFILL') { triggerAutofill(message.profileId || null); sendResponse({}); }
    if (message.type === 'GET_FIELD_COUNT') sendResponse({ count: getFormFields().length });
    if (message.type === 'SHOW_QUICK_PASTE') { showQuickPaste(); sendResponse({}); }
    return true;
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', createFillButton);
  else createFillButton();
})();
