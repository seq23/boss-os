import { expect, test } from "@playwright/test";
import { gotoSurface } from "./support/nav";
import { provisionLocalD1, queryLocalD1 } from "./support/provision";

// The non-partner identity the ceiling test posts as, seeded HERE: with six shards (#433) the specs
// that also seed it (p3, p65) may run in another shard, and the post came back 401, not 403 (16 Nov 2026).
test.beforeAll(() => {
  provisionLocalD1(
    `INSERT OR IGNORE INTO firm_user (id, email, full_name, status) VALUES ('fu_e2e_member', 'e2e-member@westpeek.ventures', 'E2E Member', 'ACTIVE'); INSERT OR IGNORE INTO firm_user_role (firm_user_id, role_id) VALUES ('fu_e2e_member', 'role_investment_team');`,
  );
});

/**
 * THE SYSTEM TELLING THE TRUTH ABOUT ITSELF.
 *
 * Three journeys, one property: a firm that runs on automated work has to be able to tell "nothing
 * happened today" from "this is broken", and it can only do that if the product says which.
 *
 * 17 · THE MORNING BRIEF ARRIVES — AND WHEN IT DOES NOT, THE PAGE SAYS WHY. This is the first thing
 *      a partner reads every morning, so a silent blank on it poisons everything underneath: a
 *      reader who cannot tell an empty day from a broken pipeline stops trusting the page, and then
 *      stops opening it.
 *
 * 18 · DIAGNOSTICS CATCHES SOMETHING DOWN, ESCALATES ONCE TO BOTH PARTNERS, AND ANNOUNCES RECOVERY.
 *      Each of those three words is a separate failure mode. Not catching it is the obvious one.
 *      Escalating repeatedly is how an alert becomes wallpaper. Telling one partner leaves the
 *      other believing the firm is fine. And never announcing recovery leaves a warning standing
 *      over something that fixed itself an hour later, which teaches everyone to ignore the next one.
 *
 * 19 · A SPEND CEILING STOPS A RUN AND SAYS SO — asserted as far as this environment can carry it,
 *      and the boundary is stated on the test rather than papered over. See the note there.
 *
 * Runs fully offline: local D1 (miniflare), no credentials.
 */

const MP = { "x-wpos-dev-user": "scooter@westpeek.ventures" };

async function signIn(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/");
  const login = page.getByTestId("dev-login-email");
  await login.waitFor({ state: "visible" });
  await login.fill("scooter@westpeek.ventures");
  await page.getByTestId("dev-login-submit").click();
  await expect(page.getByTestId("identity-status")).toContainText("Scooter Taylor");
}

test("the morning brief either arrives or states, in the schedule's own words, why it has not", async ({
  page,
  request,
}) => {
  await signIn(page);
  await gotoSurface(page, "Home");

  const panel = page.getByTestId("daily-brief");
  await expect(panel).toBeVisible();

  /*
   * THE PAGE PRINTS THE SERVER'S OWN REASON, VERBATIM.
   *
   * Asserted by comparison rather than by pinning a sentence, and that is the point: there are four
   * different reasons a brief legitimately does not exist — no settings yet, switched off, a
   * weekend the partner turned off, or "not built yet today, it starts after 06:00 and needs a
   * sweep to have found something" — and each is a different thing for a partner to do next. A spec
   * that pinned one of them would pass while the page showed the wrong one of the other three.
   */
  const before = (await (await request.get("/api/daily-intelligence", { headers: MP })).json()) as {
    report: unknown | null;
    no_brief_because?: string;
  };

  if (!before.report) {
    expect(before.no_brief_because, "a missing brief must carry the reason it is missing").toBeTruthy();
    await expect(page.getByTestId("daily-brief-empty")).toHaveText(before.no_brief_because!);
  } else {
    await expect(page.getByTestId("daily-brief-meta")).toBeVisible();
  }

  /*
   * AND IT CAN BE BUILT ON DEMAND. The partner is not left waiting for a cron she cannot see.
   *
   * WHERE THIS STOPS. Writing the brief is a model call, and under local `wrangler dev` there is no
   * provider credential and privacy mode is LOCKDOWN, so `run_ai` routes to the deterministic
   * `mock-local` model. What a real model would write into each section cannot be proven here and is
   * not claimed. What IS proven is the whole chain around it: the build is accepted, it reaches a
   * definite recorded state, and the page afterwards is EITHER a report or a stated reason — never
   * the blank this journey exists to prevent.
   */
  const built = await request.post("/api/daily-intelligence/generate", { headers: MP, data: {} });
  expect(built.status(), await built.text()).toBe(201);
  const outcome = (await built.json()) as { status: string; report_id?: string };
  expect(outcome.status, "a build must land in a named state, never in silence").toBeTruthy();

  await page.reload();
  await gotoSurface(page, "Home");
  const after = (await (await request.get("/api/daily-intelligence", { headers: MP })).json()) as {
    report: { report_date: string } | null;
    no_brief_because?: string;
  };
  if (after.report) {
    await expect(page.getByTestId("daily-brief-meta")).toContainText(after.report.report_date);
    await expect(page.getByTestId("daily-brief-empty")).toHaveCount(0);
  } else {
    await expect(page.getByTestId("daily-brief-empty")).toHaveText(after.no_brief_because!);
  }

  // The brief is delivered by a named colleague on Home rather than appearing from nowhere — the
  // section exists whether or not there is anything in it today.
  await expect(page.getByTestId("home-brief-delivery")).toBeVisible();
});

