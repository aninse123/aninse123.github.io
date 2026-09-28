// Search CRM helpers for the mobile app, COPIED VERBATIM from portal/search.html
// by tests/portal/gen_mobile_helpers.py. Do not edit here: change search.html and
// regenerate. tests/portal/mobile_parity checks they still match the desktop's.

export let tierRules = [];
export function setTierRules(r){ tierRules = Array.isArray(r) ? r : []; }

function deburr(s){ return String(s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().trim(); }
function onlyDigits(s){ return String(s||'').replace(/\D/g,''); }
const PERSON_SALUT = /^(mr|mrs|ms|miss|dr|dra|eng|engo|enga|prof|sr|sra|d)\s+/;
function personNameKey(name){
  let s = deburr(String(name||'')).replace(/[.,\-–—&/()']/g,' ').replace(/\s+/g,' ').trim();
  let prev; do { prev = s; s = s.replace(PERSON_SALUT,''); } while (s !== prev); // strip stacked salutations
  return s.toUpperCase();
}
function nifFromAny(nif, bvd){
  const a = onlyDigits(nif);
  if (a.length === 9) return a;
  const b = String(bvd || '').trim().toUpperCase();
  const m = b.match(/^PT(\d{9})$/);
  return m ? m[1] : '';
}
function foundedYear(co){
  const doi = String(co.dateOfIncorporation || '');
  const y = /^\d{4}/.test(doi) ? Number(doi.slice(0, 4)) : null;
  return y || (co.yearFounded ? Number(co.yearFounded) : null);
}
function legalFormOf(co){ return co.nationalLegalForm || co.legalForm || ''; }
function personAge(p){
  const b = String(p?.birthDate || '').trim();
  const y = b.match(/(\d{4})/);
  if (y){
    const yr = +y[1];
    if (yr > 1900 && yr <= new Date().getFullYear()) return { age: new Date().getFullYear() - yr, exact: true };
  }
  if (p?.orbisAge != null){
    const drift = new Date().getFullYear() - (p.orbisAgeAsOf || new Date().getFullYear());
    return { age: p.orbisAge + drift, exact: false };
  }
  return null;
}
function controlTier(pct){
  if (pct == null) return null;
  if (pct > 50) return { key:'control',     label:'Control',     cls:'badge-green' };
  // Exactly half is a deadlock, not a majority: neither holder can pass a
  // resolution alone. Lumping it in with a 25% minority understates what you
  // would be walking into.
  if (pct === 50) return { key:'joint',     label:'Joint control', cls:'badge-warn' };
  if (pct >= 25) return { key:'significant', label:'Significant', cls:'badge-blue'  };
  if (pct > 0)  return { key:'minority',    label:'Minority',    cls:'badge-grey'  };
  return null;
}
function linkIsCurrent(l){ return l.shCurrent === true || l.mgmtCurrent === true; }
const linkIsShareholder = l => l.shDirectPct != null || l.shTotalPct != null || l.shCurrent != null;
const linkIsManager     = l => (l.mgmtRoles || []).length > 0 || l.mgmtCurrent != null;
const fmtPctOwn = v => v == null ? '—' : (Math.round(v * 100) / 100) + '%';
function resolveOwnership(company, links){
  const om = company?.ownershipMeta || null;
  const current = links.filter(l => l.shCurrent === true);
  const out = { source:null, ownerIds:new Set(), guoName:om?.guoName || null,
                guoNif:om?.guoNif || null, guoType:om?.guoType || null,
                treasuryPct:om?.treasuryPct ?? null,
                independent:false, note:'' };

  if (om && om.cshKeys && om.cshKeys.length){
    out.source = 'orbis';
    for (const l of current){
      const nameKey = personNameKey(l.personName || '');
      if (om.cshKeys.includes(l.personId) || om.cshKeys.includes(nameKey)) out.ownerIds.add(l.personId);
    }
    out.note = out.ownerIds.size
      ? 'Controlling shareholder per Orbis'
      : `Controlling shareholder per Orbis: ${om.cshNames?.join(', ') || '—'} (not a direct shareholder)`;
    return out;
  }
  // Orbis names no controlling shareholder AND places the company at the top of
  // its own chain: "Independent co" (nobody controls it) or "GUO" (it is itself
  // a group's ultimate owner, so nothing owns it from above). Both are findings,
  // not gaps, and computing a "largest holder" over them would invent a fact.
  if (om && /independent/i.test(om.entityType || '')){
    out.source = 'orbis'; out.independent = true;
    out.note = 'Independent company — Orbis records no controlling shareholder';
    return out;
  }
  if (om && /^guo$/i.test((om.entityType || '').trim())){
    out.source = 'orbis'; out.independent = true;
    out.note = 'Ultimate owner of its own group — Orbis records no controlling shareholder above it';
    return out;
  }
  // No Orbis control data: fall back to the largest current holding — but only
  // where that is actually evidence of control.
  const withPct = current.filter(l => l.shDirectPct != null);
  if (!withPct.length) return out;
  const max = Math.max(...withPct.map(l => l.shDirectPct));
  if (max <= 0) return out;

  // Shares the company holds in itself outrank every disclosed holder: at
  // MASTER FERRO 97.69% sits in treasury and the largest real holder has 2.3%,
  // so crowning them would be plainly wrong.
  if (out.treasuryPct != null && out.treasuryPct > max){
    out.note = `${out.treasuryPct}% is held by the company in itself, more than any disclosed holder (largest ${max}%) — no controlling owner computed`;
    return out;
  }

  withPct.filter(l => l.shDirectPct === max).forEach(l => out.ownerIds.add(l.personId));
  out.source = 'computed';
  // When most of the register is undisclosed, "largest" says much less than it
  // appears to, so the note names the base it was computed over.
  const disclosed = withPct.reduce((a, l) => a + l.shDirectPct, 0) + (out.treasuryPct || 0);
  const base = disclosed < 50 ? ` of the ${Math.round(disclosed * 100) / 100}% disclosed` : '';
  out.note = out.ownerIds.size > 1
    ? `Largest holding${base} (${out.ownerIds.size}-way tie at ${max}%) — computed, not stated by Orbis`
    : `Largest holding${base} (${max}%) — computed, not stated by Orbis`;
  return out;
}
const LEGACY_ORBIS_FIELD = {
  orbisPhones:'orbisPhone', orbisFaxes:'orbisFax', orbisEmails:'orbisEmail',
  orbisWebsites:'orbisWebsite', orbisAddresses:'orbisAddress',
};
function orbisValues(person, field){
  if (!field) return [];
  const v = person?.[field];
  if (Array.isArray(v)) return v.filter(Boolean);
  if (v) return [v];
  const legacy = person?.[LEGACY_ORBIS_FIELD[field]];
  return legacy ? [legacy] : [];
}
const STAGES = {
  universe:        { label: 'Universe',        cls: 's-universe' },
  screened:        { label: 'Screened',        cls: 's-screened' },
  outreach:        { label: 'Outreach',        cls: 's-outreach' },
  engaged:         { label: 'Engaged',         cls: 's-engaged' },
  teaser_received: { label: 'Teaser Received', cls: 's-teaser_received' },
  under_nda:       { label: 'Under NDA',        cls: 's-under_nda' },
  cim_received:    { label: 'CIM Received',     cls: 's-cim_received' },
  nbo:             { label: 'NBO',              cls: 's-nbo' },
  loi:             { label: 'LOI',              cls: 's-loi' },
  due_diligence:   { label: 'Due Diligence',    cls: 's-due_diligence' },
  financing:       { label: 'Financing',        cls: 's-financing' },
  closing:         { label: 'Closing',          cls: 's-closing' },
  closed:          { label: 'Closed',           cls: 's-closed' },
  pass:            { label: 'Pass',             cls: 's-pass' },
  on_hold:         { label: 'On Hold',          cls: 's-on_hold' },
};
const FINANCIALS_YEARS = ['2016','2017','2018','2019','2020','2021','2022','2023','2024','2025'];
function tierOf(c, rules = tierRules){
  if (['A','B','C'].includes(c?.targetTierManual)) return c.targetTierManual;
  let best = null, bestScore = -1;
  for (const r of rules || []) {
    if (!['A','B','C'].includes(r?.tier) || !['caeCode','naceCode','subSector','sector'].includes(r?.field) || !String(r.value || '').trim()) continue;
    const want = String(r.value).trim(), have = String(c?.[r.field] ?? '').trim();
    const code = r.field === 'caeCode' || r.field === 'naceCode';
    const hit = code ? have.replace(/[.\s]/g, '').startsWith(want.replace(/[.\s]/g, '')) : have.toLowerCase() === want.toLowerCase();
    if (!hit) continue;
    const score = code ? 10 + want.length : r.field === 'subSector' ? 5 : 3;
    if (score > bestScore) { best = r.tier; bestScore = score; }
  }
  return best;
}

export { deburr, onlyDigits, PERSON_SALUT, personNameKey, nifFromAny, foundedYear, legalFormOf, personAge, controlTier, linkIsCurrent, linkIsShareholder, linkIsManager, fmtPctOwn, resolveOwnership, LEGACY_ORBIS_FIELD, orbisValues, STAGES, FINANCIALS_YEARS, tierOf };
