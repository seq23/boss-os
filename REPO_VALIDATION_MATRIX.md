> ### ⚠️ This document describes the West Peek chassis, not Boss OS.
>
> This repository is **Boss OS v21**, live at boss.sequoiataylor.com. It was built by cloning West
> Peek OS and porting the Boss OS v20 artifact into it, so the documents at the repository root —
> this one included — were inherited from the chassis and describe *it*. They use **P0–P25**
> numbering and talk about LPs, dealflow and Managing Partners. None of that is Boss OS.
>
> **Boss OS's own authority is [`docs/boss/`](docs/boss/), and [`STATUS.md`](STATUS.md) is the plain
> account of what this repo is, what is built, and what is deliberately not.**
>
> This document is kept rather than deleted because the chassis is still in the tree and still under
> test, and its rules still govern the half of the code it describes. It goes when the chassis does.

# Repo Validation Matrix — West Peek OS

What each check proves — and what it does not prove. Run order matters; all run locally without
credentials except `validate:value-shapes`, noted below.

| Command | Proves | Does NOT prove |
|---|---|---|
| `npm run typecheck` | strict TS compiles across worker/client/shared/tests | runtime behavior |
| `npm test` | unit + integration behavior against local miniflare D1 (schema, services, authority rules, state machines, calculations with verified fixtures) | live Cloudflare, live providers, legal/compliance correctness |
| `npm run e2e` | real-browser journeys against local `wrangler dev` (auth denial, capture → work card → approval → audit, and later-phase journeys), from an empty firm every time — the command resets the local D1 itself and is safe to re-run back to back | deployed-environment behavior |
| `npm run migrate:local` | migrations apply cleanly, in order, to a fresh local D1 | remote D1 |
| `npm run backup:local` + `restore:local` | export → wipe → restore → seeded record readable, with every append-only trigger re-created and counted back (ADR-015) | offsite/disaster recovery |
| `npm run vault:doctor` | vault encryption round-trip + Keychain key custody on this machine, without exposing values | any secret's actual presence/correctness |
| `scripts/validate/no-direct-provider-calls` (P4) | no provider SDK/HTTP call exists outside provider adapters | provider success |
| `scripts/validate/no-unauthorized-effects` (P3) | external-effect call sites route through `authorize()` | — |
| `scripts/validate/no-cross-repo-coupling` (P9) | no partner-repo paths, foreign bindings, or Network OS hosts outside the declared adapter | live Network OS behavior |
| `npm run validate:brand` (D2) | the West Peek brand authority is intact, colour is declared only in the `:root` token block, no stale orange, no blue/purple/cyan product colour, and the approved mark is wired into the shell — with a 9-fixture self-test | that the result looks good, or that it meets WCAG. Visual quality and accessibility are measured in a browser, not by this scan |
| `npm run validate:design-tokens` | every font-size, spacing value, border-radius and line-height in `styles.css` is on the scale the token block declares, and no component sets two adjacent type steps on text of the same register — with a 12-fixture self-test | that a component's chosen step is the RIGHT one, only that it is ON-scale |
| `npm run validate:css-classes` | every `className` used in `src/client` has a rule in `styles.css`, and the stylesheet's braces balance — with an 8-fixture self-test | that a defined rule renders correctly, only that it exists |
| `npm run validate:sql` | every statement in `src/worker` parses (via `EXPLAIN`) against the schema the migrations build, in an in-memory `node:sqlite` database — local only since 22 Aug 2026, no credentials, no network — with a 5-fixture self-test covering the three bugs that prompted it | that a statement returns the right ROWS, or that the migrations match what is actually deployed |
| `npm run validate:briefing-not-chart` | her 12 Sep 2026 separation holds: `docs/boss/EXECUTIVE_INTELLIGENCE.md` carries all **eleven market sections as headings, in order** and **no astrologically-derived section** (no ephemeris, Moon, aspects, retrogrades, lunations, Mercury tracker or Money / Career / Travel Map); the Spirit page carries her disclaimer **above** the ephemeris; every locked map week renders only the band she gave it, with `unset` a real state that has no glyph and no `?? BAND.…` fallback to reach; and the ephemeris keeps degrees **and** arcminutes **and** Direct/Retrograde on both the Worker and the screen — with a 28-fixture self-test, and Rule 0: an empty map or a missing file hard-fails | that the briefing's prose is *good*, or that a planetary position is *correct*. Correctness is pinned separately in `tests/spiritDashboard.test.ts` against her own report |
| `npm run validate:retention-outlasts-checklist` | `SNAPSHOT_KEEP × SNAPSHOT_INTERVAL_MS >= QUARTER_MS` — the vault keeps at least as much history as `RESTORE_CHECKLIST.md`'s own question ("less than a quarter old") asks about, so the cadence and the retention count can never drift apart again; and that the checklist still asks it. 13-fixture self-test. Rule 0: a missing constant hard-fails rather than passing | that a snapshot is *restorable*, only that enough of them are kept. Restorability is proved by the drill and by `tests/boss/cadence.test.ts` |
| `npm run validate:restorable-only` | every `<option>` list on the Vault page comes from one exported `restorable()` (complete **and** has an `r2_key`); the prune previews before it deletes, behind both a preview and a typed DELETE; preview and prune share ONE selection in the Worker; the control has its own heading and names what goes *and* what stays; `Math.max(1, keep)` survives; no `DELETE FROM vault_snapshots`. 16-fixture self-test | that a restore *works*. That is the drill's job |
| `npm run validate:roster-has-a-face` | every ACTIVE employee — read by replaying the migrations into in-memory SQLite, not from a second list — is cast in `CASTING.json`, has a non-empty portrait file and a `MANIFEST.json` entry naming that file; the manifest's honesty statement is the *same sentence* as the casting sheet's; every portrait `<img>` alt text says both "AI-generated" and "does not exist"; no face is left on disk for someone off the roster. 15-fixture self-test. Rule 0: zero employees, seats or `<img>` tags hard-fail | that a portrait *resembles* its casting direction. That is checked by looking |
| `npm run validate:contribution-note` | canon §44 holds on screen and at the endpoint: POST /contributions refuses a contribution with no note (server-side, where the four accidental taps landed); no call site posts one without a note; removal goes through an audited endpoint; the panel names the practice, the floor, the good month and the absence of a streak; and **no streak, goal or progress bar** is present. 16-fixture self-test | that what she wrote in a note is *true*. It is her diary |
| `npm run validate:contract-is-her-work` | no Today-contract builder queries a table `today/subjects.ts` classifies as MACHINERY, no contract item's own strings tell her to go and fix the system, and **a table classified as neither hard-fails** so a new source must be classified where the rule is written down. 15-fixture self-test. Rule 0 on all three loops | that the contract's *ranking* is right, only that its subject is her work and not the system |
| `npm run validate:one-human-touch` | the brokerage suggestion gates on `isWeekday` **as its first act**, can return null and has no filler fallback, and reads only her own sovereign book — never the interest ledger, which lives on her Mac; the side-hustle item is capped at one by construction (`LIMIT 1` + `.first()`), is DECLARED (`needs_owner`) rather than inferred from prose, bounds its states, requires a reason, and derives its property list from `projects.ts` minus `authority_network`. 15-fixture self-test. Rule 0: either function missing, or an empty `spry` lane, hard-fails | that a given suggestion is *the best one available*, only that it is real, weekday-bound and capped |
| `npm run validate:lunation-outlives-moment` | `currentLunation` exists, is computed (no DB, no fetch), **cannot return null**, searches new *and* full moons, is bounded by the next lunation rather than a fixed fortnight, reaches the payload and the page, and the page renders both ends of the window with the disclaimer and arcminutes — and that "No major event in the next two days" is gone. 13-fixture self-test | that a lunation time is *correct*. That is pinned in `tests/boss/currentLunation.test.ts` against published tables |
| `npm run validate:one-mark` | one drawing in five files: the mark is not West Peek's monogram, keeps its `<title>`/`<desc>`, every derived PNG exists and is **byte-identical to a fresh render of the SVG** (`render-mark.mjs --check`), every surface agrees on one `?v=`, and `sw.js`'s `CACHE` name carries that version so the service worker actually evicts the old icon. 12-fixture self-test | that the mark *looks good*, or that it is legible at 16px. That was checked by rendering and looking |
| `npm run validate:value-shapes` | **needs production credentials (`wrangler` auth) and reads live `WP_OS_DB` over the network** — TS constants against their column's CHECK constraint, SQL literals against the owning table, orphaned foreign-key references, and pinned polymorphic references, all against the real production schema and data | that a value is semantically correct, only that it is shaped like what its column and its references declare. Stays an operator-run pre-deploy check (`docs/DEPLOYING.md`), not part of CI — the same reason `npm run deploy:production` itself is never run from CI (`BACKLOG.md`, "There is exactly ONE deploy path") |

