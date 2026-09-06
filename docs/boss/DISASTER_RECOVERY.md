> Canonical source: `src/server/continuity/documents.ts`. This copy is for
> reading in the repository; the same text is carried verbatim inside every
> sovereignty package, hashed into its manifest, so it is available when this
> file is not.

# Disaster recovery runbook

The situation this is written for: Boss OS is gone. The Cloudflare account is
locked, the D1 database is unreachable, or the whole thing has been deleted.
You have a laptop and a copy of the sovereignty package.

Work top to bottom. Nothing here needs the network until step 6, and steps 1
through 5 are the ones that matter.

## 1. Establish what you have

Open the sovereignty package JSON. It contains, in one file:

- `manual` — the Personal Operating Manual as generated, with its version
- `offline_library` — every memory filed on an offline surface
- `prompt_library` — every approved prompt
- `documents` — this runbook, the restore checklist, the initialization prompt
- `manifest` — a SHA-256 for every item and one for the whole payload

If the file opens and the manifest is there, you have everything the system was
designed to hand you.

## 2. Verify it before trusting it

Hash the payload and compare it to `manifest.sha256`. If they differ, the file
has been altered or truncated: use an older copy. A package that does not verify
is evidence, not a backup.

## 3. Read the operating manual first

Before rebuilding anything, read `manual.sections`. It is generated from
promoted memory and it says how the Boss operates. Rebuilding the software
without it produces a system that runs and gets the decisions wrong.

## 4. Reconstitute working knowledge

The offline library carries what must remain readable with no network: standing
facts, lessons, patterns, the wisdom canon. This is enough to operate by hand
while the software is rebuilt.

## 5. Decide whether to rebuild at all

Not every loss requires a rebuild. Ask: what did the system hold that is not in
this package? If the answer is "nothing that matters this month", operate from
the package and rebuild deliberately rather than in a panic.

## 6. Rebuild, if rebuilding

1. Recreate the Cloudflare resources: Worker, D1, R2, KV, queue.
2. Apply every migration in `migrations/` in order.
3. Restore the most recent verified vault snapshot in `replace` mode, with the
   confirmation string. The restore is a single transaction with foreign keys
   deferred; it lands completely or not at all.
4. Run the restore drill and confirm it passes.
5. Regenerate the Personal Operating Manual and compare its hash to the one in
   the package. A difference means the restore lost something — find out what
   before continuing.

## 7. Re-establish the boundaries

Before doing any work in the rebuilt system: confirm the trading authority is
denied by default, the kill switch state is correct, no exchange credential
exists anywhere in the Worker or the database, and the firm bridge has no open
handoffs you did not expect.

## External SSD workflow

Monthly, and after any month with a significant decision:

1. Build a sovereignty package and verify it.
2. Copy the package file to the external SSD.
3. Note the date and the package SHA in the restore checklist log.
4. Keep the last three. Older copies are deleted only after a newer one has
   verified.

The SSD is not a backup while it lives in the same bag as the laptop.

## Offsite copy workflow

Quarterly:

1. Copy the newest verified package to a second physical location — a safe, a
   family member's house, a bank box.
2. Record only the date and the SHA in the checklist. Do not record the
   location in this system.
3. If the offsite copy is encrypted, the passphrase lives with a person, not
   with the copy, and not in this system.

## Local model smoke test

Canon §106 asks for at least one local model registered. This build has no
local runtime and no host, so the criterion is recorded as deferred, not met.
When a host exists:

1. Register the model with `privacy_class = 'local'`.
2. Ask it one factual question with a known answer and one question that
   requires refusing.
3. Record the result as a benchmark row. A local model that has never answered
   anything is not a fallback.

## What this system tracks for you

`GET /api/continuity` reports every component of the package, when it was last
built, verified and drilled, and what is missing. The SSD copy and the offsite
copy are physical acts it cannot verify — they are maintenance items with
cadences, and nothing marks them done on your behalf.
