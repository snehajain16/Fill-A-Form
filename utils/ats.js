// ATS platform detection and fill logic
// Loaded as a content script before content.js — uses global namespace (no ES modules)

(function () {
  const PLATFORMS = {
    WORKDAY:         'workday',
    GREENHOUSE:      'greenhouse',
    LEVER:           'lever',
    ICIMS:           'icims',
    ASHBY:           'ashby',
    SMARTRECRUITERS: 'smartrecruiters',
  };

  // ---- detection ----

  function detect() {
    const host = location.hostname;
    const doc  = document;

    if (
      host.includes('myworkdayjobs.com') ||
      host.includes('wd1.myworkdayjobs') ||
      doc.querySelector('[data-automation-id="candidateIntro"]') ||
      (doc.querySelector('[data-automation-id="email"]') &&
       doc.querySelector('[data-automation-id="legalNameSection_firstName"]'))
    ) return PLATFORMS.WORKDAY;

    if (
      host.includes('greenhouse.io') ||
      doc.getElementById('application_form') ||
      doc.querySelector('form#new_application') ||
      doc.querySelector('.application--content')
    ) return PLATFORMS.GREENHOUSE;

    if (
      host.includes('lever.co') ||
      doc.querySelector('[name="urls[LinkedIn]"]')
    ) return PLATFORMS.LEVER;

    if (host.includes('icims.com')) return PLATFORMS.ICIMS;

    if (
      host.includes('ashby.hr') ||
      doc.querySelector('[data-testid="JobApplicationForm"]') ||
      doc.querySelector('[data-testid="application-form"]')
    ) return PLATFORMS.ASHBY;

    if (host.includes('smartrecruiters.com')) return PLATFORMS.SMARTRECRUITERS;

    return null;
  }

  // ---- shared helpers ----

  function setVal(el, value) {
    if (!el || value === undefined || value === null || value === '') return false;
    const tag    = el.tagName;
    const proto  = tag === 'SELECT' ? HTMLSelectElement
                 : tag === 'TEXTAREA' ? HTMLTextAreaElement
                 : HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(proto.prototype, 'value')?.set;
    if (setter) setter.call(el, value); else el.value = value;
    ['input', 'change', 'blur'].forEach(evt =>
      el.dispatchEvent(new Event(evt, { bubbles: true }))
    );
    return true;
  }

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  function fullName(d) {
    return d.fullName || [d.firstName, d.lastName].filter(Boolean).join(' ');
  }

  // ---- Workday ----
  // Uses data-automation-id attributes; React-controlled inputs.

  async function fillWorkday(d) {
    let filled = 0;
    const qa = id => document.querySelector(`[data-automation-id="${id}"]`);

    const fields = [
      ['legalNameSection_firstName',      d.firstName],
      ['legalNameSection_lastName',       d.lastName],
      ['email',                           d.email],
      ['phone-number',                    d.phone],
      ['addressSection_addressLine1',     d.address1],
      ['addressSection_city',             d.city],
      ['addressSection_postalCode',       d.zip],
    ];
    for (const [id, val] of fields) {
      if (val && setVal(qa(id), val)) filled++;
    }

    // LinkedIn — various automation IDs in use across tenants
    const liEl = qa('linkedin') ||
                 document.querySelector('[data-automation-id*="inkedIn"]') ||
                 document.querySelector('[data-automation-id*="social"]');
    if (liEl && d.linkedin && setVal(liEl, d.linkedin)) filled++;

    // Country dropdown triggers state to populate — wait after setting
    const countryEl = qa('addressSection_countryRegion');
    if (countryEl && d.country) {
      setVal(countryEl, d.country);
      await sleep(700);
      filled++;
    }
    const stateEl = qa('addressSection_regionSubdivision1');
    if (stateEl && d.state && setVal(stateEl, d.state)) filled++;

    return filled;
  }

  // ---- Greenhouse ----
  // Standard HTML form with predictable IDs.

  async function fillGreenhouse(d) {
    let filled = 0;
    const qi = id => document.getElementById(id);
    const qn = n  => document.querySelector(`input[name="${n}"], textarea[name="${n}"]`);

    const loc = [d.city, d.state, d.country].filter(Boolean).join(', ');
    const pairs = [
      [qi('first_name')     || qn('job_application[first_name]'),  d.firstName],
      [qi('last_name')      || qn('job_application[last_name]'),   d.lastName],
      [qi('email')          || qn('job_application[email]'),       d.email],
      [qi('phone')          || qn('job_application[phone_number]'),d.phone],
      [qi('linkedin_profile'),                                     d.linkedin],
      [qn('job_application[location]'),                            loc],
    ];
    for (const [el, val] of pairs) {
      if (el && val && setVal(el, val)) filled++;
    }
    return filled;
  }

  // ---- Lever ----
  // Clean HTML form with name attributes.

  async function fillLever(d) {
    let filled = 0;
    const qn = n => document.querySelector(`[name="${n}"]`);

    const pairs = [
      [qn('name'),           fullName(d)],
      [qn('email'),          d.email],
      [qn('phone'),          d.phone],
      [qn('org'),            d.company],
      [qn('urls[LinkedIn]'), d.linkedin],
    ];
    for (const [el, val] of pairs) {
      if (el && val && setVal(el, val)) filled++;
    }
    return filled;
  }

  // ---- iCIMS ----
  // Proprietary structure; use label-text heuristic approach.

  async function fillICIMS(d) {
    let filled = 0;
    const inputs = document.querySelectorAll(
      'input:not([type=hidden]):not([type=file]):not([type=submit]), textarea'
    );
    for (const el of inputs) {
      if (!el.offsetParent) continue;
      const label = (
        document.querySelector(`label[for="${el.id}"]`)?.textContent ||
        el.closest('.iCIMS_InstructionWrapper')?.querySelector('label')?.textContent ||
        el.placeholder || el.name || ''
      ).toLowerCase();

      let val = null;
      if (/first.?name/.test(label))          val = d.firstName;
      else if (/last.?name/.test(label))      val = d.lastName;
      else if (/\bemail\b/.test(label))       val = d.email;
      else if (/phone|mobile/.test(label))    val = d.phone;
      else if (/address.*(1|one|line)/.test(label)) val = d.address1;
      else if (/city/.test(label))            val = d.city;
      else if (/state|province/.test(label))  val = d.state;
      else if (/zip|postal/.test(label))      val = d.zip;
      else if (/country/.test(label))         val = d.country;
      else if (/linkedin/.test(label))        val = d.linkedin;

      if (val && setVal(el, val)) filled++;
    }
    return filled;
  }

  // ---- Ashby ----
  // React-based; uses data-testid and placeholder patterns.

  async function fillAshby(d) {
    let filled = 0;
    const inputs = document.querySelectorAll(
      'input:not([type=hidden]):not([type=file]), textarea'
    );
    for (const el of inputs) {
      if (!el.offsetParent) continue;
      const labelEl = document.querySelector(`label[for="${el.id}"]`) || el.closest('label');
      const hint = (
        (el.placeholder || '') + ' ' +
        (labelEl?.textContent || '') + ' ' +
        (el.name || '') + ' ' +
        (el.id || '')
      ).toLowerCase();

      let val = null;
      if (/first.?name/.test(hint))               val = d.firstName;
      else if (/last.?name/.test(hint))           val = d.lastName;
      else if (/full.?name|your.?name/.test(hint))val = fullName(d);
      else if (/\bemail\b/.test(hint))            val = d.email;
      else if (/phone|mobile/.test(hint))         val = d.phone;
      else if (/linkedin/.test(hint))             val = d.linkedin;
      else if (/company|employer/.test(hint))     val = d.company;
      else if (/title|position|role/.test(hint))  val = d.occupation;
      else if (/\bcity\b/.test(hint))             val = d.city;
      else if (/\bstate\b/.test(hint))            val = d.state;

      if (val && setVal(el, val)) filled++;
    }
    return filled;
  }

  // ---- SmartRecruiters ----

  async function fillSmartRecruiters(d) {
    let filled = 0;
    const qi = id => document.getElementById(id);
    const qn = n  => document.querySelector(`[name="${n}"]`);

    const pairs = [
      [qi('firstName')   || qn('firstName'),   d.firstName],
      [qi('lastName')    || qn('lastName'),    d.lastName],
      [qi('email')       || qn('email'),       d.email],
      [qi('phoneNumber') || qn('phoneNumber'), d.phone],
    ];
    for (const [el, val] of pairs) {
      if (el && val && setVal(el, val)) filled++;
    }
    return filled;
  }

  // ---- public API ----

  async function fill(platform, data) {
    switch (platform) {
      case PLATFORMS.WORKDAY:         return fillWorkday(data);
      case PLATFORMS.GREENHOUSE:      return fillGreenhouse(data);
      case PLATFORMS.LEVER:           return fillLever(data);
      case PLATFORMS.ICIMS:           return fillICIMS(data);
      case PLATFORMS.ASHBY:           return fillAshby(data);
      case PLATFORMS.SMARTRECRUITERS: return fillSmartRecruiters(data);
      default: return 0;
    }
  }

  const PLATFORM_LABELS = {
    [PLATFORMS.WORKDAY]:         'Workday',
    [PLATFORMS.GREENHOUSE]:      'Greenhouse',
    [PLATFORMS.LEVER]:           'Lever',
    [PLATFORMS.ICIMS]:           'iCIMS',
    [PLATFORMS.ASHBY]:           'Ashby',
    [PLATFORMS.SMARTRECRUITERS]: 'SmartRecruiters',
  };

  window.FAF_ATS = { detect, fill, PLATFORMS, PLATFORM_LABELS };
})();
