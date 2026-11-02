# Open Loops: how a repo's named stops report in

Open Loops is the one list of everything approved but not finished (owner ruling, 1 Nov 2026). It
lives in Boss OS: ☰ More → Open Loops (`/?tab=loops`), the API under `/api/boss/open-loops`, and a
section in Simone's morning email. Code: `src/worker/boss/routes/openLoops.ts`,
`src/shared/boss/openLoops/openLoops.mjs`, page `src/client/boss/pages/OpenLoops.tsx`.

A repo whose gate stops by name (`NAMED STOP [CODE] …`) can make each stop a row there, so a stop
nobody is looking at still gets chased, and the row closes itself the day the stop clears.

## Adopt it in one call

1. Copy `scripts/lib/open-loops.mjs` from `seq23/keepmyproof` (plain Node, no dependencies).
2. Where your gate has its list of stops, call it once:

```js
import { reportToOpenLoops } from './lib/open-loops.mjs';

await reportToOpenLoops({
  repo: 'seq23/<repo>',
  business: 'spry',                        // a brain slug
  finish: '<the real outcome, plain words>', // e.g. "Live in both stores, selling"
  known: ['CODE_A', 'CODE_B'],             // every stop this gate can raise
  stops: found,                            // [{ code, why, title? }] still in force now
});
```

   Each stop in `stops` is upserted (one row per `repo#CODE`); each code in `known` that is not in
   `stops` is posted as cleared, which closes its row with "outcome reached". With no
   `BOSS_OPEN_LOOPS_TOKEN` in the environment it prints one line and does nothing, so local runs and
   forks are unaffected. A failed post prints one line and never fails the gate.
3. Give the workflow the token: `BOSS_OPEN_LOOPS_TOKEN` as a repo secret, from the Boss OS vault,
   never echoed:

```sh
cd ~/GitHub/boss-os && npm run -s vault:run -- sh -c 'printf %s "$BOSS_OPEN_LOOPS_TOKEN" | gh secret set BOSS_OPEN_LOOPS_TOKEN -R seq23/<repo>'
```

## The intake

`POST https://boss.sequoiataylor.com/api/boss/open-loops/intake`, header
`authorization: Bearer <BOSS_OPEN_LOOPS_TOKEN>` (or a Boss OS session for her Mac's jobs).

| Field | Meaning |
|---|---|
| `repo` | `owner/name` |
| `stop` | the stop's code, `UPPER_SNAKE` |
| `finish_line` | the real outcome the stop stands in the way of |
| `title`, `next_step` | plain words for her page and email (no codes, paths or ids) |
| `owner` | `claude` (default), `codex`, `sequoia` or an employee id |
| `business` | a brain slug (default `spry`) |
| `next_date` | `YYYY-MM-DD` (default two days out) |
| `cleared` | `true` closes the row: "outcome reached" |

A second post for the same stop keeps the row (and reopens it if it had closed); her edits to the
owner, date and business stand. The token can only post here. Minting a new one
(`POST /api/boss/open-loops/intake-token`, with a session) retires the old one; store the new one in
the vault as `BOSS_OPEN_LOOPS_TOKEN` and re-set every adopter's secret.

## Adopters

- `seq23/keepmyproof`: `scripts/release-gate.mjs` (the store release gate).
