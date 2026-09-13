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
