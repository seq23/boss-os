# Dream Wedding phone app scorecard

Manifest row `dw-phone-app` measures server-confirmed full-plan event unlocks per
100 production installations reaching the plan. It uses the existing D1 reader,
database `dream-wedding-builder`, and the measurement source merged in
`seq23/dream-wedding-builder#190`.

Before launch, apply that repo's `migrations/0010_app_metrics.sql`. Collection stays
off until launch setup enables Worker `APP_METRICS_ENABLED=true` and native
`EXPO_PUBLIC_DW_METRICS=1`. Preview, development and web builds do not send reach.
No collection or deployment settings are changed by registering this row.

The first recorded production plan reach starts the clock, rather than the build
or registration date. Both floors use the rolling 30-day conversion ratio: at least
3 unlocks per 100 installations by day 30, and 6 by day 60. This approximates people;
it is not a matched acquisition cohort. Reinstalls and partner phones can add reach;
Restore deduplicates the original transaction. No customer content goes to Boss OS.

Missing measurement tables fail the reader visibly. Zero reach yields an unknown
number, never a zero conversion rate. Before the first production reach, the row
waits without starting its clock. After launch, investigate missing numbers and
`APP_METRICS_FAILED` logs before trusting the ratio.

A day-30 miss calls for version B: set `remindersNeedFullPlan=false` in the app;
payments and the packet remain paid. This is a reviewed app configuration change,
not an automatic purchase or price change. This row owns no scheduled app jobs and
has no workflow pause targets. Store price changes remain in the stores.

After this registration PR merges, the Dream Wedding final documentation PR must
record its merge receipt and row ID in `apps/mobile/release/scorecard.json`, then
refresh the app's build status and release README. Until then, its
`SCORECARD_NOT_REGISTERED` release gate remains closed. Store accounts, products,
RevenueCat verification and launch submission retain their separate stops.
