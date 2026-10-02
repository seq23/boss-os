# scripts/validate

Static validation scans, wired to npm scripts. Each must FAIL loudly (exit 1, named
violations) on breach and proves its own detection with a self-test fixture run.

- `no-unauthorized-effects.mjs` (P3, `npm run validate:authority`) — proves (a) only
  `src/worker/effects/executor.ts` performs external-effect execution (no other worker
  file marks `external_effect_request` EXECUTED; no outbound fetch to non-localhost
  anywhere in worker code) and (b) merge/reverse + executor call sites route through
  `authorize()` and consume receipts. `--self-test` feeds synthetic violating sources
  through the same checks and asserts they are caught. The npm script also runs the
  seed generator's `--check` (registry-seed freshness) — see `scripts/seed/`.

- `an-alert-says-what-happened.mjs` (`npm run validate:alert-says-what`) — the one scan
  here that RUNS the shipped code rather than reading it. It feeds the production error
  rows of 12 September 2026 through `today/errorAlerts.ts` and `dedupeAlerts`, then
  asserts of the resulting render: no alert text is a bare `scope: event` pair, no two
  alerts carry the same text, and a class whose rows hold no readable `detail` never
  reaches the surface at all. It also checks the wiring behind that — the query selects
  `detail`, the raw `${row.scope}: ${row.event}` template is gone, and the route
  collapses its list. **Rule 0: a fixture render producing zero alerts hard-fails**, since
  every rule is "no alert is…" and an empty list satisfies them all. 11-fixture self-test,
  including the surface exactly as she found it.

- `the-body-contract-shows-its-kinds.mjs` (`npm run validate:body-kinds`) — the four kinds
  of the Body contract (movement, intake, medical, stop) each have a label on screen and
  their own rail colour, checked as CSS rules that actually differ; and every field of
  `interface BodyContract` is classified in `BODY_FIELD_GROUPS` and actually RENDERED — a
  name mentioned only inside a boolean guard does not count, which is the state
  `language_rule` was in. **Rule 0: zero fields, zero registry entries or zero kinds
  hard-fails.** 13-fixture self-test.

