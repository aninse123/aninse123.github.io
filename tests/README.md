# Tests

Plain Node, no dependencies beyond what's already in the repo. Nothing here touches Firebase, Resend or the network.

| Suite | What it covers | Run |
|---|---|---|
| `functions/test/outreach_helpers.test.js` | Outreach helpers: addresses, test-mode allow list, MX check, headers, auto-reply and unsubscribe detection, quote stripping, unsubscribe tokens, Svix signatures, templates, short names, reply quoting | `cd functions && npm test` |
| `functions/test/outreach_flows.test.js` | End-to-end Outreach flows against an in-memory Firestore (`fake_firebase.js`): send guards, sending, budget, Resend errors, webhook events, bounces, inbound matching and attachments, replies, Gmail replies, unsubscribe, clear test data | `cd functions && npm test` |
| `tests/portal/*.test.mjs` | Search CRM regressions: functions lifted from `portal/search.html` by name and exercised in Node | `node tests/portal/run-all.mjs` |

The portal suites find functions by their names in `search.html`; if a function is renamed or split, update the suite that lifts it.