| `npm run validate:alert-says-what` | the production error rows are run through the shipped grouping and collapse, and the render contains no bare `scope: event` pair, no two alerts with the same text, and no class whose rows carry no readable `detail`; plus the query selects `detail`, the raw key-pair template is gone, and the route collapses its list. 11-fixture self-test. Rule 0: a fixture render of zero alerts hard-fails | that an alert is *worth raising*, only that it says what happened and says it once |
| `npm run validate:body-kinds` | the Body contract's four kinds each carry a label and a distinct rail colour, and every field of `interface BodyContract` is classified in `BODY_FIELD_GROUPS` **and rendered** — a name left in a boolean guard does not count. 13-fixture self-test. Rule 0: zero fields, zero registry entries or zero kinds hard-fails | that the grouping *reads well*. That was checked by looking at it |

| `npm run validate:spec-sections` | §5's eleven briefing sections are registered in the spec's own order, every section a report does not carry is NAMED with the run's own reason, both ends are wired (no `slice(0, 4)`, block scrollable), and the duty prompt asks for all eleven by key. 16-fixture self-test plus a deletion proof. Rule 0: zero spec sections, zero registry entries or zero missing hard-fails | that a delivered section is *good*, only that an absent one is never silent |
| `npm run validate:insight-grounded` | the Investor Insight is shown only when every fact it cites appears elsewhere in the same report; ungrounded, mis-cited and uncited insights are withheld with reasons; and the spec, prompt and screen all carry its four parts. 14-fixture self-test. Rule 0: zero citations examined hard-fails | that the synthesis is *correct* — only that it is built out of today's own material |
| `npm run validate:one-scale` | Today declares one ordered type scale, no heading level is muted, both end blocks draw from it, and in the real JSX the briefing's heading outranks its own `so_what`. 11-fixture self-test. Rule 0: fewer than two levels, or no heading/content pair, hard-fails | that the page *looks* right. That was checked by reading it |

