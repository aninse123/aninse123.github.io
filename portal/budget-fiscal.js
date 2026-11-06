// Budget v2 — small fiscal helpers (plan "Budget v2 - Plan.md", step 0.3).
// Plain functions, no Firebase, so they can be tested in Node and reused
// (supplier NIF in step 1.10, invoice fields in 1.6).

// Digits only: "PT 501 964 843" → "501964843". A Portuguese VAT ID is "PT" + the NIF.
export function normalizeNif(v) {
  return String(v == null ? '' : v).replace(/^\s*PT/i, '').replace(/[\s.\-]/g, '');
}

// Portuguese NIF: 9 digits, check digit = 11 − (Σ d[i]·(9−i), i = 0..7) mod 11, 10 and 11 → 0.
export function isValidNif(v) {
  const n = normalizeNif(v);
  if (!/^\d{9}$/.test(n)) return false;
  let sum = 0;
  for (let i = 0; i < 8; i++) sum += Number(n[i]) * (9 - i);
  let c = 11 - (sum % 11);
  if (c >= 10) c = 0;
  return Number(n[8]) === c;
}

// What the settings form tells the person: 'empty' | 'ok' | 'badFormat' | 'badCheck'.
export function nifStatus(v) {
  const n = normalizeNif(v);
  if (!n) return 'empty';
  if (!/^\d{9}$/.test(n)) return 'badFormat';
  return isValidNif(n) ? 'ok' : 'badCheck';
}

// The company details stored in budgetSettings/main, trimmed and with the NIF as digits.
export function cleanCompanyDetails(d) {
  return {
    companyName: String(d?.companyName || '').trim().slice(0, 200),
    companyNif: normalizeNif(d?.companyNif),
    companyAddress: String(d?.companyAddress || '').trim().slice(0, 500),
  };
}
