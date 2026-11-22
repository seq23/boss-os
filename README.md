# Boss OS

Sequoia's own operating system: her AI employees, duties, approvals, brains, coaching and the
side businesses' running work. One Cloudflare Worker serving a React app and an API over a D1
database, live at **boss.sequoiataylor.com**.

**Authority:** [`CLAUDE.md`](CLAUDE.md) (rules for anyone working here), [`STATUS.md`](STATUS.md)
(what is built and what is deliberately not) and [`docs/boss/`](docs/boss/), starting with
[`OPERATING_FACTS.md`](docs/boss/OPERATING_FACTS.md) and [`OPERATIONS.md`](docs/boss/OPERATIONS.md).

**Not here any more:** this repo began as a copy of West Peek OS. The copied fund code (its sign-in,
fund screens, fund routes and jobs) was retired on 22 Nov 2026. West Peek OS
(os.joinwestpeek.com, the `west-peek-os` repo) is the fund's system. An old fund URL on a non-Boss
host shows a "moved" page; an old fund `/api` route answers `410 Gone` naming West Peek OS. The
fund-era tables stay in the database, untouched. Documents under `docs/` that describe the fund code
carry a "historical" banner.

---

## Start here

```bash
npm ci
npm run migrate:local          # apply migrations to the local D1 store
npm run dev                    # build, then wrangler dev on :8787
npm run typecheck
npx vitest run tests/<file>.test.ts                              # root tests
npx vitest run -c vitest.boss.config.ts tests/boss/<file>.test.ts # Boss OS tests (workers pool)
npm run practice               # the practice run on a branch, before the PR
```

CI runs the full suites, the validators (`npm run validate:scans`) and the browser journeys.

## Email the businesses send

Every email any of the businesses sends — who sends it, to whom, on what schedule, where it runs
and how to pause it — is on the **Email Map page in Boss OS** (☰ More → Email Map,
`/?tab=emails`; owner, 31 Oct 2026), generated from `src/shared/boss/emailMap/manifest.json`.
[OUTBOUND_EMAIL_MAP.md](docs/OUTBOUND_EMAIL_MAP.md) keeps the detailed audit of the Boss OS and
side-business paths. The side businesses themselves are reviewed in
[SIDE_BUSINESS_REVIEW.md](docs/SIDE_BUSINESS_REVIEW.md) (living page:
https://claude.ai/artifact/2XkmYNmppidkqr4SU8xwiv; a repo copy).

## When everything runs

Every scheduled job across her systems (Boss OS duties, the Mac's launchd jobs, GitHub Actions and
Cloudflare crons in her repos, West Peek OS jobs; never a client's) is on the **Schedule page in Boss
OS** (☰ More → Schedule, `/?tab=schedule`; approved 1 Nov 2026), generated from
`src/shared/boss/schedule/manifest.json`. The approved week is kept as
[WEEKLY_SCHEDULE.md](docs/boss/WEEKLY_SCHEDULE.md). `npm run schedule:check` holds the page to what
really fires.

**The rule:** any new or changed sender — in any repo, launchd job or Worker cron — is added to the
map (the manifest, and the doc for a Boss OS or side-business path) in the same PR.
`tests/outboundEmailMap.test.ts` enforces it for this repo: it checks every boss-os row's files
exist, every Id appears once, and fails, by file name, on any file here that calls an email
transport without being cited by a row.

## Deploying

`npm run deploy:production` is the only thing that changes production (in practice, `land <pr>`
runs it). It applies D1 migrations, refuses to continue if any are still pending, builds, deploys,
then probes the Worker. Never a bare `wrangler deploy`: it does not build the client, so it ships
today's backend with whatever frontend was last built, and reports success.
[docs/DEPLOYING.md](docs/DEPLOYING.md) has the reasoning and how to verify what shipped.

**Cloudflare is not connected to this repository** (disconnected 18 Aug 2026): Workers Builds
deploys code but does not apply migrations. Pushing here is saving work, never deploying.

Migrations are numbered and additive only; an applied one never re-runs. After a deploy touching
schema, check `npx wrangler d1 migrations list WP_OS_DB --env production --remote` says "No
migrations to apply", then query for the thing you added. Secrets are write-only in Cloudflare and
live in the Boss OS vault (`npm run vault:status`).

## Reference

| Document | What it covers |
|---|---|
| [docs/boss/OPERATING_FACTS.md](docs/boss/OPERATING_FACTS.md) | The `/api/boss/*` mount, the passcode, mail keys, cadence, Mac runs, lanes |
| [docs/boss/OPERATIONS.md](docs/boss/OPERATIONS.md) | Running it day to day |
| [docs/DEPLOYING.md](docs/DEPLOYING.md) | The one deploy path |
| [docs/ENVIRONMENTS.md](docs/ENVIRONMENTS.md) | local / preview / production |
| [docs/RECOVERY.md](docs/RECOVERY.md) | Backup and restore |
| [scripts/validate/README.md](scripts/validate/README.md) | The validators and what each proves |
