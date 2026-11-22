# Boss OS — for agents working in this repo

The rules for anyone working here are in [`CLAUDE.md`](CLAUDE.md); read it first. Boss OS's own
authority is [`docs/boss/`](docs/boss/) and [`STATUS.md`](STATUS.md); operating facts and traps are
in [`docs/boss/OPERATING_FACTS.md`](docs/boss/OPERATING_FACTS.md).

This repo began as a copy of West Peek OS. The copied fund code and the agent authority that
governed it (P0–P25, the canonical master plan, the registry seed generators) were retired on
22 Nov 2026; the fund's system is the `west-peek-os` repo. Documents under `docs/` that describe
that code carry a "historical" banner and govern nothing here.

## Commands

- `npm run typecheck`
- Root tests: `npx vitest run tests/<file>.test.ts`. Boss OS tests:
  `npx vitest run -c vitest.boss.config.ts tests/boss/<file>.test.ts`.
- `npm run validate:scans` — the static validators; each has a `--self-test`
  ([`scripts/validate/README.md`](scripts/validate/README.md)).
- `npm run practice` — the practice run on a branch, before the PR.
- Deploy only through `land <pr>` (`npm run deploy:production`), never a bare `wrangler deploy`.

## Rules that bite

- Migrations are numbered and additive only (no DROP); each ends with its `schema_version` row.
- `event_record` and several other tables reject UPDATE or DELETE at the database layer: correct a
  mistake with a compensating row.
- Outbound `fetch` from worker code is allowlisted by file (`validate:authority`), and every model
  call goes through Boss OS's router in `src/worker/boss/router/` (`validate:ai-boundary`).
- The e2e suite runs on ONE worker against one local D1; `npm run e2e` resets that database first.
- Never weaken a failing test to force green; never claim a check ran when it did not.
