> Canonical source: `src/server/continuity/documents.ts`. The drill at
> `POST /api/continuity/drill` checks exactly these steps against the package
> and records the result.

# Restore checklist

Tick these in order. Every line is checkable, and the drill checks the same ones
against the package automatically.

- [ ] The package file opens and parses
- [ ] The payload hash matches `manifest.sha256`
- [ ] Every item hash in the manifest matches its item
- [ ] The Personal Operating Manual is present, with a version number
- [ ] The offline library carries at least one item
- [ ] The disaster recovery runbook is present and readable
- [ ] The initialization prompt is present
- [ ] Nothing in the recovery path requires a network call before step 6
- [ ] The package date is recorded in the SSD log
- [ ] The most recent offsite copy is less than a quarter old

## Copy log

Keep this table current by hand. The system tracks the cadence; it cannot see
the drawer.

| Date | Package SHA (first 12) | SSD | Offsite | Drill result |
|---|---|---|---|---|
|  |  |  |  |  |

The last two lines of the checklist are the two the system cannot check for you.
Everything above them is verified automatically by the drill.