| `npm run validate:live-fault` | an alert describes something wrong NOW: a credential whose backend is not `enabled` is silent while a proven-dead one still shouts, a weekday-restricted duty is judged against its own schedule, and failures the same work has since succeeded at do not count. Shipped code over the production rows. 14-fixture self-test. Rule 0: zero probes or zero duty fixtures hard-fails | that every remaining alert is *worth raising*, only that it is about the present |

| `npm run validate:roster-health` | every active employee is on the roster with no LIMIT, and the health dot is a falsifiable verdict — failed or overdue is red, never-run and no-duty are amber not green, a Mon/Wed/Fri duty on a Sunday is green, each with its reason, told apart by shape as well as colour. 14-fixture self-test. Rule 0: an empty roster or one colour for everyone hard-fails | that an employee is doing GOOD work, only that their duties ran when their own schedule said |

## Phase proof mapping (approved plan §12.2)

P0 structural checks · P1 typecheck/build, auth E2E, migration, backup-restore · P2 identity
duplicate/merge/split/policy-version tests · P3 adversarial authority suite + browser E2E ·
P4 provider-boundary scan, egress, budget, kill-switch · P5 contradiction/supersession/source tests ·
P6 identity/diligence/secondary/IC tests + verified calc fixtures · P7 consent/promotion/follow-up ·
P8 delta/stale/severity/support-gate · P9 conflict/idempotency/degradation/writeback-audit ·
P10 claim-block + access/revocation · P11 constraint/policy-version + formula verification ·
P12 review gates + exception/no-overwrite.