- `every-spec-section-is-rendered-or-named.mjs` (`npm run validate:spec-sections`) — §5 of
  `EXECUTIVE_INTELLIGENCE.md` names eleven sections in a fixed order; `BRIEFING_SECTIONS` must
  match it exactly, the shipped `missingSections()` must NAME every §5 section a report does not
  carry (using the run's own gap as the reason where it gave one), both ends must be wired
  (`missing_sections` in the payload and on the screen, no `slice(0, 4)`, the block scrollable),
  and the duty prompt must ask for all eleven by key with no four-section cap and no
  bold-every-bullet. **Rule 0: zero spec sections, zero registry entries, or a fixture producing
  zero missing sections hard-fails.** 16-fixture self-test plus a deletion proof.

- `an-insight-rests-on-the-day.mjs` (`npm run validate:insight-grounded`) — an Investor Insight is
  shown only when every fact it cites appears elsewhere in the SAME report; one resting on a fact
  that is not in the day, one citing a section that is not there, and one citing nothing are all
  withheld with a reason she can see. Also that the spec, the prompt and the screen all carry the
  four parts — synthesis, how it was reached, the transferable frame, what would falsify it.
  **Rule 0: zero citations examined hard-fails.** 14-fixture self-test.

- `one-scale-for-the-morning.mjs` (`npm run validate:one-scale`) — the Today page declares one
  ordered type scale (`--today-N-size`/`--today-N-weight`, sizes strictly decreasing, weights never
  increasing), no heading level resolves to `--muted`, both end blocks draw from it, and in the real
  JSX the briefing's section heading sits at a HIGHER level than its own `so_what` line — the
  `.eyebrow`-over-`.row-title` inversion that was on every section of every briefing. Also that
  nothing asks for bold inside sentences any more while `bold()` survives for historical reports.
  **Rule 0: fewer than two levels, or no heading/content pair to compare, hard-fails.** 11-fixture
  self-test.

- `an-alert-describes-a-live-fault.mjs` (`npm run validate:live-fault`) — three of the five alerts
  on her screen on 13 Sep were false, each in a different way, and all three were the same defect:
  a query about the past read as a statement about the present. Runs the SHIPPED `alertsForProbes`
  and `dutyStaleness` over the exact production rows — a credential whose backend is `registered`
  rather than `enabled` is silent (read off `execution_backends.status`, never a list of names), a
  `weekdays = [1,3,5]` duty is quiet on a Sunday and loud on the Tuesday after a missed Monday, and
  a proven-DEAD token still shouts even on a switched-off backend. Plus the route: no `CASE cadence`
  staleness in SQL, failed-task counts exclude failures the same work has since succeeded at, and
  the error window excludes `task_failed` events whose task recovered. **Rule 0: zero probes or zero
  duty fixtures hard-fails.** 14-fixture self-test.

- `the-roster-is-everyone-and-the-dot-means-something.mjs` (`npm run validate:roster-health`) — the
  AI Employee Status block rendered `busiest … LIMIT 5` over eight active employees, so three were
  missing at any moment and which three moved with the queue. Runs the shipped `roster()` over the
  eight production employees: nobody is cut off, the route's query carries no LIMIT, and each dot is
  the right falsifiable verdict — a failed last run and an overdue duty are red, a Mon/Wed/Fri duty
  read on a Sunday is GREEN (the false alert must not come back as a dot), never-run and no-duty are
  AMBER rather than green, every state carries a sentence, "overdue" is `dutyStaleness` and not a
  second copy, and the three states differ by shape as well as colour. **Rule 0: an empty roster, or
  one colour for every employee, hard-fails.** 14-fixture self-test.

- `every-alert-can-be-answered.mjs` (`npm run validate:alert-answerable`) — both endpoints worked;
  the interaction did not. Checks the shipped `alertKey` keeps ONE key across occurrences of the
  same cause (the error alerts carried `evt_…` row ids, so a dismissal was dead on arrival by
  construction) while keeping two causes apart; that "Mark resolved" is rendered for every alert —
  it was gated on a `del_` source id that none of her alerts had, so the button was not on the page;
  that the server can re-test any alert by recomputing the surface while the `TERMINAL_CHECKS` path
  for an owned deliverable stays intact; and that the dismiss reason box scrolls into view, takes
  focus, and says what it is waiting for while still requiring a reason. **Rule 0: nothing keyed, or
  no alert-action markup, hard-fails.** 13-fixture self-test.

- `a-ceiling-says-what-kind-of-ceiling-it-is.mjs` (`npm run validate:ceiling-kind`) — three backends
  showed a ceiling of $0.00 meaning free, unauthorised and off; the shipped `spendSentence` must give
  the three DIFFERENT sentences. Runs `derivePlan` over four plan fixtures: the employee ceiling is
  capacity minus reserve, a 0% reserve means literally "whatever my plan allows", 100% leaves zero
  rather than going negative, upgrading the tier moves the ceiling with no row edited, and the
  derived daily pace × 31 never exceeds the month (0222's $2/day-under-$50/month defect). Also that
  both registry loaders route through `applyPlanCeiling`, that the cost basis reaches the screen so
  subscription usage stops reading as a bill, and that the lever and the cost mode are both CONTROLS
  on Systems and still two separate things. **Rule 0: zero spend kinds or zero plan fixtures
  hard-fails.** 12-fixture self-test.

- `a-live-playbook-leads-with-its-steps.mjs` (`npm run validate:live-playbook`) — `fpb_vault_stale`
  was ACTIVE and correct, and the screen reported it uselessly: third in a list, styled like the
  panels that were fine, with its steps parsed and never rendered. Runs the shipped `vaultIsStale`
  over four fixtures (a snapshot inside last night's window, a night missed, the seven-day
  production case, a vault never snapshotted) and requires ONE rule asked of `snapshotWindowOpensAt`
  and used by both `routes/governance.ts` and `governance/sentinel.ts`, with no hardcoded two-day
  span left in either. Plus the screen: the live playbook leads with its steps and the reason it
  fired, the section opens with a verdict, and decision rights render `label`/`rationale` rather
  than `dr_capability_patch`. **Rule 0: zero staleness fixtures, or no Governance component,
  hard-fails.** 12-fixture self-test.

- `the-local-gate-is-the-ci-gate.mjs` (`npm run validate:gate-parity`) — a branch passed
  `npm run validate` end to end and CI went red on `validate:brand` over a `#000` in the stylesheet.
  The chain named 49 scans, `ci.yml` named 19, and neither set was a subset of the other: NINE ran
  only in CI (green locally, red on push) and THIRTY-EIGHT ran only locally (ungated in CI, which is
  the worse half because nothing tells you). `validate:scans` is now the union, CI runs it as one
  step, and this scan requires that every `validate:*` in `ci.yml` is in the chain, that CI runs the
  catch-all, and that `validate` stays `validate:scans` + typecheck + tests. **Rule 0: zero CI steps
  or zero registered scans hard-fails** — two empty lists agree perfectly. 7-fixture self-test.

- `a-reason-is-not-a-guess.mjs` (`npm run validate:reason-not-guess`) — the somatic lanes all read
  "Not done before.", and that was a claim the database could not support: `movement_log` records
  which movement was CHOSEN, and nothing anywhere recorded her DOING one. Runs the shipped
  `becauseFor` over the three states the record can now tell apart (done / offered with nothing
  recorded / never offered) and requires three different sentences, none of them describing doing or
  skipping where the record is silent, and none turning an absence of data into guilt. Also requires
  the completion path end to end — `done_at` column → `markSomaticDone` → endpoint → api → an
  undoable control — and that the day's rotation is decided once (the old delete-and-rewrite made
  Today and Spirit disagree about the same morning). **Rule 0: zero states exercised hard-fails.**
  12-fixture self-test.

- `every-seat-owns-work.mjs` (`npm run validate:seat-owns-work`) — Toni and Zora held no standing
  duty, so their health dot could never be anything but amber, for ever. Replays every migration to
  build the live seat list and the final duty ownership — no second list beside the database — then
  requires every active seat to own at least one duty and no seat to own more than everyone else
  combined (Monique held eight of seventeen, one of which was reconciling a spreadsheet). **Rule 0:
  zero duties replayed or zero seats found hard-fails.** 7-fixture self-test.

- `a-device-has-one-home.mjs` (`npm run validate:device-home`) — `npm run vault:run -- node
  scripts/sync-agent/agent.mjs work-once` died on "BOSS_OS_DEVICE_ID is not set" because the value
  existed in exactly ONE generated launchd plist (1 of 15) and the installer hardcoded the default.
  Runs the shipped resolver: a registered machine answers with NO environment, the environment still
  wins, a blank variable does not, and an unregistered machine gets `null` rather than an invented
  id. Also that the error names the file and the command, the installer READS the id instead of
  defining it, and the agent does not go behind the resolver. **Rule 0: zero resolution cases
  hard-fails.** 8-fixture self-test. *(Deliberately not in the vault — see the file header.)*

- `a-figure-carries-its-source.mjs` (`npm run validate:figure-sourced`) — Friday's report published
  Brent at ~$72/bbl against a $104.61 close and nothing forced the correction: the duty's
  `success_criteria` is a TEXT column no code has ever evaluated, and `sources` was report-level
  while figures lived in sections with no link between them. Runs the shipped gate: a section that
  prints a figure and cites nothing does not print, a prose section is left alone, and a citation
  that does not resolve fails like a missing one. Also runs the shipped status logic: eleven
  sections with a full `watching` list is COMPLETE, while a missing section, a withheld one, an
  unverified figure or an ungrounded insight is PARTIAL and says which. Plus that the prompt and the
  spec carry all three decisions. **Rule 0: zero sourcing or zero status cases hard-fails.**
  16-fixture self-test.

- `the-merge-gate-is-fast.mjs` (`npm run validate:merge-gate-fast`) — the shape of `ci.yml`
  after 21 Sep 2026 (PR #35 waited 50 minutes on a serial 15-minute job plus a Playwright retry
  that hit its cap): every job has `timeout-minutes`; the unit suite and the Boss suites are
  sharded, the `--shard=i/N` denominator equals the matrix length and each unit shard stays
  serial inside; the Playwright job lives in `e2e.yml`, keeps its own ceiling, and is triggered by
  `workflow_dispatch` ONLY — any `schedule` cron, `push` or `pull_request` fails (owner, 2 Oct
  2026); every job a pull request waits on has a ceiling of at most 10 minutes. **Rule 0: zero
  jobs, fewer than two sharded jobs, or no Playwright job hard-fails.** 27-fixture self-test.

- `production-moves-only-through-the-gate.mjs` (`npm run validate:production-gate`) — 2 Oct 2026,
  the owner: a small change ships to production on the fast check; e2e gates production only
  after a large change or when asked (`land` defines "large", in seq23/seq-bin). The old rule —
  no green e2e, no production — is replaced by one decision in one file,
  `scripts/deploy/production-gate.mjs`: a green e2e on the sha; or a reason + `CI` green on
  exactly that sha + the journeys not known red; anything unread refused. Reads `deploy.yml`:
  triggers exactly `workflow_run` of e2e + `workflow_dispatch`, a red run turned away, the gate
  run unconditionally before the deploy on every path (the dispatch used to ship main's head
  with no verdict), `sha` + `reason` inputs, the sha on main and checked out exactly,
  `deploy:production` and never a bare `wrangler deploy`, no cancel-in-progress, a recorded
  GitHub Deployment. Reads the gate: the decision, the known-red rule, both API reads, the
  pointer to land, no restated threshold — and runs its table (17 cases, 5 broken gates).
  `docs/DEPLOYING.md` must name the gate. **Rule 0: a missing deploy.yml, a missing gate or an
  empty table hard-fails.** 29-fixture self-test.
