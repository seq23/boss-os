# Kindle publishing: Simone's runbook

Simone (Boss OS) owns Kindle publishing from start to finish: upkeep, new batches and reporting.
The strategy is in the spry brain (Company › "KDP strategy (approved 8 Nov 2026)"). This page
covers how to run it. Every command runs from a boss-os checkout. Anything that touches Amazon or
Boss OS runs through the vault: `npm run -s vault:run -- node scripts/ops/<script>`.

## What runs by itself: Monday 09:45 Central (`kdp-publish.sh`, duty `duty_kdp_publish`)

In order, each step ending in a named stop rather than failing silently:

| Step | Script | What it does |
|---|---|---|
| 1 | `kdp-units.mjs` | Reads units, free units and Kindle Unlimited pages for each title over the last 60 days from the KDP reports, and writes them to `~/.boss-os/kdp/units.json` |
| 2 | `kdp-publish.mjs` | The old cover batch (it ends quietly) |
| 3 | `kdp-series.mjs` | Makes sure each line's Amazon series exists (it creates one at most once) |
| 4 | `kdp-new-title.mjs --unattended` | Publishes the approved titles: heads-up email, Kindle details (series included), EPUB, cover, AI answers, KDP Select, price, then Publish, and follows each title to Live |
| 5 | `kdp-paperback.mjs` | Puts up the paperback for each book whose Kindle edition is on the bookshelf |
| 6 | `kdp-promo.mjs` | Schedules the 5 free days for each new book once it is Live in Select |
| 7 | `kdp-week.mjs` | Her Monday line: `N sold · N KU pages · N companion visits`, on the run's OUTPUT line |

The Scorecard reads units.json: one `spry-kdp` row, plus one `kdp-batch1-<line>` row for each line
(day 30: 100 free downloads; day 60: 500 KU pages a month or a sale a week).

## Adding a book or a batch

1. **Spec**: add an entry to `series_books` in `scripts/ops/kdp-books/<line>.json`. The fields are
   slug, title, subtitle (a promise), series_number, description, 7 keywords, up to 3 categories,
   price_usd (0.99–2.99), an optional paperback {price_usd, trim}, companion_url, manuscript,
   claim_gate and cover. The book's own `author` overrides the line's pen name. `min_words`
   lowers the 2,000-word floor for early readers.
2. **Manuscript**: `docs/kdp/books/<slug>.md`. `#` starts a chapter, `##` a section, and you can
   use lists, `- [ ]` checklists and tables (fill-in logs; put `<!-- rows: N -->` above one to set
   its row count). Put `{{companion}}` where the tracked link goes. The engine adds the title page,
   copyright, AI note, disclaimer and the companion pages.
3. **Cover**: `docs/kdp/books/assets/covers/<slug>.jpg` at 1600×2560 (made with
   `docs/kdp/books/cover-templates.mjs`). If it is missing, the engine renders one from the spec.
4. **Build**: `node scripts/ops/kdp-build.mjs --line <line>` (or `--slug <slug>`). A book that fails
   the gate is named with its reasons: KDP's listing rules, pen-name rules, word floor, claim gate
   or companion link. The output goes to `~/.boss-os/kdp/books/<slug>/`, and
   `~/.boss-os/kdp/books/covers.html` shows every cover at thumbnail size and at full size.
5. **Approval**: run `npm run -s vault:run -- node scripts/ops/kdp-kmp-raise.mjs --slug <slug>` for
   each book. It raises a card in her Inbox with the cover and the whole listing on it. If she
   already said yes in words, add `--approved-in-chat "<her words>" --on <date>`. Nothing reaches
   Amazon without a yes recorded here.
6. **Publish**: the next Monday run does it. To do it now while someone is at the Mac, run
   `npm run kdp:new-title -- --title "<title>"`.

## Changing a live book

`existing-books.json` holds one row per title on the bookshelf. Edit the row, then run
`npm run -s vault:run -- node scripts/ops/kdp-update-live.mjs [--slug <slug>]`.
It changes the subtitle, keywords, categories, price, KDP Select, cover and the in-book link
(re-linked with the utm tag) and then presses Publish. It **never changes the author**. It leaves a
title alone while it is In review or Blocked. Each change is recorded in
`~/.boss-os/kdp/live-updates.json` and in `kdp-register.json` (`updated`); land the register change
in a PR. To redo a title, delete its entry in live-updates.json.

**Rebuild one cover**: replace `assets/covers/<slug>.jpg`. For a new book, rerun `kdp-build.mjs
--slug <slug>`. For a live book, delete its entry in live-updates.json and rerun `kdp-update-live.mjs
--slug <slug>`.

## Amazon's caps

- **At most 10 unpublished drafts.** A new title only starts if a draft slot is free. A title that
  resumes its own draft never takes a slot.
- **Weekly title-creation limit, per format** (seen live on 8 Nov 2026 after 2 new Kindle titles):
  Amazon shows "Title creation limit reached", and the limit resets on Sunday at 00:00 UTC. The run
  logs `WEEKLY_TITLE_LIMIT`, marks that title and every later one `QUEUED` and exits cleanly; the next
  Monday run carries on. Paperbacks are a separate format with their own limit.
- **Per-run cap**: at most `KDP_PUBLISH_PER_RUN` titles (5) go in one run.
- Whatever a cap holds back is logged `QUEUED`, stays approved and goes in the next run. The
  `queue:` line in the run log gives the count.

## Stops and what to do

| Stop | Meaning | What to do |
|---|---|---|
| `SIGNIN` / `SIGNIN_NOT_DONE` | Simone's own sign-in (vault password and the emailed code) failed, or Amazon showed a picture check | **Hers.** Email the owner once with the line `npm run kdp:signin`. Never type a password, never solve a picture check |
| `UNITS_NOT_READ` | The reports page was not read | The Scorecard shows "No number", never 0. Check the KDP-UNITS line. The next run retries |
| `BLOCKED` / rejection email | Amazon refused a title (read the triage, kdp-surface.sh) | Fix the reason in the spec or manuscript, rebuild, and let the next run resume the draft. Never create a second draft. Wording that is her decision goes to her as one ask |
| `SERIES_NOT_FOUND` | The line's series does not exist on KDP yet | Run `kdp-series.mjs --line <line>`, then the next run |
| `CATEGORIES_NOT_SET`, `FIELD_NOT_FOUND`, `UPLOAD_*`, `PREVIEWER` | KDP changed a page | The snapshot (`stop-*.png/.html`) is in the book's folder. Treat it as a repair (fix-and-report), not her job |
| `PRICE_BELOW_PRINT_COST` | The paperback price is under the print cost | Raise `paperback.price_usd` in the spec (still under $9.99 if possible), rebuild, rerun |
| `PROFILE_IN_USE` | The KDP Chrome window is already open | Nothing to do. The next run tries again |

## Files

- Code: `scripts/ops/kdp-*.mjs`, `scripts/ops/kdp-books/{lib,series}.mjs`, `scripts/ops/lib/kdp-units.mjs`
- Specs and manuscripts: `scripts/ops/kdp-books/*.json`, `docs/kdp/books/`
- Private outputs (never in the repo): `~/.boss-os/kdp/` (units.json, week.json, series.json,
  live-updates.json, books/<slug>/ with publish.json, paperback.json and promo.json)
- Tests: `tests/kdpSeriesBuild.test.ts`, `tests/kdpUnitsRecorded.test.ts`, `tests/kdpNewTitle*.test.ts`
