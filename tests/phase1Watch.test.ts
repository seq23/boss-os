/**
 * PHASE 1 OF THE VETERAN QUALITY BAR (owner, 19 Nov 2026: "ALL PHASES GO, incl. phase 1"): the billing
 * watch in Toni's risk watch, and the scorecard's outcome alarms between Mondays. Synthetic data only.
 *
 * The incident behind the billing watch: GitHub mailed "We had a problem billing your account" (payment
 * attempts failing) while its metered use was covered by included discounts, and nothing told her.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  billingProblemReadings, cloudflareUsageReading, workersAiReading, githubUsageReading, monthProgress, noticeReadings, planRisk, BILLING_MAIL, stripeReading,
} from "../scripts/ops/risk-watch.mjs";
import { classifyToniThread, reconcileToniReadings, scanToniMailbox } from "../scripts/ops/lib/toni-mail.mjs";
import { lineProblems } from "../src/shared/boss/mail/plain.mjs";
import { morningSectionProblems } from "../src/shared/boss/mail/morning.mjs";
import { alarmReading, alarmTargets } from "../src/shared/boss/scorecard/scorecard.mjs";
import { outcomeAlarms } from "../scripts/ops/scorecard-monday.mjs";

const NOW = Date.parse("2026-11-20T14:00:00Z");
const GH_FAIL = (id: string, date: string) => ({ id, from_domain: "github.com", subject: "[GitHub] We had a problem billing your account", date, kind: "payment_failed", vendor: "GitHub", detail: "The card was declined for the seq23 account, attempt 3 of 3." });

describe("billing watch: a failed payment surfaces as one plain Decide item", () => {
  const message = (id: string, body: string) => ({
    id, internalDate: NOW - 1000, headers: { from: "alerts@vendor.example", subject: "Action required on your account" }, body,
  });
  const reply = (notices: unknown) => ({ status: "ok", provider: "workers-ai", text: JSON.stringify({ notices }), inTokens: 1, outTokens: 1 } as const);

  it("reads opaque billing subjects with the whole thread through Toni's free route", async () => {
    const thread = [message("prior", "Invoice context without a short excerpt"), message("m1", "This will be our last attempt to charge the card.")];
    const read = vi.fn(async () => reply([{ id: "m1", kind: "payment_failed", vendor: "Vendor", detail: "Final attempt" }]));
    const list = vi.fn(async (_token: string, _query: string): Promise<[string, Set<string>][]> => [["thread", new Set(["m1"])]]);
    const out = await scanToniMailbox({ token: async () => "fixture", rule: BILLING_MAIL, now: NOW, list, load: async () => thread, read });
    expect(list).toHaveBeenCalledWith("fixture", expect.stringMatching(/^after:\d+ before:\d+ -in:drafts -in:chats$/));
    expect(read).toHaveBeenCalledWith(expect.objectContaining({ worker: "toni", source: JSON.stringify({ targets: ["m1"], thread }) }), expect.anything());
    expect(out).toMatchObject({ why: null, count: 1, handled: 1, checkpoint: { through: NOW } });
    expect(planRisk(noticeReadings(out.notices, "fixture Gmail", "charges:fixture", NOW)).decide[0]?.title).toBe("Vendor could not take a payment");
  });

  it("holds the window and prior alerts on incomplete, foreign-ID, and capped reads and retries the same item", async () => {
    const thread = [message("m1", "The card was declined.")];
    // An answer that skips or swaps the target is never a verdict: the target counts as uncertain (held for her
    // after three runs, #584 recheck R2), never "other" or a notice; a reader outage still throws and is retried.
    for (const answer of [[], [{ id: "wrong", kind: "other", vendor: "", detail: "" }]]) {
      expect(await classifyToniThread(thread, ["m1"], BILLING_MAIL, async () => reply(answer))).toEqual([{ id: "m1", at: thread[0]!.internalDate, kind: "uncertain" }]);
    }
    await expect(classifyToniThread(thread, ["m1"], BILLING_MAIL, async () => ({ status: "unavailable", provider: "workers-ai" }) as never)).rejects.toThrow("did not classify every target");
    const list = vi.fn(async (_token: string, _query: string): Promise<[string, Set<string>][]> => [["thread", new Set(["m1"])]]);
    const load = async () => thread;
    const token = async () => "fixture";
    const held = await scanToniMailbox({ token, rule: BILLING_MAIL, now: NOW, list, load, read: async () => ({ status: "allowance-exhausted", provider: "workers-ai" }) });
    expect(held).toMatchObject({ count: 1, handled: 0, notices: [], checkpoint: { receipts: {} }, why: expect.stringContaining("FREE_ALLOWANCE_EXHAUSTED") });
    expect(held.checkpoint.through).toBeUndefined();
    const prior = { "billing-problem:vendor.example:prior": "alert" };
    expect(reconcileToniReadings([], prior, ["billing-problem:"])).toEqual({ states: prior, moved: [] });
    const recovered = await scanToniMailbox({ token, rule: BILLING_MAIL, now: NOW + 86_400_000, list, load, previous: held.checkpoint,
      read: async () => reply([{ id: "m1", kind: "payment_failed", vendor: "Vendor", detail: "" }]) });
    expect(list.mock.calls[0]?.[1]?.split(" ")[0]).toBe(list.mock.calls[1]?.[1]?.split(" ")[0]);
    expect(recovered).toMatchObject({ why: null, handled: 1, notices: [{ id: "m1" }], checkpoint: { through: NOW + 86_400_000 } });
  });

  const github = githubUsageReading({ usageItems: [{ grossAmount: 600, discountAmount: 600, netAmount: 0 }, { grossAmount: 41.75, discountAmount: 41.75, netAmount: 0 }] });

  it("GitHub's metered use covered by discounts reads ok, with the amounts", () => {
    expect(github.state).toBe("ok");
    expect(github.line).toBe("GitHub this month: $641.75 of metered use, all covered by included discounts, so $0.00 is due from it.");
    const due = githubUsageReading({ usageItems: [{ grossAmount: 641.75, discountAmount: 600, netAmount: 41.75 }] });
    expect(due.state).toBe("alert");
    expect(due.line).toContain("$41.75 due");
    expect(githubUsageReading({}).state).toBe("stop");
  });

  it("two failure mails from one vendor are one alert; personal bills, receipts past 2 days and other mail are not", () => {
    const r = noticeReadings([
      GH_FAIL("m1", "2026-11-17"), GH_FAIL("m2", "2026-11-17"),
      { id: "p1", from_domain: "carrier-example.com", subject: "Payment past due", date: "2026-11-16", kind: "personal" },
      { id: "r1", from_domain: "vendor-example.com", subject: "Your receipt", date: "2026-11-10", kind: "receipt" },
      { id: "r2", from_domain: "vendor-example.com", subject: "Your receipt", date: "2026-11-19", kind: "receipt" },
      { id: "o1", from_domain: "jobs-example.com", subject: "Billing clerk and 12 more jobs", date: "2026-11-19", kind: "other" },
    ], "personal Gmail", "charges:personal", NOW);
    const alerts = r.filter((x) => x.state === "alert");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.line).toBe("Your payment to GitHub did not go through on 17 Nov (2 notices): The card was declined for the seq23 account, attempt 3 of 3.");
    expect(r.filter((x) => x.state === "notice").map((x) => x.key)).toEqual(["charge:r2"]);
    expect(r.some((x) => /carrier-example/.test(x.line))).toBe(false);
  });

  it("the failure is a Decide item with GitHub's usage beside it, a billing page and the email; every word plain", () => {
    const [alert] = billingProblemReadings([GH_FAIL("m2", "2026-11-17")]);
    const plan = planRisk([{ ...alert!, was: null }], { github });
    expect(plan.fixes).toEqual([]);
    expect(plan.decide).toHaveLength(1);
    const d = plan.decide[0]!;
    expect(d.title).toBe("GitHub could not take a payment");
    expect(d.body).toContain("$641.75 of metered use, all covered by included discounts");
    expect(d.buttons.map((b) => b.url)).toEqual(["https://github.com/settings/billing", expect.stringMatching(/^https:\/\/mail\.google\.com\//)]);
    expect(lineProblems(`${d.title} ${d.body}`)).toEqual([]);
    expect(morningSectionProblems({ section: "risk", at: new Date(NOW).toISOString(), decide: plan.decide, lines: [] })).toEqual([]);
  });

  it("the same mail ageing out of the search is not 'back to normal'; a later failure is news again", () => {
    expect(planRisk([{ key: "billing-problem:github.com:m2", state: "cleared", was: "alert", line: "gone" }]).lines).toEqual([]);
    const a = billingProblemReadings([GH_FAIL("m2", "2026-11-17")])[0]!.key;
    const b = billingProblemReadings([GH_FAIL("m9", "2026-11-24")])[0]!.key;
    expect(a).not.toBe(b);
  });

  it("a read only she can unlock (a sign-in) is a Decide item with the command, never a team chore", () => {
    const plan = planRisk([{ key: "github", state: "stop", needsHer: true, was: null, line: "GitHub's bill cannot be read yet. gh auth refresh -h github.com -s user" }]);
    expect(plan.fixes).toEqual([]);
    expect(plan.decide[0]!.body).toContain("gh auth refresh -h github.com -s user");
    expect(planRisk([{ key: "github", state: "stop", was: null, line: "GitHub's bill could not be read (500)." }]).fixes).toHaveLength(1);
  });

  it("Workers AI: a day past 9,000 neurons is named, $0.99 of overage in a month is her limit", () => {
    expect(workersAiReading({ "2026-11-18": 1027, "2026-11-19": 34 }).state).toBe("ok");
    const hot = workersAiReading({ "2026-11-19": 34, "2026-11-20": 29_072 });
    expect(hot.state).toBe("alert");
    expect(hot.line).toContain("2026-11-20");
    expect(hot.line).toContain("$0.21");
    const limit = workersAiReading({ "2026-11-15": 112_937, "2026-11-20": 9_500 });
    expect(limit.line).toContain("$0.99 limit");
    expect(workersAiReading(null).state).toBe("stop");
  });

  it("Cloudflare use is projected to the month's end and named when near what the plan includes", () => {
    const ok = cloudflareUsageReading({ requests: 1_500_000, rowsRead: 1e9, rowsWritten: 1e6, storageBytes: 4e8 }, { daysDone: 19, daysInMonth: 30 });
    expect(ok.state).toBe("ok");
    const near = cloudflareUsageReading({ requests: 6_000_000, rowsRead: 1e9, rowsWritten: 1e6, storageBytes: 4e8 }, { daysDone: 15, daysInMonth: 30 });
    expect(near.state).toBe("alert");
    expect(near.line).toContain("Workers requests at 120% of what the plan includes");
    expect(cloudflareUsageReading({ requests: 1 }, { daysDone: 1, daysInMonth: 30 }).state).toBe("stop");
    expect(monthProgress(Date.parse("2026-12-01T12:00:00Z"))).toMatchObject({ first: "2026-12-01", yesterday: "2026-11-30", daysDone: 1, daysInMonth: 31 });
  });

  it("a failed Stripe payout or payouts switched off is an alert; payouts that went through are not", () => {
    expect(stripeReading("shop", { payouts: [{ status: "paid", amount: 100 }], account: { payouts_enabled: true } }).state).toBe("ok");
    const f = stripeReading("shop", { payouts: [{ status: "failed", amount: 4200, failure_message: "The bank account has been closed." }], account: null });
    expect(f.state).toBe("alert");
    expect(f.line).toBe("Stripe (shop) could not pay out $42.00 to the bank: The bank account has been closed.");
    expect(stripeReading("shop", { payouts: [], account: { payouts_enabled: false } }).state).toBe("alert");
    expect(stripeReading("shop", { payouts: null, account: null }).state).toBe("stop");
  });
});

describe("outcome alarms: a live result past its floor is said the same morning, once", () => {
  const row = {
    id: "demo-leads", initiative: "Demo leads", business: "spry", start: "2026-09-01",
    first: { label: "lead requests a week", by: 30, floor: { op: ">=", value: 5 }, reader: "d1", params: {} },
    real: { label: "lead requests a week", by: 60, floor: { op: ">=", value: 5 }, reader: "d1", params: {} },
    versionB: { text: "B" },
  };
  const other = { ...row, id: "other-row", initiative: "Other" };
  const sc = { rows: [row, other], businesses: [{ key: "spry", label: "Spry Labs" }] };
  const record = { start: "2026-09-01", history: [], bOn: null, missed: null, pausedOn: null };
  const state = { rows: { "demo-leads": { state: "On track", record }, "other-row": { state: "Trying version B", record: { ...record, bOn: "2026-11-16", missed: "real" } } } };
  let dir = "";
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "alarms-")); process.env.BOSS_OS_STATE_DIR = dir; });
  afterEach(() => { delete process.env.BOSS_OS_STATE_DIR; });

  it("only rows last judged On track are read, on the floor judged today", () => {
    expect(alarmTargets(sc.rows, state, "2026-11-20").map((t) => [t.row.id, t.key])).toEqual([["demo-leads", "real"]]);
    expect(alarmReading(alarmTargets(sc.rows, state, "2026-11-20")[0]!, { raw: 2 }, "2026-11-20", "Spry Labs")).toMatchObject({ state: "alert" });
    expect(alarmReading(alarmTargets(sc.rows, state, "2026-11-20")[0]!, { error: "NAMED STOP [X] no key" }, "2026-11-20").state).toBe("stop");
  });

  it("a drop writes one line into the morning email; the same drop the next day writes nothing; a recovery is said", async () => {
    const written: any[] = [];
    const write = (section: string, data: any) => { written.push({ section, ...data }); return data; };
    let raw = 2;
    const read = async () => ({ raw });
    expect(await outcomeAlarms({ sc, state, ctx: {}, today: "2026-11-20", dry: false, read, write })).toBe(0);
    expect(written).toHaveLength(1);
    expect(written[0].section).toBe("scorecard");
    expect(written[0].lines).toEqual(["Demo leads (Spry Labs) dropped below its floor: 2 lead requests a week (floor 5). It was on track at the last Monday check; if it is still down next Monday, version B starts."]);
    expect(lineProblems(written[0].lines[0])).toEqual([]);
    await outcomeAlarms({ sc, state, ctx: {}, today: "2026-11-21", dry: false, read, write });
    expect(written).toHaveLength(1);
    raw = 7;
    await outcomeAlarms({ sc, state, ctx: {}, today: "2026-11-22", dry: false, read, write });
    expect(written[1].lines[0]).toMatch(/^Demo leads \(Spry Labs\) is back at its floor: 7/);
  });

  it("rows on track but none readable is a named stop, never a quiet green", async () => {
    const code = await outcomeAlarms({ sc, state, ctx: {}, today: "2026-11-20", dry: false, read: async () => ({ error: "NAMED STOP [NO_KEY] x" }), write: () => { throw new Error("must not write"); } });
    expect(code).toBe(2);
  });
});
