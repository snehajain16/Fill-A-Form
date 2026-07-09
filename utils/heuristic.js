/**
 * Rule-based form field matcher — no AI required.
 * Priority: autocomplete attribute > label text > field name/id > placeholder.
 */

// Maps HTML autocomplete values → profile keys
const AUTOCOMPLETE_MAP = {
  'given-name':        'firstName',
  'additional-name':   'middleName',
  'family-name':       'lastName',
  'name':              'fullName',
  'email':             'email',
  'tel':               'phone',
  'tel-national':      'phone',
  'bday':              'dob',
  'address-line1':     'address1',
  'address-line2':     'address2',
  'address-level2':    'city',
  'address-level1':    'state',
  'postal-code':       'zip',
  'country-name':      'country',
  'country':           'country',
  'organization':      'company',
  'organization-title':'occupation',
  'url':               'linkedin',
};

// Maps profile key → regex patterns to match against label/name/placeholder/id
const FIELD_PATTERNS = {
  fullName:       [/^name$/i, /full.?name/i, /your.?name/i, /display.?name/i],
  firstName:      [/first.?name/i, /given.?name/i, /\bfname\b/i, /forename/i, /\bfirst\b/i],
  lastName:       [/last.?name/i, /family.?name/i, /surname/i, /\blname\b/i, /\blast\b/i],
  email:          [/e-?mail/i],
  phone:          [/phone/i, /\btel\b/i, /mobile/i, /\bcell\b/i, /contact.?number/i],
  dob:            [/birth/i, /\bdob\b/i, /birthday/i, /date.?of.?birth/i],
  address1:       [/address.?(line.?)?1/i, /street.?address/i, /^address$/i, /^addr$/i],
  address2:       [/address.?(line.?)?2/i, /apt/i, /suite/i, /\bunit\b/i, /floor/i],
  city:           [/\bcity\b/i, /town/i, /municipality/i, /suburb/i],
  state:          [/\bstate\b/i, /province/i, /region/i, /county(?!\s*y)/i],
  zip:            [/zip/i, /postal/i, /postcode/i, /\bpcode\b/i],
  country:        [/country/i, /nation(?!ality)/i],
  company:        [/company/i, /organization/i, /organisation/i, /employer/i, /business/i, /\bfirm\b/i],
  occupation:     [/occupation/i, /job.?title/i, /\btitle\b/i, /position/i, /\brole\b/i, /profession/i],
  passportNumber: [/passport/i, /id.?number/i, /document.?number/i, /\bnid\b/i],
  nationality:    [/nationality/i, /citizenship/i],
  linkedin:       [/linkedin/i],
};

/**
 * Match a single field against the profile using heuristics.
 * Returns { key, value } or null.
 */
function matchField(field, profileData) {
  // 1. autocomplete attribute (highest confidence)
  const acKey = AUTOCOMPLETE_MAP[field.autocomplete];
  if (acKey && profileData[acKey]) return { key: acKey, value: profileData[acKey] };

  // 2. Pattern match against label, name, id, placeholder (in priority order)
  const candidates = [field.label, field.name, field.id, field.placeholder].map(s => (s || '').trim()).filter(Boolean);

  for (const [profileKey, patterns] of Object.entries(FIELD_PATTERNS)) {
    if (!profileData[profileKey]) continue;
    for (const candidate of candidates) {
      if (patterns.some(p => p.test(candidate))) {
        return { key: profileKey, value: profileData[profileKey] };
      }
    }
  }

  return null;
}

/**
 * Fill all fields using heuristics. Returns { fieldId → value } map.
 */
export function heuristicFill(fields, profileData) {
  const suggestions = {};
  for (const field of fields) {
    const match = matchField(field, profileData);
    if (match) suggestions[field.id] = match.value;
  }
  return suggestions;
}

/**
 * Hybrid: heuristic first, returns unmatched fields for AI fallback.
 */
export function heuristicFillWithGaps(fields, profileData) {
  const suggestions = {};
  const unmatched = [];
  for (const field of fields) {
    const match = matchField(field, profileData);
    if (match) suggestions[field.id] = match.value;
    else unmatched.push(field);
  }
  return { suggestions, unmatched };
}
