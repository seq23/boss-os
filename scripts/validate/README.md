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
