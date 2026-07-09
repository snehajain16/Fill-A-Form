(() => {
  let fillButton = null;
  let isProcessing = false;

  function getFormFields() {
    const inputs = document.querySelectorAll(
      'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="image"]), textarea, select'
    );

    return Array.from(inputs)
      .filter(el => el.offsetParent !== null) // visible only
      .map((el, index) => {
        const label = findLabel(el);
        return {
          id: el.id || el.name || `field_${index}`,
          element_index: index,
          label: label,
          type: el.type || el.tagName.toLowerCase(),
          name: el.name || '',
          placeholder: el.placeholder || '',
          autocomplete: el.autocomplete || '',
        };
      })
      .filter(f => f.label || f.name || f.placeholder); // skip truly unlabeled
  }

  function findLabel(el) {
    // explicit label
    if (el.id) {
      const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (label) return label.innerText.trim();
    }
    // parent label
    const parentLabel = el.closest('label');
    if (parentLabel) return parentLabel.innerText.replace(el.value, '').trim();
    // aria-label
    if (el.getAttribute('aria-label')) return el.getAttribute('aria-label');
    // preceding sibling text
    const prev = el.previousElementSibling;
    if (prev && ['LABEL', 'SPAN', 'P', 'DIV'].includes(prev.tagName)) {
      return prev.innerText.trim();
    }
    return el.placeholder || el.name || '';
  }

  function injectValues(suggestions) {
    const inputs = document.querySelectorAll(
      'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="image"]), textarea, select'
    );
    const elements = Array.from(inputs).filter(el => el.offsetParent !== null);

    let filled = 0;
    elements.forEach((el, index) => {
      const id = el.id || el.name || `field_${index}`;
      if (suggestions[id] !== undefined) {
        setNativeValue(el, suggestions[id]);
        highlightField(el);
        filled++;
      }
    });
    return filled;
  }

  function setNativeValue(el, value) {
    // works with React-controlled inputs too
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype,
      'value'
    )?.set || Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;

    if (nativeInputValueSetter) {
      nativeInputValueSetter.call(el, value);
    } else {
      el.value = value;
    }

    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function highlightField(el) {
    el.style.transition = 'background-color 0.4s ease';
    el.style.backgroundColor = '#d4edda';
    setTimeout(() => { el.style.backgroundColor = ''; }, 2000);
  }

  function showNotification(message, type = 'success') {
    const existing = document.getElementById('fill-a-form-notification');
    if (existing) existing.remove();

    const el = document.createElement('div');
    el.id = 'fill-a-form-notification';
    el.textContent = message;
    el.style.cssText = `
      position: fixed; top: 20px; right: 20px; z-index: 2147483647;
      padding: 12px 18px; border-radius: 8px; font-size: 14px;
      font-family: -apple-system, sans-serif; font-weight: 500;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      background: ${type === 'success' ? '#198754' : type === 'error' ? '#dc3545' : '#0d6efd'};
      color: white; max-width: 320px;
    `;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3500);
  }

  async function triggerAutofill() {
    if (isProcessing) return;
    isProcessing = true;

    const fields = getFormFields();
    if (fields.length === 0) {
      showNotification('No fillable fields found on this page.', 'error');
      isProcessing = false;
      return;
    }

    showNotification('Analyzing form fields...', 'info');

    try {
      const pageContext = document.title + ' ' + window.location.hostname;
      const response = await chrome.runtime.sendMessage({
        type: 'AUTOFILL_REQUEST',
        fields,
        pageContext,
      });

      if (response.error) {
        const msgs = {
          NO_PROFILE: 'Please set up your profile first.',
          NO_API_KEY: 'Please add your Claude API key in settings.',
          LIMIT_REACHED: 'Free limit reached (20 fills). Upgrade to premium.',
        };
        showNotification(msgs[response.error] || response.error, 'error');
        return;
      }

      const filled = injectValues(response.suggestions);
      showNotification(`Filled ${filled} field${filled !== 1 ? 's' : ''} successfully!`);
    } catch (err) {
      showNotification('Something went wrong. Please try again.', 'error');
    } finally {
      isProcessing = false;
    }
  }

  function createFillButton() {
    if (fillButton) return;
    const fields = getFormFields();
    if (fields.length === 0) return;

    fillButton = document.createElement('button');
    fillButton.id = 'fill-a-form-btn';
    fillButton.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
      </svg>
      <span>Fill with AI</span>
    `;
    fillButton.addEventListener('click', triggerAutofill);
    document.body.appendChild(fillButton);
  }

  // listen for trigger from popup
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'TRIGGER_AUTOFILL') triggerAutofill();
    if (message.type === 'GET_FIELD_COUNT') {
      return { count: getFormFields().length };
    }
  });

  // auto-inject button when form fields detected
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createFillButton);
  } else {
    createFillButton();
  }
})();
