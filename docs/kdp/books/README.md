# KDP books: the 11 new titles and the fixes to the 11 on the shelf

Owner approved the plan on 8 Nov 2026 and the covers the same day ("ok they look fine to me"; the review page is https://claude.ai/artifact/TPkSyXAZKpdMR78CU3TZSi). This folder holds what the books say. The specs are in `scripts/ops/kdp-books/`, and the engine builds and uploads from them.

| What | Where |
|---|---|
| Line specs (binding format) | `scripts/ops/kdp-books/{keepmyproof,aplayermode,time2read,wedding,uscisexam}.json` → `series_books` |
| Fixes to the 11 books already on the KDP bookshelf | `scripts/ops/kdp-books/existing-books.json` |
| Manuscripts | `docs/kdp/books/<slug>.md`: `# ` chapter, `## ` section, `- [ ] ` checklist, table = fill-in log, `{{companion}}` = the companion link |
| Approved cover previews (640 px) | `docs/kdp/books/assets/covers/<slug>.jpg`, `-paperback.jpg`, and `-before.jpg` for the existing books |
| Cover templates that made them | `docs/kdp/books/cover-templates.mjs`, for the engine to move into the pipeline |
| Licensed photos | `docs/kdp/books/assets/<slug>-photo.jpg` |

## Pen names (one per line, new books only)

The contract asks for names that have nothing to do with Sequoia or Taylor, that belong to no real author, and that carry no invented credentials. Each one was web-searched on 8 Nov 2026, across the open web plus Amazon and Goodreads, as the exact name with "author" and "book". Each book's About page says the name is a pen name used by Spry Labs and that the books are drafted with AI and checked by the team, so no invented person stands behind it (risk R-PRF-02).

| Line | Pen name | What the search found |
|---|---|---|
| KeepMyProof | Reid Calloway | No author or book under this name. The nearest results were other Calloways: Caroline, Marie, Kate and Chance. |
| A Player Mode | Tomas Wexley | No author or book. The nearest results were Tomas Ross, Django Wexler and Tim Wexler. |
| Time-2-Read | Nell Bramble | No author or book. The nearest was Nell Branum, a children's author with a different surname. |
| Dream Wedding | June Hollister | No author or book. The nearest result was the Happy Hollisters children's series, written by Jerry West. |
| uscisexam | Ines Calder | No author or book. The nearest were Goodreads readers named Ines and the author Eve Calder. |

Rejected: Corin Ashdale, which is too close to Goodreads author "Corin Ash"; Della Mayfield, which is too close to the writer D. L. Mayfield; and Nadia Carrow, because a Goodreads account under that name may be a real person.

Live titles keep their author (KDP locks it): S. Taylor, Lanae Taylor and S. L. Taylor stay on the 11 shelf books. In `keepmyproof.json`, the top-level `author` stays S. L. Taylor for the live Co-Parenting Log, and each `series_books` entry names Reid Calloway.

## Photos (wedding line only)

Every photo comes from Dream Wedding's own vetted photo set (`dream-wedding-builder/data/pinterest/topic_art.json`, under its photo rules of 6 Nov 2026: free licence, at least 1000 px wide, no watermark, checked by eye). None shows a couple's face, because the Dream Wedding brand rules out stock couples. Each one is recorded on its spec as `cover.photo`.

| Book | Photo | Photographer | Licence |
|---|---|---|---|
| The Courthouse Wedding Planner | Wedding rings and a pen on a signed marriage document (pexels.com/photo/30657138) | Edu Raw | Pexels License |
| Writing Your Wedding Vows | Two gold rings on a dictionary page open at "marriage" (unsplash.com/photos/YeJWDWeIZho) | Sandy Millar | Unsplash License |
| The Maid of Honor Handbook | Brunch plate, coffee and white flowers on linen (unsplash.com/photos/zllBDtma74E) | Nataliya Melnychuk | Unsplash License |
| The Wedding Seating Chart (existing) | Handwritten name cards (unsplash.com/photos/yWTqcUpHBWo) | Christina Victoria Craft | Unsplash License |
| Questions to Ask Every Wedding Vendor (existing) | Ceremony chairs between white columns (unsplash.com/photos/RpUcPmG46vw) | Keenan Barber | Unsplash License |
| The Wedding Day Timeline (existing) | Open planner and pen on a cork mat (unsplash.com/photos/ebvCsRypmxM) | Renáta-Adrienn | Unsplash License |

Every other cover is type only. The KeepMyProof and ApprovalPrep brands rule out stock photos. A Player Mode is type only. Time-2-Read is type plus a drawn cat. uscisexam is type only and carries no seal, flag or eagle, so it never looks like a government paper (risk R-LEAD-10).

## How each cover was reviewed

Each cover was judged at Amazon's search size, 160 px tall: can you read the title, is there one promise, does it look right for the genre, and is it free of clutter? Five covers were redone after the first round:

- **ApprovalPrep:** long title words overflowed. Titles are now fitted to the width, and "(Down Payment)" sits on its own smaller line.
- **The 504 Plan & IEP Meeting Binder:** the title ran into the promise line. Every title is now fitted to a box.
- **Dream Wedding:** the titles were too small to read at thumbnail size, and two ran into the promise. They are now fitted to a box.
- **Time-2-Read:** the Book 1 badge covered the title, so it moved.
- **uscisexam:** "Guide" overlapped the promise. That cover now uses a flowing layout.

The old covers were also wrong in ways a thumbnail does not show. "Templates that get errors removed" promised a credit outcome (risk R-ADV-13), and "Templates that get you approved" promised an approval. Five near-identical slate covers in teal, a color the ApprovalPrep brand now rules out, could not be told apart.

## Claim gate and checks

Every manuscript passes `lib.mjs` `claimProblems`. The KeepMyProof and uscisexam books also pass the strict prose mode: no digits, no links, no exclamation marks, and no legal step given as advice. The one exception is a number in the book's own title, such as "504", which the gate allows. All 11 listings pass `listingProblems`. The Time-2-Read stories were checked word by word: every word uses only the sounds taught so far, or is on that story's tricky-word list (654 words, 0 exceptions).

## What the engine needs to support (fields lib.mjs does not read yet)

- `series_books[].author` overrides the line's `author`. It is needed in `keepmyproof.json` only.
- A paperback (`paperback.price_usd` and `paperback.trim`, `6x9` or `8.5x11`): a print PDF interior, plus a full wrap cover whose spine width comes from the page count. The fronts approved here are `<slug>-paperback.jpg`.
- `{{companion}}` becomes `companion_url` plus `?utm_source=kindle&utm_medium=book&utm_campaign=<slug>`, set as a live link.
- `layout: "story_book"` (Time-2-Read): one story per `# `, large type, a page break between stories, and the `## Sounds` / `## Tricky words` lists shown as boxes.
- Claim gate: digits that appear in the book's own title (504) are allowed in prose.
- `_series_books_supersede` in `keepmyproof.json`: the four undrafted `books` entries (workplace, va, executor, iep) are replaced by the new series books, so the monthly drafter must not draft both.
- `existing-books.json`: the subtitle, keywords, categories, price, cover and in-book link fixes for the 11 shelf titles. The author never changes. The Gift Letter changes only once Amazon's review is finished.
- The companion pages `/amazon/<slug>/` on keepmyproof.com, aplayermode.com, time-2-read.com, weddingchecklistpdf.com and uscisexam.com do not exist yet; keepmyproof.com/amazon/parallel-parenting/ returns 404 today. They must be live before a book that prints them is published.
