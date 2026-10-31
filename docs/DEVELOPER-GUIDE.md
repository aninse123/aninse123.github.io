# Developer guide

Read this before your first change. It is short on purpose.

## One codebase, several teams
This portal runs for more than one team, each in its **own Firebase project** (data, auth, functions and hosting are separate). The code is shared; everything that belongs to a team is settings, not code.

| Never type into the code | Where it lives instead |
|---|---|
| A person's email or name (admin, partner, sender) | `instance/settings` (server) and the team directory (pages) — `functions/instance.js` |
| A company/domain/logo/contact line | `instance/public`, and `outreachSettings/global` for Outreach |
| Production host names | `instance/settings.productionHosts` / the instance config file |
| Test recipients | `outreachSettings/global.testRecipients` (empty by default) |

`tests/portal/no_new_identity_literals.test.mjs` fails if you add a Douro-specific name to `portal/` or `functions/`. If you remove some, run it with `--update` to lock the progress in. Douro's own values live in `instances/douro/`.

## Where things go
- **Teams other than Douro get your change too.** Ask: does this make sense for any team? If it is Douro-only, put it behind a feature switch and keep it out of shared defaults.
- **Every new feature needs a release switch** (Off / Test / On), added in `functions/features/catalog.js` and `portal/features.js`. A new switch needs a `featureAdmin` functions deploy.
- **Provider-neutral wording.** Say "external database", not a product name, in anything the user sees. Country-specific logic (tax IDs, activity codes, holidays, places, language) belongs in a country pack, not in shared code.
- **Legal-ish features are optional and off by default** (email footer, unsubscribe link, free-mail blocking).

## Deploying
- Branches: `staging` → `main`. Develop on a branch, merge to `staging`, then `main`.
- `douro-partners` is currently **one** Firebase project: a `firestore.rules`, `storage.rules` or `functions` deploy goes live immediately for real users. Run `node tests/rules/check_rules.cjs` (nothing is deployed) and `cd functions && npm test` first. Rules changes: never late evening, never mid-campaign.
- Never deploy to a project that does not match the team you built for (`scripts/deploy.mjs` enforces this once it exists).
- Pushes to GitHub are done by the owner in their own terminal (two accounts on the machine).

## Tests
- `cd functions && npm test` — Cloud Functions against an in-memory Firestore.
- `node tests/portal/run-all.mjs` — page logic lifted out of the HTML.
- `node tests/rules/check_rules.cjs` — security rules checked against Google's test endpoint.
Add a test with every change; a bug fix gets the test that would have caught it.

## Secrets and data
Secrets only in Secret Manager (`firebase functions:secrets:set`). Never real company data, emails or keys in the repo, tests or fixtures — use `example.test` addresses.
