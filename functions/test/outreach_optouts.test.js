// F4 — unsubscribes from one recurring email: listed per recurring email; a
// partner can put someone back when they asked (reason kept); the person is
// then included again, and unsubscribing again opts them out again.
const F = require("./fake_firebase.js");
const fns = require("../index.js");
const { store } = F;

let fail = 0;
const ok = (label, cond) => { if (!cond) fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };
const PARTNER = { auth: { token: { email: "andre.rocha@douropartners.pt" } } };
const INTERN = { auth: { token: { email: "maria@douropartners.pt", perms: ["out.view", "out.campaigns"], key: "maria" } } };
const rec = async (data, who = PARTNER) => { try { return await fns.outreachRecurring({ ...who, data }); } catch (e) { return { err: e }; } };
const camp = async (data, who = PARTNER) => { try { return await fns.outreachCampaign({ ...who, data }); } catch (e) { return { err: e }; } };

(async () => {
  store.set("outreachSettings/global", { testMode: true });
  store.set("outreachRecurring/r1", { name: "Investor update", status: "active" });
  store.set("outreachOptOuts/r1_rui_x_pt", { campaignId: "r1", email: "rui@x.pt", kind: "recurring", source: "link", at: F.Timestamp.fromDate(new Date(Date.now() - 86400000)) });
  store.set("outreachOptOuts/r2_ana_x_pt", { campaignId: "r2", email: "ana@x.pt", kind: "recurring", source: "link", at: F.Timestamp.now() });

  const l = await rec({ action: "optOuts", recurringId: "r1" });
  ok("lists this recurring email's unsubscribes only", l.optOuts?.length === 1 && l.optOuts[0].email === "rui@x.pt" && !l.optOuts[0].restoredAt);
  ok("an intern can see the list", !(await rec({ action: "optOuts", recurringId: "r1" }, INTERN)).err);
  ok("an intern can't put someone back", (await rec({ action: "restoreOptOut", recurringId: "r1", email: "rui@x.pt", note: "x" }, INTERN)).err?.details?.reason === "not_admin");
  ok("an intern can't delete a recurring email", (await rec({ action: "delete", recurringId: "r1" }, INTERN)).err?.details?.reason === "not_admin");
  ok("putting back needs a reason", (await rec({ action: "restoreOptOut", recurringId: "r1", email: "rui@x.pt", note: " " })).err?.details?.reason === "note_required");
  ok("someone who didn't unsubscribe can't be 'put back'", (await rec({ action: "restoreOptOut", recurringId: "r1", email: "ana@x.pt", note: "pediu" })).err?.details?.reason === "not_opted_out");

  // An issue campaign of r1 skips Rui while opted out…
  const c = await camp({ action: "save", campaign: { name: "Issue", audienceType: "people", steps: [{ templateId: "t1" }] } });
  store.set(`outreachCampaigns/${c.campaignId}`, { ...store.get(`outreachCampaigns/${c.campaignId}`), recurringId: "r1" });
  const e1 = await camp({ action: "enrolPeople", campaignId: c.campaignId, people: [{ email: "rui@x.pt", name: "Rui" }] });
  ok("while unsubscribed, the issue skips him", e1.enrolled === 0);

  const r = await rec({ action: "restoreOptOut", recurringId: "r1", email: "Rui@X.pt", note: "Pediu por email a 3 out" });
  const o = store.get("outreachOptOuts/r1_rui_x_pt");
  ok("put back: the record is kept with who / when / why", r.ok && o.restoredBy === "andre.rocha@douropartners.pt" && o.restoreNote === "Pediu por email a 3 out" && !!o.restoredAt);
  const e2 = await camp({ action: "enrolPeople", campaignId: c.campaignId, people: [{ email: "rui@x.pt", name: "Rui" }] });
  ok("after being put back, he's included again", e2.enrolled === 1);
  ok("the list shows him as put back", (await rec({ action: "optOuts", recurringId: "r1" })).optOuts[0].restoreNote === "Pediu por email a 3 out");
  ok("putting back twice is refused", (await rec({ action: "restoreOptOut", recurringId: "r1", email: "rui@x.pt", note: "x" })).err?.details?.reason === "not_opted_out");

  console.log(fail ? `\n${fail} FAILED` : "\nall opt-out tests passed");
  process.exit(fail ? 1 : 0);
})();