test("the copied diagnostics sweep is switched off here: a run is refused and tells no one anything", async ({ request }) => {
  /*
   * West Peek OS runs its own diagnostics_sweep, so 0375 switched the copy here off (22 Nov 2026):
   * every run here reported the same one fault to fund partners in a table no Boss OS screen reads.
   * A run is REFUSED with that reason, and no health notice is written by it.
   */
  const before = notificationsAbout("approval_load").length;
  const res = await request.post("/api/jobs/diagnostics_sweep/run", { headers: MP });
  expect([200, 201], await res.text()).toContain(res.status());
  const body = (await res.json()) as { run: { status: string; outcome_summary: string } };
  expect(body.run.status).toBe("REFUSED");
  expect(body.run.outcome_summary).toContain("West Peek OS runs this job itself");
  expect(notificationsAbout("approval_load").length).toBe(before);
});

test("a spending ceiling is a partner's decision, it persists, and a cost mode actually stops a run", async ({
  page,
  request,
}) => {
  /*
   * ── WHAT THIS CAN AND CANNOT PROVE HERE, SAID PLAINLY ─────────────────────────────────────────
   *
   * The MONETARY ceiling (`firm_spend_budget`, and the daily cap) is enforced at step 7 of
   * `runAi` — after step 3, where LOCKDOWN and LOCAL short-circuit to the deterministic
   * `mock-local` adapter and return. Local runs therefore never reach the money gates, and they
   * never should: the local adapter costs nothing, and refusing a free run on a spending limit
   * would be wrong. Under `wrangler dev --local` there is no provider credential and privacy mode
   * is LOCKDOWN, so **a monetary ceiling cannot be made to block a run in this environment at all**,
   * and no assertion here claims that it does. That leg is unit-testable against the frontier path
   * and belongs in `tests/`.
   *
   * What IS proved, end to end and in the browser:
   *   · the ceiling is a person's decision and a Managing Partner's alone;
   *   · it PERSISTS and is read back where it was set — "a budget that displays but does not bind
   *     is worse than none" cuts both ways, and a ceiling nobody can see afterwards is the same
   *     failure wearing the other face;
   *   · and a spending decision that CAN reach a local run — the cost MODE — stops one and names
   *     the rule that stopped it, on the run's own row, which is the shape every budget refusal in
   *     this system takes.
   */
  const marker = `E2E-P62-SPEND-${Date.now()}`;
  await signIn(page);

  // ── The ceiling: set by a partner, on the page that spends the money ────────────────────────
  await gotoSurface(page, "Cockpit");
  const before = page.getByTestId("firm-budget-MONTHLY");
  await expect(before).toBeVisible();
  await expect(
    page.getByTestId("firm-budget-none-MONTHLY"),
    "with no limit set the page says so rather than drawing a bar against nothing",
  ).toContainText("No limit set");

  await page.getByTestId("firm-budget-input-MONTHLY").fill("250");
  await page.getByTestId("firm-budget-save-MONTHLY").click();
  await expect(page.getByTestId("firm-budget-cap-MONTHLY")).toContainText("250");
  await expect(page.getByTestId("firm-budget-none-MONTHLY")).toHaveCount(0);

  // It persists. A ceiling that lives in a component's state is a ceiling nobody set.
  await page.reload();
  await gotoSurface(page, "Cockpit");
  await expect(page.getByTestId("firm-budget-cap-MONTHLY")).toContainText("250");

  const stored = (await (await request.get("/api/ai/cost", { headers: MP })).json()) as {
    firm_budgets?: Array<{ budget_window: string; cap_usd?: number; cap_cents?: number; active?: number }>;
  };
  const monthly = (stored.firm_budgets ?? []).find((b) => b.budget_window === "MONTHLY");
  expect(monthly, "the ceiling is read back from the same payload that reports the spend it governs").toBeTruthy();

  // ── AND IT IS A PARTNER'S DECISION. Not a role, not an employee, not an API client. ──────────
  const asEmployee = await request.post("/api/ai/firm-budget", {
    headers: { "x-wpos-dev-user": "e2e-member@westpeek.ventures" },
    data: { budget_window: "ALL_TIME", cap_cents: 100_000, reason: `${marker} not my decision` },
  });
  expect(asEmployee.status(), await asEmployee.text()).toBe(403);
  expect(await asEmployee.text()).toContain("Managing Partner");

  /*
   * ── A SPENDING DECISION THAT DOES STOP A LOCAL RUN ────────────────────────────────────────────
   *
   * CRITICAL_ONLY is the firm saying "only spend on work that cannot wait". It is checked at step 1
   * of `runAi`, before the privacy short-circuit, so it binds here — and it is the same mechanism
   * every money refusal uses: the run is RECORDED, blocked, with a reason on its own row, rather
   * than throwing or silently not happening.
   */
  const policy = await request.post("/api/ai/budget", {
    headers: MP,
    data: {
      cost_mode: "CRITICAL_ONLY",
      privacy_mode: "LOCKDOWN",
      daily_cap_usd: 25,
      per_run_cap_usd: 5,
    },
  });
  expect(policy.status(), await policy.text()).toBe(201);

  try {
    await gotoSurface(page, "AI controls");
    await page.getByTestId("ai-purpose").fill(`${marker} tidy up the notes`);
    await page.getByTestId("ai-input").fill("Rewrite last week's portfolio notes more neatly.");
    await page.getByTestId("ai-run-submit").click();

    /*
     * DEFERRED, NOT DISCARDED, AND IT SAYS WHICH RULE. The run exists, it is on the list, and the
     * reason is printed against it — because "the firm is in a cost mode that does not run this"
     * and "the AI is broken" look identical to an operator unless one of them is written down.
     */
    await expect(page.getByTestId("ai-message")).toContainText("BLOCKED_DEFERRED");
    const blockedRun = page.locator('li[data-testid^="ai-run-"]').filter({ hasText: `${marker} tidy up` }).first();
    await expect(blockedRun).toBeVisible();
    await expect(blockedRun).toContainText("cost_mode_critical_only");

    // NOTHING WAS BOUGHT, and the spend definition says so: a refused run counts as nothing,
    // because nothing was bought.
    const run = (await (await request.get("/api/ai/runs", { headers: MP })).json()) as {
      runs: Array<{ purpose: string; status: string; failure_reason: string | null }>;
    };
    const mine = run.runs.find((r) => r.purpose.includes(`${marker} tidy up`))!;
    expect(mine.status).toBe("BLOCKED_DEFERRED");
    expect(mine.failure_reason).toContain("cost_mode_critical_only");

    // Work the firm HAS decided is critical still runs — a ceiling is a priority, not a shutdown.
    const critical = await request.post("/api/ai/run", {
      headers: MP,
      data: {
        purpose: `${marker} IC packet gap analysis`,
        inputs: ["What is missing from this committee packet?"],
        sensitivity: "INTERNAL",
      },
    });
    expect(critical.status(), await critical.text()).toBe(201);
    expect(((await critical.json()) as { status: string }).status).toBe("COMPLETED");
  } finally {
    /*
     * PUT THE FIRM BACK. Every spec after this one drives the same database, and leaving the firm in
     * CRITICAL_ONLY would refuse their runs for a reason that has nothing to do with them — which is
     * the state this suite's README warns about: "anything a spec switches off is switched off for
     * everything after it".
     */
    await request.post("/api/ai/budget", {
      headers: MP,
      data: { cost_mode: "NORMAL", privacy_mode: "LOCKDOWN", daily_cap_usd: 25, per_run_cap_usd: 5 },
    });
    await request.post("/api/ai/firm-budget", {
      headers: MP,
      data: { budget_window: "MONTHLY", cap_cents: 25_000, reason: `${marker} fixture retired`, active: false },
    });
  }
});

// ── helpers ────────────────────────────────────────────────────────────────────────────────────

type Ctx = import("@playwright/test").APIRequestContext;

interface NotificationRow {
  id: string;
  severity: string;
  title: string;
  body: string;
  object_id: string;
  dedupe_key: string;
}

/**
 * The notifications a health check produced, READ FROM THE DATABASE and not from the route.
 *
 * `GET /api/notifications` orders CRITICAL → WARNING → INFO and stops at 200. A firm that has
 * accumulated two hundred warnings therefore cannot see ANY of its INFO rows through that route —
 * including every diagnostics all-clear, which is precisely the row this journey has to look at.
 * That is a real limit of the route and it is reported rather than worked around in the product;
 * here the ledger is read directly, which is what `queryLocalD1` exists for: "the handful of facts
 * no route serves".
 */
function notificationsAbout(checkKey: string): NotificationRow[] {
  return queryLocalD1<NotificationRow>(
    `SELECT id, severity, title, body, object_id, dedupe_key
       FROM notification
      WHERE object_id = '${checkKey}' AND object_type = 'health_fault'
      ORDER BY created_at`,
  );
}
