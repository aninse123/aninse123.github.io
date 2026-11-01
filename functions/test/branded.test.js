// Branded emails (distribution plan, Phase 0 / WP6): Douro's emails stay
// byte-for-byte what they were before the branding moved into the instance
// settings (fixtures/branded_douro_2026-11-01.json was taken from the code
// before the change), and a second team's emails carry its own name, logo,
// portal address and contacts - nothing of Douro's.
const F = require("./fake_firebase.js");
const fs = require("fs");
const path = require("path");
const P = require("../access/perms.js");
const B = require("../outreach/branded.js");
const { store } = F;

let fail = 0;
const ok = (label, cond) => { if (!cond) fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };
const render = () => ({
  inv: B.buildHtml({ investorName: "ACME", message: "Hello\nthere <b>", docName: "Deck", docCategory: "Doc", docDescription: "Desc" }),
  inv2: B.buildHtml({ message: "Hi" }),
  out: B.buildOutreachHtml({ message: "Hello\nthere", docName: "Deck", docCategory: "Doc", docUrl: "https://x.test/d", docDescription: "Desc", legalLines: ["Line 1", "Line 2"] }),
  out2: B.buildOutreachHtml({ message: "Plain" }),
});

(async () => {
  const before = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "branded_douro_2026-11-01.json"), "utf8"));
  P._resetIdentity();
  await P.loadIdentity({ force: true }); // no project set: the Douro settings
  const now = render();
  for (const k of Object.keys(before)) ok(`Douro: "${k}" email is identical to the one before the change`, now[k] === before[k]);

  // A second team
  store.set("instance/settings", {
    adminEmails: ["ana@example.test"],
    founders: [{ email: "ana@example.test", key: "ana", name: "Ana Admin" }, { email: "bo@example.test", key: "bo", name: "Bo Partner" }],
    portalOrigins: ["https://example.test"], productionHosts: ["example.test"],
  });
  store.set("instance/public", { orgName: "Example Fund", logoUrl: "https://example.test/logo.png", portalUrl: "https://example.test/portal/", contacts: [{ name: "Ana", email: "ana@example.test" }, { name: "Bo", email: "bo@example.test" }] });
  P._resetIdentity();
  await P.loadIdentity({ force: true });
  const t = render();
  const all = Object.values(t).join("\n");
  ok("second team: no trace of Douro in any email", !/douro|andré|antónio|carvalho|rocha/i.test(all));
  ok("second team: name, logo, portal button and site link are theirs", /Example Fund/.test(t.inv) && /src="https:\/\/example\.test\/logo\.png"/.test(t.inv)
    && /href="https:\/\/example\.test\/portal\/investor\.html"/.test(t.inv) && /href="https:\/\/example\.test"/.test(t.out) && /example\.test\n/.test(t.out));
  ok("second team: footer names their people and offers their contacts", /Ana Admin &middot; Bo Partner/.test(t.out) && /mailto:ana@example\.test/.test(t.inv) && /mailto:bo@example\.test/.test(t.inv));
  ok("second team: the organisation name is escaped", (() => { store.set("instance/public", { orgName: "A <b>&Co", portalUrl: "https://example.test/portal/", contacts: [] }); return true; })());
  P._resetIdentity();
  await P.loadIdentity({ force: true });
  ok("second team: a name with markup is escaped and no logo means no broken image", /A &lt;b&gt;&amp;Co/.test(render().inv) && !/<img/.test(render().inv));

  console.log(fail ? `\n${fail} FAILED` : "\nAll passed");
  process.exitCode = fail ? 1 : 0;
})();