**P13–P25 continuation (approved 2026-08-12).** P13 verification-only ledger · P14 relevance
determinism, dedupe, idempotent runs, citation-mandatory items, quarantine-respecting synthesis,
owner-only personal layer · P15 activation-law preservation, referenced-only collaboration,
deterministic scorecards · P16 credential-presence-not-values, pricing provenance, routing
explanation, policy-gated fallback, scoped-budget blocks · P17 pause enforced in BOTH the routing
service and the AI boundary, maturity separate from tested state · P18 immutable original text,
no chain-of-thought column, blocking lens gate · P19 refusal-vs-failure, occurrence idempotency,
dead-letter · P20 in-app floor with push recorded UNAVAILABLE, quiet hours hold delivery not the
record, service worker never caches `/api/*` · P21 promotion is the only path from research to
evidence · P22 connectors are configuration with LOCAL_FIXTURE checks · P23 specialist vendor is a
provider behind `run_ai()` with no conclusion column · P24 administrator source cannot be declared
LIVE by hand · P25 cockpit trends match P8's comparison, allocation view recomputes nothing, ten MP
questions answered, nine cross-system journeys.

## What the continuation's own checks add

| Command | Proves | Does NOT prove |
|---|---|---|
| `npx vitest run` (26 suites, 506 tests) | every rule above, against local miniflare D1 | anything external |
| `npx playwright test` (21 specs, 45 tests) | the operator journeys in a real browser, including 9 cross-system journeys and a 390×844 mobile pass | a physical device, an installed PWA, or a delivered push |
| `POST /api/jobs/tick` | the scheduled-work code path end to end | that Cloudflare's cron trigger fired it |
| connector / provider `check` routes | configuration coherence, stamped LOCAL_FIXTURE | that any external system is reachable |

## Formula verification is not formula acceptance

`docs/DEAL_MATH_VERIFICATION.md` (P6) and `docs/ALLOCATION_VERIFICATION.md` (P11) are **engineering**
verification: each formula restated from first principles, hand-worked, and encoded as fixtures. The
approved plan's §7.2 gate is the *operator or a designated reviewer accepting* that verification. That
acceptance has not happened, so no live allocation use is authorized regardless of test results.

## Forbidden claims (approved plan §12.4)

No test here may be described as proving: securities-law compliance, brokerage/fund legal sufficiency,
MNPI treatment, permissible LP marketing, valuation correctness, investment soundness, accounting
correctness, or fund performance correctness.

**D1–D5 design overhaul (approved 2026-08-13).** Visual/interaction only, over the preserved P0–P25
baseline. What the design work proves and does not prove:

| Evidence | Proves | Does NOT prove |
|---|---|---|
| `run_hallmark_audit.sh` pre- and post-build packs | the user's installed Hallmark authority was pinned by SHA-256 and applied, over a read-only mirror, with browser capture | that Hallmark reviewed anything — the runner's own truth boundary says it prepares evidence only |
| Browser measurement over 29 surfaces × 3 viewports | 0 horizontal overflow · 0 text nodes below WCAG AA for their size · 1 target below 44px (a checkbox inside its 44px label) · a 2px orange focus ring at every tab stop walked | WCAG conformance. No assistive technology, screen reader, 400% zoom, or colour-vision simulation was used |
| vitest 513/513 · Playwright 45/45 · four boundary validators | every governed behaviour, route, contract, and authority rule survived the overhaul unchanged | anything about deployed behaviour |
| diff against a pre-overhaul mirror | `src/worker/`, `src/shared/`, `migrations/`, and `tests/` are byte-identical — the overhaul touched no backend, no schema, and no product capability | — |
| `e2e/d1-design-states.spec.ts` (generation-2 review) | hover contrast on the one orange action, the focus ring's colour and instant paint, the blocked-decision reason, and that no surface renders an ambiguous blank for a low-authority reader — each verified by reverting its fix | that every surface is well designed; it locks three specific rules, not taste |

