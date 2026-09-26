// Lists of people (Phase 5a/5b). A list is either fixed (its members
// subcollection) or dynamic: the filter it was built from (Investor CRM stage,
// portal access group, Network categories / phases / owner, brokers) is kept
// and re-applied each time the list is used — a recurring email then always
// goes to whoever matches on that date. Mirrors the "Add people" picker in
// portal/outreach.html (openPeoplePicker).

const { normEmail, isValidEmail } = require("./util");
const store = require("./store");

const { db } = store;

function cleanDynamic(d) {
  if (!d || !["crm", "portal", "network", "brokers"].includes(d.mode)) return null;
  const arr = (v) => (Array.isArray(v) ? v.map(String).filter(Boolean).slice(0, 30) : []);
  return {
    mode: d.mode,
    stages: arr(d.stages),                 // crm: none = every stage
    groupId: d.groupId ? String(d.groupId) : null, // portal: null = every portal investor
    categories: arr(d.categories),         // network: none = all
    phases: arr(d.phases),
    owner: ["andre", "antonio"].includes(d.owner) ? d.owner : null,
  };
}

function merge(list) {
  const map = new Map();
  for (const p of list) {
    const email = normEmail(p.email);
    if (!isValidEmail(email)) continue;
    const cur = map.get(email);
    if (!cur) { map.set(email, { email, name: p.name || "", org: p.org || "", refs: [...p.refs] }); continue; }
    p.refs.forEach((r) => { if (!cur.refs.some((x) => x.source === r.source && x.id === r.id)) cur.refs.push(r); });
    if (!cur.name && p.name) cur.name = p.name;
    if (!cur.org && p.org) cur.org = p.org;
  }
  return [...map.values()];
}

async function resolveDynamic(spec) {
  const d = cleanDynamic(spec);
  if (!d) return [];
  const out = [];
  if (d.mode === "crm") {
    const snap = await db().collection("crmInvestors").get();
    snap.docs.forEach((doc) => {
      const i = doc.data();
      if (d.stages.length && !d.stages.includes(i.stage)) return;
      (i.contacts || []).forEach((c) => { if (c.email) out.push({ email: c.email, name: c.name || "", org: i.name || "", refs: [{ source: "crm", id: doc.id }] }); });
    });
  } else if (d.mode === "portal") {
    let ids = null;
    if (d.groupId) {
      const g = await db().doc(`accessGroups/${d.groupId}`).get();
      ids = new Set(g.exists ? g.data().investorIds || [] : []);
    }
    const snap = await db().collection("investors").get();
    snap.docs.forEach((doc) => {
      if (ids && !ids.has(doc.id)) return;
      (doc.data().emails || []).forEach((e) => { if (e) out.push({ email: e, name: "", org: doc.data().name || "", refs: [{ source: "portal", id: doc.id }] }); });
    });
  } else if (d.mode === "network") {
    const [contacts, firms] = await Promise.all([db().collection("networkContacts").get(), db().collection("networkFirms").get()]);
    const firmName = Object.fromEntries(firms.docs.map((f) => [f.id, f.data().name || ""]));
    contacts.docs.forEach((doc) => {
      const c = doc.data();
      if (!c.email) return;
      if (d.categories.length && !(c.categories || []).some((x) => d.categories.includes(x))) return;
      if (d.phases.length && !(c.phases || []).some((x) => d.phases.includes(x))) return;
      if (d.owner && c.owner !== d.owner) return;
      out.push({ email: c.email, name: c.name || "", org: firmName[c.firmId] || "", refs: [{ source: "network", id: doc.id }] });
    });
  } else if (d.mode === "brokers") {
    const snap = await db().collection("searchBrokers").get();
    snap.docs.forEach((doc) => (doc.data().contacts || []).forEach((c) => {
      if (c.email) out.push({ email: c.email, name: c.name || "", org: doc.data().name || "", refs: [{ source: "broker", id: doc.id }] });
    }));
  }
  return merge(out);
}

// The people on a list right now: a dynamic list is re-applied (and its
// stored count refreshed), a fixed one reads its members.
async function listPeople(listId, max = 5000) {
  const ref = db().doc(`outreachLists/${listId}`);
  const snap = await ref.get();
  if (!snap.exists) return { list: null, people: [] };
  const list = { id: snap.id, ...snap.data() };
  if (list.dynamic) {
    const people = (await resolveDynamic(list.dynamic)).slice(0, max);
    await ref.update({ count: people.length, resolvedAt: store.FieldValue.serverTimestamp() });
    return { list, people };
  }
  const members = await ref.collection("members").limit(max).get();
  return { list, people: members.docs.map((m) => m.data()) };
}

module.exports = { cleanDynamic, resolveDynamic, listPeople };
