(() => {
  let isProcessing = false;
  let quickPasteOverlay = null;
  let fillButton = null;

  // detect ATS platform once on load (window.FAF_ATS injected by ats.js before this script)
  const atsPlatform = window.FAF_ATS?.detect() || null;

  // ---- cached field scan (invalidated on DOM mutation) ----
  let cachedFields = null;
  let mutationTimer = null;

  const observer = new MutationObserver(() => {
    cachedFields = null;
    clearTimeout(mutationTimer);
    mutationTimer = setTimeout(maybeShowButton, 600);
  });
  observer.observe(document.body || document.documentElement, { childList: true, subtree: true });

  const FIELD_SEL = 'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="image"]),textarea,select';

  function getFields() {
    if (cachedFields) return cachedFields;
    cachedFields = Array.from(document.querySelectorAll(FIELD_SEL))
      .filter(el => el.offsetParent !== null)
      .map((el, i) => ({
        id:          el.id || el.name || `field_${i}`,
        element_index: i,
        label:       findLabel(el),
        type:        el.type || el.tagName.toLowerCase(),
        name:        el.name || '',
        placeholder: el.placeholder || '',
        autocomplete: el.autocomplete || '',
      }))
      .filter(f => f.label || f.name || f.placeholder);
    return cachedFields;
  }

  function findLabel(el) {
    if (el.id) {
      const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (l) return l.innerText.trim();
    }
    const pl = el.closest('label');
    if (pl) return pl.innerText.replace(el.value, '').trim();
    const aria = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby');
    if (aria) {
      if (el.getAttribute('aria-labelledby')) {
        const ref = document.getElementById(aria);
        if (ref) return ref.innerText.trim();
      }
      return aria;
    }
    const prev = el.previousElementSibling;
    if (prev && ['LABEL','SPAN','P','DIV'].includes(prev.tagName)) return prev.innerText.trim();
    return el.placeholder || el.name || '';
  }

  // ---- value injection ----

  function injectValues(suggestions) {
    const elements = Array.from(document.querySelectorAll(FIELD_SEL)).filter(el => el.offsetParent !== null);
    let filled = 0;
    elements.forEach((el, i) => {
      const id = el.id || el.name || `field_${i}`;
      if (suggestions[id] !== undefined) { setNative(el, suggestions[id]); highlight(el); filled++; }
    });
    return filled;
  }

  function setNative(el, value) {
    const proto = { SELECT: HTMLSelectElement, TEXTAREA: HTMLTextAreaElement }[el.tagName] || HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(proto.prototype, 'value')?.set;
    if (setter) setter.call(el, value); else el.value = value;
    el.dispatchEvent(new Event('input',  { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur',   { bubbles: true }));
  }

  function highlight(el) {
    el.style.transition = 'background-color .3s';
    el.style.backgroundColor = '#d1fae5';
    setTimeout(() => { el.style.backgroundColor = ''; }, 2000);
  }

  // ---- notifications ----

  function notify(msg, type = 'success') {
    document.getElementById('faf-notif')?.remove();
    const n = document.createElement('div');
    n.id = 'faf-notif';
    const colors = { success:'#059669', error:'#dc2626', info:'#4f46e5' };
    n.style.cssText = `position:fixed;top:18px;right:18px;z-index:2147483647;padding:11px 16px;border-radius:10px;font-size:13px;font-family:-apple-system,sans-serif;font-weight:500;box-shadow:0 4px 16px rgba(0,0,0,.18);background:${colors[type]||colors.success};color:#fff;max-width:300px;animation:faf-slide .2s ease`;
    n.textContent = msg;
    // inject keyframe once
    if (!document.getElementById('faf-kf')) {
      const s = document.createElement('style'); s.id='faf-kf';
      s.textContent='@keyframes faf-slide{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}';
      document.head.appendChild(s);
    }
    document.body.appendChild(n);
    setTimeout(() => n.remove(), 3200);
  }

  // ---- autofill ----

  async function triggerAutofill(profileId) {
    if (isProcessing) return;
    isProcessing = true;
    const fields = getFields();
    if (!fields.length) { notify('No fillable fields found.', 'error'); isProcessing = false; return; }

    // ATS-aware path: skip the generic field scan and use platform-specific fill
    if (atsPlatform && window.FAF_ATS) {
      notify('Filling form…', 'info');
      try {
        const res = await chrome.runtime.sendMessage({ type: 'ATS_FILL', profileId: profileId || null });
        if (res.error) {
          const msgs = { NO_PROFILE: 'Set up a profile first.' };
          notify(msgs[res.error] || res.error, 'error');
          return;
        }
        const filled = await window.FAF_ATS.fill(atsPlatform, res.profileData);
        const label = window.FAF_ATS.PLATFORM_LABELS[atsPlatform] || atsPlatform;
        notify(`Filled ${filled} field${filled!==1?'s':''} on ${label}!`);
        closeQuickPaste();
      } catch { notify('Something went wrong. Please try again.', 'error'); }
      finally { isProcessing = false; }
      return;
    }

    notify('Filling form…', 'info');
    try {
      const res = await chrome.runtime.sendMessage({
        type: 'AUTOFILL_REQUEST', fields,
        pageContext: `${document.title} ${location.hostname}`,
        url: location.href, pageTitle: document.title,
        profileId: profileId || null,
      });
      if (res.error) {
        const msgs = { NO_PROFILE:'Set up a profile first.', NO_API_KEY:'Add your Claude API key in Settings.', LIMIT_REACHED:'Free limit reached. Upgrade to premium.' };
        notify(msgs[res.error] || res.error, 'error');
        return;
      }
      const filled = injectValues(res.suggestions);
      const via = res.method === 'template' ? ' (template)' : res.method === 'heuristic' ? ' (smart match)' : '';
      notify(`Filled ${filled} field${filled!==1?'s':''}${via}!`);
      closeQuickPaste();
    } catch { notify('Something went wrong. Please try again.', 'error'); }
    finally { isProcessing = false; }
  }

  // ---- quick paste overlay ----

  async function showQuickPaste() {
    if (quickPasteOverlay) { closeQuickPaste(); return; }

    const [{ profiles }, { profileId: activeId }] = await Promise.all([
      chrome.runtime.sendMessage({ type: 'GET_PROFILES' }),
      chrome.runtime.sendMessage({ type: 'GET_ACTIVE_PROFILE' }),
    ]);

    const fieldCount = getFields().length;
    const wrap = document.createElement('div');
    wrap.id = 'faf-qp';
    wrap.innerHTML = `<div id="faf-qp-panel">
      <div id="faf-qp-hd">
        <span id="faf-qp-logo"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>Fill-A-Form AI</span>
        <button id="faf-qp-x">✕</button>
      </div>
      <div id="faf-qp-bd">
        <p id="faf-qp-fc">${atsPlatform ? `<span style="font-size:10px;background:#4f46e5;color:#fff;border-radius:4px;padding:1px 6px;margin-right:6px">${window.FAF_ATS.PLATFORM_LABELS[atsPlatform]||atsPlatform}</span>` : ''}${fieldCount > 0 ? `${fieldCount} field${fieldCount!==1?'s':''} detected` : 'No fillable fields on this page'}</p>
        <div id="faf-qp-pl">${(profiles||[]).map(p=>`
          <button class="faf-qp-p${p.id===activeId?' faf-active':''}" data-id="${p.id}" data-pin="${p.hasPin?'1':'0'}">
            <span class="faf-qp-av">${escHtml(p.name[0]||'?')}</span>
            <span class="faf-qp-pn">${escHtml(p.name)}</span>
            ${p.hasPin?'<span class="faf-qp-lk">🔒</span>':''}
            ${p.id===activeId?'<span class="faf-qp-ck">✓</span>':''}
          </button>`).join('')}
        </div>
        ${fieldCount>0?'<button id="faf-qp-fill">Fill with AI</button>':''}
      </div>
      <div id="faf-pin-wrap" style="display:none">
        <p>Enter PIN for this profile</p>
        <input id="faf-pin-in" type="password" placeholder="PIN" maxlength="8"/>
        <div class="faf-pin-btns">
          <button id="faf-pin-cancel">Cancel</button>
          <button id="faf-pin-ok">Confirm</button>
        </div>
      </div>
    </div>`;
    document.body.appendChild(wrap);
    quickPasteOverlay = wrap;

    let selectedId = activeId;
    let pendingPin = null;

    wrap.addEventListener('click', e => { if (e.target === wrap) closeQuickPaste(); });
    document.getElementById('faf-qp-x').addEventListener('click', closeQuickPaste);

    wrap.querySelectorAll('.faf-qp-p').forEach(btn => btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      if (btn.dataset.pin === '1' && id !== activeId) {
        pendingPin = id;
        document.getElementById('faf-pin-wrap').style.display = 'block';
        document.getElementById('faf-pin-in').focus();
      } else { selectProfile(id); }
    }));

    function selectProfile(id) {
      selectedId = id;
      wrap.querySelectorAll('.faf-qp-p').forEach(b => b.classList.toggle('faf-active', b.dataset.id === id));
    }

    document.getElementById('faf-pin-cancel')?.addEventListener('click', () => {
      document.getElementById('faf-pin-wrap').style.display = 'none'; pendingPin = null;
    });
    document.getElementById('faf-pin-ok')?.addEventListener('click', async () => {
      const pin = document.getElementById('faf-pin-in').value;
      const { valid } = await chrome.runtime.sendMessage({ type: 'VERIFY_PIN', profileId: pendingPin, pin });
      if (valid) { selectProfile(pendingPin); document.getElementById('faf-pin-wrap').style.display = 'none'; }
      else document.getElementById('faf-pin-in').style.borderColor = '#dc2626';
    });

    document.getElementById('faf-qp-fill')?.addEventListener('click', () => triggerAutofill(selectedId));

    wrap._kh = e => { if (e.key === 'Escape') closeQuickPaste(); };
    document.addEventListener('keydown', wrap._kh);
  }

  function closeQuickPaste() {
    if (!quickPasteOverlay) return;
    document.removeEventListener('keydown', quickPasteOverlay._kh);
    quickPasteOverlay.remove();
    quickPasteOverlay = null;
  }

  function escHtml(s) { return s.replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

  // ---- floating button ----

  function maybeShowButton() {
    if (fillButton) { if (!getFields().length) { fillButton.remove(); fillButton = null; } return; }
    if (!getFields().length) return;
    fillButton = document.createElement('button');
    fillButton.id = 'faf-btn';
    fillButton.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>Fill with AI`;
    fillButton.addEventListener('click', () => triggerAutofill(null));
    document.body.appendChild(fillButton);
  }

  // ---- message listener ----

  chrome.runtime.onMessage.addListener((msg, _s, reply) => {
    if (msg.type === 'TRIGGER_AUTOFILL') { triggerAutofill(msg.profileId || null); reply({}); }
    if (msg.type === 'GET_FIELD_COUNT')  reply({ count: getFields().length });
    if (msg.type === 'SHOW_QUICK_PASTE') { showQuickPaste(); reply({}); }
    return true;
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', maybeShowButton);
  else maybeShowButton();
})();
