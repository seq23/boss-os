# e2e

Playwright browser journeys against a local `wrangler dev` (`npm run e2e`). The webServer command
builds the client, applies local migrations (idempotent), and serves worker + SPA on :8787.
`scripts/e2e/prepare-local.mjs` runs first and resets the local D1, so every run starts from an
empty database, which is what the journeys assume. No credentials, nothing remote.

## The two things that make or break a run

**`--local` on `wrangler dev` is load-bearing.** Wrangler treats some bindings as REMOTE by default
now, `[ai]` among them, so plain `wrangler dev` opens a remote proxy session before it will serve
anything. On this account that session dies against Cloudflare Access and the server exits 1 —
Playwright then reports `Process from config.webServer was not able to start` and **nothing runs at
all**. See the comment on `webServer.command` in `playwright.config.ts` before changing it.

**One worker, one database.** Every spec drives the same local D1, so the isolation boundary is the
database and not the file. Two consequences: markers (`E2E-P6-${Date.now()}`) rather than fixed
names, and anything a spec switches off is switched off for everything after it. A spec that depends
on a starting state should establish it in `beforeEach`, never assume it.

## Writing an assertion that survives next week

Prefer, in order:

1. **A role or a testid.** It proves the state better than a string the copy may change.
2. **The shared module the page renders from.** One place decides the wording, and a rewording
   moves the assertion with it instead of breaking it.
3. **A short distinctive phrase**, only when the phrase IS the property (an honesty caveat, a
   refusal that must name its alternative).

**An API-only assertion is worth less than it looks.** It proves the machine works, not that anybody
can reach it. Whenever a journey ends in something a PERSON is supposed to do, drive the screen.
Reach for `request` for setup, for a refusal a person should never meet, and for reading back a
fact no surface shows.

## Helpers

- `support/boss.ts` — unlocks Boss OS at `/boss` and reaches each tab by its label.
- `support/provision.ts` — `provisionLocalD1(sql)` writes fixture rows no route creates;
  `queryLocalD1(sql)` reads back the facts no route serves.

## What is not here any more

The copied West Peek fund screens (the "chassis") and their 43 journeys (`d0`, `d1`, `p1`–`p67`)
were retired on 22 Nov 2026 with the screens themselves: West Peek OS runs that product and carries
its own suite. Any address outside `/boss` on a host other than Boss OS's now shows a "moved" page,
and `chassis-moved.spec.ts` proves that page at phone width.
