// People merge, Stage 6 (21 Oct 2026, switch "search.people"): a hard bounce
// marks that address "bounced" on every person who has it in their own list,
// with the date; a bounced primary email hands "primary" to the next OK one.
// Synthetic data only.
const F = require("./fake_firebase.js");
const store = require("../outreach/store.js");
const { store: db } = F;

let fail = 0;
const ok = (label, cond) => { if (!cond) fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };

(async () => {
  db.clear();
  db.set("searchPeople/p1", { name: "João", reachEmails: ["joao@empresa.pt", "joao@gmail.com"], reach: [
    { id: "a", type: "email", value: "Joao@Empresa.pt", status: "ok", primary: true, note: "" },
    { id: "b", type: "email", value: "joao@gmail.com", status: "ok", primary: false },
    { id: "c", type: "phone", value: "+351 910 000 000", status: "ok", primary: true },
  ] });
  db.set("searchPeople/p2", { name: "Outra pessoa", reachEmails: ["outra@empresa.pt"], reach: [{ id: "d", type: "email", value: "outra@empresa.pt", status: "ok", primary: true }] });

  const n = await store.markReachBounced("joao@empresa.pt");
  const r = db.get("searchPeople/p1").reach;
  ok("one person changed", n === 1);
  ok("the address is marked bounced, with the date in its note (case-insensitive match)", r[0].status === "bounced" && /bounced \d{4}-\d{2}-\d{2}/.test(r[0].note));
  ok("…it is no longer primary; the next OK email is", !r[0].primary && r[1].primary === true);
  ok("…phones untouched", r[2].primary === true && r[2].status === "ok");
  ok("someone without that address is untouched", db.get("searchPeople/p2").reach[0].status === "ok");
  ok("a second bounce of the same address changes nothing", (await store.markReachBounced("joao@empresa.pt")) === 0);
  ok("an address nobody has: nothing", (await store.markReachBounced("ninguem@x.pt")) === 0);

  console.log(fail ? `${fail} people-bounce test(s) FAILED` : "all people-bounce tests passed");
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
