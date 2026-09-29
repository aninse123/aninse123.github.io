// Feature switches (portal/features.js): the page's list matches the server
// catalog, every data-feature used in a page is a real switch, and Off /
// Test / On decide what a viewer sees (testers, named testers, Preview).
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const server = require('../../functions/features/catalog.js');
const root = new URL('../../portal/', import.meta.url);

// Load features.js without Firebase (strip imports; stub what it touches).
const src = readFileSync(new URL('features.js', root), 'utf8').replace(/\r\n/g, '\n').replace(/^import .*$/gm, '').replace(/^export /gm, '');
const ctx = { localStorage: { getItem: () => null, setItem() {} }, db: {}, doc: () => ({}), onSnapshot: () => {} };
vm.createContext(ctx);
vm.runInContext(src + '\nglobalThis.X = { FEATURES, stateOf, isTester, available, siteOfHost, PAGE_FEATURE };', ctx);
const X = ctx.X;

let fail = 0; const ok = (l, c) => { if (!c) fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); };
const pick = (f) => JSON.stringify({ key: f.key, area: f.area, kind: f.kind, name: f.name, description: f.description, defaults: f.defaults });
ok(`page feature list = server catalog (${server.FEATURES.length} switches)`, JSON.stringify(X.FEATURES.map(pick)) === JSON.stringify(server.FEATURES.map(pick)));

// Every data-feature key in the portal pages exists.
const known = new Set(X.FEATURES.map((f) => f.key));
const files = [...readdirSync(root).filter((f) => /\.(html|js)$/.test(f) && f !== 'features.js').map((f) => new URL(f, root)), new URL('m/index.html', root), new URL('m/app.js', root)];
const used = new Map();
for (const u of files) {
  const s = readFileSync(u, 'utf8');
  for (const m of s.matchAll(/data-feature="([^"$]+)"/g)) m[1].split(/\s+/).forEach((k) => used.set(k, (used.get(k) || []).concat(String(u).split('/portal/')[1])));
  for (const m of s.matchAll(/isOn\('([^']+)'\)/g)) used.set(m[1], (used.get(m[1]) || []).concat(String(u).split('/portal/')[1]));
}
const unknown = [...used.keys()].filter((k) => !known.has(k));
ok(`every data-feature / isOn() key is a real switch (${used.size} used)${unknown.length ? ' — unknown: ' + unknown.join(', ') : ''}`, !unknown.length);
ok('the tab-level switch (Outreach) is used by the nav', Object.values(X.PAGE_FEATURE).every((k) => known.has(k)) && readFileSync(new URL('nav.js', root), 'utf8').includes("outreach: 'outreach'"));

// Sites and states.
ok('site from the address: douropartners.pt / www → production, the rest → staging', X.siteOfHost('douropartners.pt') === 'production' && X.siteOfHost('WWW.douropartners.pt') === 'production' && X.siteOfHost('staging--douro-partners.netlify.app') === 'staging' && X.siteOfHost('localhost') === 'staging');
const partner = { email: 'andre.rocha@douropartners.pt', can: () => true };
const intern = { email: 'maria@douropartners.pt', can: (p) => p !== 'features.test' };
const previewIntern = { email: 'andre.rocha@douropartners.pt', preview: 'Intern', can: (p) => p !== 'features.test' };
ok('nothing stored: Outreach On in staging, Off in production (even for a partner)', X.available({}, 'outreach', intern, 'staging') && !X.available({}, 'outreach', partner, 'production'));
ok('kill switches default On everywhere', X.available({}, 'kill.outreach.sending', intern, 'production'));
const test = { outreach: { production: 'test', testers: ['maria@douropartners.pt', 'andre.rocha@douropartners.pt'] } };
ok('Test: partner (permission) sees it, a plain intern doesn\'t', X.available({ outreach: { production: 'test' } }, 'outreach', partner, 'production') && !X.available({ outreach: { production: 'test' } }, 'outreach', intern, 'production'));
ok('Test: a named tester sees it', X.available(test, 'outreach', intern, 'production'));
ok('Preview as Intern hides Test features — even when the partner is also named on the switch', !X.available(test, 'outreach', previewIntern, 'production'));
ok('On: everyone; Off: nobody', X.available({ outreach: { production: 'on' } }, 'outreach', intern, 'production') && !X.available({ outreach: { production: 'off' } }, 'outreach', partner, 'production'));
ok('an unknown key is never on', !X.available({}, 'nope', partner, 'staging'));
console.log(fail ? `\n${fail} FAILED` : '\nall feature switch page tests passed'); process.exit(fail ? 1 : 0);
